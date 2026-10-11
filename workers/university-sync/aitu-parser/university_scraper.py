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
Live failures fail the sync. Simulated data is allowed only with explicit
AITU_SYNC_MOCK_MODE opt-in; it never populates real course assessments.

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
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ── Path bootstrap (workers/university-sync/aitu-parser → workers/) ──────────
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

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
    parse_datetime,
    stable_checksum,
    timezone_for,
    utc_now,
)

from common.academic_sync import load_courses, match_course, sync_assessment, mark_missing_grades, link_course
from common.moodle_grades import normalize_title, number, parse_report
from common.lms_sync_lease import LmsSyncLease, guard_lms_client
from moodle_session_security import MoodleSessionError, SsoDiagnostics, safe_url, secure_request, valid_sso_cookie, MOODLE_HOST, MICROSOFT_HOST
from moodle_activities import AssignmentSnapshot, GradeSnapshot, UnsupportedMoodlePage, activity_links, parse_activity

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


def build_grade_analysis(score: float | None, max_score: float | None, target_percent: float = 70.0) -> dict[str, Any]:
    """Deterministic commentary for one grade; not an AI or final-course prediction."""
    if score is None or max_score is None or max_score <= 0:
        return {
            "version": 1,
            "basis": "single_graded_item",
            "target_percent": target_percent,
            "percentage": None,
            "delta_percent_points": None,
            "status": "unknown",
            "summary": "Нет подтверждённого максимума баллов: сравнить оценку в процентах нельзя.",
        }
    pct = round(score / max_score * 100.0, 1)
    delta = round(pct - target_percent, 1)
    if pct >= 85:
        status = "strong"
        comment = "Сильный результат. Сохрани такой уровень в следующих работах."
    elif pct >= target_percent:
        status = "on_target"
        comment = "Результат выше или равен ориентиру. Следи за следующими контрольными."
    elif pct >= 50:
        status = "below_target"
        comment = "Ниже ориентира. Полезно разобрать ошибки и уделить внимание следующей работе."
    else:
        status = "needs_attention"
        comment = "Низкий результат. Приоритет — разобрать ошибки и уточнить возможность пересдачи."
    return {
        "version": 1,
        "basis": "single_graded_item",
        "target_percent": target_percent,
        "percentage": pct,
        "delta_percent_points": delta,
        "status": status,
        "summary": comment,
    }


def grade_posted_message(course_title: str, item_title: str, score: float, max_score: float | None) -> str:
    grade = f"{score:.15g}"
    if max_score is not None:
        grade += f"/{max_score:.15g}"
        if max_score > 0:
            grade += f" ({score / max_score * 100:.1f}%)"
    analysis = build_grade_analysis(score, max_score)
    if analysis["percentage"] is None:
        return f"Оценка по «{course_title}»: {item_title} — {grade}\n\n{analysis['summary']}"
    relative = analysis["delta_percent_points"]
    direction = "выше" if relative >= 0 else "ниже"
    return (
        f"Оценка по «{course_title}»: {item_title} — {grade}\n\n"
        f"📊 {abs(relative):.1f} п.п. {direction} ориентира {analysis['target_percent']:.0f}% "
        f"для этой работы. {analysis['summary']}\n"
        "Это не прогноз итоговой оценки. Подробнее — в LifeOS → Дашборд."
    )


def moodle_grade_notifications_enabled(db: SupabaseRestClient) -> bool:
    """Only announce grades after a completed Moodle grade snapshot exists."""
    successful_run = db.request(
        "GET",
        "sync_runs",
        query={
            "select": "id",
            "user_id": f"eq.{db.settings.user_id}",
            "source_key": "eq.university_platform",
            "status": "eq.success",
            "metadata_json->>moodle_grades_synced": "eq.true",
            "limit": "1",
        },
    )
    return bool(successful_run)


def _requests_session() -> Any:
    """Import and return a requests.Session, raising SyncError if not installed."""
    try:
        import requests  # type: ignore
        session = requests.Session()
        session.trust_env = False
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


def _authenticated_moodle_user_id(html: str, url: str) -> int | None:
    """Only accept a positive ID from the current response on our Moodle host."""
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != urllib.parse.urlsplit(BASE_URL).hostname:
        return None
    match = re.search(r'"userid"\s*:\s*(\d+)(?=\s*[,}])', html, re.IGNORECASE)
    if not match:
        return None
    user_id = int(match.group(1))
    return user_id if user_id > 0 else None


def _safe_grade_report_error(exc: Exception) -> str:
    """Keep useful failure details without logging URLs or response contents."""
    if isinstance(exc, SyncError):
        message = str(exc)
        safe_messages = (
            r"Moodle grade table missing for course \d+; refusing an empty snapshot",
            r"Unrecognized grade columns for course \d+",
            r"Ambiguous Moodle grade identity in course \d+",
            r"Unrecognized Moodle numeric grade",
            r"Invalid Moodle numeric grade",
        )
        if any(re.fullmatch(pattern, message) for pattern in safe_messages):
            return message
    # requests HTTPError messages include the full URL, which may carry OAuth
    # parameters after a redirect. Only expose the numeric status and type.
    error_type = type(exc).__name__
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", error_type):
        error_type = "Exception"
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if isinstance(status, int) and 100 <= status <= 599:
        return f"HTTP {status} ({error_type})"
    return error_type


def _safe_assignment_ws_error(exc: Exception) -> str:
    if isinstance(exc, SyncError):
        match = re.match(r"Moodle WS error \[([a-z0-9_]{1,64})\]:", str(exc))
        if match:
            return match.group(1)
    return _safe_grade_report_error(exc)


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
        self.unsupported_features: list[str] = []
        self._timezone_name = settings.base.timezone_name
        self._enrolled_courses: list[tuple[int, str]] | None = None
        self._sso_diagnostics = SsoDiagnostics()

    def close(self) -> None:
        if self._session is not None:
            self._session.cookies.clear()
            self._session.close()
        self._session = None
        self._sso_cookie = self._ws_token = None
        self._username = self._password = ""

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
        resp = secure_request(session, "POST", WS_URL, data=payload, moodle_only=True)
        resp.raise_for_status()
        data = resp.json()
        # Moodle WS signals errors as {"exception": ..., "errorcode": ...}
        if isinstance(data, dict) and "exception" in data:
            code = str(data.get("errorcode") or "unknown")
            code = code if re.fullmatch(r"[a-z0-9_]{1,64}", code) else "unknown"
            raise SyncError(f"Moodle WS error [{code}]: request rejected")
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
        if not usergrades or "gradeitems" not in usergrades[0]:
            raise SyncError(f"Moodle WS grade report missing for course {course_id}")
        return usergrades[0]["gradeitems"]

    def _ws_get_assignments(self, courses: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Read a complete assignment snapshot for the enrolled courses."""
        enrolled: dict[int, str] = {}
        for course in courses:
            course_id = int(course["id"])
            if course_id <= 0 or course_id in enrolled:
                raise SyncError("Invalid Moodle assignment course snapshot")
            enrolled[course_id] = str(
                course.get("fullname") or course.get("shortname") or f"course_{course_id}"
            )
        if not enrolled:
            return []

        # Moodle REST expects indexed form fields, not a Python list value.
        course_params = {f"courseids[{index}]": course_id for index, course_id in enumerate(enrolled)}
        data = self._ws_call("mod_assign_get_assignments", **course_params)
        if not isinstance(data, dict) or not isinstance(data.get("courses"), list) or data.get("warnings"):
            raise SyncError("Incomplete Moodle assignment snapshot")

        records: list[dict[str, Any]] = []
        seen_courses: set[int] = set()
        seen_assignments: set[tuple[int, int]] = set()
        for course in data["courses"]:
            if not isinstance(course, dict):
                raise SyncError("Invalid Moodle assignment course")
            course_id = int(course["id"])
            if course_id not in enrolled or course_id in seen_courses:
                raise SyncError("Unexpected Moodle assignment course")
            seen_courses.add(course_id)
            assignments = course.get("assignments")
            if not isinstance(assignments, list):
                raise SyncError("Invalid Moodle assignment list")
            for assignment in assignments:
                if not isinstance(assignment, dict):
                    raise SyncError("Invalid Moodle assignment")
                assignment_id = int(assignment["id"])
                if assignment_id <= 0 or int(assignment.get("course", course_id)) != course_id:
                    raise SyncError("Invalid Moodle assignment identity")
                identity = (course_id, assignment_id)
                if identity in seen_assignments:
                    raise SyncError("Duplicate Moodle assignment identity")
                seen_assignments.add(identity)
                due_timestamp = int(assignment.get("duedate") or 0)
                if due_timestamp <= 0:
                    continue
                title = str(assignment.get("name") or "").strip()
                if not title:
                    raise SyncError("Moodle assignment title is missing")
                due_at = datetime.fromtimestamp(due_timestamp, timezone.utc)
                cmid = int(assignment.get("cmid") or 0)
                records.append({
                    "course_id": str(course_id),
                    "course_title": enrolled[course_id],
                    "assignment_id": str(assignment_id),
                    "cmid": str(cmid) if cmid > 0 else None,
                    "title": title,
                    "due_at": iso_utc(due_at),
                })
        if seen_courses != set(enrolled):
            raise SyncError("Incomplete Moodle assignment course snapshot")
        return records

    def fetch_via_ws(self) -> list[dict[str, Any]]:
        """Fetch all grade items for enrolled courses using the WS API."""
        user_id = self._ws_get_userid()
        courses = self._ws_get_enrolled_courses(user_id)
        records: list[dict[str, Any]] = []
        for course in courses:
            cid = int(course["id"])
            ctitle = str(course.get("fullname") or course.get("shortname") or f"course_{cid}")
            items = self._ws_get_grade_items(cid, user_id)
            for item in items:
                itype = str(item.get("itemtype", ""))
                imodule = str(item.get("itemmodule") or "")
                iname = str(item.get("itemname") or ctitle)
                # Aggregates are not individual assessments.
                if itype in {"course", "category"}:
                    continue
                grade_raw = item.get("graderaw")
                grade_max = item.get("grademax")
                records.append({
                    "course_id": str(cid),
                    "course_title": ctitle,
                    "item_id": str(item.get("id", slugify(iname))),
                    "title": iname,
                    "record_type": classify_record_type(iname),
                    "score": number(grade_raw),
                    "max_score": number(grade_max),
                    "raw": item,
                })
        return records

    # ── Strategy 2: Session login + HTML scraping ─────────────────────────────
    def _sso_cookie_login(self) -> bool:
        """Walk only approved origins and the OIDC form-post callback, never login forms."""
        self._session = None
        self._moodle_user_id = None
        trace = self._sso_diagnostics = SsoDiagnostics()
        if not self._sso_cookie:
            return False
        if not valid_sso_cookie(self._sso_cookie):
            trace.record("cookie_validation", "rejected")
            raise MoodleSessionError("unsupported_auth_flow")
        trace.record("cookie_validation", "accepted")
        session = _requests_session()
        deadline = time.monotonic() + 55
        try:
            response = secure_request(session, "GET", OIDC_LOGIN_URL, cookie=self._sso_cookie, deadline=deadline, diagnostics=trace)
            for _ in range(5):
                current = response.url
                user_id = _authenticated_moodle_user_id(response.text, current)
                if user_id:
                    trace.record("authenticated_moodle_session", "identity_verified")
                    self._moodle_user_id, self._session = user_id, session
                    logging.info("Moodle SSO session validated.")
                    return True
                soup = _bs4_parse(response.text)
                trace.record("microsoft_login_page" if urllib.parse.urlsplit(current).hostname == MICROSOFT_HOST else "moodle_callback", "page_received")
                forms = soup.find_all("form")
                if forms:
                    if urllib.parse.urlsplit(current).hostname != MICROSOFT_HOST:
                        return False
                    callback = None
                    for form in forms:
                        action = form.get("action")
                        if not action:
                            continue
                        trace.record("oidc_form_post", "target_rejected")
                        destination = safe_url(action, current)
                        parsed = urllib.parse.urlsplit(destination)
                        # Entra's form_post response is the sole cross-origin POST.
                        if parsed.hostname != MOODLE_HOST or parsed.path.rstrip("/") not in {"/auth/oidc", "/auth/oidc/index.php"}:
                            continue
                        if form.get("method", "get").lower() != "post":
                            trace.record("oidc_form_post", "callback_method_invalid")
                            raise MoodleSessionError("unsupported_auth_flow")
                        tags = form.find_all("input")
                        if not tags or any(tag.get("type", "text").lower() not in {"hidden", "submit"} for tag in tags):
                            trace.record("oidc_form_post", "callback_controls_invalid")
                            raise MoodleSessionError("unsupported_auth_flow")
                        inputs = {tag.get("name"): tag.get("value", "") for tag in tags if tag.get("name") and tag.get("type", "text").lower() == "hidden"}
                        if (not inputs or len(inputs) > 8 or "state" not in inputs
                                or not ({"code", "id_token", "error"} & inputs.keys())
                                or set(inputs) - {"code", "id_token", "state", "session_state", "error", "error_description"}
                                or any(len(value) > 65536 for value in inputs.values())):
                            trace.record("oidc_form_post", "callback_fields_invalid")
                            raise MoodleSessionError("unsupported_auth_flow")
                        if "error" in inputs:
                            return False
                        if callback:
                            trace.record("oidc_form_post", "callback_ambiguous")
                            raise MoodleSessionError("unsupported_auth_flow")
                        callback = destination, inputs
                    if callback:
                        trace.record("oidc_form_post", "accepted")
                        response = secure_request(session, "POST", callback[0], data=callback[1], cookie=self._sso_cookie, deadline=deadline, diagnostics=trace, stage="moodle_callback")
                        continue
                    return False
                match = re.search(r'"urlPost"\s*:\s*("(?:[^"\\]|\\.)*")', response.text)
                if match:
                    trace.record("javascript_continuation", "target_rejected")
                    if urllib.parse.urlsplit(current).hostname != MICROSOFT_HOST:
                        raise MoodleSessionError("unsupported_auth_flow")
                    try:
                        destination = safe_url(json.loads(match.group(1)), current)
                    except (ValueError, TypeError):
                        raise MoodleSessionError("unsupported_auth_flow") from None
                    if urllib.parse.urlsplit(destination).hostname != MICROSOFT_HOST:
                        raise MoodleSessionError("unsupported_auth_flow")
                    response = secure_request(session, "GET", destination, cookie=self._sso_cookie, deadline=deadline, diagnostics=trace, stage="javascript_continuation")
                    continue
                return False
            trace.record("javascript_continuation", "transition_limit")
            raise MoodleSessionError("unsupported_auth_flow")
        except MoodleSessionError:
            session.close()
            raise
        except Exception:
            session.close()
            raise MoodleSessionError("connection_failed") from None
        finally:
            if self._session is None:
                session.close()

    def validate_sso_session(self) -> None:
        if not self._sso_cookie_login():
            raise MoodleSessionError("session_expired")

    def _form_login(self) -> bool:
        self._session, self._moodle_user_id = None, None
        if not self._username or not self._password:
            return False
        session = _requests_session()
        try:
            response = secure_request(session, "GET", LOGIN_URL)
            if urllib.parse.urlsplit(response.url).hostname != MOODLE_HOST:
                return False
            soup = _bs4_parse(response.text)
            token = soup.find("input", {"name": "logintoken"})
            payload = {"username": self._username, "password": self._password,
                       "logintoken": token.get("value", "") if token else "", "anchor": ""}
            response = secure_request(session, "POST", LOGIN_URL, data=payload)
            user_id = _authenticated_moodle_user_id(response.text, response.url)
            if not user_id:
                return False
            self._moodle_user_id, self._session = user_id, session
            return True
        finally:
            if self._session is None:
                session.close()

    def _moodle_get(self, url: str):
        if self._session is None:
            raise MoodleSessionError("session_expired")
        response = secure_request(self._session, "GET", url, moodle_only=True)
        if self._moodle_user_id and _authenticated_moodle_user_id(response.text, response.url) != self._moodle_user_id:
            raise MoodleSessionError("session_expired")
        return response

    def _scrape_enrolled_course_ids(self) -> list[tuple[int, str]]:
        """
        Parse the My Courses page to discover enrolled course IDs and titles.
        Returns list of (course_id, course_title).
        """
        r = self._moodle_get(MY_COURSES_URL)
        r.raise_for_status()
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
        self._enrolled_courses = deduped
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
        r = self._moodle_get(url)
        r.raise_for_status()
        soup = _bs4_parse(r.text)

        records = parse_report(soup, course_id, course_title)
        for record in records:
            record["record_type"] = classify_record_type(record["title"])
        return records

    def fetch_via_scrape(self) -> list[dict[str, Any]]:
        """Fetch grade records by HTML scraping after session login."""
        enrolled = self._scrape_enrolled_course_ids()
        if not enrolled:
            raise SyncError("No enrolled courses visible in HTML; refusing an unverified empty snapshot. Use a WS token if courses load dynamically.")
        all_records: list[dict[str, Any]] = []
        for cid, ctitle in enrolled:
            try:
                all_records.extend(self._scrape_grade_report(cid, ctitle))
            except MoodleSessionError:
                raise
            except Exception as exc:
                raise SyncError(
                    f"Incomplete Moodle snapshot: course {cid} failed: "
                    f"{_safe_grade_report_error(exc)}"
                ) from None
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
        self.is_mocked = False
        self._mock_reason = ""
        # Strategy 1: Web Services API token
        if self._ws_token:
            try:
                records = self.fetch_via_ws()
                logging.info("Moodle WS API: fetched %d grade records.", len(records))
                return records
            except SyncError as exc:
                logging.warning("Moodle WS API unavailable; trying session access (%s).", _safe_assignment_ws_error(exc))

        # Strategy 2: Microsoft SSO persistent-cookie login. Preferred over form
        # login for institutions (like AITU) that have no native Moodle password
        # at all — form login there produces a false-positive "success" with no
        # real session (see _form_login's userid check).
        if self._sso_cookie:
            self.validate_sso_session()
            return self._safe_html_grades()

        # Strategy 3: Form login + HTML scrape
        try:
            logged_in = self._form_login()
        except SyncError as exc:
            logged_in = False
            logging.warning("Moodle form login failed (%s).", _safe_grade_report_error(exc))
        if logged_in:
            return self._safe_html_grades()

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

    def _safe_html_grades(self) -> GradeSnapshot:
        try:
            return GradeSnapshot(self.fetch_via_scrape(), complete=False)
        except MoodleSessionError:
            raise
        except SyncError:
            self.unsupported_features.append("grade_html_incomplete")
            logging.warning("Moodle grade HTML unsupported or incomplete; existing grades are preserved.")
            return GradeSnapshot([], complete=False)

    def _scrape_activities(self) -> AssignmentSnapshot:
        enrolled = self._enrolled_courses or self._scrape_enrolled_course_ids()
        if not enrolled or len(enrolled) > 100:
            raise UnsupportedMoodlePage("course_inventory_unsupported")
        records: list[dict[str, Any]] = []
        identities: set[int] = set()
        verified_pages = 0
        now = datetime.now(timezone.utc)
        for cid, title in enrolled:
            response = self._moodle_get(f"{BASE_URL}/course/view.php?id={cid}")
            try:
                links = activity_links(_bs4_parse(response.text), cid)
            except UnsupportedMoodlePage as exc:
                self.unsupported_features.append(exc.code)
                continue
            if not links:
                verified_pages += 1
            for kind, cmid, url in links:
                if cmid in identities or len(identities) >= 500:
                    raise UnsupportedMoodlePage("activity_inventory_ambiguous")
                identities.add(cmid)
                response = self._moodle_get(url)
                parsed = urllib.parse.urlsplit(response.url)
                if parsed.path != f"/mod/{kind}/view.php" or urllib.parse.parse_qs(parsed.query).get("id") != [str(cmid)]:
                    raise UnsupportedMoodlePage("activity_identity_unsupported")
                try:
                    record = parse_activity(_bs4_parse(response.text), course_id=cid, course_title=title, cmid=cmid,
                                            module_type=kind, timezone_name=self._timezone_name, now=now)
                except UnsupportedMoodlePage as exc:
                    self.unsupported_features.append(exc.code)
                    continue
                records.append(record)
                verified_pages += 1
                self.unsupported_features.extend(record["parser_warnings"])
        self.unsupported_features.append("html_inventory_not_provably_complete")
        self.unsupported_features = sorted(set(self.unsupported_features))[:20]
        return AssignmentSnapshot(records, complete=False, verified_pages=verified_pages)

    def fetch_assignments(self) -> list[dict[str, Any]] | None:
        """WS is optional: authenticated HTML reads also discover ungraded activities."""
        if self.is_mocked:
            return None
        if self._ws_token:
            try:
                user_id = self._ws_get_userid()
                records = self._ws_get_assignments(self._ws_get_enrolled_courses(user_id))
                return AssignmentSnapshot(records, complete=True)
            except Exception as exc:
                logging.warning("mod_assign_get_assignments failed (%s); trying HTML access.", _safe_assignment_ws_error(exc))
        try:
            if self._session is None:
                if self._sso_cookie:
                    self.validate_sso_session()
                elif not self._form_login():
                    self.unsupported_features.append("session_html_unavailable")
                    return None
            return self._scrape_activities()
        except MoodleSessionError:
            raise
        except (SyncError, ValueError, KeyError):
            self.unsupported_features.append("activity_html_incomplete")
            logging.warning("Moodle activity HTML unsupported or incomplete; previous records are preserved.")
            return None


# ── Sync pipeline ─────────────────────────────────────────────────────────────
def _positive_moodle_id(value: Any) -> str | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return str(parsed) if parsed > 0 else None


def _grade_for_assignment(
    assignment: dict[str, Any], grades: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """Link only Moodle's module instance ID or course module ID."""
    matches: list[dict[str, Any]] = []
    for grade in grades:
        if str(grade.get("course_id")) != str(assignment["course_id"]):
            continue
        raw = grade.get("raw")
        if not isinstance(raw, dict):
            continue
        module_type = assignment.get("module_type", "assign")
        instance_match = (
            assignment.get("source") != "html"
            and raw.get("itemmodule") == module_type
            and _positive_moodle_id(raw.get("iteminstance")) == assignment["assignment_id"]
        )
        cmid_match = (
            raw.get("moodle_module") == module_type
            and assignment.get("cmid")
            and _positive_moodle_id(raw.get("moodle_cmid")) == assignment["cmid"]
        )
        if instance_match or cmid_match:
            matches.append(grade)
    return matches[0] if len(matches) == 1 else None


def _has_unique_scored_grade_title(
    assignment: dict[str, Any],
    grades: list[dict[str, Any]],
    assignment_title_counts: dict[tuple[str, str], int],
) -> bool:
    """Suppress a duplicate alert by title, without creating a grade relation."""
    key = (assignment["course_id"], normalize_title(assignment["title"]))
    if assignment_title_counts[key] != 1:
        return False
    candidates = []
    for grade in grades:
        if str(grade.get("course_id")) != key[0] or normalize_title(str(grade.get("title") or "")) != key[1]:
            continue
        raw = grade.get("raw") if isinstance(grade.get("raw"), dict) else {}
        if raw.get("itemmodule") not in (None, "", "assign"):
            continue
        if str(grade.get("record_type") or "assignment") != "assignment":
            continue
        candidates.append(grade)
    if len(candidates) != 1:
        return False
    raw = candidates[0].get("raw") if isinstance(candidates[0].get("raw"), dict) else {}
    # A different explicit module identity overrules a title coincidence.
    return (
        not _positive_moodle_id(raw.get("iteminstance"))
        and not _positive_moodle_id(raw.get("moodle_cmid"))
        and candidates[0].get("score") is not None
    )


def _assignment_baseline_at(db: SupabaseRestClient) -> datetime | None:
    """The first completed assignment snapshot, including an empty one."""
    rows = db.request("GET", "sync_runs", query={
        "select": "finished_at",
        "user_id": f"eq.{db.settings.user_id}",
        "source_key": "eq.university_platform",
        "status": "eq.success",
        "metadata_json->>moodle_assignments_synced": "eq.true",
        "order": "finished_at.asc",
        "limit": "1",
    }) or []
    return parse_datetime(rows[0].get("finished_at")) if rows else None


def _mark_missing_assignments(db: SupabaseRestClient, seen: set[str]) -> int:
    """Retire only Moodle assignment deadlines after a complete WS snapshot."""
    rows = db.request("GET", "source_events", query={
        "select": "id,external_id,status",
        "user_id": f"eq.{db.settings.user_id}",
        "source_key": "eq.university_platform",
        "event_type": "eq.task",
    }) or []
    missing = [row for row in rows
               if str(row.get("external_id") or "").startswith("assignment:moodle:")
               and row.get("status") != "missing" and row["external_id"] not in seen]
    for row in missing:
        db.request("PATCH", "source_events", query={
            "id": f"eq.{row['id']}", "user_id": f"eq.{db.settings.user_id}"},
            body={"status": "missing", "last_synced_at": utc_now()})
        db.cancel_future_reminders(str(row["id"]))
    return len(missing)


def sync_assignments(
    db: SupabaseRestClient,
    settings: Settings,
    assignments: list[dict[str, Any]],
    grades: list[dict[str, Any]],
    mode: str,
    baseline_at: datetime | None,
) -> SyncStats:
    """Persist deadlines and announce only post-baseline, still-relevant tasks."""
    if db.settings.user_id != settings.base.user_id:
        raise SyncError("Moodle assignment sync user scope mismatch")
    prepared: list[tuple[dict[str, Any], datetime | None, str]] = []
    seen: set[str] = set()
    title_counts: dict[tuple[str, str], int] = {}
    module_ids: set[tuple[str, str, str]] = set()
    for assignment in assignments:
        course_id = _positive_moodle_id(assignment.get("course_id"))
        assignment_id = _positive_moodle_id(assignment.get("assignment_id"))
        due_at = parse_datetime(str(assignment.get("due_at") or ""))
        title = str(assignment.get("title") or "").strip()
        html = assignment.get("source") == "html"
        if not course_id or not assignment_id or (not html and not due_at) or not title:
            raise SyncError("Invalid Moodle assignment deadline")
        record = {**assignment, "course_id": course_id, "assignment_id": assignment_id, "title": title}
        external_id = f"assignment:moodle:{course_id}:{assignment_id}"
        kind = assignment.get("module_type", "assign")
        cmid = _positive_moodle_id(assignment.get("cmid"))
        if html:
            if kind not in {"assign", "quiz"} or not cmid:
                raise SyncError("Invalid Moodle activity identity")
            external_id = f"activity:moodle:{course_id}:{kind}:{cmid}"
        if cmid:
            module_id = course_id, kind, cmid
            if module_id in module_ids:
                raise SyncError("Duplicate Moodle module identity in snapshot")
            module_ids.add(module_id)
            # Exact scoped lookup preserves identity across HTML/WS migration;
            # a bounded scan of the first N historical events could miss it.
            matches = db.request("GET", "source_events", query={
                "select": "external_id,raw_json,due_at,status", "user_id": f"eq.{db.settings.user_id}",
                "source_key": "eq.university_platform", "event_type": "eq.task",
                "raw_json->>moodle_course_id": f"eq.{course_id}",
                "raw_json->>moodle_cmid": f"eq.{cmid}", "limit": "2",
            }) or []
            previous = [row for row in matches if isinstance(row.get("raw_json"), dict)
                        and row["raw_json"].get("module_type", "assign") == kind
                        and str(row.get("external_id", "")).startswith(("assignment:moodle:", "activity:moodle:"))]
            if len(previous) > 1:
                raise SyncError("Ambiguous Moodle activity identity")
            if len(previous) == 1:
                external_id = previous[0]["external_id"]
                record["_previous_event"] = previous[0]
        if external_id in seen:
            raise SyncError("Duplicate Moodle assignment identity in snapshot")
        seen.add(external_id)
        prepared.append((record, due_at, external_id))
        key = (course_id, normalize_title(title))
        title_counts[key] = title_counts.get(key, 0) + 1

    stats = SyncStats(seen=len(prepared))
    for assignment, due_at, external_id in prepared:
        course_title = str(assignment.get("course_title") or "Курс Moodle").strip()
        grade = _grade_for_assignment(assignment, grades)
        graded = bool(grade and grade.get("score") is not None)
        submission_status = assignment.get("submission_status", "unknown")
        if submission_status not in {"not_submitted", "submitted", "graded", "overdue", "unknown"}:
            raise SyncError("Invalid Moodle submission state")
        if graded:
            submission_status = "graded"
        related_grade_id = (
            f"academic:moodle:{assignment['course_id']}:{grade['item_id']}" if grade else None
        )
        parser_warnings = set(assignment.get("parser_warnings", []))
        previous = assignment.get("_previous_event") or {}
        previous_raw = previous.get("raw_json") or {}
        retained_dates = {"opens_at": assignment.get("opens_at"), "closes_at": assignment.get("closes_at")}
        if not getattr(assignments, "complete", True):
            # A partial read supplies no evidence that known dates, links, or
            # completed work have ceased to exist. Keep the last verified data
            # and make its retention explicit to callers.
            if due_at is None:
                known_due = parse_datetime(str(previous.get("due_at") or ""))
                if known_due:
                    due_at = known_due
                    parser_warnings.add("previous_due_date_retained")
            for key in retained_dates:
                if retained_dates[key] is None:
                    known_date = parse_datetime(str(previous_raw.get(key) or ""))
                    if known_date:
                        retained_dates[key] = iso_utc(known_date)
                        parser_warnings.add(f"previous_{key}_retained")
            known_link = previous_raw.get("related_grade_external_id")
            if related_grade_id is None and isinstance(known_link, str) and re.fullmatch(
                    rf"academic:moodle:{assignment['course_id']}:[1-9]\d*", known_link):
                related_grade_id = known_link
                parser_warnings.add("grade_link_retained")
            if previous_raw.get("submission_status") == "graded" and submission_status != "graded":
                submission_status = "graded"
                parser_warnings.add("grade_status_retained")
            elif submission_status == "unknown" and previous_raw.get("submission_status") == "submitted":
                submission_status = "submitted"
                parser_warnings.add("submission_status_retained")
        terminal = graded or submission_status in {"submitted", "graded"}
        cmid = _positive_moodle_id(assignment.get("cmid"))
        event = {
            "source_key": "university_platform",
            "external_id": external_id,
            "event_type": "task",
            "title": assignment["title"],
            "description": f"Дедлайн задания по курсу «{course_title}»",
            "due_at": iso_utc(due_at) if due_at else None,
            "status": "completed" if terminal else "active",
            "source_url": f"{BASE_URL}/mod/{assignment.get('module_type', 'assign')}/view.php?id={cmid}" if cmid else None,
            "raw_json": {
                "moodle_course_id": assignment["course_id"],
                "moodle_assignment_id": assignment["assignment_id"],
                "moodle_cmid": cmid,
                "course_title": course_title,
                "related_grade_external_id": related_grade_id,
                "module_type": assignment.get("module_type", "assign"),
                "submission_status": submission_status,
                "assessment_type": assignment.get("assessment_type", "assignment"),
                **retained_dates,
                "parser_warnings": sorted(parser_warnings),
                "ingestion_complete": bool(getattr(assignments, "complete", True)),
            },
        }
        synced_event, created, reminder_stats = db.upsert_event(event, mode)
        stats.created += int(created)
        stats.updated += int(not created)
        stats.reminders_created += reminder_stats.created
        stats.reminders_updated += reminder_stats.updated
        stats.reminders_cancelled += reminder_stats.cancelled

        # An insert can succeed while the instant reminder fails. Retry for
        # every post-bootstrap event; the user-scoped dedup key prevents repeats.
        first_seen_at = parse_datetime(synced_event.get("created_at"))
        if (baseline_at and first_seen_at and first_seen_at > baseline_at
                and due_at and due_at > datetime.now(timezone.utc) and not terminal
                and not (grade is None and _has_unique_scored_grade_title(assignment, grades, title_counts))):
            local_due = due_at.astimezone(timezone_for(settings.base.timezone_name))
            message = (
                f"Новое задание по «{course_title}»: {assignment['title']}. "
                f"Дедлайн {local_due:%d.%m.%Y %H:%M} ({settings.base.timezone_name})."
            )
            if db.enqueue_instant_notification(synced_event, "assignment_added", message, mode):
                stats.reminders_created += 1

    if getattr(assignments, "complete", True):
        stats.missing = _mark_missing_assignments(db, seen)
    return stats


def sync_grades(
    db: SupabaseRestClient,
    settings: Settings,
    records: list[dict[str, Any]],
    mode: str,
    is_mocked: bool,
    run_id: str | None = None,
    assignments: list[dict[str, Any]] | None = None,
) -> SyncStats:
    """Write grades and, when WS is available, assignment deadlines."""
    if run_id is None:
        source = db.ensure_source("university_platform", "university", "University Platform")
        run_id = db.start_sync_run(source)
    stats = SyncStats(seen=len(records))

    try:
        if db.settings.user_id != settings.base.user_id:
            raise SyncError("Moodle sync user scope mismatch")
        notify_new_grades = not is_mocked and moodle_grade_notifications_enabled(db)
        seen_external_ids: set[str] = set()
        courses = load_courses(db) if records and not is_mocked else []
        unmatched: set[str] = set()

        for rec in records:
            namespace = "moodle_mock" if is_mocked else "moodle"
            external_id = f"academic:{namespace}:{rec['course_id']}:{rec['item_id']}"
            if external_id in seen_external_ids:
                raise SyncError("Duplicate Moodle grade identity in snapshot")
            seen_external_ids.add(external_id)

            course_title = rec.get("course_title", "Unknown Course")
            item_title = rec.get("title", "Grade Item")
            record_type = rec.get("record_type", "assignment")
            score = number(rec.get("score"))
            max_score = number(rec.get("max_score"))
            percentage = score / max_score * 100.0 if score is not None and max_score is not None and max_score > 0 else None
            rec = {**rec, "score": score, "max_score": max_score}

            raw_json: dict[str, Any] = dict(rec.get("raw") or rec)
            raw_json.update({"_is_mocked": is_mocked, "moodle_course_id": str(rec["course_id"]), "moodle_item_id": str(rec["item_id"])})
            if score is not None and not is_mocked:
                raw_json["_lifeos_grade_analysis"] = build_grade_analysis(score, max_score)

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
                    "select": "id,score,max_score,percentage,raw_json",
                    "user_id": f"eq.{db.settings.user_id}",
                    "source_event_id": f"eq.{source_event_id}",
                    "limit": "1",
                },
            )

            newly_graded = score is not None and (
                not existing or existing[0].get("score") is None
            )
            previous_raw = existing[0].get("raw_json") if existing else None
            retry_pending = isinstance(previous_raw, dict) and previous_raw.get("_grade_notification_pending") is True
            notify_grade = score is not None and (retry_pending or (notify_new_grades and newly_graded))
            academic_raw_json = dict(raw_json)
            if score is None and isinstance(previous_raw, dict):
                # Preserve an earlier explanation when Moodle hides the score.
                earlier_analysis = previous_raw.get("_lifeos_grade_analysis")
                if isinstance(earlier_analysis, dict):
                    academic_raw_json["_lifeos_grade_analysis"] = earlier_analysis
            if notify_grade:
                # The academic row is written before the reminder. If a later
                # write fails, the next sync can still retry the notification.
                academic_raw_json["_grade_notification_pending"] = True

            academic_payload: dict[str, Any] = {
                "user_id": settings.base.user_id,
                "source_event_id": source_event_id,
                "course_title": course_title,
                "record_type": record_type,
                "title": item_title,
                "score": score,
                "max_score": max_score,
                "percentage": round(percentage, 4) if percentage is not None else None,
                "raw_json": academic_raw_json,
            }
            if existing and score is None and existing[0].get("score") is not None:
                # A hidden/unavailable grade is unknown, not evidence that a
                # previously recorded numeric result should be erased.
                for key in ("score", "max_score", "percentage"):
                    academic_payload.pop(key, None)
                academic_raw_json["_grade_visibility_unknown"] = True
                academic_raw_json["_last_known_score"] = existing[0]["score"]
                if existing[0].get("max_score") is not None:
                    academic_raw_json["_last_known_max_score"] = existing[0]["max_score"]
                db.request("PATCH", "source_events", query={
                    "id": f"eq.{source_event_id}", "user_id": f"eq.{settings.base.user_id}"},
                    body={"raw_json": academic_raw_json})

            if existing:
                academic_record_id = str(existing[0]["id"])
                db.request(
                    "PATCH",
                    "academic_records",
                    query={"id": f"eq.{academic_record_id}", "user_id": f"eq.{settings.base.user_id}"},
                    body=academic_payload,
                )
            else:
                inserted = db.request(
                    "POST", "academic_records", query={"select": "id"},
                    body=academic_payload, prefer="return=representation",
                )
                if not inserted:
                    raise SyncError("Inserted academic record was not returned")
                academic_record_id = str(inserted[0]["id"])

            if not is_mocked:
                course = match_course(courses, settings.base.user_id, rec)
                if course:
                    sync_assessment(db, course, rec, external_id, raw_json)
                elif str(rec["course_id"]) not in unmatched:
                    unmatched.add(str(rec["course_id"]))
                    logging.warning("No unambiguous study course for moodle:%s (%s); grade retained in academic_records. Use link-course.", rec["course_id"], course_title)

            if notify_grade:
                stats.reminders_created += int(db.enqueue_instant_notification(
                    synced_event,
                    "academic_grade_posted",
                    grade_posted_message(course_title, item_title, score, max_score),
                    mode,
                ))
                db.request(
                    "PATCH", "academic_records",
                    query={
                        "id": f"eq.{academic_record_id}",
                        "user_id": f"eq.{settings.base.user_id}",
                        "source_event_id": f"eq.{source_event_id}",
                    },
                    body={"raw_json": raw_json},
                )

        if not is_mocked and getattr(records, "complete", True):
            stats.missing = mark_missing_grades(db, seen_external_ids, ("academic:moodle:", "academic:grade:"))
        if assignments is not None and not is_mocked:
            assignment_stats = sync_assignments(
                db, settings, assignments, records, mode, _assignment_baseline_at(db)
            )
            stats.seen += assignment_stats.seen
            stats.created += assignment_stats.created
            stats.updated += assignment_stats.updated
            stats.missing += assignment_stats.missing
            stats.reminders_created += assignment_stats.reminders_created
            stats.reminders_updated += assignment_stats.reminders_updated
            stats.reminders_cancelled += assignment_stats.reminders_cancelled
        metadata = {"moodle_grades_synced": bool(records) or bool(getattr(records, "complete", True)), "moodle_grade_inventory_complete": bool(getattr(records, "complete", True))} if not is_mocked else None
        if assignments is not None and not is_mocked:
            assert metadata is not None
            metadata["moodle_assignments_synced"] = getattr(assignments, "verified_pages", 1) > 0
            metadata["moodle_assignment_inventory_complete"] = bool(getattr(assignments, "complete", True))
        db.finish_sync_run(run_id, "success", stats, metadata=metadata)
        logging.info(
            "university_sync done seen=%d created=%d updated=%d missing=%d reminders_created=%d",
            stats.seen, stats.created, stats.updated, stats.missing, stats.reminders_created,
        )
        return stats

    except Exception as exc:
        db.finish_sync_run(run_id, "failed", stats, safe_sync_error(exc))
        raise


# ── Top-level commands ────────────────────────────────────────────────────────
def safe_sync_error(exc: Exception) -> str:
    category = getattr(exc, "category", None)
    return category if category in {"session_expired", "connection_failed", "unsupported_auth_flow"} else "sync_failed"


def sync_once(settings: Settings) -> SyncStats:
    moodle = MoodleClient(settings)
    db = SupabaseRestClient(settings.base)
    with LmsSyncLease(db, settings.base.user_id, "aitu_moodle") as lease:
        if not lease.acquired:
            return SyncStats()
        guard_lms_client(db, lease)
        source = db.ensure_source("university_platform", "university", "University Platform")
        run_id = db.start_sync_run(source)
        try:
            records = moodle.fetch_grades()
            assignments = moodle.fetch_assignments()
            mode = db.get_reminder_mode()
            lease.assert_held()
        except Exception as exc:
            db.finish_sync_run(run_id, "failed", SyncStats(), safe_sync_error(exc))
            raise
        finally:
            moodle.close()
        persistence_settings = replace(settings, username="", password="", ws_token=None, sso_cookie=None)
        return sync_grades(db, persistence_settings, records, mode, moodle.is_mocked,
                           run_id=run_id, assignments=assignments)


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
            logging.error("university_sync iteration failed (%s)", safe_sync_error(exc))
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
    parser.add_argument("command", choices=("status", "sync-once", "run-loop", "list-courses", "link-course"))
    parser.add_argument("--moodle-course-id", type=int)
    parser.add_argument("--course-code")
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
        if args.command == "list-courses":
            print(json.dumps(load_courses(SupabaseRestClient(settings.base)), ensure_ascii=False, indent=2))
        elif args.command == "link-course":
            if args.moodle_course_id is None or not args.course_code:
                raise SyncError("link-course requires --moodle-course-id and --course-code")
            link_course(SupabaseRestClient(settings.base), args.moodle_course_id, args.course_code)
        elif args.command == "status":
            status_cmd(settings)
        elif args.command == "sync-once":
            stats = sync_once(settings)
            print(json.dumps(vars(stats), indent=2))
        else:
            run_loop(settings)
        return 0
    except (SyncError, OSError, ValueError) as exc:
        logging.error("%s", safe_sync_error(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
