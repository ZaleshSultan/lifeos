#!/usr/bin/env python3
"""Shared Supabase normalization and reminder policy support for local sync workers."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


JsonObject = dict[str, Any]
REQUEST_TIMEOUT_SECONDS = 30
REMINDER_MODES = {"chill", "normal", "duolingo", "war"}
HIGH_PRIORITY_KEYWORDS = (
    "exam",
    "final",
    "midterm",
    "deadline",
    "due",
    "assignment",
    "quiz",
    "test",
    "resit",
    "экзамен",
    "файнал",
    "дедлайн",
    "задание",
    "пересдача",
    "летник",
)
SOURCE_LABELS = {
    "google_calendar": "Google Calendar",
    "google_tasks": "Google Tasks",
    "moodle_ics": "Moodle ICS",
    "personal_ics": "Personal ICS",
    "manual": "Manual",
}
EVENT_OFFSETS = {
    "chill": (60, 15),
    "normal": (24 * 60, 3 * 60, 60, 15),
    "duolingo": (24 * 60, 6 * 60, 3 * 60, 60, 15),
    "war": (24 * 60, 12 * 60, 6 * 60, 3 * 60, 60, 30, 15),
}
TASK_OFFSETS = {
    "chill": (3 * 60, 30),
    "normal": (3 * 60, 30),
    "duolingo": (3 * 60, 30),
    "war": (24 * 60, 12 * 60, 6 * 60, 3 * 60, 60, 30, 15),
}
TASK_FIXED_TIMES = {
    "chill": (),
    "normal": ("09:00",),
    "duolingo": ("09:00", "12:00", "18:00"),
    "war": (),
}


class SyncError(RuntimeError):
    """Expected sync error safe to log without credentials."""


@dataclass(frozen=True)
class BaseSettings:
    supabase_url: str
    service_role_key: str
    user_id: str
    timezone_name: str


@dataclass
class SyncStats:
    seen: int = 0
    created: int = 0
    updated: int = 0
    missing: int = 0
    reminders_created: int = 0
    reminders_updated: int = 0
    reminders_cancelled: int = 0


@dataclass
class ReminderSyncStats:
    created: int = 0
    updated: int = 0
    cancelled: int = 0


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def getenv_required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SyncError(f"Missing required environment variable: {name}")
    return value


def getenv_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise SyncError(f"{name} must be an integer") from exc
    if value <= 0:
        raise SyncError(f"{name} must be greater than zero")
    return value


def getenv_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def require_legacy_single_user_mode(worker_name: str, env_name: str) -> None:
    if getenv_bool(env_name):
        return
    raise SyncError(
        f"{worker_name} is still legacy single-user mode; set {env_name}=true "
        "only for local/dev or explicitly accepted single-user deployments. "
        "Per-user source ownership is not implemented yet."
    )


def load_base_settings(
    env_file: Path | None = None,
    legacy_guard_env: str | None = None,
    worker_name: str = "sync worker",
) -> BaseSettings:
    if env_file:
        load_dotenv(env_file)
    if legacy_guard_env:
        require_legacy_single_user_mode(worker_name, legacy_guard_env)
    return BaseSettings(
        supabase_url=getenv_required("SUPABASE_URL").rstrip("/"),
        service_role_key=getenv_required("SUPABASE_SERVICE_ROLE_KEY"),
        user_id=getenv_required("LIFEOS_DEFAULT_USER_ID"),
        timezone_name=os.environ.get("APP_TIMEZONE", "Asia/Qyzylorda").strip()
        or "Asia/Qyzylorda",
    )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def timezone_for(name: str) -> tzinfo:
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        if name == "Asia/Qyzylorda":
            return timezone(timedelta(hours=5))
        return timezone.utc


def iso_utc(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def local_date_time(day: date, hhmm: str, timezone_name: str) -> datetime:
    hour, minute = (int(part) for part in hhmm.split(":", 1))
    return datetime.combine(day, time(hour, minute), timezone_for(timezone_name))


def stable_checksum(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def is_high_priority(title: str | None, description: str | None = None) -> bool:
    text = f"{title or ''} {description or ''}".casefold()
    return any(keyword.casefold() in text for keyword in HIGH_PRIORITY_KEYWORDS)


def reminder_mode(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in REMINDER_MODES else "normal"


def effective_reminder_mode(mode: str, high_priority: bool) -> str:
    mode = reminder_mode(mode)
    if not high_priority:
        return mode
    return {
        "chill": "normal",
        "normal": "duolingo",
        "duolingo": "war",
        "war": "war",
    }[mode]


def in_quiet_hours(value: datetime, start: str, end: str, timezone_name: str) -> bool:
    local = value.astimezone(timezone_for(timezone_name))
    current = local.time().replace(tzinfo=None)
    start_time = time.fromisoformat(start)
    end_time = time.fromisoformat(end)
    if start_time < end_time:
        return start_time <= current < end_time
    return current >= start_time or current < end_time


def shift_out_of_quiet_hours(
    reminder_at: datetime,
    event_at: datetime,
    timezone_name: str,
    start: str = "23:00",
    end: str = "08:00",
) -> datetime:
    if event_at - reminder_at <= timedelta(hours=1):
        return reminder_at
    if not in_quiet_hours(reminder_at, start, end, timezone_name):
        return reminder_at
    local = reminder_at.astimezone(timezone_for(timezone_name))
    end_time = time.fromisoformat(end)
    target_day = local.date()
    if local.time().replace(tzinfo=None) >= time.fromisoformat(start):
        target_day += timedelta(days=1)
    shifted = datetime.combine(target_day, end_time, local.tzinfo)
    return shifted.astimezone(timezone.utc)


def reminder_policy_keys(
    event_type: str,
    mode: str,
    high_priority: bool,
) -> list[str]:
    mode = effective_reminder_mode(mode, high_priority)
    if mode == "war" and not high_priority:
        return []
    offsets = TASK_OFFSETS[mode] if event_type == "task" else EVENT_OFFSETS[mode]
    keys = [f"before_{minutes}m" for minutes in offsets]
    if event_type == "task":
        keys.extend(f"at_{value.replace(':', '')}" for value in TASK_FIXED_TIMES[mode])
    return keys


def build_reminder_schedule(
    event: JsonObject,
    mode: str,
    timezone_name: str,
    now: datetime | None = None,
    quiet_start: str = "23:00",
    quiet_end: str = "08:00",
) -> list[JsonObject]:
    now = now or datetime.now(timezone.utc)
    event_type = str(event.get("event_type") or "event")
    target = parse_datetime(str(event.get("due_at") or event.get("starts_at") or ""))
    high_priority = is_high_priority(
        str(event.get("title") or ""), str(event.get("description") or "")
    )
    if not target or str(event.get("status") or "active") != "active":
        return []
    mode = effective_reminder_mode(mode, high_priority)
    if mode == "war" and not high_priority:
        return []

    source_key = str(event.get("source_key") or "manual")
    title = str(event.get("title") or "LifeOS reminder").strip()
    schedule: list[JsonObject] = []
    offsets = TASK_OFFSETS[mode] if event_type == "task" else EVENT_OFFSETS[mode]
    for minutes in offsets:
        remind_at = target - timedelta(minutes=minutes)
        policy_key = f"before_{minutes}m"
        if mode in {"duolingo", "war"}:
            remind_at = shift_out_of_quiet_hours(
                remind_at, target, timezone_name, quiet_start, quiet_end
            )
        if remind_at > now:
            schedule.append(
                _reminder_row(event, source_key, title, mode, policy_key, remind_at, target, high_priority)
            )

    if event_type == "task":
        local_day = target.astimezone(timezone_for(timezone_name)).date()
        for hhmm in TASK_FIXED_TIMES[mode]:
            remind_at = local_date_time(local_day, hhmm, timezone_name).astimezone(timezone.utc)
            policy_key = f"at_{hhmm.replace(':', '')}"
            if remind_at > now and remind_at <= target:
                schedule.append(
                    _reminder_row(event, source_key, title, mode, policy_key, remind_at, target, high_priority)
                )
    return schedule


def _reminder_row(
    event: JsonObject,
    source_key: str,
    title: str,
    mode: str,
    policy_key: str,
    remind_at: datetime,
    target: datetime,
    high_priority: bool,
) -> JsonObject:
    external_id = str(event.get("external_id") or event.get("id") or title)
    dedup_key = f"{source_key}:{external_id}:{policy_key}"
    notification_kind = "deadline" if high_priority else "reminder"
    return {
        "dedup_key": dedup_key,
        "reminder_policy_key": policy_key,
        "remind_at": iso_utc(remind_at),
        "message": title,
        "metadata_json": {
            "source": source_key,
            "source_label": SOURCE_LABELS.get(source_key, source_key),
            "provider": source_key,
            "external_id": external_id,
            "title": title,
            "event_at": iso_utc(target),
            "priority": "high" if high_priority else "normal",
            "notification_kind": notification_kind,
            "reminder_mode": mode,
            "reminder_policy_key": policy_key,
            "dedup_key": dedup_key,
        },
    }


class SupabaseRestClient:
    def __init__(self, settings: BaseSettings) -> None:
        self.settings = settings
        self.base_url = f"{settings.supabase_url}/rest/v1"
        self.headers = {
            "apikey": settings.service_role_key,
            "authorization": f"Bearer {settings.service_role_key}",
            "content-type": "application/json",
            "accept": "application/json",
        }

    def request(
        self,
        method: str,
        table: str,
        query: dict[str, str] | None = None,
        body: Any | None = None,
        prefer: str | None = None,
    ) -> Any:
        encoded = urllib.parse.urlencode(query or {})
        url = f"{self.base_url}/{table}" + (f"?{encoded}" if encoded else "")
        headers = dict(self.headers)
        if prefer:
            headers["prefer"] = prefer
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise SyncError(f"Supabase {method} {table} failed: {exc.code} {detail}") from exc
        except urllib.error.URLError as exc:
            raise SyncError(f"Supabase {method} {table} failed: {exc.reason}") from exc
        return json.loads(raw) if raw else None

    def ensure_source(self, source_key: str, source_type: str, display_name: str) -> JsonObject:
        now = utc_now()
        rows = self.request(
            "POST",
            "external_sources",
            {"on_conflict": "user_id,source_key", "select": "*"},
            {
                "user_id": self.settings.user_id,
                "source_key": source_key,
                "source_type": source_type,
                "display_name": display_name,
                "status": "connected",
                "last_sync_at": now,
                "config_json": {"runtime": "local-worker"},
            },
            "resolution=merge-duplicates,return=representation",
        )
        return rows[0]

    def start_sync_run(self, source: JsonObject) -> str:
        rows = self.request(
            "POST",
            "sync_runs",
            {"select": "id"},
            {
                "user_id": self.settings.user_id,
                "source_id": source["id"],
                "source_key": source["source_key"],
                "status": "running",
            },
            "return=representation",
        )
        return str(rows[0]["id"])

    def finish_sync_run(
        self, run_id: str, status: str, stats: SyncStats, error: str | None = None
    ) -> None:
        self.request(
            "PATCH",
            "sync_runs",
            {"id": f"eq.{run_id}"},
            {
                "status": status,
                "finished_at": utc_now(),
                "records_seen": stats.seen,
                "records_created": stats.created,
                "records_updated": stats.updated,
                "error_message": error[:2000] if error else None,
                "metadata_json": {
                    "missing": stats.missing,
                    "reminders_created": stats.reminders_created,
                    "reminders_updated": stats.reminders_updated,
                    "reminders_cancelled": stats.reminders_cancelled,
                },
            },
        )

    def get_reminder_mode(self) -> str:
        rows = self.request(
            "GET",
            "user_settings",
            {"select": "settings", "user_id": f"eq.{self.settings.user_id}", "limit": "1"},
        )
        settings = rows[0].get("settings") if rows else {}
        return reminder_mode(settings.get("reminder_mode") if isinstance(settings, dict) else None)

    def upsert_event(
        self, event: JsonObject, mode: str
    ) -> tuple[JsonObject, bool, ReminderSyncStats]:
        source_key = str(event["source_key"])
        external_id = str(event["external_id"])
        existing = self.request(
            "GET",
            "source_events",
            {
                "select": "id,normalized_entity_id,checksum",
                "user_id": f"eq.{self.settings.user_id}",
                "source_key": f"eq.{source_key}",
                "external_id": f"eq.{external_id}",
                "limit": "1",
            },
        )
        row = {
            "user_id": self.settings.user_id,
            "source_key": source_key,
            "provider": source_key,
            "external_id": external_id,
            "event_type": event.get("event_type") or "event",
            "title": event.get("title"),
            "description": event.get("description"),
            "location": event.get("location"),
            "starts_at": event.get("starts_at"),
            "ends_at": event.get("ends_at"),
            "due_at": event.get("due_at"),
            "status": event.get("status") or "active",
            "raw_json": event.get("raw_json") or {},
            "external_updated_at": event.get("external_updated_at"),
            "source_url": event.get("source_url"),
            "reminder_policy_key": mode,
            "checksum": event.get("checksum") or stable_checksum(event),
            "last_synced_at": utc_now(),
            "normalized_entity_id": existing[0].get("normalized_entity_id") if existing else None,
        }
        rows = self.request(
            "POST",
            "source_events",
            {"on_conflict": "user_id,source_key,external_id", "select": "*"},
            row,
            "resolution=merge-duplicates,return=representation",
        )
        synced = rows[0]
        self._sync_life_entity(synced)
        reminder_stats = self._sync_reminders(synced, mode)
        return synced, not bool(existing), reminder_stats

    def _sync_life_entity(self, event: JsonObject) -> None:
        event_id = str(event["id"])
        entity_id = event.get("normalized_entity_id")
        high_priority = is_high_priority(event.get("title"), event.get("description"))
        payload = {
            "user_id": self.settings.user_id,
            "entity_type": "deadline" if high_priority else "external_event",
            "domain": "study" if high_priority else "personal",
            "status": event.get("status") or "active",
            "title": event.get("title") or "Untitled source event",
            "description": event.get("description"),
            "body": event.get("description"),
            "due_at": event.get("due_at") or event.get("starts_at"),
            "source": event.get("source_key") or "source_event",
            "source_command": "local_sync_worker",
            "linked_table": "source_events",
            "linked_id": event_id,
            "metadata": {
                "sourceKey": event.get("source_key"),
                "externalId": event.get("external_id"),
                "priority": "high" if high_priority else "normal",
                "sourceUrl": event.get("source_url"),
            },
            "raw_payload_json": event.get("raw_json") or {},
        }
        if entity_id:
            self.request("PATCH", "life_entities", {"id": f"eq.{entity_id}"}, payload)
            return
        rows = self.request(
            "POST", "life_entities", {"select": "id"}, payload, "return=representation"
        )
        self.request(
            "PATCH",
            "source_events",
            {"id": f"eq.{event_id}"},
            {"normalized_entity_id": rows[0]["id"]},
        )
        event["normalized_entity_id"] = rows[0]["id"]

    def _sync_reminders(self, event: JsonObject, mode: str) -> ReminderSyncStats:
        event_id = str(event["id"])
        desired = build_reminder_schedule(event, mode, self.settings.timezone_name)
        desired_keys = {str(item["dedup_key"]) for item in desired}
        stats = ReminderSyncStats()
        existing = self.request(
            "GET",
            "reminders",
            {
                "select": "*",
                "user_id": f"eq.{self.settings.user_id}",
                "source_event_id": f"eq.{event_id}",
                "status": "eq.pending",
            },
        ) or []
        for reminder in existing:
            if reminder.get("dedup_key") not in desired_keys:
                self.request(
                    "PATCH",
                    "reminders",
                    {"id": f"eq.{reminder['id']}", "status": "eq.pending"},
                    {"status": "cancelled"},
                )
                stats.cancelled += 1
        for item in desired:
            rows = self.request(
                "GET",
                "reminders",
                {
                    "select": "*",
                    "user_id": f"eq.{self.settings.user_id}",
                    "dedup_key": f"eq.{item['dedup_key']}",
                    "limit": "1",
                },
            )
            payload = {
                **item,
                "user_id": self.settings.user_id,
                "life_entity_id": event.get("normalized_entity_id"),
                "source_event_id": event_id,
                "channel": "telegram",
            }
            if rows:
                if rows[0].get("status") == "pending" and self._reminder_changed(
                    rows[0], payload
                ):
                    self.request("PATCH", "reminders", {"id": f"eq.{rows[0]['id']}"}, payload)
                    stats.updated += 1
            else:
                self.request("POST", "reminders", body=payload)
                stats.created += 1
        if stats.created or stats.updated or stats.cancelled:
            logging.info(
                "reminder sync source=%s external_id=%s created=%d updated=%d cancelled=%d",
                event.get("source_key"),
                event.get("external_id"),
                stats.created,
                stats.updated,
                stats.cancelled,
            )
        return stats

    @staticmethod
    def _reminder_changed(existing: JsonObject, desired: JsonObject) -> bool:
        return any(existing.get(key) != value for key, value in desired.items())

    def mark_missing(self, source_key: str, seen_external_ids: set[str]) -> int:
        rows = self.request(
            "GET",
            "source_events",
            {
                "select": "id,external_id,status",
                "user_id": f"eq.{self.settings.user_id}",
                "source_key": f"eq.{source_key}",
                "status": "eq.active",
            },
        ) or []
        missing = [row for row in rows if row.get("external_id") not in seen_external_ids]
        for row in missing:
            self.request(
                "PATCH",
                "source_events",
                {"id": f"eq.{row['id']}"},
                {"status": "missing", "last_synced_at": utc_now()},
            )
            self.cancel_future_reminders(str(row["id"]))
        return len(missing)

    def cancel_future_reminders(self, source_event_id: str) -> int:
        rows = self.request(
            "PATCH",
            "reminders",
            {
                "source_event_id": f"eq.{source_event_id}",
                "status": "eq.pending",
                "remind_at": f"gte.{utc_now()}",
            },
            {"status": "cancelled"},
            "return=representation",
        )
        cancelled = len(rows or [])
        if cancelled:
            logging.info(
                "reminder sync source_event_id=%s cancelled=%d",
                source_event_id,
                cancelled,
            )
        return cancelled

    def source_status(self, source_keys: list[str]) -> list[JsonObject]:
        return self.request(
            "GET",
            "external_sources",
            {
                "select": "source_key,status,last_sync_at",
                "user_id": f"eq.{self.settings.user_id}",
                "source_key": f"in.({','.join(source_keys)})",
                "order": "source_key.asc",
            },
        ) or []
