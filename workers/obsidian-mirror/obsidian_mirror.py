#!/usr/bin/env python3
"""Mirror LifeOS Supabase sync jobs into an Obsidian vault."""

from __future__ import annotations

import argparse
import errno
import json
import os
import re
import sys
import shutil
import tempfile
import time
import uuid
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


JsonObject = dict[str, Any]
LEGACY_SINGLE_USER_ENV = "LIFEOS_ENABLE_LEGACY_SINGLE_USER_OBSIDIAN"
FAIL_ON_SYNC_CONFLICTS_ENV = "OBSIDIAN_MIRROR_FAIL_ON_SYNC_CONFLICTS"
MULTITENANT_VAULT_ROOT = Path("/var/lifeos/vaults").resolve()

SUPPORTED_RENDER_TYPES = {
    "task",
    "deadline",
    "capture",
    "health",
    "health_daily",
    "review",
    "expense",
    "spend",
    "finance",
    "workout",
}

FORBIDDEN_SEGMENT_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
WINDOWS_ABSOLUTE_PATH = re.compile(r"^[a-zA-Z]:[\\/]")
PATH_TRAVERSAL_TOKEN = re.compile(r"(?:^|[\\/])\.\.(?:[\\/]|$)|\.\.[\\/]|[\\/]\.\.")
PERCENT_ENCODED_PATH_SEPARATOR = re.compile(r"%2f|%5c", re.IGNORECASE)
SYNCTHING_CONFLICT_MARKER = re.compile(r"\.sync-conflict-", re.IGNORECASE)
STIGNORE_LIFEOS_BEGIN = "# BEGIN LifeOS managed ignores"
STIGNORE_LIFEOS_END = "# END LifeOS managed ignores"
STIGNORE_LIFEOS_BLOCK = "\n".join(
    [
        STIGNORE_LIFEOS_BEGIN,
        "(?d).lifeos-tmp/",
        "(?d)*.tmp-lifeos",
        "(?d).*tmp-lifeos",
        STIGNORE_LIFEOS_END,
        "",
    ]
)
INITIALIZED_USERS: set[str] = set()
INITIALIZED_DASHBOARD_KEYS: set[tuple[str, str]] = set()
RESERVED_WINDOWS_NAMES = {
    "con",
    "prn",
    "aux",
    "nul",
    "com1",
    "com2",
    "com3",
    "com4",
    "com5",
    "com6",
    "com7",
    "com8",
    "com9",
    "lpt1",
    "lpt2",
    "lpt3",
    "lpt4",
    "lpt5",
    "lpt6",
    "lpt7",
    "lpt8",
    "lpt9",
}


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    service_role_key: str
    batch_size: int
    interval_seconds: int
    dashboard_dir: str
    fail_on_sync_conflicts: bool = True
    legacy_vault_path: Path | None = None


@dataclass(frozen=True)
class RenderedNote:
    relative_segments: list[str]
    markdown: str


class WorkerError(RuntimeError):
    """Expected worker failure that can be written to queue last_error."""


CURRENT_RENDER_TIMEZONE = "UTC"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()

        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")

        if key and key not in os.environ:
            os.environ[key] = value


def getenv_required(name: str) -> str:
    value = os.environ.get(name, "").strip()

    if not value:
        raise WorkerError(f"Missing required environment variable: {name}")

    return value


def getenv_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()

    if not raw:
        return default

    try:
        return int(raw)
    except ValueError as exc:
        raise WorkerError(f"{name} must be an integer") from exc


def getenv_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def resolve_vault_path(value: str | Path | None) -> Path:
    raw = str(value or "").strip()
    if not raw:
        raise WorkerError("Obsidian vault path is empty")
    return Path(raw).expanduser().resolve()


def load_settings(env_file: Path | None = None) -> Settings:
    default_env = Path(__file__).with_name(".env")
    load_dotenv(default_env)

    if env_file is not None:
        load_dotenv(env_file)

    legacy_vault_path = (
        resolve_vault_path(getenv_required("OBSIDIAN_VAULT_PATH"))
        if getenv_bool(LEGACY_SINGLE_USER_ENV)
        else None
    )

    return Settings(
        supabase_url=getenv_required("SUPABASE_URL").rstrip("/"),
        service_role_key=getenv_required("SUPABASE_SERVICE_ROLE_KEY"),
        batch_size=getenv_int("OBSIDIAN_MIRROR_BATCH_SIZE", 10),
        interval_seconds=getenv_int("OBSIDIAN_MIRROR_INTERVAL_SECONDS", 30),
        dashboard_dir=os.environ.get("OBSIDIAN_MIRROR_DASHBOARD_DIR", "Dashboards").strip()
        or "Dashboards",
        fail_on_sync_conflicts=getenv_bool(FAIL_ON_SYNC_CONFLICTS_ENV, True),
        legacy_vault_path=legacy_vault_path,
    )


class SupabaseRestClient:
    def __init__(self, url: str, service_role_key: str) -> None:
        self.base_url = f"{url.rstrip('/')}/rest/v1"
        self.headers = {
            "apikey": service_role_key,
            "authorization": f"Bearer {service_role_key}",
            "content-type": "application/json",
            "accept": "application/json",
        }

    def request(
        self,
        method: str,
        table: str,
        query: dict[str, str] | None = None,
        body: Any | None = None,
        prefer: str | None = None,
    ) -> Any:
        encoded_query = urllib.parse.urlencode(query or {})
        url = f"{self.base_url}/{table}"

        if encoded_query:
            url = f"{url}?{encoded_query}"

        headers = dict(self.headers)

        if prefer:
            headers["prefer"] = prefer

        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(url, data=data, headers=headers, method=method)

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise WorkerError(f"Supabase {method} {table} failed: {exc.code} {detail}") from exc
        except urllib.error.URLError as exc:
            raise WorkerError(f"Supabase {method} {table} failed: {exc.reason}") from exc

        if not raw:
            return None

        return json.loads(raw)

    def list_pending_jobs(self, limit: int) -> list[JsonObject]:
        rows = self.request(
            "GET",
            "obsidian_sync_queue",
            {
                "select": "*",
                "status": "eq.pending",
                "available_at": f"lte.{utc_now()}",
                "order": "created_at.asc",
                "limit": str(limit),
            },
        )
        return rows or []

    def claim_job(self, job: JsonObject) -> JsonObject | None:
        rows = self.request(
            "PATCH",
            "obsidian_sync_queue",
            {
                "id": f"eq.{job['id']}",
                "status": "eq.pending",
                "select": "*",
            },
            {
                "status": "processing",
                "attempts": int(job.get("attempts") or 0) + 1,
                "locked_at": utc_now(),
                "last_error": None,
            },
            prefer="return=representation",
        )

        if not rows:
            return None

        return rows[0]

    def complete_job(self, job_id: str) -> None:
        self.request(
            "PATCH",
            "obsidian_sync_queue",
            {"id": f"eq.{job_id}"},
            {
                "status": "completed",
                "completed_at": utc_now(),
                "locked_at": None,
                "last_error": None,
            },
        )

    def fail_job(self, job_id: str, error: str) -> None:
        self.request(
            "PATCH",
            "obsidian_sync_queue",
            {"id": f"eq.{job_id}"},
            {
                "status": "failed",
                "locked_at": None,
                "last_error": error[:2000],
            },
        )

    def defer_job(self, job_id: str, error: str, delay_seconds: int = 3600) -> None:
        available_at = (
            datetime.now(timezone.utc) + timedelta(seconds=delay_seconds)
        ).isoformat().replace("+00:00", "Z")
        self.request(
            "PATCH",
            "obsidian_sync_queue",
            {"id": f"eq.{job_id}"},
            {
                "status": "pending",
                "available_at": available_at,
                "locked_at": None,
                "last_error": error[:2000],
            },
        )

    def fetch_one(
        self,
        table: str,
        row_id: str,
        user_id: str | None = None,
    ) -> JsonObject | None:
        query = {
            "select": "*",
            "id": f"eq.{row_id}",
            "limit": "1",
        }
        if user_id is not None:
            query["user_id"] = f"eq.{user_id}"

        rows = self.request(
            "GET",
            table,
            query,
        )

        if not rows:
            return None

        return rows[0]

    def get_user_obsidian_settings(self, user_id: str) -> JsonObject | None:
        rows = self.request(
            "GET",
            "user_obsidian_settings",
            {
                "select": "user_id,enabled,mode,vault_path,status,is_active,syncthing_folder_id,timezone",
                "user_id": f"eq.{user_id}",
                "limit": "1",
            },
        )
        return rows[0] if rows else None

    def list_active_obsidian_settings(self) -> list[JsonObject]:
        rows = self.request(
            "GET",
            "user_obsidian_settings",
            {
                "select": "user_id,enabled,mode,vault_path,status,is_active,syncthing_folder_id,timezone",
                "limit": "10000",
            },
        )
        return rows or []


def is_syncthing_or_local_settings(row: JsonObject) -> bool:
    mode = str(row.get("mode") or "").strip()
    enabled = bool(row.get("enabled"))
    is_active = bool(row.get("is_active"))
    status = str(row.get("status") or "").strip()

    if mode not in {"syncthing", "local_vault"}:
        return False

    return enabled and is_active and status == "connected"


def server_owned_user_vault_path(user_id: str) -> Path:
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        raise WorkerError("Cannot resolve vault path without user_id")
    return (MULTITENANT_VAULT_ROOT / normalized_user_id).resolve()


def vault_path_from_settings_row(row: JsonObject) -> Path | None:
    user_id = str(row.get("user_id") or "").strip()

    if not user_id or not is_syncthing_or_local_settings(row):
        return None

    expected = server_owned_user_vault_path(user_id)
    configured = resolve_vault_path(row.get("vault_path"))

    if configured != expected:
        raise WorkerError(
            f"Unsafe vault_path for user {user_id}: expected {expected}, got {configured}"
        )

    return configured


def assert_safe_target_path(raw_path: str) -> str:
    normalized = unicodedata.normalize("NFKC", raw_path).strip()
    decoded = urllib.parse.unquote(normalized)

    if not normalized:
        raise WorkerError("Queue target_path is empty")

    if normalized.startswith(("/", "\\")) or WINDOWS_ABSOLUTE_PATH.search(normalized):
        raise WorkerError("Queue target_path must be relative")

    if decoded.startswith(("/", "\\")) or WINDOWS_ABSOLUTE_PATH.search(decoded):
        raise WorkerError("Queue target_path must be relative")

    if PATH_TRAVERSAL_TOKEN.search(decoded) or PERCENT_ENCODED_PATH_SEPARATOR.search(normalized):
        raise WorkerError("Queue target_path contains a path traversal token")

    return decoded


def sanitize_segment(value: Any, fallback: str = "untitled", max_length: int = 120) -> str:
    original = unicodedata.normalize("NFKC", str(value or "")).strip()
    text = urllib.parse.unquote(original)

    if text.startswith(("/", "\\")) or WINDOWS_ABSOLUTE_PATH.search(text):
        text = text.lstrip("/\\")

    # Escape all path separators and traversal markers before joining paths.
    # Titles such as "foo/bar" become a safe single file segment, not a folder.
    text = text.replace("/", "-").replace("\\", "-")
    text = text.replace("..", "-")
    text = FORBIDDEN_SEGMENT_CHARS.sub("-", text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"-+", "-", text)
    text = text.strip(" .-")[:max_length].strip(" .-")

    if not text:
        text = fallback

    reserved_base = text.split(".", 1)[0].lower()
    if reserved_base in RESERVED_WINDOWS_NAMES:
        text = f"{text}-note"

    return text


def short_id(value: str | None) -> str:
    if not value:
        return "unknown"
    return value.split("-")[0][:8]


def normalize_timezone_name(value: Any) -> str:
    name = str(value or "UTC").strip() or "UTC"
    try:
        ZoneInfo(name)
        return name
    except ZoneInfoNotFoundError:
        print(f"invalid user timezone {name!r}; falling back to UTC", file=sys.stderr)
        return "UTC"


def set_render_timezone(timezone_name: str) -> str:
    global CURRENT_RENDER_TIMEZONE
    previous = CURRENT_RENDER_TIMEZONE
    CURRENT_RENDER_TIMEZONE = normalize_timezone_name(timezone_name)
    return previous


def date_part(value: Any) -> str:
    text = str(value or "").strip()

    if text:
        try:
            normalized = text.replace("Z", "+00:00")
            parsed = datetime.fromisoformat(normalized)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(ZoneInfo(CURRENT_RENDER_TIMEZONE)).date().isoformat()
        except ValueError:
            match = re.match(r"(\d{4}-\d{2}-\d{2})", text)
            if match:
                return match.group(1)

    return datetime.now(timezone.utc).astimezone(ZoneInfo(CURRENT_RENDER_TIMEZONE)).date().isoformat()




def assert_real_path_inside_vault(vault: Path, target: Path) -> Path:
    vault_real = Path(os.path.realpath(vault))
    target_abs = Path(target)

    # Refuse to write through a final symlink even when it points back inside.
    # Syncthing may propagate symlinks from untrusted client devices.
    if target_abs.is_symlink():
        raise WorkerError(f"Refusing to write through symlink: {target_abs}")

    target_abs.parent.mkdir(parents=True, exist_ok=True)
    parent_real = Path(os.path.realpath(target_abs.parent))

    try:
        parent_common = os.path.commonpath([str(vault_real), str(parent_real)])
    except ValueError as exc:
        raise WorkerError("Resolved note parent is outside the vault") from exc

    if parent_common != str(vault_real):
        raise WorkerError("Resolved note parent is outside the vault")

    if target_abs.exists():
        target_real = Path(os.path.realpath(target_abs))
        try:
            target_common = os.path.commonpath([str(vault_real), str(target_real)])
        except ValueError as exc:
            raise WorkerError("Resolved note path is outside the vault") from exc

        if target_common != str(vault_real):
            raise WorkerError("Resolved note path is outside the vault")

        return target_real

    return parent_real / target_abs.name


def safe_read_text(path: Path, vault: Path) -> str:
    real_path = assert_real_path_inside_vault(vault, path)
    return real_path.read_text(encoding="utf-8")


def note_path(vault: Path, relative_segments: list[str]) -> Path:
    if not relative_segments:
        raise WorkerError("Note path requires at least one segment")

    vault = resolve_vault_path(vault)
    safe_segments = [sanitize_segment(segment) for segment in relative_segments]
    safe_segments[-1] = sanitize_segment(safe_segments[-1].removesuffix(".md")) + ".md"
    target = vault.joinpath(*safe_segments).resolve()

    try:
        common = os.path.commonpath([str(vault), str(target)])
    except ValueError as exc:
        raise WorkerError("Resolved note path is outside the vault") from exc

    if common != str(vault):
        raise WorkerError("Resolved note path is outside the vault")

    return target


def is_syncthing_conflict_file(path: Path) -> bool:
    return path.is_file() and SYNCTHING_CONFLICT_MARKER.search(path.name) is not None


def find_syncthing_conflicts(vault: Path, limit: int = 20) -> list[Path]:
    resolved = resolve_vault_path(vault)
    if not resolved.exists():
        return []

    conflicts: list[Path] = []
    for path in resolved.rglob("*"):
        if is_syncthing_conflict_file(path):
            conflicts.append(path)
            if len(conflicts) >= limit:
                break
    return conflicts


def conflict_summary(vault: Path, conflicts: list[Path]) -> str:
    resolved = resolve_vault_path(vault)
    relative = []
    for path in conflicts[:5]:
        try:
            relative.append(str(path.relative_to(resolved)))
        except ValueError:
            relative.append(path.name)
    suffix = "" if len(conflicts) <= 5 else f" and {len(conflicts) - 5} more"
    return ", ".join(relative) + suffix


def queued_target_segments(job: JsonObject) -> list[str] | None:
    target_path = str(job.get("target_path") or "").strip()

    if not target_path:
        return None

    safe_target_path = assert_safe_target_path(target_path)
    segments = [segment for segment in re.split(r"[\\/]+", safe_target_path) if segment]

    if not segments or any(segment in {".", ".."} or ".." in segment for segment in segments):
        raise WorkerError("Queue target_path contains an unsafe segment")

    return [sanitize_segment(segment) for segment in segments]


def yaml_scalar(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def frontmatter(entity: JsonObject, extra: JsonObject | None = None) -> str:
    fields = {
        "id": entity.get("id"),
        "type": entity.get("entity_type"),
        "user_id": entity.get("user_id"),
        "source": entity.get("source"),
        "created_at": entity.get("created_at"),
        "updated_at": entity.get("updated_at"),
    }

    if extra:
        fields.update(extra)

    lines = ["---"]

    for key, value in fields.items():
        if value is not None:
            lines.append(f"{key}: {yaml_scalar(value)}")

    lines.append("---")
    return "\n".join(lines)


def md_table(rows: list[tuple[str, Any]]) -> str:
    visible_rows = [(key, value) for key, value in rows if value not in (None, "")]

    if not visible_rows:
        return ""

    output = ["| Field | Value |", "| --- | --- |"]

    for key, value in visible_rows:
        output.append(f"| {key} | {value} |")

    return "\n".join(output)


def body_block(entity: JsonObject) -> str:
    body = str(entity.get("body") or "").strip()
    return f"\n## Notes\n\n{body}\n" if body else ""


def linked_block(entity: JsonObject) -> str:
    rows = [
        ("Linked table", entity.get("linked_table")),
        ("Linked id", entity.get("linked_id")),
        ("Source command", entity.get("source_command")),
    ]
    table = md_table(rows)
    return f"\n## Source\n\n{table}\n" if table else ""


def render_task(entity: JsonObject, detail: JsonObject | None) -> RenderedNote:
    title = entity.get("title") or "Task"
    due = entity.get("due_at") or (detail or {}).get("due_at")
    created = date_part(entity.get("created_at"))
    markdown = "\n\n".join(
        [
            frontmatter(entity, {"kind": "task", "due_at": due}),
            f"# Task: {title}",
            md_table(
                [
                    ("Status", (detail or {}).get("status")),
                    ("Priority", (detail or {}).get("priority")),
                    ("Due", due),
                    ("Created", entity.get("created_at")),
                ]
            ),
            body_block(entity).strip(),
            linked_block(entity).strip(),
        ]
    ).strip() + "\n"
    return RenderedNote(["Tasks", f"{created} - {title} - {short_id(entity.get('id'))}.md"], markdown)


def render_deadline(entity: JsonObject, detail: JsonObject | None) -> RenderedNote:
    title = entity.get("title") or "Deadline"
    due = entity.get("due_at") or (detail or {}).get("due_at")
    due_date = date_part(due or entity.get("created_at"))
    markdown = "\n\n".join(
        [
            frontmatter(entity, {"kind": "deadline", "due_at": due}),
            f"# Deadline: {title}",
            md_table([("Due", due), ("Task status", (detail or {}).get("status"))]),
            body_block(entity).strip(),
            linked_block(entity).strip(),
        ]
    ).strip() + "\n"
    return RenderedNote(["Deadlines", f"{due_date} - {title} - {short_id(entity.get('id'))}.md"], markdown)


def render_capture(entity: JsonObject, _detail: JsonObject | None) -> RenderedNote:
    title = entity.get("title") or "Capture"
    created = date_part(entity.get("created_at"))
    markdown = "\n\n".join(
        [
            frontmatter(entity, {"kind": "capture"}),
            f"# Capture: {title}",
            md_table([("Captured", entity.get("created_at")), ("Source", entity.get("source"))]),
            body_block(entity).strip(),
            linked_block(entity).strip(),
        ]
    ).strip() + "\n"
    return RenderedNote(["Captures", created[:7], f"{created} - {title} - {short_id(entity.get('id'))}.md"], markdown)


def render_review(entity: JsonObject, _detail: JsonObject | None) -> RenderedNote:
    title = entity.get("title") or "Review"
    created = date_part(entity.get("created_at"))
    markdown = "\n\n".join(
        [
            frontmatter(entity, {"kind": "review"}),
            f"# Review: {title}",
            md_table([("Created", entity.get("created_at")), ("Source", entity.get("source"))]),
            body_block(entity).strip(),
            linked_block(entity).strip(),
        ]
    ).strip() + "\n"
    return RenderedNote(["Reviews", f"{created} - {title} - {short_id(entity.get('id'))}.md"], markdown)


def render_expense(entity: JsonObject, _detail: JsonObject | None) -> RenderedNote:
    title = entity.get("title") or "Finance transaction"
    metadata = entity.get("metadata") if isinstance(entity.get("metadata"), dict) else {}
    created = date_part(entity.get("created_at"))
    amount = metadata.get("amount")
    currency = metadata.get("currency")
    transaction_type = metadata.get("transactionType") or "expense"
    finance_status = metadata.get("financeStatus") or entity.get("status") or "confirmed"
    category = metadata.get("category") or "other"
    occurred_on = metadata.get("occurredOn") or created
    markdown = "\n\n".join(
        [
            frontmatter(
                entity,
                {
                    "kind": "finance_transaction",
                    "amount": amount,
                    "currency": currency,
                    "category": category,
                    "transaction_type": transaction_type,
                    "finance_status": finance_status,
                    "occurred_on": occurred_on,
                    "short_id": metadata.get("shortId"),
                    "confidence": metadata.get("confidence"),
                },
            ),
            f"# {str(transaction_type).title()}: {title}",
            md_table(
                [
                    ("Amount", amount),
                    ("Currency", currency),
                    ("Category", category),
                    ("Status", finance_status),
                    ("Occurred on", occurred_on),
                    ("Captured", entity.get("created_at")),
                    ("Source", entity.get("source")),
                ]
            ),
            body_block(entity).strip(),
            linked_block(entity).strip(),
        ]
    ).strip() + "\n"
    return RenderedNote(["Finance", "Transactions", f"{created} - {title} - {short_id(entity.get('id'))}.md"], markdown)


def workout_exercises_block(entity: JsonObject) -> str:
    metadata = entity.get("metadata") if isinstance(entity.get("metadata"), dict) else {}
    exercises = metadata.get("exercises")

    if not isinstance(exercises, list) or not exercises:
        plan = metadata.get("parsedWorkoutPlan")
        if isinstance(plan, list):
            exercises = plan

    if not isinstance(exercises, list) or not exercises:
        return ""

    lines = ["## Exercises"]

    for exercise in exercises:
        if not isinstance(exercise, dict):
            continue

        name = exercise.get("exercise_name") or exercise.get("name") or "Exercise"
        sets_count = exercise.get("sets")
        reps = exercise.get("reps")
        weight = exercise.get("weight_kg") or exercise.get("weight")

        if isinstance(sets_count, int) and isinstance(reps, int):
            target = f"{sets_count}x{reps}"
            if weight:
                target = f"{target} @ {weight} kg"
            lines.append(f"- {name}: {target}")
            continue

        lines.append(f"- {name}")
        sets = exercise.get("sets")

        if not isinstance(sets, list):
            continue

        for current_set in sets:
            if not isinstance(current_set, dict):
                continue

            index = current_set.get("index") or "?"
            completed = "done" if current_set.get("completed") else "open"
            target_reps = current_set.get("targetReps") or current_set.get("reps")
            target_weight = current_set.get("targetWeightKg") or current_set.get("weightKg")
            target = ", ".join(
                str(value)
                for value in (
                    f"{target_reps} reps" if target_reps else None,
                    f"{target_weight} kg" if target_weight else None,
                )
                if value
            )
            suffix = f" ({target})" if target else ""
            lines.append(f"  - Set {index}: {completed}{suffix}")

    return "\n".join(lines)


def render_workout(entity: JsonObject, detail: JsonObject | None) -> RenderedNote:
    title = entity.get("title") or (detail or {}).get("title") or "Workout"
    started = (detail or {}).get("started_at") or entity.get("created_at")
    workout_date = date_part(started)
    exercises = workout_exercises_block(entity)
    markdown = "\n\n".join(
        [
            frontmatter(entity, {"kind": "workout", "started_at": started}),
            f"# Workout: {title}",
            md_table(
                [
                    ("Started", started),
                    ("Ended", (detail or {}).get("ended_at")),
                    ("Type", (detail or {}).get("workout_type")),
                    ("Duration minutes", (detail or {}).get("duration_minutes")),
                    ("Intensity", (detail or {}).get("intensity")),
                ]
            ),
            body_block(entity).strip(),
            exercises,
            linked_block(entity).strip(),
        ]
    ).strip() + "\n"
    return RenderedNote(["Workouts", f"{workout_date} - {title} - {short_id(entity.get('id'))}.md"], markdown)


def render_health_daily(entity: JsonObject, detail: JsonObject | None) -> RenderedNote:
    metadata = entity.get("metadata") if isinstance(entity.get("metadata"), dict) else {}
    missing_metrics = (
        (detail or {}).get("missing_metrics")
        if isinstance((detail or {}).get("missing_metrics"), dict)
        else metadata.get("missingMetrics")
    )
    missing_names = []

    if isinstance(missing_metrics, dict):
        missing_names = [key for key, value in missing_metrics.items() if value is True]

    log_date = (detail or {}).get("log_date") or metadata.get("date") or date_part(entity.get("created_at"))
    title = f"Health Daily {log_date}"
    markdown = "\n\n".join(
        [
            frontmatter(
                entity,
                {
                    "kind": "health_daily",
                    "log_date": log_date,
                    "sleep_minutes": (detail or {}).get("sleep_minutes"),
                    "resting_heart_rate": (detail or {}).get("resting_heart_rate"),
                    "steps": (detail or {}).get("steps"),
                    "active_energy_kcal": (detail or {}).get("active_energy_kcal"),
                    "workout_minutes": (detail or {}).get("workout_minutes"),
                    "mood_score": (detail or {}).get("mood_score"),
                    "energy_score": (detail or {}).get("energy_score"),
                    "stress_score": (detail or {}).get("stress_score"),
                    "missing_metrics": missing_names,
                },
            ),
            f"# {title}",
            md_table(
                [
                    ("Recovery mode", (detail or {}).get("recovery_mode") or metadata.get("recoveryMode")),
                    (
                        "Data completeness",
                        (detail or {}).get("data_completeness_score")
                        or metadata.get("dataCompletenessScore"),
                    ),
                    ("Sleep minutes", (detail or {}).get("sleep_minutes")),
                    ("Deep sleep minutes", (detail or {}).get("deep_sleep_minutes")),
                    ("REM sleep minutes", (detail or {}).get("rem_sleep_minutes")),
                    ("Awake minutes", (detail or {}).get("awake_minutes")),
                    ("Sleep score", (detail or {}).get("sleep_score")),
                    ("Resting heart rate", (detail or {}).get("resting_heart_rate")),
                    ("HRV ms", (detail or {}).get("hrv_ms")),
                    ("SpO2 average", (detail or {}).get("spo2_avg")),
                    ("Steps", (detail or {}).get("steps")),
                    ("Active energy kcal", (detail or {}).get("active_energy_kcal")),
                    ("Workout minutes", (detail or {}).get("workout_minutes")),
                    ("Mood score", (detail or {}).get("mood_score")),
                    ("Energy score", (detail or {}).get("energy_score")),
                    ("Stress score", (detail or {}).get("stress_score")),
                    ("Sync reason", (detail or {}).get("sync_reason") or metadata.get("syncReason")),
                    ("Missing metrics", ", ".join(missing_names) if missing_names else "none"),
                ]
            ),
            body_block(entity).strip(),
            linked_block(entity).strip(),
        ]
    ).strip() + "\n"
    return RenderedNote(["Health", "Daily", f"{log_date}.md"], markdown)


def render_generic_health(entity: JsonObject, detail: JsonObject | None) -> RenderedNote:
    title = entity.get("title") or "Health"
    created = date_part(entity.get("created_at"))
    markdown = "\n\n".join(
        [
            frontmatter(entity, {"kind": "health"}),
            f"# Health: {title}",
            md_table([("Created", entity.get("created_at")), ("Source", entity.get("source"))]),
            body_block(entity).strip(),
            linked_block(entity).strip(),
        ]
    ).strip() + "\n"
    return RenderedNote(["Health", "Entries", f"{created} - {title} - {short_id(entity.get('id'))}.md"], markdown)


def render_entity(entity: JsonObject, detail: JsonObject | None = None) -> RenderedNote:
    entity_type = str(entity.get("entity_type") or "").strip()

    if entity_type == "task":
        return render_task(entity, detail)
    if entity_type == "deadline":
        return render_deadline(entity, detail)
    if entity_type == "capture":
        return render_capture(entity, detail)
    if entity_type == "health_daily":
        return render_health_daily(entity, detail)
    if entity_type == "health":
        return render_generic_health(entity, detail)
    if entity_type == "review":
        return render_review(entity, detail)
    if entity_type in {"expense", "spend", "finance"}:
        return render_expense(entity, detail)
    if entity_type == "workout":
        return render_workout(entity, detail)

    raise WorkerError(f"Unsupported life entity type: {entity_type}")


def atomic_write(path: Path, content: str, vault: Path | None = None) -> None:
    write_path = assert_real_path_inside_vault(vault, path) if vault is not None else path
    write_path.parent.mkdir(parents=True, exist_ok=True)

    fd, temp_name = tempfile.mkstemp(
        prefix=f"lifeos-{write_path.name}.",
        suffix=".tmp-lifeos",
        dir=tempfile.gettempdir(),
        text=True,
    )
    temp_path = Path(temp_name)

    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            if content and not content.endswith("\n"):
                handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())

        if vault is not None:
            write_path = assert_real_path_inside_vault(vault, write_path)

        try:
            os.replace(temp_path, write_path)
        except OSError as exc:
            # /tmp can live on another filesystem than /var/lifeos/vaults.
            # In that case we still avoid exposing noisy temporary files to Syncthing
            # by falling back to an ignored *.tmp-lifeos file inside the target folder.
            if getattr(exc, "errno", None) != errno.EXDEV:
                raise
            replace_via_ignored_same_fs_temp(temp_path, write_path, vault)
    except Exception:
        try:
            temp_path.unlink(missing_ok=True)
        finally:
            raise


def replace_via_ignored_same_fs_temp(source: Path, destination: Path, vault: Path | None) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    same_fs_temp = destination.parent / f".{destination.name}.{uuid.uuid4().hex}.tmp-lifeos"

    try:
        if vault is not None:
            assert_real_path_inside_vault(vault, same_fs_temp)

        shutil.copyfile(source, same_fs_temp)
        with same_fs_temp.open("r+b") as handle:
            handle.flush()
            os.fsync(handle.fileno())

        if vault is not None:
            destination = assert_real_path_inside_vault(vault, destination)

        os.replace(same_fs_temp, destination)
    finally:
        source.unlink(missing_ok=True)
        same_fs_temp.unlink(missing_ok=True)


def write_if_missing(path: Path, content: str, vault: Path | None = None) -> bool:
    checked_path = assert_real_path_inside_vault(vault, path) if vault is not None else path
    if checked_path.exists():
        return False
    atomic_write(checked_path, content, vault)
    return True


DASHBOARDS = {
    "LifeOS.md": """# LifeOS

## Dashboards

- [[Tasks]]
- [[Deadlines]]
- [[Captures]]
- [[Health]]
- [[Workouts]]
- [[Finance]]
- [[Reviews]]
- [[LMS_Grades]]
""",
    "Tasks.md": """# Tasks

```dataview
TABLE status, due_at, created_at
FROM "Tasks"
SORT created_at DESC
```
""",
    "Deadlines.md": """# Deadlines

```dataview
TABLE due_at, created_at
FROM "Deadlines"
SORT due_at ASC
```
""",
    "Captures.md": """# Captures

```dataview
TABLE created_at, source
FROM "Captures"
SORT created_at DESC
```
""",
    "Health.md": """# Health

Xiaomi Watch 4 data flows through Mi Fitness and Android Health Connect. Manual
entries use `/health_log`; no Samsung Health integration is required.

## Today

```dataview
TABLE steps, sleep_minutes, resting_heart_rate, active_energy_kcal, workout_minutes, source, missing_metrics
FROM "Health/Daily"
SORT log_date DESC
LIMIT 1
```

## 7-Day Averages

```dataviewjs
const pages = dv.pages('"Health/Daily"')
  .where(p => p.log_date && dv.date(p.log_date) >= dv.date("today") - dv.duration("6 days"));
const avg = values => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : "n/a";
const values = key => pages.array().map(p => Number(p[key])).filter(Number.isFinite);
dv.table(["Avg steps", "Avg sleep minutes", "Avg resting HR", "Workout minutes", "Missing days"], [[
  avg(values("steps")),
  avg(values("sleep_minutes")),
  avg(values("resting_heart_rate")),
  values("workout_minutes").reduce((a, b) => a + b, 0),
  Math.max(0, 7 - pages.length),
]]);
```
""",
    "Workouts.md": """# Workouts

```dataview
TABLE started_at, duration_minutes, intensity
FROM "Workouts"
SORT started_at DESC
```
""",
    "Finance.md": """# Finance

## Spending

```dataviewjs
const pages = dv.pages('"Finance"').where(p => p.kind === "finance_transaction").array();
const expenses = pages.filter(p => p.transaction_type === "expense" && p.finance_status === "confirmed");
const today = dv.date("today");
const weekStart = today.startOf("week");
const monthStart = today.startOf("month");
const amount = rows => rows.reduce((sum, p) => sum + Number(p.amount || 0), 0);
const since = start => expenses.filter(p => p.occurred_on && dv.date(p.occurred_on) >= start);
dv.table(["Today", "Week", "Month"], [[
  amount(since(today)),
  amount(since(weekStart)),
  amount(since(monthStart)),
]]);
```

## Top Categories This Month

```dataviewjs
const pages = dv.pages('"Finance"')
  .where(p => p.kind === "finance_transaction" && p.transaction_type === "expense" && p.finance_status === "confirmed")
  .where(p => p.occurred_on && dv.date(p.occurred_on) >= dv.date("today").startOf("month"))
  .array();
const totals = new Map();
for (const p of pages) totals.set(p.category || "other", (totals.get(p.category || "other") || 0) + Number(p.amount || 0));
dv.table(["Category", "Amount"], [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5));
```

## Latest Transactions

```dataview
TABLE transaction_type, amount, currency, category, finance_status, occurred_on
FROM "Finance"
WHERE kind = "finance_transaction"
SORT created_at DESC
LIMIT 10
```

## Drafts Needing Review

```dataview
TABLE amount, currency, category, short_id, created_at
FROM "Finance"
WHERE kind = "finance_transaction" AND finance_status = "draft"
SORT created_at DESC
```
""",
    "Reviews.md": """# Reviews

```dataview
TABLE created_at, source
FROM "Reviews"
SORT created_at DESC
```
""",
    "LMS_Grades.md": """# 🎓 University Grades

> Auto-synced from AITU Moodle & Platonus via LifeOS workers.

## Grade Items

```dataview
TABLE course_title, record_type, score, max_score, percentage
FROM "Academic"
WHERE type = "academic_grade"
SORT course_title ASC, record_type DESC
```

## Course Averages

```dataviewjs
const pages = dv.pages('"Academic"').where(p => p.type === "academic_grade").array();
const byC = {};
for (const p of pages) {
  if (!byC[p.course_title]) byC[p.course_title] = [];
  byC[p.course_title].push(Number(p.percentage || 0));
}
const rows = Object.entries(byC).map(([c, vals]) => [
  c,
  Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) + "%",
]);
dv.table(["Course", "Avg %"], rows.sort((a, b) => a[0].localeCompare(b[0])));
```
""",
}


LEGACY_FINANCE_DASHBOARD = """# Finance

```dataview
TABLE amount, currency, created_at
FROM "Finance"
SORT created_at DESC
```
"""



def render_lms_grades_dashboard(
    supabase_url: str,
    service_role_key: str,
    user_id: str,
    vault_path: Path,
    dashboard_dir: str = "Dashboards",
) -> Path | None:
    """
    Fetch ``public.academic_records`` for *user_id* and write a static
    Markdown grade dashboard to ``<vault>/Academic/LMS_Grades_Dashboard.md``.

    This is a *server-side* render that:
    - Works without Obsidian being open (no Dataview dependency).
    - Is always up-to-date the moment the Obsidian mirror processes a job.
    - Complements the Dataview ``LMS_Grades.md`` file in the Dashboards folder.

    Returns the written path, or ``None`` if no academic records exist yet.
    """
    client = SupabaseRestClient(supabase_url, service_role_key)
    records = client.request(
        "GET",
        "academic_records",
        query={
            "select": "course_title,title,record_type,score,max_score,percentage",
            "user_id": f"eq.{user_id}",
            "order": "course_title.asc,record_type.desc",
        },
    ) or []

    if not records:
        return None

    # Group by course
    courses: dict[str, list[JsonObject]] = {}
    for rec in records:
        ctitle = str(rec.get("course_title") or "Unknown Course")
        courses.setdefault(ctitle, []).append(rec)

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines: list[str] = [
        "---",
        'type: "lms_grades_dashboard"',
        f'last_sync: "{now_str}"',
        "---",
        "",
        "# 🎓 University Grades Dashboard",
        "",
        f"> 💾 Synced from Supabase `academic_records` on {now_str}.",
        "> Источник: AITU Moodle WS API / Platonus / Resilient Mock.",
        "",
    ]

    for course_title, items in courses.items():
        lines.append(f"## 📘 {course_title}")
        lines.append("")
        lines.append("| Задание / Экзамен | Тип | Оценка | Макс. | % | Статус |")
        lines.append("| --- | --- | --- | --- | --- | --- |")
        for item in items:
            title     = str(item.get("title") or "—")
            rtype     = str(item.get("record_type") or "assignment")
            score     = item.get("score")
            max_score = item.get("max_score")
            pct_raw   = item.get("percentage")
            try:
                pct = round(float(pct_raw), 1) if pct_raw is not None else None
            except (TypeError, ValueError):
                pct = None

            if rtype in ("final", "midterm"):
                status = f"🏆 {rtype.upper()}"
            elif pct is not None and pct >= 50:
                status = "🟢 Passed"
            elif pct is not None:
                status = "🔴 Action Required"
            else:
                status = "⏳ Pending"

            pct_str   = f"{pct}%" if pct is not None else "—"
            score_str = f"**{score}**" if score is not None else "—"
            max_str   = str(max_score) if max_score is not None else "—"
            lines.append(f"| {title} | {rtype} | {score_str} | {max_str} | {pct_str} | {status} |")
        lines.append("")

    content = "\n".join(lines) + "\n"
    target = note_path(vault_path, ["Academic", "LMS_Grades_Dashboard.md"])
    atomic_write(target, content, vault_path)
    return target


def ensure_syncthing_ignores(vault_path: Path) -> bool:
    vault_path = resolve_vault_path(vault_path)
    vault_path.mkdir(parents=True, exist_ok=True)
    target = vault_path / ".stignore"
    checked = assert_real_path_inside_vault(vault_path, target)

    existing = checked.read_text(encoding="utf-8") if checked.exists() else ""
    if STIGNORE_LIFEOS_BEGIN in existing and STIGNORE_LIFEOS_END in existing:
        return False

    separator = "" if not existing or existing.endswith("\n") else "\n"
    atomic_write(checked, f"{existing}{separator}{STIGNORE_LIFEOS_BLOCK}", vault_path)
    return True


def init_dashboards(vault_path: Path, dashboard_dir: str) -> int:
    vault_path = resolve_vault_path(vault_path)
    vault_path.mkdir(parents=True, exist_ok=True)
    created = 0

    if ensure_syncthing_ignores(vault_path):
        created += 1
        print(f"updated {vault_path / '.stignore'}")

    for filename, content in DASHBOARDS.items():
        target = note_path(vault_path, [dashboard_dir, filename])

        if write_if_missing(target, content, vault_path):
            created += 1
            print(f"created {target}")
        elif filename == "Finance.md" and safe_read_text(target, vault_path) == LEGACY_FINANCE_DASHBOARD:
            atomic_write(target, content, vault_path)
            print(f"updated {target}")

    return created


class DashboardInitializer:
    def __init__(self) -> None:
        self._initialized_users = INITIALIZED_USERS
        self._initialized_keys = INITIALIZED_DASHBOARD_KEYS

    def ensure_for_user(self, user_id: str, vault_path: Path, dashboard_dir: str) -> None:
        normalized_user_id = str(user_id or "").strip()
        if normalized_user_id in self._initialized_users:
            return

        self.ensure(vault_path, dashboard_dir)
        self._initialized_users.add(normalized_user_id)

    def ensure(self, vault_path: Path, dashboard_dir: str) -> None:
        resolved = resolve_vault_path(vault_path)
        key = (str(resolved), dashboard_dir)

        if key in self._initialized_keys:
            return

        init_dashboards(resolved, dashboard_dir)
        self._initialized_keys.add(key)


def fetch_linked_detail(
    client: SupabaseRestClient,
    entity: JsonObject,
    user_id: str,
) -> JsonObject | None:
    linked_table = entity.get("linked_table")
    linked_id = entity.get("linked_id")

    if linked_table not in {"tasks", "workouts", "health_daily"} or not linked_id:
        return None

    return client.fetch_one(str(linked_table), str(linked_id), user_id=user_id)


def write_entity_note(
    vault_path: Path,
    entity: JsonObject,
    detail: JsonObject | None,
    target_segments: list[str] | None = None,
) -> Path:
    rendered = render_entity(entity, detail)
    target = note_path(vault_path, target_segments or rendered.relative_segments)
    atomic_write(target, rendered.markdown, vault_path)
    return target


def job_user_id(job: JsonObject) -> str:
    user_id = str(job.get("user_id") or "").strip()
    if not user_id:
        raise WorkerError("Queue job has no user_id")
    return user_id


def settings_vault_context(
    settings: Settings,
    client: SupabaseRestClient,
    user_id: str,
) -> tuple[Path | None, str]:
    obsidian_settings = client.get_user_obsidian_settings(user_id)

    if obsidian_settings is None:
        return settings.legacy_vault_path, "UTC"

    return (
        vault_path_from_settings_row(obsidian_settings),
        normalize_timezone_name(obsidian_settings.get("timezone") or "UTC"),
    )


def settings_vault_path(settings: Settings, client: SupabaseRestClient, user_id: str) -> Path | None:
    vault_path, _timezone_name = settings_vault_context(settings, client, user_id)
    return vault_path


def initialize_dashboards_for_active_vaults(
    settings: Settings,
    client: SupabaseRestClient,
    dashboard_initializer: DashboardInitializer,
) -> None:
    initialized = 0

    if settings.legacy_vault_path is not None:
        dashboard_initializer.ensure(settings.legacy_vault_path, settings.dashboard_dir)
        initialized += 1

    for row in client.list_active_obsidian_settings():
        vault_path = vault_path_from_settings_row(row)
        if vault_path is None:
            continue
        dashboard_initializer.ensure(vault_path, settings.dashboard_dir)
        initialized += 1

    if initialized:
        print(f"initialized dashboards for {initialized} vault(s)")


def process_job(
    settings: Settings,
    client: SupabaseRestClient,
    job: JsonObject,
    dashboard_initializer: DashboardInitializer | None = None,
) -> bool:
    claimed = client.claim_job(job)

    if claimed is None:
        return False

    job_id = str(claimed["id"])

    try:
        user_id = job_user_id(claimed)
        vault_path, user_timezone = settings_vault_context(settings, client, user_id)
        if vault_path is None:
            client.defer_job(job_id, "Obsidian sync is not connected for this user")
            print(f"deferred {job_id}: Obsidian sync is not connected for user", file=sys.stderr)
            return False

        (dashboard_initializer or DashboardInitializer()).ensure_for_user(user_id, vault_path, settings.dashboard_dir)

        if settings.fail_on_sync_conflicts:
            conflicts = find_syncthing_conflicts(vault_path)
            if conflicts:
                message = (
                    "Obsidian vault has unresolved Syncthing conflict files; "
                    f"manual merge required before mirror writes continue: {conflict_summary(vault_path, conflicts)}"
                )
                client.defer_job(job_id, message, delay_seconds=1800)
                print(f"deferred {job_id}: {message}", file=sys.stderr)
                return False

        life_entity_id = claimed.get("life_entity_id")

        if not life_entity_id:
            raise WorkerError("Queue job has no life_entity_id")

        target_segments = queued_target_segments(claimed)
        entity = client.fetch_one("life_entities", str(life_entity_id), user_id=user_id)

        if entity is None:
            raise WorkerError(f"Life entity not found: {life_entity_id}")

        detail = fetch_linked_detail(client, entity, user_id)
        previous_timezone = set_render_timezone(user_timezone)
        try:
            target = write_entity_note(vault_path, entity, detail, target_segments)
        finally:
            set_render_timezone(previous_timezone)
        client.complete_job(job_id)
        print(f"mirrored {life_entity_id} -> {target}")
        return True
    except Exception as exc:
        message = str(exc)
        client.fail_job(job_id, message)
        print(f"failed {job_id}: {message}", file=sys.stderr)
        return False


def run_once(settings: Settings, dashboards: DashboardInitializer | None = None) -> int:
    client = SupabaseRestClient(settings.supabase_url, settings.service_role_key)
    dashboards = dashboards or DashboardInitializer()
    jobs = client.list_pending_jobs(settings.batch_size)
    processed = 0

    for job in jobs:
        if process_job(settings, client, job, dashboards):
            processed += 1

    print(f"processed {processed}/{len(jobs)} jobs")
    return processed


def run_loop(settings: Settings) -> None:
    client = SupabaseRestClient(settings.supabase_url, settings.service_role_key)
    dashboards = DashboardInitializer()

    while True:
        try:
            jobs = client.list_pending_jobs(settings.batch_size)
            processed = 0

            for job in jobs:
                if process_job(settings, client, job, dashboards):
                    processed += 1

            print(f"processed {processed}/{len(jobs)} jobs")
        except Exception as exc:
            print(f"loop error: {exc}", file=sys.stderr)

        time.sleep(settings.interval_seconds)


def sample_entity(entity_type: str) -> JsonObject:
    now = "2026-05-18T08:00:00Z"
    base: JsonObject = {
        "id": "00000000-0000-0000-0000-000000000001",
        "user_id": "00000000-0000-0000-0000-000000000000",
        "entity_type": entity_type,
        "title": f"Sample {entity_type}",
        "body": "Rendered by render-test.",
        "source": "render-test",
        "source_command": "render-test",
        "created_at": now,
        "updated_at": now,
        "metadata": {},
    }

    if entity_type == "deadline":
        base["due_at"] = "2026-05-20T23:59:00Z"
    elif entity_type in {"expense", "spend", "finance"}:
        base["metadata"] = {"amount": 1200, "currency": "KZT"}
    elif entity_type == "health_daily":
        base["linked_table"] = "health_daily"
        base["linked_id"] = "00000000-0000-0000-0000-000000000002"
        base["metadata"] = {
            "date": "2026-05-17",
            "recoveryMode": "growth",
            "dataCompletenessScore": 85,
            "syncReason": "nightly_00_01",
        }
    elif entity_type == "workout":
        base["linked_table"] = "workouts"
        base["linked_id"] = "00000000-0000-0000-0000-000000000003"

    return base


def sample_detail(entity_type: str) -> JsonObject | None:
    if entity_type == "health_daily":
        return {
            "log_date": "2026-05-17",
            "recovery_mode": "growth",
            "data_completeness_score": 85,
            "sleep_minutes": 480,
            "deep_sleep_minutes": 90,
            "rem_sleep_minutes": 80,
            "awake_minutes": 20,
            "resting_heart_rate": 58,
            "hrv_ms": 45,
            "spo2_avg": 97,
            "steps": 9200,
            "active_energy_kcal": 620,
            "sync_reason": "nightly_00_01",
            "missing_metrics": {"stress": True, "sleep_stages": False},
        }

    if entity_type == "workout":
        return {
            "title": "Sample workout",
            "started_at": "2026-05-18T06:00:00Z",
            "ended_at": "2026-05-18T06:45:00Z",
            "workout_type": "strength",
            "duration_minutes": 45,
        }

    if entity_type in {"task", "deadline"}:
        return {
            "status": "next",
            "priority": 1,
            "due_at": "2026-05-20T23:59:00Z",
        }

    return None


def render_test(entity_type: str) -> None:
    entity_types = sorted(SUPPORTED_RENDER_TYPES) if entity_type == "all" else [entity_type]

    for current_type in entity_types:
        rendered = render_entity(sample_entity(current_type), sample_detail(current_type))
        print(f"\n<!-- {current_type}: {'/'.join(rendered.relative_segments)} -->\n")
        print(rendered.markdown)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="LifeOS Obsidian mirror worker")
    parser.add_argument("--env-file", type=Path, help="Optional dotenv file to load")
    subcommands = parser.add_subparsers(dest="command", required=True)

    subcommands.add_parser("run-once", help="Process one batch of pending sync jobs")
    subcommands.add_parser("run-loop", help="Continuously process pending sync jobs")
    subcommands.add_parser("init-dashboards", help="Create missing dashboard notes")

    render_parser = subcommands.add_parser("render-test", help="Render sample Markdown to stdout")
    render_parser.add_argument(
        "--entity-type",
        default="all",
        choices=["all", *sorted(SUPPORTED_RENDER_TYPES)],
    )

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.command == "render-test":
        render_test(args.entity_type)
        return 0

    settings = load_settings(args.env_file)

    if args.command == "init-dashboards":
        if settings.legacy_vault_path is None:
            raise WorkerError(
                "init-dashboards requires "
                f"{LEGACY_SINGLE_USER_ENV}=true and OBSIDIAN_VAULT_PATH; "
                "multi-user dashboards are initialized per user vault while processing jobs"
            )
        init_dashboards(settings.legacy_vault_path, settings.dashboard_dir)
        return 0

    if args.command == "run-once":
        run_once(settings)
        return 0

    if args.command == "run-loop":
        run_loop(settings)
        return 0

    raise WorkerError(f"Unknown command: {args.command}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except WorkerError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
