"""Host isolation and fixture-based Moodle activity ingestion regressions."""
from __future__ import annotations

import sys
import unittest
from io import BytesIO
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent))
import university_scraper as scraper
import lms_session_bridge as bridge
from moodle_activities import AssignmentSnapshot, GradeSnapshot, UnsupportedMoodlePage, activity_links, parse_activity, parse_visible_date
from moodle_session_security import COOKIE_NAME, MICROSOFT_HOST, MoodleSessionError, safe_url, secure_request, valid_sso_cookie
from academic_pipeline_test import ASSIGNMENT, BASE, COURSE, MemoryDb, RECORD, SETTINGS


def response(url, text="", status=200, location=None):
    return SimpleNamespace(url=url, text=text, status_code=status,
                           headers={"Location": location} if location else {}, raise_for_status=lambda: None, close=lambda: None)


class TransportSecurityTest(unittest.TestCase):
    def test_cookie_rejects_headers_multiple_values_controls_and_oversize(self):
        for value in (None, "", "Cookie: secret", "ESTSAUTHPERSISTENT=secret", "a;b", "a,b", "a\nb", "a\rb", "a b", '"secret"', "a\\b", "é", "x" * 16385):
            with self.subTest(value_type=type(value).__name__):
                self.assertFalse(valid_sso_cookie(value))
        self.assertTrue(valid_sso_cookie("ascii-token_+/%=="))
        self.assertTrue(valid_sso_cookie("x" * 16384))

    def test_exact_https_origins_only(self):
        for url in ("http://lms.astanait.edu.kz/", "https://lms.astanait.edu.kz.evil.test/", "https://login.microsoftonline.com.evil.test/", "https://sub.login.microsoftonline.com/", "https://user@lms.astanait.edu.kz/", "https://lms.astanait.edu.kz:444/", "https://127.0.0.1/", "//evil.test/", "https://lms.astanait.edu.kz\\@evil.test/", "https://lms.astanait.edu.kz/\n"):
            with self.subTest(url=url), self.assertRaises(MoodleSessionError):
                safe_url(url)
        self.assertEqual(safe_url("/auth/oidc/", scraper.BASE_URL), scraper.BASE_URL + "/auth/oidc/")

    def test_cookie_never_reaches_moodle_or_a_sibling_microsoft_host(self):
        session = scraper._requests_session()
        sent = []
        urls = [scraper.OIDC_LOGIN_URL, "https://login.microsoftonline.com/tenant/authorize", scraper.BASE_URL + "/my/"]
        def get(url, **kwargs):
            sent.append((url, [cookie for cookie in session.cookies if cookie.name == COOKIE_NAME]))
            index = urls.index(url)
            return response(url, status=302, location=urls[index + 1]) if index < 2 else response(url)
        session.get = MagicMock(side_effect=get)
        secure_request(session, "GET", urls[0], cookie="test-persistent-secret")
        self.assertEqual([len(cookies) for _, cookies in sent], [0, 1, 0])
        self.assertTrue(sent[1][1][0].secure)
        self.assertEqual(sent[1][1][0].domain, MICROSOFT_HOST)
        self.assertFalse(any(cookie.name == COOKIE_NAME for cookie in session.cookies))
        for call in session.get.call_args_list:
            self.assertFalse(call.kwargs["allow_redirects"])
        with self.assertRaises(MoodleSessionError):
            secure_request(session, "GET", "https://sub.login.microsoftonline.com/", cookie="test")
        self.assertEqual(session.get.call_count, 3)

    def test_redirect_is_checked_before_network_and_sensitive_posts_never_replay_cross_origin(self):
        session = scraper._requests_session()
        session.get = MagicMock(return_value=response(scraper.OIDC_LOGIN_URL, status=302, location="https://evil.test/capture"))
        with self.assertRaises(MoodleSessionError):
            secure_request(session, "GET", scraper.OIDC_LOGIN_URL, cookie="secret")
        session.get.assert_called_once()
        session.post = MagicMock(return_value=response(scraper.LOGIN_URL, status=307, location="https://login.microsoftonline.com/capture"))
        with self.assertRaises(MoodleSessionError):
            secure_request(session, "POST", scraper.LOGIN_URL, data={"password": "secret"})
        session.post.assert_called_once()

    def test_transport_exception_messages_never_include_secrets(self):
        session = scraper._requests_session()
        session.get = MagicMock(side_effect=Exception("https://secret.example?code=SECRET session=SECRET"))
        with self.assertRaises(MoodleSessionError) as caught:
            secure_request(session, "GET", scraper.OIDC_LOGIN_URL, cookie="SECRET")
        self.assertEqual(str(caught.exception), "connection_failed")

    def test_rejected_http_responses_are_closed_without_credential_logs(self):
        session = scraper._requests_session()
        result = response(scraper.MY_COURSES_URL, status=403)
        result.close = MagicMock()
        session.get = MagicMock(return_value=result)
        with self.assertRaises(MoodleSessionError) as caught:
            secure_request(session, "GET", scraper.MY_COURSES_URL)
        self.assertEqual(caught.exception.category, "session_expired")
        result.close.assert_called_once()

    def test_download_is_bounded_before_the_entire_response_is_buffered(self):
        import requests
        session = scraper._requests_session()
        result = requests.Response()
        result.status_code, result.url = 200, scraper.MY_COURSES_URL
        result.raw = BytesIO(b"x" * 2_100_000)
        session.get = MagicMock(return_value=result)
        with self.assertRaises(MoodleSessionError):
            secure_request(session, "GET", scraper.MY_COURSES_URL)
        self.assertTrue(result.raw.closed)

    def test_untrusted_form_and_urlpost_destinations_never_receive_a_request(self):
        for html in (
            '<form method="post" action="https://evil.test/capture"><input type="hidden" name="code" value="SECRET"></form>',
            '<script>$Config={"urlPost":"https://evil.test/capture"}</script>',
            '<form method="post" action="http://lms.astanait.edu.kz/auth/oidc/"><input type="hidden" name="code" value="SECRET"></form>',
        ):
            with self.subTest(html_type="form" if "form" in html else "config"):
                session = scraper._requests_session()
                session.get = MagicMock(return_value=response("https://login.microsoftonline.com/tenant/authorize", html))
                session.post = MagicMock()
                client = scraper.MoodleClient(scraper.Settings(BASE, "", "", None, "test-cookie", 3600, False))
                with patch.object(scraper, "_requests_session", return_value=session), self.assertRaises(MoodleSessionError):
                    client.validate_sso_session()
                session.post.assert_not_called()

    def test_only_hidden_inputs_inside_callback_form_are_replayed(self):
        session = scraper._requests_session()
        html = '<input name="password" value="DO-NOT-SEND"><form action="/auth/oidc/" method="post"><input type="hidden" name="code" value="ok"><input type="hidden" name="state" value="state"></form>'
        # Relative callback destinations resolve against Microsoft, not against Moodle.
        html = html.replace('action="/auth/oidc/"', f'action="{scraper.BASE_URL}/auth/oidc/"')
        session.get = MagicMock(return_value=response("https://login.microsoftonline.com/tenant/authorize", html))
        session.post = MagicMock(return_value=response(scraper.BASE_URL + "/my/", '<script>M.cfg={"userId":42};</script>'))
        client = scraper.MoodleClient(scraper.Settings(BASE, "", "", None, "test-cookie", 3600, False))
        with patch.object(scraper, "_requests_session", return_value=session):
            client.validate_sso_session()
        self.assertEqual(session.post.call_args.kwargs["data"], {"code": "ok", "state": "state"})

    def test_expiry_during_html_scrape_is_not_a_successful_empty_snapshot(self):
        client = scraper.MoodleClient(SETTINGS)
        client._moodle_user_id, client._session = 42, scraper._requests_session()
        client._session.get = MagicMock(return_value=response(scraper.BASE_URL + "/login/index.php", '<script>M.cfg={"userId":0};</script>'))
        with self.assertRaises(MoodleSessionError) as caught:
            client.fetch_via_scrape()
        self.assertEqual(caught.exception.category, "session_expired")


class ActivityParsingTest(unittest.TestCase):
    def parse(self, body, kind="assign", title="Lab 1"):
        html = f'<body id="page-mod-{kind}-view"><h1>{title}</h1>{body}</body>'
        return parse_activity(scraper._bs4_parse(html), course_id=42, course_title="Course", cmid=1201,
                              module_type=kind, timezone_name="Asia/Almaty", now=datetime(2026, 10, 10, tzinfo=timezone.utc))

    def test_ungraded_does_not_mean_unsubmitted_and_unknown_date_is_retained(self):
        record = self.parse('<table class="submissionstatustable"><tr><th>Grading status</th><td>Not graded</td></tr></table>')
        self.assertEqual(record["submission_status"], "unknown")
        self.assertIsNone(record["due_at"])
        self.assertFalse(record["ingestion_complete"])
        self.assertNotIn("score", record)
        self.assertEqual((record["course_id"], record["cmid"]), ("42", "1201"))
        self.assertEqual(self.parse("", title="Final project")["assessment_type"], "assignment")

    def test_verified_submission_states_and_overdue(self):
        for text, expected in (("Submitted for grading", "submitted"), ("No submissions have been made yet", "overdue"), ("Draft (not submitted)", "overdue")):
            record = self.parse(f'<table><tr><th>Submission status</th><td>{text}</td></tr><tr><th>Due date</th><td><time datetime="2026-10-09T18:00:00+05:00"></time></td></tr></table>')
            self.assertEqual(record["submission_status"], expected)
            self.assertEqual(record["due_at"], "2026-10-09T13:00:00Z")
        graded = self.parse('<table><tr><th>Grading status</th><td>Graded</td></tr><tr><th>Submission status</th><td>Submitted for grading</td></tr></table>')
        self.assertEqual(graded["submission_status"], "graded")

    def test_moodle_dates_region_and_quiz_attempt_summary(self):
        record = self.parse('''<div data-region="activity-dates"><div><strong>Opened:</strong> Friday, 9 October 2026, 9:00 AM</div><div><strong>Closes:</strong> Sunday, 11 October 2026, 10:00 PM</div></div>
        <table class="quizattemptsummary"><thead><tr><th>Attempt</th><th>State</th><th>Grade / 10</th></tr></thead><tbody><tr><td>1</td><td>Finished</td><td>-</td></tr></tbody></table>''', kind="quiz", title="Midterm quiz")
        self.assertEqual(record["submission_status"], "submitted")
        self.assertEqual(record["assessment_type"], "midterm")
        self.assertEqual(record["opens_at"], "2026-10-09T04:00:00Z")
        self.assertEqual(record["closes_at"], "2026-10-11T17:00:00Z")
        self.assertEqual(record["due_at"], record["closes_at"])

    def test_unparseable_relative_and_dst_ambiguous_dates_remain_unknown(self):
        self.assertIsNone(parse_visible_date("Tomorrow at 10:00", "Asia/Almaty"))
        self.assertIsNone(parse_visible_date("2026-11-01T01:30", "America/New_York"))
        self.assertIsNone(parse_visible_date("2026-03-08T02:30", "America/New_York"))
        self.assertIsNone(parse_visible_date("2026-02-30T09:00", "Asia/Almaty"))

    def test_course_module_links_use_stable_ids_and_never_follow_actions(self):
        soup = scraper._bs4_parse('<div class="course-content"><a href="/mod/assign/view.php?id=1201&action=delete">Work</a><a href="/mod/assign/view.php?id=1201">Work again</a><a href="/mod/quiz/view.php?id=1501">Final exam</a></div>')
        self.assertEqual(activity_links(soup, 42), [("assign", 1201, scraper.BASE_URL + "/mod/assign/view.php?id=1201"), ("quiz", 1501, scraper.BASE_URL + "/mod/quiz/view.php?id=1501")])
        with self.assertRaises(UnsupportedMoodlePage):
            activity_links(scraper._bs4_parse('<div class="course-content"><a href="https://evil.test/mod/assign/view.php?id=1201">Work</a></div>'), 42)
        with self.assertRaises(UnsupportedMoodlePage):
            parse_activity(scraper._bs4_parse("<h1>Login</h1>"), course_id=42, course_title="Course", cmid=1201, module_type="assign", timezone_name="UTC", now=datetime.now(timezone.utc))

    def test_html_partial_or_unknown_date_records_never_retire_existing_deadlines(self):
        db = MemoryDb()
        scraper.sync_assignments(db, SETTINGS, [ASSIGNMENT], [], "normal", None)
        original = db.tables["source_events"][0]["external_id"]
        record = self.parse("")
        result = scraper.sync_assignments(db, SETTINGS, AssignmentSnapshot([record], complete=False), [], "normal", None)
        self.assertEqual(result.missing, 0)
        self.assertTrue(any(e["external_id"] == original and e["status"] == "active" for e in db.tables["source_events"]))
        scraper.sync_assignments(db, SETTINGS, AssignmentSnapshot([], complete=False), [], "normal", None)
        self.assertNotIn("missing", [e["status"] for e in db.tables["source_events"]])

    def test_html_activity_reuses_existing_ws_identity_and_is_idempotent(self):
        db = MemoryDb()
        scraper.sync_assignments(db, SETTINGS, [ASSIGNMENT], [], "normal", None)
        record = {**self.parse(""), "title": ASSIGNMENT["title"], "due_at": ASSIGNMENT["due_at"]}
        for _ in range(2):
            scraper.sync_assignments(db, SETTINGS, AssignmentSnapshot([record], complete=False), [], "normal", None)
        self.assertEqual(len(db.tables["source_events"]), 1)
        self.assertEqual(db.tables["source_events"][0]["external_id"], "assignment:moodle:42:77")

    def test_ws_activity_reuses_existing_html_identity(self):
        db = MemoryDb()
        record = {**self.parse(""), "title": ASSIGNMENT["title"], "due_at": ASSIGNMENT["due_at"]}
        scraper.sync_assignments(db, SETTINGS, AssignmentSnapshot([record], complete=False), [], "normal", None)
        scraper.sync_assignments(db, SETTINGS, [ASSIGNMENT], [], "normal", None)
        self.assertEqual(len(db.tables["source_events"]), 1)
        self.assertEqual(db.tables["source_events"][0]["external_id"], "activity:moodle:42:assign:1201")

    def test_partial_html_preserves_known_due_grade_link_and_completion(self):
        db = MemoryDb()
        grade = {**RECORD, "score": 9, "raw": {"itemmodule": "assign", "iteminstance": 77}}
        scraper.sync_grades(db, SETTINGS, [grade], "normal", False, assignments=[ASSIGNMENT])
        db.tables["source_events"].append({"id": "manual", "user_id": BASE.user_id,
            "source_key": "manual_study", "event_type": "task", "external_id": "manual:deadline",
            "due_at": "2099-01-01T00:00:00Z", "status": "active",
            "raw_json": {"moodle_course_id": "42", "moodle_cmid": "1201"}})
        record = self.parse("")
        for _ in range(2):
            scraper.sync_grades(db, SETTINGS, GradeSnapshot([], complete=False), "normal", False,
                assignments=AssignmentSnapshot([record], complete=False))
        tasks = [row for row in db.tables["source_events"] if row.get("source_key") == "university_platform" and row["event_type"] == "task"]
        self.assertEqual(len(tasks), 1)
        task = tasks[0]
        self.assertEqual(task["external_id"], "assignment:moodle:42:77")
        self.assertEqual(task["due_at"], ASSIGNMENT["due_at"])
        self.assertEqual(task["status"], "completed")
        self.assertEqual(task["raw_json"]["submission_status"], "graded")
        self.assertEqual(task["raw_json"]["related_grade_external_id"], "academic:moodle:42:901")
        self.assertTrue({"previous_due_date_retained", "grade_link_retained", "grade_status_retained"}.issubset(task["raw_json"]["parser_warnings"]))
        self.assertEqual(db.tables["academic_records"][0]["score"], 9)
        self.assertEqual(next(row for row in db.tables["source_events"] if row["id"] == "manual")["due_at"], "2099-01-01T00:00:00Z")

    def test_fresh_verified_html_dates_replace_previous_known_dates(self):
        db = MemoryDb()
        scraper.sync_assignments(db, SETTINGS, [ASSIGNMENT], [], "normal", None)
        record = {**self.parse(""), "due_at": "2099-11-01T10:00:00Z"}
        scraper.sync_assignments(db, SETTINGS, AssignmentSnapshot([record], complete=False), [], "normal", None)
        self.assertEqual(db.tables["source_events"][0]["due_at"], record["due_at"])
        self.assertNotIn("previous_due_date_retained", db.tables["source_events"][0]["raw_json"]["parser_warnings"])

    def test_duplicate_module_identity_fails_before_persisting_assignments(self):
        db = MemoryDb()
        duplicate = {**ASSIGNMENT, "assignment_id": "78"}
        with self.assertRaises(scraper.SyncError):
            scraper.sync_assignments(db, SETTINGS, [ASSIGNMENT, duplicate], [], "normal", None)
        self.assertEqual(db.tables["source_events"], [])

    def test_partial_html_continues_supported_activities_without_retiring_anything(self):
        client = scraper.MoodleClient(SETTINGS)
        client._enrolled_courses = [(42, "Course"), (43, "Unsupported course")]
        pages = [
            response(scraper.BASE_URL + "/course/view.php?id=42", '<div class="course-content"><a href="/mod/assign/view.php?id=1201">Good</a><a href="/mod/quiz/view.php?id=1501">Unsupported</a></div>'),
            response(scraper.BASE_URL + "/mod/assign/view.php?id=1201", '<body id="page-mod-assign-view"><h1>Good assignment</h1></body>'),
            response(scraper.BASE_URL + "/mod/quiz/view.php?id=1501", "<h1>Unknown quiz layout</h1>"),
            response(scraper.BASE_URL + "/course/view.php?id=43", "<h1>Unknown course layout</h1>"),
        ]
        with patch.object(client, "_moodle_get", side_effect=pages):
            records = client._scrape_activities()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["title"], "Good assignment")
        self.assertFalse(records.complete)
        self.assertIn("activity_html_unsupported", client.unsupported_features)
        self.assertIn("course_activity_html_unsupported", client.unsupported_features)

    def test_all_unsupported_html_pages_do_not_claim_a_verified_read(self):
        client = scraper.MoodleClient(SETTINGS)
        client._enrolled_courses = [(42, "Course")]
        with patch.object(client, "_moodle_get", return_value=response(scraper.BASE_URL + "/course/view.php?id=42", "<h1>Unknown layout</h1>")):
            records = client._scrape_activities()
        self.assertEqual(records, [])
        self.assertFalse(records.complete)
        self.assertEqual(records.verified_pages, 0)

    def test_incomplete_html_grades_preserve_existing_manual_and_imported_records(self):
        db = MemoryDb()
        scraper.sync_grades(db, SETTINGS, [RECORD], "normal", False)
        db.tables["assessment_items"].append({"id": "manual", "study_course_id": COURSE["id"], "title": "Manual", "status": "pending"})
        scraper.sync_grades(db, SETTINGS, GradeSnapshot([], complete=False), "normal", False)
        self.assertEqual(db.tables["source_events"][0]["status"], "active")
        self.assertTrue(any(item["id"] == "manual" for item in db.tables["assessment_items"]))

    def test_hidden_numeric_grade_does_not_erase_a_previously_recorded_score(self):
        db = MemoryDb()
        scraper.sync_grades(db, SETTINGS, [{**RECORD, "score": 8}], "normal", False)
        scraper.sync_grades(db, SETTINGS, GradeSnapshot([RECORD], complete=False), "normal", False)
        self.assertEqual(db.tables["academic_records"][0]["score"], 8)
        self.assertEqual(db.tables["academic_records"][0]["max_score"], 10)
        self.assertTrue(db.tables["academic_records"][0]["raw_json"]["_grade_visibility_unknown"])


class BridgeTest(unittest.TestCase):
    def test_bridge_never_loads_credentials_from_environment_or_echoes_input(self):
        with patch.object(bridge.MoodleClient, "validate_sso_session", return_value=None) as validate:
            self.assertEqual(bridge.validate("safe-test-cookie"), {"ok": True})
        validate.assert_called_once()
        for category in ("session_expired", "connection_failed", "unsupported_auth_flow"):
            with patch.object(bridge.MoodleClient, "validate_sso_session", side_effect=MoodleSessionError(category)):
                self.assertEqual(bridge.validate("safe-test-cookie"), {"ok": False, "errorCategory": category})
        self.assertEqual(bridge.validate("Cookie: SECRET"), {"ok": False, "errorCategory": "unsupported_auth_flow"})


if __name__ == "__main__":
    unittest.main()
