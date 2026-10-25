from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import os
import sys
import tempfile
import threading
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("obsidian_mirror.py")
SPEC = importlib.util.spec_from_file_location("obsidian_mirror", MODULE_PATH)
assert SPEC and SPEC.loader
obsidian_mirror = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = obsidian_mirror
SPEC.loader.exec_module(obsidian_mirror)

USER_A = "00000000-0000-4000-8000-000000000001"
USER_B = "00000000-0000-4000-8000-000000000002"
ENTITY_A = "00000000-0000-4000-8000-000000000011"
ENTITY_B = "00000000-0000-4000-8000-000000000012"
JOB_A = "00000000-0000-4000-8000-000000000021"
CLAIM_A = "00000000-0000-4000-8000-000000000031"
CLAIM_B = "00000000-0000-4000-8000-000000000032"


def sample_job(user_id=USER_A, entity_id=ENTITY_A):
    return {
        "id": JOB_A, "user_id": user_id, "life_entity_id": entity_id,
        "status": "processing", "attempts": 1, "claim_token": CLAIM_A,
        "target_path": "Captures/managed.md", "operation": "upsert_note", "action": "upsert",
    }


def sample_entity(user_id=USER_A, entity_id=ENTITY_A):
    return {
        "id": entity_id, "user_id": user_id, "entity_type": "capture",
        "title": "Temporary fixture capture", "body": "private fixture note",
        "source": "test", "source_command": "test",
        "created_at": "2026-06-15T10:00:00Z", "updated_at": "2026-06-15T10:00:00Z",
        "metadata": {},
    }


class InjectedCrash(BaseException):
    pass


class FakeClient(obsidian_mirror.SupabaseRestClient):
    """DB boundary fixture; real state/locking semantics live in the SQL suite.

    Worker tests below exercise the actual renderer, filesystem publication and
    reconciliation. This fixture only supplies durable state across invocations.
    """
    def __init__(self, root: Path, user_id=USER_A, entity_id=ENTITY_A):
        self.owner = CLAIM_A
        self.profile_active = True
        self.settings_row = {
            "user_id": user_id, "enabled": True, "is_active": True,
            "mode": "syncthing", "vault_path": str(root / user_id),
            "status": "connected", "timezone": "UTC",
        }
        self.entity = sample_entity(user_id, entity_id)
        self.ledger = None
        self.completed = []
        self.finished = []
        self.fetches = []
        self.renewals = 0
        self.allow_renew = True
        self.after_prepare = None
        self.ack_error = None
        self.commit_before_error = False
        self.claimed_jobs = []
        self.recovered = 0
        self.status_reads = 0

    def _owned(self, job):
        return job.get("claim_token") == self.owner and job.get("user_id") == self.settings_row.get("user_id")

    def user_is_active(self, user_id):
        return self.profile_active and user_id == self.settings_row["user_id"]

    def get_user_obsidian_settings(self, user_id):
        return self.settings_row

    def fetch_one(self, table, row_id, user_id=None):
        self.fetches.append((table, row_id, user_id))
        return self.entity if table == "life_entities" else None

    def renew_job(self, job):
        self.renewals += 1
        return self._owned(job) and self.profile_active and self.allow_renew

    def note_state(self, job):
        return None if self.ledger is None else dict(self.ledger)

    def prepare_job(self, job, relative_path, content_hash, observed_hash):
        if not self._owned(job) or not self.profile_active:
            return {}
        prior = self.ledger or {}
        accepted = {prior.get("applied_content_hash"), prior.get("expected_content_hash"), prior.get("pending_content_hash"), content_hash}
        if observed_hash not in accepted or (prior.get("applied_content_hash") is not None and observed_hash is None):
            return {"conflict": True, "error_code": "external_modification"}
        self.ledger = {
            **prior, "relative_path": prior.get("relative_path", relative_path),
            "expected_content_hash": observed_hash, "pending_content_hash": content_hash,
            "revision": prior.get("revision", 0) + 1, "conflict": False,
        }
        prepared = dict(self.ledger)
        if self.after_prepare:
            self.after_prepare()
        return prepared

    def complete_job(self, job, content_hash, revision):
        owned = self._owned(job) and self.profile_active
        if self.ack_error and not self.commit_before_error:
            raise self.ack_error
        if owned:
            self.completed.append(job["id"])
            self.ledger["applied_content_hash"] = content_hash
            self.ledger["applied_revision"] = revision
        if self.ack_error:
            raise self.ack_error
        return owned

    def finish_job(self, job, error_code, *, retryable=False, conflict=False):
        if not self._owned(job):
            return False
        self.finished.append((error_code, retryable, conflict))
        return True

    def recover_jobs(self):
        self.recovered += 1
        return {}

    def claim_jobs(self, limit=1):
        if not self.claimed_jobs:
            return []
        return [self.claimed_jobs.pop(0)]

    def queue_status(self):
        self.status_reads += 1
        return {"counts": {"pending": 2, "processing": 1}, "stale_claims": 0}


class ObsidianMirrorTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root_patch = patch.object(obsidian_mirror, "MULTITENANT_VAULT_ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.settings = obsidian_mirror.Settings("https://example.supabase.co", "test-key", 10, 30, "Dashboards")
        self.client = FakeClient(self.root)
        self.job = sample_job()
        self.output = io.StringIO()
        self.redirect_out = contextlib.redirect_stdout(self.output)
        self.redirect_err = contextlib.redirect_stderr(self.output)
        self.redirect_out.__enter__()
        self.redirect_err.__enter__()
        self.addCleanup(self.redirect_out.__exit__, None, None, None)
        self.addCleanup(self.redirect_err.__exit__, None, None, None)

    @property
    def note(self):
        return self.root / USER_A / "Captures" / "managed.md"

    def process(self):
        return obsidian_mirror.process_job(self.settings, self.client, self.job)

    def recover_claim(self):
        self.client.owner = CLAIM_B
        self.job = {**self.job, "claim_token": CLAIM_B, "attempts": 2}
        self.client.ack_error = None

    def test_normal_processing_uses_owner_and_preserves_template(self):
        self.assertTrue(self.process())
        self.assertEqual(self.note.read_text(), obsidian_mirror.render_entity(self.client.entity).markdown)
        self.assertEqual(self.client.completed, [JOB_A])
        self.assertIn(("life_entities", ENTITY_A, USER_A), self.client.fetches)
        self.assertFalse((self.root / USER_B).exists())
        self.assertIn("outcome=completed", self.output.getvalue())
        self.assertGreaterEqual(self.client.renewals, 3)

    def test_other_user_uses_separate_authorized_vault(self):
        self.client = FakeClient(self.root, USER_B, ENTITY_B)
        self.job = sample_job(USER_B, ENTITY_B)
        self.assertTrue(self.process())
        self.assertTrue((self.root / USER_B / "Captures" / "managed.md").exists())
        self.assertFalse((self.root / USER_A).exists())

    def test_blocked_user_does_not_create_vault(self):
        self.client.profile_active = False
        self.assertFalse(self.process())
        self.assertFalse((self.root / USER_A).exists())
        self.assertEqual(self.client.finished, [("recipient_inactive", False, False)])

    def test_cross_user_entity_is_rejected(self):
        self.client.entity["user_id"] = USER_B
        self.assertFalse(self.process())
        self.assertFalse((self.root / USER_A).exists())
        self.assertEqual(self.client.finished[0][0], "invalid_user_ownership")

    def test_cross_user_settings_are_rejected(self):
        self.client.settings_row["user_id"] = USER_B
        self.client.user_is_active = lambda _user: True
        self.assertFalse(self.process())
        self.assertFalse((self.root / USER_B).exists())

    def test_cross_user_vault_path_is_rejected(self):
        self.client.settings_row["vault_path"] = str(self.root / USER_B)
        self.assertFalse(self.process())
        self.assertEqual(self.client.finished[0][0], "invalid_vault_ownership")
        self.assertFalse((self.root / USER_B).exists())

    def test_symlinked_user_root_cannot_access_other_user_vault(self):
        (self.root / USER_B).mkdir()
        (self.root / USER_A).symlink_to(self.root / USER_B, target_is_directory=True)
        self.assertFalse(self.process())
        self.assertFalse(list((self.root / USER_B).iterdir()))
        self.assertEqual(self.client.finished[0][0], "unsafe_path")

    def test_missing_settings_never_use_another_users_legacy_vault(self):
        self.client.settings_row = None
        self.client.user_is_active = lambda _user: True
        self.settings = obsidian_mirror.Settings("https://example.supabase.co", "test-key", 10, 30, "Dashboards", legacy_vault_path=self.root / "legacy", legacy_user_id=USER_B)
        self.client.finish_job = lambda *_args, **_kwargs: True
        self.assertFalse(self.process())
        self.assertFalse((self.root / "legacy").exists())

    def test_disabled_settings_do_not_write(self):
        self.client.settings_row["enabled"] = False
        self.assertFalse(self.process())
        self.assertFalse((self.root / USER_A).exists())
        self.assertEqual(self.client.finished[0][0], "sync_unavailable")

    def test_claim_loss_prevents_writes(self):
        self.client.allow_renew = False
        self.assertFalse(self.process())
        self.assertFalse((self.root / USER_A).exists())
        self.assertEqual(self.client.finished, [])

    def test_stale_worker_cannot_acknowledge_newer_claim(self):
        self.client.owner = CLAIM_B
        self.assertFalse(self.process())
        self.assertEqual(self.client.completed, [])
        self.assertEqual(self.client.finished, [])

    def test_invalid_uuid_ownership_is_rejected(self):
        for value in ["../other-user", "user-a", "", USER_A.upper()]:
            if value == USER_A:
                continue
            self.job["user_id"] = value
            self.assertFalse(self.process())
        self.assertFalse((self.root / USER_A).exists())

    def test_traversal_target_is_rejected_without_filesystem_write(self):
        self.job["target_path"] = "../outside.md"
        self.assertFalse(self.process())
        self.assertFalse((self.root / USER_A).exists())
        self.assertFalse((self.root / "outside.md").exists())

    def test_delete_operation_does_not_delete_or_replace_note(self):
        self.note.parent.mkdir(parents=True)
        self.note.write_text("user note\n")
        self.job["operation"] = "delete_note"
        self.assertFalse(self.process())
        self.assertEqual(self.note.read_text(), "user note\n")
        self.assertEqual(self.client.finished[0][0], "unsupported_operation")

    def test_existing_manual_note_is_preserved_as_conflict(self):
        self.note.parent.mkdir(parents=True)
        self.note.write_text("user maintained note\n")
        self.assertFalse(self.process())
        self.assertEqual(self.note.read_text(), "user maintained note\n")
        self.assertEqual(self.client.finished, [("external_modification", False, True)])

    def test_matching_legacy_generated_note_can_be_adopted_without_rewrite(self):
        self.note.parent.mkdir(parents=True)
        self.note.write_text(obsidian_mirror.render_entity(self.client.entity).markdown)
        inode = self.note.stat().st_ino
        self.assertTrue(self.process())
        self.assertEqual(self.note.stat().st_ino, inode)
        self.assertIn("unchanged=true", self.output.getvalue())

    def test_same_content_twice_is_idempotent(self):
        self.assertTrue(self.process())
        inode = self.note.stat().st_ino
        self.recover_claim()
        self.assertTrue(self.process())
        self.assertEqual(self.note.stat().st_ino, inode)
        self.assertEqual(len(list((self.root / USER_A / "Captures").glob("*.md"))), 1)

    def test_updated_entity_keeps_pinned_destination_after_title_change(self):
        self.job["target_path"] = None
        self.assertTrue(self.process())
        pinned = self.client.ledger["relative_path"]
        first = self.root / USER_A / pinned
        self.client.entity["title"] = "changed title"
        self.client.entity["updated_at"] = "2026-06-16T10:00:00Z"
        self.recover_claim()
        self.assertTrue(self.process())
        self.assertEqual(self.client.ledger["relative_path"], pinned)
        self.assertIn("changed title", first.read_text())
        self.assertEqual(len(list((self.root / USER_A / "Captures").rglob("*.md"))), 1)

    def test_external_edit_after_sync_is_preserved(self):
        self.assertTrue(self.process())
        self.note.write_text("newer external edit\n")
        self.client.entity["body"] = "new source content"
        self.recover_claim()
        self.assertFalse(self.process())
        self.assertEqual(self.note.read_text(), "newer external edit\n")
        self.assertEqual(self.client.finished[-1], ("external_modification", False, True))

    def test_external_edit_between_preparation_and_publication_is_preserved(self):
        self.assertTrue(self.process())
        self.client.entity["body"] = "new source content"
        self.recover_claim()
        self.client.after_prepare = lambda: self.note.write_text("racing editor\n")
        self.assertFalse(self.process())
        self.assertEqual(self.note.read_text(), "racing editor\n")
        self.assertEqual(self.client.finished[-1][0], "external_modification")

    def test_lost_ack_reconciles_exact_file_without_duplicate_or_rewrite(self):
        self.client.ack_error = obsidian_mirror.WorkerError("obsidian_state_unavailable")
        self.assertFalse(self.process())
        inode = self.note.stat().st_ino
        self.assertEqual(self.client.finished, [])
        self.assertIsNone(self.client.ledger.get("applied_content_hash"))
        self.recover_claim()
        self.assertTrue(self.process())
        self.assertEqual(self.note.stat().st_ino, inode)
        self.assertEqual(self.client.ledger["applied_content_hash"], hashlib.sha256(self.note.read_bytes()).hexdigest())

    def test_lost_ack_after_commit_does_not_change_completed_state(self):
        self.client.ack_error = obsidian_mirror.WorkerError("obsidian_state_unavailable")
        self.client.commit_before_error = True
        self.assertFalse(self.process())
        self.assertEqual(self.client.completed, [JOB_A])
        self.assertEqual(self.client.finished, [])
        self.assertIn("acknowledgement_unknown", self.output.getvalue())

    def test_restart_after_rename_and_crash_recovers_old_intent_then_new_source(self):
        self.client.ack_error = InjectedCrash()
        with self.assertRaises(InjectedCrash):
            self.process()
        first_bytes = self.note.read_bytes()
        self.assertEqual(self.client.completed, [])
        self.recover_claim()
        self.client.entity["body"] = "new source after restart"
        self.assertTrue(self.process())
        self.assertNotEqual(self.note.read_bytes(), first_bytes)
        self.assertIn("new source after restart", self.note.read_text())
        self.assertEqual(len(list((self.root / USER_A / "Captures").glob("*.md"))), 1)

    def test_crash_during_preparation_preserves_claim_without_terminal_failure(self):
        with patch.object(obsidian_mirror, "render_entity", side_effect=InjectedCrash()):
            with self.assertRaises(InjectedCrash):
                self.process()
        self.assertFalse((self.root / USER_A).exists())
        self.assertEqual(self.client.finished, [])

    def test_crash_immediately_after_claim_does_not_lose_job_history(self):
        self.client.claimed_jobs = [self.job]
        with patch.object(obsidian_mirror, "process_job", side_effect=InjectedCrash()):
            with self.assertRaises(InjectedCrash):
                obsidian_mirror.run_batch(self.settings, self.client, obsidian_mirror.DashboardInitializer())
        self.assertEqual(self.job["attempts"], 1)
        self.assertEqual(self.client.completed, [])
        self.assertEqual(self.client.finished, [])

    def test_crash_before_claim_does_not_touch_vault(self):
        with patch.object(self.client, "claim_jobs", side_effect=InjectedCrash()):
            with self.assertRaises(InjectedCrash):
                obsidian_mirror.run_batch(self.settings, self.client, obsidian_mirror.DashboardInitializer())
        self.assertFalse((self.root / USER_A).exists())

    def test_permission_failure_is_classified_as_retry_without_raw_path(self):
        with patch.object(obsidian_mirror.SecureVault, "publish", side_effect=PermissionError("private/path medical body secret")):
            self.assertFalse(self.process())
        self.assertEqual(self.client.finished, [("storage_unavailable", True, False)])
        self.assertNotIn("private/path", self.output.getvalue())
        self.assertNotIn("secret", self.output.getvalue())

    def test_database_outage_before_publication_does_not_write_note(self):
        with patch.object(self.client, "prepare_job", side_effect=obsidian_mirror.WorkerError("obsidian_state_unavailable")):
            self.assertFalse(self.process())
        self.assertFalse(self.note.exists())
        self.assertEqual(self.client.finished, [("obsidian_state_unavailable", True, False)])

    def test_unexpected_exception_logs_fixed_category_only(self):
        with patch.object(obsidian_mirror, "render_entity", side_effect=ValueError("sensitive content /personal-vault private note")):
            self.assertFalse(self.process())
        self.assertEqual(self.client.finished, [("preparation_failed", True, False)])
        self.assertNotIn("sensitive", self.output.getvalue())
        self.assertNotIn(str(self.root), self.output.getvalue())

    def test_syncthing_conflict_stops_bootstrap_and_note_updates(self):
        vault = self.root / USER_A
        vault.mkdir()
        conflict = vault / "private.sync-conflict-fixture.md"
        conflict.write_text("user conflict\n")
        self.assertFalse(self.process())
        self.assertFalse((vault / "Dashboards").exists())
        self.assertFalse(self.note.exists())
        self.assertEqual(conflict.read_text(), "user conflict\n")
        self.assertNotIn("private.sync", self.output.getvalue())

    def test_manual_dashboards_and_ignore_patterns_are_preserved(self):
        dashboard = self.root / USER_A / "Dashboards" / "Tasks.md"
        dashboard.parent.mkdir(parents=True)
        dashboard.write_text("my task dashboard\n")
        ignore = self.root / USER_A / ".stignore"
        ignore.write_text("my-private-pattern\n")
        self.assertTrue(self.process())
        self.assertEqual(dashboard.read_text(), "my task dashboard\n")
        self.assertTrue(ignore.read_text().startswith("my-private-pattern\n"))
        self.assertIn("(?d).lifeos-state/", ignore.read_text())
        self.assertIn("(?d).lifeos-recovery/", ignore.read_text())

    def test_status_does_not_recover_claims_or_open_vault(self):
        with patch.object(obsidian_mirror, "SupabaseRestClient", return_value=self.client), patch.object(obsidian_mirror, "load_settings", return_value=self.settings), patch.object(obsidian_mirror, "SecureVault", side_effect=AssertionError("status must not inspect filesystem")):
            self.assertEqual(obsidian_mirror.main(["status"]), 0)
        self.assertEqual(self.client.status_reads, 1)
        self.assertEqual(self.client.recovered, 0)
        self.assertFalse((self.root / USER_A).exists())

    def test_run_batch_claims_only_one_job_at_a_time(self):
        self.client.claimed_jobs = [self.job]
        with patch.object(self.client, "claim_jobs", wraps=self.client.claim_jobs) as claims:
            self.assertEqual(obsidian_mirror.run_batch(self.settings, self.client, obsidian_mirror.DashboardInitializer()), 1)
        self.assertEqual(self.client.recovered, 1)
        self.assertTrue(all(call.args == (1,) for call in claims.call_args_list))


class ObsidianConfigurationTest(unittest.TestCase):
    def settings_env(self, **extra):
        return patch.dict(os.environ, {"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "test-key", **extra}, clear=True)

    def test_legacy_vault_is_ignored_without_opt_in(self):
        with self.settings_env(OBSIDIAN_VAULT_PATH="/tmp/unused-vault"), patch.object(obsidian_mirror, "load_dotenv"):
            settings = obsidian_mirror.load_settings()
        self.assertIsNone(settings.legacy_vault_path)

    def test_legacy_opt_in_requires_explicit_owner_binding(self):
        with self.settings_env(OBSIDIAN_VAULT_PATH="/tmp/unused-vault", LIFEOS_ENABLE_LEGACY_SINGLE_USER_OBSIDIAN="true"), patch.object(obsidian_mirror, "load_dotenv"):
            with self.assertRaises(obsidian_mirror.WorkerError):
                obsidian_mirror.load_settings()

    def test_legacy_opt_in_binds_one_canonical_user(self):
        with self.settings_env(OBSIDIAN_VAULT_PATH="/tmp/unused-vault", LIFEOS_ENABLE_LEGACY_SINGLE_USER_OBSIDIAN="true", LIFEOS_DEFAULT_USER_ID=USER_A), patch.object(obsidian_mirror, "load_dotenv"):
            settings = obsidian_mirror.load_settings()
        self.assertEqual(settings.legacy_vault_path, Path("/tmp/unused-vault"))
        self.assertEqual(settings.legacy_user_id, USER_A)

    def test_invalid_batch_or_interval_configuration_is_rejected(self):
        for values in ({"OBSIDIAN_MIRROR_BATCH_SIZE": "0"}, {"OBSIDIAN_MIRROR_BATCH_SIZE": "1001"}, {"OBSIDIAN_MIRROR_INTERVAL_SECONDS": "-1"}):
            with self.subTest(values=values), self.settings_env(**values), patch.object(obsidian_mirror, "load_dotenv"):
                with self.assertRaisesRegex(obsidian_mirror.WorkerError, "invalid_worker_configuration"):
                    obsidian_mirror.load_settings()

    def test_legacy_bootstrap_cannot_select_another_multitenant_vault(self):
        with tempfile.TemporaryDirectory() as root, patch.object(obsidian_mirror, "MULTITENANT_VAULT_ROOT", Path(root)), self.settings_env(OBSIDIAN_VAULT_PATH=str(Path(root) / USER_B), LIFEOS_ENABLE_LEGACY_SINGLE_USER_OBSIDIAN="true", LIFEOS_DEFAULT_USER_ID=USER_A), patch.object(obsidian_mirror, "load_dotenv"):
            with self.assertRaisesRegex(obsidian_mirror.WorkerError, "invalid_vault_ownership"):
                obsidian_mirror.load_settings()

    def test_http_error_does_not_expose_raw_supabase_response(self):
        import urllib.error
        error = urllib.error.HTTPError("https://example.invalid", 500, "private remote details", {}, io.BytesIO(b"sensitive key and note body"))
        client = obsidian_mirror.SupabaseRestClient("https://example.invalid", "test-key")
        with patch.object(obsidian_mirror.urllib.request, "urlopen", side_effect=error):
            with self.assertRaisesRegex(obsidian_mirror.WorkerError, "^obsidian_state_unavailable$"):
                client.request("GET", "obsidian_sync_queue")

    def test_lifecycle_rpc_arguments_include_user_and_claim(self):
        client = obsidian_mirror.SupabaseRestClient("https://example.invalid", "test-key")
        with patch.object(client, "rpc", return_value=True) as request:
            self.assertTrue(client.complete_job(sample_job(), "a" * 64, 1))
        request.assert_called_once_with("complete_obsidian_sync_job", {"p_job_id": JOB_A, "p_user_id": USER_A, "p_claim_token": CLAIM_A, "p_content_hash": "a" * 64, "p_revision": 1})


class ClaimLeaseTest(unittest.TestCase):
    def test_long_preparation_renews_claim_in_background_and_stops_on_close(self):
        seen = threading.Event()
        calls = []

        def renew(_job):
            calls.append(1)
            if len(calls) > 1:
                seen.set()
            return True

        client = type("Client", (), {"renew_job": staticmethod(renew)})()
        lease = obsidian_mirror.ClaimLease(client, sample_job(), interval_seconds=0.001)
        try:
            lease.start()
            self.assertTrue(seen.wait(timeout=1))
        finally:
            lease.close()
        self.assertFalse(lease._thread.is_alive())
        self.assertGreaterEqual(len(calls), 2)
        self.assertFalse(lease.renew())

    def test_uncertain_heartbeat_fences_further_publication(self):
        failed = threading.Event()
        calls = []

        def renew(_job):
            calls.append(1)
            if len(calls) > 1:
                failed.set()
                raise obsidian_mirror.WorkerError("obsidian_state_unavailable")
            return True

        client = type("Client", (), {"renew_job": staticmethod(renew)})()
        lease = obsidian_mirror.ClaimLease(client, sample_job(), interval_seconds=0.001)
        try:
            lease.start()
            self.assertTrue(failed.wait(timeout=1))
            self.assertFalse(lease.renew())
            self.assertEqual(len(calls), 2)
        finally:
            lease.close()

    def test_local_expired_lease_cannot_be_resurrected(self):
        client = type("Client", (), {"renew_job": staticmethod(lambda _job: True)})()
        lease = obsidian_mirror.ClaimLease(client, sample_job())
        lease._deadline = time.monotonic() - 1
        self.assertFalse(lease.renew())


if __name__ == "__main__":
    unittest.main()
