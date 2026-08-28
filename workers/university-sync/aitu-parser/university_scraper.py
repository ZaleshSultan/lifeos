#!/usr/bin/env python3
"""
Sync academic grade data from the Astana IT University (AITU) Moodle LMS
(https://lms.astanait.edu.kz) into LifeOS Supabase.

AUTHENTICATION ARCHITECTURE
============================
The AITU LMS is a Moodle instance. Two auth strategies are attempted in order:

  1. Standard Moodle form login  (requests.Session → POST /login/index.php)
     Works when the institution uses local Moodle accounts.

  2. Moodle Web Services token  (UNIVERSITY_WS_TOKEN env var)
     Preferred when the site exposes a REST API token for a user account.
     Fetches grades via `gradereport_user_get_grade_items` without scraping HTML.

KNOWN CONSTRAINTS / FALLBACK
==============================
AITU's Moodle instance may enforce Microsoft Azure AD SSO for authentication.
When that flow is detected (redirect to login.microsoftonline.com) or when all
live attempts fail, the scraper falls back to a MOCK_MODE with simulated CS
course data so the pipeline can be exercised end-to-end without a live session.

The fallback emits a WARNING log entry prefixed with [MOCK] so operators can
distinguish mock runs from live data in monitoring dashboards.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
import unicodedata
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# ── Path bootstrap (workers/university-sync/aitu-parser → workers/) ──────────
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from common.lifeos_sync import (  # noqa: E402
    BaseSettings,
    SupabaseRestClient,
    SyncError,
    SyncStats,
    getenv_bool,
    getenv_int,
    getenv_required,
    iso_utc,
    load_base_settings,
    load_dotenv,
    stable_checksum,
)

# ── Constants ─────────────────────────────────────────────────────────────────
BASE_URL = "https://lms.astanait.edu.kz"
LOGIN_URL = f"{BASE_URL}/login/index.php"
OIDC_LOGIN_URL = f"{BASE_URL}/auth/oidc/?source=loginpage"
WS_URL = f"{BASE_URL}/webservice/rest/server.php"
GRADE_REPORT_URL = f"{BASE_URL}/grade/report/user/index.php"
MY_COURSES_URL = f"{BASE_URL}/my/"

REQUEST_TIMEOUT = 20  # seconds

# ── Mock data (AITU CS courses) ───────────────────────────────────────────────
MOCK_COURSES: list[dict[str, Any]] = [
    {
        "course_id": "disc_math",
        "course_title": "Discrete Mathematics",
        "assessments": [
            {"item_id": "hw1",      "title": "Homework 1: Set Theory",      "record_type": "assignment", "score": 9.0,  "max_score": 10.0},
            {"item_id": "hw2",      "title": "Homework 2: Graph Theory",    "record_type": "assignment", "score": 8.5,  "max_score": 10.0},
            {"item_id": "midterm",  "title": "Midterm Examination",         "record_type": "midterm",    "score": 42.0, "max_score": 50.0},
            {"item_id": "final",    "title": "Final Examination",           "record_type": "final",      "score": 38.0, "max_score": 50.0},
        ],
    },
    {
        "course_id": "algo_ds",
        "course_title": "Algorithms and Data Structures",
        "assessments": [
            {"item_id": "lab1",     "title": "Lab 1: Sorting Algorithms",   "record_type": "assignment", "score": 10.0, "max_score": 10.0},
            {"item_id": "lab2",     "title": "Lab 2: Tree Traversal",       "record_type": "assignment", "score": 9.5,  "max_score": 10.0},
            {"item_id": "midterm",  "title": "Midterm Examination",         "record_type": "midterm",    "score": 45.0, "max_score": 50.0},
            {"item_id": "final",    "title": "Final Examination",           "record_type": "final",      "score": 44.0, "max_score": 50.0},
        ],
    },
    {
        "course_id": "os_basics",
        "course_title": "Operating Systems",
        "assessments": [
            {"item_id": "assign1",  "title": "Process Scheduling Report",  "record_type": "assignment", "score": 8.0,  "max_score": 10.0},
            {"item_id": "midterm",  "title": "Midterm Examination",         "record_type": "midterm",    "score": 37.0, "max_score": 50.0},
            {"item_id": "final",    "title": "Final Examination",           "record_type": "final",      "score": 41.0, "max_score": 50.0},
        ],
    },
]


# ── Settings ──────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Settings:
    base: BaseSettings
    username: str
    password: str
    ws_token: str | None          # Optional Moodle WS token (most reliable)
    sso_cookie: str | None        # Optional Microsoft ESTSAUTHPERSISTENT cookie
    poll_seconds: int
    allow_mock: bool              # Explicit opt-in for mock fallback (never automatic)


def load_settings(env_file: Path | None = None) -> Settings:
    load_dotenv(Path(__file__).with_name(".env"))
    if env_file:
        load_dotenv(env_file)
    return Settings(
        base=load_base_settings(
            legacy_guard_env="LIFEOS_ENABLE_LEGACY_SINGLE_USER_UNIVERSITY_SYNC",
            worker_name="University Platform sync",
        ),
        username=getenv_required("UNIVERSITY_USERNAME"),
        password=getenv_required("UNIVERSITY_PASSWORD"),
        ws_token=os.environ.get("UNIVERSITY_WS_TOKEN", "").strip() or None,
        sso_cookie=os.environ.get("UNIVERSITY_SSO_COOKIE", "").strip() or None,
        poll_seconds=getenv_int("UNIVERSITY_SYNC_POLL_SECONDS", 3600),
        allow_mock=getenv_bool("AITU_SYNC_MOCK_MODE", False),
    )


# ── Helpers ───────────────────────────────────────────────────────────────────
def slugify(text: str) -> str:
    """Convert arbitrary text to a URL/ID-safe slug."""
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[\s_-]+", "_", text)[:80]


def classify_record_type(item_name: str) -> str:
    """Heuristically classify a Moodle grade item as assignment/midterm/final/quiz."""
    name = item_name.lower()
    if any(k in name for k in ("final", "финал", "итог")):
        return "final"
    if any(k in name for k in ("midterm", "mid-term", "промежуточ")):
        return "midterm"
    if any(k in name for k in ("quiz", "тест")):
        return "quiz"
    return "assignment"


def _requests_session() -> Any:
    """Import and return a requests.Session, raising SyncError if not installed."""
    try:
        import requests  # type: ignore
        session = requests.Session()
        # A self-identifying UA (e.g. "LifeOS AITU Sync/1.0") or the default
        # python-requests UA both got blocked outright by AITU's edge (confirmed
        # via manual diagnostic: default requests UA -> 403; browser-like UA ->
        # 200 on the exact same URL, same server, no WAF/Cloudflare in play).
        # Mimic a real browser instead.
        session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
        })
        return session
    except ImportError as exc:
        raise SyncError("'requests' library is not installed; add it to requirements.txt") from exc


def _bs4_parse(html: str) -> Any:
    """Import BeautifulSoup and parse HTML, raising SyncError if not installed."""
    try:
        from bs4 import BeautifulSoup  # type: ignore
        return BeautifulSoup(html, "html.parser")
    except ImportError as exc:
        raise SyncError("'beautifulsoup4' library not installed; add it to requirements.txt") from exc


# ── Moodle client ─────────────────────────────────────────────────────────────
class MoodleClient:
    """
    Resilient Moodle client for lms.astanait.edu.kz.

    Strategy priority (highest to lowest):
      1. Web Services REST API (requires UNIVERSITY_WS_TOKEN)
      2. Session-based form login + HTML grade report scraping
      3. Mock mode (logged as [MOCK])
    """

    def __init__(self, settings: Settings) -> None:
        self._username = settings.username
        self._password = settings.password
        self._ws_token = settings.ws_token
        self._sso_cookie = settings.sso_cookie
        self._allow_mock = settings.allow_mock
        self._session: Any = None
        self._moodle_user_id: int | None = None
        self.is_mocked = False
        self._mock_reason = ""

    # ── Strategy 1: Web Services API ─────────────────────────────────────────
    def _ws_call(self, function: str, **params: Any) -> Any:
        """Call a Moodle Web Service function and return parsed JSON."""
        session = _requests_session()
        payload = {
            "wstoken": self._ws_token,
            "wsfunction": function,
            "moodlewsrestformat": "json",
            **params,
        }
        resp = session.post(WS_URL, data=payload, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        # Moodle WS signals errors as {"exception": ..., "errorcode": ...}
        if isinstance(data, dict) and "exception" in data:
            raise SyncError(
                f"Moodle WS error [{data.get('errorcode')}]: {data.get('message', data)}"
            )
        return data

    def _ws_get_userid(self) -> int:
        data = self._ws_call("core_webservice_get_site_info")
        return int(data["userid"])

    def _ws_get_enrolled_courses(self, user_id: int) -> list[dict]:
        return self._ws_call("core_enrol_get_users_courses", userid=user_id) or []

    def _ws_get_grade_items(self, course_id: int, user_id: int) -> list[dict]:
        data = self._ws_call(
            "gradereport_user_get_grade_items",
            courseid=course_id,
            userid=user_id,
        )
        # Response: {"usergrades": [{"courseid":…, "gradeitems":[…]}]}
        usergrades = data.get("usergrades", [])
        if usergrades:
            return usergrades[0].get("gradeitems", [])
        return []

    def fetch_via_ws(self) -> list[dict[str, Any]]:
        """Fetch all grade items for enrolled courses using the WS API."""
        user_id = self._ws_get_userid()
        courses = self._ws_get_enrolled_courses(user_id)
        records: list[dict[str, Any]] = []
        for course in courses:
            cid = int(course["id"])
            ctitle = str(course.get("fullname") or course.get("shortname") or f"course_{cid}")
            try:
                items = self._ws_get_grade_items(cid, user_id)
            except SyncError as exc:
                logging.warning("WS grade fetch failed for course %s: %s", ctitle, exc)
                continue
            for item in items:
                itype = str(item.get("itemtype", ""))
                imodule = str(item.get("itemmodule") or "")
                iname = str(item.get("itemname") or ctitle)
                # Skip course total rows (itemtype == "course")
                if itype == "course":
                    continue
                grade_raw = item.get("graderaw")
                grade_max = item.get("grademax")
                if grade_raw is None or grade_max is None:
                    continue
                records.append({
                    "course_id": str(cid),
                    "course_title": ctitle,
                    "item_id": str(item.get("id", slugify(iname))),
                    "title": iname,
                    "record_type": classify_record_type(iname),
                    "score": float(grade_raw),
                    "max_score": float(grade_max),
                    "raw": item,
                })
        return records

    # ── Strategy 2: Session login + HTML scraping ─────────────────────────────
    def _sso_cookie_login(self) -> bool:
        """
        Authenticate via a Microsoft Entra ID (Azure AD) persistent SSO session
        cookie (ESTSAUTHPERSISTENT), for institutions like AITU where Moodle has
        no native username/password login at all — only "OpenID Connect".

        The cookie is obtained once by the human: sign into AITU normally in a
        browser, open devtools → Application → Cookies →
        https://login.microsoftonline.com → copy the ESTSAUTHPERSISTENT value.
        It is a long-lived (weeks) persistent-session cookie, not a short-lived
        access token, which is why this can run unattended in a daemon.

        Mechanics: we seed that cookie on the microsoftonline.com domain, then
        walk the same redirect chain a browser would when Moodle bounces us to
        Microsoft's OAuth "authorize" endpoint. Because a valid persistent
        session cookie is already present, Microsoft's login page auto-approves
        without prompting for credentials — but the final hop back to Moodle is
        typically an OIDC `response_mode=form_post`: an HTML page with an
        auto-submitting <form> (via a bit of inline JS) that POSTs the id_token
        back to Moodle's redirect_uri. `requests` doesn't execute JS, so we
        parse that form's hidden inputs and POST them ourselves — the same
        submission a real browser's JS would have performed instantly.
        """
        if not self._sso_cookie:
            return False

        session = _requests_session()
        session.cookies.set(
            "ESTSAUTHPERSISTENT",
            self._sso_cookie,
            domain="login.microsoftonline.com",
        )

        try:
            # Hit the actual "OpenID Connect" login entrypoint directly — Moodle's
            # generic /login/index.php shows a picker page (native form + this
            # button) rather than auto-redirecting, so GETing it alone never
            # starts the Microsoft SSO flow at all.
            r = session.get(OIDC_LOGIN_URL, timeout=REQUEST_TIMEOUT, allow_redirects=True)

            # Replicate what a real browser's JS does across up to a few hops:
            #   1. A "BssoInterrupt" page (no <form>, just a JS $Config blob with
            #      a "urlPost" field carrying &sso_reload=True) — the browser's
            #      inline JS re-requests that URL to force Microsoft to retry
            #      silent SSO using the persistent cookie. We GET it manually.
            #   2. A response_mode=form_post page — an auto-submitting <form>
            #      (code/state/session_state) targeting Moodle's redirect_uri.
            #      We parse the hidden inputs and POST them manually.
            for _ in range(4):
                soup = _bs4_parse(r.text)
                form = soup.find("form")

                if form:
                    action = form.get("action")
                    inputs = {
                        tag.get("name"): tag.get("value", "")
                        for tag in soup.find_all("input")
                        if tag.get("name")
                    }
                    if not action or not inputs:
                        break
                    r = session.post(
                        action, data=inputs, timeout=REQUEST_TIMEOUT, allow_redirects=True
                    )
                    continue

                m_urlpost = re.search(r'"urlPost"\s*:\s*"([^"]+)"', r.text)
                if m_urlpost:
                    next_url = m_urlpost.group(1).encode().decode("unicode_escape")
                    if next_url.startswith("/"):
                        next_url = "https://login.microsoftonline.com" + next_url
                    r = session.get(next_url, timeout=REQUEST_TIMEOUT, allow_redirects=True)
                    continue

                break

            m = re.search(r'"userid"\s*:\s*(\d+)', r.text, re.IGNORECASE)
            if not m:
                logging.warning(
                    "SSO cookie login did not yield a real Moodle session "
                    "(no userid found). The ESTSAUTHPERSISTENT cookie may have "
                    "expired — re-copy a fresh value from a signed-in browser."
                )
                return False

            self._moodle_user_id = int(m.group(1))
            self._session = session
            logging.info(
                "SSO cookie login succeeded (user_id=%s).", self._moodle_user_id
            )
            return True

        except Exception as exc:
            raise SyncError(f"SSO cookie login network error: {exc}") from exc

    def _form_login(self) -> bool:
        """
        Attempt standard Moodle form-based login.

        Returns True on success.  Sets self._session for subsequent requests.

        Failure modes:
          - Microsoft SSO redirect → returns False (detectable by location)
          - Wrong credentials → returns False
          - Network error → raises SyncError
        """
        session = _requests_session()
        try:
            # Step 1: GET the login page to extract logintoken (Moodle CSRF token)
            r = session.get(LOGIN_URL, timeout=REQUEST_TIMEOUT, allow_redirects=True)
            final_url = r.url

            # Detect SSO redirect away from our domain
            if "microsoftonline.com" in final_url or "login.microsoft" in final_url:
                logging.warning(
                    "AITU Moodle redirects to Microsoft SSO (%s). "
                    "Standard form login is not possible. "
                    "Set UNIVERSITY_WS_TOKEN to use the Web Services API instead.",
                    final_url,
                )
                return False

            soup = _bs4_parse(r.text)
            token_tag = soup.find("input", {"name": "logintoken"})
            login_token = token_tag["value"] if token_tag else ""

            # Step 2: POST credentials
            payload = {
                "username": self._username,
                "password": self._password,
                "logintoken": login_token,
                "anchor": "",
            }
            r2 = session.post(LOGIN_URL, data=payload, timeout=REQUEST_TIMEOUT, allow_redirects=True)

            # Moodle signals failure by keeping us on the login page
            if "login" in r2.url and "id=username" in r2.text:
                logging.warning("Moodle form login failed: invalid credentials or account locked.")
                return False

            # Try to extract Moodle user id from the page JS (used for grade report URL)
            m = re.search(r'"userid"\s*:\s*(\d+)', r2.text, re.IGNORECASE)
            if m:
                self._moodle_user_id = int(m.group(1))

            if self._moodle_user_id is None:
                # We didn't land on the visible "wrong credentials" page, but we
                # also never got a real session (no userid in the response). This
                # happens on institutions where the native form silently accepts
                # the POST without authenticating (e.g. accounts that are actually
                # SSO/OpenID-Connect-only and have no real Moodle-native password).
                # Treating this as "success" previously caused a false-positive
                # empty sync (0 courses, sync_run marked success) instead of a
                # real, surfaced failure.
                logging.warning(
                    "Moodle form login did not return a real session (no userid "
                    "found). This account may be SSO/OpenID-Connect-only with no "
                    "native Moodle password; a UNIVERSITY_WS_TOKEN is required."
                )
                return False

            self._session = session
            logging.info("Moodle session login succeeded (user_id=%s).", self._moodle_user_id)
            return True

        except Exception as exc:
            raise SyncError(f"Moodle form login network error: {exc}") from exc

    def _scrape_enrolled_course_ids(self) -> list[tuple[int, str]]:
        """
        Parse the My Courses page to discover enrolled course IDs and titles.
        Returns list of (course_id, course_title).
        """
        r = self._session.get(MY_COURSES_URL, timeout=REQUEST_TIMEOUT)
        soup = _bs4_parse(r.text)
        results: list[tuple[int, str]] = []
        # Moodle renders course links as  /course/view.php?id=NNN
        for a in soup.find_all("a", href=re.compile(r"/course/view\.php\?id=\d+")):
            m = re.search(r"id=(\d+)", a["href"])
            if m:
                cid = int(m.group(1))
                ctitle = a.get_text(strip=True) or f"course_{cid}"
                results.append((cid, ctitle))
        # Deduplicate while preserving order
        seen: set[int] = set()
        deduped = []
        for cid, ctitle in results:
            if cid not in seen:
                seen.add(cid)
                deduped.append((cid, ctitle))
        return deduped

    def _scrape_grade_report(self, course_id: int, course_title: str) -> list[dict[str, Any]]:
        """
        Scrape the Moodle user-grade report for one course.

        Moodle renders the grade report as an HTML table with class 'generaltable'.
        Typical columns: Grade Item | Grade | Range | Percentage | Feedback
        """
        params: dict[str, Any] = {"id": course_id}
        if self._moodle_user_id:
            params["userid"] = self._moodle_user_id
        url = GRADE_REPORT_URL + "?" + urllib.parse.urlencode(params)
        r = self._session.get(url, timeout=REQUEST_TIMEOUT)
        soup = _bs4_parse(r.text)

        records: list[dict[str, Any]] = []
        # Moodle grade report tables have class "generaltable" or contain "user-grade"
        table = soup.find(
            "table",
            class_=lambda c: c and ("generaltable" in c or "user-grade" in c),
        )
        if not table:
            logging.debug("No grade table found for course %s (id=%d).", course_title, course_id)
            return records

        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all("td")
            if len(cells) < 2:
                continue
            item_name_cell = cells[0]
            grade_cell = cells[1]

            item_name = item_name_cell.get_text(separator=" ", strip=True)
            grade_raw = grade_cell.get_text(strip=True)

            # Skip header rows and course total rows
            if not item_name or item_name.lower() in ("course total", "итого"):
                continue

            # Parse "score / max" from grade cell (e.g. "8.50 / 10.00")
            score_match = re.search(r"([\d.]+)\s*/\s*([\d.]+)", grade_raw)
            if not score_match:
                # Try a bare number and assume max from aria or skip
                bare_match = re.search(r"^([\d.]+)$", grade_raw.strip())
                if not bare_match:
                    continue
                score = float(bare_match.group(1))
                max_score = 100.0  # Default when max is not shown
            else:
                score = float(score_match.group(1))
                max_score = float(score_match.group(2))

            if max_score <= 0:
                continue

            records.append({
                "course_id": str(course_id),
                "course_title": course_title,
                "item_id": slugify(item_name),
                "title": item_name,
                "record_type": classify_record_type(item_name),
                "score": score,
                "max_score": max_score,
                "raw": {
                    "course_id": course_id,
                    "course_title": course_title,
                    "item_name": item_name,
                    "grade_cell_text": grade_raw,
                },
            })
        return records

    def fetch_via_scrape(self) -> list[dict[str, Any]]:
        """Fetch grade records by HTML scraping after session login."""
        enrolled = self._scrape_enrolled_course_ids()
        if not enrolled:
            logging.warning("No enrolled courses found via HTML scraping.")
            return []
        all_records: list[dict[str, Any]] = []
        for cid, ctitle in enrolled:
            try:
                records = self._scrape_grade_report(cid, ctitle)
                all_records.extend(records)
            except Exception as exc:
                logging.warning("Grade scrape failed for course %s (id=%d): %s", ctitle, cid, exc)
        return all_records

    # ── Strategy 3: Mock ──────────────────────────────────────────────────────
    def _mock_grades(self) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        for course in MOCK_COURSES:
            for item in course["assessments"]:
                records.append({
                    "course_id": course["course_id"],
                    "course_title": course["course_title"],
                    "item_id": item["item_id"],
                    "title": item["title"],
                    "record_type": item["record_type"],
                    "score": float(item["score"]),
                    "max_score": float(item["max_score"]),
                    "raw": {**course, **item},
                })
        return records

    # ── Public interface ──────────────────────────────────────────────────────
    def fetch_grades(self) -> list[dict[str, Any]]:
        """
        Fetch grade records using the best available strategy.

        Returns a flat list of records, each containing:
          course_id, course_title, item_id, title, record_type, score, max_score, raw
        """
        # Strategy 1: Web Services API token
        if self._ws_token:
            try:
                records = self.fetch_via_ws()
                logging.info("Moodle WS API: fetched %d grade records.", len(records))
                return records
            except SyncError as exc:
                logging.warning("Moodle WS API failed (%s). Falling back to session scrape.", exc)

        # Strategy 2: Microsoft SSO persistent-cookie login. Preferred over form
        # login for institutions (like AITU) that have no native Moodle password
        # at all — form login there produces a false-positive "success" with no
        # real session (see _form_login's userid check).
        if self._sso_cookie:
            try:
                if self._sso_cookie_login():
                    records = self.fetch_via_scrape()
                    logging.info(
                        "SSO cookie + HTML scrape: fetched %d grade records.",
                        len(records),
                    )
                    return records
            except SyncError as exc:
                logging.warning(
                    "SSO cookie login failed (%s). Falling back to form login.", exc
                )

        # Strategy 3: Form login + HTML scrape
        try:
            if self._form_login():
                records = self.fetch_via_scrape()
                logging.info("HTML scrape: fetched %d grade records.", len(records))
                return records
        except SyncError as exc:
            logging.warning("Session scrape failed (%s). Falling back to mock mode.", exc)

        # Strategy 4: Mock fallback — only if explicitly allowed. A live sync
        # failure must surface as a failed sync_run, never as silent mock
        # data standing in for real grades.
        reason = (
            "All live fetch strategies failed (WS token absent or invalid, "
            "SSO cookie absent/expired, form login blocked by SSO/network). "
            "Set UNIVERSITY_WS_TOKEN or UNIVERSITY_SSO_COOKIE."
        )

        if not self._allow_mock:
            raise SyncError(
                f"{reason} Refusing to fall back to mock data automatically. "
                "Set AITU_SYNC_MOCK_MODE=true to explicitly opt into mock mode "
                "(e.g. for local pipeline testing)."
            )

        self.is_mocked = True
        self._mock_reason = (
            f"{reason} Returning mock AITU CS course data for pipeline validation."
        )
        logging.warning("[MOCK] %s", self._mock_reason)
        return self._mock_grades()


# ── Sync pipeline ─────────────────────────────────────────────────────────────
def sync_grades(
    db: SupabaseRestClient,
    settings: Settings,
    records: list[dict[str, Any]],
    mode: str,
    is_mocked: bool,
    run_id: str | None = None,
) -> SyncStats:
    """Write scraped grade records into source_events and academic_records."""
    if run_id is None:
        source = db.ensure_source("university_platform", "university", "University Platform")
        run_id = db.start_sync_run(source)
    stats = SyncStats(seen=len(records))

    try:
        seen_external_ids: set[str] = set()

        for rec in records:
            course_slug = slugify(rec.get("course_title", rec.get("course_id", "unknown")))
            item_slug = slugify(rec.get("title", rec.get("item_id", "unknown")))
            external_id = f"academic:grade:{course_slug}:{item_slug}"
            seen_external_ids.add(external_id)

            course_title = rec.get("course_title", "Unknown Course")
            item_title = rec.get("title", "Grade Item")
            record_type = rec.get("record_type", "assignment")
            score = float(rec.get("score") or 0.0)
            max_score = float(rec.get("max_score") or 100.0)
            percentage = (score / max_score * 100.0) if max_score > 0 else 0.0

            raw_json: dict[str, Any] = dict(rec.get("raw") or rec)
            raw_json["_is_mocked"] = is_mocked

            # ── 1. Stage into source_events ───────────────────────────────────
            event_dict: dict[str, Any] = {
                "source_key": "university_platform",
                "external_id": external_id,
                "event_type": "academic_grade",
                "title": item_title,
                "description": f"Grade item for {course_title}",
                "status": "active",
                "raw_json": raw_json,
            }
            synced_event, created, reminder_stats = db.upsert_event(event_dict, mode)
            stats.created += int(created)
            stats.updated += int(not created)
            stats.reminders_created += reminder_stats.created
            stats.reminders_updated += reminder_stats.updated
            stats.reminders_cancelled += reminder_stats.cancelled

            source_event_id: str = synced_event["id"]

            # ── 2. Idempotent upsert into academic_records ────────────────────
            existing = db.request(
                "GET",
                "academic_records",
                query={
                    "select": "id",
                    "user_id": f"eq.{db.settings.user_id}",
                    "source_event_id": f"eq.{source_event_id}",
                    "limit": "1",
                },
            )

            academic_payload: dict[str, Any] = {
                "user_id": settings.base.user_id,
                "source_event_id": source_event_id,
                "course_title": course_title,
                "record_type": record_type,
                "title": item_title,
                "score": score,
                "max_score": max_score,
                "percentage": round(percentage, 4),
                "raw_json": raw_json,
            }

            if existing:
                db.request(
                    "PATCH",
                    "academic_records",
                    query={"id": f"eq.{existing[0]['id']}"},
                    body=academic_payload,
                )
            else:
                db.request("POST", "academic_records", body=academic_payload)

        stats.missing = db.mark_missing("university_platform", seen_external_ids)
        db.finish_sync_run(run_id, "success", stats)
        logging.info(
            "university_sync done seen=%d created=%d updated=%d missing=%d reminders_created=%d",
            stats.seen, stats.created, stats.updated, stats.missing, stats.reminders_created,
        )
        return stats

    except Exception as exc:
        db.finish_sync_run(run_id, "failed", stats, str(exc))
        raise


# ── Top-level commands ────────────────────────────────────────────────────────
def sync_once(settings: Settings) -> SyncStats:
    moodle = MoodleClient(settings)
    db = SupabaseRestClient(settings.base)

    # Open the sync_run before attempting the live fetch. Otherwise a fetch
    # failure (e.g. mock mode disabled and live scraping down) never gets
    # recorded, and the TMA dashboard keeps showing a stale "success" from
    # the last time the sync actually worked.
    source = db.ensure_source("university_platform", "university", "University Platform")
    run_id = db.start_sync_run(source)

    try:
        records = moodle.fetch_grades()
    except Exception as exc:
        db.finish_sync_run(run_id, "failed", SyncStats(), str(exc))
        raise

    mode = db.get_reminder_mode()
    return sync_grades(db, settings, records, mode, moodle.is_mocked, run_id=run_id)


def status_cmd(settings: Settings) -> None:
    print("AITU LMS university sync status")
    print(f"  Target:    {BASE_URL}")
    print(f"  Username:  {settings.username}")
    ws_status = "configured" if settings.ws_token else "absent (fallback to form login)"
    print(f"  WS token:  {ws_status}")
    db = SupabaseRestClient(settings.base)
    for row in db.source_status(["university_platform"]):
        print(
            f"  {row['source_key']}: {row['status']}  "
            f"last_sync={row.get('last_sync_at') or 'never'}"
        )


def run_loop(settings: Settings) -> None:
    while True:
        try:
            stats = sync_once(settings)
            logging.info("university_sync complete stats=%s", stats)
        except Exception as exc:  # noqa: BLE001
            logging.exception("university_sync iteration failed: %s", exc)
        time.sleep(settings.poll_seconds)


# ── CLI ───────────────────────────────────────────────────────────────────────
def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="LifeOS AITU LMS university grade sync",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Commands:\n"
            "  status      Show current sync source status\n"
            "  sync-once   Run a single sync and print JSON stats\n"
            "  run-loop    Sync repeatedly every UNIVERSITY_SYNC_POLL_SECONDS\n"
        ),
    )
    parser.add_argument("--env-file", type=Path, metavar="PATH",
                        help="Path to a .env file (default: .env next to this script)")
    parser.add_argument("command", choices=("status", "sync-once", "run-loop"))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        settings = load_settings(args.env_file)
        if args.command == "status":
            status_cmd(settings)
        elif args.command == "sync-once":
            stats = sync_once(settings)
            print(json.dumps(vars(stats), indent=2))
        else:
            run_loop(settings)
        return 0
    except (SyncError, OSError, ValueError) as exc:
        logging.error("%s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
