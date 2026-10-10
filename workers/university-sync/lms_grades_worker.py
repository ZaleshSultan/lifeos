#!/usr/bin/env python3
"""
Multi-tenant LMS grades background worker.

Reads all active university platform configurations from ``public.user_lms_settings``
(service-role access), decrypts credentials, delegates to the per-platform
scraper modules, and writes grades into Supabase via the shared lifeos_sync
framework — one ``SupabaseRestClient`` scoped to each user's ``user_id``.

ENCRYPTION CONTRACT
===================
Passwords, WS tokens and owner-bound sessions use the application layer's
``enc:v1:<iv>:<tag>:<ciphertext>`` AES-256-GCM format. Missing or invalid
encryption keys fail closed. Sessions never fall back to plaintext credentials.

MULTI-TENANCY MODEL
===================
The master ``SupabaseRestClient`` is initialized with the service-role key so it
can read all users' LMS settings.  For each user a *scoped* ``BaseSettings`` is
derived — identical to the master except ``user_id`` is replaced with the target
user's UUID.  All Supabase writes (source_events, academic_records, sync_runs…)
are then performed through a freshly constructed ``SupabaseRestClient`` whose
``settings.user_id`` matches the row being written, preserving the
``user_id``-scoped RLS invariant that every other worker follows.

ADDING NEW PLATFORM TYPES
==========================
1. Add the ``platform_type`` string to the SQL CHECK constraint in
   ``20260624000100_university_lms_settings.sql``.
2. Implement a scraper module under ``workers/university-sync/<name>/``.
3. Register a ``PlatformHandler`` entry in ``PLATFORM_HANDLERS`` below.
"""

from __future__ import annotations

import dataclasses
import json
import logging
import sys
import time
from pathlib import Path
from typing import Any, Callable, NamedTuple
from datetime import datetime, timedelta, timezone

# ── Path bootstrap ─────────────────────────────────────────────────────────────
# This file lives at workers/university-sync/lms_grades_worker.py
# parents[0] = workers/university-sync/
# parents[1] = workers/
sys.path.insert(0, str(Path(__file__).resolve().parent))     # university-sync/
sys.path.insert(0, str(Path(__file__).resolve().parent / "aitu-parser"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1])) # workers/

from common.lifeos_sync import (  # noqa: E402
    BaseSettings,
    SupabaseRestClient,
    SyncError,
    SyncStats,
    getenv_int,
    load_base_settings,
    load_dotenv,
    utc_now,
)
from common.lms_sessions import LmsSessionError, decrypt_lms_session, decrypt_secret  # noqa: E402
from common.lms_sync_lease import LmsSyncLease, guard_lms_client  # noqa: E402
from university_scraper import (  # noqa: E402
    MoodleClient,
    Settings as MoodleSettings,
    sync_grades as sync_moodle_grades,
)
from platonus.platonus_sync import (  # noqa: E402
    PlatonusClient,
    Settings as PlatonusSettings,
    sync_grades as sync_platonus_grades,
)

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s]: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("lms_grades_worker")


def decrypt_field(ciphertext: str) -> str:
    """Compatibility alias; authenticated encrypted credentials are mandatory."""
    return decrypt_secret(ciphertext)


def failure_category(error: Exception) -> str:
    category = getattr(error, "category", None)
    if category == "invalid_session":
        return "decryption_failed"
    if category in {"session_expired", "invalid_session", "encryption_unavailable", "unsupported_auth_flow", "connection_failed"}:
        return category
    # Older platform clients expose SyncError only. Inspect privately, never log it.
    text = str(error).lower()[:2_000]
    if isinstance(error, SyncError) and any(term in text for term in ("session expired", "expired session", "authentication failed", "login failed", "401", "403")):
        return "reauthentication_required"
    return "sync_failed"


def safe_features(client: Any) -> list[str]:
    import re
    values = getattr(client, "unsupported_features", [])
    if not isinstance(values, list):
        return []
    return list(dict.fromkeys(value for value in values if isinstance(value, str) and re.fullmatch(r"[a-z][a-z0-9_]{0,63}", value)))[:20]


def close_moodle_client(client: Any) -> None:
    if client is None:
        return
    try:
        client.close()
    except Exception:
        pass
    session = getattr(client, "_session", None)
    if session is not None:
        try:
            session.cookies.clear()
            session.close()
        except Exception:
            pass  # Cleanup must never log an authenticated session object.
    client._session = None
    client._sso_cookie = None
    client._password = ""
    client._ws_token = None


# ── Per-user scoped settings ───────────────────────────────────────────────────
def scoped_settings(master: BaseSettings, user_id: str) -> BaseSettings:
    """
    Clone ``master`` with ``user_id`` replaced by the target user's UUID.
    Uses dataclasses.replace to produce a new frozen instance without mutating
    the shared master object.
    """
    return dataclasses.replace(master, user_id=user_id)


# ── Platform handlers ──────────────────────────────────────────────────────────
class PlatformHandler(NamedTuple):
    """Encapsulates the sync logic for one LMS platform type."""
    name: str
    run: Callable[[SupabaseRestClient, BaseSettings, dict[str, Any]], SyncStats]


def _handle_aitu_moodle(
    db: SupabaseRestClient,
    user_settings: BaseSettings,
    row: dict[str, Any],
) -> SyncStats:
    """Sync grades and available assignment deadlines for one Moodle user."""
    if db.settings.user_id != user_settings.user_id or row.get("user_id", user_settings.user_id) != user_settings.user_id:
        raise LmsSessionError("invalid_session")
    source = db.ensure_source("university_platform", "university", "University Platform")
    run_id = db.start_sync_run(source)
    client = None
    try:
        session_mode = row.get("auth_mode", "password") == "session"
        cookie = decrypt_lms_session(row.get("sso_cookie_encrypted"), user_settings.user_id,
                                    expires_at=row.get("session_expires_at")) if session_mode else None
        moodle_settings = MoodleSettings(
            base=user_settings,
            username=str(row.get("username") or ""),
            password="" if session_mode else decrypt_field(row["encrypted_password"]),
            ws_token=decrypt_field(row["ws_token_encrypted"]) if not session_mode and row.get("ws_token_encrypted") else None,
            sso_cookie=cookie,  # Only this row's verified owner-bound session.
            poll_seconds=3600,
            allow_mock=False,
        )
        client = MoodleClient(moodle_settings)
        records = client.fetch_grades()
        assignments = client.fetch_assignments()
        mode = db.get_reminder_mode()
        lease = row.get("_sync_lease")
        if lease:
            lease.assert_held()
        row["_unsupported_features"] = safe_features(client)
        row["_data_read"] = bool(records) or (assignments is not None and getattr(assignments, "verified_pages", 1) > 0) or bool(getattr(records, "complete", True))
    except Exception as exc:
        db.finish_sync_run(run_id, "failed", SyncStats(), failure_category(exc))
        raise
    finally:
        close_moodle_client(client)
        cookie = None
    # Persistence needs timezone/source configuration, never authentication.
    moodle_settings = dataclasses.replace(moodle_settings, password="", ws_token=None, sso_cookie=None)
    return sync_moodle_grades(
        db, moodle_settings, records, mode, client.is_mocked,
        run_id=run_id, assignments=assignments,
    )


def _handle_platonus(
    db: SupabaseRestClient,
    user_settings: BaseSettings,
    row: dict[str, Any],
) -> SyncStats:
    """Sync grades for a single Platonus user."""
    source = db.ensure_source("university_platform", "university", "University Platform")
    run_id = db.start_sync_run(source)
    try:
        platonus_settings = PlatonusSettings(
            base=user_settings,
            username=row["username"],
            password=decrypt_field(row["encrypted_password"]),
            poll_seconds=3600,
            allow_mock=False,
        )
        client = PlatonusClient(platonus_settings)
        client.authenticate()
        grades = client.fetch_grades()
        mode = db.get_reminder_mode()
    except Exception as exc:
        db.finish_sync_run(run_id, "failed", SyncStats(), failure_category(exc))
        raise
    lease = row.get("_sync_lease")
    if lease:
        lease.assert_held()
    return sync_platonus_grades(db, platonus_settings, grades, mode, run_id=run_id)


PLATFORM_HANDLERS: dict[str, PlatformHandler] = {
    "aitu_moodle": PlatformHandler("AITU Moodle", _handle_aitu_moodle),
    "platonus":    PlatformHandler("Platonus",    _handle_platonus),
}


# ── Sync one user/platform config ─────────────────────────────────────────────
SETTINGS_COLUMNS = "id,user_id,platform_type,auth_mode,username,encrypted_password,ws_token_encrypted,sso_cookie_encrypted,session_expires_at,session_version,session_state,last_sync_success_at,last_sync_attempt_at,sync_requested_at"


def sync_config(master_db: SupabaseRestClient, master_settings: BaseSettings, row: dict[str, Any]) -> bool:
    """
    Run a sync cycle for one ``user_lms_settings`` row.

    Creates a user-scoped ``SupabaseRestClient`` so all DB writes carry the
    correct ``user_id``, then delegates to the platform handler.
    Writes ``last_sync_attempt_at`` / ``last_sync_success_at`` / ``is_token_valid``
    back to ``user_lms_settings`` via the service-role master client.
    """
    config_id   = str(row["id"])
    user_id     = str(row["user_id"])
    platform    = str(row.get("platform_type", ""))
    handler = PLATFORM_HANDLERS.get(platform)
    if handler is None:
        log.warning("Skipping unsupported LMS platform configuration.")
        return False
    try:
        with LmsSyncLease(master_db, user_id, platform) as lease:
            if not lease.acquired:
                log.info("LMS sync skipped: already in progress.")
                return False
            scope = {"id": f"eq.{config_id}", "user_id": f"eq.{user_id}"}
            if row.get("session_version"):
                scope["session_version"] = f"eq.{row['session_version']}"
            # Re-read under the shared lease: a removed/replaced credential from
            # the polling snapshot must not be used after a user's revocation.
            rows = master_db.request("GET", "user_lms_settings", query={
                **scope, "is_active": "eq.true", "select": SETTINGS_COLUMNS, "limit": "1",
            }) or []
            if not isinstance(rows, list) or not rows:
                return False
            current = dict(rows[0])
            if current.get("user_id") != user_id or current.get("id") != config_id or current.get("platform_type") != platform:
                raise SyncError("LMS configuration owner mismatch")
            current["_sync_lease"] = lease
            session_mode = current.get("auth_mode", "password") == "session"
            master_db.request("PATCH", "user_lms_settings", query=scope, body={
                "last_sync_attempt_at": utc_now(),
                **({"session_state": "syncing", "last_error_category": None} if session_mode else {}),
            })
            try:
                user_base = scoped_settings(master_settings, user_id)
                user_db = guard_lms_client(SupabaseRestClient(user_base), lease)
                stats = handler.run(user_db, user_base, current)
                lease.assert_held()
                features = current.get("_unsupported_features", [])
                data_read = current.get("_data_read", True)
                final = {"is_token_valid": True, "last_error_category": "partial_sync" if features or not data_read else None,
                         "unsupported_features": features}
                if data_read:
                    final["last_sync_success_at"] = utc_now()
                if session_mode:
                    final["session_state"] = "connected"
                master_db.request("PATCH", "user_lms_settings", query=scope, body=final)
                log.info("%s sync completed: seen=%d created=%d updated=%d", handler.name, stats.seen, stats.created, stats.updated)
                return True
            except Exception as exc:
                lease.assert_held()
                category = failure_category(exc)
                auth_failure = category in {"session_expired", "reauthentication_required", "decryption_failed", "unsupported_auth_flow"}
                update: dict[str, Any] = {"last_error_category": category}
                if auth_failure:
                    update["is_token_valid"] = False
                if session_mode:
                    update["session_state"] = "session_expired" if category == "session_expired" else "reauthentication_required" if auth_failure else "error"
                    if auth_failure:
                        update.update({"sso_cookie_encrypted": None, "session_expires_at": None})
                # Rotation guard prevents an old failure from erasing a new session.
                master_db.request("PATCH", "user_lms_settings", query=scope, body=update)
                log.error("%s sync failed: %s", handler.name, category)
                return False
            finally:
                if current.get("sync_requested_at"):
                    master_db.request("PATCH", "user_lms_settings", query={
                        **scope, "sync_requested_at": f"eq.{current['sync_requested_at']}",
                    }, body={"sync_requested_at": None})
    except Exception:
        log.error("LMS sync could not acquire or update its scoped configuration.")
        return False


# ── Main polling loop ──────────────────────────────────────────────────────────
def purge_expired_sessions(master_db: SupabaseRestClient) -> int:
    """Scrub expired encrypted sessions even when an integration is inactive."""
    now = utc_now()
    pending: list[dict[str, Any]] = []
    due = {"auth_mode": "eq.session", "sso_cookie_encrypted": "not.is.null",
           "or": f"(session_expires_at.is.null,session_expires_at.lte.{now})"}
    for offset in range(0, 1000, 100):
        rows = master_db.request("GET", "user_lms_settings", query={
            **due, "select": "id,user_id,platform_type,session_version", "order": "id.asc", "limit": "100", "offset": str(offset),
        }) or []
        pending.extend(rows)
        if len(rows) < 100:
            break
    count = 0
    for row in pending:
        try:
            with LmsSyncLease(master_db, row["user_id"], row["platform_type"]) as lease:
                if not lease.acquired:
                    continue
                scope = {"id": f"eq.{row['id']}", "user_id": f"eq.{row['user_id']}", **due}
                if row.get("session_version"):
                    scope["session_version"] = f"eq.{row['session_version']}"
                lease.assert_held()
                master_db.request("PATCH", "user_lms_settings", query=scope, body={
                    "sso_cookie_encrypted": None, "session_expires_at": None,
                    "session_state": "session_expired", "last_error_category": "session_expired",
                    "is_token_valid": False, "sync_requested_at": None,
                })
                count += 1
        except Exception:
            log.error("Expired LMS session cleanup deferred; scoped lease or storage unavailable.")
    return count


def run_once(master_db: SupabaseRestClient, master_settings: BaseSettings, poll_seconds: int = 14400) -> int:
    """Fetch all active LMS configs and sync them. Returns the count synced."""
    purge_expired_sessions(master_db)
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=poll_seconds)).isoformat()
    pending = []
    for offset in range(0, 1000, 100):
        page = master_db.request("GET", "user_lms_settings", query={
            "select": SETTINGS_COLUMNS, "is_active": "eq.true",
            "or": f"(sync_requested_at.not.is.null,last_sync_attempt_at.is.null,last_sync_attempt_at.lt.{cutoff})",
            "order": "id.asc", "limit": "100", "offset": str(offset),
        }) or []
        pending.extend(page)
        if len(page) < 100:
            break
    # Snapshot the bounded due set before mutating timestamps used by its filter.
    return sum(int(sync_config(master_db, master_settings, row)) for row in pending)


def run_loop(master_db: SupabaseRestClient, master_settings: BaseSettings, poll_seconds: int) -> None:
    log.info(
        "Starting multi-tenant LMS Grades Master Worker (poll_interval=%ds).",
        poll_seconds,
    )
    while True:
        try:
            count = run_once(master_db, master_settings, poll_seconds)
            log.info("Cycle complete — synced %d config(s).", count)
        except Exception:  # noqa: BLE001
            log.error("LMS worker cycle failed; details omitted to protect credentials.")
        # Manual requests are picked up promptly while automatic refresh retains
        # the configured (four-hour by default) per-integration interval.
        time.sleep(min(30, poll_seconds))


# ── Entry point ────────────────────────────────────────────────────────────────
def main() -> int:
    load_dotenv(Path(__file__).with_name(".env"))

    # The master worker uses service-role credentials to see ALL users' configs.
    # No legacy_guard_env — this is explicitly a multi-tenant service worker.
    master_settings = load_base_settings(
        legacy_guard_env=None,
        worker_name="LMS Grades Master Worker",
    )
    master_db = SupabaseRestClient(master_settings)

    poll_seconds = getenv_int("UNIVERSITY_GLOBAL_POLL_SECONDS", 14400)  # 4 h default

    import argparse
    parser = argparse.ArgumentParser(description="LifeOS multi-tenant LMS grade sync")
    parser.add_argument(
        "command",
        choices=("sync-once", "run-loop"),
        help="sync-once: run one cycle and exit. run-loop: poll continuously.",
    )
    args = parser.parse_args()

    if args.command == "sync-once":
        try:
            count = run_once(master_db, master_settings, poll_seconds)
        except Exception:
            log.error("LMS sync failed; details omitted to protect credentials.")
            return 1
        print(json.dumps({"synced_configs": count}))
        return 0

    run_loop(master_db, master_settings, poll_seconds)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
