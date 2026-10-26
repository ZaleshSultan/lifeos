from __future__ import annotations

import importlib.util
import io
import json
import sys
import unittest
from datetime import date, datetime, timezone
from unittest.mock import MagicMock, Mock, patch
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("daily_digest_worker.py")
SPEC = importlib.util.spec_from_file_location("daily_digest_worker", MODULE_PATH)
assert SPEC and SPEC.loader
worker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = worker
SPEC.loader.exec_module(worker)


class DailyDigestTest(unittest.TestCase):
    def test_digest_window_and_almaty_day_bounds(self) -> None:
        local = datetime(2026, 10, 5, 8, 7, tzinfo=worker.resolve_timezone("Asia/Almaty"))
        self.assertTrue(worker.digest_window(local, "08:00", 720))
        self.assertTrue(worker.digest_window(local.replace(hour=12, minute=30), "08:00", 720))
        self.assertFalse(worker.digest_window(local.replace(hour=20, minute=1), "08:00", 720))
        start, end = worker.utc_bounds(local.date(), "Asia/Almaty")
        self.assertEqual(start, "2026-10-04T19:00:00Z")
        self.assertEqual(end, "2026-10-05T19:00:00Z")


    def test_build_tma_url_preserves_existing_query_and_opens_map_tab(self) -> None:
        url = worker.build_tma_url(
            "https://lifeos.example/tma/?foo=bar",
            study_tab="map",
        )
        self.assertIn("foo=bar", url)
        self.assertIn("screen=study", url)
        self.assertIn("studyTab=map", url)


    def test_digest_greeting_adapts_during_catch_up_window(self) -> None:
        tz = worker.resolve_timezone("Asia/Almaty")
        self.assertEqual(worker.digest_greeting(datetime(2026, 10, 5, 8, 0, tzinfo=tz)), "Доброе утро")
        self.assertEqual(worker.digest_greeting(datetime(2026, 10, 5, 13, 0, tzinfo=tz)), "Добрый день")
        self.assertEqual(worker.digest_greeting(datetime(2026, 10, 5, 19, 0, tzinfo=tz)), "Добрый вечер")

    def test_build_digest_contains_tasks_schedule_and_deadlines(self) -> None:
        local = datetime(2026, 10, 5, 8, 0, tzinfo=worker.resolve_timezone("Asia/Almaty"))
        text = worker.build_digest(
            local,
            "Asia/Almaty",
            [{"title": "Сделать лабораторную", "due_at": "2026-10-05T05:30:00Z"}],
            [{"id": "c1", "title": "Операционные системы", "code": "OS52-EN"}],
            [{
                "study_course_id": "c1",
                "start_time": "10:00:00",
                "end_time": "10:50:00",
                "session_type": "lab",
                "room": "C1.2.223",
            }],
            [{
                "title": "Lab 4",
                "course": "Операционные системы",
                "due_at": "2026-10-06T12:00:00Z",
            }],
        )
        self.assertIn("Сделать лабораторную", text)
        self.assertIn("10:30", text)
        self.assertIn("10:00–10:50", text)
        self.assertIn("C1.2.223", text)
        self.assertIn("Lab 4", text)
        self.assertIn("06.10 17:00", text)


    def test_build_digest_includes_personal_weather(self) -> None:
        local = datetime(2026, 10, 5, 8, 0, tzinfo=worker.resolve_timezone("Asia/Almaty"))
        text = worker.build_digest(
            local, "Asia/Almaty", [], [], [], [],
            {
                "location_name": "Astana",
                "temperature": 4.2,
                "weather_label": "пасмурно",
                "min_temperature": -1.0,
                "max_temperature": 7.0,
                "precipitation_probability": 30,
            },
        )
        self.assertIn("Astana", text)
        self.assertIn("4°C", text)
        self.assertIn("осадки 30%", text)


    def test_process_profile_sends_full_digest_and_marks_delivery_complete(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        db.tasks = [{"id": "t1", "title": "Разобрать конспект", "due_at": None}]
        db.courses = [{"id": "c1", "title": "Networks", "code": "CNC53-EN"}]
        db.schedule = [{"study_course_id": "c1", "start_time": "14:00:00", "end_time": "14:50:00", "session_type": "practical", "room": "C1.2.243K"}]
        db.deadlines = [{"title": "Lab", "course": "Networks", "due_at": "2026-10-06T12:00:00Z"}]
        self.assertTrue(process(db, telegram))
        self.assertEqual(db.claim_requests, [("user-1", "2026-10-05")])
        self.assertEqual(db.finishes, [("sent", "none", 42, None)])
        self.assertEqual(db.events, ["claim", "tasks", "courses", "schedule", "deadlines", "settings", "begin", "finish"])
        chat_id, text, markup = telegram.sent[0]
        self.assertEqual(chat_id, "123")
        self.assertEqual(telegram.parse_modes, ["HTML"])
        self.assertIn("Разобрать конспект", text)
        self.assertIn("14:00–14:50", text)
        self.assertIn("Lab", text)
        self.assertEqual(markup["inline_keyboard"][0][1]["web_app"]["url"], "https://lifeos.example/tma/?screen=study&studyTab=map")

    def test_real_sender_preserves_html_and_inline_buttons(self) -> None:
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"ok":true,"result":{"message_id":42}}'
        opener = Mock(return_value=response)
        telegram = worker.TelegramClient("private-token", opener=opener)
        self.assertTrue(process(FakeDb(), telegram))
        request = opener.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(payload["parse_mode"], "HTML")
        self.assertIn("inline_keyboard", payload["reply_markup"])
        self.assertIn("<b>", payload["text"])

    def test_rejected_claim_never_reads_data_or_sends(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        db.claim = None
        self.assertFalse(process(db, telegram))
        self.assertEqual(db.events, ["claim"])
        self.assertEqual(telegram.sent, [])

    def test_crash_immediately_after_claim_does_not_delete_delivery(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        db.preparation_error = SystemExit("simulated process death")
        with self.assertRaises(SystemExit):
            process(db, telegram)
        self.assertEqual(db.finishes, [])
        self.assertEqual(telegram.sent, [])
        self.assertNotIn("begin", db.events)

    def test_preparation_database_failure_records_bounded_retry_not_send(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        db.preparation_error = RuntimeError("private task and service credential")
        with self.assertLogs(level="WARNING") as logs:
            self.assertFalse(process(db, telegram))
        self.assertEqual(db.finishes, [("retry", "preparation_failed", None, None)])
        self.assertEqual(telegram.sent, [])
        self.assertNotIn("private task", " ".join(logs.output))
        self.assertNotIn("begin", db.events)

    def test_database_connection_loss_recording_preparation_failure_is_safe(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        db.preparation_error = RuntimeError("secret")
        db.finish_error = RuntimeError("secret")
        with self.assertLogs(level="WARNING") as logs:
            self.assertFalse(process(db, telegram))
        self.assertEqual(telegram.sent, [])
        self.assertIn("delivery_state_unavailable", " ".join(logs.output))
        self.assertNotIn("secret", " ".join(logs.output))

    def test_lost_begin_response_does_not_start_telegram_request(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        db.begin_error = RuntimeError("possibly committed")
        with self.assertLogs(level="ERROR"):
            self.assertFalse(process(db, telegram))
        self.assertEqual(db.finishes, [])
        self.assertEqual(telegram.sent, [])

    def test_blocked_recipient_is_rechecked_before_request(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        db.chat_id = None
        self.assertFalse(process(db, telegram))
        self.assertIn("begin", db.events)
        self.assertEqual(telegram.sent, [])

    def test_blocked_snapshot_is_not_claimed(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        self.assertFalse(process(db, telegram, profile={**PROFILE, "status": "blocked"}))
        self.assertEqual(db.events, [])

    def test_authoritative_current_chat_is_used(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        db.chat_id = "456"
        self.assertTrue(process(db, telegram))
        self.assertEqual(telegram.sent[0][0], "456")

    def test_test_recipient_filter_cannot_follow_changed_link(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        db.chat_id = "456"
        settings = settings_for(test_telegram_user_id="123")
        self.assertFalse(process(db, telegram, settings=settings))
        self.assertEqual(db.finishes, [("cancelled", "test_recipient_changed", None, None)])
        self.assertEqual(telegram.sent, [])

    def test_telegram_timeout_is_unknown_without_automatic_retry(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        telegram.error = worker.TelegramDeliveryError("unknown", "network_error")
        with self.assertLogs(level="WARNING"):
            self.assertFalse(process(db, telegram))
        self.assertEqual(db.finishes, [("unknown", "network_error", None, None)])
        self.assertEqual(len(telegram.sent), 1)

    def test_definitely_rejected_rate_limit_preserves_retry_after(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        telegram.error = worker.TelegramDeliveryError("retry", "rate_limited", retry_after_seconds=120)
        with self.assertLogs(level="WARNING"):
            self.assertFalse(process(db, telegram))
        self.assertEqual(db.finishes, [("retry", "rate_limited", None, 120)])

    def test_permanent_telegram_rejection_is_terminal(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        telegram.error = worker.TelegramDeliveryError("permanent", "telegram_rejected")
        with self.assertLogs(level="WARNING"):
            self.assertFalse(process(db, telegram))
        self.assertEqual(db.finishes, [("permanent", "telegram_rejected", None, None)])

    def test_unexpected_send_error_does_not_leak_response_or_retry(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        telegram.error = ValueError("raw response with private reminder and token")
        with self.assertLogs(level="WARNING") as logs:
            self.assertFalse(process(db, telegram))
        self.assertEqual(db.finishes, [("unknown", "unexpected_send_error", None, None)])
        self.assertNotIn("private reminder", " ".join(logs.output))
        self.assertNotIn("token", " ".join(logs.output))

    def test_acknowledgement_then_database_failure_never_releases_or_resends(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        db.finish_error = RuntimeError("lost database response")
        with self.assertLogs(level="ERROR"):
            self.assertTrue(process(db, telegram))  # Counts a Telegram acknowledgement.
        self.assertEqual(db.finishes, [("sent", "none", 42, None)])
        db.claim = None  # The durable sending/sent row rejects a second claim.
        self.assertFalse(process(db, telegram))
        self.assertEqual(len(telegram.sent), 1)

    def test_recovery_runs_before_polling_after_worker_restart(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        self.assertEqual(worker.run_once(settings_for(), NOW, db=db, telegram=telegram), 1)
        self.assertEqual(db.events[0:2], ["recover", "profiles"])
        db.claim = None
        self.assertEqual(worker.run_once(settings_for(), NOW, db=db, telegram=telegram), 0)
        self.assertEqual(len(telegram.sent), 1)
        self.assertEqual(db.recoveries, 2)

    def test_poll_database_failure_does_not_terminate_loop(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        db.recover_error = RuntimeError("credential and personal data")
        with self.assertLogs(level="ERROR") as logs:
            self.assertEqual(worker.run_once(settings_for(), NOW, db=db, telegram=telegram), 0)
        self.assertEqual(telegram.sent, [])
        self.assertNotIn("credential", " ".join(logs.output))
        db.recover_error = None
        self.assertEqual(worker.run_once(settings_for(), NOW, db=db, telegram=telegram), 1)

    def test_one_profile_failure_does_not_block_another(self) -> None:
        db, telegram = FakeDb(), FakeTelegram()
        db.profiles = [{**PROFILE, "user_id": "broken"}, PROFILE]
        original_claim = db.claim_digest
        def claim(user_id, local_date):
            if user_id == "broken":
                raise RuntimeError("private database error")
            return original_claim(user_id, local_date)
        db.claim_digest = claim
        with self.assertLogs(level="ERROR") as logs:
            self.assertEqual(worker.run_once(settings_for(), NOW, db=db, telegram=telegram), 1)
        self.assertEqual(len(telegram.sent), 1)
        self.assertNotIn("private database", " ".join(logs.output))

    def test_timezone_windows_follow_each_recipient_local_date(self) -> None:
        cases = [
            ("Asia/Almaty", datetime(2026, 10, 5, 3, 5, tzinfo=timezone.utc), "2026-10-05"),
            ("Asia/Qyzylorda", datetime(2026, 10, 5, 3, 5, tzinfo=timezone.utc), "2026-10-05"),
            ("Europe/London", datetime(2026, 10, 5, 7, 5, tzinfo=timezone.utc), "2026-10-05"),
            ("America/New_York", datetime(2026, 10, 5, 12, 5, tzinfo=timezone.utc), "2026-10-05"),
        ]
        for zone, now, day in cases:
            with self.subTest(zone=zone):
                db, telegram = FakeDb(), FakeTelegram()
                self.assertTrue(process(db, telegram, profile={**PROFILE, "timezone": zone}, now=now))
                self.assertEqual(db.claim_requests, [("user-1", day)])
        db, telegram = FakeDb(), FakeTelegram()
        self.assertFalse(process(db, telegram, profile={**PROFILE, "timezone": "America/New_York"}, now=NOW))
        self.assertEqual(db.claim_requests, [])

    def test_invalid_or_empty_profile_timezone_matches_database_utc_fallback(self) -> None:
        for zone in ("", "invalid/timezone"):
            with self.subTest(zone=zone):
                db, telegram = FakeDb(), FakeTelegram()
                now = datetime(2026, 10, 5, 23, 5, tzinfo=timezone.utc)
                self.assertTrue(process(db, telegram, profile={**PROFILE, "timezone": zone},
                                        settings=settings_for(digest_time="20:00"), now=now))
                self.assertEqual(db.claim_requests, [("user-1", "2026-10-05")])

    def test_dst_spring_gap_runs_at_first_real_minute(self) -> None:
        tz = worker.resolve_timezone("America/New_York")
        before = datetime(2026, 3, 8, 6, 59, tzinfo=timezone.utc).astimezone(tz)
        after = datetime(2026, 3, 8, 7, 0, tzinfo=timezone.utc).astimezone(tz)
        self.assertFalse(worker.digest_window(before, "02:30", 60))
        self.assertTrue(worker.digest_window(after, "02:30", 60))
        self.assertFalse(worker.digest_window(after.replace(hour=4), "02:30", 60))

    def test_dst_fold_does_not_reopen_elapsed_window(self) -> None:
        tz = worker.resolve_timezone("America/New_York")
        first = datetime(2026, 11, 1, 5, 35, tzinfo=timezone.utc).astimezone(tz)
        second = datetime(2026, 11, 1, 6, 35, tzinfo=timezone.utc).astimezone(tz)
        self.assertTrue(worker.digest_window(first, "01:30", 30))
        self.assertFalse(worker.digest_window(second, "01:30", 30))

    def test_local_day_bounds_include_dst_and_midnight(self) -> None:
        cases = [
            (date(2026, 3, 8), "America/New_York", "2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z"),
            (date(2026, 11, 1), "America/New_York", "2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z"),
            (date(2026, 3, 29), "Europe/London", "2026-03-29T00:00:00Z", "2026-03-29T23:00:00Z"),
            (date(2026, 10, 25), "Europe/London", "2026-10-24T23:00:00Z", "2026-10-26T00:00:00Z"),
        ]
        for day, zone, start, end in cases:
            with self.subTest(day=day, zone=zone):
                self.assertEqual(worker.utc_bounds(day, zone), (start, end))
        local_midnight = datetime(2026, 10, 6, 0, 1, tzinfo=worker.resolve_timezone("Asia/Almaty"))
        self.assertFalse(worker.digest_window(local_midnight, "23:00", 120))

    def test_database_queries_keep_user_and_course_ownership_scope(self) -> None:
        db = worker.SupabaseRestClient("https://example.supabase.co", "key")
        db.request = Mock(return_value=[])
        db.list_today_tasks("owner", "start", "end")
        db.list_courses("owner")
        db.list_deadlines("owner", "now", "horizon")
        db.user_settings("owner")
        for call in db.request.call_args_list:
            self.assertEqual(call.args[2]["user_id"], "eq.owner")
        db.request.reset_mock()
        db.list_schedule(["owned-course"], "monday")
        self.assertEqual(db.request.call_args.args[2]["study_course_id"], "in.(owned-course)")
        db.request.reset_mock()
        self.assertEqual(db.list_schedule([], "monday"), [])
        db.request.assert_not_called()

    def test_status_prints_aggregate_health_without_initializing_telegram(self) -> None:
        client = Mock()
        client.queue_health.return_value = {"digest": {"unknown": 2, "sent": 5}}
        output = io.StringIO()
        with patch.object(worker, "load_settings", return_value=settings_for()), \
             patch.object(worker, "SupabaseRestClient", return_value=client), \
             patch.object(worker, "TelegramClient") as telegram, \
             patch.object(worker.sys, "stdout", output):
            self.assertEqual(worker.main(["--status"]), 0)
        telegram.assert_not_called()
        self.assertEqual(json.loads(output.getvalue()), {"digest": {"unknown": 2, "sent": 5}})

    def test_status_database_outage_is_safe_and_reports_failure(self) -> None:
        client = Mock()
        client.queue_health.side_effect = RuntimeError("private response with credential")
        with patch.object(worker, "load_settings", return_value=settings_for()), \
             patch.object(worker, "SupabaseRestClient", return_value=client), \
             self.assertLogs(level="ERROR") as logs:
            self.assertEqual(worker.main(["--status"]), 1)
        self.assertNotIn("credential", " ".join(logs.output))
        self.assertIn("health_unavailable", " ".join(logs.output))

    def test_http_database_error_discards_sensitive_response(self) -> None:
        import io
        import urllib.error
        db = worker.SupabaseRestClient("https://example.supabase.co", "private-key")
        error = urllib.error.HTTPError("url", 400, "bad request", {}, io.BytesIO(b"private response"))
        with patch.object(worker.urllib.request, "urlopen", side_effect=error):
            with self.assertRaises(worker.WorkerError) as caught:
                db.user_settings("owner")
        self.assertEqual(str(caught.exception), "database_http_error")
        self.assertIsNone(caught.exception.__cause__)


NOW = datetime(2026, 10, 5, 3, 5, tzinfo=timezone.utc)
PROFILE = {"user_id": "user-1", "telegram_user_id": 123, "timezone": "Asia/Almaty", "status": "active"}


def settings_for(**overrides):
    return worker.Settings(supabase_url="https://example.supabase.co", service_role_key="key", telegram_bot_token="token", tma_url="https://lifeos.example/tma/", **overrides)


def process(db, telegram, *, settings=None, profile=None, now=NOW):
    return worker.process_profile(db, telegram, settings or settings_for(), profile or PROFILE, now)


class FakeDb:
    def __init__(self):
        self.claim = {"id": "digest-1", "user_id": "user-1", "claim_token": "owner-token", "status": "processing"}
        self.claim_requests = []
        self.finishes = []
        self.events = []
        self.tasks, self.courses, self.schedule, self.deadlines = [], [], [], []
        self.chat_id = "123"
        self.preparation_error = self.begin_error = self.finish_error = self.recover_error = None
        self.recoveries = 0
        self.profiles = [PROFILE]

    def claim_digest(self, user_id, local_date):
        self.events.append("claim")
        self.claim_requests.append((user_id, local_date))
        return self.claim

    def list_today_tasks(self, *_args):
        self.events.append("tasks")
        if self.preparation_error:
            raise self.preparation_error
        return self.tasks

    def list_courses(self, *_args):
        self.events.append("courses")
        return self.courses

    def list_schedule(self, *_args):
        self.events.append("schedule")
        return self.schedule

    def list_deadlines(self, *_args):
        self.events.append("deadlines")
        return self.deadlines

    def user_settings(self, *_args):
        self.events.append("settings")
        return {}

    def begin_delivery(self, kind, claim):
        assert kind == "digest" and claim is self.claim
        self.events.append("begin")
        if self.begin_error:
            raise self.begin_error
        return self.chat_id

    def finish_delivery(self, kind, claim, outcome, reason="none", message_id=None, retry_after_seconds=None):
        assert kind == "digest" and claim is self.claim
        self.events.append("finish")
        self.finishes.append((outcome, reason, message_id, retry_after_seconds))
        if self.finish_error:
            raise self.finish_error
        return True

    def recover_deliveries(self, kind):
        assert kind == "digest"
        self.events.append("recover")
        self.recoveries += 1
        if self.recover_error:
            raise self.recover_error
        return {"recovered": 1, "unknown": 0}

    def active_profiles(self):
        self.events.append("profiles")
        return self.profiles


class FakeTelegram:
    def __init__(self):
        self.sent = []
        self.error = None
        self.parse_modes = []

    def send_message(self, chat_id, text, reply_markup=None, *, parse_mode=None):
        self.sent.append((chat_id, text, reply_markup))
        self.parse_modes.append(parse_mode)
        if self.error:
            raise self.error
        return 42


if __name__ == "__main__":
    unittest.main()
