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
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common.notification_delivery import (
    DeliveryStore,
    TelegramApiClient,
    TelegramDeliveryError,
    WorkerError,
)
from common.notification_time import (
    in_quiet_hours,
    next_quiet_end as quiet_end,
    quiet_hour_deferral_at,
)

JsonObject = dict[str, Any]

LOCAL_TIMEZONE = "Asia/Qyzylorda"
REQUEST_TIMEOUT_SECONDS = 30


class SupabaseClientProtocol(Protocol):
    def claim_due_reminders(self, before: str, limit: int) -> list[JsonObject]: ...
    def resolve_reminder_recipient(self, reminder: JsonObject) -> JsonObject | None: ...
    def fetch_reminder_context(self, reminder: JsonObject) -> JsonObject: ...
    def begin_delivery(self, kind: str, claim: JsonObject) -> str | None: ...
    def finish_delivery(
        self,
        kind: str,
        claim: JsonObject,
        outcome: str,
        reason: str = "none",
        message_id: int | None = None,
        retry_after_seconds: int | None = None,
    ) -> bool: ...
    def defer_reminder_delivery(self, claim: JsonObject, not_before: str) -> bool: ...
    def recover_deliveries(self, kind: str) -> JsonObject: ...


class TelegramClientProtocol(Protocol):
    def send_message(self, chat_id: str, text: str) -> int: ...


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
    # Legacy environment compatibility; leases are enforced by PostgreSQL.
    claim_timeout_minutes: int = 5


@dataclass
class ProcessSummary:
    processed: int = 0
    sent: int = 0
    send_failed: int = 0
    mark_failed: int = 0
    unknown: int = 0
    deferred: int = 0
    stale: int = 0


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
    except (ZoneInfoNotFoundError, ValueError, TypeError):
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


class SupabaseRestClient(DeliveryStore):
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
            with urllib.request.urlopen(
                request, timeout=REQUEST_TIMEOUT_SECONDS
            ) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            raise WorkerError("supabase_request_failed") from None
        except urllib.error.URLError as exc:
            raise WorkerError("supabase_request_failed") from None

        if not raw:
            return None

        return json.loads(raw)

    def rpc(self, name: str, body: JsonObject | None = None) -> Any:
        return self.request("POST", f"rpc/{name}", body=body or {})

    def claim_due_reminders(self, before: str, limit: int) -> list[JsonObject]:
        rows = self.rpc(
            "claim_due_reminders",
            {
                "p_before": before,
                "p_limit": limit,
            },
        )
        return rows or []

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

    def resolve_reminder_recipient(self, reminder: JsonObject) -> JsonObject | None:
        user_id = str(reminder.get("user_id") or "").strip()
        if not user_id:
            raise WorkerError("reminder_owner_missing")
        rows = self.request(
            "GET",
            "profiles",
            {
                "select": "user_id,telegram_user_id,timezone,status",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "limit": "1",
            },
        )
        return rows[0] if rows and rows[0].get("telegram_user_id") is not None else None

    def fetch_one(
        self, table: str, row_id: str, select: str, user_id: str
    ) -> JsonObject | None:
        rows = self.request(
            "GET",
            table,
            {
                "select": select,
                "id": f"eq.{row_id}",
                "user_id": f"eq.{user_id}",
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
                    str(reminder["user_id"]),
                )
            except WorkerError as exc:
                logging.warning(
                    "reminder id=%s linked_life_entity_fetch_failed error=%s",
                    reminder.get("id"),
                    "context_unavailable",
                )

        if isinstance(source_event_id, str) and source_event_id:
            try:
                context["source_event"] = self.fetch_one(
                    "source_events",
                    source_event_id,
                    "id,title,source_key,event_type",
                    str(reminder["user_id"]),
                )
            except WorkerError as exc:
                logging.warning(
                    "reminder id=%s linked_source_event_fetch_failed error=%s",
                    reminder.get("id"),
                    "context_unavailable",
                )

        return context


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
    return in_quiet_hours(
        value,
        settings.quiet_hours_start,
        settings.quiet_hours_end,
        settings.local_timezone,
    )


def next_quiet_end(value: datetime, settings: Settings) -> datetime:
    return quiet_end(
        value,
        settings.quiet_hours_start,
        settings.quiet_hours_end,
        settings.local_timezone,
    )


def quiet_hour_deferral(
    reminder: JsonObject, settings: Settings, now: datetime | None = None
) -> str | None:
    metadata = reminder_metadata(reminder)
    if metadata.get("notification_kind") == "instant_academic" or metadata.get(
        "reminder_mode"
    ) in {"duolingo", "war"}:
        return None
    try:
        event_at = parse_datetime(
            str(metadata.get("event_at") or reminder.get("remind_at") or "")
        )
    except ValueError:
        return None
    target = quiet_hour_deferral_at(
        now or datetime.now(timezone.utc),
        event_at,
        settings.quiet_hours_start,
        settings.quiet_hours_end,
        settings.local_timezone,
    )
    return target.isoformat().replace("+00:00", "Z") if target else None


def format_telegram_message(
    reminder: JsonObject,
    context: JsonObject,
    timezone_name: str = LOCAL_TIMEZONE,
) -> str:
    metadata = reminder_metadata(reminder)
    message = (
        str(metadata.get("title") or reminder.get("message") or "").strip()
        or "Reminder"
    )
    remind_at = str(reminder.get("remind_at") or "").strip()
    event_at = str(metadata.get("event_at") or remind_at).strip()
    source_label = str(metadata.get("source_label") or "Manual")
    priority = str(metadata.get("priority") or "normal")
    notification_kind = str(metadata.get("notification_kind") or "reminder")
    if notification_kind == "instant_academic":
        return str(reminder.get("message") or "").strip() or "Уведомление"
    if notification_kind == "academic_assignment_deadline":
        course_title = str(metadata.get("course_title") or "Moodle").strip()
        grade_info = metadata.get("grade_info")
        lines = [
            f"⏰ Дедлайн задания по «{course_title}»: {message}",
            f"Предмет: {course_title}",
            f"Сдать до {local_time_label(event_at, timezone_name)}.",
        ]
        if isinstance(grade_info, dict) and grade_info.get("score") is not None:
            score = grade_info["score"]
            max_score = grade_info.get("max_score")
            grade_str = f"{score:.15g}"
            if max_score is not None and max_score > 0:
                pct = round(score / max_score * 100, 1)
                grade_str += f"/{max_score:.15g} ({pct:.15g}%)"
            lines.append(f"Выполнено: {grade_str}")
        return "\n".join(lines)
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
    *,
    now: datetime | None = None,
) -> ProcessSummary:
    started = time.monotonic()
    current = now or datetime.now(timezone.utc)
    recovered = supabase.recover_deliveries("reminder")
    summary = ProcessSummary(stale=int(recovered.get("stale", 0)))
    logging.info(
        "reminder_worker stale=%s recovered_unknown=%s",
        summary.stale,
        recovered.get("unknown", 0),
    )

    def claimed_rows():
        # Reserve just-in-time; slow preparation of an earlier job must not
        # exhaust leases on an entire already-reserved batch.
        for _ in range(settings.batch_size):
            rows = supabase.claim_due_reminders(
                (now or datetime.now(timezone.utc)).isoformat(), 1
            )
            if not rows:
                return
            yield rows[0]

    def finish(claim, outcome, reason="none", message_id=None, wait=None):
        try:
            changed = supabase.finish_delivery(
                "reminder", claim, outcome, reason, message_id, wait
            )
            if not changed:
                summary.mark_failed += 1
                logging.warning("reminder id=%s status=claim_lost", claim.get("id"))
            return changed
        except Exception:
            summary.mark_failed += 1
            logging.error(
                "reminder id=%s status=state_unavailable outcome=%s",
                claim.get("id"),
                outcome,
            )
            return False

    for reminder in claimed_rows():
        current = now or datetime.now(timezone.utc)
        summary.processed += 1
        reminder_id = str(reminder.get("id") or "unknown")
        try:
            profile = supabase.resolve_reminder_recipient(reminder)
            if not profile:
                finish(reminder, "cancelled", "recipient_inactive")
                continue
            recipient_settings = replace(
                settings, local_timezone=str(profile.get("timezone") or "UTC")
            )
            defer_until = quiet_hour_deferral(reminder, recipient_settings, current)
            if defer_until:
                if supabase.defer_reminder_delivery(reminder, defer_until):
                    summary.deferred += 1
                else:
                    summary.mark_failed += 1
                continue
            context = supabase.fetch_reminder_context(reminder)
            # Slow DB preparation can cross into quiet hours; recheck before begin.
            defer_until = quiet_hour_deferral(
                reminder, recipient_settings, now or datetime.now(timezone.utc)
            )
            if defer_until:
                if supabase.defer_reminder_delivery(reminder, defer_until):
                    summary.deferred += 1
                else:
                    summary.mark_failed += 1
                continue
            text = format_telegram_message(
                reminder, context, recipient_settings.local_timezone
            )
        except Exception:
            summary.send_failed += 1
            finish(reminder, "retry", "preparation_failed")
            continue

        try:
            recipient = supabase.begin_delivery("reminder", reminder)
        except Exception:
            # The DB may have committed sending. Never reset or send on a lost response.
            summary.mark_failed += 1
            logging.error("reminder id=%s status=begin_unavailable", reminder_id)
            continue
        if recipient is None:
            logging.info("reminder id=%s status=claim_lost", reminder_id)
            continue
        logging.info(
            "reminder id=%s status=sending attempt=%s failures=%s",
            reminder_id,
            int(reminder.get("delivery_attempts") or 0) + 1,
            reminder.get("failure_count", 0),
        )
        try:
            message_id = telegram.send_message(recipient, text)
        except TelegramDeliveryError as exc:
            summary.send_failed += 1
            summary.unknown += int(exc.outcome == "unknown")
            finish(reminder, exc.outcome, exc.reason, wait=exc.retry_after_seconds)
            logging.warning(
                "reminder id=%s status=%s reason=%s",
                reminder_id,
                exc.outcome,
                exc.reason,
            )
            continue
        except Exception:
            summary.send_failed += 1
            summary.unknown += 1
            finish(reminder, "unknown", "unexpected_send_error")
            logging.warning("reminder id=%s status=unknown", reminder_id)
            continue
        summary.sent += 1
        finish(reminder, "sent", message_id=message_id)
        logging.info("reminder id=%s status=acknowledged", reminder_id)
    logging.info(
        "reminder_worker duration_ms=%d claimed=%d sent=%d failed=%d unknown=%d deferred=%d state_failed=%d",
        int((time.monotonic() - started) * 1000),
        summary.processed,
        summary.sent,
        summary.send_failed,
        summary.unknown,
        summary.deferred,
        summary.mark_failed,
    )
    return summary


def run_once(settings: Settings) -> ProcessSummary:
    supabase = SupabaseRestClient(settings.supabase_url, settings.service_role_key)
    return process_due_reminders(
        settings, supabase, TelegramApiClient(settings.telegram_bot_token)
    )


def run_loop(settings: Settings) -> None:
    logging.info(
        "reminder_worker status=started poll_seconds=%s batch_size=%s",
        settings.poll_seconds,
        settings.batch_size,
    )
    while True:
        try:
            run_once(settings)
        except Exception:
            logging.error(
                "reminder_worker status=iteration_failed reason=notification_state_unavailable"
            )
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
    db = SupabaseRestClient(settings.supabase_url, settings.service_role_key)
    print(
        json.dumps({"worker": "reminder", "queue": db.queue_health()}, sort_keys=True)
    )


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
        logging.error(
            "reminder_worker status=failed reason=notification_state_unavailable"
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
