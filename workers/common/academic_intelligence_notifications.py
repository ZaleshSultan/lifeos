"""Prepare bounded consented jobs through the existing reminder worker only."""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
UUID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
SAFE_LINK = re.compile(r"https://(?:lifeos\.zalewko\.me/tma/\?screen=(?:study|settings)(?:&[A-Za-z]+=[A-Za-z0-9_-]+)*|lms\.astanait\.edu\.kz/(?:course/view|mod/(?:assign|quiz)/view)\.php\?id=[1-9]\d{0,15})")


def render_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps({"candidate": candidate, "now": datetime.now(timezone.utc).isoformat()}, allow_nan=False).encode()
    if len(data) > 2097152:
        raise ValueError("academic_candidate_too_large")
    completed = subprocess.run(["/usr/bin/node", "--max-old-space-size=128", "--import", "tsx", str(ROOT / "scripts/render-academic-notification.ts")],
        input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15, cwd=ROOT,
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8", "NODE_ENV": "production"})
    if completed.returncode or len(completed.stdout) > 20000:
        raise ValueError("academic_render_unavailable")
    result = json.loads(completed.stdout)
    if not isinstance(result, dict) or set(result) != {"message", "links"} or not isinstance(result["message"], str) or not 1 <= len(result["message"]) <= 3500:
        raise ValueError("academic_render_invalid")
    validated_links(result["links"])
    return result


def validated_links(links: Any) -> dict | None:
    if not isinstance(links, list) or len(links) > 3:
        raise ValueError("academic_links_invalid")
    buttons = []
    for link in links:
        if not isinstance(link, dict) or set(link) != {"text", "url"} or not isinstance(link["text"], str) or not 1 <= len(link["text"]) <= 80 or not isinstance(link["url"], str) or SAFE_LINK.fullmatch(link["url"]) is None:
            raise ValueError("academic_links_invalid")
        buttons.append([{"text": link["text"], "url": link["url"]}])
    return {"inline_keyboard": buttons} if buttons else None


def plan_intelligence_notifications(store: Any, *, owner_limit: int = 1000, renderer=render_candidate) -> dict[str, int]:
    if type(owner_limit) is not int or not 1 <= owner_limit <= 1000:
        raise ValueError("academic_owner_limit_invalid")
    total = {"queued": 0, "cancelled": 0, "failed": 0}
    after = None
    seen = set()
    while len(seen) < owner_limit:
        query = {"select": "user_id", "order": "user_id.asc", "limit": str(min(100, owner_limit-len(seen)))}
        if after is not None:
            query["user_id"] = "gt." + after
        rows = store.request("GET", "academic_intelligence_preferences", query)
        if not isinstance(rows, list) or len(rows) > int(query["limit"]):
            raise ValueError("academic_owner_page_invalid")
        for row in rows:
            owner = row.get("user_id")
            if not isinstance(owner, str) or UUID.fullmatch(owner) is None or owner in seen or (after and owner <= after):
                raise ValueError("academic_owner_scope_invalid")
            seen.add(owner); after = owner
            try:
                candidates = store.request("POST", "rpc/academic_intelligence_planning_candidates", body={"p_user_id": owner, "p_at": datetime.now(timezone.utc).isoformat()})
                if not isinstance(candidates, list) or len(candidates) > 10:
                    raise ValueError("academic_candidates_invalid")
                for candidate in candidates:
                    prepared = renderer(candidate)
                    acknowledged = store.request("POST", "rpc/prepare_academic_intelligence_notification", body={
                        "p_user_id": owner, "p_key": candidate["key"], "p_fingerprint": candidate["fingerprint"],
                        "p_message": prepared["message"], "p_links": prepared["links"]})
                    if type(acknowledged) is not bool:
                        raise ValueError("academic_prepare_invalid")
                    total["queued"] += int(acknowledged)
            except Exception:
                total["failed"] += 1
        if len(rows) < int(query["limit"]):
            break
    return total
