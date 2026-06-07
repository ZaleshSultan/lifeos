#!/usr/bin/env python3
"""Sync official Moodle and personal ICS feeds into LifeOS."""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, time as datetime_time, timedelta, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common.lifeos_sync import (  # noqa: E402
    BaseSettings,
    SOURCE_LABELS,
    SupabaseRestClient,
    SyncError,
    SyncStats,
    getenv_int,
    iso_utc,
    load_base_settings,
    load_dotenv,
    stable_checksum,
    timezone_for,
)


@dataclass(frozen=True)
class Settings:
    base: BaseSettings
    moodle_url: str | None
    personal_url: str | None
    poll_seconds: int
    lookahead_days: int


def load_settings(env_file: Path | None = None) -> Settings:
    load_dotenv(Path(__file__).with_name(".env"))
    if env_file:
        load_dotenv(env_file)
    return Settings(
        base=load_base_settings(),
        moodle_url=os.environ.get("MOODLE_ICS_URL", "").strip() or None,
        personal_url=os.environ.get("PERSONAL_ICS_URL", "").strip() or None,
        poll_seconds=getenv_int("ICS_SYNC_POLL_SECONDS", 600),
        lookahead_days=getenv_int("ICS_SYNC_LOOKAHEAD_DAYS", 30),
    )


def fetch_ics(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "accept": "text/calendar, text/plain;q=0.9, */*;q=0.1",
            "cache-control": "no-cache",
            "user-agent": "LifeOS local ICS sync",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read()
    except urllib.error.URLError as exc:
        raise SyncError(f"ICS fetch failed: {exc.reason}") from exc


def decoded_datetime(component: Any, name: str, timezone_name: str) -> str | None:
    value = component.get(name)
    if value is None:
        return None
    decoded = value.dt
    if isinstance(decoded, datetime):
        if decoded.tzinfo is None:
            decoded = decoded.replace(tzinfo=timezone_for(timezone_name))
        return iso_utc(decoded)
    if isinstance(decoded, date):
        return iso_utc(datetime.combine(decoded, datetime_time.min, timezone_for(timezone_name)))
    return None


def text_property(component: Any, name: str) -> str | None:
    value = component.get(name)
    text = str(value).strip() if value is not None else ""
    return text or None


def parse_events(
    payload: bytes,
    source_key: str,
    timezone_name: str,
    lookahead_days: int,
) -> list[dict[str, Any]]:
    try:
        from icalendar import Calendar
    except ImportError as exc:
        raise SyncError("icalendar is missing; install requirements.txt") from exc
    calendar = Calendar.from_ical(payload)
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=lookahead_days)
    rows: list[dict[str, Any]] = []
    for component in calendar.walk("VEVENT"):
        starts_at = decoded_datetime(component, "DTSTART", timezone_name)
        ends_at = decoded_datetime(component, "DTEND", timezone_name)
        explicit_due_at = decoded_datetime(component, "DUE", timezone_name)
        due_at = explicit_due_at or (starts_at if source_key == "moodle_ics" else None)
        effective = due_at or starts_at or ends_at
        effective_dt = datetime.fromisoformat(effective.replace("Z", "+00:00")) if effective else None
        if effective_dt and (effective_dt < now - timedelta(days=1) or effective_dt > horizon):
            continue
        uid = text_property(component, "UID") or stable_checksum(
            [text_property(component, "SUMMARY"), starts_at, due_at]
        )
        raw = {
            "UID": uid,
            "SUMMARY": text_property(component, "SUMMARY"),
            "DESCRIPTION": text_property(component, "DESCRIPTION"),
            "DTSTART": starts_at,
            "DTEND": ends_at,
            "DUE": explicit_due_at,
            "URL": text_property(component, "URL"),
            "LOCATION": text_property(component, "LOCATION"),
        }
        rows.append(
            {
                "source_key": source_key,
                "external_id": uid,
                "event_type": "task" if due_at else "event",
                "title": raw["SUMMARY"] or "Untitled ICS event",
                "description": raw["DESCRIPTION"],
                "location": raw["LOCATION"],
                "starts_at": starts_at,
                "ends_at": ends_at,
                "due_at": due_at,
                "status": "cancelled" if text_property(component, "STATUS") == "CANCELLED" else "active",
                "source_url": raw["URL"],
                "external_updated_at": decoded_datetime(component, "LAST-MODIFIED", timezone_name),
                "checksum": stable_checksum(raw),
                "raw_json": raw,
            }
        )
    return rows


def sync_feed(
    client: SupabaseRestClient,
    settings: Settings,
    source_key: str,
    url: str,
    mode: str,
) -> SyncStats:
    source = client.ensure_source(source_key, "ics", SOURCE_LABELS[source_key])
    run_id = client.start_sync_run(source)
    stats = SyncStats()
    try:
        rows = parse_events(fetch_ics(url), source_key, settings.base.timezone_name, settings.lookahead_days)
        stats.seen = len(rows)
        seen: set[str] = set()
        for row in rows:
            seen.add(str(row["external_id"]))
            event, created, reminder_stats = client.upsert_event(row, mode)
            stats.created += int(created)
            stats.updated += int(not created)
            stats.reminders_created += reminder_stats.created
            stats.reminders_updated += reminder_stats.updated
            stats.reminders_cancelled += reminder_stats.cancelled
            if event.get("status") == "cancelled":
                stats.reminders_cancelled += client.cancel_future_reminders(str(event["id"]))
        stats.missing = client.mark_missing(source_key, seen)
        client.finish_sync_run(run_id, "success", stats)
        return stats
    except Exception as exc:
        client.finish_sync_run(run_id, "failed", stats, str(exc))
        raise


def sync_once(settings: Settings) -> dict[str, SyncStats]:
    feeds = {
        "moodle_ics": settings.moodle_url,
        "personal_ics": settings.personal_url,
    }
    if not any(feeds.values()):
        raise SyncError("Set MOODLE_ICS_URL and/or PERSONAL_ICS_URL")
    client = SupabaseRestClient(settings.base)
    mode = client.get_reminder_mode()
    return {
        source_key: sync_feed(client, settings, source_key, url, mode)
        for source_key, url in feeds.items()
        if url
    }


def status(settings: Settings) -> None:
    print("ICS sync status")
    print(f"Moodle ICS URL: {'configured' if settings.moodle_url else 'missing'}")
    print(f"Personal ICS URL: {'configured' if settings.personal_url else 'missing'}")
    client = SupabaseRestClient(settings.base)
    for row in client.source_status(["moodle_ics", "personal_ics"]):
        print(f"{row['source_key']}: {row['status']} last_sync={row.get('last_sync_at') or 'never'}")


def run_loop(settings: Settings) -> None:
    while True:
        try:
            logging.info("ics_sync complete stats=%s", sync_once(settings))
        except Exception as exc:  # noqa: BLE001
            logging.exception("ics_sync iteration failed: %s", exc)
        time.sleep(settings.poll_seconds)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="LifeOS Moodle/personal ICS sync")
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("command", choices=("status", "sync-once", "run-loop"))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        settings = load_settings(args.env_file)
        if args.command == "status":
            status(settings)
        elif args.command == "sync-once":
            print(json.dumps({key: vars(value) for key, value in sync_once(settings).items()}, indent=2))
        else:
            run_loop(settings)
        return 0
    except (SyncError, OSError, ValueError) as exc:
        logging.error("%s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
