"""Regressions for the actual TH/weight/grade Moodle layout and persistence."""
from __future__ import annotations

import copy
import fnmatch
import sys
import traceback
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent))
import university_scraper as scraper
from common.academic_sync import link_course, mark_missing_grades, match_course
from common.lifeos_sync import BaseSettings, ReminderSyncStats, SupabaseRestClient, SyncError
from common.moodle_grades import parse_report

BASE = BaseSettings("https://example.supabase.co", "test-key", "user-a", "Asia/Almaty")
SETTINGS = scraper.Settings(BASE, "test", "test", None, None, 3600, False)
COURSE = {"id": "course-a", "user_id": "user-a", "code": "DMS52-EN",
          "title": "Системы управления базами данных", "status": "active", "external_course_key": "moodle:42"}
RECORD = {"course_id": "42", "course_title": "Database Management Systems | Teacher",
          "item_id": "901", "title": "Assignment 1", "record_type": "assignment", "score": None, "max_score": 10}
ASSIGNMENT = {"course_id": "42", "course_title": RECORD["course_title"],
              "assignment_id": "77", "cmid": "1201", "title": "Assignment 1",
              "due_at": "2099-10-01T10:00:00Z"}


class MemoryDb(SupabaseRestClient):
    """Small REST fake: apply query filters to writes as well as reads."""
    def __init__(self):
        self.settings = BASE
        self.tables = {"study_courses": [copy.deepcopy(COURSE)], "academic_records": [],
                       "assessment_items": [], "source_events": [], "sync_runs": [], "reminders": []}
        self.finished = []
        self.cancelled = []
        self.queries = []
        self.clock = datetime(2026, 9, 25, 9, 0, tzinfo=timezone.utc)

    def tick(self):
        self.clock += timedelta(seconds=1)
        return self.clock.isoformat().replace("+00:00", "Z")

    def request(self, method, table, query=None, body=None, prefer=None):
        self.queries.append((method, table, query, copy.deepcopy(body)))
        rows = self.tables[table]
        def value_for(row, key):
            if key.startswith("metadata_json->>"):
                value = (row.get("metadata_json") or {}).get(key.split("->>", 1)[1])
                return str(value).lower() if isinstance(value, bool) else str(value)
            return str(row.get(key))
        matches = [row for row in rows if all(
            value_for(row, key) == value[3:] if value.startswith("eq.") else
            fnmatch.fnmatchcase(value_for(row, key), value[5:]) if value.startswith("like.") else True
            for key, value in (query or {}).items()
        )]
        if method == "GET":
            return copy.deepcopy(matches)
        if method == "POST":
            row = {"id": f"{table}-{len(rows)}", **copy.deepcopy(body)}
            rows.append(row)
            return [row]
        if method == "PATCH":
            for row in matches:
                row.update(copy.deepcopy(body))
            return copy.deepcopy(matches)
        raise AssertionError(method)

    def ensure_source(self, *args):
        return {"id": "source-a"}

    def start_sync_run(self, source):
        run_id = f"run-{len(self.tables['sync_runs'])}"
        self.tables["sync_runs"].append({
            "id": run_id, "user_id": self.settings.user_id,
            "source_key": "university_platform", "status": "running",
        })
        return run_id

    def finish_sync_run(self, *args, **kwargs):
        self.finished.append(args)
        run_id, status = args[:2]
        row = next(row for row in self.tables["sync_runs"] if row["id"] == run_id)
        row["status"] = status
        row["metadata_json"] = copy.deepcopy(kwargs.get("metadata") or {})
        row["finished_at"] = self.tick()

    def upsert_event(self, event, mode):
        rows = self.tables["source_events"]
        found = next((row for row in rows if row["external_id"] == event["external_id"]), None)
        created = found is None
        if created:
            found = {"id": f"event-{len(rows)}", "user_id": self.settings.user_id,
                     "created_at": self.tick()}
            rows.append(found)
        found.update(copy.deepcopy(event))
        return found, created, ReminderSyncStats()

    def cancel_future_reminders(self, event_id):
        self.cancelled.append(event_id)


class ActualMoodleLayoutTest(unittest.TestCase):
    def parse(self, rows):
        html = '<table class="user-grade"><tr><th>Grade item</th><th>Weight</th><th>Grade</th><th>Range</th></tr>' + rows + '</table>'
        return parse_report(scraper._bs4_parse(html), 42, RECORD["course_title"])

    def test_th_title_weight_column_ungraded_real_zero_and_totals(self):
        rows = '''
          <tr><th class="item" id="row_901_55">Assignment 1</th><td class="weight">-</td><td class="grade">-</td><td class="range">0–10</td></tr>
          <tr><th class="item" id="row_902_55">Assignment 1</th><td class="weight">-</td><td class="grade">0,00</td><td class="range">0–20</td></tr>
          <tr><th class="item" id="row_903_55">Задание 2</th><td class="weight">-</td><td class="grade">8,50</td><td class="range">0–10</td></tr>
          <tr><th class="item category">Register Term</th><td>-</td><td class="grade">0</td><td class="range">0–100</td></tr>
          <tr><th class="item courseitem">Course total</th><td>-</td><td class="grade">0</td><td class="range">0–100</td></tr>'''
        records = self.parse(rows)
        self.assertEqual([r["title"] for r in records], ["Assignment 1", "Assignment 1", "Задание 2"])
        self.assertEqual([r["item_id"] for r in records], ["901", "902", "903"])
        self.assertEqual([r["score"] for r in records], [None, 0, 8.5])
        self.assertEqual([r["max_score"] for r in records], [10, 20, 10])

    def test_unicode_fallback_is_stable_and_distinct(self):
        records = self.parse('<tr><td>Задание 1</td><td>-</td><td>2</td><td>-</td></tr><tr><td>Задание 2</td><td>-</td><td>4</td><td>-</td></tr>')
        self.assertNotEqual(records[0]["item_id"], records[1]["item_id"])
        self.assertIsNone(records[0]["max_score"])
        renamed_grade = self.parse('<tr><td>Задание 1</td><td>-</td><td>5</td><td>-</td></tr>')
        self.assertEqual(records[0]["item_id"], renamed_grade[0]["item_id"])

    def test_aitu_row_identity_is_item_id_followed_by_user_id(self):
        # Structure and row IDs from the user's course-2482 diagnostic.
        # Titles/grade values are synthetic; no private response HTML is stored.
        html = '''
          <tr><th class="level3 item b1b column-itemname" id="row_48613_14505">Work 1</th>
            <td class="level3 item b1b column-weight">-</td>
            <td class="level3 item b1b column-grade">-</td>
            <td class="level3 item b1b column-range">0–10</td></tr>
          <tr><th class="level3 item b1b column-itemname" id="row_48614_14505">Work 2</th>
            <td class="level3 item b1b column-weight">-</td>
            <td class="level3 item b1b column-grade">0</td>
            <td class="level3 item b1b column-range">0–20</td></tr>'''
        records = self.parse(html)
        self.assertEqual([record["item_id"] for record in records], ["48613", "48614"])
        self.assertEqual([record["score"] for record in records], [None, 0])
        another_user = self.parse(html.replace("_14505", "_22222"))
        self.assertEqual([record["item_id"] for record in another_user], ["48613", "48614"])

    def test_html_link_preserves_assignment_cmid_even_with_grade_row_id(self):
        records = self.parse('''
          <tr><th class="item" id="row_901_55">
            <a href="/mod/assign/view.php?id=1201">Assignment 1</a></th>
            <td class="grade">7</td><td class="range">0–10</td></tr>''')
        self.assertEqual(records[0]["item_id"], "901")
        self.assertEqual(records[0]["raw"]["moodle_module"], "assign")
        self.assertEqual(records[0]["raw"]["moodle_cmid"], "1201")

    def test_moodle_aggregate_css_markers_are_not_assessments(self):
        # Moodle user-report renders totals as baggt/baggb, not necessarily
        # with the categoryitem/courseitem class names used in our old fixture.
        for marker in ("baggt", "baggb"):
            with self.subTest(marker=marker):
                rows = f'''
                  <tr><th class="level2 {marker} column-itemname" id="row_48612_14505">Register Term</th>
                    <td class="column-weight">-</td><td class="column-grade">0</td><td class="column-range">0–100</td></tr>
                  <tr><th class="item column-itemname" id="row_48613_14505">Assignment</th>
                    <td class="column-weight">-</td><td class="column-grade">-</td><td class="column-range">0–10</td></tr>'''
                records = self.parse(rows)
                self.assertEqual([record["item_id"] for record in records], ["48613"])
                self.assertIsNone(records[0]["score"])

    def test_grade_action_menu_does_not_hide_score_or_invent_unknown_grade(self):
        rows = '''
          <tr><th class="item" id="row_901_55">Work 1</th>
            <td class="grade column-grade"><div class="d-flex align-items-center">
              <div>8,50</div><div class="ps-1 d-flex align-items-center">
                <div class="action-menu moodle-actionmenu"><button>Actions</button>
                  <a href="#analysis">Grade analysis</a></div>
              </div></div></td><td class="range">0–10</td></tr>
          <tr><th class="item" id="row_902_55">Work 2</th>
            <td class="grade column-grade"><div class="d-flex align-items-center">
              <div>-</div><div class="ps-1 d-flex align-items-center">
                <div class="action-menu moodle-actionmenu"><button>Actions</button>
                  <a href="#analysis">Grade analysis 2026</a></div>
              </div></div></td><td class="range">0–20</td></tr>'''
        records = [
            {**record, "record_type": scraper.classify_record_type(record["title"])}
            for record in self.parse(rows)
        ]
        self.assertEqual([record["score"] for record in records], [8.5, None])
        self.assertEqual([record["max_score"] for record in records], [10, 20])
        self.assertIn("Actions Grade analysis", records[0]["raw"]["grade_cell_text"])

        db = MemoryDb()
        scraper.sync_grades(db, SETTINGS, records, "normal", False)
        self.assertEqual(db.tables["academic_records"][0]["score"], 8.5)
        self.assertEqual(db.tables["academic_records"][0]["max_score"], 10)
        self.assertEqual(db.tables["academic_records"][0]["percentage"], 85.0)
        self.assertIsNone(db.tables["academic_records"][1]["score"])
        self.assertIsNone(db.tables["academic_records"][1]["percentage"])

    def test_ambiguous_fallback_fails_instead_of_overwriting(self):
        with self.assertRaises(SyncError):
            self.parse('<tr><td>Same</td><td>1</td></tr><tr><td>Same</td><td>2</td></tr>')

    def test_missing_table_is_failure(self):
        with self.assertRaises(SyncError):
            parse_report(scraper._bs4_parse('<form>Sign in</form>'), 42, "Course")

    def test_partial_scrape_is_failure(self):
        client = scraper.MoodleClient(SETTINGS)
        with patch.object(client, "_scrape_enrolled_course_ids", return_value=[(1, "A"), (2, "B")]), patch.object(client, "_scrape_grade_report", side_effect=[[RECORD], SyncError("Unrecognized grade columns for course 2")]):
            with self.assertRaises(SyncError) as caught:
                client.fetch_via_scrape()
        self.assertEqual(str(caught.exception), "Incomplete Moodle snapshot: course 2 failed: Unrecognized grade columns for course 2")

    def test_snapshot_failure_does_not_expose_request_url_or_unknown_error_text(self):
        from requests.exceptions import HTTPError

        secret_url = "https://login.example/authorize?code=secret-code&state=secret-state"
        response = MagicMock(status_code=403)
        for failure, expected in (
            (HTTPError(f"403 Client Error for url: {secret_url}", response=response), "HTTP 403 (HTTPError)"),
            (ConnectionError(f"Request failed: {secret_url}"), "ConnectionError"),
            (SyncError(f"Unexpected HTML from {secret_url}"), "SyncError"),
        ):
            with self.subTest(error_type=type(failure).__name__):
                client = scraper.MoodleClient(SETTINGS)
                with patch.object(client, "_scrape_enrolled_course_ids", return_value=[(2482, "Course")]), patch.object(client, "_scrape_grade_report", side_effect=failure):
                    try:
                        client.fetch_via_scrape()
                    except SyncError as exc:
                        message = str(exc)
                        rendered = "".join(traceback.format_exception(exc))
                    else:
                        self.fail("An incomplete snapshot must raise")
                self.assertEqual(message, f"Incomplete Moodle snapshot: course 2482 failed: {expected}")
                self.assertNotIn(secret_url, rendered)
                self.assertNotIn("secret-code", rendered)
                self.assertNotIn("secret-state", rendered)

    def test_safe_parser_failure_details_are_preserved(self):
        for message in (
            "Moodle grade table missing for course 2482; refusing an empty snapshot",
            "Unrecognized grade columns for course 2482",
            "Ambiguous Moodle grade identity in course 2482",
            "Unrecognized Moodle numeric grade",
            "Invalid Moodle numeric grade",
        ):
            with self.subTest(message=message):
                self.assertEqual(scraper._safe_grade_report_error(SyncError(message)), message)

    def test_authenticated_scrape_failure_never_falls_back_to_login_or_mock(self):
        for strategy in ("sso", "form"):
            with self.subTest(strategy=strategy):
                client = scraper.MoodleClient(replace(SETTINGS, sso_cookie="test-cookie" if strategy == "sso" else None, allow_mock=True))
                session = object()
                client._session = session
                client._moodle_user_id = 14505
                failure = SyncError("Incomplete Moodle snapshot: course 2482 failed: HTTP 403 (HTTPError)")
                with (
                    patch.object(client, "_sso_cookie_login", return_value=True) as sso,
                    patch.object(client, "_form_login", return_value=True) as form,
                    patch.object(client, "fetch_via_scrape", side_effect=failure),
                    patch.object(client, "_mock_grades") as mock,
                ):
                    with self.assertRaises(SyncError) as caught:
                        client.fetch_grades()
                self.assertIs(caught.exception, failure)
                if strategy == "sso":
                    sso.assert_called_once()
                    form.assert_not_called()
                else:
                    sso.assert_not_called()
                    form.assert_called_once()
                mock.assert_not_called()
                self.assertFalse(client.is_mocked)
                self.assertIs(client._session, session)
                self.assertEqual(client._moodle_user_id, 14505)

    def test_failed_sso_login_still_tries_form_login(self):
        for result in (False, SyncError("SSO connection failed")):
            with self.subTest(result=type(result).__name__):
                client = scraper.MoodleClient(replace(SETTINGS, sso_cookie="test-cookie"))
                with (
                    patch.object(client, "_sso_cookie_login", side_effect=result if isinstance(result, Exception) else None, return_value=False),
                    patch.object(client, "_form_login", return_value=True) as form,
                    patch.object(client, "fetch_via_scrape", return_value=[RECORD]),
                ):
                    self.assertEqual(client.fetch_grades(), [RECORD])
                form.assert_called_once()

    def test_ws_preserves_unknown_and_skips_aggregates(self):
        client = scraper.MoodleClient(SETTINGS)
        with patch.object(client, "_ws_get_userid", return_value=55), patch.object(client, "_ws_get_enrolled_courses", return_value=[{"id": 42}]), patch.object(client, "_ws_get_grade_items", return_value=[
            {"id": 901, "itemtype": "mod", "itemname": "Work", "graderaw": None, "grademax": 10},
            {"id": 902, "itemtype": "mod", "itemname": "Zero", "graderaw": 0, "grademax": 10},
            {"id": 903, "itemtype": "category", "graderaw": 0},
            {"id": 904, "itemtype": "course", "graderaw": 0},
        ]):
            records = client.fetch_via_ws()
        self.assertEqual([r["score"] for r in records], [None, 0])

    def test_partial_ws_is_failure(self):
        client = scraper.MoodleClient(SETTINGS)
        with patch.object(client, "_ws_get_userid", return_value=55), patch.object(client, "_ws_get_enrolled_courses", return_value=[{"id": 42}, {"id": 43}]), patch.object(client, "_ws_get_grade_items", side_effect=[[], SyncError("denied")]):
            with self.assertRaises(SyncError):
                client.fetch_via_ws()


class AssignmentDeadlinePersistenceTest(unittest.TestCase):
    def test_assignment_ws_permission_failure_does_not_fail_grade_sync(self):
        db = MemoryDb()
        settings = replace(SETTINGS, ws_token="test-token")
        with (
            patch.object(scraper, "SupabaseRestClient", return_value=db),
            patch.object(scraper.MoodleClient, "fetch_grades", return_value=[RECORD]),
            patch.object(scraper.MoodleClient, "_ws_get_userid", return_value=55),
            patch.object(scraper.MoodleClient, "_ws_get_enrolled_courses", return_value=[{"id": 42}]),
            patch.object(scraper.MoodleClient, "_ws_call", side_effect=SyncError("access denied")),
            patch.object(db, "get_reminder_mode", return_value="normal"),
        ):
            result = scraper.sync_once(settings)

        self.assertEqual(result.seen, 1)
        self.assertEqual(db.tables["sync_runs"][-1]["status"], "success")
        self.assertEqual([row["event_type"] for row in db.tables["source_events"]], ["academic_grade"])
        self.assertNotIn("moodle_assignments_synced", db.tables["sync_runs"][-1]["metadata_json"])

    def test_existing_grade_history_does_not_announce_first_assignment_snapshot(self):
        db = MemoryDb()
        scraper.sync_grades(db, SETTINGS, [RECORD], "normal", False)
        historical = [
            {**ASSIGNMENT, "assignment_id": str(1000 + index), "title": f"Work {index}"}
            for index in range(25)
        ]

        initial = scraper.sync_grades(db, SETTINGS, [RECORD], "normal", False, assignments=historical)

        self.assertEqual(initial.reminders_created, 0)
        self.assertEqual(len([row for row in db.tables["source_events"] if row["event_type"] == "task"]), 25)
        self.assertEqual(db.tables["reminders"], [])
        self.assertTrue(db.tables["sync_runs"][-1]["metadata_json"]["moodle_assignments_synced"])

        new_assignment = {**ASSIGNMENT, "assignment_id": "2000", "title": "New work"}
        first = scraper.sync_grades(db, SETTINGS, [RECORD], "normal", False, assignments=[*historical, new_assignment])
        repeated = scraper.sync_grades(db, SETTINGS, [RECORD], "normal", False, assignments=[*historical, new_assignment])

        self.assertEqual((first.reminders_created, repeated.reminders_created), (1, 0))
        self.assertEqual(len(db.tables["reminders"]), 1)
        reminder = db.tables["reminders"][0]
        self.assertEqual(reminder["dedup_key"], "assignment_added:assignment:moodle:42:2000")
        self.assertEqual(reminder["metadata_json"]["notification_kind"], "instant_academic")
        self.assertIsNone(reminder["source_event_id"])
        self.assertIn("Новое задание по «Database Management Systems | Teacher»", reminder["message"])
        self.assertIn("Asia/Almaty", reminder["message"])

    def test_empty_first_snapshot_enables_later_assignment_notification(self):
        db = MemoryDb()
        scraper.sync_grades(db, SETTINGS, [], "normal", False, assignments=[])

        result = scraper.sync_grades(db, SETTINGS, [], "normal", False, assignments=[ASSIGNMENT])

        self.assertEqual(result.reminders_created, 1)
        self.assertEqual(db.tables["source_events"][0]["event_type"], "task")
        self.assertEqual(db.tables["source_events"][0]["due_at"], ASSIGNMENT["due_at"])

    def test_unavailable_snapshot_keeps_deadlines_but_complete_empty_snapshot_retires_them(self):
        db = MemoryDb()
        scraper.sync_grades(db, SETTINGS, [RECORD], "normal", False, assignments=[ASSIGNMENT])
        task = next(row for row in db.tables["source_events"] if row["event_type"] == "task")
        grade = next(row for row in db.tables["source_events"] if row["event_type"] == "academic_grade")

        scraper.sync_grades(db, SETTINGS, [RECORD], "normal", False, assignments=None)
        self.assertEqual(task["status"], "active")
        self.assertEqual(db.cancelled, [])

        result = scraper.sync_grades(db, SETTINGS, [RECORD], "normal", False, assignments=[])
        self.assertEqual(result.missing, 1)
        self.assertEqual(task["status"], "missing")
        self.assertEqual(grade["status"], "active")
        self.assertEqual(db.cancelled, [task["id"]])

    def test_rescheduled_deadline_updates_one_task_without_second_instant(self):
        db = MemoryDb()
        scraper.sync_grades(db, SETTINGS, [], "normal", False, assignments=[])
        scraper.sync_grades(db, SETTINGS, [], "normal", False, assignments=[ASSIGNMENT])
        changed_due = "2099-10-03T10:00:00Z"

        changed = scraper.sync_grades(
            db, SETTINGS, [], "normal", False,
            assignments=[{**ASSIGNMENT, "due_at": changed_due}],
        )

        self.assertEqual(changed.reminders_created, 0)
        self.assertEqual(len(db.tables["source_events"]), 1)
        self.assertEqual(db.tables["source_events"][0]["due_at"], changed_due)
        self.assertEqual(len(db.tables["reminders"]), 1)

    def test_graded_assignment_links_exact_ws_or_html_identity_and_has_one_instant_alert(self):
        for raw in (
            {"itemmodule": "assign", "iteminstance": 77},
            {"moodle_module": "assign", "moodle_cmid": "1201"},
        ):
            with self.subTest(raw=raw):
                db = MemoryDb()
                scraper.sync_grades(db, SETTINGS, [], "normal", False, assignments=[])
                grade = {**RECORD, "item_id": "999", "title": "Assignment 1", "score": 9,
                         "raw": raw}

                result = scraper.sync_grades(db, SETTINGS, [grade], "normal", False, assignments=[ASSIGNMENT])

                self.assertEqual(result.reminders_created, 1)
                self.assertEqual(len(db.tables["reminders"]), 1)
                self.assertTrue(db.tables["reminders"][0]["dedup_key"].startswith("academic_grade_posted:"))
                task = next(row for row in db.tables["source_events"] if row["event_type"] == "task")
                self.assertEqual(task["status"], "completed")
                self.assertEqual(task["raw_json"]["related_grade_external_id"], "academic:moodle:42:999")
                self.assertEqual(task["source_url"], "https://lms.astanait.edu.kz/mod/assign/view.php?id=1201")

    def test_unique_title_suppresses_second_instant_without_inventing_a_relation(self):
        db = MemoryDb()
        scraper.sync_grades(db, SETTINGS, [], "normal", False, assignments=[])
        grade = {**RECORD, "score": 8, "raw": {}}

        scraper.sync_grades(db, SETTINGS, [grade], "normal", False, assignments=[ASSIGNMENT])

        self.assertEqual(len(db.tables["reminders"]), 1)
        task = next(row for row in db.tables["source_events"] if row["event_type"] == "task")
        self.assertIsNone(task["raw_json"]["related_grade_external_id"])
        self.assertEqual(task["status"], "active")

    def test_ambiguous_title_does_not_suppress_assignment_alert(self):
        db = MemoryDb()
        scraper.sync_grades(db, SETTINGS, [], "normal", False, assignments=[])
        grades = [
            {**RECORD, "item_id": "901", "score": 8, "raw": {}},
            {**RECORD, "item_id": "902", "score": None, "raw": {}},
        ]

        scraper.sync_grades(db, SETTINGS, grades, "normal", False, assignments=[ASSIGNMENT])

        self.assertEqual(len(db.tables["reminders"]), 2)
        self.assertEqual(
            {row["dedup_key"].split(":", 1)[0] for row in db.tables["reminders"]},
            {"academic_grade_posted", "assignment_added"},
        )

    def test_overdue_assignment_never_gets_new_assignment_alert(self):
        db = MemoryDb()
        scraper.sync_grades(db, SETTINGS, [], "normal", False, assignments=[])

        result = scraper.sync_grades(
            db, SETTINGS, [], "normal", False,
            assignments=[{**ASSIGNMENT, "due_at": "2020-01-01T10:00:00Z"}],
        )

        self.assertEqual(result.reminders_created, 0)
        self.assertEqual(db.tables["reminders"], [])

    def test_failed_assignment_notification_insert_retries_after_event_was_saved(self):
        class FailOnceDb(MemoryDb):
            fail_next_assignment_notification = False

            def request(self, method, table, query=None, body=None, prefer=None):
                if (self.fail_next_assignment_notification and method == "POST"
                        and table == "reminders" and body["dedup_key"].startswith("assignment_added:")):
                    self.fail_next_assignment_notification = False
                    raise SyncError("temporary reminder insert failure")
                return super().request(method, table, query, body, prefer)

        db = FailOnceDb()
        scraper.sync_grades(db, SETTINGS, [], "normal", False, assignments=[])
        db.fail_next_assignment_notification = True

        with self.assertRaises(SyncError):
            scraper.sync_grades(db, SETTINGS, [], "normal", False, assignments=[ASSIGNMENT])
        self.assertEqual(db.tables["reminders"], [])
        task = db.tables["source_events"][0]
        self.assertEqual(task["event_type"], "task")

        retry = scraper.sync_grades(db, SETTINGS, [], "normal", False, assignments=[ASSIGNMENT])
        self.assertEqual(retry.reminders_created, 1)
        self.assertEqual(len(db.tables["reminders"]), 1)
        self.assertEqual(db.tables["reminders"][0]["dedup_key"], "assignment_added:assignment:moodle:42:77")


class AcademicPersistenceTest(unittest.TestCase):
    def test_existing_ungraded_item_gets_one_notification_when_zero_is_posted(self):
        db = MemoryDb()
        scraper.sync_grades(db, SETTINGS, [RECORD], "normal", False)
        self.assertEqual(db.tables["reminders"], [])

        graded = {**RECORD, "score": 0}
        stats = scraper.sync_grades(db, SETTINGS, [graded], "normal", False)
        self.assertEqual(stats.reminders_created, 1)
        self.assertEqual(len(db.tables["reminders"]), 1)
        reminder = db.tables["reminders"][0]
        self.assertEqual(reminder["dedup_key"], "academic_grade_posted:academic:moodle:42:901")
        self.assertEqual(
            reminder["message"],
            "Оценка по «Database Management Systems | Teacher»: Assignment 1 — 0/10",
        )
        self.assertEqual(reminder["metadata_json"]["notification_kind"], "instant_academic")
        self.assertIsNone(reminder["source_event_id"])
        self.assertNotIn("_grade_notification_pending", db.tables["academic_records"][0]["raw_json"])

        repeated = scraper.sync_grades(db, SETTINGS, [graded], "normal", False)
        self.assertEqual(repeated.reminders_created, 0)
        self.assertEqual(len(db.tables["reminders"]), 1)
        self.assertEqual(db.tables["reminders"][0]["status"], "pending")

    def test_newly_discovered_graded_item_after_initial_sync_notifies_once_without_maximum(self):
        db = MemoryDb()
        scraper.sync_grades(db, SETTINGS, [RECORD], "normal", False)
        new_grade = {**RECORD, "item_id": "902", "title": "Quiz 1", "score": 8.5, "max_score": None}

        first = scraper.sync_grades(db, SETTINGS, [RECORD, new_grade], "normal", False)
        second = scraper.sync_grades(db, SETTINGS, [RECORD, new_grade], "normal", False)

        self.assertEqual((first.reminders_created, second.reminders_created), (1, 0))
        self.assertEqual(len(db.tables["reminders"]), 1)
        self.assertEqual(
            db.tables["reminders"][0]["message"],
            "Оценка по «Database Management Systems | Teacher»: Quiz 1 — 8.5",
        )

    def test_first_moodle_sync_does_not_announce_a_batch_after_platonus_or_partial_run(self):
        db = MemoryDb()
        db.tables["sync_runs"].append({
            "id": "old-university-run", "user_id": "user-a",
            "source_key": "university_platform", "status": "success", "metadata_json": {},
        })
        db.tables["source_events"].append({
            "id": "old-partial-moodle-event", "user_id": "user-a",
            "source_key": "university_platform", "event_type": "academic_grade",
            "external_id": "academic:moodle:42:old", "status": "active",
        })
        graded = [
            {**RECORD, "item_id": str(1000 + index), "title": f"Work {index}", "score": float(index)}
            for index in range(25)
        ]

        first = scraper.sync_grades(db, SETTINGS, graded, "normal", False)
        repeated = scraper.sync_grades(db, SETTINGS, graded, "normal", False)

        self.assertEqual((first.reminders_created, repeated.reminders_created), (0, 0))
        self.assertEqual(db.tables["reminders"], [])
        self.assertTrue(db.tables["sync_runs"][-1]["metadata_json"]["moodle_grades_synced"])

    def test_empty_initial_snapshot_still_enables_later_new_grade(self):
        db = MemoryDb()
        scraper.sync_grades(db, SETTINGS, [], "normal", False)

        stats = scraper.sync_grades(db, SETTINGS, [{**RECORD, "score": 7}], "normal", False)

        self.assertEqual(stats.reminders_created, 1)
        self.assertEqual(len(db.tables["reminders"]), 1)

    def test_failed_reminder_insert_retries_after_academic_row_was_saved(self):
        class FailOnceDb(MemoryDb):
            fail_next_reminder = False

            def request(self, method, table, query=None, body=None, prefer=None):
                if self.fail_next_reminder and method == "POST" and table == "reminders":
                    self.fail_next_reminder = False
                    raise SyncError("temporary reminder insert failure")
                return super().request(method, table, query, body, prefer)

        db = FailOnceDb()
        scraper.sync_grades(db, SETTINGS, [RECORD], "normal", False)
        db.fail_next_reminder = True
        graded = {**RECORD, "score": 9}

        with self.assertRaises(SyncError):
            scraper.sync_grades(db, SETTINGS, [graded], "normal", False)
        self.assertEqual(db.tables["academic_records"][0]["score"], 9)
        self.assertTrue(db.tables["academic_records"][0]["raw_json"]["_grade_notification_pending"])
        self.assertEqual(db.tables["reminders"], [])

        retry = scraper.sync_grades(db, SETTINGS, [graded], "normal", False)
        self.assertEqual(retry.reminders_created, 1)
        self.assertEqual(len(db.tables["reminders"]), 1)
        self.assertNotIn("_grade_notification_pending", db.tables["academic_records"][0]["raw_json"])

    def test_repeated_sync_rename_grade_removal_and_manual_fields(self):
        db = MemoryDb()
        scraper.sync_grades(db, SETTINGS, [RECORD], "normal", False)
        item = db.tables["assessment_items"][0]
        self.assertIsNone(item["actual_score"])
        self.assertIsNone(db.tables["academic_records"][0]["percentage"])
        manual = {"due_at": "2026-10-01T10:00:00Z", "due_source": "manual", "weight_percent": 25, "notes": "Keep", "syllabus_due_at": "2026-09-30T10:00:00Z"}
        item.update(manual)
        updated = {**RECORD, "title": "Renamed", "score": 0}
        scraper.sync_grades(db, SETTINGS, [updated], "normal", False)
        self.assertEqual(item["status"], "graded")
        self.assertEqual(item["actual_score"], 0)
        self.assertEqual(item["title"], "Renamed")
        self.assertEqual({key: item[key] for key in manual}, manual)
        scraper.sync_grades(db, SETTINGS, [RECORD], "normal", False)
        self.assertEqual(item["status"], "pending")
        for table in ("assessment_items", "academic_records", "source_events"):
            self.assertEqual(len(db.tables[table]), 1)

    def test_duplicate_titles_with_different_ids_do_not_collide(self):
        db = MemoryDb()
        scraper.sync_grades(db, SETTINGS, [RECORD, {**RECORD, "item_id": "902"}], "normal", False)
        self.assertEqual(len(db.tables["assessment_items"]), 2)

    def test_no_match_retains_raw_grade_without_inventing_a_course(self):
        db = MemoryDb()
        db.tables["study_courses"] = []
        scraper.sync_grades(db, SETTINGS, [RECORD], "normal", False)
        self.assertEqual(len(db.tables["academic_records"]), 1)
        self.assertEqual(db.tables["assessment_items"], [])
        self.assertEqual(db.tables["study_courses"], [])

    def test_mock_does_not_overwrite_live_assessments_or_retire_live_events(self):
        db = MemoryDb()
        scraper.sync_grades(db, SETTINGS, [RECORD], "normal", False)
        scraper.sync_grades(db, SETTINGS, [{**RECORD, "score": 10}], "normal", True)
        self.assertIsNone(db.tables["assessment_items"][0]["actual_score"])
        self.assertEqual(db.tables["source_events"][0]["status"], "active")
        self.assertEqual(db.cancelled, [])

    def test_platforms_do_not_retire_each_others_events(self):
        db = MemoryDb()
        for external_id in ("academic:moodle:42:old", "academic:grade:legacy:bad", "academic:platonus:1:1"):
            db.upsert_event({"external_id": external_id, "source_key": "university_platform", "event_type": "academic_grade", "status": "active"}, "normal")
        scraper.sync_grades(db, SETTINGS, [RECORD], "normal", False)
        self.assertEqual([r["status"] for r in db.tables["source_events"]], ["missing", "missing", "active", "active"])
        mark_missing_grades(db, set(), ("academic:platonus:",))
        self.assertEqual(db.tables["source_events"][-1]["status"], "active")

    def test_user_scope_mismatch_fails_before_writes(self):
        db = MemoryDb()
        db.settings = BaseSettings(BASE.supabase_url, BASE.service_role_key, "user-b", BASE.timezone_name)
        with self.assertRaises(SyncError):
            scraper.sync_grades(db, SETTINGS, [RECORD], "normal", False)
        self.assertEqual(db.queries, [])
        self.assertEqual(db.finished[-1][1], "failed")

    def test_matching_is_owned_unambiguous_and_explicit(self):
        foreign = {**COURSE, "user_id": "user-b"}
        self.assertIsNone(match_course([foreign], "user-a", RECORD))
        unlinked = {**COURSE, "external_course_key": None, "title": RECORD["course_title"]}
        self.assertEqual(match_course([unlinked], "user-a", RECORD), unlinked)
        self.assertIsNone(match_course([unlinked, {**unlinked, "id": "other"}], "user-a", RECORD))
        self.assertIsNone(match_course([{**unlinked, "external_course_key": "moodle:99"}], "user-a", RECORD))

    def test_linking_only_changes_external_key_and_rejects_reassignment(self):
        db = MemoryDb()
        db.tables["study_courses"][0]["external_course_key"] = None
        link_course(db, 42, COURSE["code"])
        self.assertEqual(db.tables["study_courses"][0], COURSE)
        with self.assertRaises(SyncError):
            link_course(db, 43, COURSE["code"])

    def test_fetch_failure_is_recorded_before_any_sync_write(self):
        db = MagicMock()
        db.start_sync_run.return_value = "run-a"
        with patch.object(scraper, "SupabaseRestClient", return_value=db), patch.object(scraper.MoodleClient, "fetch_grades", side_effect=SyncError("no session")):
            with self.assertRaises(SyncError):
                scraper.sync_once(SETTINGS)
        self.assertEqual(db.finish_sync_run.call_args.args[:2], ("run-a", "failed"))
        db.upsert_event.assert_not_called()
