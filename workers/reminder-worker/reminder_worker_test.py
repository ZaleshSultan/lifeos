from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from typing import Any


MODULE_PATH = Path(__file__).with_name("reminder_worker.py")
SPEC = importlib.util.spec_from_file_location("reminder_worker", MODULE_PATH)
assert SPEC and SPEC.loader
reminder_worker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = reminder_worker
SPEC.loader.exec_module(reminder_worker)


class CapturingSupabaseClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, str] | None, Any, str | None]] = []

    def request(
        self,
        method: str,
        table: str,
        query: dict[str, str] | None = None,
        body: Any | None = None,
        prefer: str | None = None,
    ) -> Any:
        self.calls.append((method, table, query, body, prefer))
        return []


class FakeSupabase:
    def __init__(self) -> None:
        self.reminders = [
            {
                "id": "reminder-1",
                "user_id": "user-1",
                "message": "Review graph theory",
                "remind_at": "2026-05-18T12:00:00Z",
                "status": "pending",
                "channel": "telegram",
                "metadata_json": {},
            }
        ]
        self.failures: list[str] = []
        self.recipients = {"user-1": "456"}

    def list_due_reminders(self, _before: str, _limit: int) -> list[dict[str, Any]]:
        return self.reminders

    def claim_reminder(self, reminder_id: str) -> dict[str, Any] | None:
        reminder = self.reminders[0]
        if reminder["id"] != reminder_id or reminder["status"] != "pending":
            return None
        reminder["status"] = "processing"
        return reminder

    def resolve_reminder_recipient(self, reminder: dict[str, Any]) -> str | None:
        return self.recipients.get(str(reminder.get("user_id") or ""))

    def mark_reminder_sent(self, reminder_id: str) -> dict[str, Any] | None:
        reminder = self.reminders[0]
        reminder["id"] = reminder_id
        reminder["status"] = "sent"
        reminder["sent_at"] = "2026-05-18T12:01:00Z"
        return reminder

    def defer_reminder(self, reminder_id: str, remind_at: str) -> dict[str, Any] | None:
        reminder = self.reminders[0]
        reminder["id"] = reminder_id
        reminder["status"] = "pending"
        reminder["remind_at"] = remind_at
        return reminder

    def release_stale_claims(self, _before: str) -> None:
        return None

    def record_send_failure(
        self,
        reminder: dict[str, Any],
        error: str,
    ) -> dict[str, Any] | None:
        self.failures.append(error)
        metadata, attempts, status = reminder_worker.metadata_with_send_failure(
            reminder,
            error,
            "2026-05-18T12:01:00Z",
        )
        reminder["metadata_json"] = metadata
        reminder["status"] = status
        reminder["_reminder_worker_attempts"] = attempts
        return reminder

    def fetch_reminder_context(self, _reminder: dict[str, Any]) -> dict[str, Any]:
        return {}


class FailingTelegram:
    def send_message(self, _chat_id: str, _text: str) -> None:
        raise reminder_worker.WorkerError("Telegram send failed: test failure")


class CapturingTelegram:
    def __init__(self) -> None:
        self.messages: list[tuple[str, str]] = []

    def send_message(self, chat_id: str, text: str) -> None:
        self.messages.append((chat_id, text))


class ReminderWorkerTest(unittest.TestCase):
    def test_due_reminder_query_filters_pending_telegram_rows(self) -> None:
        client = CapturingSupabaseClient()

        reminder_worker.SupabaseRestClient.list_due_reminders(
            client,
            "2026-05-18T12:00:00Z",
            20,
        )

        method, table, query, _body, _prefer = client.calls[0]
        self.assertEqual(method, "GET")
        self.assertEqual(table, "reminders")
        self.assertEqual(query["status"], "eq.pending")
        self.assertEqual(query["channel"], "eq.telegram")
        self.assertEqual(query["remind_at"], "lte.2026-05-18T12:00:00Z")
        self.assertEqual(query["limit"], "20")

    def test_mark_sent_sets_status_sent_and_timestamps(self) -> None:
        client = CapturingSupabaseClient()

        reminder_worker.SupabaseRestClient.mark_reminder_sent(
            client,
            "reminder-1",
        )

        method, table, query, body, prefer = client.calls[0]
        self.assertEqual(method, "PATCH")
        self.assertEqual(table, "reminders")
        self.assertEqual(query["id"], "eq.reminder-1")
        self.assertEqual(query["status"], "eq.processing")
        self.assertEqual(body["status"], "sent")
        self.assertIn("sent_at", body)
        self.assertIn("updated_at", body)
        self.assertEqual(prefer, "return=representation")

    def test_recipient_query_filters_active_owner_profile(self) -> None:
        client = CapturingSupabaseClient()

        reminder_worker.SupabaseRestClient.resolve_reminder_recipient(
            client,
            {"id": "reminder-1", "user_id": "user-1"},
        )

        method, table, query, _body, _prefer = client.calls[0]
        self.assertEqual(method, "GET")
        self.assertEqual(table, "profiles")
        self.assertEqual(query["user_id"], "eq.user-1")
        self.assertEqual(query["status"], "eq.active")

    def test_worker_sends_to_owner_telegram_id(self) -> None:
        settings = reminder_worker.Settings(
            supabase_url="https://example.supabase.co",
            service_role_key="service-role",
            telegram_bot_token="bot-token",
            poll_seconds=30,
            batch_size=20,
        )
        supabase = FakeSupabase()
        telegram = CapturingTelegram()

        summary = reminder_worker.process_due_reminders(
            settings,
            supabase,
            telegram,
        )

        self.assertEqual(summary.sent, 1)
        self.assertEqual(telegram.messages[0][0], "456")

    def test_worker_does_not_send_without_active_recipient(self) -> None:
        settings = reminder_worker.Settings(
            supabase_url="https://example.supabase.co",
            service_role_key="service-role",
            telegram_bot_token="bot-token",
            poll_seconds=30,
            batch_size=20,
        )
        supabase = FakeSupabase()
        supabase.recipients = {}
        telegram = CapturingTelegram()

        with self.assertLogs(level="WARNING") as logs:
            summary = reminder_worker.process_due_reminders(
                settings,
                supabase,
                telegram,
            )

        self.assertEqual(summary.sent, 0)
        self.assertEqual(summary.send_failed, 1)
        self.assertEqual(telegram.messages, [])
        self.assertIn("no active Telegram profile", supabase.failures[0])
        self.assertIn("no active Telegram profile", "\n".join(logs.output))

    def test_worker_does_not_crash_when_telegram_send_fails(self) -> None:
        settings = reminder_worker.Settings(
            supabase_url="https://example.supabase.co",
            service_role_key="service-role",
            telegram_bot_token="bot-token",
            poll_seconds=30,
            batch_size=20,
        )
        supabase = FakeSupabase()

        with self.assertLogs(level="WARNING") as logs:
            summary = reminder_worker.process_due_reminders(
                settings,
                supabase,
                FailingTelegram(),
            )

        self.assertEqual(summary.processed, 1)
        self.assertEqual(summary.send_failed, 1)
        self.assertEqual(supabase.reminders[0]["status"], "pending")
        self.assertIn("Telegram send failed", "\n".join(logs.output))
        self.assertEqual(
            supabase.reminders[0]["metadata_json"]["reminder_worker"]["attempts"],
            1,
        )

    def test_quiet_hours_defer_duolingo_nudge(self) -> None:
        reminder = {
            "remind_at": "2026-05-18T18:30:00Z",
            "metadata_json": {
                "reminder_mode": "duolingo",
                "event_at": "2026-05-19T12:00:00Z",
            },
        }
        settings = reminder_worker.Settings(
            supabase_url="https://example.supabase.co",
            service_role_key="service-role",
            telegram_bot_token="bot-token",
            poll_seconds=30,
            batch_size=20,
            local_timezone="Asia/Qyzylorda",
        )

        original_datetime = reminder_worker.datetime
        self.addCleanup(setattr, reminder_worker, "datetime", original_datetime)

        class FixedDateTime(original_datetime):
            @classmethod
            def now(cls, tz=None):
                value = cls(2026, 5, 18, 18, 30, tzinfo=reminder_worker.timezone.utc)
                return value if tz else value.replace(tzinfo=None)

        reminder_worker.datetime = FixedDateTime
        self.assertEqual(
            reminder_worker.quiet_hour_deferral(reminder, settings),
            "2026-05-19T03:00:00Z",
        )


if __name__ == "__main__":
    unittest.main()
