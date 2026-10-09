#!/usr/bin/env python3
"""Import supplied HTML timetable and inactive review candidates; dry-run by default.

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
def load_mapping(path: Path) -> dict[str, tuple[str, str]]:
    config = json.loads(path.read_text(encoding="utf-8"))
    rows = config.get("courses") if isinstance(config, dict) else None
    if not isinstance(rows, dict) or not rows:
        raise ValueError("Mapping must contain a nonempty courses object")
    result = {}
    for prefix, row in rows.items():
        if not re.fullmatch(r"[a-z0-9]+", prefix) or not isinstance(row, dict):
            raise ValueError("Invalid course mapping")
        code, display = row.get("code"), row.get("displayCode")
        if any(not isinstance(value, str) or not value.strip() or len(value) > 100 for value in (code, display)):
            raise ValueError("Invalid course mapping labels")
        result[prefix] = (code, display)
    if len({row[0] for row in result.values()}) != len(result) or len({row[1] for row in result.values()}) != len(result):
        raise ValueError("Ambiguous course mapping")
    return result


# Offline operator data; no subject names, formulas, teachers or rooms in code.
COURSES = load_mapping(ROOT / "docs/syllabi/legacy-dashboard-import.json")

DAYS = {
    "Понедельник": "monday", "Вторник": "tuesday", "Среда": "wednesday",
    "Четверг": "thursday", "Пятница": "friday", "Суббота": "saturday", "Воскресенье": "sunday",
}
SESSION_TYPES = {"Лекция": "lecture", "Практика": "practical", "Лабораторная": "lab"}
# Compatibility name: no timetable corrections are ever enabled implicitly.
KNOWN_MOVES: dict[str, Any] = {}


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


def parse_dashboard(html: str, source_name: str, mapping: dict[str, tuple[str, str]] | None = None) -> dict[str, dict[str, Any]]:
    if not source_name.strip() or len(source_name) > 200:
        raise StudyImportError("The HTML filename must contain 1–200 characters")
    mapping = mapping or COURSES
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
    prefixes = set(re.findall(r"\bconst\s+([a-z0-9]+)Att1\s*=", script))
    if not prefixes or not prefixes.issubset(mapping):
        raise StudyImportError("Calculator prefixes need an explicit course mapping")
    for prefix in sorted(prefixes):
        code, _display_code = mapping[prefix]
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
            "definition": {"version": 1, "sourceName": source_name, "attestationThreshold": threshold,
                           "topLevelWeights": {"att1": 30, "att2": 30, "exam": 40},
                           "verification": "needs_review", "fields": [{**field, "verification": "needs_review"} for field in fields]},
            "schedules": [],
        }
    if used_fields != set(inputs):
        raise StudyImportError("Unmatched calculator fields; review the mapping")

    timetable_candidates = [table for table in soup.find_all("table") if table.select("tr.day-header")]
    if len(timetable_candidates) != 1:
        raise StudyImportError("Expected exactly one weekly timetable")
    course_codes = {mapping[prefix][1]: mapping[prefix][0] for prefix in prefixes}
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
    if any(not course["schedules"] for course in result.values()):
        raise StudyImportError("Each imported course must have at least one timetable slot")
    return result


def valid_time(value: str) -> bool:
    return bool(re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value))


def normalized_schedule(row: dict[str, Any]) -> dict[str, Any]:
    return {
        key: (str(row.get(key, ""))[:5] if key in {"start_time", "end_time"} else row.get(key))
        for key in ("day_of_week", "start_time", "end_time", "session_type", "instructor_name", "room")
    }


def is_known_old_slot(code: str, row: dict[str, Any], desired: dict[str, Any], corrections: dict[str, Any] | None = None) -> bool:
    """Only exact before/after rows in an explicitly supplied correction file may change."""
    for correction in (corrections or {}).get(code, []):
        if normalized_schedule(row) == correction["from"] and desired == correction["to"]:
            return True
    return False


def load_corrections(path: Path) -> dict[str, Any]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(rows, dict):
        raise StudyImportError("Corrections must be a course-code object")
    for code, corrections in rows.items():
        if not isinstance(code, str) or not isinstance(corrections, list):
            raise StudyImportError("Invalid correction mapping")
        for correction in corrections:
            if not isinstance(correction, dict) or set(correction) != {"from", "to"}:
                raise StudyImportError("Corrections need exact from/to rows")
            for row in correction.values():
                if not isinstance(row, dict) or set(row) != set(normalized_schedule({})):
                    raise StudyImportError("Correction rows need all schedule fields")
                if not valid_time(str(row["start_time"])) or not valid_time(str(row["end_time"])) or row["start_time"] >= row["end_time"]:
                    raise StudyImportError("Invalid correction time")
    return rows


def new_metadata(course: dict[str, Any], definition: dict[str, Any]) -> dict[str, Any] | None:
    """Existing custom calculators and unrelated metadata are always preserved verbatim."""
    return deepcopy(course.get("metadata"))


def build_plan(db: Any, imported: dict[str, dict[str, Any]], corrections: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Read and validate owned courses, inactive candidates and all slots before writes."""
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
        schemes = db.request("GET", "grading_schemes", query={
            "select": "id,definition,version", "user_id": f"eq.{user_id}", "study_course_id": f"eq.{course['id']}",
        }) or []
        candidate_exists = any(scheme.get("definition") == data["definition"] for scheme in schemes)
        used: set[str] = set()
        operations: list[dict[str, Any]] = []
        for desired in data["schedules"]:
            matches = [row for row in rows if normalized_schedule(row)["day_of_week"] == desired["day_of_week"]
                       and normalized_schedule(row)["start_time"] == desired["start_time"]]
            if not matches:
                matches = [row for row in rows if is_known_old_slot(code, row, desired, corrections)]
            if len(matches) > 1:
                raise StudyImportError(f"Ambiguous timetable slot: {code} {desired['day_of_week']} {desired['start_time']}")
            if matches:
                current = matches[0]
                if current["id"] in used or current.get("session_type") != desired["session_type"]:
                    raise StudyImportError(f"Conflicting timetable slot: {code} {desired['day_of_week']} {desired['start_time']}")
                used.add(current["id"])
                if normalized_schedule(current) != desired:
                    if not is_known_old_slot(code, current, desired, corrections):
                        raise StudyImportError(f"Existing timetable differs for {code}; provide explicit --corrections from/to rows. Nothing written")
                    operations.append({"method": "PATCH", "id": current["id"], "old": current, "body": desired})
            else:
                operations.append({"method": "POST", "body": desired})
        extras = [row for row in rows if row["id"] not in used]
        if extras:
            raise StudyImportError(f"Unexpected extra timetable slots for {code}: {len(extras)}. Nothing written; review these slots before importing")
        plan.append({
            "course": course, "old_metadata": old_metadata, "metadata": metadata,
            "profile_changed": False, "operations": operations,
            "definition": data["definition"], "candidate_created": not candidate_exists,
            "candidate_version": max((int(scheme["version"]) for scheme in schemes), default=0) + 1,
            "schedule_slots": len(data["schedules"]),
        })
    return plan


def apply_plan(db: Any, plan: list[dict[str, Any]]) -> None:
    user_id = db.settings.user_id
    if any(item["course"]["user_id"] != user_id for item in plan):
        raise StudyImportError("Import plan belongs to another user")
    for item in plan:
        course = item["course"]
        if item["candidate_created"]:
            db.request("POST", "grading_schemes", body={
                "user_id": user_id, "study_course_id": course["id"],
                "definition": item["definition"], "version": item["candidate_version"],
                "verification": "needs_review", "is_active": False,
            })
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
    return {"mode": "applied" if apply else "dry_run", "schedule_slots": sum(item["schedule_slots"] for item in plan), "courses": [{
        "code": item["course"]["code"], "calculator_changed": False, "needs_review_candidate_created": item["candidate_created"],
        "slots_created": sum(operation["method"] == "POST" for operation in item["operations"]),
        "slots_updated": sum(operation["method"] == "PATCH" for operation in item["operations"]),
    } for item in plan]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html", type=Path, required=True, help="Path to the supplied расписание.html")
    parser.add_argument("--env-file", type=Path, default=ROOT / "workers/university-sync/aitu-parser/.env")
    parser.add_argument("--mapping", type=Path, default=ROOT / "docs/syllabi/legacy-dashboard-import.json", help="Offline prefix/course/display-code mapping")
    parser.add_argument("--corrections", type=Path, help="Explicit exact before/after timetable corrections; none by default")
    parser.add_argument("--apply", action="store_true", help="Write the fully validated import plan; default only previews")
    args = parser.parse_args()
    try:
        if args.html.stat().st_size > 2 * 1024 * 1024:
            raise StudyImportError("HTML input exceeds 2 MiB")
        imported = parse_dashboard(args.html.read_text(encoding="utf-8"), args.html.name, load_mapping(args.mapping))
        settings = load_base_settings(
            env_file=args.env_file, legacy_guard_env="LIFEOS_ENABLE_LEGACY_SINGLE_USER_UNIVERSITY_SYNC",
            worker_name="Study dashboard import",
        )
        db = SupabaseRestClient(settings)
        plan = build_plan(db, imported, load_corrections(args.corrections) if args.corrections else None)
        if args.apply:
            apply_plan(db, plan)
        print(json.dumps(summary(plan, args.apply), ensure_ascii=False, indent=2))
        return 0
    except (StudyImportError, ValueError) as exc:
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
