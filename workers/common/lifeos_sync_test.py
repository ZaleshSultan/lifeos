from __future__ import annotations

import unittest
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lifeos_sync import (
    build_reminder_schedule,
    is_high_priority,
    reminder_policy_keys,
    shift_out_of_quiet_hours,
)


class ReminderPolicyTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
