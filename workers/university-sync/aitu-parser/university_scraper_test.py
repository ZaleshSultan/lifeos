"""Tests for university_scraper.py (AITU LMS worker)."""
from __future__ import annotations

import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

MODULE_PATH = Path(__file__).with_name("university_scraper.py")
SPEC = importlib.util.spec_from_file_location("university_scraper", MODULE_PATH)
assert SPEC and SPEC.loader
university_scraper = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = university_scraper
SPEC.loader.exec_module(university_scraper)


# ── Helpers / unit tests ──────────────────────────────────────────────────────
class SlugifyTest(unittest.TestCase):
    def test_basic(self) -> None:
        self.assertEqual(university_scraper.slugify("Discrete Mathematics"), "discrete_mathematics")

    def test_special_chars(self) -> None:
        slug = university_scraper.slugify("Homework 1: Set Theory!")
        self.assertNotIn(":", slug)
        self.assertNotIn("!", slug)

    def test_long_truncated(self) -> None:
        self.assertLessEqual(len(university_scraper.slugify("x" * 200)), 80)


class ClassifyRecordTypeTest(unittest.TestCase):
    def test_final(self) -> None:
        self.assertEqual(university_scraper.classify_record_type("Final Examination"), "final")

    def test_midterm(self) -> None:
        self.assertEqual(university_scraper.classify_record_type("Midterm Test"), "midterm")

    def test_quiz(self) -> None:
        self.assertEqual(university_scraper.classify_record_type("Quiz 2"), "quiz")

    def test_assignment_default(self) -> None:
        self.assertEqual(university_scraper.classify_record_type("Lab Report 3"), "assignment")


# ── Settings load ─────────────────────────────────────────────────────────────
BASE_ENV = {
    "SUPABASE_URL": "https://example.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "service-role",
    "LIFEOS_DEFAULT_USER_ID": "user-1",
    "LIFEOS_ENABLE_LEGACY_SINGLE_USER_UNIVERSITY_SYNC": "true",
    "UNIVERSITY_USERNAME": "testuser",
    "UNIVERSITY_PASSWORD": "testpass",
}


class SettingsLegacyGuardTest(unittest.TestCase):
    def test_requires_legacy_opt_in(self) -> None:
        env = {**BASE_ENV, "LIFEOS_ENABLE_LEGACY_SINGLE_USER_UNIVERSITY_SYNC": "false"}
        with (
            patch.dict(os.environ, env, clear=True),
            patch.object(university_scraper, "load_dotenv", lambda _: None),
        ):
            with self.assertRaises(university_scraper.SyncError) as ctx:
                university_scraper.load_settings()
        self.assertIn("LIFEOS_ENABLE_LEGACY_SINGLE_USER_UNIVERSITY_SYNC", str(ctx.exception))

    def test_loads_correctly_with_opt_in(self) -> None:
        with (
            patch.dict(os.environ, BASE_ENV, clear=True),
            patch.object(university_scraper, "load_dotenv", lambda _: None),
        ):
            s = university_scraper.load_settings()
        self.assertEqual(s.username, "testuser")
        self.assertIsNone(s.ws_token)
        self.assertEqual(s.poll_seconds, 3600)


# ── MoodleClient mock fallback ────────────────────────────────────────────────
class MoodleClientMockFallbackTest(unittest.TestCase):
    def _make_settings(self, allow_mock: bool = True) -> object:
        env = {**BASE_ENV}
        if allow_mock:
            env["AITU_SYNC_MOCK_MODE"] = "true"
        with (
            patch.dict(os.environ, env, clear=True),
            patch.object(university_scraper, "load_dotenv", lambda _: None),
        ):
            return university_scraper.load_settings()

    def test_mock_mode_on_all_failures(self) -> None:
        settings = self._make_settings()
        client = university_scraper.MoodleClient(settings)

        # Simulate network unreachable for form login
        with patch.object(client, "_form_login", return_value=False):
            records = client.fetch_grades()

        self.assertTrue(client.is_mocked)
        self.assertGreater(len(records), 0)
        # Verify mock data contains expected AITU CS courses
        titles = {r["course_title"] for r in records}
        self.assertIn("Discrete Mathematics", titles)

    def test_refuses_mock_fallback_without_explicit_opt_in(self) -> None:
        settings = self._make_settings(allow_mock=False)
        client = university_scraper.MoodleClient(settings)

        with patch.object(client, "_form_login", return_value=False):
            with self.assertRaises(university_scraper.SyncError) as ctx:
                client.fetch_grades()

        self.assertIn("AITU_SYNC_MOCK_MODE", str(ctx.exception))
        self.assertFalse(client.is_mocked)

    def test_ws_token_attempted_first(self) -> None:
        env = {**BASE_ENV, "UNIVERSITY_WS_TOKEN": "fake_token", "AITU_SYNC_MOCK_MODE": "true"}
        with (
            patch.dict(os.environ, env, clear=True),
            patch.object(university_scraper, "load_dotenv", lambda _: None),
        ):
            settings = university_scraper.load_settings()

        client = university_scraper.MoodleClient(settings)
        self.assertEqual(client._ws_token, "fake_token")

        # WS call raises → falls to scrape → scrape fails → mock
        with (
            patch.object(client, "fetch_via_ws", side_effect=university_scraper.SyncError("WS down")),
            patch.object(client, "_form_login", return_value=False),
        ):
            records = client.fetch_grades()

        self.assertTrue(client.is_mocked)
        self.assertGreater(len(records), 0)

    def test_ms_sso_redirect_triggers_mock(self) -> None:
        settings = self._make_settings()
        client = university_scraper.MoodleClient(settings)

        # _form_login detects SSO and returns False → triggers mock
        with patch.object(client, "_form_login", return_value=False):
            records = client.fetch_grades()

        self.assertTrue(client.is_mocked)
        self.assertGreater(len(records), 0)


class MoodleClientSsoCookieLoginTest(unittest.TestCase):
    def _client_with_cookie(self, cookie: str | None = "fake-estsauth-value") -> object:
        env = {**BASE_ENV}
        if cookie:
            env["UNIVERSITY_SSO_COOKIE"] = cookie
        with (
            patch.dict(os.environ, env, clear=True),
            patch.object(university_scraper, "load_dotenv", lambda _: None),
        ):
            settings = university_scraper.load_settings()
        return university_scraper.MoodleClient(settings)

    def test_no_cookie_configured_returns_false_without_network(self) -> None:
        client = self._client_with_cookie(cookie=None)
        with patch.object(university_scraper, "_requests_session") as mock_factory:
            result = client._sso_cookie_login()
        mock_factory.assert_not_called()
        self.assertFalse(result)

    def test_direct_success_no_form_post_hop(self) -> None:
        client = self._client_with_cookie()
        mock_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.text = '<html><script>var data = {"userid": 555};</script></html>'
        mock_resp.url = f"{university_scraper.BASE_URL}/my/"
        mock_session.get.return_value = mock_resp
        mock_session.cookies = MagicMock()

        with patch.object(university_scraper, "_requests_session", return_value=mock_session):
            result = client._sso_cookie_login()

        self.assertTrue(result)
        self.assertEqual(client._moodle_user_id, 555)
        mock_session.cookies.set.assert_called_once_with(
            "ESTSAUTHPERSISTENT", "fake-estsauth-value", domain="login.microsoftonline.com"
        )
        mock_session.get.assert_called_once_with(
            university_scraper.OIDC_LOGIN_URL,
            timeout=university_scraper.REQUEST_TIMEOUT,
            allow_redirects=True,
        )

    def test_matches_real_moodle_camel_case_userid_key(self) -> None:
        """Regression test: real AITU Moodle pages embed the config as
        M.cfg = {..."userId":14505...} - camelCase, not the lowercase
        "userid" this code originally (and wrongly, case-sensitively)
        searched for. That mismatch silently masked a fully working login
        as a failure in production until caught via live debugging."""
        client = self._client_with_cookie()
        mock_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.text = (
            '<script>var M = {}; M.cfg = {"wwwroot":"https://lms.astanait.edu.kz",'
            '"userId":14505,"siteId":1};</script>'
        )
        mock_resp.url = f"{university_scraper.BASE_URL}/"
        mock_session.get.return_value = mock_resp
        mock_session.cookies = MagicMock()

        with patch.object(university_scraper, "_requests_session", return_value=mock_session):
            result = client._sso_cookie_login()

        self.assertTrue(result)
        self.assertEqual(client._moodle_user_id, 14505)

    def test_form_post_hop_is_replayed(self) -> None:
        client = self._client_with_cookie()
        mock_session = MagicMock()
        mock_session.cookies = MagicMock()

        get_resp = MagicMock()
        get_resp.url = "https://login.microsoftonline.com/organizations/oauth2/authorize?x=1"
        get_resp.text = (
            '<html><body onload="document.forms[0].submit()">'
            '<form action="https://lms.astanait.edu.kz/auth/oidc/index.php" method="post">'
            '<input type="hidden" name="id_token" value="tok123">'
            '<input type="hidden" name="state" value="abc">'
            "</form></body></html>"
        )
        post_resp = MagicMock()
        post_resp.url = f"{university_scraper.BASE_URL}/my/"
        post_resp.text = '<html><script>var data = {"userid": 42};</script></html>'

        mock_session.get.return_value = get_resp
        mock_session.post.return_value = post_resp

        with patch.object(university_scraper, "_requests_session", return_value=mock_session):
            result = client._sso_cookie_login()

        self.assertTrue(result)
        self.assertEqual(client._moodle_user_id, 42)
        mock_session.post.assert_called_once_with(
            "https://lms.astanait.edu.kz/auth/oidc/index.php",
            data={"id_token": "tok123", "state": "abc"},
            timeout=university_scraper.REQUEST_TIMEOUT,
            allow_redirects=True,
        )

    def test_bsso_interrupt_urlpost_hop_then_form_post(self) -> None:
        """Reproduces the real AITU flow: GET the OIDC entrypoint lands on a
        Microsoft 'BssoInterrupt' page (no <form>, just a JS $Config blob with
        a urlPost carrying &sso_reload=True); GETing that yields the real
        form_post (code/state/session_state) that completes the login."""
        client = self._client_with_cookie()
        mock_session = MagicMock()
        mock_session.cookies = MagicMock()

        interrupt_resp = MagicMock()
        interrupt_resp.url = "https://login.microsoftonline.com/organizations/oauth2/authorize?x=1"
        interrupt_resp.text = (
            '<html><head><meta name="PageID" content="BssoInterrupt" />'
            "<script>$Config={\"urlPost\":\"/organizations/oauth2/authorize?"
            "response_type=code\\u0026sso_reload=True\"};</script></head></html>"
        )

        form_post_resp = MagicMock()
        form_post_resp.url = "https://login.microsoftonline.com/organizations/oauth2/authorize?x=2"
        form_post_resp.text = (
            '<html><body><form name="hiddenform" method="POST" '
            'action="https://lms.astanait.edu.kz/auth/oidc/">'
            '<input type="hidden" name="code" value="authcode123">'
            '<input type="hidden" name="state" value="st1">'
            '<input type="hidden" name="session_state" value="ss1">'
            "</form></body></html>"
        )

        final_resp = MagicMock()
        final_resp.url = f"{university_scraper.BASE_URL}/my/"
        final_resp.text = '<html><script>var data = {"userid": 777};</script></html>'

        mock_session.get.side_effect = [interrupt_resp, form_post_resp]
        mock_session.post.return_value = final_resp

        with patch.object(university_scraper, "_requests_session", return_value=mock_session):
            result = client._sso_cookie_login()

        self.assertTrue(result)
        self.assertEqual(client._moodle_user_id, 777)
        # First GET is the OIDC entrypoint, second GET is the urlPost hop.
        self.assertEqual(mock_session.get.call_count, 2)
        second_get_url = mock_session.get.call_args_list[1].args[0]
        self.assertEqual(
            second_get_url,
            "https://login.microsoftonline.com/organizations/oauth2/authorize?response_type=code&sso_reload=True",
        )
        mock_session.post.assert_called_once_with(
            "https://lms.astanait.edu.kz/auth/oidc/",
            data={"code": "authcode123", "state": "st1", "session_state": "ss1"},
            timeout=university_scraper.REQUEST_TIMEOUT,
            allow_redirects=True,
        )

    def test_expired_cookie_returns_false(self) -> None:
        client = self._client_with_cookie()
        mock_session = MagicMock()
        mock_session.cookies = MagicMock()
        resp = MagicMock()
        resp.url = "https://login.microsoftonline.com/organizations/oauth2/authorize"
        resp.text = "<html><body>Sign in</body><p>Pick an account</p></html>"
        mock_session.get.return_value = resp

        with patch.object(university_scraper, "_requests_session", return_value=mock_session):
            result = client._sso_cookie_login()

        self.assertFalse(result)
        self.assertIsNone(client._moodle_user_id)

    def test_network_error_raises_sync_error(self) -> None:
        client = self._client_with_cookie()
        mock_session = MagicMock()
        mock_session.cookies = MagicMock()
        mock_session.get.side_effect = ConnectionError("dns failure")

        with patch.object(university_scraper, "_requests_session", return_value=mock_session):
            with self.assertRaises(university_scraper.SyncError):
                client._sso_cookie_login()

    def test_fetch_grades_prefers_sso_cookie_over_form_login(self) -> None:
        client = self._client_with_cookie()
        with (
            patch.object(client, "_sso_cookie_login", return_value=True) as mock_sso,
            patch.object(client, "_form_login") as mock_form,
            patch.object(client, "fetch_via_scrape", return_value=[{"course_title": "X"}]),
        ):
            records = client.fetch_grades()

        mock_sso.assert_called_once()
        mock_form.assert_not_called()
        self.assertEqual(records, [{"course_title": "X"}])


# ── HTML scraping helpers ─────────────────────────────────────────────────────
def _make_soup(html: str) -> object:
    """Parse HTML using html.parser (stdlib) — no bs4 needed for tests."""
    try:
        from bs4 import BeautifulSoup  # type: ignore
        return BeautifulSoup(html, "html.parser")
    except ImportError:
        # Fallback: use stdlib xml.etree can't do HTML well, so use html.parser
        # via a minimal shim that satisfies the scraper's soup.find / find_all API.
        import html as _html
        import html.parser as _htmlparser
        import re as _re

        class _Tag:
            def __init__(self, tag: str, attrs: dict, children: list, text: str = "") -> None:
                self.name = tag
                self.attrs = attrs
                self._children = children
                self._text = text

            def get(self, key: str, default: object = None) -> object:
                return self.attrs.get(key, default)

            def _all_text(self) -> str:
                """Recursively collect all text from this node and its descendants."""
                parts = [self._text]
                for c in self._children:
                    parts.append(c._all_text())
                return "".join(parts)

            def get_text(self, separator: str = "", strip: bool = False) -> str:
                t = self._all_text()
                return t.strip() if strip else t

            def find(self, tag: str, class_: object = None, **kw: object) -> object:
                for c in self.find_all(tag, class_=class_, **kw):
                    return c
                return None

            def find_all(self, tag: str, class_: object = None, **kw: object) -> list:
                results = []
                for c in self._children:
                    if c.name == tag:
                        if class_ is None:
                            results.append(c)
                        elif callable(class_):
                            # attrs['class'] from stdlib html.parser is a plain
                            # string (e.g. "generaltable"), not a list.
                            raw = c.attrs.get("class", "")
                            cls = raw if isinstance(raw, str) else " ".join(raw)
                            if class_(cls):
                                results.append(c)
                        elif isinstance(class_, str):
                            raw = c.attrs.get("class", "")
                            cls = raw if isinstance(raw, str) else " ".join(raw)
                            if class_ in cls:
                                results.append(c)
                    results.extend(c.find_all(tag, class_=class_, **kw))
                return results

            def __getitem__(self, key: str) -> object:
                return self.attrs[key]

        class _Parser(_htmlparser.HTMLParser):
            def __init__(self) -> None:
                super().__init__()
                self._stack: list[_Tag] = [_Tag("root", {}, [])]

            def handle_starttag(self, tag: str, attrs: list) -> None:
                node = _Tag(tag, dict(attrs), [])
                self._stack[-1]._children.append(node)
                self._stack.append(node)

            def handle_endtag(self, tag: str) -> None:
                if len(self._stack) > 1:
                    self._stack.pop()

            def handle_data(self, data: str) -> None:
                if self._stack:
                    self._stack[-1]._text += data

            def root(self) -> _Tag:
                return self._stack[0]

        p = _Parser()
        p.feed(html)
        root = p.root()
        root.name = "html"
        return root


class GradeReportParsingTest(unittest.TestCase):
    """Verify that the BS4 grade-table parser handles Moodle HTML correctly."""

    SAMPLE_HTML = """
    <html><body>
    <table class="generaltable">
      <tr><th>Grade item</th><th>Grade</th></tr>
      <tr><td>Homework 1</td><td>8.50 / 10.00</td></tr>
      <tr><td>Midterm Exam</td><td>40.00 / 50.00</td></tr>
      <tr><td>Course total</td><td>48.50 / 60.00</td></tr>
    </table>
    </body></html>
    """

    def test_parses_grade_rows_and_skips_total(self) -> None:
        env = BASE_ENV
        with (
            patch.dict(os.environ, env, clear=True),
            patch.object(university_scraper, "load_dotenv", lambda _: None),
        ):
            settings = university_scraper.load_settings()

        client = university_scraper.MoodleClient(settings)
        # Inject a fake session that returns our sample HTML
        mock_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.text = self.SAMPLE_HTML
        mock_session.get.return_value = mock_resp
        client._session = mock_session

        # Patch _bs4_parse with our stdlib-based shim so bs4 isn't required
        with patch.object(university_scraper, "_bs4_parse", _make_soup):
            records = client._scrape_grade_report(42, "Test Course")

        # Should have 2 records (Homework + Midterm), not the total row
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["score"], 8.5)
        self.assertEqual(records[0]["max_score"], 10.0)
        self.assertEqual(records[1]["record_type"], "midterm")

    def test_skips_rows_without_score(self) -> None:
        html = """
        <html><body>
        <table class="generaltable">
          <tr><th>Grade item</th><th>Grade</th></tr>
          <tr><td>In Progress</td><td>-</td></tr>
        </table>
        </body></html>
        """
        env = BASE_ENV
        with (
            patch.dict(os.environ, env, clear=True),
            patch.object(university_scraper, "load_dotenv", lambda _: None),
        ):
            settings = university_scraper.load_settings()

        client = university_scraper.MoodleClient(settings)
        mock_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.text = html
        mock_session.get.return_value = mock_resp
        client._session = mock_session

        with patch.object(university_scraper, "_bs4_parse", _make_soup):
            records = client._scrape_grade_report(1, "Some Course")
        self.assertEqual(records, [])


if __name__ == "__main__":
    unittest.main()
