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


def _course_total(course_id: int, item_id: Any, score: Any, maximum: Any) -> dict | None:
    if not re.fullmatch(r"[1-9]\d*", str(item_id)):
        return None
    try:
        return {"source": "moodle_course_total", "moodle_course_id": str(course_id),
                "moodle_item_id": str(item_id), "score": number(score), "max_score": number(maximum)}
    except SyncError:
        return None


def attach_course_total(records: list[dict], total: dict | None) -> None:
    # An aggregate is metadata on the same course's registers, never an extra assessment.
    # Each import builds a fresh raw object. An unavailable total cannot inherit an old score.
    for record in records:
        raw = record["raw"]
        raw.pop("lifeos_course_total", None)
        title = normalize_title(record["title"]).removeprefix("calculated grade ")
        if raw.get("moodle_module") or raw.get("itemtype") == "mod":
            continue
        if total and str(record["course_id"]) == total["moodle_course_id"] and title in {
            "register midterm", "register endterm", "register final", "register term",
        }:
            raw["lifeos_course_total"] = total.copy()


def ws_course_total(items: list[dict], course_id: int) -> dict | None:
    candidates = [item for item in items if item.get("itemtype") == "course"]
    if len(candidates) != 1:
        return None
    item = candidates[0]
    if any(item.get(key) not in (None, False, 0, "0") for key in
           ("hidden", "ishidden", "gradehidden", "gradeishidden", "gradehiddenbydate")):
        return None
    if "courseid" in item and str(item["courseid"]) != str(course_id):
        return None
    displayed = item.get("gradeformatted")
    score = item.get("graderaw")
    if displayed is not None and not re.fullmatch(r"[\d.,]+(?:\s*%)?", str(displayed).strip()):
        score = None
    return _course_total(course_id, item.get("id"), score, item.get("grademax"))


def html_course_total(table: Any, course_id: int, user_id: int | None) -> dict | None:
    candidates = []
    for row in table.select("tr"):
        item = row.select_one("th.column-itemname, td.column-itemname, th.item, td.item")
        if item is None:
            continue
        classes = set(item.get("class", [])) | set(row.get("class", []))
        top_aggregate = classes & {"courseitem", "coursetotal"} or (
            "level1" in classes and classes & {"baggt", "baggb"})
        title = normalize_title(item.get_text(" ", strip=True)).removeprefix("calculated grade ")
        if top_aggregate and title in {"course total", "итог курса", "итоговая оценка за курс", "итого за курс"}:
            candidates.append((row, item))
    if len(candidates) != 1:
        return None
    row, item = candidates[0]
    grade = row.select_one("td.grade, td.column-grade")
    grade_range = row.select_one("td.range, td.column-range")
    identity = re.fullmatch(r"row_([1-9]\d*)_([1-9]\d*)", item.get("id") or row.get("id") or "")
    if grade is None or not identity:
        return None
    if user_id is not None and identity.group(2) != str(user_id):
        return None
    for element in (row, item, grade):
        if re.search(r"(?:display\s*:\s*none|visibility\s*:\s*hidden)", element.get("style", ""), re.I):
            return None
        if element.has_attr("hidden") or element.get("aria-hidden") == "true" or set(element.get("class", [])) & {
                "hidden", "dimmed", "dimmed_text", "gradehidden", "text-muted"}:
            return None
    value = grade_value_text(grade)
    displayed_range = grade_range.get_text(" ", strip=True) if grade_range else ""
    bounds = re.fullmatch(r"[\d.,]+\s*[-–—]\s*([\d.,]+)", displayed_range)
    return _course_total(course_id, identity.group(1), value, bounds.group(1) if bounds else None)


def parse_report(soup: Any, course_id: int, course_title: str, user_id: int | None = None) -> list[dict[str, Any]]:
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
        link = item_cell.select_one('a[href*="/mod/"]')
        module_match = re.search(
            r"/mod/([a-z]+)/view\.php\?[^#]*\bid=(\d+)",
            link.get("href", "") if link else "",
        )
        identity = None
        for element in (item_cell, row):
            match = re.search(r"(?:^|_)row_((?:\d+_)*\d+)(?:_|$)", element.get("id", ""))
            if match:
                # Moodle emits row_<grade-item-id>_<user-id>. The final
                # number is shared by every assessment in this user's report.
                identity = match.group(1).split("_")[0]
                break
        if identity is None:
            if module_match:
                identity = f"mod-{module_match.group(1)}-{module_match.group(2)}"
        identity = identity or title_identity(title)
        if identity in identities:
            raise SyncError(f"Ambiguous Moodle grade identity in course {course_id}")
        identities.add(identity)
        raw = {"course_id": course_id, "item_id": identity, "course_title": course_title,
               "item_name": title, "grade_cell_text": raw_grade_cell, "range_cell_text": raw_range}
        if module_match:
            raw.update({"moodle_module": module_match.group(1), "moodle_cmid": module_match.group(2)})
        records.append({
            "course_id": str(course_id), "course_title": course_title,
            "item_id": identity, "title": title, "score": score, "max_score": maximum,
            "raw": raw,
        })
    attach_course_total(records, html_course_total(table, course_id, user_id))
    return records
