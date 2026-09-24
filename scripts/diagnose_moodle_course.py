#!/usr/bin/env python3
"""Read one Moodle grade report; emit structural diagnostics, never DB writes.

Run from the LifeOS repository root with the AITU worker's Python environment.
No cookie/token values, response HTML, table text or URL query strings are output.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
import logging
from pathlib import Path
import re
import sys
from typing import Any
from urllib.parse import urlencode, urlsplit


KNOWN_CLASSES = {
    "user-grade", "generaltable", "item", "grade", "range", "weight", "percentage",
    "feedback", "column-itemname", "column-grade", "column-range", "column-weight",
    "category", "categoryitem", "courseitem", "categorytotal", "coursetotal",
    "baggt", "baggb",
    "heading", "hidden", "odd", "even", "b1t", "b1b", "b1l", "b1r",
}
PARSER_REASONS = (
    ("Moodle grade table missing for course ", "grade_table_missing"),
    ("Unrecognized grade columns for course ", "grade_columns_unrecognized"),
    ("Ambiguous Moodle grade identity in course ", "ambiguous_item_identity"),
    ("Unrecognized Moodle numeric grade", "numeric_grade_unrecognized"),
    ("Invalid Moodle numeric grade", "numeric_grade_invalid"),
)


def safe_error(exc: Exception) -> dict[str, Any]:
    # Never print str(HTTPError), URLs, traceback locals or arbitrary server text.
    result: dict[str, Any] = {"error_type": type(exc).__name__}
    for prefix, reason in PARSER_REASONS:
        if str(exc).startswith(prefix):
            result["reason"] = reason
            break
    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    if type(status) is int:
        result["http_status"] = status
    return result


def classes(tag: Any) -> list[str]:
    return [value for value in tag.get("class", [])
            if value in KNOWN_CLASSES or re.fullmatch(r"(?:level|column-c)\d{1,2}", value)]


def structural_summary(scraper: Any, response: Any, course_id: int) -> dict[str, Any]:
    parsed_url = urlsplit(response.url)
    result: dict[str, Any] = {
        "course_id": course_id,
        "http_status": response.status_code,
        "on_moodle_host": parsed_url.hostname == urlsplit(scraper.BASE_URL).hostname,
        "at_grade_report": parsed_url.path == "/grade/report/user/index.php",
        "at_login": parsed_url.path.startswith(("/login", "/auth/")),
        "redirect_count": len(response.history),
    }
    if response.status_code >= 400:
        result["reason"] = "http_error"
        return result
    if not result["on_moodle_host"]:
        result["reason"] = "redirected_away_from_moodle"
        return result
    soup = scraper._bs4_parse(response.text)
    result["table_count"] = len(soup.select("table"))
    result["grade_table_count"] = len(soup.select("table.user-grade, table.generaltable"))
    result["login_form_present"] = bool(soup.select_one('input[name="username"], input[name="password"]'))
    table = soup.select_one("table.user-grade") or soup.select_one("table.generaltable")
    if table is not None:
        rows = table.select("tr")
        result["row_count"] = len(rows)
        result["row_samples"] = []
        ids: list[str] = []
        title_groups: dict[str, int] = {}
        title_counts: Counter[int] = Counter()
        for index, row in enumerate(rows):
            cells = row.find_all(["th", "td"], recursive=False)
            cell_samples = []
            for cell in cells[:10]:
                cell_id = str(cell.get("id", ""))
                safe_id = cell_id if re.fullmatch(r"row_(?:\d+_)*\d+(?:_[a-z]{1,10})?", cell_id) else None
                if safe_id:
                    ids.append(safe_id)
                cell_samples.append({"tag": cell.name, "classes": classes(cell), "row_id": safe_id})
            item = row.select_one("th.item, td.item, th.column-itemname, td.column-itemname")
            group = None
            if item is not None:
                # Expose repeated-title groups without publishing assignment names.
                title = " ".join(item.get_text(" ", strip=True).casefold().split())
                group = title_groups.setdefault(title, len(title_groups) + 1)
                title_counts[group] += 1
            if index < 16:
                result["row_samples"].append({
                    "row": index + 1, "classes": classes(row), "cell_count": len(cells),
                    "title_group": group, "cells": cell_samples,
                })
        result["repeated_row_ids"] = {key: count for key, count in Counter(ids).items() if count > 1}
        result["repeated_title_groups"] = {key: count for key, count in title_counts.items() if count > 1}
    try:
        records = scraper.parse_report(soup, course_id, "diagnostic course")
        result.update({"parse_ok": True, "record_count": len(records)})
    except Exception as exc:
        result.update({"parse_ok": False, **safe_error(exc)})
    return result


def diagnose(scraper: Any, settings: Any, course_id: int) -> dict[str, Any]:
    result: dict[str, Any] = {"course_id": course_id, "read_only": True, "phase": "login"}
    client = scraper.MoodleClient(settings)
    try:
        # Inspect the exact SSO strategy already confirmed in the user's log.
        if not settings.sso_cookie:
            return {**result, "authenticated": False, "reason": "sso_cookie_not_configured"}
        if not client._sso_cookie_login():
            return {**result, "authenticated": False, "reason": "sso_session_not_established"}
        result.update({"authenticated": True, "phase": "grade_report"})
        params = {"id": course_id, "userid": client._moodle_user_id}
        response = client._session.get(
            scraper.GRADE_REPORT_URL + "?" + urlencode(params), timeout=scraper.REQUEST_TIMEOUT,
        )
        result.update(structural_summary(scraper, response, course_id))
        return result
    except Exception as exc:
        return {**result, **safe_error(exc)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("course_id", type=int)
    args = parser.parse_args()
    if args.course_id <= 0:
        parser.error("course_id must be positive")
    repo = Path.cwd()
    worker_dir = repo / "workers" / "university-sync" / "aitu-parser"
    if not (worker_dir / "university_scraper.py").is_file():
        parser.error("Run this script from the LifeOS repository root: cd ~/lifeos")
    sys.path.insert(0, str(worker_dir))
    logging.disable(logging.CRITICAL)
    try:
        import university_scraper as scraper
        settings = scraper.load_settings()
        result = diagnose(scraper, settings, args.course_id)
    except Exception as exc:
        result = {"phase": "configuration", **safe_error(exc)}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("parse_ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
