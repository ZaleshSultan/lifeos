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


class FakeMaster:
    def __init__(self, row):
        self.row = dict(row)
        self.request = MagicMock(side_effect=self._request)

    def _request(self, method, table, query=None, body=None):
        if table.startswith("rpc/"):
            return True
        matches = all(self.row.get(key) == value[3:] for key, value in (query or {}).items()
                      if key in {"id", "user_id", "session_version", "sync_requested_at"})
        if method == "GET":
            return [dict(self.row)] if matches else []
        if method == "PATCH" and matches:
            self.row.update(body)
        return None


class MasterWorkerTest(unittest.TestCase):
    def test_aitu_settings_disable_mock_and_do_not_use_owner_cookie(self):
        db = MagicMock()
        db.settings = BASE
        db.start_sync_run.return_value = "run-a"
        with patch.object(worker, "decrypt_field", side_effect=lambda value: value), patch.object(worker, "MoodleClient") as client, patch.object(worker, "sync_moodle_grades") as sync:
            client.return_value.fetch_grades.return_value = []
            client.return_value.fetch_assignments.return_value = None
            client.return_value.is_mocked = False
            worker._handle_aitu_moodle(db, BASE, ROW)
        settings = client.call_args.args[0]
        self.assertFalse(settings.allow_mock)
        self.assertIsNone(settings.sso_cookie)
        self.assertEqual(settings.base.user_id, "user-a")
        self.assertEqual(sync.call_args.kwargs["run_id"], "run-a")
        self.assertIsNone(sync.call_args.kwargs["assignments"])

    def test_platonus_settings_construct_and_reuse_run(self):
        db = MagicMock()
        db.settings = BASE
        db.start_sync_run.return_value = "run-b"
        with patch.object(worker, "decrypt_field", side_effect=lambda value: value), patch.object(worker, "PlatonusClient") as client, patch.object(worker, "sync_platonus_grades") as sync:
            worker._handle_platonus(db, BASE, ROW)
        self.assertFalse(client.call_args.args[0].allow_mock)
        self.assertEqual(sync.call_args.kwargs["run_id"], "run-b")

    def test_fetch_failure_finishes_run(self):
        db = MagicMock()
        db.settings = BASE
        db.start_sync_run.return_value = "run-a"
        with patch.object(worker, "decrypt_field", side_effect=lambda value: value), patch.object(worker, "MoodleClient") as client:
            client.return_value.fetch_grades.side_effect = worker.SyncError("expired session")
            with self.assertRaises(worker.SyncError):
                worker._handle_aitu_moodle(db, BASE, ROW)
        self.assertEqual(db.finish_sync_run.call_args.args[:2], ("run-a", "failed"))

    def test_user_settings_updates_are_scoped_and_master_is_unchanged(self):
        row = {**ROW, "id": "config-b", "user_id": "user-b", "platform_type": "aitu_moodle"}
        master = FakeMaster(row)
        handler = worker.PlatformHandler("test", MagicMock(return_value=worker.SyncStats()))
        with patch.dict(worker.PLATFORM_HANDLERS, {"aitu_moodle": handler}), patch.object(worker, "SupabaseRestClient") as factory:
            worker.sync_config(master, BASE, row)
        self.assertEqual(BASE.user_id, "user-a")
        self.assertEqual(factory.call_args.args[0].user_id, "user-b")
        for call in master.request.call_args_list:
            if call.args[:2] == ("PATCH", "user_lms_settings"):
                self.assertEqual(call.kwargs["query"], {"id": "eq.config-b", "user_id": "eq.user-b"})

    def test_session_mode_passes_only_the_verified_users_cookie_without_password_or_ws_fallback(self):
        db = MagicMock()
        db.settings = BASE
        row = {**ROW, "user_id": "user-a", "auth_mode": "session", "sso_cookie_encrypted": "encrypted-value", "session_expires_at": "2030-01-01T00:00:00Z"}
        with patch.object(worker, "decrypt_lms_session", return_value="private-cookie") as decrypt, patch.object(worker, "decrypt_field") as password, patch.object(worker, "MoodleClient") as client, patch.object(worker, "sync_moodle_grades") as sync:
            client.return_value.fetch_grades.return_value = []
            client.return_value.fetch_assignments.return_value = None
            client.return_value.is_mocked = False
            worker._handle_aitu_moodle(db, BASE, row)
        self.assertEqual(client.call_args.args[0].sso_cookie, "private-cookie")
        self.assertEqual(client.call_args.args[0].password, "")
        self.assertIsNone(client.call_args.args[0].ws_token)
        decrypt.assert_called_once_with("encrypted-value", "user-a", expires_at="2030-01-01T00:00:00Z")
        password.assert_not_called()
        persisted_settings = sync.call_args.args[1]
        self.assertIsNone(persisted_settings.sso_cookie)
        self.assertIsNone(persisted_settings.ws_token)
        self.assertEqual(persisted_settings.password, "")
        client.return_value.close.assert_called_once()
        self.assertIsNone(client.return_value._session)
        self.assertIsNone(client.return_value._sso_cookie)

    def test_foreign_user_session_is_rejected_before_client_creation(self):
        db = MagicMock()
        db.settings = BASE
        with patch.object(worker, "MoodleClient") as client:
            with self.assertRaises(worker.LmsSessionError):
                worker._handle_aitu_moodle(db, BASE, {**ROW, "user_id": "user-b", "auth_mode": "session"})
        client.assert_not_called()
        db.start_sync_run.assert_not_called()

    def test_expired_session_is_never_sent_to_moodle(self):
        db = MagicMock()
        db.settings = BASE
        row = {"user_id": "user-a", "auth_mode": "session", "sso_cookie_encrypted": "must-not-decrypt", "session_expires_at": "2020-01-01T00:00:00Z"}
        with patch.object(worker, "MoodleClient") as client:
            with self.assertRaises(worker.LmsSessionError) as caught:
                worker._handle_aitu_moodle(db, BASE, row)
        self.assertEqual(caught.exception.category, "session_expired")
        self.assertEqual(db.finish_sync_run.call_args.args[3], "session_expired")
        client.assert_not_called()

    def session_row(self):
        return {"id": "config-a", "user_id": "user-a", "platform_type": "aitu_moodle", "auth_mode": "session",
                "session_version": "version-a", "sso_cookie_encrypted": "encrypted-private-cookie", "session_expires_at": "2030-01-01T00:00:00Z"}

    def test_success_and_failure_updates_include_owner_and_session_rotation_guard(self):
        row = self.session_row()
        master = FakeMaster(row)
        handler = worker.PlatformHandler("test", MagicMock(return_value=worker.SyncStats(seen=3)))
        with patch.dict(worker.PLATFORM_HANDLERS, {"aitu_moodle": handler}), patch.object(worker, "SupabaseRestClient"):
            self.assertTrue(worker.sync_config(master, BASE, row))
        self.assertEqual(master.row["session_state"], "connected")
        self.assertTrue(master.row["is_token_valid"])
        for call in master.request.call_args_list:
            if call.args[:2] == ("PATCH", "user_lms_settings"):
                self.assertEqual(call.kwargs["query"], {"id": "eq.config-a", "user_id": "eq.user-a", "session_version": "eq.version-a"})

    def test_auth_expiry_scrubs_only_matching_session_and_reports_expired_state(self):
        row = self.session_row()
        master = FakeMaster(row)
        handler = worker.PlatformHandler("test", MagicMock(side_effect=worker.LmsSessionError("session_expired", "session_expired")))
        with patch.dict(worker.PLATFORM_HANDLERS, {"aitu_moodle": handler}), patch.object(worker, "SupabaseRestClient"):
            self.assertFalse(worker.sync_config(master, BASE, row))
        self.assertEqual(master.row["session_state"], "session_expired")
        self.assertIsNone(master.row["sso_cookie_encrypted"])
        self.assertIsNone(master.row["session_expires_at"])
        self.assertFalse(master.row["is_token_valid"])
        self.assertNotIn("last_sync_success_at", master.row)

    def test_transient_failure_retains_session_and_never_logs_raw_secrets(self):
        row = self.session_row()
        master = FakeMaster(row)
        handler = worker.PlatformHandler("test", MagicMock(side_effect=RuntimeError("private-cookie and service-role-key")))
        with patch.dict(worker.PLATFORM_HANDLERS, {"aitu_moodle": handler}), patch.object(worker, "SupabaseRestClient"), self.assertLogs(worker.log, level="ERROR") as logs:
            self.assertFalse(worker.sync_config(master, BASE, row))
        self.assertEqual(master.row["session_state"], "error")
        self.assertEqual(master.row["last_error_category"], "sync_failed")
        self.assertEqual(master.row["sso_cookie_encrypted"], "encrypted-private-cookie")
        self.assertNotIn("private-cookie", " ".join(logs.output))
        self.assertNotIn("service-role-key", " ".join(logs.output))

    def test_rotation_or_removal_before_lock_acquisition_skips_stale_snapshot(self):
        old = self.session_row()
        master = FakeMaster({**old, "session_version": "version-new", "sso_cookie_encrypted": "new-private-cookie"})
        handler = worker.PlatformHandler("test", MagicMock())
        with patch.dict(worker.PLATFORM_HANDLERS, {"aitu_moodle": handler}):
            self.assertFalse(worker.sync_config(master, BASE, old))
        handler.run.assert_not_called()
        self.assertEqual(master.row["sso_cookie_encrypted"], "new-private-cookie")

    def test_shared_lease_contention_performs_no_scrape_or_settings_mutation(self):
        master = FakeMaster(self.session_row())
        master.request.side_effect = lambda *_args, **_kwargs: False
        handler = worker.PlatformHandler("test", MagicMock())
        with patch.dict(worker.PLATFORM_HANDLERS, {"aitu_moodle": handler}):
            self.assertFalse(worker.sync_config(master, BASE, self.session_row()))
        handler.run.assert_not_called()
        self.assertEqual(master.request.call_count, 1)

    def test_password_mode_preserves_legacy_session_state(self):
        row = {**ROW, "id": "config-a", "user_id": "user-a", "platform_type": "aitu_moodle", "auth_mode": "password", "session_state": "not_configured"}
        master = FakeMaster(row)
        handler = worker.PlatformHandler("test", MagicMock(return_value=worker.SyncStats()))
        with patch.dict(worker.PLATFORM_HANDLERS, {"aitu_moodle": handler}), patch.object(worker, "SupabaseRestClient"):
            self.assertTrue(worker.sync_config(master, BASE, row))
        self.assertEqual(master.row["session_state"], "not_configured")

    def test_polling_snapshots_paginated_due_configs_before_updating_attempts(self):
        master = MagicMock()
        master.request.side_effect = [[{"id": str(i)} for i in range(100)], [{"id": "100"}]]
        with patch.object(worker, "purge_expired_sessions"), patch.object(worker, "sync_config", side_effect=lambda *_args: master.request.call_count == 2) as sync:
            self.assertEqual(worker.run_once(master, BASE), 101)
        self.assertEqual(sync.call_count, 101)
        for call in master.request.call_args_list:
            self.assertIn("sync_requested_at.not.is.null", call.kwargs["query"]["or"])
            self.assertEqual(call.kwargs["query"]["is_active"], "eq.true")
            self.assertEqual(call.kwargs["query"]["limit"], "100")

    def test_manual_sync_poll_does_not_wait_for_four_hour_automatic_interval(self):
        with patch.object(worker, "run_once", return_value=0) as run, patch.object(worker.time, "sleep", side_effect=StopIteration) as sleep:
            with self.assertRaises(StopIteration):
                worker.run_loop(MagicMock(), BASE, 14400)
        run.assert_called_once_with(unittest.mock.ANY, BASE, 14400)
        sleep.assert_called_once_with(30)

    def test_expired_session_cleanup_includes_inactive_integrations_without_reading_ciphertext(self):
        row = {**self.session_row(), "is_active": False, "session_expires_at": "2020-01-01T00:00:00Z"}
        master = FakeMaster(row)
        self.assertEqual(worker.purge_expired_sessions(master), 1)
        self.assertIsNone(master.row["sso_cookie_encrypted"])
        self.assertEqual(master.row["session_state"], "session_expired")
        fetch = master.request.call_args_list[0]
        self.assertNotIn("is_active", fetch.kwargs["query"])
        self.assertNotIn("sso_cookie_encrypted", fetch.kwargs["query"]["select"])
        update = next(call for call in master.request.call_args_list if call.args[0] == "PATCH")
        for key, value in {"id": "eq.config-a", "user_id": "eq.user-a", "session_version": "eq.version-a"}.items():
            self.assertEqual(update.kwargs["query"][key], value)
        self.assertIn("session_expires_at.lte.", update.kwargs["query"]["or"])

    def test_expiry_cleanup_cannot_erase_a_concurrently_rotated_session(self):
        old = self.session_row()
        master = FakeMaster({**old, "session_version": "version-new", "sso_cookie_encrypted": "new-private-cookie"})
        original = master.request.side_effect
        def request(method, table, query=None, body=None):
            if method == "GET":
                return [{"id": old["id"], "user_id": old["user_id"], "platform_type": old["platform_type"], "session_version": old["session_version"]}]
            return original(method, table, query=query, body=body)
        master.request.side_effect = request
        worker.purge_expired_sessions(master)
        self.assertEqual(master.row["sso_cookie_encrypted"], "new-private-cookie")

    def test_decryption_failure_uses_allowed_category_and_reconnect_state(self):
        row = self.session_row()
        master = FakeMaster(row)
        handler = worker.PlatformHandler("test", MagicMock(side_effect=worker.LmsSessionError("invalid_session")))
        with patch.dict(worker.PLATFORM_HANDLERS, {"aitu_moodle": handler}), patch.object(worker, "SupabaseRestClient"):
            self.assertFalse(worker.sync_config(master, BASE, row))
        self.assertEqual(master.row["last_error_category"], "decryption_failed")
        self.assertEqual(master.row["session_state"], "reauthentication_required")
        self.assertIsNone(master.row["sso_cookie_encrypted"])

    def test_finishing_sync_run_is_explicitly_owner_scoped(self):
        db = worker.SupabaseRestClient(BASE)
        db.request = MagicMock()
        db.finish_sync_run("run-a", "success", worker.SyncStats())
        self.assertEqual(db.request.call_args.args[2], {"id": "eq.run-a", "user_id": "eq.user-a"})

    def test_partial_sync_stays_authenticated_but_is_flagged_incomplete(self):
        row = self.session_row()
        master = FakeMaster(row)
        def partial(_db, _base, current):
            current["_unsupported_features"] = ["html_inventory_not_provably_complete"]
            current["_data_read"] = True
            return worker.SyncStats(seen=2)
        handler = worker.PlatformHandler("test", partial)
        with patch.dict(worker.PLATFORM_HANDLERS, {"aitu_moodle": handler}), patch.object(worker, "SupabaseRestClient"):
            self.assertTrue(worker.sync_config(master, BASE, row))
        self.assertTrue(master.row["is_token_valid"])
        self.assertEqual(master.row["session_state"], "connected")
        self.assertEqual(master.row["last_error_category"], "partial_sync")
        self.assertIn("last_sync_success_at", master.row)

    def test_all_unsupported_pages_do_not_advance_last_success(self):
        row = {**self.session_row(), "last_sync_success_at": "2026-01-01T00:00:00Z"}
        master = FakeMaster(row)
        def unsupported(_db, _base, current):
            current["_unsupported_features"] = ["grade_html_incomplete", "activity_html_incomplete"]
            current["_data_read"] = False
            return worker.SyncStats()
        with patch.dict(worker.PLATFORM_HANDLERS, {"aitu_moodle": worker.PlatformHandler("test", unsupported)}), patch.object(worker, "SupabaseRestClient"):
            self.assertTrue(worker.sync_config(master, BASE, row))
        self.assertEqual(master.row["last_sync_success_at"], "2026-01-01T00:00:00Z")
        self.assertEqual(master.row["last_error_category"], "partial_sync")
        self.assertEqual(master.row["session_state"], "connected")

    def test_empty_incomplete_html_snapshots_require_a_verified_page_to_count_as_data_read(self):
        class Snapshot(list):
            complete = False
            verified_pages = 0
        for verified in (0, 1):
            db = MagicMock()
            db.settings = BASE
            row = dict(ROW)
            assignments = Snapshot()
            assignments.verified_pages = verified
            with patch.object(worker, "decrypt_field", side_effect=lambda value: value), patch.object(worker, "MoodleClient") as client, patch.object(worker, "sync_moodle_grades"):
                client.return_value.fetch_grades.return_value = Snapshot()
                client.return_value.fetch_assignments.return_value = assignments
                client.return_value.is_mocked = False
                worker._handle_aitu_moodle(db, BASE, row)
            self.assertEqual(row["_data_read"], verified == 1)

    def test_sync_once_cli_does_not_print_raw_database_failures(self):
        with patch.object(worker, "load_dotenv"), patch.object(worker, "load_base_settings", return_value=BASE), patch.object(worker, "SupabaseRestClient"), patch.object(worker, "run_once", side_effect=worker.SyncError("private-ciphertext and service-role-key")), patch.object(sys, "argv", ["lms_grades_worker.py", "sync-once"]), self.assertLogs(worker.log, level="ERROR") as logs:
            self.assertEqual(worker.main(), 1)
        self.assertNotIn("private-ciphertext", " ".join(logs.output))
        self.assertNotIn("service-role-key", " ".join(logs.output))
