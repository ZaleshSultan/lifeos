"""Shared per-user/platform synchronization lease for legacy and tenant workers."""
from __future__ import annotations

import threading
import time
import uuid
from typing import Any

from common.lifeos_sync import SyncError


def guard_lms_client(db: Any, lease: "LmsSyncLease") -> Any:
    """Stop a long sync's database operations immediately after lease loss."""
    original = db.request
    def scoped_request(method: str, table: str, *args: Any, **kwargs: Any) -> Any:
        if table not in {"rpc/claim_lms_sync_lease", "rpc/release_lms_sync_lease"}:
            lease.assert_held()
        return original(method, table, *args, **kwargs)
    db.request = scoped_request
    return db


class LmsSyncLease:
    def __init__(self, db: Any, user_id: str, platform_type: str = "aitu_moodle", *, owner: str | None = None, ttl_seconds: int = 900) -> None:
        if not user_id or platform_type not in {"aitu_moodle", "platonus"} or not 15 <= ttl_seconds <= 900:
            raise SyncError("Invalid LMS synchronization lease")
        self.db = db
        self.user_id = user_id
        self.platform_type = platform_type
        self.owner = owner or str(uuid.uuid4())
        self.ttl_seconds = ttl_seconds
        self.acquired = False
        self._lost = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._deadline = 0.0

    def _claim(self) -> bool:
        started = time.monotonic()
        try:
            result = self.db.request("POST", "rpc/claim_lms_sync_lease", body={
                "p_user_id": self.user_id, "p_platform_type": self.platform_type,
                "p_owner": self.owner, "p_ttl_seconds": self.ttl_seconds,
            })
        except Exception:
            raise SyncError("LMS synchronization lease unavailable") from None
        if result is True:
            self._deadline = started + self.ttl_seconds - 1
            return time.monotonic() < self._deadline
        return False

    def renew(self) -> bool:
        if not self.acquired or self._lost.is_set() or time.monotonic() >= self._deadline:
            self._lost.set()
            return False
        try:
            renewed = self._claim()
        except SyncError:
            renewed = False
        if not renewed:
            self._lost.set()
        return renewed

    def assert_held(self) -> None:
        if not self.acquired or self._lost.is_set() or time.monotonic() >= self._deadline:
            raise SyncError("LMS synchronization lease lost")

    def _heartbeat(self) -> None:
        while not self._stop.wait(self.ttl_seconds / 3):
            if not self.renew():
                return

    def __enter__(self) -> "LmsSyncLease":
        self.acquired = self._claim()
        if self.acquired:
            self._thread = threading.Thread(target=self._heartbeat, name="lms-sync-lease", daemon=True)
            self._thread.start()
        return self

    def __exit__(self, _kind: object, _value: object, _traceback: object) -> None:
        self._stop.set()
        if self._thread:
            # Let an in-flight bounded renewal finish before release, preventing
            # a late renewal from recreating the lock after the final release.
            self._thread.join(timeout=31)
        if self.acquired:
            try:
                self.db.request("POST", "rpc/release_lms_sync_lease", body={
                    "p_user_id": self.user_id, "p_platform_type": self.platform_type, "p_owner": self.owner,
                })
            except Exception:
                pass  # Expiry recovers an unreachable release; no raw failures logged.
        self.acquired = False
