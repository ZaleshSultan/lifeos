from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest


SPEC = importlib.util.spec_from_file_location(
    "diagnose_moodle_scores", Path(__file__).with_name("diagnose_moodle_scores.py")
)
assert SPEC and SPEC.loader
diagnostic = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(diagnostic)


class FakeDb:
    def __init__(self) -> None:
        self.settings = SimpleNamespace(user_id="user-a")
        self.calls: list[tuple[str, str, dict[str, str]]] = []
        self.events = [
            {"id": f"event-{index:03d}", "external_id": f"academic:moodle:42:{index}"}
            for index in range(101)
        ] + [{"id": "legacy", "external_id": "academic:grade:old"}]
        self.records = [
            {
                "id": f"record-{index:03d}",
                "source_event_id": f"event-{index:03d}",
                "score": 8.5 if index == 0 else None,
                "max_score": 10,
                "percentage": 85 if index == 0 else None,
                "raw_json": {
                    "grade_cell_text": "7 accepted for grading" if index == 1 else "-",
                    "private": "PRIVATE_TEST_SENTINEL",
                },
            }
            for index in range(101)
        ] + [{"id": "legacy-record", "source_event_id": "legacy", "score": 10}]

    def request(self, method, table, query=None):
        assert method == "GET"
        assert query["user_id"] == "eq.user-a"
        self.calls.append((method, table, query))
        if table == "sync_runs":
            return [{"status": "success", "records_seen": 101,
                     "records_updated": 101, "error_message": "PRIVATE_TEST_SENTINEL"}]
        rows = self.events if table == "source_events" else self.records
        if "id" in query:
            rows = [row for row in rows if row["id"] > query["id"][3:]]
        return rows[:int(query["limit"])]


class MoodleScoreDiagnosticTest(unittest.TestCase):
    def test_pages_scoped_reads_and_never_prints_raw_text_or_errors(self):
        db = FakeDb()
        report = diagnostic.diagnose(db)
        self.assertEqual(report["active_moodle_records"], 101)
        self.assertEqual(report["db_score_present"], 1)
        self.assertEqual(report["db_score_null"], 100)
        self.assertEqual(report["null_score_html_contains_digit"], 1)
        self.assertEqual(report["null_score_html_plain_numeric"], 0)
        self.assertEqual(report["latest_sync_status"], "success")
        self.assertTrue(report["latest_sync_error_present"])
        self.assertNotIn("PRIVATE_TEST_SENTINEL", json.dumps(report))
        self.assertGreater(len(db.calls), 3)  # Records and events both page.
        self.assertTrue(all(method == "GET" for method, _, _ in db.calls))
        self.assertEqual(db.calls[0][2]["status"], "eq.active")


if __name__ == "__main__":
    unittest.main()
