"""Read-only Moodle activity HTML projection; absence of a grade proves nothing."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

from common.lifeos_sync import SyncError, iso_utc
from moodle_session_security import MOODLE_HOST, safe_url


class UnsupportedMoodlePage(SyncError):
    def __init__(self, code: str = "activity_html_unsupported") -> None:
        self.code = code
        super().__init__(code)


class AssignmentSnapshot(list):
    """HTML pages cannot establish that hidden/lazy activities are absent."""
    def __init__(self, values=(), *, complete: bool = False, verified_pages: int | None = None) -> None:
        super().__init__(values)
        self.complete = complete
        self.verified_pages = verified_pages if verified_pages is not None else max(int(complete), len(self))


class GradeSnapshot(list):
    def __init__(self, values=(), *, complete: bool = False) -> None:
        super().__init__(values)
        self.complete = complete


def activity_links(soup: object, course_id: int) -> list[tuple[str, int, str]]:
    if not soup.select_one(".course-content, [data-region='course-content'], [id^='section-'], .activity, .activity-item"):
        raise UnsupportedMoodlePage("course_activity_html_unsupported")
    links: dict[tuple[str, int], str] = {}
    for anchor in soup.find_all("a", href=True):
        href = str(anchor["href"])
        parsed = urlsplit(href)
        match = re.fullmatch(r"/mod/(assign|quiz)/view\.php", parsed.path)
        if not match:
            continue
        try:
            url = safe_url(href, f"https://{MOODLE_HOST}/course/view.php?id={course_id}", moodle_only=True)
        except SyncError:
            raise UnsupportedMoodlePage("unsafe_activity_link") from None
        query = parse_qs(urlsplit(url).query)
        ids = query.get("id", [])
        if len(ids) != 1 or not re.fullmatch(r"[1-9]\d{0,11}", ids[0]):
            raise UnsupportedMoodlePage("activity_identity_unsupported")
        # Fetch only the view's identity, never arbitrary action parameters.
        key = match.group(1), int(ids[0])
        links[key] = f"https://{MOODLE_HOST}/mod/{key[0]}/view.php?id={key[1]}"
    return [(kind, cmid, url) for (kind, cmid), url in links.items()]


MONTHS = {name: index for index, name in enumerate(("january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"), 1)}


def parse_visible_date(value: str, timezone_name: str) -> str | None:
    """Parse only a fully stated date/time; relative and ambiguous times stay unknown."""
    value = " ".join(value.replace("\xa0", " ").split()).strip()
    try:
        if re.fullmatch(r"\d{10}", value):
            return iso_utc(datetime.fromtimestamp(int(value), timezone.utc))
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?", value):
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        else:
            match = re.search(r"(?:^|, )(?P<day>\d{1,2}) (?P<month>[A-Za-z]+) (?P<year>\d{4}),? (?P<hour>\d{1,2}):(?P<minute>\d{2})(?: (?P<ampm>[AP]M))?$", value, re.I)
            if not match or match["month"].lower() not in MONTHS:
                return None
            hour = int(match["hour"])
            if match["ampm"]:
                if not 1 <= hour <= 12:
                    return None
                hour = hour % 12 + (12 if match["ampm"].lower() == "pm" else 0)
            parsed = datetime(int(match["year"]), MONTHS[match["month"].lower()], int(match["day"]), hour, int(match["minute"]))
        if parsed.tzinfo is None:
            zone = ZoneInfo(timezone_name)
            first, second = parsed.replace(tzinfo=zone, fold=0), parsed.replace(tzinfo=zone, fold=1)
            if first.utcoffset() != second.utcoffset():
                return None
            if first.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) != parsed:
                return None
            parsed = first
        return iso_utc(parsed)
    except (ValueError, OverflowError, OSError, KeyError):
        return None


def _date_from_node(node: object, timezone_name: str) -> str | None:
    if node is None:
        return None
    timed = node if node.name == "time" else node.find("time")
    if timed and timed.get("datetime"):
        return parse_visible_date(str(timed["datetime"]), timezone_name)
    stamped = node if node.get("data-timestamp") else node.find(attrs={"data-timestamp": True})
    if stamped:
        return parse_visible_date(str(stamped["data-timestamp"]), timezone_name)
    return parse_visible_date(node.get_text(" ", strip=True), timezone_name)


def parse_activity(soup: object, *, course_id: int, course_title: str, cmid: int,
                   module_type: str, timezone_name: str, now: datetime) -> dict:
    marker = soup.find("body", id=f"page-mod-{module_type}-view")
    if not marker and not soup.select_one(".submissionstatustable" if module_type == "assign" else ".quizinfo, .quizattemptsummary, .quizattempt"):
        raise UnsupportedMoodlePage()
    if soup.select_one(".alert-danger, .errorcode, #notice .error"):
        raise UnsupportedMoodlePage("activity_access_unavailable")
    heading = soup.select_one(".page-header-headings h1, #page-header h1, #region-main h2, h1, h2")
    title = heading.get_text(" ", strip=True) if heading else ""
    if not title:
        raise UnsupportedMoodlePage("activity_title_missing")
    dates: dict[str, str | None] = {"due_at": None, "opens_at": None, "closes_at": None}
    warnings: set[str] = set()
    status = "unknown"
    labels = {
        "due date": "due_at", "due": "due_at", "срок сдачи": "due_at",
        "opened": "opens_at", "opens": "opens_at", "available from": "opens_at", "open the quiz": "opens_at",
        "closes": "closes_at", "close the quiz": "closes_at", "cut-off date": "closes_at",
    }
    for row in soup.select("table tr"):
        cells = row.find_all(["th", "td"], recursive=False)
        if len(cells) < 2:
            continue
        label = cells[0].get_text(" ", strip=True).lower().rstrip(":")
        text = " ".join(cells[1].get_text(" ", strip=True).lower().split())
        if label in labels:
            dates[labels[label]] = _date_from_node(cells[1], timezone_name)
            if dates[labels[label]] is None and text:
                warnings.add("activity_date_unrecognized")
        if label in {"submission status", "статус ответа", "состояние ответа"}:
            if status == "graded":
                continue
            if text in {"submitted for grading", "submitted", "представлено для оценивания"}:
                status = "submitted"
            elif text in {"no submissions have been made yet", "nothing has been submitted", "not submitted", "draft (not submitted)", "ответы на задание еще не представлены"}:
                status = "not_submitted"
        if label in {"grading status", "статус оценивания"} and text in {"graded", "оценено"}:
            status = "graded"
    for container in soup.select("[data-region='activity-dates'], .activity-dates"):
        for strong in container.find_all(["strong", "b"]):
            label = strong.get_text(" ", strip=True).lower().rstrip(":")
            key = labels.get(label)
            if not key:
                continue
            parent = strong.parent
            timed = parent.find("time")
            if timed:
                value = _date_from_node(timed, timezone_name)
            else:
                value = parse_visible_date(parent.get_text(" ", strip=True).split(":", 1)[-1].strip(), timezone_name)
            dates[key] = value
            if value is None:
                warnings.add("activity_date_unrecognized")
    if module_type == "quiz":
        if dates["closes_at"]:
            dates["due_at"] = dates["closes_at"]
        # A missing grade/attempt table alone never proves non-submission.
        for table in soup.select(".quizattemptsummary"):
            headers = [cell.get_text(" ", strip=True).lower() for cell in table.select("thead th")]
            state_index = next((i for i, value in enumerate(headers) if value in {"state", "status", "состояние"}), None)
            grade_index = next((i for i, value in enumerate(headers) if re.match(r"^(grade|оценка)(?:\s|$)", value)), None)
            for row in table.select("tbody tr"):
                cells = row.find_all("td", recursive=False)
                if state_index is not None and state_index < len(cells) and re.match(r"^(finished|completed|завершено)\b", cells[state_index].get_text(" ", strip=True), re.I):
                    if status != "graded":
                        status = "submitted"
                    if grade_index is not None and grade_index < len(cells) and re.fullmatch(r"\d+(?:[.,]\d+)?", cells[grade_index].get_text(" ", strip=True)):
                        status = "graded"
        if status == "unknown" and soup.select_one(".noattempts") and re.search(r"no attempts have been made|нет попыток", soup.select_one(".noattempts").get_text(" ", strip=True), re.I):
            status = "not_submitted"
    if status == "not_submitted" and dates["due_at"] and datetime.fromisoformat(dates["due_at"].replace("Z", "+00:00")) < now:
        status = "overdue"
    if status == "unknown":
        warnings.add("submission_status_unknown")
    if dates["due_at"] is None:
        warnings.add("due_date_unknown")
    assessment_type = "midterm" if re.search(r"\bmid[ -]?term\b|промежуточ", title, re.I) else "exam" if re.search(r"\b(exam|examination)\b|экзамен", title, re.I) else "quiz" if module_type == "quiz" else "assignment"
    return {"course_id": str(course_id), "course_title": course_title,
            "assignment_id": str(cmid), "cmid": str(cmid), "title": title,
            "module_type": module_type, "assessment_type": assessment_type,
            "submission_status": status, **dates, "parser_warnings": sorted(warnings),
            "ingestion_complete": False, "source": "html"}
