from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "workers" / "university-sync" / "aitu-parser"))
import university_scraper as scraper

SPEC = importlib.util.spec_from_file_location("diagnose_moodle_course", Path(__file__).with_name("diagnose_moodle_course.py"))
diagnostic = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(diagnostic)


class MoodleDiagnosticTest(unittest.TestCase):
    def test_response_secrets_and_table_text_are_not_in_output(self):
        secret = "PRIVATE_TEST_SENTINEL"
        response = SimpleNamespace(
            url=f"{scraper.GRADE_REPORT_URL}?code={secret}#token={secret}",
            status_code=200, history=[], text=f'''
              <input name="sesskey" value="{secret}"><script>{secret}</script>
              <table class="user-grade">
                <tr><th>Grade item</th><th>Grade</th></tr>
                <tr><th class="item {secret}" id="row_901_55">{secret}</th><td class="grade">-</td></tr>
              </table>''',
        )
        report = diagnostic.structural_summary(scraper, response, 2482)
        self.assertTrue(report["parse_ok"])
        self.assertEqual(report["record_count"], 1)
        self.assertNotIn(secret, json.dumps(report))

    def test_exception_url_never_printed(self):
        exc = RuntimeError("HTTP error https://example.org/?code=PRIVATE_TEST_SENTINEL")
        report = diagnostic.safe_error(exc)
        self.assertEqual(report, {"error_type": "RuntimeError"})

    def test_missing_table_gets_actionable_code(self):
        response = SimpleNamespace(url=scraper.GRADE_REPORT_URL, status_code=200, history=[], text="<html>No grades</html>")
        report = diagnostic.structural_summary(scraper, response, 2482)
        self.assertEqual(report["reason"], "grade_table_missing")
        self.assertFalse(report["parse_ok"])

    def test_denied_report_is_not_parsed(self):
        response = SimpleNamespace(url=scraper.GRADE_REPORT_URL, status_code=403, history=[], text="SECRET")
        with patch.object(scraper, "parse_report") as parse:
            report = diagnostic.structural_summary(scraper, response, 2482)
        parse.assert_not_called()
        self.assertEqual(report["reason"], "http_error")

    def test_diagnostic_does_not_construct_database_client(self):
        with patch.object(scraper, "SupabaseRestClient") as db, patch.object(scraper, "MoodleClient") as client:
            client.return_value._sso_cookie_login.return_value = False
            result = diagnostic.diagnose(scraper, SimpleNamespace(sso_cookie="test"), 2482)
        db.assert_not_called()
        self.assertFalse(result["authenticated"])
