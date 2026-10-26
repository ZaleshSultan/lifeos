from __future__ import annotations

import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common.notification_time import (
    in_quiet_hours,
    next_quiet_end,
    quiet_hour_deferral_at,
    resolve_local_datetime,
    timezone_for,
)


class NotificationTimezoneTest(unittest.TestCase):
    def test_supported_recipient_zones_convert_the_same_instant(self):
        now = datetime(2026, 6, 6, 22, tzinfo=timezone.utc)
        expected = {
            "Asia/Almaty": (7, 3),
            "Asia/Qyzylorda": (7, 3),
            "Europe/London": (6, 23),
            "America/New_York": (6, 18),
        }
        for name, (day, hour) in expected.items():
            with self.subTest(name=name):
                local = now.astimezone(timezone_for(name))
                self.assertEqual((local.day, local.hour), (day, hour))

    def test_missing_invalid_or_absolute_zone_uses_utc(self):
        for name in (None, "", "not-a-zone", "/etc/passwd"):
            with self.subTest(name=name):
                self.assertEqual(timezone_for(name), timezone.utc)

    def test_local_midnight_on_short_and_long_dst_days(self):
        for name, short_day, long_day in (
            ("Europe/London", date(2026, 3, 29), date(2026, 10, 25)),
            ("America/New_York", date(2026, 3, 8), date(2026, 11, 1)),
        ):
            for day, hours in ((short_day, 23), (long_day, 25)):
                with self.subTest(name=name, day=day):
                    start = resolve_local_datetime(day, "00:00", name).astimezone(
                        timezone.utc
                    )
                    end = resolve_local_datetime(
                        day + timedelta(days=1), "00:00", name
                    ).astimezone(timezone.utc)
                    self.assertEqual(end - start, timedelta(hours=hours))

    def test_london_spring_gap_ends_at_first_real_minute(self):
        local = resolve_local_datetime(date(2026, 3, 29), "01:30", "Europe/London")
        self.assertEqual(local.isoformat(), "2026-03-29T02:00:00+01:00")
        self.assertEqual(local.astimezone(timezone.utc).hour, 1)

    def test_new_york_spring_gap_ends_at_first_real_minute(self):
        local = resolve_local_datetime(date(2026, 3, 8), "02:30", "America/New_York")
        self.assertEqual(local.isoformat(), "2026-03-08T03:00:00-04:00")

    def test_london_fall_fold_has_two_ordered_real_instants(self):
        first = resolve_local_datetime(date(2026, 10, 25), "01:30", "Europe/London")
        second = resolve_local_datetime(
            date(2026, 10, 25),
            "01:30",
            "Europe/London",
            not_before=datetime(2026, 10, 25, 1, tzinfo=timezone.utc),
        )
        self.assertEqual(
            first.astimezone(timezone.utc).isoformat(), "2026-10-25T00:30:00+00:00"
        )
        self.assertEqual(
            second.astimezone(timezone.utc).isoformat(), "2026-10-25T01:30:00+00:00"
        )

    def test_new_york_fall_fold_respects_current_utc_floor(self):
        second = resolve_local_datetime(
            date(2026, 11, 1),
            "01:30",
            "America/New_York",
            not_before=datetime(2026, 11, 1, 6, 15, tzinfo=timezone.utc),
        )
        self.assertEqual(
            second.astimezone(timezone.utc).isoformat(), "2026-11-01T06:30:00+00:00"
        )

    def test_clock_offsets_are_not_accepted_as_local_schedule(self):
        with self.assertRaises(ValueError):
            resolve_local_datetime(date(2026, 6, 6), "08:00+01:00", "Europe/London")

    def test_quiet_hours_are_recipient_local(self):
        now = datetime(2026, 6, 6, 22, tzinfo=timezone.utc)
        self.assertTrue(in_quiet_hours(now, "23:00", "08:00", "Asia/Almaty"))
        self.assertTrue(in_quiet_hours(now, "23:00", "08:00", "Asia/Qyzylorda"))
        self.assertTrue(in_quiet_hours(now, "23:00", "08:00", "Europe/London"))
        self.assertFalse(in_quiet_hours(now, "23:00", "08:00", "America/New_York"))

    def test_daytime_quiet_interval_ends_on_same_date(self):
        now = datetime(2026, 6, 6, 10, tzinfo=timezone.utc)
        self.assertEqual(
            next_quiet_end(now, "09:00", "17:00", "Europe/London"),
            datetime(2026, 6, 6, 16, tzinfo=timezone.utc),
        )

    def test_midnight_quiet_interval_ends_on_next_local_date(self):
        now = datetime(2026, 6, 6, 19, tzinfo=timezone.utc)
        self.assertEqual(
            next_quiet_end(now, "23:00", "08:00", "Asia/Qyzylorda"),
            datetime(2026, 6, 7, 3, tzinfo=timezone.utc),
        )

    def test_equal_quiet_endpoints_disable_deferral(self):
        now = datetime(2026, 6, 6, 19, tzinfo=timezone.utc)
        self.assertFalse(in_quiet_hours(now, "08:00", "08:00", "Asia/Almaty"))
        self.assertIsNone(
            quiet_hour_deferral_at(
                now, now + timedelta(days=1), "08:00", "08:00", "Asia/Almaty"
            )
        )

    def test_spring_gap_quiet_end_is_real(self):
        now = datetime(
            2026, 3, 8, 4, 30, tzinfo=timezone.utc
        )  # 23:30 previous evening.
        self.assertEqual(
            next_quiet_end(now, "23:00", "02:30", "America/New_York"),
            datetime(2026, 3, 8, 7, tzinfo=timezone.utc),
        )

    def test_fall_fold_quiet_end_never_returns_past_instant(self):
        now = datetime(2026, 11, 1, 6, 15, tzinfo=timezone.utc)  # Second 01:15.
        self.assertEqual(
            next_quiet_end(now, "23:00", "01:30", "America/New_York"),
            datetime(2026, 11, 1, 6, 30, tzinfo=timezone.utc),
        )

    def test_deferral_keeps_one_hour_before_early_morning_event(self):
        now = datetime(2026, 6, 6, 23, tzinfo=timezone.utc)
        event_at = datetime(2026, 6, 7, 5, tzinfo=timezone.utc)
        self.assertEqual(
            quiet_hour_deferral_at(now, event_at, "23:00", "08:00", "Europe/London"),
            datetime(2026, 6, 7, 4, tzinfo=timezone.utc),
        )

    def test_critical_nearby_or_overdue_event_is_not_deferred(self):
        now = datetime(2026, 6, 6, 23, tzinfo=timezone.utc)
        for delta in (timedelta(hours=1), timedelta(minutes=30), timedelta(hours=-1)):
            with self.subTest(delta=delta):
                self.assertIsNone(
                    quiet_hour_deferral_at(
                        now, now + delta, "23:00", "08:00", "Europe/London"
                    )
                )


if __name__ == "__main__":
    unittest.main()
