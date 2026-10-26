from __future__ import annotations
import importlib.util
import sys
import unittest
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "reminder_worker", Path(__file__).with_name("reminder_worker.py")
)
rw = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = rw
SPEC.loader.exec_module(rw)
NOW = datetime(2026, 5, 18, 12, tzinfo=timezone.utc)
SETTINGS = rw.Settings(
    "https://example.invalid", "synthetic-service", "synthetic-bot", 30, 20
)


class FakeDB:
    def __init__(self, count=1):
        self.rows = [
            dict(
                id=f"reminder-{i}",
                user_id=f"user-{i}",
                claim_token=f"token-{i}",
                message="private synthetic note",
                remind_at="2026-05-18T10:00:00Z",
                status="processing",
                metadata_json={},
                delivery_attempts=0,
            )
            for i in range(count)
        ]
        self.profiles = {
            r["user_id"]: dict(
                user_id=r["user_id"],
                telegram_user_id=str(i + 100),
                timezone="UTC",
                status="active",
            )
            for i, r in enumerate(self.rows)
        }
        self.claimed_ids = set()
        self.fail_prepare = False
        self.fail_begin = False
        self.fail_finish = False
        self.deferrals = []
        self.transitions = []

    def recover_deliveries(self, kind):
        return {"stale": 0}

    def claim_due_reminders(self, before, limit):
        rows = [
            deepcopy(r)
            for r in self.rows
            if r["status"] == "processing" and r["id"] not in self.claimed_ids
        ][:limit]
        self.claimed_ids.update(r["id"] for r in rows)
        return rows

    def resolve_reminder_recipient(self, row):
        return self.profiles.get(row["user_id"])

    def fetch_reminder_context(self, row):
        if self.fail_prepare:
            raise RuntimeError("private content Bearer credential")
        return {}

    def begin_delivery(self, kind, row):
        if self.fail_begin:
            raise OSError("sensitive DB error")
        actual = next(r for r in self.rows if r["id"] == row["id"])
        if (
            actual["status"] != "processing"
            or actual["claim_token"] != row["claim_token"]
        ):
            return None
        profile = self.profiles.get(row["user_id"])
        if not profile:
            return None
        actual["status"] = "sending"
        actual["delivery_attempts"] += 1
        return profile["telegram_user_id"]

    def finish_delivery(
        self,
        kind,
        row,
        outcome,
        reason="none",
        message_id=None,
        retry_after_seconds=None,
    ):
        self.transitions.append(
            (row["id"], outcome, reason, message_id, retry_after_seconds)
        )
        if self.fail_finish:
            raise OSError("private message in raw DB error")
        actual = next(r for r in self.rows if r["id"] == row["id"])
        if actual["claim_token"] != row["claim_token"] or actual["status"] not in (
            "processing",
            "sending",
        ):
            return False
        actual["status"] = {"retry": "pending", "permanent": "failed"}.get(
            outcome, outcome
        )
        return True

    def defer_reminder_delivery(self, row, not_before):
        self.deferrals.append((row["id"], not_before))
        self.rows[0]["status"] = "pending"
        return True


class Telegram:
    def __init__(self, error=None):
        self.calls = []
        self.error = error

    def send_message(self, chat, text):
        self.calls.append((chat, text))
        if self.error:
            raise self.error
        return 42


class ReminderWorkerTest(unittest.TestCase):
    def test_success_uses_owner_ack_and_idempotent_poll(self):
        db = FakeDB(2)
        telegram = Telegram()
        summary = rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
        self.assertEqual(summary.sent, 2)
        self.assertEqual([c[0] for c in telegram.calls], ["100", "101"])
        self.assertTrue(all(t[1] == "sent" and t[3] == 42 for t in db.transitions))
        rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
        self.assertEqual(len(telegram.calls), 2)

    def test_inactive_owner_is_cancelled_without_request(self):
        db = FakeDB()
        db.profiles = {}
        telegram = Telegram()
        rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
        self.assertEqual(telegram.calls, [])
        self.assertEqual(db.rows[0]["status"], "cancelled")

    def test_preparation_failure_is_retry_without_sending(self):
        db = FakeDB()
        db.fail_prepare = True
        telegram = Telegram()
        rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
        self.assertEqual(telegram.calls, [])
        self.assertEqual(db.rows[0]["status"], "pending")
        self.assertEqual(db.rows[0]["delivery_attempts"], 0)

    def test_begin_database_response_loss_never_sends_or_resets_claim(self):
        db = FakeDB()
        db.fail_begin = True
        telegram = Telegram()
        summary = rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
        self.assertEqual(telegram.calls, [])
        self.assertEqual(db.transitions, [])
        self.assertEqual(summary.mark_failed, 1)

    def test_cancelled_claim_cannot_send(self):
        db = FakeDB()
        telegram = Telegram()
        original = db.fetch_reminder_context

        def cancel(row):
            db.rows[0]["status"] = "cancelled"
            return original(row)

        db.fetch_reminder_context = cancel
        rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
        self.assertEqual(telegram.calls, [])

    def test_profile_revoked_during_preparation_cannot_send(self):
        db = FakeDB()
        telegram = Telegram()

        def block(row):
            db.profiles = {}
            return {}

        db.fetch_reminder_context = block
        rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
        self.assertEqual(telegram.calls, [])

    def test_old_claim_token_is_fenced_before_send(self):
        db = FakeDB()
        telegram = Telegram()

        def supersede(row):
            db.rows[0]["claim_token"] = "new-token"
            return {}

        db.fetch_reminder_context = supersede
        rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
        self.assertEqual(telegram.calls, [])

    def test_explicit_transient_and_permanent_rejections(self):
        for outcome, expected in [("retry", "pending"), ("permanent", "failed")]:
            with self.subTest(outcome=outcome):
                db = FakeDB()
                telegram = Telegram(
                    rw.TelegramDeliveryError(outcome, "telegram_rejected", 120)
                )
                rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
                self.assertEqual(db.rows[0]["status"], expected)
                self.assertEqual(db.transitions[0][4], 120)

    def test_timeout_unknown_never_blindly_resends(self):
        db = FakeDB()
        telegram = Telegram(
            rw.TelegramDeliveryError("unknown", "telegram_transport_unknown")
        )
        summary = rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
        self.assertEqual(summary.unknown, 1)
        self.assertEqual(db.rows[0]["status"], "unknown")
        rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
        self.assertEqual(len(telegram.calls), 1)

    def test_ack_then_database_failure_never_releases_or_retries(self):
        db = FakeDB()
        db.fail_finish = True
        telegram = Telegram()
        summary = rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
        self.assertEqual(summary.sent, 1)
        self.assertEqual(summary.mark_failed, 1)
        self.assertEqual(db.rows[0]["status"], "sending")
        self.assertEqual([t[1] for t in db.transitions], ["sent"])
        rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
        self.assertEqual(len(telegram.calls), 1)

    def test_one_failure_does_not_block_other_recipient(self):
        db = FakeDB(2)
        telegram = Telegram()
        original = telegram.send_message

        def send(chat, text):
            if chat == "100":
                raise TimeoutError("sensitive payload")
            return original(chat, text)

        telegram.send_message = send
        result = rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
        self.assertEqual(result.sent, 1)
        self.assertEqual(db.rows[0]["status"], "unknown")
        self.assertEqual(db.rows[1]["status"], "sent")

    def test_claim_database_outage_does_not_send(self):
        db = FakeDB()
        telegram = Telegram()
        db.claim_due_reminders = lambda *args: (_ for _ in ()).throw(OSError("lost"))
        with self.assertRaises(OSError):
            rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
        self.assertEqual(telegram.calls, [])

    def test_logs_contain_no_content_credentials_or_raw_exception(self):
        db = FakeDB()
        db.fail_finish = True
        telegram = Telegram(TimeoutError("Bearer secret medical-content"))
        with self.assertLogs(level="INFO") as logs:
            rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
        text = "\n".join(logs.output)
        for sensitive in [
            "private synthetic note",
            "Bearer",
            "secret",
            "medical-content",
            "raw DB error",
        ]:
            self.assertNotIn(sensitive, text)
        self.assertIn("unknown", text)
        self.assertIn("duration_ms", text)

    def test_context_queries_scope_owner_and_do_not_leak_foreign_records(self):
        client = rw.SupabaseRestClient("https://invalid", "synthetic")
        calls = []
        client.request = (
            lambda method, table, query=None, body=None, prefer=None: calls.append(
                query
            )
            or []
        )
        client.fetch_reminder_context(
            dict(
                id="x", user_id="a", life_entity_id="foreign", source_event_id="foreign"
            )
        )
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(c["user_id"] == "eq.a" for c in calls))

    def test_recipient_profile_query_is_active_and_owner_scoped(self):
        client = rw.SupabaseRestClient("https://invalid", "synthetic")
        calls = []
        client.request = (
            lambda method, table, query=None, body=None, prefer=None: calls.append(
                query
            )
            or []
        )
        client.resolve_reminder_recipient({"user_id": "a"})
        self.assertEqual(calls[0]["status"], "eq.active")
        self.assertEqual(calls[0]["user_id"], "eq.a")
        self.assertIn("timezone", calls[0]["select"])

    def test_distinct_recipient_timezones_and_event_time_in_message(self):
        for zone, expected in [
            ("Asia/Almaty", "15:00"),
            ("Asia/Qyzylorda", "15:00"),
            ("Europe/London", "11:00"),
            ("America/New_York", "06:00"),
        ]:
            db = FakeDB()
            db.profiles["user-0"]["timezone"] = zone
            telegram = Telegram()
            rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
            self.assertIn(expected, telegram.calls[0][1])
            self.assertIn(zone, telegram.calls[0][1])

    def test_quiet_hours_use_recipient_not_global_timezone(self):
        db = FakeDB()
        db.rows[0]["remind_at"] = "2026-05-19T12:00:00Z"
        db.profiles["user-0"]["timezone"] = "Asia/Almaty"
        telegram = Telegram()
        instant = datetime(2026, 5, 18, 19, tzinfo=timezone.utc)
        result = rw.process_due_reminders(SETTINGS, db, telegram, now=instant)
        self.assertEqual(result.deferred, 1)
        self.assertEqual(telegram.calls, [])
        self.assertEqual(db.deferrals[0][1], "2026-05-19T03:00:00Z")
        self.assertEqual(db.rows[0]["remind_at"], "2026-05-19T12:00:00Z")

    def test_priority_exceptions_are_preserved(self):
        instant = datetime(2026, 5, 18, 23, tzinfo=timezone.utc)
        for metadata in [
            {"notification_kind": "instant_academic"},
            {"reminder_mode": "war"},
            {"reminder_mode": "duolingo"},
        ]:
            db = FakeDB()
            db.rows[0]["metadata_json"] = {
                **metadata,
                "event_at": "2026-05-20T12:00:00Z",
            }
            telegram = Telegram()
            rw.process_due_reminders(SETTINGS, db, telegram, now=instant)
            self.assertEqual(len(telegram.calls), 1)

    def test_near_event_never_postponed_and_morning_deadline_capped(self):
        setting = rw.replace(SETTINGS, local_timezone="Europe/London")
        now = datetime(2026, 5, 18, 23, tzinfo=timezone.utc)
        self.assertIsNone(
            rw.quiet_hour_deferral({"remind_at": "2026-05-18T23:30:00Z"}, setting, now)
        )
        self.assertEqual(
            rw.quiet_hour_deferral({"remind_at": "2026-05-19T06:30:00Z"}, setting, now),
            "2026-05-19T05:30:00Z",
        )

    def test_preparation_crossing_quiet_boundary_defers_before_send(self):
        db = FakeDB()
        db.rows[0]["metadata_json"] = {"event_at": "2026-05-20T12:00:00Z"}

        class Clock(datetime):
            value = datetime(2026, 5, 18, 22, 59, tzinfo=timezone.utc)

            @classmethod
            def now(cls, tz=None):
                return cls.value

        def prepare(row):
            Clock.value = datetime(2026, 5, 18, 23, 1, tzinfo=timezone.utc)
            return {}

        db.fetch_reminder_context = prepare
        telegram = Telegram()
        with patch.object(rw, "datetime", Clock):
            summary = rw.process_due_reminders(SETTINGS, db, telegram)
        self.assertEqual(telegram.calls, [])
        self.assertEqual(summary.deferred, 1)

    def test_invalid_profile_timezone_path_falls_back_to_utc(self):
        for zone in ["/etc/passwd", "../invalid", "Not/AZone"]:
            db = FakeDB()
            db.profiles["user-0"]["timezone"] = zone
            telegram = Telegram()
            rw.process_due_reminders(SETTINGS, db, telegram, now=NOW)
            self.assertIn("10:00 (UTC)", telegram.calls[0][1])

    def test_assignment_format_keeps_original_event_and_grade(self):
        reminder = {
            "message": "Lab 1",
            "remind_at": "2029-12-31T22:00:00Z",
            "metadata_json": {
                "notification_kind": "academic_assignment_deadline",
                "course_title": "Algorithms",
                "event_at": "2030-01-01T00:00:00Z",
                "grade_info": {"score": 8.0, "max_score": 10.0},
            },
        }
        text = rw.format_telegram_message(reminder, {}, "Asia/Qyzylorda")
        self.assertIn("Сдать до 2030-01-01 05:00 (Asia/Qyzylorda)", text)
        self.assertIn("8/10 (80%)", text)

    def test_instant_academic_body_unchanged(self):
        message = "Оценка по «Алгоритмы»: Задание 1 — 0/10"
        self.assertEqual(
            rw.format_telegram_message(
                {
                    "message": message,
                    "metadata_json": {"notification_kind": "instant_academic"},
                },
                {},
            ),
            message,
        )


if __name__ == "__main__":
    unittest.main()
