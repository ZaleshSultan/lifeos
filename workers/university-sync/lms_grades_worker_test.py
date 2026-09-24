"""Load the actual master entrypoint and exercise both platform settings."""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

SPEC = importlib.util.spec_from_file_location("lms_grades_worker", Path(__file__).with_name("lms_grades_worker.py"))
worker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = worker
SPEC.loader.exec_module(worker)

BASE = worker.BaseSettings("https://example.supabase.co", "test-key", "user-a", "Asia/Almaty")
ROW = {"username": "test", "encrypted_password": "test", "ws_token_encrypted": "test-token"}


class MasterWorkerTest(unittest.TestCase):
    def test_aitu_settings_disable_mock_and_do_not_use_owner_cookie(self):
        db = MagicMock()
        db.start_sync_run.return_value = "run-a"
        with patch.object(worker, "decrypt_field", side_effect=lambda value: value), patch.object(worker, "MoodleClient") as client, patch.object(worker, "sync_moodle_grades") as sync:
            client.return_value.fetch_grades.return_value = []
            client.return_value.is_mocked = False
            worker._handle_aitu_moodle(db, BASE, ROW)
        settings = client.call_args.args[0]
        self.assertFalse(settings.allow_mock)
        self.assertIsNone(settings.sso_cookie)
        self.assertEqual(settings.base.user_id, "user-a")
        self.assertEqual(sync.call_args.kwargs["run_id"], "run-a")

    def test_platonus_settings_construct_and_reuse_run(self):
        db = MagicMock()
        db.start_sync_run.return_value = "run-b"
        with patch.object(worker, "decrypt_field", side_effect=lambda value: value), patch.object(worker, "PlatonusClient") as client, patch.object(worker, "sync_platonus_grades") as sync:
            worker._handle_platonus(db, BASE, ROW)
        self.assertFalse(client.call_args.args[0].allow_mock)
        self.assertEqual(sync.call_args.kwargs["run_id"], "run-b")

    def test_fetch_failure_finishes_run(self):
        db = MagicMock()
        db.start_sync_run.return_value = "run-a"
        with patch.object(worker, "decrypt_field", side_effect=lambda value: value), patch.object(worker, "MoodleClient") as client:
            client.return_value.fetch_grades.side_effect = worker.SyncError("expired session")
            with self.assertRaises(worker.SyncError):
                worker._handle_aitu_moodle(db, BASE, ROW)
        self.assertEqual(db.finish_sync_run.call_args.args[:2], ("run-a", "failed"))

    def test_user_settings_updates_are_scoped_and_master_is_unchanged(self):
        master = MagicMock()
        row = {**ROW, "id": "config-b", "user_id": "user-b", "platform_type": "aitu_moodle"}
        handler = worker.PlatformHandler("test", MagicMock(return_value=worker.SyncStats()))
        with patch.dict(worker.PLATFORM_HANDLERS, {"aitu_moodle": handler}), patch.object(worker, "SupabaseRestClient") as factory:
            worker.sync_config(master, BASE, row)
        self.assertEqual(BASE.user_id, "user-a")
        self.assertEqual(factory.call_args.args[0].user_id, "user-b")
        for call in master.request.call_args_list:
            self.assertEqual(call.kwargs["query"], {"id": "eq.config-b", "user_id": "eq.user-b"})
