from __future__ import annotations

import os
import unittest
from datetime import datetime, timezone
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lifeos_sync import (
    BaseSettings,
    SupabaseRestClient,
    SyncError,
    build_reminder_schedule,
    is_high_priority,
    load_base_settings,
    reminder_policy_keys,
    shift_out_of_quiet_hours,
)


class InMemoryReminderClient(SupabaseRestClient):
    def __init__(self) -> None:
        self.settings = BaseSettings(
            supabase_url="https://example.supabase.co",
            service_role_key="service-role",
            user_id="user-1",
            timezone_name="Asia/Qyzylorda",
        )
        self.reminders: list[dict[str, object]] = []
        self.next_id = 1

    @staticmethod
    def _eq(value: str | None) -> str | None:
        return value[3:] if value and value.startswith("eq.") else value

    def request(
        self,
        method: str,
        table: str,
        query: dict[str, str] | None = None,
        body: object | None = None,
        prefer: str | None = None,
    ) -> object:
        self.assert_reminders_table(table)
        query = query or {}
        rows = self.reminders
        for key in ("id", "user_id", "source_event_id", "status", "dedup_key"):
            expected = self._eq(query.get(key))
            if expected is not None:
                rows = [row for row in rows if row.get(key) == expected]
        if method == "GET":
            return [dict(row) for row in rows]
        if method == "POST":
            assert isinstance(body, dict)
            row = {"id": f"reminder-{self.next_id}", "status": "pending", **body}
            self.next_id += 1
            self.reminders.append(row)
            return [dict(row)]
        if method == "PATCH":
            assert isinstance(body, dict)
            for row in rows:
                row.update(body)
            return [dict(row) for row in rows] if prefer == "return=representation" else None
        raise AssertionError(f"Unexpected method: {method}")

    @staticmethod
    def assert_reminders_table(table: str) -> None:
        if table != "reminders":
            raise AssertionError(f"Unexpected table: {table}")


class ReminderPolicyTest(unittest.TestCase):
    def test_legacy_single_user_guard_blocks_default_user_without_opt_in(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role",
                "LIFEOS_DEFAULT_USER_ID": "user-1",
            },
            clear=True,
        ):
            with self.assertRaises(SyncError) as context:
                load_base_settings(
                    legacy_guard_env="LIFEOS_ENABLE_LEGACY_SINGLE_USER_TEST",
                    worker_name="test sync",
                )

        self.assertIn("LIFEOS_ENABLE_LEGACY_SINGLE_USER_TEST", str(context.exception))
        self.assertIn("legacy single-user mode", str(context.exception))

    def test_legacy_single_user_guard_allows_explicit_opt_in(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co/",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role",
                "LIFEOS_DEFAULT_USER_ID": "user-1",
                "LIFEOS_ENABLE_LEGACY_SINGLE_USER_TEST": "true",
            },
            clear=True,
        ):
            settings = load_base_settings(
                legacy_guard_env="LIFEOS_ENABLE_LEGACY_SINGLE_USER_TEST",
                worker_name="test sync",
            )

        self.assertEqual(settings.supabase_url, "https://example.supabase.co")
        self.assertEqual(settings.user_id, "user-1")

    def test_high_priority_keywords_include_english_and_russian(self) -> None:
        self.assertTrue(is_high_priority("Final exam"))
        self.assertTrue(is_high_priority("Пересдача по математике"))
        self.assertFalse(is_high_priority("Buy milk"))

    def test_policy_offsets(self) -> None:
        self.assertEqual(
            reminder_policy_keys("event", "chill", False),
            ["before_60m", "before_15m"],
        )
        self.assertIn("before_1440m", reminder_policy_keys("event", "normal", False))
        self.assertEqual(reminder_policy_keys("event", "war", False), [])

    def test_quiet_hour_shift(self) -> None:
        shifted = shift_out_of_quiet_hours(
            datetime(2026, 6, 6, 19, 0, tzinfo=timezone.utc),
            datetime(2026, 6, 7, 12, 0, tzinfo=timezone.utc),
            "Asia/Qyzylorda",
        )
        self.assertEqual(shifted.isoformat(), "2026-06-07T03:00:00+00:00")

    def test_schedule_is_deterministic(self) -> None:
        event = {
            "id": "source-event-1",
            "source_key": "google_calendar",
            "external_id": "primary:abc",
            "event_type": "event",
            "title": "Lecture",
            "starts_at": "2026-06-08T12:00:00Z",
            "status": "active",
        }
        now = datetime(2026, 6, 6, 12, 0, tzinfo=timezone.utc)
        first = build_reminder_schedule(event, "normal", "Asia/Qyzylorda", now)
        second = build_reminder_schedule(event, "normal", "Asia/Qyzylorda", now)
        self.assertEqual(first, second)
        self.assertEqual(len({item["dedup_key"] for item in first}), len(first))

    def test_high_priority_schedule_is_stronger(self) -> None:
        base = {
            "id": "source-event-1",
            "source_key": "google_calendar",
            "external_id": "primary:abc",
            "event_type": "event",
            "starts_at": "2026-06-08T12:00:00Z",
            "status": "active",
        }
        now = datetime(2026, 6, 6, 12, 0, tzinfo=timezone.utc)
        normal = build_reminder_schedule({**base, "title": "Lecture"}, "normal", "Asia/Qyzylorda", now)
        high = build_reminder_schedule({**base, "title": "Final exam"}, "normal", "Asia/Qyzylorda", now)
        self.assertGreater(len(high), len(normal))

    def test_google_task_due_creates_reminders_without_duplicates(self) -> None:
        client = InMemoryReminderClient()
        event = {
            "id": "source-event-task-1",
            "normalized_entity_id": "entity-1",
            "source_key": "google_tasks",
            "external_id": "@default:task-1",
            "event_type": "task",
            "title": "Submit assignment",
            "due_at": "2099-06-08T12:00:00Z",
            "status": "active",
        }

        first = client._sync_reminders(event, "normal")
        second = client._sync_reminders(event, "normal")

        self.assertGreater(first.created, 0)
        self.assertEqual(second.created, 0)
        self.assertEqual(second.updated, 0)
        self.assertEqual(
            len({str(row["dedup_key"]) for row in client.reminders}),
            len(client.reminders),
        )

    def test_changed_google_task_due_updates_pending_reminders(self) -> None:
        client = InMemoryReminderClient()
        event = {
            "id": "source-event-task-1",
            "normalized_entity_id": "entity-1",
            "source_key": "google_tasks",
            "external_id": "@default:task-1",
            "event_type": "task",
            "title": "Submit assignment",
            "due_at": "2099-06-08T12:00:00Z",
            "status": "active",
        }
        client._sync_reminders(event, "normal")

        changed = client._sync_reminders(
            {**event, "due_at": "2099-06-09T12:00:00Z"},
            "normal",
        )

        self.assertGreater(changed.updated, 0)
        self.assertTrue(
            all(
                str(row["remind_at"]).startswith("2099-06-09")
                or row["status"] == "cancelled"
                for row in client.reminders
            )
        )

    def test_completed_google_task_cancels_pending_reminders(self) -> None:
        client = InMemoryReminderClient()
        event = {
            "id": "source-event-task-1",
            "normalized_entity_id": "entity-1",
            "source_key": "google_tasks",
            "external_id": "@default:task-1",
            "event_type": "task",
            "title": "Submit assignment",
            "due_at": "2099-06-08T12:00:00Z",
            "status": "active",
        }
        client._sync_reminders(event, "normal")

        completed = client._sync_reminders({**event, "status": "done"}, "normal")

        self.assertGreater(completed.cancelled, 0)
        self.assertTrue(all(row["status"] == "cancelled" for row in client.reminders))

    def test_google_task_without_due_keeps_no_scheduled_reminder(self) -> None:
        client = InMemoryReminderClient()
        event = {
            "id": "source-event-task-1",
            "source_key": "google_tasks",
            "external_id": "@default:task-1",
            "event_type": "task",
            "title": "Someday task",
            "due_at": None,
            "status": "active",
        }

        result = client._sync_reminders(event, "normal")

        self.assertEqual(result.created, 0)
        self.assertEqual(client.reminders, [])


if __name__ == "__main__":
    unittest.main()
