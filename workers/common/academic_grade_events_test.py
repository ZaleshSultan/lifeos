import math
import os
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from common.academic_grade_events import capture_grade_snapshot, drain_grade_snapshots, grade_events_enabled, stage_grade_snapshot, verified_grade_snapshot
from common.lifeos_sync import SyncError


class GradeSnapshotTests(unittest.TestCase):
    def record(self, **changes):
        return {"course_id": "42", "item_id": "101", "course_title": "Synthetic course", "title": "Synthetic work",
                "score": 0, "max_score": None, "raw": {"moodle_module": "assign", "moodle_cmid": "77"}, **changes}

    def test_unknown_and_zero_are_distinct_and_raw_maximum_is_preserved(self):
        rows = verified_grade_snapshot([self.record(), self.record(item_id="102", score=None, max_score=0)])
        self.assertEqual((rows[0]["score"], rows[0]["maxScore"]), (0, None))
        self.assertEqual((rows[1]["score"], rows[1]["maxScore"]), (None, None))
        self.assertEqual(rows[0]["sourceUrl"], "https://lms.astanait.edu.kz/mod/assign/view.php?id=77")

    def test_title_hashes_are_not_promoted_to_authoritative_grade_identity(self):
        self.assertEqual(verified_grade_snapshot([self.record(item_id="title-not-an-lms-id")]), [])
        with self.assertRaises(SyncError):
            verified_grade_snapshot([self.record(), self.record()])

    def test_invalid_numeric_data_is_rejected_without_fabricating_zero(self):
        for value in (math.nan, math.inf, -1, "unknown", True):
            with self.subTest(value=value), self.assertRaises(SyncError):
                verified_grade_snapshot([self.record(score=value)])

    def test_rpc_is_owner_and_lease_bound_and_contains_no_session_or_unfiltered_raw_data(self):
        db = SimpleNamespace(settings=SimpleNamespace(user_id="owner"), request=Mock(return_value={"seen": 1, "eventsCreated": 0}))
        capture_grade_snapshot(db, user_id="owner", run_id="run", lease_owner="lease", records=[self.record(raw={"session": "never-pass", "moodle_module": "quiz", "moodle_cmid": "77"})], complete=False)
        args, kwargs = db.request.call_args
        self.assertEqual(args, ("POST", "rpc/capture_moodle_grade_snapshot"))
        self.assertEqual(kwargs["body"]["p_user_id"], "owner")
        self.assertEqual(kwargs["body"]["p_lease_owner"], "lease")
        self.assertEqual(kwargs["body"]["p_complete"], False)
        self.assertNotIn("never-pass", repr(kwargs["body"]))
        db.request.reset_mock()
        with self.assertRaises(SyncError):
            capture_grade_snapshot(db, user_id="other", run_id="run", lease_owner="lease", records=[], complete=True)
        db.request.assert_not_called()

    def test_verified_zero_score_keeps_a_positive_maximum(self):
        self.assertEqual(verified_grade_snapshot([self.record(max_score=30)])[0]["maxScore"], 30)

    def test_staging_is_required_before_success_and_replay_uses_exact_durable_run(self):
        db = SimpleNamespace(settings=SimpleNamespace(user_id="owner"), request=Mock(return_value=True))
        stage_grade_snapshot(db, user_id="owner", run_id="run15", lease_owner="lease", records=[self.record(score=15, max_score=30)], complete=False)
        self.assertEqual(db.request.call_args.args, ("POST", "rpc/stage_moodle_grade_snapshot"))
        self.assertEqual(db.request.call_args.kwargs["body"]["p_records"][0]["score"], 15)
        db.request.return_value = {"drained": 2, "remaining": False}
        self.assertEqual(drain_grade_snapshots(db, user_id="owner", lease_owner="nextlease")["drained"], 2)
        self.assertEqual(db.request.call_args.kwargs["body"], {"p_user_id": "owner", "p_lease_owner": "nextlease"})
        db.request.return_value = {"drained": 50, "remaining": True}
        with self.assertRaises(SyncError):
            drain_grade_snapshots(db, user_id="owner", lease_owner="nextlease")

    def test_filtering_unstable_identity_downgrades_complete_inventory_in_both_rpc_paths(self):
        db = SimpleNamespace(settings=SimpleNamespace(user_id="owner"), request=Mock(return_value=True))
        records = [self.record(), self.record(item_id="title-hash")]
        self.assertFalse(stage_grade_snapshot(db, user_id="owner", run_id="run", lease_owner="lease", records=records, complete=True))
        self.assertIs(db.request.call_args.kwargs["body"]["p_complete"], False)
        db.request.return_value = {"seen": 1, "eventsCreated": 0}
        capture_grade_snapshot(db, user_id="owner", run_id="run", lease_owner="lease", records=records, complete=True)
        self.assertIs(db.request.call_args.kwargs["body"]["p_complete"], False)
        self.assertEqual(len(db.request.call_args.kwargs["body"]["p_records"]), 1)

    def test_history_capability_starts_off(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(grade_events_enabled())
        with patch.dict(os.environ, {"LIFEOS_ACADEMIC_GRADE_EVENTS_ENABLED": "true"}, clear=True):
            self.assertTrue(grade_events_enabled())


if __name__ == "__main__":
    unittest.main()
