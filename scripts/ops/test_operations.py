from __future__ import annotations

import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from backup_crypto import decrypt, encrypt
from lifeos_backup import MANAGED_BY, PostgresClient, archive_counts, assert_archive_data, predeploy, retention_candidates, run_backup, verify_backup
from lifeos_monitor import run_monitor, update_incident
from ops_common import OpsError, atomic_json, lock
from restore_drill import assert_isolated

PROJECT = "abcdefghijklmnopqrst"
OWNER = "00000000-0000-4000-8000-000000000001"


class EncryptionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "plain"
        self.source.write_bytes(b"PGDMP\x00private-user-history" * 1000)
        self.key = os.urandom(32)
        self.metadata = {"kind": "postgres-custom", "project_ref": PROJECT, "format": 1}

    def envelope(self):
        target = self.root / "encrypted"
        details = encrypt(self.source, target, self.key, self.metadata)
        return target, details

    def test_round_trip_checks_real_bytes_and_private_mode(self):
        target, details = self.envelope()
        output = self.root / "decrypted"
        verified = decrypt(target, output, self.key, expected_project=PROJECT)
        self.assertEqual(output.read_bytes(), self.source.read_bytes())
        self.assertEqual(verified["plaintext_sha256"], details["plaintext_sha256"])
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)

    def test_ciphertext_tag_header_and_wrong_key_fail_without_plaintext_residue(self):
        target, _ = self.envelope()
        original = target.read_bytes()
        for index in [20, len(original) // 2, len(original) - 1]:
            with self.subTest(index=index):
                changed = bytearray(original)
                changed[index] ^= 1
                target.write_bytes(changed)
                output = self.root / "rejected"
                with self.assertRaises(OpsError):
                    decrypt(target, output, self.key, expected_project=PROJECT)
                self.assertFalse(output.exists())
        target.write_bytes(original)
        output = self.root / "wrong-key"
        with self.assertRaises(OpsError):
            decrypt(target, output, os.urandom(32), expected_project=PROJECT)
        self.assertFalse(output.exists())

    def test_authenticated_project_mismatch_and_truncation_are_rejected(self):
        target, _ = self.envelope()
        output = self.root / "wrong-project"
        with self.assertRaisesRegex(OpsError, "identity_mismatch"):
            decrypt(target, output, self.key, expected_project="z" * 20)
        self.assertFalse(output.exists())
        target.write_bytes(target.read_bytes()[:40])
        with self.assertRaises(OpsError):
            decrypt(target, output, self.key, expected_project=PROJECT)

    def test_existing_or_symlink_targets_are_never_overwritten(self):
        target, _ = self.envelope()
        original = target.read_bytes()
        with self.assertRaises(OpsError):
            encrypt(self.source, target, self.key, self.metadata)
        self.assertEqual(target.read_bytes(), original)
        linked = self.root / "link"
        linked.symlink_to(target)
        with self.assertRaises(OpsError):
            decrypt(linked, self.root / "out", self.key, expected_project=PROJECT)

    def test_authenticated_malformed_header_leaves_no_plaintext(self):
        # Even possession of the key must not turn malformed metadata into an
        # unhandled exception that leaves a decrypted file behind.
        target = self.root / "bad-header"
        encrypt(self.source, target, self.key, [])
        output = self.root / "bad-header-plaintext"
        with self.assertRaisesRegex(OpsError, "header_invalid"):
            decrypt(target, output, self.key, expected_project=PROJECT)
        self.assertFalse(output.exists())


class ArchiveTests(unittest.TestCase):
    def test_canonical_identity_and_actual_copy_rows_including_unicode_notes(self):
        sql = ("COPY auth.users (id, email) FROM stdin;\n" + OWNER + "\ttest@example.invalid\n\\.\n"
               "COPY public.profiles (user_id, telegram_user_id, status, display_name) FROM stdin;\n" + OWNER + "\t12345\tactive\tline\u2028still one field\n\\.\n"
               "COPY public.workouts (id, user_id, notes) FROM stdin;\nworkout\t" + OWNER + "\tunknown\\nnot a new row\n\\.\n")
        counts, canonical = archive_counts(sql, OWNER, 12345)
        self.assertEqual(counts["public.profiles"], 1)
        self.assertEqual(canonical["public.profiles"], 1)
        self.assertEqual(counts["public.workouts"], 1)
        self.assertEqual(canonical["auth.users"], 1)
        config = {"minimum_rows": {"profiles": 1, "auth_users": 1, "workouts": 1},
                  "canonical_minimum_rows": {"public.workouts": 1}}
        assert_archive_data(config, counts, canonical)
        _, foreign = archive_counts(sql, OWNER, 99999)
        with self.assertRaisesRegex(OpsError, "canonical_identity"):
            assert_archive_data(config, counts, foreign)

    def test_valid_empty_archive_never_passes_userdata_guard(self):
        counts, canonical = archive_counts("COPY public.profiles (user_id) FROM stdin;\n\\.\n", OWNER, 12345)
        with self.assertRaisesRegex(OpsError, "missing_real_userdata"):
            assert_archive_data({"minimum_rows": {"profiles": 2}}, counts, canonical)

    def test_checksum_failure_is_detected_before_docker_or_decryption(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            name = "lifeos-v1-20261103T001000Z-abcdef12.dump.enc"
            (root / name).write_bytes(b"tampered")
            manifest = root / "file.manifest.json"
            atomic_json(manifest, {"managed_by": MANAGED_BY, "filename": name, "cipher_sha256": "wrong"})
            with patch("lifeos_backup.PostgresClient") as client:
                with self.assertRaisesRegex(OpsError, "checksum"):
                    verify_backup({}, manifest)
                client.assert_not_called()


class RetentionTests(unittest.TestCase):
    def test_only_old_owned_verified_pairs_and_minimum_seven_are_selected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            now = dt.datetime(2026, 11, 3, tzinfo=dt.timezone.utc)
            for index in range(10):
                stem = "lifeos-v1-20260901T0000" + str(index).zfill(2) + "Z-" + str(index).zfill(8)
                data = root / (stem + ".dump.enc")
                data.write_bytes(str(index).encode())
                atomic_json(root / (stem + ".manifest.json"), {
                    "managed_by": MANAGED_BY, "filename": data.name, "verified": True,
                    "cipher_sha256": hashlib.sha256(data.read_bytes()).hexdigest(),
                    "created_at_utc": (now - dt.timedelta(days=40 + index)).isoformat()})
            historical = root / "data.sql"
            historical.write_text("never delete the existing backup")
            unknown = root / "other.dump.enc"
            unknown.write_text("not ours")
            candidates = retention_candidates(root, now)
            self.assertEqual(len(candidates), 3)
            self.assertTrue(all(pair[0].name.startswith("lifeos-v1-") for pair in candidates))
            self.assertTrue(historical.exists())
            self.assertTrue(unknown.exists())
            with self.assertRaises(OpsError):
                retention_candidates(root, now, days=1)


class BackupFailureTests(unittest.TestCase):
    def test_dump_is_consistent_bounded_readonly_tls_and_cleans_temporary_password(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            certificate = root / "ca.crt"
            certificate.write_text("-----BEGIN CERTIFICATE-----\nfixture\n")
            certificate.chmod(0o600)
            client = PostgresClient({"database_ca_file": str(certificate)})
            class ManagementFixture:
                ref = PROJECT
                def request(self, route, body=None):
                    if route == "/config/database/pooler":
                        return [{"db_host": "aws-0-test.pooler.supabase.com"}]
                    return {"role": "cli_login_supabase_read_only_user", "ttl_seconds": 300,
                            "password": "fixture-secret"}
            with patch("lifeos_backup.time.sleep"), \
                    patch("lifeos_backup.command", return_value=b"supabase_read_only_user|on\n") as probe, \
                    patch.object(client, "run", return_value=b"PGDMPfixture") as dump:
                self.assertEqual(client.dump(ManagementFixture(), root), b"PGDMPfixture")
            options = dump.call_args
            self.assertNotIn("--serializable-deferrable", options.args[1])
            self.assertIn("--lock-wait-timeout=15000", options.args[1])
            self.assertIn("--role=supabase_read_only_user", options.args[1])
            self.assertEqual(options.kwargs["timeout"], 180)
            self.assertEqual(options.kwargs["environment"]["PGSSLMODE"], "verify-full")
            self.assertIn("default_transaction_read_only=on", options.kwargs["environment"]["PGOPTIONS"])
            self.assertIn("statement_timeout=120000", options.kwargs["environment"]["PGOPTIONS"])
            self.assertEqual(probe.call_count, 1)
            self.assertFalse((root / "pgpass").exists())

    def test_offsite_quota_failure_preserves_verified_local_success_and_pauses_pruning(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            key = root / "key"
            key.write_bytes(os.urandom(32))
            key.chmod(0o600)
            counts = {"auth.users": 1, "public.profiles": 1, "public.workouts": 1}
            canonical = {"auth.users": 1, "public.profiles": 1, "public.workouts": 1}
            config = {"backup_dir": str(root / "backups"), "state_dir": str(root / "state"),
                      "key_file": str(key), "project_ref": PROJECT, "offsite_remote": "existing:Backups-v1",
                      "minimum_rows": {"auth_users": 1, "profiles": 1, "workouts": 1},
                      "retention_enabled": True}
            with patch("lifeos_backup.Management"), patch("lifeos_backup.source_preflight", return_value={"migration_count": 48}), \
                    patch("lifeos_backup.ram_directory", return_value=root), patch("lifeos_backup.PostgresClient") as client, \
                    patch("lifeos_backup.offsite_copy", side_effect=OpsError("offsite_storage_quota_exceeded")), \
                    patch("lifeos_backup.retention_candidates") as prune:
                client.return_value.dump.return_value = b"PGDMPsynthetic private backup"
                client.return_value.inspect_archive.return_value = counts, canonical
                result = run_backup(config)
            self.assertEqual(result["status"], "partial")
            self.assertTrue(result["verified"])
            self.assertFalse(result["offsite_verified"])
            success = json.loads((root / "state/last-success.json").read_text())
            self.assertTrue(success["verified"])
            self.assertEqual(success["offsite"]["error"], "offsite_storage_quota_exceeded")
            self.assertTrue(Path(success["manifest"]).exists())
            prune.assert_not_called()

    def test_predeploy_requires_recent_restore_of_the_matching_schema(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "manifest.json"
            atomic_json(manifest, {"migration_count": 48})
            now = dt.datetime.now(dt.timezone.utc).isoformat()
            atomic_json(root / "last-success.json", {"verified": True, "completed_at_utc": now, "manifest": str(manifest)})
            config = {"state_dir": str(root)}
            with patch("lifeos_backup.verify_backup"), patch("lifeos_backup.Management"), \
                    patch("lifeos_backup.source_preflight", return_value={"migration_count": 48}) as current:
                with self.assertRaisesRegex(OpsError, "matching_schema_restore"):
                    predeploy(config)
                atomic_json(root / "last-restore-success.json", {"success": True, "migration_count": 47, "finished_at_utc": now})
                with self.assertRaisesRegex(OpsError, "matching_schema_restore"):
                    predeploy(config)
                atomic_json(root / "last-restore-success.json", {"success": True, "migration_count": 48, "finished_at_utc": now})
                self.assertTrue(predeploy(config)["verified"])
                current.return_value = {"migration_count": 49}
                with self.assertRaisesRegex(OpsError, "current_schema_backup"):
                    predeploy(config)


class RestoreGuardTests(unittest.TestCase):
    def setUp(self):
        self.identifier = "a" * 32
        self.name = "lifeos-restore-v1-" + self.identifier
        self.database = "lifeos_restore_" + self.identifier
        self.info = {"Name": "/" + self.name,
                     "Config": {"Labels": {"lifeos.ops.restore_id": self.identifier}},
                     "HostConfig": {"NetworkMode": "none", "PortBindings": {},
                                    "Tmpfs": {"/var/lib/postgresql/data": "rw,size=512m"}},
                     "Mounts": [{"Type": "bind", "Destination": "/backup.dump", "RW": False},
                                {"Type": "tmpfs", "Destination": "/var/lib/postgresql/data", "RW": True}]}

    def check(self, info=None, database=None, container=None):
        assert_isolated(info or self.info, container=container or self.name,
                        identifier=self.identifier, database=database or self.database)

    def test_new_network_none_tmpfs_readonly_archive_is_accepted(self):
        self.check()

    def test_existing_production_or_rescue_targets_ports_and_volumes_are_rejected(self):
        for name in ["lifeos-rescue-sb17", "lifeos-bot", "postgres"]:
            with self.subTest(name=name), self.assertRaises(OpsError):
                self.check(container=name)
        with self.assertRaises(OpsError):
            self.check(database="postgres")
        for mutation in [lambda x: x["HostConfig"].update(NetworkMode="host"),
                         lambda x: x["HostConfig"].update(PortBindings={"5432/tcp": [{"HostPort": "5432"}]}),
                         lambda x: x["HostConfig"].update(Tmpfs={}),
                         lambda x: x["Config"]["Labels"].clear(),
                         lambda x: x["Mounts"].append({"Type": "volume", "Destination": "/data", "RW": True}),
                         lambda x: x["Mounts"][0].update(RW=True)]:
            changed = copy.deepcopy(self.info)
            mutation(changed)
            with self.assertRaises(OpsError):
                self.check(changed)


class IncidentTests(unittest.TestCase):
    def test_upgrade_does_not_preserve_a_suppressed_critical_failure(self):
        failed = {"status": "FAIL", "code": "backup_last_attempt_failed"}
        legacy = {**failed, "failures": 3, "baseline": True, "reserved": False}
        state, notify = update_incident(legacy, failed)
        self.assertFalse(state["baseline"])
        self.assertTrue(notify)

    def test_initial_critical_failure_alerts_after_threshold(self):
        failed = {"status": "FAIL", "code": "backend_unavailable"}
        state, notify = update_incident(None, failed)
        self.assertFalse(notify)
        self.assertFalse(state["baseline"])
        state, notify = update_incident(state, failed)
        self.assertTrue(notify)

    def test_known_initial_degraded_baseline_does_not_spam(self):
        current = {"status": "WARN", "code": "lms_reconnect_required"}
        state = None
        for _ in range(20):
            state, notify = update_incident(state, current)
            self.assertFalse(notify)

    def test_failure_requires_two_observations_and_recovery_rearms(self):
        state, _ = update_incident(None, {"status": "OK", "code": "available"})
        failed = {"status": "FAIL", "code": "http_probe_failed"}
        state, notify = update_incident(state, failed)
        self.assertFalse(notify)
        state, notify = update_incident(state, failed)
        self.assertTrue(notify)
        state["reserved"] = True
        state, notify = update_incident(state, failed)
        self.assertFalse(notify)
        state, _ = update_incident(state, {"status": "OK", "code": "available"})
        state, _ = update_incident(state, failed)
        _, notify = update_incident(state, failed)
        self.assertTrue(notify)

    def test_ambiguous_telegram_failure_is_reserved_before_send_and_never_retried(self):
        with tempfile.TemporaryDirectory() as temporary:
            config = {"state_dir": temporary, "alerts_enabled": True, "suppress_initial_alerts": False}
            with patch("lifeos_monitor.collect", return_value={"backend": {"status": "OK", "code": "available"}}):
                run_monitor(config)
            failed = {"backend": {"status": "FAIL", "code": "http_probe_failed"}}
            with patch("lifeos_monitor.collect", return_value=failed), patch("lifeos_monitor.send_alert", side_effect=OpsError("ambiguous")) as send:
                run_monitor(config)
                result = run_monitor(config)
                run_monitor(config)
                self.assertEqual(send.call_count, 1)
                self.assertEqual(result["alert_delivery"][0]["status"], "unconfirmed_no_automatic_retry")
            self.assertTrue(json.loads((Path(temporary) / "incidents.json").read_text())["backend"]["reserved"])

    def test_dry_run_never_sends_or_changes_incident_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            config = {"state_dir": temporary, "alerts_enabled": True, "suppress_initial_alerts": False, "alert_failure_threshold": 1}
            with patch("lifeos_monitor.collect", return_value={"backend": {"status": "FAIL", "code": "down"}}), patch("lifeos_monitor.send_alert") as send:
                run_monitor(config, dry_run=True)
                send.assert_not_called()
            self.assertFalse((Path(temporary) / "incidents.json").exists())

    def test_overlapping_jobs_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "job.lock"
            with lock(path):
                with self.assertRaisesRegex(OpsError, "already_running"):
                    with lock(path):
                        self.fail("overlapping operation acquired the lock")


if __name__ == "__main__":
    unittest.main()
