"""Restore-monitor regression reproduction; all external boundaries are mocked."""
from __future__ import annotations

from contextlib import ExitStack
import datetime as dt
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from lifeos_monitor import collect
from ops_common import atomic_json


class MonitorRestoreFreshnessTests(unittest.TestCase):
    def restore_check(self, *, newer_failure=False, success_updates=None,
                      attempt_updates=None, attempt_absent=False, service_result="success"):
        now = dt.datetime(2026, 11, 3, 16, 20, tzinfo=dt.timezone.utc)
        prior_finished = now.replace(hour=14, minute=16)
        origin = "https://lifeos.example.invalid"
        with tempfile.TemporaryDirectory(prefix="lifeos-restore-monitor-test-") as temporary:
            root = Path(temporary)
            archive = root / "fixture.dump.enc"
            archive.write_bytes(b"synthetic encrypted archive fixture")
            checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
            manifest = root / "fixture.manifest.json"
            atomic_json(manifest, {"filename": archive.name})
            atomic_json(root / "last-success.json", {
                "verified": True, "completed_at_utc": now.isoformat(),
                "manifest": str(manifest), "cipher_sha256": checksum,
                "offsite": {"verified": True}})
            prior = {"success": True, "started_at_utc": prior_finished.replace(minute=15).isoformat(),
                     "finished_at_utc": prior_finished.isoformat(),
                     "migration_count": 52, "schema_and_data_restored": True,
                     "canonical_owner_verified": True, "row_counts_match_archive": True,
                     "isolated_container_removed": True, "source_backup_sha256": "a" * 64}
            prior.update(success_updates or {})
            atomic_json(root / "last-restore-success.json", prior)
            latest = ({"success": False, "started_at_utc": now.replace(minute=10).isoformat(),
                       "finished_at_utc": now.replace(minute=11).isoformat(),
                       "isolated_container_removed": True, "error": "restore_internal_error",
                       "source_backup_sha256": "b" * 64} if newer_failure else dict(prior))
            latest.update(attempt_updates or {})
            if not attempt_absent:
                atomic_json(root / "last-restore-attempt.json", latest)
            config = {"bot_env_file": "unused-synthetic-env", "public_origin": origin,
                      "canonical_telegram_user_id": 12345,
                      "canonical_user_id": "00000000-0000-4000-8000-000000000001", "state_dir": str(root),
                      "backup_dir": str(root), "offsite_remote": "fixture:backups"}
            environment = {"TMA_URL": origin + "/tma/", "TELEGRAM_BOT_TOKEN": "synthetic-no-authority"}
            response = {"status": "ok", "ok": True, "data": {}, "asset": "/tma/assets/fixture.js",
                        "result": {"url": origin + "/telegram/webhook", "pending_update_count": 0}}
            def fake_command(args, **kwargs):
                if args[:2] == ["systemctl", "is-active"]:
                    return b"active\n"
                if args[:4] == ["systemctl", "--user", "show", "lifeos-backup.service"]:
                    return b"LoadState=loaded\nResult=success\n"
                if args[:4] == ["systemctl", "--user", "show", "lifeos-restore-drill.service"]:
                    self.assertEqual(args[4:], ["-p", "LoadState", "-p", "Result"])
                    self.assertEqual(kwargs.get("timeout"), 10)
                    return ("LoadState=loaded\nResult=" + service_result + "\n").encode()
                raise AssertionError("unexpected external command")
            with ExitStack() as stack:
                stack.enter_context(patch("lifeos_monitor.env_file", return_value=environment))
                stack.enter_context(patch("lifeos_monitor.http", return_value=(200, json.dumps(response).encode(),
                    {"Content-Type": "text/html", "Cache-Control": "no-store"})))
                stack.enter_context(patch("lifeos_monitor.command", side_effect=fake_command))
                management = stack.enter_context(patch("lifeos_monitor.Management"))
                management.return_value.query.return_value = [{"is_active": True, "is_token_valid": True,
                    "auth_mode": "token", "last_sync_success_at": now.isoformat()}]
                stack.enter_context(patch("lifeos_monitor.source_preflight"))
                stack.enter_context(patch("lifeos_monitor.utcnow", return_value=now))
                stack.enter_context(patch("lifeos_monitor.time.time", return_value=now.timestamp()))
                stack.enter_context(patch("lifeos_monitor.shutil.disk_usage", return_value=SimpleNamespace(free=8 * 1024**3)))
                sends = stack.enter_context(patch("lifeos_monitor.send_alert", side_effect=AssertionError("unexpected send")))
                processes = stack.enter_context(patch("subprocess.run", side_effect=AssertionError("unexpected subprocess")))
                connections = stack.enter_context(patch("socket.create_connection", side_effect=AssertionError("unexpected network")))
                checks = collect(config)
                sends.assert_not_called()
                processes.assert_not_called()
                connections.assert_not_called()
            self.assertEqual({name: row for name, row in checks.items()
                              if name != "restore_drill" and row["status"] != "OK"}, {})
            return checks["restore_drill"]

    def test_fresh_success_without_later_failure_is_healthy(self):
        self.assertEqual(self.restore_check()["status"], "OK")

    def test_newer_failed_restore_must_not_be_hidden_by_fresh_prior_success(self):
        actual = self.restore_check(newer_failure=True)
        self.assertEqual((actual["status"], actual["code"]),
                         ("FAIL", "restore_drill_last_attempt_failed"))

    def test_older_failed_attempt_does_not_hide_newer_success(self):
        actual = self.restore_check(attempt_updates={"success": False,
            "finished_at_utc": "2026-11-03T14:15:00+00:00"})
        self.assertEqual(actual["status"], "OK")

    def test_successful_newer_attempt_is_healthy(self):
        actual = self.restore_check(attempt_updates={"success": True,
            "finished_at_utc": "2026-11-03T16:11:00+00:00"})
        self.assertEqual(actual["status"], "OK")

    def test_legacy_success_without_an_attempt_file_is_healthy(self):
        self.assertEqual(self.restore_check(attempt_absent=True)["status"], "OK")

    def test_equal_time_failed_attempt_is_not_a_verified_success(self):
        actual = self.restore_check(attempt_updates={"success": False})
        self.assertEqual(actual, {"status": "FAIL", "code": "restore_drill_last_attempt_failed"})

    def test_timezone_offsets_are_compared_as_instants(self):
        older = self.restore_check(attempt_updates={"success": False,
            "finished_at_utc": "2026-11-03T20:15:00+06:00"})
        self.assertEqual(older["status"], "OK")
        newer = self.restore_check(newer_failure=True,
            success_updates={"finished_at_utc": "2026-11-03T20:16:00+06:00"})
        self.assertEqual(newer, {"status": "FAIL", "code": "restore_drill_last_attempt_failed"})

    def test_malformed_or_nonaware_success_timestamps_fail_closed(self):
        for value in [None, True, 123, "", "not-a-time", "2026-11-03T14:16:00", "2026-11-03"]:
            with self.subTest(value=value):
                actual = self.restore_check(success_updates={"finished_at_utc": value})
                self.assertEqual(actual, {"status": "FAIL", "code": "restore_drill_timestamp_invalid"})

    def test_malformed_or_nonaware_attempt_timestamps_fail_closed(self):
        for value in [None, True, 123, "", "not-a-time", "2026-11-03T16:11:00", "2026-11-03"]:
            with self.subTest(value=value):
                actual = self.restore_check(newer_failure=True, attempt_updates={"finished_at_utc": value})
                self.assertEqual(actual, {"status": "FAIL", "code": "restore_drill_timestamp_invalid"})

    def test_future_success_and_attempt_timestamps_fail_closed(self):
        future = "2026-11-03T16:21:00+00:00"
        success = self.restore_check(success_updates={"finished_at_utc": future})
        self.assertEqual(success, {"status": "FAIL", "code": "restore_drill_stale"})
        for succeeded in [True, False]:
            with self.subTest(attempt_success=succeeded):
                actual = self.restore_check(attempt_updates={"success": succeeded, "finished_at_utc": future})
                self.assertEqual(actual, {"status": "FAIL", "code": "restore_drill_timestamp_invalid"})

    def test_invalid_attempt_outcomes_fail_closed(self):
        for value in [None, 0, 1, "false", "true"]:
            with self.subTest(value=value):
                actual = self.restore_check(attempt_updates={"success": value})
                self.assertEqual(actual, {"status": "FAIL", "code": "restore_drill_attempt_invalid"})

    def test_failed_loaded_service_is_not_hidden_by_recent_success(self):
        for result in ["exit-code", "timeout", "signal", "oom-kill", "resources"]:
            with self.subTest(result=result):
                actual = self.restore_check(service_result=result)
                self.assertEqual(actual, {"status": "FAIL", "code": "restore_drill_service_failed"})


if __name__ == "__main__":
    unittest.main()
