from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from common.lifeos_sync import SyncError
from common.lms_sync_lease import LmsSyncLease, guard_lms_client


class LmsSyncLeaseTest(unittest.TestCase):
    def setUp(self):
        self.threads = patch("common.lms_sync_lease.threading.Thread").start()
        self.addCleanup(patch.stopall)
        self.db = MagicMock()
        self.db.request.return_value = True

    def test_claim_renew_and_release_share_user_platform_and_owner(self):
        with LmsSyncLease(self.db, "user-a", owner="owner-a") as lease:
            self.assertTrue(lease.acquired)
            lease.assert_held()
            self.assertTrue(lease.renew())
        calls = self.db.request.call_args_list
        self.assertEqual(len(calls), 3)
        for call in calls:
            self.assertEqual(call.kwargs["body"]["p_user_id"], "user-a")
            self.assertEqual(call.kwargs["body"]["p_platform_type"], "aitu_moodle")
            self.assertEqual(call.kwargs["body"]["p_owner"], "owner-a")
        self.assertEqual(calls[0].args, ("POST", "rpc/claim_lms_sync_lease"))
        self.assertEqual(calls[-1].args, ("POST", "rpc/release_lms_sync_lease"))
        self.assertNotIn("p_ttl_seconds", calls[-1].kwargs["body"])
        self.assertFalse(lease.acquired)
        self.threads.return_value.start.assert_called_once()

    def test_lease_contention_or_malformed_rpc_response_is_not_acquisition(self):
        for response in (False, None, "true", [True], {"acquired": True}):
            self.db.reset_mock()
            self.db.request.return_value = response
            with LmsSyncLease(self.db, "user-a") as lease:
                self.assertFalse(lease.acquired)
                with self.assertRaises(SyncError):
                    lease.assert_held()
            self.assertEqual(self.db.request.call_count, 1)

    def test_renewal_loss_stops_writes_and_does_not_reacquire(self):
        self.db.request.side_effect = [True, False, True]
        with LmsSyncLease(self.db, "user-a") as lease:
            self.assertFalse(lease.renew())
            with self.assertRaises(SyncError):
                lease.assert_held()
            self.assertFalse(lease.renew())
        self.assertEqual(self.db.request.call_count, 3)

    def test_paused_process_cannot_silently_reacquire_an_expired_lease(self):
        with patch("common.lms_sync_lease.time.monotonic", return_value=0):
            with LmsSyncLease(self.db, "user-a", ttl_seconds=15) as lease:
                with patch("common.lms_sync_lease.time.monotonic", return_value=16):
                    with self.assertRaises(SyncError):
                        lease.assert_held()
                    self.assertFalse(lease.renew())
                    self.assertEqual(self.db.request.call_count, 1)

    def test_errors_release_acquired_lock_and_redact_raw_rpc_failures(self):
        with self.assertRaisesRegex(RuntimeError, "scrape failed"):
            with LmsSyncLease(self.db, "user-a"):
                raise RuntimeError("scrape failed")
        self.assertEqual(self.db.request.call_args.args[1], "rpc/release_lms_sync_lease")
        self.db.request.side_effect = RuntimeError("secret service key")
        with self.assertRaises(SyncError) as caught:
            with LmsSyncLease(self.db, "user-a"):
                self.fail("RPC failure must not continue")
        self.assertNotIn("secret", str(caught.exception))

    def test_lost_lease_blocks_each_database_request_but_permits_its_release(self):
        with LmsSyncLease(self.db, "user-a") as lease:
            client = MagicMock()
            original = client.request
            guard_lms_client(client, lease)
            client.request("PATCH", "source_events", body={"status": "active"})
            original.assert_called_once()
            lease._lost.set()
            with self.assertRaises(SyncError):
                client.request("PATCH", "academic_records", body={"score": 10})
            self.assertEqual(original.call_count, 1)
            client.request("POST", "rpc/release_lms_sync_lease", body={"p_owner": lease.owner})
            self.assertEqual(original.call_count, 2)

    def test_users_and_platforms_get_independent_lock_keys(self):
        with LmsSyncLease(self.db, "user-a", "aitu_moodle") as first:
            with LmsSyncLease(self.db, "user-b", "aitu_moodle") as second:
                with LmsSyncLease(self.db, "user-a", "platonus") as third:
                    self.assertEqual(len({first.owner, second.owner, third.owner}), 3)
        claims = [call.kwargs["body"] for call in self.db.request.call_args_list if call.args[1].endswith("claim_lms_sync_lease")]
        self.assertEqual({(body["p_user_id"], body["p_platform_type"]) for body in claims}, {("user-a", "aitu_moodle"), ("user-b", "aitu_moodle"), ("user-a", "platonus")})


if __name__ == "__main__":
    unittest.main()
