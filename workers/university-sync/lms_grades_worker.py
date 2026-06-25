#!/usr/bin/env python3
"""
Multi-tenant LMS grades background worker.

Reads all active university platform configurations from ``public.user_lms_settings``
(service-role access), decrypts credentials, delegates to the per-platform
scraper modules, and writes grades into Supabase via the shared lifeos_sync
framework — one ``SupabaseRestClient`` scoped to each user's ``user_id``.

ENCRYPTION CONTRACT
===================
Passwords and WS tokens are stored as ``enc:v1:<base64(iv+ciphertext+tag)>``
ciphertext produced by the application layer (TypeScript ``@lifeos/db/crypto``).
The ``decrypt_field()`` function below is the Python mirror of that AES-256-GCM
scheme.  If the ENCRYPTION_KEY env var is absent the worker falls back to
identity pass-through and emits a WARNING so the operator is aware.

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

import base64
import dataclasses
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable, NamedTuple

# ── Path bootstrap ─────────────────────────────────────────────────────────────
# This file lives at workers/university-sync/lms_grades_worker.py
# parents[0] = workers/university-sync/
# parents[1] = workers/
sys.path.insert(0, str(Path(__file__).resolve().parent))     # university-sync/
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
from aitu_parser.university_scraper import (  # noqa: E402
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


# ── Encryption helpers ─────────────────────────────────────────────────────────
_ENCRYPTION_KEY: bytes | None = None


def _load_encryption_key() -> bytes | None:
    """
    Read the 32-byte AES-256 key from ENCRYPTION_KEY (hex or base64).
    Returns None if the variable is absent — decryption falls back to identity.
    """
    raw = os.environ.get("ENCRYPTION_KEY", "").strip()
    if not raw:
        return None
    try:
        key = bytes.fromhex(raw) if len(raw) == 64 else base64.b64decode(raw)
        if len(key) != 32:
            raise ValueError(f"ENCRYPTION_KEY must be 32 bytes, got {len(key)}")
        return key
    except Exception as exc:
        raise SyncError(f"Invalid ENCRYPTION_KEY: {exc}") from exc


def decrypt_field(ciphertext: str) -> str:
    """
    Decrypt an ``enc:v1:<base64>`` field produced by the TypeScript
    ``@lifeos/db/crypto`` module (AES-256-GCM, 12-byte IV, 16-byte auth tag).

    Falls back to identity (returns the string unchanged) when:
    - ``ENCRYPTION_KEY`` is not configured
    - The field does not start with ``enc:v1:`` (plaintext dev value)

    Emits a WARNING on plaintext fallback so operators can detect mis-configured
    environments.
    """
    global _ENCRYPTION_KEY
    if _ENCRYPTION_KEY is None:
        _ENCRYPTION_KEY = _load_encryption_key()

    if not ciphertext.startswith("enc:v1:"):
        log.warning(
            "decrypt_field: field does not carry enc:v1 prefix — "
            "returning as-is (plaintext). Set ENCRYPTION_KEY to enable decryption."
        )
        return ciphertext

    if _ENCRYPTION_KEY is None:
        log.warning(
            "decrypt_field: ENCRYPTION_KEY is not set — returning ciphertext as-is. "
            "Configure ENCRYPTION_KEY to decrypt worker credentials."
        )
        return ciphertext

    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # type: ignore
    except ImportError as exc:
        raise SyncError(
            "'cryptography' library not installed; "
            "run: pip install cryptography"
        ) from exc

    try:
        payload = base64.b64decode(ciphertext[len("enc:v1:"):])
        # Layout: [12 bytes IV][ciphertext][16 bytes auth tag]
        iv = payload[:12]
        body = payload[12:]
        plain = AESGCM(_ENCRYPTION_KEY).decrypt(iv, body, None)
        return plain.decode("utf-8")
    except Exception as exc:
        raise SyncError(f"AES-256-GCM decryption failed: {exc}") from exc


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
    """Sync grades for a single AITU Moodle user."""
    moodle_settings = MoodleSettings(
        base=user_settings,
        username=row["username"],
        password=decrypt_field(row["encrypted_password"]),
        ws_token=decrypt_field(row["ws_token_encrypted"]) if row.get("ws_token_encrypted") else None,
        poll_seconds=3600,
    )
    client = MoodleClient(moodle_settings)
    records = client.fetch_grades()
    mode = db.get_reminder_mode()
    return sync_moodle_grades(db, moodle_settings, records, mode, client.is_mocked)


def _handle_platonus(
    db: SupabaseRestClient,
    user_settings: BaseSettings,
    row: dict[str, Any],
) -> SyncStats:
    """Sync grades for a single Platonus user."""
    platonus_settings = PlatonusSettings(
        base=user_settings,
        username=row["username"],
        password=decrypt_field(row["encrypted_password"]),
        poll_seconds=3600,
    )
    client = PlatonusClient(platonus_settings)
    client.authenticate()
    grades = client.fetch_grades()
    mode = db.get_reminder_mode()
    return sync_platonus_grades(db, platonus_settings, grades, mode)


PLATFORM_HANDLERS: dict[str, PlatformHandler] = {
    "aitu_moodle": PlatformHandler("AITU Moodle", _handle_aitu_moodle),
    "platonus":    PlatformHandler("Platonus",    _handle_platonus),
}


# ── Sync one user/platform config ─────────────────────────────────────────────
def sync_config(master_db: SupabaseRestClient, master_settings: BaseSettings, row: dict[str, Any]) -> None:
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
    username    = str(row.get("username", ""))

    handler = PLATFORM_HANDLERS.get(platform)
    if handler is None:
        log.warning("Unknown platform_type=%r for config %s — skipping.", platform, config_id)
        return

    log.info("▶ %s sync: user=%s username=%s config=%s", handler.name, user_id, username, config_id)

    now = utc_now()
    # Always stamp attempt time
    master_db.request(
        "PATCH", "user_lms_settings",
        query={"id": f"eq.{config_id}"},
        body={"last_sync_attempt_at": now},
    )

    try:
        user_base = scoped_settings(master_settings, user_id)
        user_db   = SupabaseRestClient(user_base)
        stats = handler.run(user_db, user_base, row)

        log.info(
            "✓ %s sync done: user=%s seen=%d created=%d updated=%d",
            handler.name, user_id, stats.seen, stats.created, stats.updated,
        )
        master_db.request(
            "PATCH", "user_lms_settings",
            query={"id": f"eq.{config_id}"},
            body={
                "last_sync_success_at": utc_now(),
                "is_token_valid": True,
            },
        )
    except SyncError as exc:
        log.error("✗ %s sync failed: user=%s error=%s", handler.name, user_id, exc)
        # Mark token invalid if the error looks like an auth failure
        is_auth_err = any(k in str(exc).lower() for k in ("auth", "token", "password", "credential", "401", "403"))
        master_db.request(
            "PATCH", "user_lms_settings",
            query={"id": f"eq.{config_id}"},
            body={"is_token_valid": not is_auth_err},
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("✗ %s sync unexpected error: user=%s error=%s", handler.name, user_id, exc)


# ── Main polling loop ──────────────────────────────────────────────────────────
def run_once(master_db: SupabaseRestClient, master_settings: BaseSettings) -> int:
    """Fetch all active LMS configs and sync them. Returns the count synced."""
    configs = master_db.request(
        "GET", "user_lms_settings",
        query={
            "select": "id,user_id,platform_type,username,encrypted_password,ws_token_encrypted,last_sync_success_at",
            "is_active": "eq.true",
            "order": "last_sync_attempt_at.asc.nullsfirst",
        },
    ) or []

    log.info("Found %d active LMS integrations to sync.", len(configs))
    for row in configs:
        sync_config(master_db, master_settings, row)
    return len(configs)


def run_loop(master_db: SupabaseRestClient, master_settings: BaseSettings, poll_seconds: int) -> None:
    log.info(
        "Starting multi-tenant LMS Grades Master Worker (poll_interval=%ds).",
        poll_seconds,
    )
    while True:
        try:
            count = run_once(master_db, master_settings)
            log.info("Cycle complete — synced %d config(s). Sleeping %ds.", count, poll_seconds)
        except Exception as exc:  # noqa: BLE001
            log.exception("Exception in master worker loop: %s", exc)
        time.sleep(poll_seconds)


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
        count = run_once(master_db, master_settings)
        print(json.dumps({"synced_configs": count}))
        return 0

    run_loop(master_db, master_settings, poll_seconds)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
