#!/usr/bin/env python3
"""Mirror LifeOS Supabase sync jobs into an Obsidian vault."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


JsonObject = dict[str, Any]
LEGACY_SINGLE_USER_ENV = "LIFEOS_ENABLE_LEGACY_SINGLE_USER_OBSIDIAN"

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
    vault_path: Path
    batch_size: int
    interval_seconds: int
    dashboard_dir: str


@dataclass(frozen=True)
class RenderedNote:
    relative_segments: list[str]
    markdown: str


class WorkerError(RuntimeError):
    """Expected worker failure that can be written to queue last_error."""


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


def require_legacy_single_user_mode() -> None:
    if getenv_bool(LEGACY_SINGLE_USER_ENV):
        return
    raise WorkerError(
        "obsidian-mirror is still legacy single-user mode; set "
        f"{LEGACY_SINGLE_USER_ENV}=true only for local/dev or explicitly accepted "
        "single-user deployments. Per-user vault routing is not implemented yet."
    )


def load_settings(env_file: Path | None = None) -> Settings:
    default_env = Path(__file__).with_name(".env")
    load_dotenv(default_env)

    if env_file is not None:
        load_dotenv(env_file)

    require_legacy_single_user_mode()

    return Settings(
        supabase_url=getenv_required("SUPABASE_URL").rstrip("/"),
        service_role_key=getenv_required("SUPABASE_SERVICE_ROLE_KEY"),
        vault_path=Path(getenv_required("OBSIDIAN_VAULT_PATH")).expanduser().resolve(),
        batch_size=getenv_int("OBSIDIAN_MIRROR_BATCH_SIZE", 10),
        interval_seconds=getenv_int("OBSIDIAN_MIRROR_INTERVAL_SECONDS", 30),
        dashboard_dir=os.environ.get("OBSIDIAN_MIRROR_DASHBOARD_DIR", "Dashboards").strip()
        or "Dashboards",
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

    def fetch_one(self, table: str, row_id: str) -> JsonObject | None:
        rows = self.request(
            "GET",
            table,
            {
                "select": "*",
                "id": f"eq.{row_id}",
                "limit": "1",
            },
        )

        if not rows:
            return None

        return rows[0]


def sanitize_segment(value: Any, fallback: str = "untitled", max_length: int = 120) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip()
    text = FORBIDDEN_SEGMENT_CHARS.sub("-", text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"-+", "-", text)
    text = text.strip(" .-")[:max_length].strip(" .-")

    if not text:
        text = fallback

    if text.lower() in RESERVED_WINDOWS_NAMES:
        text = f"{text}-note"

    return text


def short_id(value: str | None) -> str:
    if not value:
        return "unknown"
    return value.split("-")[0][:8]


def date_part(value: Any) -> str:
    text = str(value or "")
    match = re.match(r"(\d{4}-\d{2}-\d{2})", text)
    return match.group(1) if match else datetime.now(timezone.utc).date().isoformat()


def note_path(vault: Path, relative_segments: list[str]) -> Path:
    if not relative_segments:
        raise WorkerError("Note path requires at least one segment")

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


def queued_target_segments(job: JsonObject) -> list[str] | None:
    target_path = str(job.get("target_path") or "").strip()

    if not target_path:
        return None

    if target_path.startswith(("/", "\\")):
        raise WorkerError("Queue target_path must be relative")

    segments = [segment for segment in re.split(r"[\\/]+", target_path) if segment]

    if not segments or any(segment in {".", ".."} for segment in segments):
        raise WorkerError("Queue target_path contains an unsafe segment")

    return segments


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
        text=True,
    )

    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())

    os.replace(temp_name, path)


def write_if_missing(path: Path, content: str) -> bool:
    if path.exists():
        return False

    atomic_write(path, content)
    return True


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
    category = metadata.get("category") or "Другое"
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
        return ""

    lines = ["## Exercises"]

    for exercise in exercises:
        if not isinstance(exercise, dict):
            continue

        name = exercise.get("name") or "Exercise"
        lines.append(f"- {name}")
        sets = exercise.get("sets")

        if not isinstance(sets, list):
            continue

        for current_set in sets:
            if not isinstance(current_set, dict):
                continue

            index = current_set.get("index") or "?"
            completed = "done" if current_set.get("completed") else "open"
            target_reps = current_set.get("targetReps")
            target_weight = current_set.get("targetWeightKg")
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
for (const p of pages) totals.set(p.category || "Другое", (totals.get(p.category || "Другое") || 0) + Number(p.amount || 0));
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
}


LEGACY_FINANCE_DASHBOARD = """# Finance

```dataview
TABLE amount, currency, created_at
FROM "Finance"
SORT created_at DESC
```
"""


def init_dashboards(settings: Settings) -> int:
    settings.vault_path.mkdir(parents=True, exist_ok=True)
    created = 0

    for filename, content in DASHBOARDS.items():
        target = note_path(settings.vault_path, [settings.dashboard_dir, filename])

        if write_if_missing(target, content):
            created += 1
            print(f"created {target}")
        elif filename == "Finance.md" and target.read_text(encoding="utf-8") == LEGACY_FINANCE_DASHBOARD:
            atomic_write(target, content)
            print(f"updated {target}")
        else:
            print(f"exists  {target}")

    return created


def fetch_linked_detail(client: SupabaseRestClient, entity: JsonObject) -> JsonObject | None:
    linked_table = entity.get("linked_table")
    linked_id = entity.get("linked_id")

    if linked_table not in {"tasks", "workouts", "health_daily"} or not linked_id:
        return None

    return client.fetch_one(str(linked_table), str(linked_id))


def write_entity_note(
    settings: Settings,
    entity: JsonObject,
    detail: JsonObject | None,
    target_segments: list[str] | None = None,
) -> Path:
    rendered = render_entity(entity, detail)
    target = note_path(settings.vault_path, target_segments or rendered.relative_segments)
    atomic_write(target, rendered.markdown)
    return target


def process_job(settings: Settings, client: SupabaseRestClient, job: JsonObject) -> bool:
    claimed = client.claim_job(job)

    if claimed is None:
        return False

    job_id = str(claimed["id"])

    try:
        life_entity_id = claimed.get("life_entity_id")

        if not life_entity_id:
            raise WorkerError("Queue job has no life_entity_id")

        entity = client.fetch_one("life_entities", str(life_entity_id))

        if entity is None:
            raise WorkerError(f"Life entity not found: {life_entity_id}")

        detail = fetch_linked_detail(client, entity)
        target = write_entity_note(settings, entity, detail, queued_target_segments(claimed))
        client.complete_job(job_id)
        print(f"mirrored {life_entity_id} -> {target}")
        return True
    except Exception as exc:
        message = str(exc)
        client.fail_job(job_id, message)
        print(f"failed {job_id}: {message}", file=sys.stderr)
        return False


def run_once(settings: Settings) -> int:
    init_dashboards(settings)
    client = SupabaseRestClient(settings.supabase_url, settings.service_role_key)
    jobs = client.list_pending_jobs(settings.batch_size)
    processed = 0

    for job in jobs:
        if process_job(settings, client, job):
            processed += 1

    print(f"processed {processed}/{len(jobs)} jobs")
    return processed


def run_loop(settings: Settings) -> None:
    while True:
        try:
            run_once(settings)
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
        init_dashboards(settings)
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
