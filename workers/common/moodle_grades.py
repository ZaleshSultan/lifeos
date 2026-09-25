"""Moodle grade-report parsing. Unknown grades/ranges stay unknown."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import math
import re
import unicodedata
from typing import Any

from common.lifeos_sync import SyncError


def number(value: Any) -> float | None:
    if value is None or str(value).strip() in {"", "-", "–", "—"}:
        return None
    try:
        result = float(str(value).strip().replace("\u00a0", "").replace(",", "."))
    except (TypeError, ValueError) as exc:
        raise SyncError("Unrecognized Moodle numeric grade") from exc
    if not math.isfinite(result) or result < 0:
        raise SyncError("Invalid Moodle numeric grade")
    return result


def normalize_title(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def title_identity(title: str) -> str:
    # Unicode-safe fallback, independent of row order and grade changes.
    return "title-" + hashlib.sha256(normalize_title(title).encode()).hexdigest()[:24]


def grade_value_text(cell: Any) -> str:
    """Read the displayed grade without Moodle's action menu beside it."""
    if cell.select_one(".action-menu.moodle-actionmenu") is None:
        return cell.get_text(" ", strip=True)
    value_cell = deepcopy(cell)
    for menu in value_cell.select(".action-menu.moodle-actionmenu"):
        menu.decompose()
    return value_cell.get_text(" ", strip=True)


def parse_report(soup: Any, course_id: int, course_title: str) -> list[dict[str, Any]]:
    table = soup.select_one("table.user-grade") or soup.select_one("table.generaltable")
    if table is None:
        raise SyncError(f"Moodle grade table missing for course {course_id}; refusing an empty snapshot")
    headers: dict[str, int] = {}
    for row in table.select("tr"):
        cells = row.find_all(["th", "td"], recursive=False)
        if cells and all(cell.name == "th" for cell in cells):
            for index, cell in enumerate(cells):
                label = normalize_title(cell.get_text(" ", strip=True))
                if label in {"grade item", "элемент оценивания", "название"}:
                    headers["item"] = index
                elif label in {"grade", "оценка"}:
                    headers["grade"] = index
                elif label in {"range", "диапазон"}:
                    headers["range"] = index

    records = []
    identities: set[str] = set()
    for row in table.select("tr"):
        cells = row.find_all(["th", "td"], recursive=False)
        if not row.find("td", recursive=False):
            continue
        if row.select_one(".category, .categoryitem, .courseitem, .categorytotal, .coursetotal, .baggt, .baggb") or set(row.get("class", [])) & {"category", "categoryitem", "courseitem", "baggt", "baggb"}:
            continue
        item_cell = row.select_one("th.item, td.item, th.column-itemname, td.column-itemname")
        if item_cell is None:
            item_cell = cells[headers.get("item", 0)] if cells else None
        grade_cell = row.select_one("td.grade, td.column-grade")
        if grade_cell is None and "grade" in headers and len(cells) > headers["grade"]:
            grade_cell = cells[headers["grade"]]
        if grade_cell is None and len(cells) == 2:
            grade_cell = cells[1]
        if item_cell is None or grade_cell is None:
            # Category headings can have no grade, but an item must be readable.
            if item_cell and item_cell.select_one('a[href*="/mod/"]'):
                raise SyncError(f"Unrecognized grade columns for course {course_id}")
            continue
        title = item_cell.get_text(" ", strip=True)
        if normalize_title(title) in {"", "-", "course total", "итого", "итоговая оценка за курс"}:
            continue
        raw_grade = grade_value_text(grade_cell)
        raw_grade_cell = grade_cell.get_text(" ", strip=True)
        # Scale/text grades cannot be represented numerically; preserve as unknown.
        score = None
        maximum = None
        if re.fullmatch(r"[\d.,\s]+/[\d.,\s]+", raw_grade):
            score_text, maximum_text = raw_grade.split("/", 1)
            score, maximum = number(score_text), number(maximum_text)
        elif re.fullmatch(r"[\d.,]+", raw_grade):
            score = number(raw_grade)
        range_cell = row.select_one("td.range, td.column-range")
        if range_cell is None and "range" in headers and len(cells) > headers["range"]:
            range_cell = cells[headers["range"]]
        raw_range = range_cell.get_text(" ", strip=True) if range_cell else ""
        match = re.fullmatch(r"\s*[\d.,]+\s*[-–—]\s*([\d.,]+)\s*", raw_range)
        if match:
            maximum = number(match.group(1))
        identity = None
        for element in (item_cell, row):
            match = re.search(r"(?:^|_)row_((?:\d+_)*\d+)(?:_|$)", element.get("id", ""))
            if match:
                # Moodle emits row_<grade-item-id>_<user-id>. The final
                # number is shared by every assessment in this user's report.
                identity = match.group(1).split("_")[0]
                break
        if identity is None:
            link = item_cell.select_one('a[href*="/mod/"]')
            if link:
                match = re.search(r"/mod/([a-z]+)/view\.php\?[^#]*\bid=(\d+)", link.get("href", ""))
                if match:
                    identity = f"mod-{match.group(1)}-{match.group(2)}"
        identity = identity or title_identity(title)
        if identity in identities:
            raise SyncError(f"Ambiguous Moodle grade identity in course {course_id}")
        identities.add(identity)
        records.append({
            "course_id": str(course_id), "course_title": course_title,
            "item_id": identity, "title": title, "score": score, "max_score": maximum,
            "raw": {"course_id": course_id, "item_id": identity, "course_title": course_title,
                    "item_name": title, "grade_cell_text": raw_grade_cell, "range_cell_text": raw_range},
        })
    return records
