#!/usr/bin/env python3
"""Import the supplied AITU HTML timetable and calculator; dry-run by default.

HTML and embedded scripts are parsed as text and never executed. Database access
uses the university worker's environment and its explicit single-user guard.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
import math
from pathlib import Path
import re
import sys
from typing import Any

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "workers"))
from common.lifeos_sync import SupabaseRestClient, SyncError, load_base_settings


PROFILE_KEY = "study_calculator_v1"
COURSES = {
    "os": ("OS52-EN", "OS 2207"),
    "dms": ("DMS52-EN", "SUBD 2217"),
    "krl": ("K(RUSSIAN)L51-RU", "RL 2202"),
    "cnc": ("CNC53-EN", "CNC 2305"),
    "dld": ("DLD52-EN", "DLD 2201"),
}
DAYS = {
    "Понедельник": "monday", "Вторник": "tuesday", "Среда": "wednesday",
    "Четверг": "thursday", "Пятница": "friday", "Суббота": "saturday", "Воскресенье": "sunday",
}
SESSION_TYPES = {"Лекция": "lecture", "Практика": "practical", "Лабораторная": "lab"}
# These identify only the two obsolete slots from the existing repository seed.
# Unknown extra rows stop the import; the importer never deletes timetable rows.
KNOWN_MOVES = {
    "CNC53-EN": ("saturday", "18:00", "friday", "14:00", "C1.2.243K", "Досумбеков"),
    "OS52-EN": ("saturday", "17:00", "thursday", "17:00", "C1.1.244K", "Сейлханова"),
}


class StudyImportError(ValueError):
    """Expected error containing no credentials or raw remote error bodies."""


def percent(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 100


def text(tag: Any) -> str:
    return " ".join(tag.get_text(" ", strip=True).split())


def parse_terms(script: str, variable: str) -> list[tuple[str, float]]:
    expressions = re.findall(r"\bconst\s+" + re.escape(variable) + r"\s*=\s*([^;]+);", script)
    if len(expressions) != 1:
        raise StudyImportError(f"Missing or ambiguous calculator formula: {variable}")
    # Accept only a sum of literal getVal('field') * coefficient terms. Never eval JS.
    term_pattern = r"\(\s*getVal\(\s*['\"]([a-z0-9-]+)['\"]\s*\)\s*\*\s*(\d+(?:\.\d+)?)\s*\)"
    expression = expressions[0]
    matches = list(re.finditer(term_pattern, expression))
    residue = re.sub(term_pattern, "TERM", expression)
    if not matches or not re.fullmatch(r"\s*TERM(?:\s*\+\s*TERM)*\s*", residue):
        raise StudyImportError(f"Unsupported calculator formula: {variable}")
    terms = [(match[1], round(float(match[2]) * 100, 8)) for match in matches]
    if len({field for field, _weight in terms}) != len(terms) or any(weight <= 0 or weight > 100 for _, weight in terms):
        raise StudyImportError(f"Invalid calculator weights: {variable}")
    if abs(sum(weight for _, weight in terms) - 100) > 1e-7:
        raise StudyImportError(f"Calculator period weights must total 100: {variable}")
    return terms


def parse_dashboard(html: str, source_name: str) -> dict[str, dict[str, Any]]:
    if not source_name.strip() or len(source_name) > 200:
        raise StudyImportError("The HTML filename must contain 1–200 characters")
    soup = BeautifulSoup(html, "html.parser")
    script = "\n".join(tag.get_text() for tag in soup.find_all("script"))
    final_formulas = re.findall(r"\bconst\s+finalScore\s*=\s*([^;]+);", script)
    if len(final_formulas) != 1 or not re.fullmatch(
        r"\s*\(att1\s*\*\s*0\.3\)\s*\+\s*\(att2\s*\*\s*0\.3\)\s*\+\s*\(exam\s*\*\s*0\.4\)\s*",
        final_formulas[0],
    ):
        raise StudyImportError("Only the supplied 30% / 30% / 40% final formula is supported")
    thresholds = re.findall(r"att1\s*<\s*(\d+(?:\.\d+)?)\s*\|\|\s*att2\s*<\s*(\d+(?:\.\d+)?)", script)
    if not thresholds or len({float(a) for a, _ in thresholds} | {float(b) for _, b in thresholds}) != 1:
        raise StudyImportError("Missing or inconsistent attestation threshold")
    threshold = float(thresholds[0][0])
    if not percent(threshold):
        raise StudyImportError("Attestation threshold must be between 0 and 100")

    inputs: dict[str, Any] = {}
    for tag in soup.select('input[type="number"]'):
        field_id = tag.get("id", "")
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", field_id) or field_id in inputs:
            raise StudyImportError("Missing or duplicate calculator field identifier")
        inputs[field_id] = tag
    result: dict[str, dict[str, Any]] = {}
    used_fields: set[str] = set()
    for prefix, (code, _display_code) in COURSES.items():
        fields: list[dict[str, Any]] = []
        for period, variable in (("att1", prefix + "Att1"), ("att2", prefix + "Att2")):
            for field_id, weight in parse_terms(script, variable):
                if field_id not in inputs or not field_id.startswith(prefix + "-") or field_id in used_fields:
                    raise StudyImportError(f"Invalid or repeated field in {code}")
                tag = inputs[field_id]
                row = tag.find_parent("tr")
                cells = row.find_all("td", recursive=False) if row else []
                if not cells:
                    raise StudyImportError(f"Missing field label in {code}")
                if prefix in {"cnc", "dld"}:
                    label = "Практики / лабораторные" if field_id.endswith(("-p1", "-p2")) else ("Midterm Exam" if period == "att1" else "Endterm Exam")
                else:
                    label = text(cells[0])
                if not label or len(label) > 300:
                    raise StudyImportError(f"Invalid calculator label in {code}")
                fields.append({"id": field_id, "label": label, "period": period, "weightPercent": weight})
                used_fields.add(field_id)
        exam_id = prefix + "-exam"
        if exam_id not in inputs or exam_id in used_fields:
            raise StudyImportError(f"Missing final exam field in {code}")
        fields.append({"id": exam_id, "label": "Экзамен", "period": "exam", "weightPercent": 100})
        used_fields.add(exam_id)
        result[code] = {
            "definition": {"version": 1, "sourceName": source_name, "attestationThreshold": threshold, "fields": fields},
            "schedules": [],
        }
    if used_fields != set(inputs) or len(used_fields) != 37:
        raise StudyImportError("Expected exactly the supplied 37 calculator fields across five courses")

    timetable_candidates = [table for table in soup.find_all("table") if table.select("tr.day-header")]
    if len(timetable_candidates) != 1:
        raise StudyImportError("Expected exactly one weekly timetable")
    course_codes = {display: code for code, display in COURSES.values()}
    day: str | None = None
    identities: set[tuple[str, str, str]] = set()
    for row in timetable_candidates[0].find_all("tr"):
        if "day-header" in row.get("class", []):
            day = DAYS.get(text(row))
            if day is None:
                raise StudyImportError("Unknown day in timetable")
            continue
        cells = row.find_all("td", recursive=False)
        if not cells:
            continue
        if day is None or len(cells) != 6:
            raise StudyImportError("Timetable row must have day, time, course, type, instructor and room")
        badge = cells[2].select_one(".badge")
        code = course_codes.get(text(badge)) if badge else None
        if code is None:
            raise StudyImportError("Unknown timetable course code")
        times = re.fullmatch(r"(\d{2}:\d{2})\s*[–—-]\s*(\d{2}:\d{2})", text(cells[1]))
        if not times or any(not valid_time(value) for value in times.groups()) or times[1] >= times[2]:
            raise StudyImportError(f"Invalid timetable time in {code}")
        identity = (code, day, times[1])
        if identity in identities:
            raise StudyImportError(f"Duplicate timetable slot in {code}")
        identities.add(identity)
        session_type = SESSION_TYPES.get(text(cells[3]))
        if session_type is None:
            raise StudyImportError(f"Unknown timetable session type in {code}")
        instructor, room = text(cells[4]), text(cells[5])
        if not instructor or not room or len(instructor) > 200 or len(room) > 200:
            raise StudyImportError(f"Missing or too long instructor/room in {code}")
        result[code]["schedules"].append({
            "day_of_week": day, "start_time": times[1], "end_time": times[2],
            "session_type": session_type, "instructor_name": instructor, "room": room,
        })
    if any(len(course["schedules"]) != 5 for course in result.values()):
        raise StudyImportError("Expected five timetable slots for each course (25 total)")
    return result


def valid_time(value: str) -> bool:
    return bool(re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value))


def normalized_schedule(row: dict[str, Any]) -> dict[str, Any]:
    return {
        key: (str(row.get(key, ""))[:5] if key in {"start_time", "end_time"} else row.get(key))
        for key in ("day_of_week", "start_time", "end_time", "session_type", "instructor_name", "room")
    }


def is_known_old_slot(code: str, row: dict[str, Any], desired: dict[str, Any]) -> bool:
    move = KNOWN_MOVES.get(code)
    if not move:
        return False
    old_day, old_time, new_day, new_time, room, teacher = move
    current = normalized_schedule(row)
    return (
        current["day_of_week"] == old_day and current["start_time"] == old_time
        and current["end_time"] == old_time[:3] + "50" and current["session_type"] == "practical"
        and (current["room"] == room or str(current["room"]).startswith(room + " ("))
        and (current["instructor_name"] == teacher or str(current["instructor_name"]).startswith(teacher + " "))
        and desired["day_of_week"] == new_day and desired["start_time"] == new_time
    )


def new_metadata(course: dict[str, Any], definition: dict[str, Any]) -> dict[str, Any]:
    metadata = deepcopy(course.get("metadata"))
    if metadata is None:
        metadata = {}
    if not isinstance(metadata, dict):
        raise StudyImportError(f"Course metadata is not an object: {course['code']}")
    old = metadata.get(PROFILE_KEY)
    values: dict[str, Any] = {}
    target: float = 70
    if old is not None:
        if not isinstance(old, dict) or not isinstance(old.get("values"), dict) or not percent(old.get("target")):
            raise StudyImportError(f"Existing calculator profile is invalid: {course['code']}")
        values = deepcopy(old["values"])
        ids = {field["id"] for field in definition["fields"]}
        if any(key not in ids or (value is not None and not percent(value)) for key, value in values.items()):
            raise StudyImportError(f"Existing calculator values do not match the import: {course['code']}")
        target = old["target"]
    metadata[PROFILE_KEY] = {"definition": definition, "values": values, "target": target}
    return metadata


def build_plan(db: Any, imported: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Read and validate all five courses and all slots before returning any writes."""
    user_id = db.settings.user_id
    courses = db.request("GET", "study_courses", query={
        "select": "id,user_id,code,status,metadata,external_course_key", "user_id": f"eq.{user_id}",
    }) or []
    if any(course.get("user_id") != user_id for course in courses):
        raise StudyImportError("Study course ownership check failed")
    plan: list[dict[str, Any]] = []
    for code, data in imported.items():
        candidates = [course for course in courses if course.get("code") == code and course.get("status") == "active"]
        if len(candidates) != 1:
            raise StudyImportError(f"Expected exactly one active course owned by this user: {code}")
        course = candidates[0]
        rows = db.request("GET", "course_schedules", query={"select": "*", "study_course_id": f"eq.{course['id']}"}) or []
        if any(row.get("study_course_id") != course["id"] for row in rows):
            raise StudyImportError(f"Timetable ownership check failed: {code}")
        if len({row["id"] for row in rows}) != len(rows):
            raise StudyImportError(f"Duplicate timetable identifiers: {code}")
        old_metadata = deepcopy(course.get("metadata"))
        metadata = new_metadata(course, data["definition"])
        used: set[str] = set()
        operations: list[dict[str, Any]] = []
        for desired in data["schedules"]:
            matches = [row for row in rows if normalized_schedule(row)["day_of_week"] == desired["day_of_week"]
                       and normalized_schedule(row)["start_time"] == desired["start_time"]]
            if not matches:
                matches = [row for row in rows if is_known_old_slot(code, row, desired)]
            if len(matches) > 1:
                raise StudyImportError(f"Ambiguous timetable slot: {code} {desired['day_of_week']} {desired['start_time']}")
            if matches:
                current = matches[0]
                if current["id"] in used or current.get("session_type") != desired["session_type"]:
                    raise StudyImportError(f"Conflicting timetable slot: {code} {desired['day_of_week']} {desired['start_time']}")
                used.add(current["id"])
                if normalized_schedule(current) != desired:
                    operations.append({"method": "PATCH", "id": current["id"], "old": current, "body": desired})
            else:
                operations.append({"method": "POST", "body": desired})
        extras = [row for row in rows if row["id"] not in used]
        if extras:
            raise StudyImportError(f"Unexpected extra timetable slots for {code}: {len(extras)}. Nothing written; review these slots before importing")
        plan.append({
            "course": course, "old_metadata": old_metadata, "metadata": metadata,
            "profile_changed": old_metadata != metadata, "operations": operations,
        })
    return plan


def apply_plan(db: Any, plan: list[dict[str, Any]]) -> None:
    user_id = db.settings.user_id
    if any(item["course"]["user_id"] != user_id for item in plan):
        raise StudyImportError("Import plan belongs to another user")
    for item in plan:
        course = item["course"]
        if item["profile_changed"]:
            old = item["old_metadata"]
            query = {"id": f"eq.{course['id']}", "user_id": f"eq.{user_id}", "status": "eq.active",
                     "metadata": "is.null" if old is None else "eq." + json.dumps(old, ensure_ascii=False, separators=(",", ":")), "select": "id"}
            updated = db.request("PATCH", "study_courses", query=query, body={"metadata": item["metadata"]}, prefer="return=representation")
            if not updated or len(updated) != 1:
                raise StudyImportError(f"Course changed during import: {course['code']}. Rerun to preserve the latest saved values")
        for operation in item["operations"]:
            body = {**operation["body"], "study_course_id": course["id"]}
            if operation["method"] == "PATCH":
                query = {"id": f"eq.{operation['id']}", "study_course_id": f"eq.{course['id']}", "select": "id"}
                if operation["old"].get("updated_at"):
                    query["updated_at"] = f"eq.{operation['old']['updated_at']}"
                updated = db.request("PATCH", "course_schedules", query=query, body=body, prefer="return=representation")
                if not updated or len(updated) != 1:
                    raise StudyImportError(f"Timetable changed during import: {course['code']}. Rerun to review current rows")
            else:
                db.request("POST", "course_schedules", body=body)


def summary(plan: list[dict[str, Any]], apply: bool) -> dict[str, Any]:
    return {"mode": "applied" if apply else "dry_run", "schedule_slots": 25, "courses": [{
        "code": item["course"]["code"], "calculator_changed": item["profile_changed"],
        "slots_created": sum(operation["method"] == "POST" for operation in item["operations"]),
        "slots_updated": sum(operation["method"] == "PATCH" for operation in item["operations"]),
    } for item in plan]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html", type=Path, required=True, help="Path to the supplied расписание.html")
    parser.add_argument("--env-file", type=Path, default=ROOT / "workers/university-sync/aitu-parser/.env")
    parser.add_argument("--apply", action="store_true", help="Write the fully validated import plan; default only previews")
    args = parser.parse_args()
    try:
        if args.html.stat().st_size > 2 * 1024 * 1024:
            raise StudyImportError("HTML input exceeds 2 MiB")
        imported = parse_dashboard(args.html.read_text(encoding="utf-8"), args.html.name)
        settings = load_base_settings(
            env_file=args.env_file, legacy_guard_env="LIFEOS_ENABLE_LEGACY_SINGLE_USER_UNIVERSITY_SYNC",
            worker_name="Study dashboard import",
        )
        db = SupabaseRestClient(settings)
        plan = build_plan(db, imported)
        if args.apply:
            apply_plan(db, plan)
        print(json.dumps(summary(plan, args.apply), ensure_ascii=False, indent=2))
        return 0
    except StudyImportError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
    except (OSError, UnicodeError):
        print("ERROR: Cannot read the supplied HTML file", file=sys.stderr)
    except SyncError as exc:
        # Configuration errors are safe; suppress arbitrary Supabase error bodies.
        message = str(exc)
        if message.startswith(("Missing required environment variable:", "Study dashboard import is still legacy")):
            print(f"ERROR: {message}", file=sys.stderr)
        else:
            print("ERROR: Supabase import request failed; rerun the dry-run to inspect current state", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
