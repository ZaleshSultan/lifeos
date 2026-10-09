from __future__ import annotations

import importlib.util
import io
import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
import urllib.error

MODULE_PATH = Path(__file__).with_name("daily_digest_worker.py")
SPEC = importlib.util.spec_from_file_location("daily_digest_worker", MODULE_PATH)
assert SPEC and SPEC.loader
worker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = worker
SPEC.loader.exec_module(worker)


class DailyDigestTest(unittest.TestCase):
    def test_settings_default_blank_and_explicit_send_time(self) -> None:
        fixtures = {
            "SUPABASE_URL": "https://example.invalid",
            "SUPABASE_SERVICE_ROLE_KEY": "not-a-secret",
            "TELEGRAM_BOT_TOKEN": "not-a-token",
        }
        for configured, expected in [(None, "06:00"), ("", "06:00"), ("06:00", "06:00"), ("07:30", "07:30")]:
            with self.subTest(configured=configured):
                values = dict(fixtures)
                if configured is not None:
                    values["DAILY_DIGEST_TIME"] = configured
                with patch.dict(worker.os.environ, values, clear=True):
                    # Never read the running worker's real .env in a unit test.
                    with patch.object(worker, "load_dotenv"):
                        self.assertEqual(worker.load_settings().digest_time, expected)
        with patch.dict(worker.os.environ, {**fixtures, "DAILY_DIGEST_TIME": "6am"}, clear=True):
            with patch.object(worker, "load_dotenv"):
                with self.assertRaisesRegex(worker.WorkerError, "HH:MM"):
                    worker.load_settings()

    def test_deadlines_use_owned_courses_and_stable_source_identity(self) -> None:
        class FakeDb(worker.SupabaseRestClient):
            def __init__(self):
                self.queries = []

            def request(self, method, table, query=None, **_kwargs):
                self.queries.append((table, query))
                if table == "study_courses":
                    return [{"id": "owned-course", "title": "Курс"}]
                if table == "source_events":
                    return [{"id": "event-1", "external_id": "assignment:moodle:42:7", "title": "Same title", "due_at": "2026-10-09T05:00:00Z", "raw_json": {"related_grade_external_id": "academic:moodle:42:77"}}]
                if table == "life_entities":
                    return [{"id": "manual-1", "title": "Same title", "due_at": "2026-10-09T05:00:00Z"}]
                if table == "assessment_items":
                    return [{"id": "assessment-1", "study_course_id": "owned-course", "external_id": "academic:moodle:42:77", "source": "aitu_moodle", "title": "Same title", "due_at": "2026-10-09T05:00:00Z", "status": "pending"}]
                return []

        db = FakeDb()
        rows = db.list_deadlines("user-a", "2026-10-08T00:00:00Z", "2026-10-15T00:00:00Z")
        self.assertEqual(len(rows), 2)  # linked LMS grade deduped; independent manual deadline retained
        for table, query in db.queries:
            if table == "assessment_items":
                self.assertEqual(query["study_course_id"], "in.(owned-course)")
            else:
                self.assertEqual(query["user_id"], "eq.user-a")

    def test_first_online_class_is_separate_from_campus_arrival(self) -> None:
        local = datetime(2026, 10, 5, 6, tzinfo=worker.resolve_timezone("Asia/Almaty"))
        lines = worker.first_class_lines(local, [{"id": "c", "title": "Курс"}], [
            {"study_course_id": "c", "start_time": "16:00", "room": "C1.2.101"},
            {"study_course_id": "c", "start_time": "08:00", "room": "Online"},
            {"study_course_id": "c", "start_time": "10:00", "room": "C1.2.223"},
        ])
        self.assertIn("Первая онлайн: <b>08:00</b>", "\n".join(lines))
        self.assertIn("Первая очная: <b>10:00</b>", "\n".join(lines))

    def test_default_six_am_and_invalid_frontend_url(self) -> None:
        self.assertEqual(worker.DEFAULT_DIGEST_TIME, "06:00")
        self.assertEqual(datetime(2026, 10, 5, tzinfo=worker.resolve_timezone("Invalid/Zone")).utcoffset().total_seconds(), 18000)
        with self.assertRaises(worker.WorkerError):
            worker.build_tma_url("http://example.com/api/tma/study")
        self.assertNotIn("studyTab", worker.build_tma_url("https://example.com/tma/?studyTab=grades"))

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


    def test_first_class_highlight_before_weather_and_tasks(self) -> None:
        local = datetime(2026, 10, 5, 6, 0, tzinfo=worker.resolve_timezone("Asia/Almaty"))
        text = worker.build_digest(
            local, "Asia/Almaty", [{"title": "Домашка"}],
            [{"id": "c1", "title": "DBMS <2026>"}, {"id": "c2", "title": "OS"}],
            [
                {"study_course_id": "c2", "start_time": "12:00:00", "end_time": "12:50:00"},
                {"study_course_id": "c1", "start_time": "10:00:00", "end_time": "10:50:00", "room": "C1.2.223"},
            ],
            [], {"location_name": "Astana", "temperature": 4, "weather_label": "пасмурно"},
        )
        self.assertIn("🚨 Первая пара: 10:00 — DBMS &lt;2026&gt; · C1.2.223", text)
        self.assertIn("До первой пары: 4 ч", text)
        self.assertLess(text.index("🚨 Первая пара"), text.index("Astana"))
        self.assertLess(text.index("🚨 Первая пара"), text.index("✅ Дела на сегодня"))
        self.assertIn("12:00–12:50", text)

    def test_first_class_empty_schedule_and_started_finished(self) -> None:
        tz = worker.resolve_timezone("Asia/Almaty")
        self.assertEqual(worker.first_class_lines(datetime(2026, 10, 5, 6, tzinfo=tz), [], []),
                         ["<b>🎓 Сегодня пар нет</b>"])
        self.assertIn("проверь время", worker.first_class_lines(
            datetime(2026, 10, 5, 6, tzinfo=tz), [], [{"start_time": "unknown"}]
        )[0])
        class_rows = [{"start_time": "10:00:00", "end_time": "10:50:00"}]
        self.assertIn("идёт сейчас", worker.first_class_lines(
            datetime(2026, 10, 5, 10, 30, tzinfo=tz), [], class_rows
        )[1])
        self.assertIn("уже закончилась", worker.first_class_lines(
            datetime(2026, 10, 5, 11, tzinfo=tz), [], class_rows
        )[1])

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
        class FakeDb:
            def __init__(self):
                self.completed = []

            def claim_delivery(self, *_args):
                return "claim-token"

            def start_delivery(self, *_args):
                return True

            def list_today_tasks(self, *_args):
                return [{"id": "t1", "title": "Разобрать конспект", "due_at": None}]

            def list_courses(self, *_args):
                return [{"id": "c1", "title": "Networks", "code": "CNC53-EN"}]

            def list_schedule(self, *_args):
                return [{
                    "study_course_id": "c1",
                    "start_time": "14:00:00",
                    "end_time": "14:50:00",
                    "session_type": "practical",
                    "room": "C1.2.243K",
                }]

            def list_deadlines(self, *_args):
                return [{
                    "title": "Lab",
                    "course": "Networks",
                    "due_at": "2026-10-06T12:00:00Z",
                }]

            def user_settings(self, *_args):
                return {}

            def complete_delivery(self, user_id, local_date, token, message_id):
                self.completed.append((user_id, local_date, token, message_id))

            def release_delivery(self, *_args):
                raise AssertionError("successful send must not release the claim")

        class FakeTelegram:
            def __init__(self):
                self.sent = []

            def send_message(self, chat_id, text, reply_markup=None):
                self.sent.append((chat_id, text, reply_markup))
                return 321

        db = FakeDb()
        telegram = FakeTelegram()
        settings = worker.Settings(
            supabase_url="https://example.supabase.co",
            service_role_key="key",
            telegram_bot_token="token",
            tma_url="https://lifeos.example/tma/",
        )
        now = datetime(2026, 10, 5, 3, 5, tzinfo=timezone.utc)
        sent = worker.process_profile(
            db, telegram, settings,
            {"user_id": "user-1", "telegram_user_id": 123, "timezone": "Asia/Almaty"},
            now,
        )

        self.assertTrue(sent)
        self.assertEqual(db.completed, [("user-1", "2026-10-05", "claim-token", 321)])
        self.assertEqual(len(telegram.sent), 1)
        chat_id, text, markup = telegram.sent[0]
        self.assertEqual(chat_id, "123")
        self.assertIn("Разобрать конспект", text)
        self.assertIn("14:00–14:50", text)
        self.assertIn("Lab", text)
        self.assertEqual(
            markup["inline_keyboard"][0][1]["web_app"]["url"],
            "https://lifeos.example/tma/?screen=study&studyTab=map",
        )
        links = {button["text"]: button["web_app"]["url"]
                 for row in markup["inline_keyboard"] for button in row}
        self.assertIn("studyTab=assignments", links["Задания"])
        self.assertIn("studyTab=calculator", links["Калькулятор"])

    def test_process_profile_is_idempotent_when_claim_is_rejected(self) -> None:
        class FakeDb:
            def claim_delivery(self, *_args):
                return False

        class FakeTelegram:
            def send_message(self, *_args, **_kwargs):
                raise AssertionError("must not send without a claim")

        settings = worker.Settings(
            supabase_url="https://example.supabase.co",
            service_role_key="key",
            telegram_bot_token="token",
        )
        now = datetime(2026, 10, 5, 3, 5, tzinfo=timezone.utc)  # 08:05 Almaty
        sent = worker.process_profile(
            FakeDb(), FakeTelegram(), settings,
            {"user_id": "user-1", "telegram_user_id": 123, "timezone": "Asia/Almaty"},
            now,
        )
        self.assertFalse(sent)


class DeliveryRpcTest(unittest.TestCase):
    def test_claim_uses_atomic_rpc_and_null_is_a_normal_repeat(self) -> None:
        client = worker.SupabaseRestClient("https://example.invalid", "not-a-secret")
        with patch.object(client, "request", side_effect=["claim-uuid", None]) as request:
            self.assertEqual(client.claim_delivery("user-a", "2026-10-08", "123"), "claim-uuid")
            self.assertIsNone(client.claim_delivery("user-a", "2026-10-08", "123"))
        for call in request.call_args_list:
            self.assertEqual(call.args, ("POST", "rpc/claim_daily_digest_delivery"))
            self.assertEqual(call.kwargs["body"]["p_chat_id"], 123)

    def test_database_failure_is_not_treated_as_a_normal_duplicate(self) -> None:
        client = worker.SupabaseRestClient("https://example.invalid", "not-a-secret")
        with patch.object(client, "request", side_effect=worker.WorkerError("HTTP 503")):
            with self.assertRaises(worker.WorkerError):
                client.claim_delivery("user-a", "2026-10-08", "123")

    def test_completion_rejects_a_stale_claim(self) -> None:
        client = worker.SupabaseRestClient("https://example.invalid", "not-a-secret")
        with patch.object(client, "request", return_value=False):
            with self.assertRaisesRegex(worker.WorkerError, "completion rejected"):
                client.complete_delivery("user-a", "2026-10-08", "old-token", 42)


class FakeDeliveryDb:
    def __init__(self):
        self.status = None
        self.completed = 0
        self.released = []
        self.fetch_failure = False
        self.completion_failures = 0
        self.allow_start = True

    def claim_delivery(self, *_args):
        if self.status not in (None, "retry"):
            return None
        self.status = "preparing"
        return "claim-token"

    def start_delivery(self, *_args):
        if not self.allow_start:
            return False
        self.status = "sending"
        return True

    def complete_delivery(self, *_args):
        self.completed += 1
        if self.completion_failures:
            self.completion_failures -= 1
            raise worker.WorkerError("completion unavailable")
        self.status = "sent"

    def release_delivery(self, *_args, uncertain=False):
        self.released.append(uncertain)
        self.status = "uncertain" if uncertain else "retry"

    def list_today_tasks(self, *_args):
        if self.fetch_failure:
            raise worker.WorkerError("fetch unavailable")
        return []

    def list_courses(self, *_args):
        return []

    def list_schedule(self, *_args):
        return []

    def list_deadlines(self, *_args):
        return []

    def user_settings(self, *_args):
        return {}


class FakeDeliveryTelegram:
    def __init__(self):
        self.calls = 0
        self.failure = None

    def send_message(self, *_args):
        self.calls += 1
        if self.failure:
            raise self.failure
        return 42


class DeliveryRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeDeliveryDb()
        self.telegram = FakeDeliveryTelegram()
        self.settings = worker.Settings("https://example.invalid", "key", "token")
        self.profile = {"user_id": "user-a", "telegram_user_id": 123, "timezone": "Asia/Almaty"}
        self.now = datetime(2026, 10, 8, 1, 0, tzinfo=timezone.utc)  # 06:00 local

    def process(self):
        return worker.process_profile(self.db, self.telegram, self.settings, self.profile, self.now)

    def test_successful_send_remains_blocked_across_worker_restart(self):
        self.assertTrue(self.process())
        self.assertFalse(self.process())
        self.assertEqual(self.telegram.calls, 1)
        self.assertEqual(self.db.status, "sent")

    def test_preparation_failure_is_retriable_without_a_telegram_call(self):
        self.db.fetch_failure = True
        with self.assertRaises(worker.WorkerError):
            self.process()
        self.assertEqual(self.db.status, "retry")
        self.assertEqual(self.telegram.calls, 0)
        self.db.fetch_failure = False
        self.assertTrue(self.process())
        self.assertEqual(self.telegram.calls, 1)

    def test_definitive_telegram_rejection_retries_with_a_new_claim(self):
        self.telegram.failure = worker.TelegramRejected("429 retry later")
        with self.assertRaises(worker.TelegramRejected):
            self.process()
        self.assertEqual(self.db.status, "retry")
        self.telegram.failure = None
        self.assertTrue(self.process())
        self.assertEqual(self.telegram.calls, 2)

    def test_ambiguous_network_failure_does_not_send_again(self):
        self.telegram.failure = TimeoutError("response lost")
        with self.assertRaises(TimeoutError):
            self.process()
        self.assertEqual(self.db.status, "uncertain")
        self.telegram.failure = None
        self.assertFalse(self.process())
        self.assertEqual(self.telegram.calls, 1)

    def test_success_followed_by_db_failure_does_not_send_again(self):
        self.db.completion_failures = 2
        with self.assertRaises(worker.WorkerError):
            self.process()
        self.assertEqual(self.db.completed, 2)
        self.assertEqual(self.db.status, "uncertain")
        self.assertFalse(self.process())
        self.assertEqual(self.telegram.calls, 1)

    def test_completion_retry_reuses_claim_without_resending(self):
        self.db.completion_failures = 1
        self.assertTrue(self.process())
        self.assertEqual(self.db.completed, 2)
        self.assertEqual(self.telegram.calls, 1)
        self.assertEqual(self.db.status, "sent")

    def test_outbound_claim_stays_blocked_if_uncertain_update_also_fails(self):
        self.telegram.failure = TimeoutError("response lost")
        with patch.object(self.db, "release_delivery", side_effect=worker.WorkerError("database down")):
            with self.assertLogs(level="ERROR"):
                with self.assertRaises(TimeoutError):
                    self.process()
        self.assertEqual(self.db.status, "sending")
        self.telegram.failure = None
        self.assertFalse(self.process())
        self.assertEqual(self.telegram.calls, 1)

    def test_expired_claim_cannot_start_a_telegram_send(self):
        self.db.allow_start = False
        self.assertFalse(self.process())
        self.assertEqual(self.telegram.calls, 0)

    def test_window_starts_at_six_and_does_not_send_early(self):
        early = self.now.replace(hour=0, minute=59)
        self.assertFalse(worker.process_profile(self.db, self.telegram, self.settings, self.profile, early))
        self.assertIsNone(self.db.status)
        self.assertTrue(self.process())


class TelegramOutcomeTest(unittest.TestCase):
    def response(self, payload):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps(payload).encode()
        return Response()

    def test_success_requires_a_real_message_id(self):
        client = worker.TelegramClient("not-a-secret")
        with patch.object(worker.urllib.request, "urlopen", return_value=self.response({"ok": True, "result": {"message_id": 42}})):
            self.assertEqual(client.send_message("123", "hello"), 42)

    def test_explicit_telegram_429_is_retriable(self):
        error = urllib.error.HTTPError("https://example.invalid", 429, "rate limited", {}, io.BytesIO(b'{"ok":false,"error_code":429}'))
        with patch.object(worker.urllib.request, "urlopen", side_effect=error):
            with self.assertRaises(worker.TelegramRejected):
                worker.TelegramClient("not-a-secret").send_message("123", "hello")

    def test_server_error_or_invalid_proxy_response_is_ambiguous(self):
        for code, payload in [(502, b'{"ok":false,"error_code":502}'), (403, b'<html>proxy</html>')]:
            with self.subTest(code=code):
                error = urllib.error.HTTPError("https://example.invalid", code, "failed", {}, io.BytesIO(payload))
                with patch.object(worker.urllib.request, "urlopen", side_effect=error):
                    with self.assertRaises(worker.WorkerError) as raised:
                        worker.TelegramClient("not-a-secret").send_message("123", "hello")
                    self.assertNotIsInstance(raised.exception, worker.TelegramRejected)

    def test_success_response_without_message_id_is_ambiguous(self):
        with patch.object(worker.urllib.request, "urlopen", return_value=self.response({"ok": True, "result": {}})):
            with self.assertRaises(worker.WorkerError):
                worker.TelegramClient("not-a-secret").send_message("123", "hello")

    def test_nonobject_or_unreadable_response_is_ambiguous(self):
        for payload in [None, [], {"ok": True, "result": {"message_id": True}}]:
            with self.subTest(payload=payload):
                with patch.object(worker.urllib.request, "urlopen", return_value=self.response(payload)):
                    with self.assertRaises(worker.WorkerError):
                        worker.TelegramClient("not-a-secret").send_message("123", "hello")
        response = self.response(None)
        with patch.object(response, "read", return_value=b"<html>gateway error</html>"):
            with patch.object(worker.urllib.request, "urlopen", return_value=response):
                with self.assertRaisesRegex(worker.WorkerError, "unreadable response"):
                    worker.TelegramClient("not-a-secret").send_message("123", "hello")


class PollRecoveryTest(unittest.TestCase):
    def test_global_database_outage_does_not_terminate_poll_loop(self):
        settings = worker.Settings("https://example.invalid", "key", "token")
        with patch.object(worker, "load_settings", return_value=settings):
            with patch.object(worker, "run_once", side_effect=worker.WorkerError("profiles unavailable")) as run:
                with patch.object(worker.time, "sleep", side_effect=InterruptedError("end test")) as sleep:
                    with self.assertLogs(level="ERROR"):
                        with self.assertRaises(InterruptedError):
                            worker.main()
        self.assertEqual(run.call_count, 1)
        sleep.assert_called_once_with(settings.poll_seconds)


if __name__ == "__main__":
    unittest.main()
