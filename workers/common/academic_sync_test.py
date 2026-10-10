from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from common.academic_sync import sync_assessment
from common.lifeos_sync import BaseSettings, SyncError


class AssessmentPreservationTest(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.db.settings = BaseSettings("https://example.supabase.co", "test-key", "user-a", "Asia/Almaty")
        self.course = {"id": "course-a", "user_id": "user-a"}
        self.record = {"title": "Essay", "record_type": "assignment", "score": None, "max_score": 100}

    def test_missing_visible_grade_preserves_existing_score_scale_and_graded_state(self):
        self.db.request.side_effect = [[{"id": "assessment-a", "source": "aitu_moodle", "status": "graded"}], None]
        sync_assessment(self.db, self.course, self.record, "moodle:42:1", {"score": None})
        update = self.db.request.call_args
        self.assertEqual(update.args[:2], ("PATCH", "assessment_items"))
        for key in ("actual_score", "max_score", "status"):
            self.assertNotIn(key, update.kwargs["body"])
        self.assertEqual(update.kwargs["query"]["study_course_id"], "eq.course-a")
        self.assertEqual(update.kwargs["body"]["title"], "Essay")

    def test_new_ungraded_assessment_remains_pending_without_fabricated_score(self):
        self.db.request.side_effect = [[], None]
        sync_assessment(self.db, self.course, self.record, "moodle:42:1", {})
        insert = self.db.request.call_args
        self.assertEqual(insert.args[:2], ("POST", "assessment_items"))
        self.assertIsNone(insert.kwargs["body"]["actual_score"])
        self.assertEqual(insert.kwargs["body"]["status"], "pending")

    def test_verified_zero_score_updates_existing_assessment(self):
        self.db.request.side_effect = [[{"id": "assessment-a", "source": "aitu_moodle", "status": "pending"}], None]
        sync_assessment(self.db, self.course, {**self.record, "score": 0}, "moodle:42:1", {})
        self.assertEqual(self.db.request.call_args.kwargs["body"]["actual_score"], 0)
        self.assertEqual(self.db.request.call_args.kwargs["body"]["status"], "graded")

    def test_foreign_course_and_manual_assessment_cannot_be_overwritten(self):
        with self.assertRaises(SyncError):
            sync_assessment(self.db, {**self.course, "user_id": "user-b"}, self.record, "moodle:42:1", {})
        self.db.request.assert_not_called()
        self.db.request.return_value = [{"id": "manual", "source": "manual", "status": "pending"}]
        with self.assertRaises(SyncError):
            sync_assessment(self.db, self.course, self.record, "moodle:42:1", {})
        self.assertEqual(self.db.request.call_count, 1)


if __name__ == "__main__":
    unittest.main()
