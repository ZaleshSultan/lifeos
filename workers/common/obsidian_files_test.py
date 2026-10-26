from __future__ import annotations

import errno
import hashlib
import multiprocessing
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import obsidian_files as files


def crash_publication(root: str, stage: str, existing_hash: str | None) -> None:
    original_temp = files.SecureVault._write_temp
    original_exchange = files._exchange
    original_new = files._publish_new
    original_write = os.write

    def interrupted_write(fd: int, data: object) -> int:
        original_write(fd, memoryview(data)[:2])
        os._exit(90)

    def interrupted_temp(parent_fd: int, data: bytes) -> str:
        name = original_temp(parent_fd, data)
        os._exit(91)

    def interrupted_exchange(parent_fd: int, left: str, right: str) -> None:
        original_exchange(parent_fd, left, right)
        os.fsync(parent_fd)
        os._exit(92)

    def interrupted_new(parent_fd: int, source: str, destination: str) -> None:
        original_new(parent_fd, source, destination)
        os.fsync(parent_fd)
        os._exit(94)

    with files.SecureVault(Path(root)) as vault, vault.note_lock("logical-note"):
        if stage == "temp":
            files.SecureVault._write_temp = staticmethod(interrupted_temp)
        elif stage == "partial":
            files.os.write = interrupted_write
        elif stage == "exchange":
            files._exchange = interrupted_exchange
        elif stage == "newrename":
            files._publish_new = interrupted_new
        vault.publish("Notes/item.md", "new body", existing_hash)
        os._exit(93)  # Successful filesystem write, lost database acknowledgement.


def hold_lock(root: str, acquired: object) -> None:
    with files.SecureVault(Path(root)) as vault, vault.note_lock("different-logical-note"):
        acquired.set()
        # A killed process must not leave a shared multiprocessing.Condition
        # acquired; use a process-local wait while holding the real flock.
        import time
        time.sleep(10)


class ObsidianFilesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "vault"

    def publish(self, content: str, expected: str | None = None) -> files.PublishResult:
        with files.SecureVault(self.root) as vault, vault.note_lock("logical-note"):
            return vault.publish("Notes/item.md", content, expected)

    def test_creates_missing_directories_and_utf8_note(self) -> None:
        result = self.publish("# Привет 世界\n🌿")
        note = self.root / "Notes/item.md"
        self.assertEqual(note.read_bytes(), "# Привет 世界\n🌿\n".encode())
        self.assertEqual(result.content_hash, hashlib.sha256(note.read_bytes()).hexdigest())
        self.assertFalse(result.unchanged)
        self.assertEqual(list(note.parent.glob("*.tmp-lifeos")), [])

    def test_same_content_is_idempotent_and_keeps_inode(self) -> None:
        first = self.publish("same")
        note = self.root / "Notes/item.md"
        inode = note.stat().st_ino
        second = self.publish("same", first.content_hash)
        self.assertTrue(second.unchanged)
        self.assertEqual(note.stat().st_ino, inode)
        self.assertFalse((self.root / ".lifeos-recovery").exists())

    def test_atomic_update_keeps_replaced_inode_and_bytes(self) -> None:
        first = self.publish("old")
        note = self.root / "Notes/item.md"
        original_inode = note.stat().st_ino
        with note.open("rb") as old_reader:
            second = self.publish("new", first.content_hash)
            self.assertEqual(old_reader.read(), b"old\n")
        self.assertEqual(note.read_bytes(), b"new\n")
        backup = self.root / ".lifeos-recovery" / str(second.backup_id)
        self.assertEqual(backup.read_bytes(), b"old\n")
        self.assertEqual(backup.stat().st_ino, original_inode)
        self.assertNotEqual(note.stat().st_ino, original_inode)

    def test_replaced_versions_are_never_pruned(self) -> None:
        result = self.publish("first")
        for body in ["second", "third", "fourth"]:
            result = self.publish(body, result.content_hash)
        versions = {path.read_bytes() for path in (self.root / ".lifeos-recovery").iterdir()}
        self.assertEqual(versions, {b"first\n", b"second\n", b"third\n"})

    def test_unmanaged_note_is_preserved(self) -> None:
        self.publish("user original")
        with self.assertRaisesRegex(files.FileConflict, "unmanaged_note"):
            self.publish("replacement")
        self.assertEqual((self.root / "Notes/item.md").read_bytes(), b"user original\n")

    def test_external_edit_is_preserved(self) -> None:
        first = self.publish("generated")
        (self.root / "Notes/item.md").write_text("user edit\n", encoding="utf-8")
        with self.assertRaisesRegex(files.FileConflict, "external_edit"):
            self.publish("updated", first.content_hash)
        self.assertEqual((self.root / "Notes/item.md").read_bytes(), b"user edit\n")

    def test_missing_previously_managed_note_is_conflict(self) -> None:
        first = self.publish("generated")
        (self.root / "Notes/item.md").unlink()
        with self.assertRaisesRegex(files.FileConflict, "note_missing"):
            self.publish("updated", first.content_hash)
        self.assertFalse((self.root / "Notes/item.md").exists())

    def test_observed_hash_uses_exact_bytes_not_desired_normalization(self) -> None:
        self.publish("generated")
        note = self.root / "Notes/item.md"
        note.write_bytes(b"manual without newline")
        with files.SecureVault(self.root) as vault:
            self.assertEqual(vault.current_hash("Notes/item.md"), hashlib.sha256(note.read_bytes()).hexdigest())
            self.assertNotEqual(vault.current_hash("Notes/item.md"), files.hash_content("manual without newline"))
            self.assertEqual(vault.read_text("Notes/item.md"), "manual without newline")
            self.assertIsNone(vault.current_hash("Absent/missing.md"))

    def test_invalid_utf8_is_preserved(self) -> None:
        self.publish("generated")
        note = self.root / "Notes/item.md"
        note.write_bytes(b"\xff\xfe")
        with files.SecureVault(self.root) as vault:
            with self.assertRaisesRegex(files.FileConflict, "invalid_note_encoding"):
                vault.read_text("Notes/item.md")
        self.assertEqual(note.read_bytes(), b"\xff\xfe")

    def test_traversal_and_invalid_filename_rejected_without_outside_writes(self) -> None:
        invalid = ["../escape.md", "/escape.md", "a/../../escape.md", "a\\escape.md", "a//b.md",
                   "./a.md", "a/./b.md", "a\x00.md", "a:stream.md", "%2e%2e/escape.md",
                   "a/%2fescape.md", "a/space .", ".lifeos-state/worker.lock", "a.tmp-lifeos", "CON.md", "LPT1.md"]
        with files.SecureVault(self.root) as vault, vault.note_lock("logical-note"):
            for name in invalid:
                with self.subTest(name=name), self.assertRaises(files.UnsafePath):
                    vault.publish(name, "no")
        self.assertFalse((Path(self.temp.name) / "escape.md").exists())

    def test_relative_and_traversing_roots_rejected(self) -> None:
        for root in [Path("relative"), Path("/"), Path(self.temp.name) / ".." / "vault"]:
            with self.subTest(root=root), self.assertRaises(files.UnsafePath):
                files.SecureVault(root)

    def test_root_symlink_rejected(self) -> None:
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        self.root.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(files.UnsafePath):
            files.SecureVault(self.root)
        self.assertEqual(list(outside.iterdir()), [])

    def test_ancestor_symlink_rejected(self) -> None:
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        alias = Path(self.temp.name) / "alias"
        alias.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(files.UnsafePath):
            files.SecureVault(alias / "vault")
        self.assertEqual(list(outside.iterdir()), [])

    def test_parent_symlink_rejected_before_creating_outside_directories(self) -> None:
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        self.root.mkdir()
        (self.root / "Notes").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(files.UnsafePath):
            with files.SecureVault(self.root) as vault, vault.note_lock("note"):
                vault.publish("Notes/new/deep.md", "no")
        self.assertEqual(list(outside.iterdir()), [])

    def test_final_symlink_is_preserved_and_not_followed(self) -> None:
        outside = Path(self.temp.name) / "outside.md"
        outside.write_text("private")
        (self.root / "Notes").mkdir(parents=True)
        target = self.root / "Notes/item.md"
        target.symlink_to(outside)
        with self.assertRaises(files.UnsafePath):
            self.publish("no")
        self.assertEqual(outside.read_text(), "private")
        self.assertTrue(target.is_symlink())

    def test_hardlink_rejected_and_outside_inode_unchanged(self) -> None:
        outside = Path(self.temp.name) / "outside.md"
        outside.write_text("private")
        (self.root / "Notes").mkdir(parents=True)
        os.link(outside, self.root / "Notes/item.md")
        with self.assertRaises(files.UnsafePath):
            self.publish("no")
        self.assertEqual(outside.read_text(), "private")

    def test_directory_and_fifo_cannot_be_notes(self) -> None:
        (self.root / "Notes/item.md").mkdir(parents=True)
        with self.assertRaises(files.UnsafePath):
            self.publish("no")
        (self.root / "Notes/item.md").rmdir()
        os.mkfifo(self.root / "Notes/item.md")
        with self.assertRaises(files.UnsafePath):
            self.publish("no")

    def test_state_directory_and_lock_symlinks_rejected(self) -> None:
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        self.root.mkdir()
        (self.root / ".lifeos-state").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(files.UnsafePath):
            with files.SecureVault(self.root) as vault, vault.note_lock("note"):
                pass
        (self.root / ".lifeos-state").unlink()
        (self.root / ".lifeos-state").mkdir(mode=0o700)
        (self.root / ".lifeos-state/worker.lock").symlink_to(outside / "lock")
        with self.assertRaises(files.UnsafePath):
            with files.SecureVault(self.root) as vault, vault.note_lock("note"):
                pass
        self.assertEqual(list(outside.iterdir()), [])

    def test_unsafe_state_permissions_rejected(self) -> None:
        (self.root / ".lifeos-state").mkdir(parents=True)
        (self.root / ".lifeos-state").chmod(0o777)
        with self.assertRaisesRegex(files.UnsafePath, "unsafe_state_permissions"):
            with files.SecureVault(self.root) as vault, vault.note_lock("note"):
                pass

    def test_held_lock_is_vault_wide_and_released_on_process_exit(self) -> None:
        context = multiprocessing.get_context("fork")
        acquired = context.Event()
        process = context.Process(target=hold_lock, args=(str(self.root), acquired))
        process.start()
        try:
            self.assertTrue(acquired.wait(5))
            with files.SecureVault(self.root) as vault:
                with self.assertRaisesRegex(files.FilesystemError, "note_busy"):
                    with vault.note_lock("another-logical-note"):
                        self.fail("contending worker entered")
            process.terminate()
            process.join(5)
            with files.SecureVault(self.root) as vault, vault.note_lock("new-worker"):
                self.assertTrue(vault.write_if_missing("Restart.md", "resumed"))
        finally:
            if process.is_alive():
                process.terminate()
            process.join(5)

    def test_publish_requires_vault_lock(self) -> None:
        with files.SecureVault(self.root) as vault:
            with self.assertRaisesRegex(files.FilesystemError, "vault_lock_required"):
                vault.publish("item.md", "no")

    def test_parent_symlink_swap_before_publication_is_rejected(self) -> None:
        first = self.publish("old")
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        original = files.SecureVault._write_temp

        def swap(parent_fd: int, data: bytes) -> str:
            name = original(parent_fd, data)
            (self.root / "Notes").rename(self.root / "moved-notes")
            (self.root / "Notes").symlink_to(outside, target_is_directory=True)
            return name

        with patch.object(files.SecureVault, "_write_temp", side_effect=swap):
            with self.assertRaises(files.UnsafePath):
                self.publish("new", first.content_hash)
        self.assertEqual(list(outside.iterdir()), [])
        self.assertEqual((self.root / "moved-notes/item.md").read_bytes(), b"old\n")

    def test_corrupted_temporary_content_never_published(self) -> None:
        first = self.publish("old")
        original = files.SecureVault._write_temp

        def corrupt(parent_fd: int, data: bytes) -> str:
            name = original(parent_fd, data)
            fd = os.open(name, os.O_WRONLY | os.O_TRUNC, dir_fd=parent_fd)
            os.write(fd, b"corrupt")
            os.close(fd)
            return name

        with patch.object(files.SecureVault, "_write_temp", side_effect=corrupt):
            with self.assertRaisesRegex(files.FilesystemError, "corrupt_temporary_file"):
                self.publish("new", first.content_hash)
        self.assertEqual((self.root / "Notes/item.md").read_bytes(), b"old\n")

    def test_new_note_does_not_clobber_concurrent_creation(self) -> None:
        original = files.SecureVault._write_temp

        def create_user_note(parent_fd: int, data: bytes) -> str:
            name = original(parent_fd, data)
            (self.root / "Notes/item.md").write_text("concurrent user note\n")
            return name

        with patch.object(files.SecureVault, "_write_temp", side_effect=create_user_note):
            with self.assertRaisesRegex(files.FileConflict, "concurrent_note_change"):
                self.publish("generated")
        self.assertEqual((self.root / "Notes/item.md").read_bytes(), b"concurrent user note\n")

    def test_external_atomic_replacement_during_exchange_is_restored(self) -> None:
        first = self.publish("old")
        exchange = files._exchange
        calls = 0

        def concurrent_exchange(parent_fd: int, left: str, right: str) -> None:
            nonlocal calls
            calls += 1
            if calls == 1:
                incoming = self.root / "Notes/incoming.md"
                incoming.write_text("user newer version\n")
                os.replace(incoming, self.root / "Notes/item.md")
            exchange(parent_fd, left, right)

        with patch.object(files, "_exchange", side_effect=concurrent_exchange):
            with self.assertRaisesRegex(files.FileConflict, "concurrent_note_change"):
                self.publish("generated new", first.content_hash)
        self.assertEqual((self.root / "Notes/item.md").read_bytes(), b"user newer version\n")
        self.assertEqual(calls, 2)

    def test_second_editor_change_during_conflict_restore_is_retained(self) -> None:
        first = self.publish("old")
        exchange = files._exchange
        calls = 0

        def concurrent_exchange(parent_fd: int, left: str, right: str) -> None:
            nonlocal calls
            calls += 1
            incoming = self.root / "Notes/incoming.md"
            incoming.write_text(f"editor version {calls}\n")
            os.replace(incoming, self.root / "Notes/item.md")
            exchange(parent_fd, left, right)

        with patch.object(files, "_exchange", side_effect=concurrent_exchange):
            with self.assertRaises(files.FileConflict):
                self.publish("generated new", first.content_hash)
        self.assertEqual((self.root / "Notes/item.md").read_bytes(), b"editor version 1\n")
        backups = {path.read_bytes() for path in (self.root / ".lifeos-recovery").iterdir()}
        self.assertIn(b"editor version 2\n", backups)

    def test_open_editor_handle_changes_are_preserved_in_retained_inode(self) -> None:
        first = self.publish("old")
        note = self.root / "Notes/item.md"
        with note.open("r+b") as editor:
            result = self.publish("new", first.content_hash)
            editor.seek(0)
            editor.write(b"late edit\n")
            editor.truncate()
            editor.flush()
            os.fsync(editor.fileno())
        self.assertEqual(note.read_bytes(), b"new\n")
        self.assertEqual((self.root / ".lifeos-recovery" / str(result.backup_id)).read_bytes(), b"late edit\n")

    def test_unsupported_atomic_exchange_fails_closed(self) -> None:
        first = self.publish("old")
        with patch.object(files, "_exchange", side_effect=files.FilesystemError("atomic_update_unsupported")):
            with self.assertRaisesRegex(files.FilesystemError, "atomic_update_unsupported"):
                self.publish("new", first.content_hash)
        self.assertEqual((self.root / "Notes/item.md").read_bytes(), b"old\n")

    def test_lease_validation_runs_after_temp_preparation_and_before_publication(self) -> None:
        first = self.publish("old")
        checked = []

        def expired() -> bool:
            checked.append(list((self.root / "Notes").glob("*.tmp-lifeos")))
            return False

        with files.SecureVault(self.root) as vault, vault.note_lock("note"):
            with self.assertRaisesRegex(files.FilesystemError, "claim_lost"):
                vault.publish("Notes/item.md", "new", first.content_hash, validate_claim=expired)
        self.assertEqual(len(checked), 1)
        self.assertEqual(len(checked[0]), 1)
        self.assertEqual((self.root / "Notes/item.md").read_bytes(), b"old\n")

    def test_parent_symlink_swap_during_claim_validation_is_rejected(self) -> None:
        first = self.publish("old")
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()

        def validated_but_directory_changed() -> bool:
            (self.root / "Notes").rename(self.root / "moved")
            (self.root / "Notes").symlink_to(outside, target_is_directory=True)
            return True

        with files.SecureVault(self.root) as vault, vault.note_lock("note"):
            with self.assertRaises(files.UnsafePath):
                vault.publish("Notes/item.md", "new", first.content_hash, validated_but_directory_changed)
        self.assertEqual(list(outside.iterdir()), [])
        self.assertEqual((self.root / "moved/item.md").read_bytes(), b"old\n")

    def test_permission_error_during_preparation_leaves_existing_note(self) -> None:
        first = self.publish("old")
        with patch.object(files.SecureVault, "_write_temp", side_effect=PermissionError(errno.EACCES, "denied")):
            with self.assertRaises(PermissionError):
                self.publish("new", first.content_hash)
        self.assertEqual((self.root / "Notes/item.md").read_bytes(), b"old\n")

    @unittest.skipIf(os.geteuid() == 0, "POSIX permission denial requires non-root test user")
    def test_actual_directory_permission_denial_preserves_note(self) -> None:
        first = self.publish("old")
        directory = self.root / "Notes"
        directory.chmod(0)
        try:
            with self.assertRaises(PermissionError):
                self.publish("new", first.content_hash)
        finally:
            directory.chmod(0o700)
        self.assertEqual((directory / "item.md").read_bytes(), b"old\n")

    def test_interrupted_write_leaves_previous_note(self) -> None:
        first = self.publish("old")
        original_write = os.write
        count = 0

        def interrupted(fd: int, data: object) -> int:
            nonlocal count
            count += 1
            if count == 1:
                return original_write(fd, memoryview(data)[:2])
            raise OSError(errno.ENOSPC, "full")

        with patch.object(files.os, "write", side_effect=interrupted):
            with self.assertRaises(OSError):
                self.publish("long replacement", first.content_hash)
        self.assertEqual((self.root / "Notes/item.md").read_bytes(), b"old\n")
        self.assertEqual(list((self.root / "Notes").glob("*.tmp-lifeos")), [])

    def test_fsync_failure_before_publication_leaves_previous_note(self) -> None:
        first = self.publish("old")
        with patch.object(files.os, "fsync", side_effect=OSError(errno.EIO, "failure")):
            with self.assertRaises(OSError):
                self.publish("new", first.content_hash)
        self.assertEqual((self.root / "Notes/item.md").read_bytes(), b"old\n")

    def test_write_if_missing_preserves_existing_manual_dashboard(self) -> None:
        with files.SecureVault(self.root) as vault, vault.note_lock("dashboard"):
            self.assertTrue(vault.write_if_missing("Dashboard.md", "manual"))
            self.assertFalse(vault.write_if_missing("Dashboard.md", "generated"))
            self.assertEqual(vault.read_text("Dashboard.md"), "manual\n")

    def test_different_vaults_are_independent(self) -> None:
        other = Path(self.temp.name) / "other-vault"
        with files.SecureVault(self.root) as a, a.note_lock("note"):
            with files.SecureVault(other) as b, b.note_lock("note"):
                a.publish("Same.md", "user A")
                b.publish("Same.md", "user B")
        self.assertEqual((self.root / "Same.md").read_text(), "user A\n")
        self.assertEqual((other / "Same.md").read_text(), "user B\n")

    def run_crash(self, stage: str, expected: str | None) -> None:
        process = multiprocessing.get_context("fork").Process(
            target=crash_publication, args=(str(self.root), stage, expected),
        )
        process.start()
        process.join(8)
        if process.is_alive():
            process.terminate()
            process.join(5)
            self.fail("crash worker hung")
        self.assertEqual(process.exitcode, {"partial": 90, "temp": 91, "exchange": 92, "ack": 93, "newrename": 94}[stage])

    def test_process_crash_immediately_after_new_rename_reconciles_one_link(self) -> None:
        self.run_crash("newrename", None)
        note = self.root / "Notes/item.md"
        self.assertEqual(note.read_bytes(), b"new body\n")
        self.assertEqual(note.stat().st_nlink, 1)
        inode = note.stat().st_ino
        self.assertEqual(list(note.parent.glob("*.tmp-lifeos")), [])
        result = self.publish("new body")
        self.assertTrue(result.unchanged)
        self.assertEqual(note.stat().st_ino, inode)

    def test_process_crash_during_temporary_write_never_promotes_partial_bytes(self) -> None:
        first = self.publish("old")
        self.run_crash("partial", first.content_hash)
        note = self.root / "Notes/item.md"
        self.assertEqual(note.read_bytes(), b"old\n")
        stranded = list(note.parent.glob("*.tmp-lifeos"))
        self.assertEqual([path.read_bytes() for path in stranded], [b"ne"])
        self.publish("new body", first.content_hash)
        self.assertEqual(note.read_bytes(), b"new body\n")
        self.assertEqual(stranded[0].read_bytes(), b"ne")

    def test_process_crash_after_temporary_write_restarts_safely(self) -> None:
        first = self.publish("old")
        self.run_crash("temp", first.content_hash)
        self.assertEqual((self.root / "Notes/item.md").read_bytes(), b"old\n")
        self.assertEqual(len(list((self.root / "Notes").glob("*.tmp-lifeos"))), 1)
        result = self.publish("new body", first.content_hash)
        self.assertFalse(result.unchanged)
        self.assertEqual((self.root / "Notes/item.md").read_bytes(), b"new body\n")

    def test_process_crash_after_exchange_reconciles_without_rewrite(self) -> None:
        first = self.publish("old")
        self.run_crash("exchange", first.content_hash)
        note = self.root / "Notes/item.md"
        inode = note.stat().st_ino
        stranded = list(note.parent.glob("*.tmp-lifeos"))
        self.assertEqual([path.read_bytes() for path in stranded], [b"old\n"])
        result = self.publish("new body", first.content_hash)
        self.assertTrue(result.unchanged)
        self.assertEqual(note.stat().st_ino, inode)
        self.assertEqual(stranded[0].read_bytes(), b"old\n")

    def test_lost_database_ack_reconciles_without_duplicate_note(self) -> None:
        self.run_crash("ack", None)
        result = self.publish("new body")
        self.assertTrue(result.unchanged)
        self.assertEqual(list(self.root.rglob("*.md")), [self.root / "Notes/item.md"])


if __name__ == "__main__":
    unittest.main()
