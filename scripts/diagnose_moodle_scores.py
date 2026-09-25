#!/usr/bin/env python3
"""Read-only aggregate diagnosis of Moodle scores stored for one LifeOS user.

Only counts and sync statuses are printed. Moodle item text, raw JSON, user IDs,
error messages, credentials and Supabase URLs stay out of the report.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import re
import sys
from typing import Any
from uuid import UUID


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "workers"))

from common.lifeos_sync import (  # noqa: E402
    BaseSettings,
    SupabaseRestClient,
    getenv_required,
    load_dotenv,
)

PAGE_SIZE = 100
EMPTY_GRADE = {"", "-", "–", "—"}


def _pages(db: SupabaseRestClient, table: str, query: dict[str, str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    after_id: str | None = None
    while True:
        page_query = {**query, "order": "id.asc", "limit": str(PAGE_SIZE)}
        if after_id is not None:
            page_query["id"] = f"gt.{after_id}"
        page = db.request("GET", table, query=page_query) or []
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        after_id = str(page[-1]["id"])


def _is_numeric(value: Any) -> bool:
    if value is None:
        return False
    return bool(re.fullmatch(r"\d+(?:[.,]\d+)?", str(value).strip()))


def summarize(records: list[dict[str, Any]], runs: list[dict[str, Any]]) -> dict[str, Any]:
    null_score = [row for row in records if row.get("score") is None]
    raw_null = [row.get("raw_json") if isinstance(row.get("raw_json"), dict) else {} for row in null_score]
    html_null = [raw for raw in raw_null if "grade_cell_text" in raw]
    ws_null = [raw for raw in raw_null if "graderaw" in raw or "gradeformatted" in raw]
    latest = runs[0] if runs else None
    statuses = Counter(str(run.get("status") or "unknown") for run in runs)
    return {
        "active_moodle_records": len(records),
        "db_score_present": len(records) - len(null_score),
        "db_score_null": len(null_score),
        "db_max_score_present": sum(row.get("max_score") is not None for row in records),
        "db_percentage_present": sum(row.get("percentage") is not None for row in records),
        "mocked_records": sum((row.get("raw_json") or {}).get("_is_mocked") is True
                              for row in records if isinstance(row.get("raw_json"), dict)),
        "null_score_raw_html_rows": len(html_null),
        "null_score_html_placeholder": sum(str(raw.get("grade_cell_text") or "").strip() in EMPTY_GRADE for raw in html_null),
        "null_score_html_plain_numeric": sum(_is_numeric(raw.get("grade_cell_text")) for raw in html_null),
        "null_score_html_contains_digit": sum(bool(re.search(r"\d", str(raw.get("grade_cell_text") or ""))) for raw in html_null),
        "null_score_raw_ws_rows": len(ws_null),
        "null_score_ws_graderaw_numeric": sum(_is_numeric(raw.get("graderaw")) for raw in ws_null),
        "null_score_ws_gradeformatted_numeric": sum(_is_numeric(raw.get("gradeformatted")) for raw in ws_null),
        "recent_sync_runs": len(runs),
        "recent_sync_statuses": dict(sorted(statuses.items())),
        "recent_sync_errors_present": sum(bool(run.get("error_message")) for run in runs),
        "latest_sync_status": str(latest.get("status") or "unknown") if latest else None,
        "latest_sync_records_seen": latest.get("records_seen") if latest else None,
        "latest_sync_records_updated": latest.get("records_updated") if latest else None,
        "latest_sync_error_present": bool(latest.get("error_message")) if latest else None,
    }


def diagnose(db: SupabaseRestClient) -> dict[str, Any]:
    user_filter = {"user_id": f"eq.{db.settings.user_id}"}
    events = _pages(db, "source_events", {
        **user_filter,
        "select": "id,external_id",
        "source_key": "eq.university_platform",
        "event_type": "eq.academic_grade",
        "status": "eq.active",
    })
    active_ids = {row["id"] for row in events
                  if str(row.get("external_id") or "").startswith("academic:moodle:")}
    records = _pages(db, "academic_records", {
        **user_filter,
        "select": "id,source_event_id,score,max_score,percentage,raw_json",
    })
    records = [row for row in records if row.get("source_event_id") in active_ids]
    runs = db.request("GET", "sync_runs", query={
        **user_filter,
        "select": "status,records_seen,records_updated,error_message",
        "source_key": "eq.university_platform",
        "order": "started_at.desc",
        "limit": "10",
    }) or []
    return summarize(records, runs)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, help="Worker .env; defaults to the AITU worker .env")
    parser.add_argument("--user-id", help="LifeOS user UUID; defaults to LIFEOS_DEFAULT_USER_ID")
    args = parser.parse_args(argv)
    env_file = args.env_file or ROOT / "workers" / "university-sync" / "aitu-parser" / ".env"
    try:
        load_dotenv(env_file)
        user_id = args.user_id or getenv_required("LIFEOS_DEFAULT_USER_ID")
        UUID(user_id)
        settings = BaseSettings(
            supabase_url=getenv_required("SUPABASE_URL").rstrip("/"),
            service_role_key=getenv_required("SUPABASE_SERVICE_ROLE_KEY"),
            user_id=user_id,
            timezone_name=os.environ.get("APP_TIMEZONE", "Asia/Almaty"),
        )
        print(json.dumps(diagnose(SupabaseRestClient(settings)), indent=2, sort_keys=True))
        return 0
    except Exception as exc:
        # REST errors may contain private payloads or URLs. Keep failures opaque.
        print(json.dumps({"error": "diagnostic_failed", "type": type(exc).__name__}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
