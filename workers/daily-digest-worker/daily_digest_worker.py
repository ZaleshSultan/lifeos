#!/usr/bin/env python3
"""Send one daily LifeOS Telegram briefing per active user."""

from __future__ import annotations

import html
import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, time as dt_time, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

REQUEST_TIMEOUT_SECONDS = 30
DEFAULT_TIMEZONE = "Asia/Almaty"
DEFAULT_DIGEST_TIME = "08:00"
DEFAULT_SEND_WINDOW_MINUTES = 720
WEEKDAYS = (
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
)
SESSION_LABELS = {"lecture": "лекция", "practical": "практика", "lab": "лабораторная"}
AITU_MAP_URL = "https://yuujiso.github.io/aitumap/"

JsonObject = dict[str, Any]


class WorkerError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    service_role_key: str
    telegram_bot_token: str
    digest_time: str = DEFAULT_DIGEST_TIME
    poll_seconds: int = 60
    send_window_minutes: int = DEFAULT_SEND_WINDOW_MINUTES
    default_timezone: str = DEFAULT_TIMEZONE
    tma_url: str | None = None
    test_telegram_user_id: str | None = None
    default_weather_name: str | None = None
    default_weather_latitude: float | None = None
    default_weather_longitude: float | None = None


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise WorkerError(f"Missing required environment variable: {name}")
    return value


def positive_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise WorkerError(f"{name} must be an integer") from exc
    if value <= 0:
        raise WorkerError(f"{name} must be greater than zero")
    return value


def validate_clock(value: str) -> str:
    if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
        raise WorkerError("DAILY_DIGEST_TIME must be HH:MM")
    return value


def optional_float(name: str) -> float | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError as exc:
        raise WorkerError(f"{name} must be a number") from exc


def load_settings(env_file: Path | None = None) -> Settings:
    load_dotenv(Path(__file__).with_name(".env"))
    if env_file:
        load_dotenv(env_file)
    return Settings(
        supabase_url=required("SUPABASE_URL").rstrip("/"),
        service_role_key=required("SUPABASE_SERVICE_ROLE_KEY"),
        telegram_bot_token=required("TELEGRAM_BOT_TOKEN"),
        digest_time=validate_clock(os.environ.get("DAILY_DIGEST_TIME", DEFAULT_DIGEST_TIME).strip() or DEFAULT_DIGEST_TIME),
        poll_seconds=positive_int("DAILY_DIGEST_POLL_SECONDS", 60),
        send_window_minutes=positive_int(
            "DAILY_DIGEST_SEND_WINDOW_MINUTES", DEFAULT_SEND_WINDOW_MINUTES
        ),
        default_timezone=os.environ.get("APP_TIMEZONE", DEFAULT_TIMEZONE).strip() or DEFAULT_TIMEZONE,
        tma_url=os.environ.get("TMA_URL", "").strip() or None,
        test_telegram_user_id=os.environ.get("DAILY_DIGEST_TEST_TELEGRAM_USER_ID", "").strip() or None,
        default_weather_name=os.environ.get("LIFEOS_DEFAULT_WEATHER_NAME", "").strip() or None,
        default_weather_latitude=optional_float("LIFEOS_DEFAULT_WEATHER_LATITUDE"),
        default_weather_longitude=optional_float("LIFEOS_DEFAULT_WEATHER_LONGITUDE"),
    )


def resolve_timezone(name: str):
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        if name in {"Asia/Almaty", "Asia/Qyzylorda"}:
            return timezone(timedelta(hours=5))
        return timezone.utc


def digest_window(local_now: datetime, digest_time: str, window_minutes: int) -> bool:
    hour, minute = (int(part) for part in digest_time.split(":", 1))
    start = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return start <= local_now < start + timedelta(minutes=window_minutes)


def build_tma_url(base_url: str, *, screen: str = "study", study_tab: str | None = None) -> str:
    parts = urllib.parse.urlsplit(base_url)
    query = dict(urllib.parse.parse_qsl(parts.query, keep_blank_values=True))
    query["screen"] = screen
    if study_tab:
        query["studyTab"] = study_tab
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(query), parts.fragment)
    )


def utc_bounds(local_day: date, timezone_name: str) -> tuple[str, str]:
    tz = resolve_timezone(timezone_name)
    start = datetime.combine(local_day, dt_time.min, tzinfo=tz).astimezone(timezone.utc)
    end = (datetime.combine(local_day, dt_time.min, tzinfo=tz) + timedelta(days=1)).astimezone(timezone.utc)
    return start.isoformat().replace("+00:00", "Z"), end.isoformat().replace("+00:00", "Z")


class SupabaseRestClient:
    def __init__(self, url: str, key: str) -> None:
        self.base_url = f"{url.rstrip('/')}/rest/v1"
        self.headers = {
            "apikey": key,
            "authorization": f"Bearer {key}",
            "accept": "application/json",
            "content-type": "application/json",
        }

    def request(self, method: str, table: str, query: dict[str, str] | None = None,
                body: Any | None = None, prefer: str | None = None) -> Any:
        encoded = urllib.parse.urlencode(query or {}, safe="(),.*")
        url = f"{self.base_url}/{table}" + (f"?{encoded}" if encoded else "")
        headers = dict(self.headers)
        if prefer:
            headers["prefer"] = prefer
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise WorkerError(f"Supabase {method} {table} failed: {exc.code} {detail}") from exc
        except urllib.error.URLError as exc:
            raise WorkerError(f"Supabase {method} {table} failed: {exc.reason}") from exc
        return json.loads(raw) if raw else None

    def active_profiles(self) -> list[JsonObject]:
        return self.request("GET", "profiles", {
            "select": "user_id,telegram_user_id,timezone,status,display_name",
            "status": "eq.active",
            "telegram_user_id": "not.is.null",
            "order": "created_at.asc",
        }) or []

    def user_settings(self, user_id: str) -> JsonObject:
        rows = self.request("GET", "user_settings", {
            "select": "settings",
            "user_id": f"eq.{user_id}",
            "limit": "1",
        }) or []
        if not rows or not isinstance(rows[0].get("settings"), dict):
            return {}
        return rows[0]["settings"]

    def claim_delivery(self, user_id: str, local_date: str, chat_id: str) -> bool:
        try:
            self.request("POST", "daily_digest_deliveries", body={
                "user_id": user_id,
                "local_date": local_date,
                "telegram_chat_id": int(chat_id),
                "status": "sending",
            }, prefer="return=minimal")
            return True
        except WorkerError as exc:
            if "409" in str(exc):
                return False
            raise

    def complete_delivery(self, user_id: str, local_date: str) -> None:
        self.request("PATCH", "daily_digest_deliveries", {
            "user_id": f"eq.{user_id}", "local_date": f"eq.{local_date}"
        }, {"status": "sent", "sent_at": datetime.now(timezone.utc).isoformat()}, prefer="return=minimal")

    def release_delivery(self, user_id: str, local_date: str) -> None:
        self.request("DELETE", "daily_digest_deliveries", {
            "user_id": f"eq.{user_id}", "local_date": f"eq.{local_date}", "status": "eq.sending"
        }, prefer="return=minimal")

    def list_today_tasks(self, user_id: str, day_start: str, day_end: str) -> list[JsonObject]:
        planned = self.request("GET", "tasks", {
            "select": "id,title,due_at,scheduled_for,status,priority,created_at",
            "user_id": f"eq.{user_id}",
            "status": "not.in.(done,cancelled)",
            "or": (
                f"(and(scheduled_for.gte.{day_start},scheduled_for.lt.{day_end}),"
                f"and(due_at.gte.{day_start},due_at.lt.{day_end}))"
            ),
            "order": "priority.desc,scheduled_for.asc.nullslast,due_at.asc.nullslast",
            "limit": "30",
        }) or []
        captured = self.request("GET", "tasks", {
            "select": "id,title,due_at,scheduled_for,status,priority,created_at",
            "user_id": f"eq.{user_id}",
            "status": "not.in.(done,cancelled)",
            "created_at": f"gte.{day_start}",
            "and": f"(created_at.lt.{day_end},due_at.is.null,scheduled_for.is.null)",
            "order": "priority.desc,created_at.asc",
            "limit": "30",
        }) or []
        merged: dict[str, JsonObject] = {}
        for row in [*planned, *captured]:
            row_id = str(row.get("id") or "")
            if row_id:
                merged[row_id] = row
        return list(merged.values())[:30]

    def list_courses(self, user_id: str) -> list[JsonObject]:
        return self.request("GET", "study_courses", {
            "select": "id,title,code,status",
            "user_id": f"eq.{user_id}", "status": "eq.active", "order": "title.asc",
        }) or []

    def list_schedule(self, course_ids: list[str], weekday: str) -> list[JsonObject]:
        if not course_ids:
            return []
        joined = ",".join(course_ids)
        return self.request("GET", "course_schedules", {
            "select": "id,study_course_id,day_of_week,start_time,end_time,room,session_type,instructor_name",
            "study_course_id": f"in.({joined})", "day_of_week": f"eq.{weekday}", "order": "start_time.asc",
        }) or []

    def list_deadlines(self, user_id: str, now_iso: str, horizon_iso: str) -> list[JsonObject]:
        university = self.request("GET", "source_events", {
            "select": "id,title,due_at,description,raw_json",
            "user_id": f"eq.{user_id}", "source_key": "eq.university_platform",
            "event_type": "eq.task", "status": "eq.active", "due_at": f"gte.{now_iso}",
            "and": f"(due_at.lte.{horizon_iso})", "order": "due_at.asc", "limit": "20",
        }) or []
        manual = self.request("GET", "life_entities", {
            "select": "id,title,due_at,body",
            "user_id": f"eq.{user_id}", "entity_type": "eq.deadline", "due_at": f"gte.{now_iso}",
            "and": f"(due_at.lte.{horizon_iso})", "order": "due_at.asc", "limit": "20",
        }) or []
        result: list[JsonObject] = []
        for row in university:
            raw = row.get("raw_json") if isinstance(row.get("raw_json"), dict) else {}
            course = raw.get("course_title") or row.get("description") or "Учёба"
            result.append({"id": row.get("id"), "title": row.get("title") or "Задание", "due_at": row.get("due_at"), "course": course})
        for row in manual:
            result.append({"id": row.get("id"), "title": row.get("title") or "Дедлайн", "due_at": row.get("due_at"), "course": "LifeOS"})
        dedup: dict[tuple[str, str], JsonObject] = {}
        for row in result:
            dedup[(str(row.get("title")), str(row.get("due_at")))] = row
        return sorted(dedup.values(), key=lambda row: str(row.get("due_at") or ""))[:20]


class TelegramClient:
    def __init__(self, token: str) -> None:
        self.url = f"https://api.telegram.org/bot{token}/sendMessage"

    def send_message(self, chat_id: str, text: str, reply_markup: JsonObject | None = None) -> None:
        payload: JsonObject = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
        if reply_markup:
            payload["reply_markup"] = reply_markup
        request = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                if response.status >= 300:
                    raise WorkerError(f"Telegram send failed: {response.status}")
        except urllib.error.HTTPError as exc:
            raise WorkerError(f"Telegram send failed: {exc.code}") from exc
        except urllib.error.URLError as exc:
            raise WorkerError(f"Telegram send failed: {exc.reason}") from exc


WEATHER_LABELS = {
    0: "ясно", 1: "почти ясно", 2: "переменная облачность", 3: "пасмурно",
    45: "туман", 48: "туман", 51: "морось", 53: "морось", 55: "морось",
    56: "морось", 57: "морось", 61: "дождь", 63: "дождь", 65: "сильный дождь",
    66: "ледяной дождь", 67: "ледяной дождь", 71: "снег", 73: "снег", 75: "сильный снег",
    77: "снег", 80: "ливни", 81: "ливни", 82: "сильные ливни", 85: "снегопад",
    86: "сильный снегопад", 95: "гроза", 96: "гроза", 99: "гроза",
}


def weather_location_from_settings(user_settings: JsonObject, settings: Settings) -> JsonObject | None:
    raw = user_settings.get("weather")
    if isinstance(raw, dict):
        try:
            latitude = float(raw.get("latitude"))
            longitude = float(raw.get("longitude"))
        except (TypeError, ValueError):
            latitude = longitude = None
        name = str(raw.get("location_name") or raw.get("locationName") or "").strip()
        if name and latitude is not None and longitude is not None:
            return {"name": name, "latitude": latitude, "longitude": longitude}
    if (
        settings.default_weather_name
        and settings.default_weather_latitude is not None
        and settings.default_weather_longitude is not None
    ):
        return {
            "name": settings.default_weather_name,
            "latitude": settings.default_weather_latitude,
            "longitude": settings.default_weather_longitude,
        }
    return None


def fetch_weather(location: JsonObject, timezone_name: str) -> JsonObject | None:
    query = urllib.parse.urlencode({
        "latitude": location["latitude"],
        "longitude": location["longitude"],
        "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
        "forecast_days": 1,
        "timezone": timezone_name,
    })
    request = urllib.request.Request(
        f"https://api.open-meteo.com/v1/forecast?{query}",
        headers={"accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError, ValueError):
        logging.warning("weather forecast unavailable for %s", location.get("name"))
        return None
    current = body.get("current") if isinstance(body.get("current"), dict) else {}
    daily = body.get("daily") if isinstance(body.get("daily"), dict) else {}
    def daily_first(key: str):
        values = daily.get(key)
        return values[0] if isinstance(values, list) and values else None
    code = current.get("weather_code")
    if not isinstance(code, (int, float)):
        code = daily_first("weather_code")
    code_int = int(code) if isinstance(code, (int, float)) else None
    return {
        "location_name": location.get("name"),
        "temperature": current.get("temperature_2m"),
        "apparent_temperature": current.get("apparent_temperature"),
        "weather_label": WEATHER_LABELS.get(code_int, "облачно"),
        "min_temperature": daily_first("temperature_2m_min"),
        "max_temperature": daily_first("temperature_2m_max"),
        "precipitation_probability": daily_first("precipitation_probability_max"),
    }


def weather_digest_lines(weather: JsonObject | None) -> list[str]:
    if not weather:
        return []
    def rounded(value: Any) -> str | None:
        return str(round(float(value))) if isinstance(value, (int, float)) else None
    temp = rounded(weather.get("temperature"))
    min_temp = rounded(weather.get("min_temperature"))
    max_temp = rounded(weather.get("max_temperature"))
    rain = rounded(weather.get("precipitation_probability"))
    location = html.escape(str(weather.get("location_name") or "Погода"))
    label = html.escape(str(weather.get("weather_label") or ""))
    first = f"<b>🌤 {location}</b> — {label}"
    if temp is not None:
        first += f" · <b>{temp}°C</b>"
    details = []
    if min_temp is not None and max_temp is not None:
        details.append(f"{min_temp}…{max_temp}°C")
    if rain is not None:
        details.append(f"осадки {rain}%")
    return [first, " · ".join(details)] if details else [first]


def parse_iso(value: str) -> datetime:
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    parsed = datetime.fromisoformat(normalized)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def local_due_label(value: str, timezone_name: str) -> str:
    try:
        return parse_iso(value).astimezone(resolve_timezone(timezone_name)).strftime("%d.%m %H:%M")
    except (TypeError, ValueError):
        return value


def digest_greeting(local_now: datetime) -> str:
    if local_now.hour < 12:
        return "Доброе утро"
    if local_now.hour < 18:
        return "Добрый день"
    return "Добрый вечер"


def build_digest(
    local_now: datetime,
    timezone_name: str,
    tasks: list[JsonObject],
    courses: list[JsonObject],
    schedule: list[JsonObject],
    deadlines: list[JsonObject],
    weather: JsonObject | None = None,
) -> str:
    course_map = {str(course.get("id")): course for course in courses}
    lines = [f"<b>{digest_greeting(local_now)} · {local_now:%d.%m.%Y}</b>"]
    weather_lines = weather_digest_lines(weather)
    if weather_lines:
        lines.extend(["", *weather_lines])
    lines.append("")
    lines.append("<b>✅ Дела на сегодня</b>")
    if tasks:
        for index, row in enumerate(tasks[:10], 1):
            title = html.escape(str(row.get("title") or "Без названия"))
            due_at = str(row.get("due_at") or "")
            due = (
                f" · <b>{html.escape(local_due_label(due_at, timezone_name).split()[-1])}</b>"
                if due_at
                else ""
            )
            lines.append(f"{index}. {title}{due}")
    else:
        lines.append("На сегодня дел пока нет.")

    lines.extend(["", "<b>🎓 Расписание</b>"])
    if schedule:
        for row in schedule[:12]:
            course = course_map.get(str(row.get("study_course_id")), {})
            title = html.escape(str(course.get("title") or course.get("code") or "Предмет"))
            start = str(row.get("start_time") or "")[:5]
            end = str(row.get("end_time") or "")[:5]
            details = [SESSION_LABELS.get(str(row.get("session_type")), str(row.get("session_type") or "")), str(row.get("room") or "")]
            details = [item for item in details if item]
            suffix = f" · {html.escape(' · '.join(details))}" if details else ""
            lines.append(f"• <b>{html.escape(start)}–{html.escape(end)}</b> — {title}{suffix}")
    else:
        lines.append("Сегодня пар нет.")

    lines.extend(["", "<b>⏳ Ближайшие дедлайны · 7 дней</b>"])
    if deadlines:
        for row in deadlines[:10]:
            title = html.escape(str(row.get("title") or "Задание"))
            course = html.escape(str(row.get("course") or "Учёба"))
            due = local_due_label(str(row.get("due_at") or ""), timezone_name)
            lines.append(f"• {title} — {course} · <b>{html.escape(due)}</b>")
    else:
        lines.append("На ближайшие 7 дней дедлайнов нет.")

    return "\n".join(lines)[:3900]


def process_profile(db: SupabaseRestClient, telegram: TelegramClient, settings: Settings,
                    profile: JsonObject, now_utc: datetime) -> bool:
    user_id = str(profile.get("user_id") or "").strip()
    chat_id = str(profile.get("telegram_user_id") or "").strip()
    if not user_id or not chat_id:
        return False
    if settings.test_telegram_user_id and chat_id != settings.test_telegram_user_id:
        return False
    timezone_name = str(profile.get("timezone") or settings.default_timezone)
    tz = resolve_timezone(timezone_name)
    local_now = now_utc.astimezone(tz)
    if not digest_window(local_now, settings.digest_time, settings.send_window_minutes):
        return False
    local_date = local_now.date().isoformat()
    if not db.claim_delivery(user_id, local_date, chat_id):
        return False

    try:
        day_start, day_end = utc_bounds(local_now.date(), timezone_name)
        tasks = db.list_today_tasks(user_id, day_start, day_end)
        courses = db.list_courses(user_id)
        schedule = db.list_schedule([str(row["id"]) for row in courses if row.get("id")], WEEKDAYS[local_now.weekday()])
        deadlines = db.list_deadlines(
            user_id,
            now_utc.isoformat().replace("+00:00", "Z"),
            (now_utc + timedelta(days=7)).isoformat().replace("+00:00", "Z"),
        )
        user_settings = db.user_settings(user_id)
        weather_location = weather_location_from_settings(user_settings, settings)
        weather = fetch_weather(weather_location, timezone_name) if weather_location else None
        text = build_digest(
            local_now, timezone_name, tasks, courses, schedule, deadlines, weather
        )
        buttons: list[list[JsonObject]] = []
        if settings.tma_url:
            buttons.append([
                {"text": "Открыть учёбу", "web_app": {"url": build_tma_url(settings.tma_url)}},
                {
                    "text": "Карта корпуса",
                    "web_app": {"url": build_tma_url(settings.tma_url, study_tab="map")},
                },
            ])
        else:
            buttons.append([{"text": "Карта корпуса", "url": AITU_MAP_URL}])
        telegram.send_message(chat_id, text, {"inline_keyboard": buttons})
        db.complete_delivery(user_id, local_date)
        return True
    except Exception:
        try:
            db.release_delivery(user_id, local_date)
        except Exception:
            logging.exception("failed to release daily digest claim")
        raise


def run_once(settings: Settings, now: datetime | None = None) -> int:
    db = SupabaseRestClient(settings.supabase_url, settings.service_role_key)
    telegram = TelegramClient(settings.telegram_bot_token)
    now_utc = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    sent = 0
    for profile in db.active_profiles():
        try:
            sent += int(process_profile(db, telegram, settings, profile, now_utc))
        except Exception:
            logging.exception("daily digest failed for one profile")
    return sent


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = load_settings()
    logging.info("daily digest worker started; target time=%s", settings.digest_time)
    while True:
        run_once(settings)
        time.sleep(settings.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
