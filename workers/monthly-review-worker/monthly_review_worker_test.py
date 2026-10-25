from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("monthly_review_worker.py")
SPEC = importlib.util.spec_from_file_location("monthly_review_worker", MODULE_PATH)
assert SPEC and SPEC.loader
monthly_review_worker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = monthly_review_worker
SPEC.loader.exec_module(monthly_review_worker)


class MonthlyReviewLegacyGuardTest(unittest.TestCase):
    def test_load_settings_requires_legacy_single_user_opt_in(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role",
                "LIFEOS_DEFAULT_USER_ID": "user-1",
            },
            clear=True,
        ), patch.object(monthly_review_worker, "load_dotenv", lambda _path: None):
            with self.assertRaises(monthly_review_worker.WorkerError) as context:
                monthly_review_worker.load_settings()

        self.assertIn(
            "LIFEOS_ENABLE_LEGACY_SINGLE_USER_MONTHLY_REVIEW",
            str(context.exception),
        )

    def test_load_settings_allows_explicit_legacy_single_user_opt_in(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co/",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role",
                "LIFEOS_DEFAULT_USER_ID": "user-1",
                "LIFEOS_ENABLE_LEGACY_SINGLE_USER_MONTHLY_REVIEW": "true",
            },
            clear=True,
        ), patch.object(monthly_review_worker, "load_dotenv", lambda _path: None):
            settings = monthly_review_worker.load_settings()

        self.assertEqual(settings.supabase_url, "https://example.supabase.co")
        self.assertEqual(settings.user_id, "user-1")
        self.assertIsNone(settings.obsidian_vault_path)


class MonthlyReviewFilesystemTest(unittest.TestCase):
    USER_A = "11111111-1111-4111-8111-111111111111"
    USER_B = "22222222-2222-4222-8222-222222222222"

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "vault"

    def settings(self, vault: Path | None = None, owner: str | None = None) -> object:
        return monthly_review_worker.Settings(
            supabase_url="https://example.supabase.co", service_role_key="test",
            user_id=owner or self.USER_A, timezone_name="UTC",
            obsidian_vault_path=vault or self.root, telegram_bot_token=None,
            telegram_chat_id=None, ai_enabled=False, openrouter_api_key=None,
            ai_model="test", ai_base_url="https://example.invalid", poll_seconds=3600,
        )

    def test_creates_review_and_appends_dashboard_without_truncation(self) -> None:
        dashboard = self.root / "Dashboards/Reviews.md"
        dashboard.parent.mkdir(parents=True)
        dashboard.write_text("# My manual dashboard\n\nKeep this text.\n", encoding="utf-8")
        relative = monthly_review_worker.write_obsidian(self.settings(), "2026-09", "Привет\n")
        self.assertEqual(relative, "Reviews/Monthly/2026-09-LifeOS-Review.md")
        self.assertEqual((self.root / relative).read_text(), "Привет\n")
        self.assertIn("Keep this text.", dashboard.read_text())
        self.assertIn("2026-09 LifeOS Review", dashboard.read_text())
        self.assertTrue(list((self.root / ".lifeos-recovery").glob("*.bak")))

    def test_identical_review_retry_keeps_inode_and_one_dashboard_link(self) -> None:
        relative = monthly_review_worker.write_obsidian(self.settings(), "2026-09", "same")
        inode = (self.root / relative).stat().st_ino
        monthly_review_worker.write_obsidian(self.settings(), "2026-09", "same")
        self.assertEqual((self.root / relative).stat().st_ino, inode)
        self.assertEqual((self.root / "Dashboards/Reviews.md").read_text().count("2026-09 LifeOS Review"), 1)

    def test_existing_manual_review_is_never_overwritten(self) -> None:
        note = self.root / "Reviews/Monthly/2026-09-LifeOS-Review.md"
        note.parent.mkdir(parents=True)
        note.write_text("My handwritten review\n")
        with self.assertRaisesRegex(monthly_review_worker.FilesystemError, "unmanaged_note"):
            monthly_review_worker.write_obsidian(self.settings(), "2026-09", "generated")
        self.assertEqual(note.read_text(), "My handwritten review\n")
        self.assertFalse((self.root / "Dashboards").exists())

    def test_changed_regeneration_requires_manual_conflict_resolution(self) -> None:
        relative = monthly_review_worker.write_obsidian(self.settings(), "2026-09", "first")
        with self.assertRaisesRegex(monthly_review_worker.FilesystemError, "unmanaged_note"):
            monthly_review_worker.write_obsidian(self.settings(), "2026-09", "regenerated")
        self.assertEqual((self.root / relative).read_text(), "first\n")

    def test_invalid_owner_rejected_before_any_files_created(self) -> None:
        with self.assertRaisesRegex(monthly_review_worker.WorkerError, "invalid_vault_owner"):
            monthly_review_worker.write_obsidian(self.settings(owner="../other-user"), "2026-09", "no")
        self.assertFalse(self.root.exists())

    def test_user_cannot_write_another_tenant_root(self) -> None:
        multitenant = Path(self.temporary.name) / "users"
        with patch.object(monthly_review_worker, "MULTITENANT_VAULT_ROOT", multitenant):
            with self.assertRaisesRegex(monthly_review_worker.WorkerError, "vault_owner_mismatch"):
                monthly_review_worker.write_obsidian(self.settings(multitenant / self.USER_B), "2026-09", "no")
            with self.assertRaisesRegex(monthly_review_worker.WorkerError, "vault_owner_mismatch"):
                monthly_review_worker.write_obsidian(self.settings(multitenant), "2026-09", "no")
        self.assertFalse(multitenant.exists())

    def test_traversing_root_and_period_are_rejected(self) -> None:
        with self.assertRaisesRegex(monthly_review_worker.WorkerError, "invalid_vault_path"):
            monthly_review_worker.write_obsidian(self.settings(self.root / ".." / "other"), "2026-09", "no")
        with self.assertRaises(monthly_review_worker.WorkerError):
            monthly_review_worker.write_obsidian(self.settings(), "../../outside", "no")
        self.assertFalse(self.root.exists())

    def test_symlinked_vault_and_review_parent_are_rejected(self) -> None:
        outside = Path(self.temporary.name) / "outside"
        outside.mkdir()
        self.root.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(monthly_review_worker.FilesystemError):
            monthly_review_worker.write_obsidian(self.settings(), "2026-09", "no")
        self.root.unlink()
        self.root.mkdir()
        (self.root / "Reviews").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(monthly_review_worker.FilesystemError):
            monthly_review_worker.write_obsidian(self.settings(), "2026-09", "no")
        self.assertEqual(list(outside.iterdir()), [])

    def test_symlinked_dashboard_is_rejected_and_target_unchanged(self) -> None:
        outside = Path(self.temporary.name) / "outside.md"
        outside.write_text("private")
        (self.root / "Dashboards").mkdir(parents=True)
        (self.root / "Dashboards/Reviews.md").symlink_to(outside)
        with self.assertRaises(monthly_review_worker.FilesystemError):
            monthly_review_worker.write_obsidian(self.settings(), "2026-09", "generated")
        self.assertEqual(outside.read_text(), "private")

    def test_lost_ack_after_review_publication_can_resume_dashboard(self) -> None:
        with patch.object(monthly_review_worker, "update_reviews_dashboard", side_effect=RuntimeError("crash")):
            with self.assertRaises(RuntimeError):
                monthly_review_worker.write_obsidian(self.settings(), "2026-09", "generated")
        relative = monthly_review_worker.write_obsidian(self.settings(), "2026-09", "generated")
        self.assertEqual(list(self.root.rglob("2026-09-LifeOS-Review.md")), [self.root / relative])
        self.assertIn("2026-09 LifeOS Review", (self.root / "Dashboards/Reviews.md").read_text())

    def test_concurrent_dashboard_edit_is_preserved(self) -> None:
        dashboard = self.root / "Dashboards/Reviews.md"
        dashboard.parent.mkdir(parents=True)
        dashboard.write_text("original dashboard\n")
        original = monthly_review_worker.SecureVault.publish

        def changed_before_publication(opened: object, relative: str, content: str, expected_hash: str | None = None, **kwargs: object) -> object:
            if relative == "Dashboards/Reviews.md":
                dashboard.write_text("newer manual dashboard\n")
            return original(opened, relative, content, expected_hash, **kwargs)

        with patch.object(monthly_review_worker.SecureVault, "publish", new=changed_before_publication):
            with self.assertRaisesRegex(monthly_review_worker.FilesystemError, "external_edit"):
                monthly_review_worker.write_obsidian(self.settings(), "2026-09", "generated")
        self.assertEqual(dashboard.read_text(), "newer manual dashboard\n")

    def test_monthly_review_uses_same_global_lock_as_mirror(self) -> None:
        with monthly_review_worker.SecureVault(self.root) as opened, opened.note_lock("mirror-job"):
            with self.assertRaisesRegex(monthly_review_worker.FilesystemError, "note_busy"):
                monthly_review_worker.write_obsidian(self.settings(), "2026-09", "no")
        self.assertFalse((self.root / "Reviews").exists())

    def test_standalone_atomic_write_is_create_only(self) -> None:
        note = self.root / "note.md"
        monthly_review_worker.atomic_write(note, "original")
        with self.assertRaises(monthly_review_worker.FilesystemError):
            monthly_review_worker.atomic_write(note, "different")
        self.assertEqual(note.read_text(), "original\n")


if __name__ == "__main__":
    unittest.main()
