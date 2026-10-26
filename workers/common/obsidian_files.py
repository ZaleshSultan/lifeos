"""Descriptor-based, conservative publication of an authorized Obsidian mirror.

Callers select the owner-authorized root and hold ``note_lock`` across database
preparation, publication and acknowledgement. The lock covers the entire vault.
Editors/Syncthing do not take that lock: replacement retains the displaced inode
and detects/restores observed races, but is not a filesystem compare-and-swap.
"""

from __future__ import annotations

import contextlib
import ctypes
import errno
import fcntl
import hashlib
import os
import re
import stat
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator


MAX_NOTE_BYTES = 32 * 1024 * 1024
_DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
_READ_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK
_HASH = re.compile(r"^[a-f0-9]{64}$")
_UNSAFE_SEGMENT = re.compile(r'[<>:"\\|?*\x00-\x1f\x7f]')
_ENCODED_ESCAPE = re.compile(r"%(?:2e|2f|5c|00)", re.IGNORECASE)
_WINDOWS_DEVICE = re.compile(r"^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", re.IGNORECASE)
_RESERVED = {".lifeos-state", ".lifeos-recovery"}


class FilesystemError(RuntimeError):
    """An expected error with a fixed, non-sensitive diagnostic code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class UnsafePath(FilesystemError):
    pass


class FileConflict(FilesystemError):
    pass


@dataclass(frozen=True)
class PublishResult:
    content_hash: str
    unchanged: bool
    backup_id: str | None = None


@dataclass(frozen=True)
class _Snapshot:
    data: bytes
    device: int
    inode: int

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


def content_bytes(content: str) -> bytes:
    """The exact UTF-8 bytes written, including the existing trailing-LF rule."""
    if content and not content.endswith("\n"):
        content += "\n"
    encoded = content.encode("utf-8")
    if len(encoded) > MAX_NOTE_BYTES:
        raise FilesystemError("note_too_large")
    return encoded


def hash_content(content: str) -> str:
    return hashlib.sha256(content_bytes(content)).hexdigest()


def _identity(info: os.stat_result) -> tuple[int, int]:
    return info.st_dev, info.st_ino


def _version(info: os.stat_result) -> tuple[int, int, int, int, int]:
    return (*_identity(info), info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _renameat2(source_fd: int, source: str, destination_fd: int, destination: str, flags: int) -> None:
    # Arch/Linux is the deployed worker platform. Never fall back to an
    # unchecked os.replace: it can lose a concurrent editor's replacement.
    libc = ctypes.CDLL(None, use_errno=True)
    operation = getattr(libc, "renameat2", None)
    if operation is None:
        raise FilesystemError("atomic_update_unsupported")
    operation.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    operation.restype = ctypes.c_int
    if operation(source_fd, os.fsencode(source), destination_fd, os.fsencode(destination), flags) == 0:
        return
    error = ctypes.get_errno()
    if error in {errno.ENOSYS, errno.EINVAL, errno.EOPNOTSUPP, errno.EXDEV}:
        raise FilesystemError("atomic_update_unsupported")
    raise OSError(error, os.strerror(error))


def _exchange(directory_fd: int, left: str, right: str) -> None:
    _renameat2(directory_fd, left, directory_fd, right, 2)  # RENAME_EXCHANGE


def _publish_new(directory_fd: int, source: str, destination: str) -> None:
    # A hard-link+unlink sequence leaves two links after a crash, conflicting
    # with the hard-link safety policy on recovery. Rename publishes one inode
    # under exactly one name atomically, without replacing a concurrent file.
    _renameat2(directory_fd, source, directory_fd, destination, 1)  # RENAME_NOREPLACE


def _open_directory(parent_fd: int, name: str, *, create: bool) -> int:
    try:
        try:
            return os.open(name, _DIRECTORY_FLAGS, dir_fd=parent_fd)
        except FileNotFoundError:
            if not create:
                raise
            try:
                os.mkdir(name, mode=0o700, dir_fd=parent_fd)
                os.fsync(parent_fd)
            except FileExistsError:
                pass
            return os.open(name, _DIRECTORY_FLAGS, dir_fd=parent_fd)
    except OSError as exc:
        if exc.errno in {errno.ELOOP, errno.ENOTDIR}:
            raise UnsafePath("unsafe_filesystem_object") from None
        raise


class SecureVault:
    """A pinned vault root; no operation follows a path symlink."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        raw = os.fspath(root)
        components = raw.split("/")
        if not raw.startswith("/") or raw == "/" or "\\" in raw or any(
            component in {".", ".."} or "\x00" in component for component in components
        ):
            raise UnsafePath("unsafe_root")
        self._root_components = [component for component in components if component]
        self._root_fd = self._open_root(create=True)
        self._root_identity = _identity(os.fstat(self._root_fd))
        self._lock_fd: int | None = None
        self._state_fd: int | None = None

    def _open_root(self, *, create: bool) -> int:
        current = os.open("/", _DIRECTORY_FLAGS)
        try:
            for component in self._root_components:
                following = _open_directory(current, component, create=create)
                os.close(current)
                current = following
            return current
        except BaseException:
            os.close(current)
            raise

    def __enter__(self) -> SecureVault:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def close(self) -> None:
        if self._lock_fd is not None:
            raise FilesystemError("vault_lock_still_held")
        if self._root_fd >= 0:
            os.close(self._root_fd)
            self._root_fd = -1

    def _assert_root(self) -> None:
        current = self._open_root(create=False)
        try:
            if _identity(os.fstat(current)) != self._root_identity:
                raise UnsafePath("vault_root_changed")
        finally:
            os.close(current)

    def _private_directory(self, name: str) -> int:
        result = _open_directory(self._root_fd, name, create=True)
        info = os.fstat(result)
        if info.st_uid != os.geteuid() or info.st_mode & 0o077:
            os.close(result)
            raise UnsafePath("unsafe_state_permissions")
        return result

    @contextlib.contextmanager
    def note_lock(self, note_key: str) -> Iterator[None]:
        """Nonblocking whole-vault lock (key retained for caller API clarity)."""
        if not note_key or self._lock_fd is not None:
            raise FilesystemError("invalid_vault_lock")
        self._assert_root()
        state_fd = self._private_directory(".lifeos-state")
        lock_fd = -1
        try:
            try:
                lock_fd = os.open(
                    "worker.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK,
                    0o600, dir_fd=state_fd,
                )
            except OSError as exc:
                if exc.errno in {errno.ELOOP, errno.ENOTDIR}:
                    raise UnsafePath("unsafe_lock_file") from None
                raise
            info = os.fstat(lock_fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.geteuid() or info.st_mode & 0o077:
                raise UnsafePath("unsafe_lock_file")
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise FilesystemError("note_busy") from None
            self._lock_fd, self._state_fd = lock_fd, state_fd
            self._assert_lock()
            yield
        finally:
            self._lock_fd, self._state_fd = None, None
            if lock_fd >= 0:
                os.close(lock_fd)
            os.close(state_fd)

    def _assert_lock(self) -> None:
        if self._lock_fd is None or self._state_fd is None:
            raise FilesystemError("vault_lock_required")
        self._assert_root()
        actual = os.stat(".lifeos-state", dir_fd=self._root_fd, follow_symlinks=False)
        lock = os.stat("worker.lock", dir_fd=self._state_fd, follow_symlinks=False)
        if _identity(actual) != _identity(os.fstat(self._state_fd)) or _identity(lock) != _identity(os.fstat(self._lock_fd)):
            raise UnsafePath("vault_lock_changed")

    @staticmethod
    def _segments(relative_path: str) -> list[str]:
        if not isinstance(relative_path, str) or len(relative_path.encode("utf-8")) > 4096:
            raise UnsafePath("unsafe_path")
        segments = relative_path.split("/")
        if len(segments) > 64 or any(
            not item or item in {".", ".."} or item in _RESERVED or item.endswith((" ", "."))
            or _UNSAFE_SEGMENT.search(item) or _ENCODED_ESCAPE.search(item)
            or _WINDOWS_DEVICE.search(item)
            or len(item.encode("utf-8")) > 240 or item.endswith(".tmp-lifeos")
            for item in segments
        ):
            raise UnsafePath("unsafe_path")
        return segments

    @contextlib.contextmanager
    def _parent(self, relative_path: str, *, create: bool) -> Iterator[tuple[int, str]]:
        segments = self._segments(relative_path)
        current = os.dup(self._root_fd)
        try:
            for component in segments[:-1]:
                following = _open_directory(current, component, create=create)
                os.close(current)
                current = following
            yield current, segments[-1]
        finally:
            os.close(current)

    def _assert_parent(self, relative_path: str, held_fd: int) -> None:
        self._assert_lock()
        with self._parent(relative_path, create=False) as (fresh_fd, _name):
            if _identity(os.fstat(fresh_fd)) != _identity(os.fstat(held_fd)):
                raise UnsafePath("note_parent_changed")

    @staticmethod
    def _snapshot(directory_fd: int, name: str) -> _Snapshot | None:
        try:
            info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        except FileNotFoundError:
            return None
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise UnsafePath("unsafe_filesystem_object")
        try:
            fd = os.open(name, _READ_FLAGS, dir_fd=directory_fd)
        except OSError as exc:
            if exc.errno in {errno.ELOOP, errno.ENOTDIR}:
                raise UnsafePath("unsafe_filesystem_object") from None
            raise
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or _identity(before) != _identity(info):
                raise FileConflict("concurrent_note_change")
            chunks: list[bytes] = []
            size = 0
            while True:
                part = os.read(fd, min(65536, MAX_NOTE_BYTES + 1 - size))
                if not part:
                    break
                size += len(part)
                if size > MAX_NOTE_BYTES:
                    raise FilesystemError("note_too_large")
                chunks.append(part)
            after = os.fstat(fd)
            current = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if _version(before) != _version(after) or _identity(current) != _identity(before):
                raise FileConflict("concurrent_note_change")
            return _Snapshot(b"".join(chunks), before.st_dev, before.st_ino)
        finally:
            os.close(fd)

    def read_text(self, relative_path: str) -> str:
        self._assert_root()
        with self._parent(relative_path, create=False) as (parent_fd, name):
            snapshot = self._snapshot(parent_fd, name)
            if snapshot is None:
                raise FileNotFoundError()
            try:
                return snapshot.data.decode("utf-8")
            except UnicodeDecodeError:
                raise FileConflict("invalid_note_encoding") from None

    def current_hash(self, relative_path: str) -> str | None:
        self._assert_root()
        try:
            with self._parent(relative_path, create=False) as (parent_fd, name):
                snapshot = self._snapshot(parent_fd, name)
                return snapshot.content_hash if snapshot is not None else None
        except FileNotFoundError:
            return None

    @staticmethod
    def _write_temp(parent_fd: int, data: bytes) -> str:
        name = f".lifeos-{uuid.uuid4().hex}.tmp-lifeos"
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=parent_fd)
        try:
            view = memoryview(data)
            while view:
                written = os.write(fd, view)
                if written <= 0:
                    raise OSError(errno.EIO, "note_write_failed")
                view = view[written:]
            os.fsync(fd)
            os.fsync(parent_fd)
        except BaseException:
            os.unlink(name, dir_fd=parent_fd)
            raise
        finally:
            os.close(fd)
        return name

    def _retain(self, parent_fd: int, name: str) -> str:
        recovery_fd = self._private_directory(".lifeos-recovery")
        backup_id = f"{uuid.uuid4().hex}.bak"
        try:
            self._assert_root()
            visible = os.stat(".lifeos-recovery", dir_fd=self._root_fd, follow_symlinks=False)
            if _identity(visible) != _identity(os.fstat(recovery_fd)):
                raise UnsafePath("recovery_directory_changed")
            _renameat2(parent_fd, name, recovery_fd, backup_id, 1)  # RENAME_NOREPLACE
            os.fsync(recovery_fd)
            os.fsync(parent_fd)
            return backup_id
        finally:
            os.close(recovery_fd)

    def publish(
        self, relative_path: str, content: str, expected_hash: str | None = None,
        validate_claim: Callable[[], bool] | None = None,
    ) -> PublishResult:
        """Publish or reconcile exact bytes; never overwrite an untracked note.

        ``expected_hash`` must originate from the owned, durable DB ledger.
        Exact desired bytes reconcile a previous successful write/lost DB ACK.
        Every replaced inode is retained; backups are never automatically pruned.
        """
        self._assert_lock()
        if expected_hash is not None and not _HASH.fullmatch(expected_hash):
            raise FilesystemError("invalid_expected_hash")
        desired = content_bytes(content)
        desired_hash = hashlib.sha256(desired).hexdigest()
        with self._parent(relative_path, create=True) as (parent_fd, name):
            before = self._snapshot(parent_fd, name)
            if before is not None and before.content_hash == desired_hash:
                self._assert_parent(relative_path, parent_fd)
                if validate_claim is not None and not validate_claim():
                    raise FilesystemError("claim_lost")
                return PublishResult(desired_hash, True)
            if before is None and expected_hash is not None:
                raise FileConflict("note_missing")
            if before is not None and expected_hash is None:
                raise FileConflict("unmanaged_note")
            if before is not None and before.content_hash != expected_hash:
                raise FileConflict("external_edit")
            if before is not None:
                recovery_fd = self._private_directory(".lifeos-recovery")
                try:
                    if os.fstat(recovery_fd).st_dev != os.fstat(parent_fd).st_dev:
                        raise FilesystemError("atomic_update_unsupported")
                finally:
                    os.close(recovery_fd)
            temp_name = self._write_temp(parent_fd, desired)
            exchanged = False
            try:
                staged = self._snapshot(parent_fd, temp_name)
                if staged is None or staged.content_hash != desired_hash:
                    raise FilesystemError("corrupt_temporary_file")
                self._assert_parent(relative_path, parent_fd)
                if validate_claim is not None and not validate_claim():
                    raise FilesystemError("claim_lost")
                self._assert_parent(relative_path, parent_fd)
                if before is None:
                    try:
                        _publish_new(parent_fd, temp_name, name)
                    except FileExistsError:
                        raise FileConflict("concurrent_note_change") from None
                    temp_name = ""
                    os.fsync(parent_fd)
                    published = self._snapshot(parent_fd, name)
                    if published is None or published.content_hash != desired_hash or (published.device, published.inode) != (staged.device, staged.inode):
                        raise FileConflict("concurrent_note_change")
                    return PublishResult(desired_hash, False)

                _exchange(parent_fd, temp_name, name)
                exchanged = True
                os.fsync(parent_fd)
                try:
                    published = self._snapshot(parent_fd, name)
                    displaced = self._snapshot(parent_fd, temp_name)
                    expected_identity = (before.device, before.inode)
                    if published is None or published.content_hash != desired_hash or (published.device, published.inode) != (staged.device, staged.inode):
                        raise FileConflict("concurrent_note_change")
                    if displaced is None or displaced.content_hash != expected_hash or (displaced.device, displaced.inode) != expected_identity:
                        raise FileConflict("concurrent_note_change")
                except (FilesystemError, OSError):
                    # Restore the file that was present at the exchange. Any
                    # intervening destination is retained too, never discarded.
                    _exchange(parent_fd, temp_name, name)
                    os.fsync(parent_fd)
                    self._retain(parent_fd, temp_name)
                    exchanged = False
                    temp_name = ""
                    raise FileConflict("concurrent_note_change") from None
                backup_id = self._retain(parent_fd, temp_name)
                exchanged = False
                temp_name = ""
                return PublishResult(desired_hash, False, backup_id)
            finally:
                if temp_name:
                    if exchanged:
                        # Publication happened: this is the displaced inode.
                        # Retain it even when post-rename fsync/inspection failed.
                        self._retain(parent_fd, temp_name)
                    else:
                        os.unlink(temp_name, dir_fd=parent_fd)

    def write_if_missing(
        self, relative_path: str, content: str, validate_claim: Callable[[], bool] | None = None,
    ) -> bool:
        self._assert_lock()
        with self._parent(relative_path, create=True) as (parent_fd, name):
            if self._snapshot(parent_fd, name) is not None:
                return False
        try:
            return not self.publish(relative_path, content, validate_claim=validate_claim).unchanged
        except FileConflict as exc:
            if exc.code in {"unmanaged_note", "concurrent_note_change"}:
                return False
            raise
