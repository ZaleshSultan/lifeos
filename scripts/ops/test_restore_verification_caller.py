"""A release rehearsal must use its declared database caller, not the restorer."""
from contextlib import contextmanager
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from ops_common import OpsError
from restore_drill import restore_drill


class VerificationCallerTests(unittest.TestCase):
    @contextmanager
    def restored_fixture(self, *, actual_role=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "backup.manifest.json"
            manifest.write_text(json.dumps({"filename": "fixture.dump.enc", "cipher_sha256": "a" * 64,
                                           "migration_count": 56, "counts": {"profiles": 2}}))
            sql = root / "reviewed.sql"
            sql.write_text("select 'release_verification';")
            config = {"state_dir": str(root / "state"), "key_file": str(root / "key"),
                      "project_ref": "abcdefghijklmnopqrst", "canonical_user_id": "00000000-0000-4000-8000-000000000001",
                      "canonical_telegram_user_id": 1}
            role = actual_role or {"superuser": False, "bypassrls": True, "inherit": True}
            calls = []
            identity = {}

            def command(args, *, input=None, **kwargs):
                calls.append((list(args), input))
                if args[1] == "run":
                    name = args[args.index("--name") + 1]
                    identity.update(name=name, identifier=name.removeprefix("lifeos-restore-v1-"))
                elif args[1] == "inspect":
                    return json.dumps([{"Name": "/" + identity["name"],
                        "Config": {"Labels": {"lifeos.ops.restore_id": identity["identifier"]}},
                        "HostConfig": {"NetworkMode": "none", "PortBindings": {},
                                       "Tmpfs": {"/var/lib/postgresql/data": "rw,size=512m"}},
                        "Mounts": [{"Type": "bind", "Destination": "/backup.dump", "RW": False},
                                   {"Type": "tmpfs", "Destination": "/var/lib/postgresql/data", "RW": True}]}]).encode()
                elif "psql" in args:
                    user = args[args.index("-U") + 1]
                    if input == b"select rolname from pg_catalog.pg_roles;":
                        return b"postgres\nsupabase_admin\n"
                    if input and b"session_user" in input:
                        return json.dumps({"current_user": user, "session_user": user, **role}).encode()
                return b""

            with patch("lifeos_backup.verify_backup"), patch("lifeos_backup.ram_directory", return_value=root), \
                 patch("lifeos_backup.archive_counts", return_value=({"profiles": 2}, True)), \
                 patch("lifeos_backup.assert_archive_data"), patch("restore_drill.decrypt"), \
                 patch("restore_drill.key_bytes", return_value=b"x" * 32), \
                 patch("restore_drill.command", side_effect=command), \
                 patch("restore_drill.subprocess.run", return_value=subprocess.CompletedProcess([], 0)):
                yield config, manifest, sql, calls

    def test_release_sql_without_explicit_caller_fails_before_execution(self):
        with self.restored_fixture() as (config, manifest, sql, calls):
            with self.assertRaisesRegex(OpsError, "verification_caller_required"):
                restore_drill(config, manifest, verification_sql_files=(sql,))
            self.assertFalse(calls)

    def test_verification_connects_directly_as_declared_caller_while_restore_stays_admin(self):
        with self.restored_fixture() as (config, manifest, sql, calls):
            result = restore_drill(config, manifest, verification_sql_files=(sql,), verification_user="postgres",
                expected_verification_role={"superuser": False, "bypassrls": True, "inherit": True})
            self.assertTrue(result["success"])
            self.assertEqual(result["release_verification"]["current_user"], "postgres")
            self.assertEqual(result["release_verification"]["session_user"], "postgres")
            self.assertFalse(result["release_verification"]["superuser"])
            verification = [(args, data) for args, data in calls if data == sql.read_bytes()]
            self.assertEqual(len(verification), 1)
            self.assertEqual(verification[0][0][verification[0][0].index("-U") + 1], "postgres")
            restores = [args for args, _ in calls if "pg_restore" in args and "--exit-on-error" in args]
            self.assertEqual(restores[0][restores[0].index("-U") + 1], "supabase_admin")

    def test_superuser_fixture_cannot_pass_non_superuser_rehearsal(self):
        with self.restored_fixture(actual_role={"superuser": True, "bypassrls": True, "inherit": True}) as (config, manifest, sql, calls):
            with self.assertRaisesRegex(OpsError, "verification_role_mismatch"):
                restore_drill(config, manifest, verification_sql_files=(sql,), verification_user="postgres",
                    expected_verification_role={"superuser": False, "bypassrls": True, "inherit": True})
            self.assertFalse(any(data == sql.read_bytes() for _, data in calls))
            self.assertTrue(any(args[1] == "rm" for args, _ in calls))

    def test_unsafe_caller_and_incomplete_role_profile_fail_before_docker(self):
        with self.restored_fixture() as (config, manifest, sql, calls):
            for user, role in [("postgres --host=example.invalid", {"superuser": False, "bypassrls": True, "inherit": True}),
                               ("postgres", {"superuser": False})]:
                with self.subTest(user=user, role=role), self.assertRaises(OpsError):
                    restore_drill(config, manifest, verification_sql_files=(sql,), verification_user=user,
                                  expected_verification_role=role)
            self.assertFalse(calls)

    def test_scheduled_restore_without_release_sql_retains_existing_behavior(self):
        with self.restored_fixture() as (config, manifest, sql, calls):
            result = restore_drill(config, manifest)
            self.assertTrue(result["success"])
            self.assertNotIn("release_verification", result)
            self.assertTrue(all(args[args.index("-U") + 1] == "supabase_admin"
                                for args, _ in calls if "psql" in args))


if __name__ == "__main__":
    unittest.main()
