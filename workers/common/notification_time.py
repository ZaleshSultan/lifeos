"""Recipient-local notification times with explicit DST gap and fold rules."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def timezone_for(name: str | tzinfo) -> tzinfo:
    """Invalid or missing profile zones fall back to UTC, never server local time."""
    if isinstance(name, tzinfo):
        return name
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, TypeError, ValueError):
        return timezone.utc


def _wall_candidates(wall: datetime, tz: tzinfo) -> list[datetime]:
    candidates: dict[datetime, datetime] = {}
    for fold in (0, 1):
        candidate = wall.replace(tzinfo=tz, fold=fold)
        utc = candidate.astimezone(timezone.utc)
        # Assigning ZoneInfo directly can manufacture a nonexistent local time.
        if utc.astimezone(tz).replace(tzinfo=None) == wall:
            candidates[utc] = candidate
    return [candidates[key] for key in sorted(candidates)]


def resolve_local_datetime(
    day: date,
    hhmm: str,
    timezone_name: str | tzinfo,
    *,
    not_before: datetime | None = None,
) -> datetime:
    """Resolve a local clock time to a real instant.

    A spring-forward gap advances to the first valid local minute. A repeated
    fall-back time uses its earlier occurrence, or the first occurrence at or
    after ``not_before``. The optional floor is compared in UTC.
    """
    clock = time.fromisoformat(hhmm)
    if clock.tzinfo is not None:
        raise ValueError("Notification clock time must not include a UTC offset")
    wall = datetime.combine(day, clock)
    tz = timezone_for(timezone_name)
    candidates = _wall_candidates(wall, tz)
    if not candidates:
        # IANA includes full skipped dates. Bound the search to two days rather
        # than ever constructing an imaginary time or looping indefinitely.
        for minute in range(1, 2 * 24 * 60 + 1):
            candidates = _wall_candidates(wall + timedelta(minutes=minute), tz)
            if candidates:
                break
    floor = not_before.astimezone(timezone.utc) if not_before is not None else None
    for candidate in candidates:
        if floor is None or candidate.astimezone(timezone.utc) >= floor:
            return candidate
    raise ValueError("Local notification time is earlier than its UTC floor")


def in_quiet_hours(
    value: datetime, start: str, end: str, timezone_name: str | tzinfo
) -> bool:
    current = value.astimezone(timezone_for(timezone_name)).time().replace(tzinfo=None)
    start_time, end_time = time.fromisoformat(start), time.fromisoformat(end)
    if start_time == end_time:
        return False
    if start_time < end_time:
        return start_time <= current < end_time
    return current >= start_time or current < end_time


def next_quiet_end(
    value: datetime, start: str, end: str, timezone_name: str | tzinfo
) -> datetime:
    """Return this quiet interval's end in UTC, including DST and daytime hours."""
    if not in_quiet_hours(value, start, end, timezone_name):
        return value.astimezone(timezone.utc)
    local = value.astimezone(timezone_for(timezone_name))
    target_day = local.date()
    start_time, end_time = time.fromisoformat(start), time.fromisoformat(end)
    if start_time > end_time and local.time().replace(tzinfo=None) >= start_time:
        target_day += timedelta(days=1)
    return resolve_local_datetime(
        target_day,
        end,
        timezone_name,
        not_before=value,
    ).astimezone(timezone.utc)


def quiet_hour_deferral_at(
    now: datetime,
    event_at: datetime,
    start: str,
    end: str,
    timezone_name: str | tzinfo,
) -> datetime | None:
    """Defer ordinary reminders, keeping at least one hour before their event."""
    now_utc, event_utc = now.astimezone(timezone.utc), event_at.astimezone(timezone.utc)
    if event_utc - now_utc <= timedelta(hours=1):
        return None
    if not in_quiet_hours(now_utc, start, end, timezone_name):
        return None
    return min(
        next_quiet_end(now_utc, start, end, timezone_name),
        event_utc - timedelta(hours=1),
    )
