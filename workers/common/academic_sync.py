"""User-scoped Moodle course matching and assessment persistence.

Only LMS-owned fields are updated. Syllabus weights, due dates and notes are
never inferred from the grade report or overwritten by a periodic sync.
"""
from __future__ import annotations

import logging
from typing import Any

from common.lifeos_sync import SupabaseRestClient, SyncError, utc_now
from common.moodle_grades import normalize_title


def load_courses(db: SupabaseRestClient) -> list[dict[str, Any]]:
    return db.request("GET", "study_courses", query={
        "select": "id,user_id,code,title,status,external_course_key",
        "user_id": f"eq.{db.settings.user_id}",
    }) or []


def match_course(courses: list[dict[str, Any]], user_id: str, record: dict[str, Any]) -> dict[str, Any] | None:
    owned = [course for course in courses if course["user_id"] == user_id]
    key = f"moodle:{record['course_id']}"
    explicit = [course for course in owned if course.get("external_course_key") == key]
    if len(explicit) == 1:
        return explicit[0]
    # No fuzzy matching or translation: repeated/ambiguous titles need an explicit link.
    title = normalize_title(record["course_title"])
    exact = [course for course in owned if not course.get("external_course_key")
             and course.get("status") == "active" and normalize_title(course["title"]) == title]
    if not explicit and len(exact) == 1:
        return exact[0]
    return None


def sync_assessment(db: SupabaseRestClient, course: dict[str, Any], record: dict[str, Any], external_id: str, raw_json: dict[str, Any]) -> None:
    if course["user_id"] != db.settings.user_id:
        raise SyncError("Cannot sync an assessment belonging to another user")
    query = {"study_course_id": f"eq.{course['id']}", "external_id": f"eq.{external_id}"}
    existing = db.request("GET", "assessment_items", query={**query, "select": "id,source,status"}) or []
    if len(existing) > 1:
        raise SyncError("Duplicate external assessment identity")
    if existing and existing[0]["source"] != "aitu_moodle":
        raise SyncError("Refusing to overwrite a non-Moodle assessment")
    payload = {
        "title": record["title"], "assessment_type": record["record_type"],
        "actual_score": record["score"], "max_score": record["max_score"],
        "raw_json": raw_json,
    }
    if record["score"] is not None:
        payload["status"] = "graded"
    elif not existing or existing[0]["status"] == "graded":
        payload["status"] = "pending"
    if existing:
        db.request("PATCH", "assessment_items", query={**query, "id": f"eq.{existing[0]['id']}"}, body=payload)
    else:
        payload.update({"study_course_id": course["id"], "external_id": external_id, "source": "aitu_moodle"})
        try:
            db.request("POST", "assessment_items", body=payload)
        except SyncError as exc:
            # The existing partial unique index handles concurrent worker inserts.
            # On a unique violation, re-read and take the normal guarded update path.
            if "23505" not in str(exc):
                raise
            raced = db.request("GET", "assessment_items", query={**query, "select": "id"})
            if not raced:
                raise
            sync_assessment(db, course, record, external_id, raw_json)


def mark_missing_grades(db: SupabaseRestClient, seen: set[str], prefixes: tuple[str, ...]) -> int:
    """Retire only this platform's grades; never cancel another source's events."""
    rows = db.request("GET", "source_events", query={
        "select": "id,external_id", "user_id": f"eq.{db.settings.user_id}",
        "source_key": "eq.university_platform", "event_type": "eq.academic_grade", "status": "eq.active",
    }) or []
    missing = [row for row in rows if str(row.get("external_id", "")).startswith(prefixes)
               and row["external_id"] not in seen]
    for row in missing:
        db.request("PATCH", "source_events", query={"id": f"eq.{row['id']}", "user_id": f"eq.{db.settings.user_id}"},
                   body={"status": "missing", "last_synced_at": utc_now()})
        db.cancel_future_reminders(row["id"])
    return len(missing)


def link_course(db: SupabaseRestClient, moodle_course_id: int, course_code: str) -> None:
    if moodle_course_id <= 0:
        raise SyncError("Moodle course id must be positive")
    courses = load_courses(db)
    candidates = [course for course in courses if course["user_id"] == db.settings.user_id
                  and course["code"] == course_code and course["status"] == "active"]
    if len(candidates) != 1:
        raise SyncError("Course code must identify exactly one active course belonging to this user")
    course = candidates[0]
    key = f"moodle:{moodle_course_id}"
    if course.get("external_course_key") not in (None, "", key):
        raise SyncError("Course already has a different external link; review it before changing")
    if any(item["id"] != course["id"] and item.get("external_course_key") == key for item in courses):
        raise SyncError("This Moodle course is already linked to another study course")
    db.request("PATCH", "study_courses", query={"id": f"eq.{course['id']}", "user_id": f"eq.{db.settings.user_id}"},
               body={"external_course_key": key})
    logging.info("Linked %s to %s", course_code, key)
