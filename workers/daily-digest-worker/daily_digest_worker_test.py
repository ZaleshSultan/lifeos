from __future__ import annotations

import importlib.util
import sys
import unittest
from datetime import datetime, timezone
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
        class FakeDb:
            def __init__(self):
                self.completed = []

            def claim_delivery(self, *_args):
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

            def complete_delivery(self, user_id, local_date):
                self.completed.append((user_id, local_date))

            def release_delivery(self, *_args):
                raise AssertionError("successful send must not release the claim")

        class FakeTelegram:
            def __init__(self):
                self.sent = []

            def send_message(self, chat_id, text, reply_markup=None):
                self.sent.append((chat_id, text, reply_markup))

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
        self.assertEqual(db.completed, [("user-1", "2026-10-05")])
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


if __name__ == "__main__":
    unittest.main()
