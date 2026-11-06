from __future__ import annotations
import importlib.util
import io
import json
import hashlib
import sys
import tempfile
import unittest
import urllib.error
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import academic_notifications as academic
from common.notification_delivery import TelegramApiClient, TelegramDeliveryError, WorkerError


class AcademicPlanningTest(unittest.TestCase):
    def test_defaults_off_do_not_call_a_planning_rpc(self):
        class Store:
            def request(self, method, path, query=None, body=None):
                if method != "GET": raise AssertionError("defaults triggered planning")
                return [{"user_id": "f0000000-0000-4000-8000-000000000001", "preferences": {"classAlertsEnabled": False}}]
        self.assertEqual(academic.plan_notifications(Store()), {"queued": 0, "cancelled": 0, "failed": 0})

    def test_bounded_owner_pages_use_explicit_canonical_owner_each_rpc(self):
        class Store:
            def __init__(self): self.calls = []
            def request(self, method, path, query=None, body=None):
                self.calls.append((method, path, query, body))
                if method == "GET": return [{"user_id": "f0000000-0000-4000-8000-000000000001", "preferences": {"classAlertsEnabled": True}}, {"user_id": "f0000000-0000-4000-8000-000000000002", "preferences": {"examAlertsEnabled": True}}]
                return {"queued": 1, "cancelled": 0}
        store = Store()
        self.assertEqual(academic.plan_notifications(store, owner_limit=2), {"queued": 2, "cancelled": 0, "failed": 0})
        self.assertEqual([c[3]["p_user_id"] for c in store.calls if c[0] == "POST"], ["f0000000-0000-4000-8000-000000000001", "f0000000-0000-4000-8000-000000000002"])

    def test_legacy_assignments_are_planned_under_both_history_flag_states(self):
        for enabled in (False, True):
            with self.subTest(history_enabled=enabled):
                calls = []
                class Store:
                    def request(self, method, path, query=None, body=None):
                        calls.append((method, path, body))
                        if path == "academic_notification_preferences":
                            return [{"user_id": "f0000000-0000-4000-8000-000000000001", "preferences": {"assignmentAlertsEnabled": True}}]
                        if path == "rpc/plan_academic_notifications":
                            return {"queued": 1, "cancelled": 0}
                        raise AssertionError("unexpected transport")
                with patch("common.academic_grade_events.grade_events_enabled", return_value=enabled), patch("common.academic_intelligence_notifications.plan_intelligence_notifications", return_value={"queued": 0, "cancelled": 0, "failed": 0}) as v6:
                    result = academic.plan_notifications(Store())
                self.assertEqual(result, {"queued": 1, "cancelled": 0, "failed": 0})
                self.assertEqual([path for method, path, _ in calls if method == "POST"], ["rpc/plan_academic_notifications"])
                self.assertEqual(v6.call_count, int(enabled))

    def test_owner_parse_failure_cannot_become_an_unscoped_plan(self):
        class Store:
            def request(self, method, path, query=None, body=None):
                if method == "GET": return [{"user_id": "foreign;sql"}]
                raise AssertionError("must not call planner")
        with self.assertRaisesRegex(ValueError, "academic_owner_scope_invalid"):
            academic.plan_notifications(Store())

    def test_bad_rpc_reply_or_failed_owner_does_not_stop_other_reminders(self):
        class Store:
            def request(self, method, path, query=None, body=None):
                if method == "GET": return [{"user_id": "f0000000-0000-4000-8000-000000000001", "preferences": {"classAlertsEnabled": True}}]
                raise RuntimeError("private network credential must not escape")
        self.assertEqual(academic.plan_notifications(Store()), {"queued": 0, "cancelled": 0, "failed": 1})

    def test_owner_limit_is_bounded_and_never_accepts_boolean(self):
        for value in [0, 1001, True, "10"]:
            with self.assertRaises(ValueError): academic.plan_notifications(None, owner_limit=value)


class AcademicMapTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.patch_root = patch.object(academic, "PROJECT_ROOT", self.root)
        self.patch_root.start(); academic._map_manifest.cache_clear()
        self.image_path = f"/tma/campus-maps/{academic.MAP_COMMIT}/C1.3.319P.png"
        self.image = self.root / "apps/tma/dist" / self.image_path.removeprefix("/tma/")
        self.image.parent.mkdir(parents=True)
        data = b"\x89PNG\r\n\x1a\nsynthetic-cache"
        self.image.write_bytes(data)
        self.manifest = self.root / "packages/core/src/campus-map-data.json"
        self.manifest.parent.mkdir(parents=True)
        self.value = {"version": 1, "sourceCommit": academic.MAP_COMMIT, "interactiveUrl": "https://yuujiso.github.io/aitumap/", "aliases": {"C1.3.319": "C1.3.319P"}, "rooms": {"C1.3.319P": {"imagePath": self.image_path, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}}}
        self.manifest.write_text(json.dumps(self.value))

    def tearDown(self):
        academic._map_manifest.cache_clear(); self.patch_root.stop(); self.directory.cleanup()

    def test_exact_cached_room_and_only_reviewed_alias_resolve(self):
        expected = "https://lifeos.zalewko.me" + self.image_path
        self.assertEqual(academic.room_photo("C1.3.319P", "university_exam"), expected)
        self.assertEqual(academic.room_photo(" c1.3.319 ", "class"), expected)

    def test_unknown_ambiguous_remote_and_personal_locations_never_fetch_images(self):
        for value in ["C1.3.31", "C1.3.319K", "C1.3.319P/../../secret", "https://evil.invalid/photo", "Zoom", "Unknown room"]:
            self.assertIsNone(academic.room_photo(value, "class"))
        self.assertIsNone(academic.room_photo("C1.3.319P", "personal_exam"))
        self.assertIsNone(academic.room_photo("C1.3.319P", "assignment"))

    def test_missing_cache_is_plain_link_fallback_not_unverified_photo(self):
        self.image.unlink()
        self.assertIsNone(academic.room_photo("C1.3.319", "class"))

    def test_corrupted_or_changed_cached_bytes_fail_closed(self):
        self.image.write_bytes(b"\x89PNG\r\n\x1a\ncorrupt")
        self.assertIsNone(academic.room_photo("C1.3.319", "class"))

    def test_symlink_or_unapproved_manifest_path_is_rejected(self):
        original = self.image.with_suffix(".copy")
        self.image.rename(original); self.image.symlink_to(original)
        self.assertIsNone(academic.room_photo("C1.3.319", "class"))
        self.image.unlink(); original.rename(self.image)
        self.value["rooms"]["C1.3.319P"]["imagePath"] = "https://evil.invalid/image.png"
        self.manifest.write_text(json.dumps(self.value)); academic._map_manifest.cache_clear()
        self.assertIsNone(academic.room_photo("C1.3.319", "class"))

    def test_unreviewed_upstream_version_does_not_reuse_cached_geometry(self):
        self.value["sourceCommit"] = "0" * 40
        self.manifest.write_text(json.dumps(self.value)); academic._map_manifest.cache_clear()
        self.assertIsNone(academic.room_photo("C1.3.319", "class"))

    def test_caption_is_bounded_in_telegram_utf16_units_without_invented_time(self):
        caption = academic.photo_caption({"academic_title": "😀" * 500, "academic_room": "C1.3.319", "academic_start": "2026-11-17T05:00:00Z", "academic_source_type": "examfx"}, "Asia/Almaty", lambda value, zone: "10:00 (Asia/Almaty)")
        self.assertLessEqual(len(caption.encode("utf-16-le")), 2048)
        self.assertIn("10:00 (Asia/Almaty)", caption); self.assertIn("C1.3.319", caption); self.assertIn("examfx", caption); self.assertIn("Yuujiso", caption)


class PhotoTransportTest(unittest.TestCase):
    class Response:
        def __init__(self, raw): self.raw = raw
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self, n): return self.raw

    def client(self, raw=b'{"ok":true,"result":{"message_id":72}}', error=None):
        calls = []
        def opener(request, timeout):
            calls.append(request)
            if error: raise error
            return self.Response(raw)
        return TelegramApiClient("synthetic-token", opener=opener), calls

    def test_photo_uses_existing_fixed_telegram_transport_and_real_ack(self):
        client, calls = self.client()
        url = f"https://lifeos.zalewko.me/tma/campus-maps/{academic.MAP_COMMIT}/C1.3.319P.png"
        self.assertEqual(client.send_photo("7001", url, "Synthetic class 10:00"), 72)
        self.assertTrue(calls[0].full_url.endswith("/sendPhoto"))
        payload = json.loads(calls[0].data)
        self.assertEqual(payload, {"chat_id": "7001", "photo": url, "caption": "Synthetic class 10:00"})
        self.assertNotIn("parse_mode", payload)

    def test_arbitrary_url_or_oversized_caption_never_reaches_transport(self):
        client, calls = self.client()
        for url in ["https://evil.invalid/a.png", "http://lifeos.zalewko.me/a.png", "https://lifeos.zalewko.me/tma/campus-maps/../secret.png"]:
            with self.assertRaises(WorkerError): client.send_photo("7001", url, "Caption")
        url = f"https://lifeos.zalewko.me/tma/campus-maps/{academic.MAP_COMMIT}/C1.3.319P.png"
        with self.assertRaises(WorkerError): client.send_photo("7001", url, "😀" * 513)
        self.assertEqual(calls, [])

    def test_unknown_photo_delivery_has_no_automatic_text_fallback(self):
        client, calls = self.client(error=TimeoutError("private content"))
        url = f"https://lifeos.zalewko.me/tma/campus-maps/{academic.MAP_COMMIT}/C1.3.319P.png"
        with self.assertRaises(TelegramDeliveryError) as caught: client.send_photo("7001", url, "Synthetic")
        self.assertEqual(caught.exception.outcome, "unknown"); self.assertEqual(len(calls), 1)
        self.assertNotIn("private", str(caught.exception))

    def test_explicit_photo_429_retains_existing_retry_after_semantics(self):
        raw = b'{"ok":false,"error_code":429,"parameters":{"retry_after":120}}'
        error = urllib.error.HTTPError("https://invalid", 429, "private", {}, io.BytesIO(raw))
        client, calls = self.client(error=error)
        url = f"https://lifeos.zalewko.me/tma/campus-maps/{academic.MAP_COMMIT}/C1.3.319P.png"
        with self.assertRaises(TelegramDeliveryError) as caught: client.send_photo("7001", url, "Synthetic")
        self.assertEqual((caught.exception.outcome, caught.exception.retry_after_seconds), ("retry", 120)); self.assertEqual(len(calls), 1)


if __name__ == "__main__": unittest.main()
