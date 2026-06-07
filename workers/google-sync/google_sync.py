#!/usr/bin/env python3
"""Sync Google Calendar and Google Tasks into LifeOS."""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
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
    getenv_required,
    iso_utc,
    load_base_settings,
    load_dotenv,
    stable_checksum,
    timezone_for,
)


SCOPES_DEFAULT = (
    "https://www.googleapis.com/auth/calendar.readonly,"
    "https://www.googleapis.com/auth/tasks.readonly"
)


@dataclass(frozen=True)
class Settings:
    base: BaseSettings
    client_secrets_file: Path
    token_file: Path
    scopes: tuple[str, ...]
    lookahead_days: int
    poll_seconds: int
    calendar_ids: tuple[str, ...]
    tasklist_ids: tuple[str, ...]


def csv_env(name: str, default: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in os.environ.get(name, default).split(",") if item.strip())


def load_settings(env_file: Path | None = None) -> Settings:
    load_dotenv(Path(__file__).with_name(".env"))
    if env_file:
        load_dotenv(env_file)
    return Settings(
        base=load_base_settings(),
        client_secrets_file=Path(getenv_required("GOOGLE_CLIENT_SECRETS_FILE")).expanduser(),
        token_file=Path(getenv_required("GOOGLE_TOKEN_FILE")).expanduser(),
        scopes=csv_env("GOOGLE_SCOPES", SCOPES_DEFAULT),
        lookahead_days=getenv_int("GOOGLE_SYNC_LOOKAHEAD_DAYS", 14),
        poll_seconds=getenv_int("GOOGLE_SYNC_POLL_SECONDS", 300),
        calendar_ids=csv_env("GOOGLE_SYNC_CALENDAR_IDS", "primary"),
        tasklist_ids=csv_env("GOOGLE_SYNC_TASKLIST_IDS", "@default"),
    )


def google_imports() -> tuple[Any, Any, Any]:
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError as exc:
        raise SyncError("Google dependencies are missing; install requirements.txt") from exc
    return Request, Credentials, InstalledAppFlow


def authenticate(settings: Settings) -> None:
    _request, _credentials, installed_app_flow = google_imports()
    if not settings.client_secrets_file.exists():
        raise SyncError(f"Missing Google OAuth client file: {settings.client_secrets_file}")
    settings.token_file.parent.mkdir(parents=True, exist_ok=True)
    flow = installed_app_flow.from_client_secrets_file(
        str(settings.client_secrets_file), scopes=list(settings.scopes)
    )
    credentials = flow.run_local_server(host="127.0.0.1", port=8765, open_browser=False)
    settings.token_file.write_text(credentials.to_json(), encoding="utf-8")
    settings.token_file.chmod(0o600)
    print(f"Google OAuth token written to {settings.token_file}")


def credentials(settings: Settings) -> Any:
    request_type, credentials_type, _installed_app_flow = google_imports()
    if not settings.token_file.exists():
        raise SyncError("Missing Google token.json; run: python google_sync.py auth")
    creds = credentials_type.from_authorized_user_file(str(settings.token_file), list(settings.scopes))
    if creds.expired and creds.refresh_token:
        creds.refresh(request_type())
        settings.token_file.write_text(creds.to_json(), encoding="utf-8")
        settings.token_file.chmod(0o600)
    if not creds.valid:
        raise SyncError("Google OAuth token is invalid; run auth again")
    return creds


def google_services(settings: Settings) -> tuple[Any, Any]:
    try:
        from googleapiclient.discovery import build
    except ImportError as exc:
        raise SyncError("google-api-python-client is missing; install requirements.txt") from exc
    creds = credentials(settings)
    return (
        build("calendar", "v3", credentials=creds, cache_discovery=False),
        build("tasks", "v1", credentials=creds, cache_discovery=False),
    )


def google_datetime(value: dict[str, str] | None, timezone_name: str) -> str | None:
    value = value or {}
    if value.get("dateTime"):
        raw = value["dateTime"].replace("Z", "+00:00")
        parsed = datetime.fromisoformat(raw)
        return iso_utc(parsed)
    if value.get("date"):
        day = date.fromisoformat(value["date"])
        parsed = datetime.combine(day, datetime_time.min, timezone_for(timezone_name))
        return iso_utc(parsed)
    return None


def task_due_at(value: str | None, timezone_name: str) -> str | None:
    if not value:
        return None
    day = date.fromisoformat(value[:10])
    # Google Tasks due values are date-only in practice. LifeOS uses local 18:00
    # as the deadline anchor so same-day policy reminders remain useful.
    parsed = datetime.combine(day, datetime_time(18, 0), timezone_for(timezone_name))
    return iso_utc(parsed)


def fetch_calendar_events(service: Any, settings: Settings) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=settings.lookahead_days)
    result: list[dict[str, Any]] = []
    for calendar_id in settings.calendar_ids:
        page_token = None
        while True:
            response = service.events().list(
                calendarId=calendar_id,
                timeMin=iso_utc(now),
                timeMax=iso_utc(horizon),
                singleEvents=True,
                orderBy="startTime",
                showDeleted=True,
                pageToken=page_token,
            ).execute()
            for event in response.get("items", []):
                event["_lifeos_calendar_id"] = calendar_id
                result.append(event)
            page_token = response.get("nextPageToken")
            if not page_token:
                break
    return result


def fetch_tasks(service: Any, settings: Settings) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for tasklist_id in settings.tasklist_ids:
        page_token = None
        while True:
            response = service.tasks().list(
                tasklist=tasklist_id,
                showCompleted=True,
                showHidden=True,
                maxResults=100,
                pageToken=page_token,
            ).execute()
            for task in response.get("items", []):
                task["_lifeos_tasklist_id"] = tasklist_id
                result.append(task)
            page_token = response.get("nextPageToken")
            if not page_token:
                break
    return result


def normalize_calendar_event(event: dict[str, Any], timezone_name: str) -> dict[str, Any]:
    calendar_id = str(event.get("_lifeos_calendar_id") or "primary")
    starts_at = google_datetime(event.get("start"), timezone_name)
    return {
        "source_key": "google_calendar",
        "external_id": f"{calendar_id}:{event['id']}",
        "event_type": "event",
        "title": event.get("summary") or "Untitled calendar event",
        "description": event.get("description"),
        "location": event.get("location"),
        "starts_at": starts_at,
        "ends_at": google_datetime(event.get("end"), timezone_name),
        "due_at": None,
        "status": "cancelled" if event.get("status") == "cancelled" else "active",
        "source_url": event.get("htmlLink"),
        "external_updated_at": event.get("updated"),
        "checksum": event.get("etag") or stable_checksum(event),
        "raw_json": event,
    }


def normalize_task(task: dict[str, Any], timezone_name: str) -> dict[str, Any]:
    tasklist_id = str(task.get("_lifeos_tasklist_id") or "@default")
    due_at = task_due_at(task.get("due"), timezone_name)
    status = "done" if task.get("status") == "completed" else "active"
    return {
        "source_key": "google_tasks",
        "external_id": f"{tasklist_id}:{task['id']}",
        "event_type": "task",
        "title": task.get("title") or "Untitled Google task",
        "description": task.get("notes"),
        "location": None,
        "starts_at": None,
        "ends_at": None,
        "due_at": due_at,
        "status": status,
        "source_url": task.get("webViewLink"),
        "external_updated_at": task.get("updated"),
        "checksum": task.get("etag") or stable_checksum(task),
        "raw_json": {**task, "lifeos_date_only_due": bool(task.get("due"))},
    }


def sync_source(
    client: SupabaseRestClient,
    source_key: str,
    source_type: str,
    rows: list[dict[str, Any]],
    mode: str,
) -> SyncStats:
    source = client.ensure_source(source_key, source_type, SOURCE_LABELS[source_key])
    run_id = client.start_sync_run(source)
    stats = SyncStats(seen=len(rows))
    try:
        seen: set[str] = set()
        for row in rows:
            seen.add(str(row["external_id"]))
            event, created = client.upsert_event(row, mode)
            stats.created += int(created)
            stats.updated += int(not created)
            if event.get("status") in {"done", "cancelled"}:
                client.cancel_future_reminders(str(event["id"]))
        stats.missing = client.mark_missing(source_key, seen)
        client.finish_sync_run(run_id, "success", stats)
        return stats
    except Exception as exc:
        client.finish_sync_run(run_id, "failed", stats, str(exc))
        raise


def sync_once(settings: Settings) -> dict[str, SyncStats]:
    calendar_service, tasks_service = google_services(settings)
    client = SupabaseRestClient(settings.base)
    mode = client.get_reminder_mode()
    calendars = [
        normalize_calendar_event(item, settings.base.timezone_name)
        for item in fetch_calendar_events(calendar_service, settings)
        if item.get("id")
    ]
    tasks = [
        normalize_task(item, settings.base.timezone_name)
        for item in fetch_tasks(tasks_service, settings)
        if item.get("id")
    ]
    return {
        "google_calendar": sync_source(client, "google_calendar", "google", calendars, mode),
        "google_tasks": sync_source(client, "google_tasks", "google", tasks, mode),
    }


def status(settings: Settings) -> None:
    print("Google sync status")
    print(f"OAuth client: {'present' if settings.client_secrets_file.exists() else 'missing'}")
    print(f"OAuth token: {'present' if settings.token_file.exists() else 'missing'}")
    client = SupabaseRestClient(settings.base)
    for row in client.source_status(["google_calendar", "google_tasks"]):
        print(f"{row['source_key']}: {row['status']} last_sync={row.get('last_sync_at') or 'never'}")


def run_loop(settings: Settings) -> None:
    while True:
        try:
            results = sync_once(settings)
            logging.info("google_sync complete stats=%s", results)
        except Exception as exc:  # noqa: BLE001
            logging.exception("google_sync iteration failed: %s", exc)
        time.sleep(settings.poll_seconds)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="LifeOS Google Calendar/Tasks sync")
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("command", choices=("auth", "status", "sync-once", "run-loop"))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        settings = load_settings(args.env_file)
        if args.command == "auth":
            authenticate(settings)
        elif args.command == "status":
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

