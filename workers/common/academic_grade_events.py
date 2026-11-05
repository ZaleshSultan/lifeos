"""Verified item observations; transport failures are never invented snapshots."""
from __future__ import annotations

import math
import os
import re
from typing import Any

from common.lifeos_sync import SyncError

ID = re.compile(r"[1-9]\d{0,15}")
ITEM = re.compile(r"(?:[1-9]\d{0,15}|mod-[a-z][a-z0-9_]*-[1-9]\d{0,15})")


def grade_events_enabled() -> bool:
    return os.environ.get("LIFEOS_ACADEMIC_GRADE_EVENTS_ENABLED", "false").strip().lower() == "true"


def verified_grade_snapshot(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(records) > 2000:
        raise SyncError("grade_snapshot_too_large")
    result = []
    identities = set()
    for record in records:
        course, item = str(record.get("course_id", "")), str(record.get("item_id", ""))
        if not ID.fullmatch(course) or not ITEM.fullmatch(item):
            # A title hash is useful for display, but not authoritative event identity.
            continue
        if (course, item) in identities:
            raise SyncError("grade_snapshot_identity_ambiguous")
        identities.add((course, item))
        score, maximum = record.get("score"), record.get("max_score")
        if maximum == 0 and type(maximum) in (int, float):
            maximum = None  # A zero placeholder is not a verified denominator.
        for value in (score, maximum):
            if value is not None and (type(value) not in (int, float) or not math.isfinite(value) or value < 0):
                raise SyncError("grade_snapshot_numeric_invalid")
        title, course_title = record.get("title"), record.get("course_title")
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= 500 or not isinstance(course_title, str) or not 1 <= len(course_title.strip()) <= 500:
            raise SyncError("grade_snapshot_title_invalid")
        raw = record.get("raw") or {}
        cmid, module = str(raw.get("moodle_cmid", "")), raw.get("moodle_module")
        source = f"https://lms.astanait.edu.kz/mod/{module}/view.php?id={cmid}" if module in {"assign", "quiz"} and ID.fullmatch(cmid) else f"https://lms.astanait.edu.kz/course/view.php?id={course}"
        result.append({"courseId": course, "itemId": item, "courseTitle": course_title.strip(), "itemTitle": title.strip(),
                       "score": score, "maxScore": maximum, "sourceUrl": source})
    return sorted(result, key=lambda row: (row["courseId"], row["itemId"]))


def capture_grade_snapshot(db: Any, *, user_id: str, run_id: str, lease_owner: str,
                           records: list[dict[str, Any]], complete: bool) -> dict[str, Any]:
    if db.settings.user_id != user_id or not run_id or not lease_owner or type(complete) is not bool:
        raise SyncError("grade_snapshot_owner_invalid")
    normalized = verified_grade_snapshot(records)
    result = db.request("POST", "rpc/capture_moodle_grade_snapshot", body={
        "p_user_id": user_id, "p_run_id": run_id, "p_lease_owner": lease_owner,
        "p_complete": complete and len(normalized) == len(records), "p_records": normalized,
    })
    if not isinstance(result, dict) or any(type(result.get(key)) is not int or result[key] < 0 for key in ("seen", "eventsCreated")):
        raise SyncError("grade_snapshot_result_invalid")
    return result


def stage_grade_snapshot(db: Any, *, user_id: str, run_id: str, lease_owner: str,
                         records: list[dict[str, Any]], complete: bool) -> bool:
    """Persist the verified fetch before facts/run success; ambiguous ACK replays safely."""
    if db.settings.user_id != user_id or not run_id or not lease_owner or type(complete) is not bool:
        raise SyncError("grade_snapshot_owner_invalid")
    normalized = verified_grade_snapshot(records)
    effective_complete = complete and len(normalized) == len(records)
    result = db.request("POST", "rpc/stage_moodle_grade_snapshot", body={
        "p_user_id": user_id, "p_run_id": run_id, "p_lease_owner": lease_owner,
        "p_complete": effective_complete, "p_records": normalized,
    })
    if result is not True:
        raise SyncError("grade_snapshot_stage_invalid")
    return effective_complete


def drain_grade_snapshots(db: Any, *, user_id: str, lease_owner: str) -> dict[str, Any]:
    """Consume successful staged runs in observed order under the current lease.

    The DB consumes exact staged bytes, not the next fetch. Failure rolls back
    the batch, retaining every intermediate transition for a same-run retry.
    """
    if db.settings.user_id != user_id or not lease_owner:
        raise SyncError("grade_snapshot_owner_invalid")
    result = db.request("POST", "rpc/drain_moodle_grade_snapshots", body={
        "p_user_id": user_id, "p_lease_owner": lease_owner,
    })
    if not isinstance(result, dict) or type(result.get("drained")) is not int or result["drained"] < 0 or type(result.get("remaining")) is not bool:
        raise SyncError("grade_snapshot_drain_invalid")
    if result["remaining"]:
        raise SyncError("grade_snapshot_backlog_pending")
    return result
