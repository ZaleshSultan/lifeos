from __future__ import annotations

import os
import copy
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
        self.profile_timezone: str | None = "Asia/Qyzylorda"
        self.requests: list[tuple[str, str, dict[str, str]]] = []

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
        query = query or {}
        self.requests.append((method, table, query))
        if table == "profiles" and method == "GET":
            if query.get("user_id") != "eq.user-1":
                raise AssertionError("Profile lookup must use the recipient owner")
            return [{"timezone": self.profile_timezone}]
        self.assert_reminders_table(table)
        rows = self.reminders
        for key in ("id", "user_id", "source_event_id", "status", "dedup_key", "updated_at"):
            expected = self._eq(query.get(key))
            if expected is not None:
                rows = [row for row in rows if row.get(key) == expected]
        if method == "GET":
            return copy.deepcopy(rows)
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

    def test_instant_academic_notification_deduplicates_and_survives_reconciliation(self) -> None:
        client = InMemoryReminderClient()
        event = {
            "id": "source-event-grade-1",
            "source_key": "university_platform",
            "external_id": "academic:moodle:42:901",
            "event_type": "academic_grade",
            "title": "Assignment 1",
            "status": "active",
        }
        message = "Оценка по «Алгоритмы»: Задание 1 — 0/10"

        first = client.enqueue_instant_notification(event, "academic_grade_posted", message, "normal")
        second = client.enqueue_instant_notification(event, "academic_grade_posted", message, "normal")
        reconciliation = client._sync_reminders(event, "normal")

        self.assertTrue(first)
        self.assertFalse(second)
        self.assertEqual(reconciliation.cancelled, 0)
        self.assertEqual(len(client.reminders), 1)
        self.assertIsNone(client.reminders[0]["source_event_id"])
        self.assertEqual(client.reminders[0]["status"], "pending")

    def test_instant_notification_unique_insert_race_is_a_duplicate(self) -> None:
        client = InMemoryReminderClient()
        event = {"source_key": "university_platform", "external_id": "academic:moodle:42:901"}
        with patch.object(client, "request", side_effect=[[], SyncError("23505 duplicate key")]):
            created = client.enqueue_instant_notification(event, "academic_grade_posted", "Оценка выставлена", "normal")
        self.assertFalse(created)

    def test_moodle_assignment_uses_task_schedule_and_russian_notification_kind(self) -> None:
        event = {
            "id": "source-event-assignment-1",
            "source_key": "university_platform",
            "external_id": "assignment:moodle:42:901",
            "event_type": "task",
            "title": "OS work",
            "description": "Дедлайн задания по курсу «Operating Systems»",
            "due_at": "2099-06-08T12:00:00Z",
            "status": "active",
            "raw_json": {"course_title": "Operating Systems"},
        }
        now = datetime(2099, 6, 1, 12, 0, tzinfo=timezone.utc)
        schedule = build_reminder_schedule(event, "normal", "Asia/Qyzylorda", now)

        self.assertTrue(schedule)
        self.assertTrue(all(item["metadata_json"]["notification_kind"] == "academic_assignment_deadline" for item in schedule))
        self.assertTrue(all(item["metadata_json"]["course_title"] == "Operating Systems" for item in schedule))
        self.assertEqual(len({item["dedup_key"] for item in schedule}), len(schedule))
        self.assertEqual(build_reminder_schedule({**event, "status": "completed"}, "normal", "Asia/Qyzylorda", now), [])
        self.assertEqual(build_reminder_schedule({**event, "due_at": "2099-05-01T12:00:00Z"}, "normal", "Asia/Qyzylorda", now), [])

    def test_cancel_future_reminders_is_scoped_to_owner(self) -> None:
        client = InMemoryReminderClient()
        client.reminders = [
            {"id": "mine", "user_id": "user-1", "source_event_id": "event-a", "status": "pending", "remind_at": "2099-06-08T12:00:00Z"},
            {"id": "other", "user_id": "user-2", "source_event_id": "event-a", "status": "pending", "remind_at": "2099-06-08T12:00:00Z"},
        ]

        self.assertEqual(client.cancel_future_reminders("event-a"), 1)
        self.assertEqual(client.reminders[0]["status"], "cancelled")
        self.assertEqual(client.reminders[1]["status"], "pending")

    @staticmethod
    def task_event() -> dict[str, object]:
        return {
            "id": "source-event-task-1",
            "user_id": "user-1",
            "source_key": "google_tasks",
            "external_id": "@default:task-1",
            "event_type": "task",
            "title": "Read chapter",
            "due_at": "2099-06-08T20:00:00Z",
            "status": "active",
        }

    def test_schedule_uses_profile_timezone_instead_of_app_timezone(self) -> None:
        client = InMemoryReminderClient()
        client.profile_timezone = "America/New_York"
        client._sync_reminders(self.task_event(), "normal")
        morning = next(row for row in client.reminders if row["reminder_policy_key"] == "at_0900")
        self.assertEqual(morning["remind_at"], "2099-06-08T13:00:00Z")
        self.assertEqual(morning["metadata_json"]["event_at"], "2099-06-08T20:00:00Z")

    def test_invalid_or_missing_profile_timezone_uses_utc(self) -> None:
        for profile_timezone in (None, "invalid-zone"):
            with self.subTest(profile_timezone=profile_timezone):
                client = InMemoryReminderClient()
                client.profile_timezone = profile_timezone
                client._sync_reminders(self.task_event(), "normal")
                morning = next(row for row in client.reminders if row["reminder_policy_key"] == "at_0900")
                self.assertEqual(morning["remind_at"], "2099-06-08T09:00:00Z")

    def test_source_event_from_other_user_cannot_schedule_reminders(self) -> None:
        client = InMemoryReminderClient()
        with self.assertRaises(SyncError):
            client._sync_reminders({**self.task_event(), "user_id": "user-2"}, "normal")
        self.assertEqual(client.requests, [])

    def test_schedule_updates_keep_worker_attempts_and_require_pending_owner(self) -> None:
        client = InMemoryReminderClient()
        event = self.task_event()
        client._sync_reminders(event, "normal")
        for row in client.reminders:
            row["metadata_json"]["reminder_worker"] = {"send_attempts": 2, "last_error": "temporary"}
            row["updated_at"] = "2026-10-25T08:00:00Z"
        client.requests.clear()
        changed = client._sync_reminders({**event, "title": "Read revised chapter"}, "normal")
        self.assertGreater(changed.updated, 0)
        for row in client.reminders:
            self.assertEqual(row["metadata_json"]["reminder_worker"]["send_attempts"], 2)
            self.assertEqual(row["metadata_json"]["event_at"], event["due_at"])
        for method, table, query in client.requests:
            if method == "PATCH" and table == "reminders":
                self.assertEqual(query["user_id"], "eq.user-1")
                self.assertEqual(query["status"], "eq.pending")
                self.assertEqual(query["updated_at"], "eq.2026-10-25T08:00:00Z")

    def test_schedule_update_cannot_overwrite_newer_worker_state(self) -> None:
        client = InMemoryReminderClient()
        event = self.task_event()
        client._sync_reminders(event, "normal")
        for row in client.reminders:
            row["updated_at"] = "2026-10-25T08:00:00Z"
        original_request = client.request

        def concurrent_retry(method, table, query=None, body=None, prefer=None):
            if method == "PATCH" and table == "reminders":
                for row in client.reminders:
                    if query.get("id") == f"eq.{row['id']}":
                        row["updated_at"] = "2026-10-25T08:00:01Z"
                        row["metadata_json"]["reminder_worker"] = {"send_attempts": 3}
            return original_request(method, table, query, body, prefer)

        with patch.object(client, "request", side_effect=concurrent_retry):
            result = client._sync_reminders({**event, "title": "Updated chapter"}, "normal")
        self.assertEqual(result.updated, 0)
        self.assertTrue(all(row["metadata_json"]["reminder_worker"]["send_attempts"] == 3 for row in client.reminders))

    def test_cancelled_reminder_is_not_restored_by_schedule_reconciliation(self) -> None:
        client = InMemoryReminderClient()
        event = self.task_event()
        client._sync_reminders(event, "normal")
        for row in client.reminders:
            row["status"] = "cancelled"
        result = client._sync_reminders({**event, "title": "Updated chapter"}, "normal")
        self.assertEqual((result.created, result.updated), (0, 0))
        self.assertTrue(all(row["status"] == "cancelled" for row in client.reminders))

    def test_quiet_shift_does_not_change_original_event_metadata(self) -> None:
        event = {
            "id": "event-a", "source_key": "manual", "event_type": "event",
            "title": "Exam", "starts_at": "2026-03-08T12:00:00Z",
        }
        schedule = build_reminder_schedule(
            event, "normal", "America/New_York",
            datetime(2026, 3, 6, tzinfo=timezone.utc),
            quiet_start="23:00", quiet_end="02:30",
        )
        self.assertTrue(schedule)
        self.assertTrue(all(row["metadata_json"]["event_at"] == "2026-03-08T12:00:00Z" for row in schedule))
        self.assertEqual(len({row["dedup_key"] for row in schedule}), len(schedule))

    def test_collapsed_quiet_offsets_create_one_reminder_at_the_boundary(self) -> None:
        event = {
            "id": "event-a", "source_key": "manual", "event_type": "event",
            "title": "Final exam", "starts_at": "2026-06-08T04:00:00Z",  # 09:00 local.
        }
        schedule = build_reminder_schedule(
            event, "war", "Asia/Almaty", datetime(2026, 6, 6, tzinfo=timezone.utc),
        )
        boundary = [row for row in schedule if row["remind_at"] == "2026-06-08T03:00:00Z"]
        self.assertEqual(len(boundary), 1)
        self.assertEqual(boundary[0]["reminder_policy_key"], "before_360m")
        self.assertEqual(len({row["remind_at"] for row in schedule}), len(schedule))


if __name__ == "__main__":
    unittest.main()
