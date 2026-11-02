"""Strict opt-in notification timing and a bounded deterministic renderer bridge."""
from __future__ import annotations

import json
import os
import re
import selectors
import shutil
import signal
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from common.notification_time import in_quiet_hours, resolve_local_datetime

_BOOL_KEYS = ("morningEnabled", "eveningEnabled", "hydrationRemindersEnabled", "includeHealth", "includeFilming")
_CLOCK_KEYS = ("morningTime", "eveningTime", "quietStart", "quietEnd")

def notification_preferences(value: Any) -> dict | None:
    if not isinstance(value, dict) or set(value) != {*_BOOL_KEYS, *_CLOCK_KEYS, "revision"}:
        return None
    if type(value["revision"]) is not int or not 1 <= value["revision"] <= 2147483647:
        return None
    if any(type(value[k]) is not bool for k in _BOOL_KEYS):
        return None
    if any(not isinstance(value[k], str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value[k]) for k in _CLOCK_KEYS):
        return None
    return dict(value)

def clip_message(value: str, limit: int = 3500) -> str:
    result, used = [], 0
    for character in value:
        size = 2 if ord(character) > 0xFFFF else 1
        if used + size > limit:
            break
        result.append(character)
        used += size
    return "".join(result)

def optional_notification_times(local_now: datetime, prefs: dict) -> list[tuple[str, datetime]]:
    """One evening review near delivery time; at most two generic water nudges."""
    result: list[tuple[str, datetime]] = []
    if prefs["eveningEnabled"]:
        due = resolve_local_datetime(local_now.date(), prefs["eveningTime"], local_now.tzinfo)
        elapsed = local_now.astimezone(timezone.utc) - due.astimezone(timezone.utc)
        if timedelta(0) <= elapsed < timedelta(hours=1) and not in_quiet_hours(local_now, prefs["quietStart"], prefs["quietEnd"], local_now.tzinfo):
            result.append(("evening", due))
    if prefs["hydrationRemindersEnabled"]:
        def minutes(clock: str) -> int:
            hour, minute = map(int, clock.split(":"))
            return hour * 60 + minute
        start, end = minutes(prefs["quietEnd"]), minutes(prefs["quietStart"])
        length = (end - start) % 1440 or 1440
        clocks = sorted({(start + length // 3) % 1440, (start + 2 * length // 3) % 1440})
        for index, clock in enumerate(clocks, 1):
            due = resolve_local_datetime(local_now.date(), f"{clock // 60:02d}:{clock % 60:02d}", local_now.tzinfo)
            if due.astimezone(timezone.utc) < local_now.astimezone(timezone.utc) - timedelta(hours=1):
                continue
            if in_quiet_hours(due, prefs["quietStart"], prefs["quietEnd"], local_now.tzinfo):
                continue
            result.append((f"hydration_{index}", due))
    return result

def _bounded_process(command: list[str], body: bytes, env: dict[str, str], *, cwd: Path, timeout: float = 30) -> bytes | None:
    process = None
    selector = selectors.DefaultSelector()
    try:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   env=env, cwd=cwd, shell=False, start_new_session=True)
        assert process.stdin and process.stdout
        process.stdin.write(body)
        process.stdin.close()
        os.set_blocking(process.stdout.fileno(), False)
        selector.register(process.stdout, selectors.EVENT_READ)
        deadline, output = time.monotonic() + timeout, bytearray()
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            for key, _event in selector.select(min(remaining, 0.25)):
                chunk = os.read(key.fileobj.fileno(), 8193 - len(output))
                if not chunk:
                    selector.unregister(key.fileobj)
                    break
                output.extend(chunk)
                if len(output) > 8192:
                    return None
        process.wait(timeout=max(0.01, deadline-time.monotonic()))
        return bytes(output) if process.returncode == 0 else None
    except Exception:
        return None
    finally:
        selector.close()
        if process is not None:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=5)
                except Exception:
                    pass
            if process.stdout:
                process.stdout.close()
            if process.stdin and not process.stdin.closed:
                process.stdin.close()

def render_briefing(settings: Any, user_id: str, local_date: str, kind: str, prefs: dict) -> str | None:
    repository = Path(__file__).resolve().parents[2]
    script = repository / "scripts" / "render-daily-briefing.ts"
    node = shutil.which("node")
    if not node or not script.is_file() or kind not in {"morning", "evening"}:
        return None
    body = json.dumps({"userId": user_id, "date": local_date, "kind": kind,
                       "includeHealth": prefs["includeHealth"], "includeFilming": prefs["includeFilming"]}).encode()
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LANG": "C.UTF-8", "NODE_ENV": "production",
           "SUPABASE_URL": settings.supabase_url, "SUPABASE_SERVICE_ROLE_KEY": settings.service_role_key}
    raw = _bounded_process([node, "--max-old-space-size=128", "--import", "tsx", str(script)], body, env, cwd=repository)
    if raw is None:
        return None
    try:
        data = json.loads(raw)
        if not isinstance(data, dict) or set(data) != {"ok", "text"} or data["ok"] is not True or not isinstance(data["text"], str) or not data["text"].strip():
            return None
        return clip_message(data["text"])
    except (ValueError, UnicodeDecodeError):
        return None
