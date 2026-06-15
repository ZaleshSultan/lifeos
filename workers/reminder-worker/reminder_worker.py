#!/usr/bin/env python3
"""Send pending LifeOS reminders to Telegram."""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, time as datetime_time, timedelta, timezone
from pathlib import Path
from typing import Any, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


JsonObject = dict[str, Any]

LOCAL_TIMEZONE = "Asia/Qyzylorda"
MAX_SEND_ATTEMPTS = 3
REQUEST_TIMEOUT_SECONDS = 30


class WorkerError(RuntimeError):
    """Expected worker failure that can be logged without leaking secrets."""


class SupabaseClientProtocol(Protocol):
    def list_due_reminders(self, before: str, limit: int) -> list[JsonObject]: ...

    def claim_reminder(self, reminder_id: str) -> JsonObject | None: ...

    def resolve_reminder_recipient(self, reminder: JsonObject) -> str | None: ...

    def mark_reminder_sent(self, reminder_id: str) -> JsonObject | None: ...

    def record_send_failure(self, reminder: JsonObject, error: str) -> JsonObject | None: ...

    def fetch_reminder_context(self, reminder: JsonObject) -> JsonObject: ...

    def defer_reminder(self, reminder_id: str, remind_at: str) -> JsonObject | None: ...

    def release_stale_claims(self, before: str) -> None: ...


class TelegramClientProtocol(Protocol):
    def send_message(self, chat_id: str, text: str) -> None: ...


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    service_role_key: str
    telegram_bot_token: str
    poll_seconds: int
    batch_size: int
    test_telegram_user_id: str | None = None
    local_timezone: str = LOCAL_TIMEZONE
    quiet_hours_start: str = "23:00"
    quiet_hours_end: str = "08:00"
    claim_timeout_minutes: int = 5


@dataclass
class ProcessSummary:
    processed: int = 0
    sent: int = 0
    send_failed: int = 0
    mark_failed: int = 0


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


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
        raise WorkerError(f"Missing required environment variable: {name}")

    return value


def getenv_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()

    if not raw:
        return default

    try:
        value = int(raw)
    except ValueError as exc:
        raise WorkerError(f"{name} must be an integer") from exc

    if value <= 0:
        raise WorkerError(f"{name} must be greater than zero")

    return value


def load_settings(env_file: Path | None = None) -> Settings:
    load_dotenv(Path(__file__).with_name(".env"))

    if env_file is not None:
        load_dotenv(env_file)

    return Settings(
        supabase_url=getenv_required("SUPABASE_URL").rstrip("/"),
        service_role_key=getenv_required("SUPABASE_SERVICE_ROLE_KEY"),
        telegram_bot_token=getenv_required("TELEGRAM_BOT_TOKEN"),
        poll_seconds=getenv_int("REMINDER_WORKER_POLL_SECONDS", 30),
        batch_size=getenv_int("REMINDER_WORKER_BATCH_SIZE", 20),
        test_telegram_user_id=os.environ.get(
            "REMINDER_WORKER_TEST_TELEGRAM_USER_ID", ""
        ).strip()
        or None,
        local_timezone=os.environ.get("APP_TIMEZONE", LOCAL_TIMEZONE).strip()
        or LOCAL_TIMEZONE,
        quiet_hours_start=os.environ.get(
            "DUOLINGO_NUDGE_QUIET_HOURS_START", "23:00"
        ).strip()
        or "23:00",
        quiet_hours_end=os.environ.get(
            "DUOLINGO_NUDGE_QUIET_HOURS_END", "08:00"
        ).strip()
        or "08:00",
        claim_timeout_minutes=getenv_int("REMINDER_WORKER_CLAIM_TIMEOUT_MINUTES", 5),
    )


def parse_datetime(value: str) -> datetime:
    normalized = value.strip()

    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"

    parsed = datetime.fromisoformat(normalized)

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed


def resolve_timezone(timezone_name: str):
    try:
        return ZoneInfo(timezone_name), timezone_name
    except ZoneInfoNotFoundError:
        if timezone_name == "Asia/Qyzylorda":
            return timezone(timedelta(hours=5)), timezone_name
        return timezone.utc, "UTC"


def local_time_label(value: str, timezone_name: str = LOCAL_TIMEZONE) -> str:
    tz, label = resolve_timezone(timezone_name)

    try:
        local = parse_datetime(value).astimezone(tz)
    except ValueError:
        return value

    return f"{local:%Y-%m-%d %H:%M} ({label})"


def truncate_error(error: object) -> str:
    text = str(error).strip() or error.__class__.__name__
    return text[:2000]


def metadata_with_send_failure(
    reminder: JsonObject,
    error: str,
    failed_at: str,
) -> tuple[JsonObject, int, str]:
    metadata = reminder.get("metadata_json")

    if not isinstance(metadata, dict):
        metadata = {}
    else:
        metadata = dict(metadata)

    worker_metadata = metadata.get("reminder_worker")

    if not isinstance(worker_metadata, dict):
        worker_metadata = {}
    else:
        worker_metadata = dict(worker_metadata)

    try:
        attempts = int(worker_metadata.get("attempts") or 0) + 1
    except (TypeError, ValueError):
        attempts = 1

    worker_metadata.update(
        {
            "attempts": attempts,
            "last_error": error,
            "last_failed_at": failed_at,
        }
    )
    metadata["reminder_worker"] = worker_metadata
    status = "failed" if attempts >= MAX_SEND_ATTEMPTS else "pending"

    return metadata, attempts, status


class SupabaseRestClient:
    def __init__(self, url: str, service_role_key: str) -> None:
        self.base_url = f"{url.rstrip('/')}/rest/v1"
        self.headers = {
            "apikey": service_role_key,
            "authorization": f"Bearer {service_role_key}",
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
        encoded_query = urllib.parse.urlencode(query or {})
        url = f"{self.base_url}/{table}"

        if encoded_query:
            url = f"{url}?{encoded_query}"

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
            raise WorkerError(f"Supabase {method} {table} failed: {exc.code} {detail}") from exc
        except urllib.error.URLError as exc:
            raise WorkerError(f"Supabase {method} {table} failed: {exc.reason}") from exc

        if not raw:
            return None

        return json.loads(raw)

    def list_due_reminders(self, before: str, limit: int) -> list[JsonObject]:
        rows = self.request(
            "GET",
            "reminders",
            {
                "select": "*",
                "status": "eq.pending",
                "channel": "eq.telegram",
                "remind_at": f"lte.{before}",
                "order": "remind_at.asc",
                "limit": str(limit),
            },
        )
        return rows or []

    def list_next_pending_reminders(self, limit: int) -> list[JsonObject]:
        rows = self.request(
            "GET",
            "reminders",
            {
                "select": "id,message,remind_at,status,channel",
                "status": "eq.pending",
                "channel": "eq.telegram",
                "order": "remind_at.asc",
                "limit": str(limit),
            },
        )
        return rows or []

    def claim_reminder(self, reminder_id: str) -> JsonObject | None:
        rows = self.request(
            "PATCH",
            "reminders",
            {
                "id": f"eq.{reminder_id}",
                "status": "eq.pending",
                "select": "*",
            },
            {
                "status": "processing",
                "claimed_at": utc_now(),
            },
            prefer="return=representation",
        )
        return rows[0] if rows else None

    def resolve_reminder_recipient(self, reminder: JsonObject) -> str | None:
        user_id = str(reminder.get("user_id") or "").strip()

        if not user_id:
            raise WorkerError("Cannot resolve reminder recipient without user_id")

        rows = self.request(
            "GET",
            "profiles",
            {
                "select": "telegram_user_id",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "limit": "1",
            },
        )

        if not rows:
            return None

        telegram_user_id = rows[0].get("telegram_user_id")

        if telegram_user_id is None or str(telegram_user_id).strip() == "":
            return None

        return str(telegram_user_id)

    def mark_reminder_sent(self, reminder_id: str) -> JsonObject | None:
        now = utc_now()
        rows = self.request(
            "PATCH",
            "reminders",
            {
                "id": f"eq.{reminder_id}",
                "status": "eq.processing",
                "select": "*",
            },
            {
                "status": "sent",
                "sent_at": now,
                "claimed_at": None,
                "updated_at": now,
            },
            prefer="return=representation",
        )

        return rows[0] if rows else None

    def record_send_failure(self, reminder: JsonObject, error: str) -> JsonObject | None:
        reminder_id = str(reminder.get("id") or "")

        if not reminder_id:
            raise WorkerError("Cannot record send failure without reminder id")

        now = utc_now()
        metadata, attempts, status = metadata_with_send_failure(reminder, error, now)
        rows = self.request(
            "PATCH",
            "reminders",
            {
                "id": f"eq.{reminder_id}",
                "status": "eq.processing",
                "select": "*",
            },
            {
                "status": status,
                "metadata_json": metadata,
                "claimed_at": None,
                "updated_at": now,
            },
            prefer="return=representation",
        )

        if rows:
            rows[0]["_reminder_worker_attempts"] = attempts

        return rows[0] if rows else None

    def defer_reminder(self, reminder_id: str, remind_at: str) -> JsonObject | None:
        rows = self.request(
            "PATCH",
            "reminders",
            {
                "id": f"eq.{reminder_id}",
                "status": "eq.processing",
                "select": "*",
            },
            {
                "status": "pending",
                "remind_at": remind_at,
                "claimed_at": None,
                "updated_at": utc_now(),
            },
            prefer="return=representation",
        )
        return rows[0] if rows else None

    def release_stale_claims(self, before: str) -> None:
        self.request(
            "PATCH",
            "reminders",
            {
                "status": "eq.processing",
                "claimed_at": f"lt.{before}",
            },
            {
                "status": "pending",
                "claimed_at": None,
                "updated_at": utc_now(),
            },
        )

    def fetch_one(self, table: str, row_id: str, select: str) -> JsonObject | None:
        rows = self.request(
            "GET",
            table,
            {
                "select": select,
                "id": f"eq.{row_id}",
                "limit": "1",
            },
        )

        return rows[0] if rows else None

    def fetch_reminder_context(self, reminder: JsonObject) -> JsonObject:
        context: JsonObject = {}
        life_entity_id = reminder.get("life_entity_id")
        source_event_id = reminder.get("source_event_id")

        if isinstance(life_entity_id, str) and life_entity_id:
            try:
                context["life_entity"] = self.fetch_one(
                    "life_entities",
                    life_entity_id,
                    "id,title,source,entity_type",
                )
            except WorkerError as exc:
                logging.warning(
                    "reminder id=%s linked_life_entity_fetch_failed error=%s",
                    reminder.get("id"),
                    truncate_error(exc),
                )

        if isinstance(source_event_id, str) and source_event_id:
            try:
                context["source_event"] = self.fetch_one(
                    "source_events",
                    source_event_id,
                    "id,title,source_key,event_type",
                )
            except WorkerError as exc:
                logging.warning(
                    "reminder id=%s linked_source_event_fetch_failed error=%s",
                    reminder.get("id"),
                    truncate_error(exc),
                )

        return context


class TelegramApiClient:
    def __init__(self, bot_token: str) -> None:
        self.api_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"

    def send_message(self, chat_id: str, text: str) -> None:
        payload = {
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": True,
        }
        request = urllib.request.Request(
            self.api_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "accept": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise WorkerError(f"Telegram send failed: {exc.code} {detail}") from exc
        except urllib.error.URLError as exc:
            raise WorkerError(f"Telegram send failed: {exc.reason}") from exc

        try:
            result = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise WorkerError("Telegram send failed: invalid JSON response") from exc

        if not result.get("ok"):
            description = result.get("description") or "unknown Telegram error"
            raise WorkerError(f"Telegram send failed: {description}")


def format_context_line(context: JsonObject) -> list[str]:
    lines: list[str] = []
    life_entity = context.get("life_entity")
    source_event = context.get("source_event")

    if isinstance(life_entity, dict):
        title = str(life_entity.get("title") or "").strip()
        entity_type = str(life_entity.get("entity_type") or "").strip()

        if title:
            prefix = f"{entity_type}: " if entity_type else ""
            lines.append(f"Title: {prefix}{title}")

    if isinstance(source_event, dict):
        title = str(source_event.get("title") or "").strip()
        source_key = str(source_event.get("source_key") or "").strip()

        if title and source_key:
            lines.append(f"Source: {source_key} - {title}")
        elif title:
            lines.append(f"Source: {title}")
        elif source_key:
            lines.append(f"Source: {source_key}")

    return lines


def reminder_metadata(reminder: JsonObject) -> JsonObject:
    metadata = reminder.get("metadata_json")
    return metadata if isinstance(metadata, dict) else {}


def is_quiet_time(value: datetime, settings: Settings) -> bool:
    tz, _label = resolve_timezone(settings.local_timezone)
    local = value.astimezone(tz)
    current = local.time().replace(tzinfo=None)
    start = datetime_time.fromisoformat(settings.quiet_hours_start)
    end = datetime_time.fromisoformat(settings.quiet_hours_end)
    if start < end:
        return start <= current < end
    return current >= start or current < end


def next_quiet_end(value: datetime, settings: Settings) -> datetime:
    tz, _label = resolve_timezone(settings.local_timezone)
    local = value.astimezone(tz)
    end = datetime_time.fromisoformat(settings.quiet_hours_end)
    target_day = local.date()
    if local.time().replace(tzinfo=None) >= datetime_time.fromisoformat(
        settings.quiet_hours_start
    ):
        target_day += timedelta(days=1)
    return datetime.combine(target_day, end, local.tzinfo).astimezone(timezone.utc)


def quiet_hour_deferral(reminder: JsonObject, settings: Settings) -> str | None:
    metadata = reminder_metadata(reminder)
    mode = str(metadata.get("reminder_mode") or "normal")
    if mode not in {"duolingo", "war"}:
        return None
    now = datetime.now(timezone.utc)
    if not is_quiet_time(now, settings):
        return None
    try:
        event_at = parse_datetime(
            str(metadata.get("event_at") or reminder.get("remind_at") or "")
        )
    except ValueError:
        return None
    if event_at - now <= timedelta(hours=1):
        return None
    return next_quiet_end(now, settings).isoformat().replace("+00:00", "Z")


def format_telegram_message(
    reminder: JsonObject,
    context: JsonObject,
    timezone_name: str = LOCAL_TIMEZONE,
) -> str:
    metadata = reminder_metadata(reminder)
    message = str(metadata.get("title") or reminder.get("message") or "").strip() or "Reminder"
    remind_at = str(reminder.get("remind_at") or "").strip()
    event_at = str(metadata.get("event_at") or remind_at).strip()
    source_label = str(metadata.get("source_label") or "Manual")
    priority = str(metadata.get("priority") or "normal")
    notification_kind = str(metadata.get("notification_kind") or "reminder")
    if notification_kind == "deadline":
        try:
            remaining = parse_datetime(event_at) - datetime.now(timezone.utc)
            remaining_label = str(remaining).split(".", 1)[0]
        except (TypeError, ValueError):
            remaining_label = "soon"
        return "\n".join(
            [
                "🚨 Deadline / Exam",
                message,
                f"Осталось: {remaining_label}",
                "Минимум: открой материалы прямо сейчас.",
                f"Source: {source_label}",
            ]
        )
    if notification_kind == "overdue":
        return "\n".join(
            [
                "🔥 Overdue",
                message,
                "Ты уже это откладываешь. Закрой хотя бы 5 минут.",
                f"Source: {source_label}",
            ]
        )
    lines = [
        "🔔 Reminder",
        "",
        message,
        "",
        *format_context_line(context),
        f"When: {local_time_label(event_at, timezone_name)}",
        f"Source: {source_label}",
        f"Priority: {priority}",
    ]

    return "\n".join(lines)


def process_due_reminders(
    settings: Settings,
    supabase: SupabaseClientProtocol,
    telegram: TelegramClientProtocol,
) -> ProcessSummary:
    reminders = supabase.list_due_reminders(utc_now(), settings.batch_size)
    summary = ProcessSummary(processed=len(reminders))

    if not reminders:
        logging.info("reminder_worker status=idle due_count=0")
        return summary

    logging.info("reminder_worker status=processing due_count=%s", len(reminders))

    for reminder in reminders:
        reminder_id = str(reminder.get("id") or "unknown")

        try:
            claimed = supabase.claim_reminder(reminder_id)
            if not claimed:
                logging.info("reminder id=%s status=claim_skipped", reminder_id)
                continue
            reminder = claimed
            defer_until = quiet_hour_deferral(reminder, settings)
            if defer_until:
                supabase.defer_reminder(reminder_id, defer_until)
                logging.info(
                    "reminder id=%s status=quiet_hours_deferred until=%s",
                    reminder_id,
                    defer_until,
                )
                continue
            recipient = supabase.resolve_reminder_recipient(reminder)
            if recipient is None:
                raise WorkerError("Reminder owner has no active Telegram profile")
            context = supabase.fetch_reminder_context(reminder)
            logging.info("reminder id=%s status=sending", reminder_id)
            telegram.send_message(
                recipient,
                format_telegram_message(reminder, context, settings.local_timezone),
            )
        except Exception as exc:  # noqa: BLE001 - isolate one reminder from the batch.
            error = truncate_error(exc)
            summary.send_failed += 1

            try:
                updated = supabase.record_send_failure(reminder, error)
                status = str(updated.get("status") if updated else "pending")
                attempts = updated.get("_reminder_worker_attempts") if updated else "unknown"
                logging.warning(
                    "reminder id=%s status=%s attempts=%s error=%s",
                    reminder_id,
                    status,
                    attempts,
                    error,
                )
            except Exception as mark_exc:  # noqa: BLE001 - continue with the batch.
                logging.error(
                    "reminder id=%s status=failure_record_failed error=%s",
                    reminder_id,
                    truncate_error(mark_exc),
                )

            continue

        try:
            updated = supabase.mark_reminder_sent(reminder_id)
        except Exception as exc:  # noqa: BLE001 - the message was sent; keep the loop alive.
            summary.mark_failed += 1
            logging.error(
                "reminder id=%s status=sent_mark_failed error=%s",
                reminder_id,
                truncate_error(exc),
            )
            continue

        if updated:
            summary.sent += 1
            logging.info("reminder id=%s status=sent", reminder_id)
        else:
            summary.mark_failed += 1
            logging.warning("reminder id=%s status=sent_mark_skipped", reminder_id)

    return summary


def run_once(settings: Settings) -> ProcessSummary:
    supabase = SupabaseRestClient(settings.supabase_url, settings.service_role_key)
    stale_before = (
        datetime.now(timezone.utc) - timedelta(minutes=settings.claim_timeout_minutes)
    ).isoformat().replace("+00:00", "Z")
    supabase.release_stale_claims(stale_before)
    telegram = TelegramApiClient(settings.telegram_bot_token)
    return process_due_reminders(settings, supabase, telegram)


def run_loop(settings: Settings) -> None:
    logging.info(
        "reminder_worker status=started poll_seconds=%s batch_size=%s",
        settings.poll_seconds,
        settings.batch_size,
    )

    while True:
        try:
            run_once(settings)
        except WorkerError as exc:
            logging.error("reminder_worker status=iteration_failed error=%s", truncate_error(exc))

        time.sleep(settings.poll_seconds)


def test_send(settings: Settings) -> None:
    if not settings.test_telegram_user_id:
        raise WorkerError(
            "Missing required environment variable: REMINDER_WORKER_TEST_TELEGRAM_USER_ID"
        )

    telegram = TelegramApiClient(settings.telegram_bot_token)
    text = (
        "🔔 Reminder\n\n"
        "LifeOS reminder worker test-send\n\n"
        f"Time: {local_time_label(utc_now(), settings.local_timezone)}"
    )
    telegram.send_message(settings.test_telegram_user_id, text)
    print(f"Sent test reminder to Telegram user id {settings.test_telegram_user_id}.")


def status(settings: Settings) -> None:
    supabase = SupabaseRestClient(settings.supabase_url, settings.service_role_key)
    due = supabase.list_due_reminders(utc_now(), settings.batch_size)
    upcoming = supabase.list_next_pending_reminders(1)
    print("Reminder worker status")
    print(f"Poll seconds: {settings.poll_seconds}")
    print(f"Batch size: {settings.batch_size}")
    print(f"Due pending telegram reminders (first batch): {len(due)}")

    if upcoming:
        item = upcoming[0]
        print(
            "Next pending: "
            f"id={item.get('id')} "
            f"time={local_time_label(str(item.get('remind_at') or ''), settings.local_timezone)}"
        )
    else:
        print("Next pending: none")


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="LifeOS Telegram reminder worker")
    parser.add_argument(
        "--env-file",
        type=Path,
        help="Optional dotenv file loaded after workers/reminder-worker/.env",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("run-once", help="Process one batch of due reminders")
    subparsers.add_parser("run-loop", help="Process due reminders forever")
    subparsers.add_parser("test-send", help="Send a test Telegram message")
    subparsers.add_parser("status", help="Print worker configuration and queue status")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    args = parse_args(sys.argv[1:] if argv is None else argv)

    try:
        settings = load_settings(args.env_file)

        if args.command == "run-once":
            summary = run_once(settings)
            logging.info(
                "reminder_worker status=run_once_complete processed=%s sent=%s send_failed=%s mark_failed=%s",
                summary.processed,
                summary.sent,
                summary.send_failed,
                summary.mark_failed,
            )
            return 0

        if args.command == "run-loop":
            run_loop(settings)
            return 0

        if args.command == "test-send":
            test_send(settings)
            return 0

        if args.command == "status":
            status(settings)
            return 0

        raise WorkerError(f"Unsupported command: {args.command}")
    except KeyboardInterrupt:
        logging.info("reminder_worker status=stopped")
        return 0
    except WorkerError as exc:
        logging.error("reminder_worker status=failed error=%s", truncate_error(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
