"""Bounded planning through the existing database/queue and verified public map cache.

No external AI, second scheduler, image fetcher or Telegram sender lives here.
"""
from __future__ import annotations

import functools
import hashlib
import json
import re
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MAP_COMMIT = "028869ba9f6b03627d7bef64511491101adf2ace"
PUBLIC_ORIGIN = "https://lifeos.zalewko.me"
ROOM = re.compile(r"C1\.[123]\.[123][0-9]{2}[KLP]?")
UUID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")


def plan_notifications(store: Any, *, owner_limit: int = 1000) -> dict[str, int]:
    """Called only by the existing worker after its explicit operator flag gate.

    Source eligibility, current consent, time and idempotency are authoritative
    inside the same SQL helpers used again immediately before delivery.
    """
    if type(owner_limit) is not int or not 1 <= owner_limit <= 1000:
        raise ValueError("academic_owner_limit_invalid")
    total = {"queued": 0, "cancelled": 0, "failed": 0}
    after = None
    seen: set[str] = set()
    while len(seen) < owner_limit:
        query = {"select": "user_id,preferences", "order": "user_id.asc", "limit": str(min(100, owner_limit - len(seen)))}
        if after is not None:
            query["user_id"] = "gt." + after
        rows = store.request("GET", "academic_notification_preferences", query)
        if not isinstance(rows, list) or len(rows) > int(query["limit"]):
            raise ValueError("academic_owner_page_invalid")
        if not rows:
            break
        for row in rows:
            owner = row.get("user_id") if isinstance(row, dict) else None
            if not isinstance(owner, str) or UUID.fullmatch(owner) is None or owner in seen or (after is not None and owner <= after):
                raise ValueError("academic_owner_scope_invalid")
            seen.add(owner)
            after = owner
            preferences = row.get("preferences")
            if not isinstance(preferences, dict) or not any(preferences.get(k) is True for k in ["classAlertsEnabled", "assignmentAlertsEnabled", "examAlertsEnabled", "personalAlertsEnabled", "staleWarningEnabled"]):
                # Defaults do not initialize source planning or create jobs.
                continue
            try:
                result = store.request("POST", "rpc/plan_academic_notifications", body={"p_user_id": owner})
                if not isinstance(result, dict) or any(type(result.get(k)) is not int or result[k] < 0 for k in ["queued", "cancelled"]):
                    raise ValueError("academic_plan_result_invalid")
                total["queued"] += result["queued"]
                total["cancelled"] += result["cancelled"]
            except Exception:
                total["failed"] += 1
        if len(rows) < int(query["limit"]):
            break
    from common.academic_grade_events import grade_events_enabled
    if grade_events_enabled():
        from common.academic_intelligence_notifications import plan_intelligence_notifications
        prepared = plan_intelligence_notifications(store, owner_limit=owner_limit)
        for key in total:
            total[key] += prepared[key]
    return total


@functools.lru_cache(maxsize=1)
def _map_manifest() -> dict:
    path = PROJECT_ROOT / "packages/core/src/campus-map-data.json"
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
        raise ValueError("academic_map_unavailable")
    data = json.loads(path.read_bytes())
    if data.get("version") != 1 or data.get("sourceCommit") != MAP_COMMIT or data.get("interactiveUrl") != "https://yuujiso.github.io/aitumap/" or data.get("aliases") != {"C1.3.319": "C1.3.319P"} or not isinstance(data.get("rooms"), dict):
        raise ValueError("academic_map_unverified")
    return data


def room_photo(room: object, kind: object) -> str | None:
    """Return one fixed-origin URL only after exact inventory and local PNG checks.

    Unavailable media is a text/link fallback before any send begins; never a
    second send after an ambiguous photo request.
    """
    if kind not in {"class", "university_exam"} or not isinstance(room, str):
        return None
    name = room.strip().upper()
    if ROOM.fullmatch(name) is None:
        return None
    try:
        manifest = _map_manifest()
        name = manifest["aliases"].get(name, name)
        row = manifest["rooms"].get(name)
        expected_path = f"/tma/campus-maps/{MAP_COMMIT}/{name}.png"
        if not isinstance(row, dict) or row.get("imagePath") != expected_path or type(row.get("bytes")) is not int or not 8 <= row["bytes"] <= 2 * 1024 * 1024 or not isinstance(row.get("sha256"), str) or re.fullmatch(r"[a-f0-9]{64}", row["sha256"]) is None:
            return None
        path = PROJECT_ROOT / "apps/tma/dist" / expected_path.removeprefix("/tma/")
        if any(parent.is_symlink() for parent in [path, *path.parents[:5]]) or not path.is_file() or path.stat().st_size != row["bytes"]:
            return None
        raw = path.read_bytes()
        if not raw.startswith(b"\x89PNG\r\n\x1a\n") or hashlib.sha256(raw).hexdigest() != row["sha256"]:
            return None
        return PUBLIC_ORIGIN + expected_path
    except (OSError, ValueError, TypeError, KeyError):
        return None


def clip_utf16(value: str, limit: int) -> str:
    encoded = value.encode("utf-16-le")
    if len(encoded) <= limit * 2:
        return value
    return encoded[: (limit - 1) * 2].decode("utf-16-le", errors="ignore") + "…"


def photo_caption(metadata: dict, timezone_name: str, local_label: Any) -> str:
    title = str(metadata.get("academic_title") or "Занятие").strip()
    room = str(metadata.get("academic_room") or "не подтверждена").strip()
    start = str(metadata.get("academic_start") or "").strip()
    lines = ["📚 " + clip_utf16(title, 300), "Начало: " + local_label(start, timezone_name), "Аудитория: " + clip_utf16(room, 200)]
    if metadata.get("academic_source_type") in {"exam", "examfx"}:
        lines.append("Код источника: " + metadata["academic_source_type"])
    lines.append("Карта: Yuujiso/aitumap (MIT).")
    return clip_utf16("\n".join(lines), 1024)
