#!/usr/bin/env python3
"""Generate monthly LifeOS reviews from local Supabase data."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any


JsonObject = dict[str, Any]
REQUEST_TIMEOUT_SECONDS = 45
DEFAULT_MODEL = "openai/gpt-4o-mini"
DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
CARD_OR_ACCOUNT_PATTERN = re.compile(r"(?<!\d)(?:\d[\s-]?){12,19}(?!\d)")
SAFE_SEGMENT_PATTERN = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
LEGACY_SINGLE_USER_ENV = "LIFEOS_ENABLE_LEGACY_SINGLE_USER_MONTHLY_REVIEW"


class WorkerError(RuntimeError):
    """Expected worker failure safe to log without credentials."""


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    service_role_key: str
    user_id: str
    timezone_name: str
    obsidian_vault_path: Path | None
    telegram_bot_token: str | None
    telegram_chat_id: str | None
    ai_enabled: bool
    openrouter_api_key: str | None
    ai_model: str
    ai_base_url: str
    poll_seconds: int


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


def getenv_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "").strip().lower()

    if not raw:
        return default

    return raw in {"1", "true", "yes", "on"}


def getenv_int(name: str, default: int) -> int:
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


def require_legacy_single_user_mode() -> None:
    if getenv_bool(LEGACY_SINGLE_USER_ENV):
        return
    raise WorkerError(
        "monthly-review-worker is still legacy single-user mode; set "
        f"{LEGACY_SINGLE_USER_ENV}=true only for local/dev or explicitly accepted "
        "single-user deployments. Per-user monthly review fan-out is not implemented yet."
    )


def load_settings(env_file: Path | None = None) -> Settings:
    load_dotenv(Path(__file__).with_name(".env"))

    if env_file:
        load_dotenv(env_file)

    require_legacy_single_user_mode()

    vault = os.environ.get("OBSIDIAN_VAULT_PATH", "").strip()
    telegram_chat_id = (
        os.environ.get("MONTHLY_REVIEW_TELEGRAM_CHAT_ID", "").strip()
        or os.environ.get("LIFEOS_DEFAULT_TELEGRAM_USER_ID", "").strip()
        or None
    )

    return Settings(
        supabase_url=getenv_required("SUPABASE_URL").rstrip("/"),
        service_role_key=getenv_required("SUPABASE_SERVICE_ROLE_KEY"),
        user_id=getenv_required("LIFEOS_DEFAULT_USER_ID"),
        timezone_name=os.environ.get("APP_TIMEZONE", "Asia/Qyzylorda").strip()
        or "Asia/Qyzylorda",
        obsidian_vault_path=Path(vault).expanduser().resolve() if vault else None,
        telegram_bot_token=os.environ.get("TELEGRAM_BOT_TOKEN", "").strip() or None,
        telegram_chat_id=telegram_chat_id,
        ai_enabled=getenv_bool("MONTHLY_REVIEW_AI_ENABLED", False),
        openrouter_api_key=os.environ.get("OPENROUTER_API_KEY", "").strip() or None,
        ai_model=os.environ.get("MONTHLY_REVIEW_MODEL", DEFAULT_MODEL).strip()
        or DEFAULT_MODEL,
        ai_base_url=os.environ.get(
            "MONTHLY_REVIEW_BASE_URL", DEFAULT_OPENROUTER_BASE_URL
        ).strip()
        or DEFAULT_OPENROUTER_BASE_URL,
        poll_seconds=getenv_int("MONTHLY_REVIEW_POLL_SECONDS", 3600),
    )


def month_bounds(period_month: str) -> tuple[date, date, list[str]]:
    match = re.match(r"^(\d{4})-(\d{2})$", period_month)

    if not match:
        raise WorkerError("Month must use YYYY-MM")

    year = int(match.group(1))
    month = int(match.group(2))

    if month < 1 or month > 12:
        raise WorkerError("Month must use YYYY-MM")

    start = date(year, month, 1)
    next_month = date(year + int(month == 12), 1 if month == 12 else month + 1, 1)
    days: list[str] = []
    current = start

    while current < next_month:
        days.append(current.isoformat())
        current += timedelta(days=1)

    return start, next_month, days


def previous_month(today: date | None = None) -> str:
    current = today or datetime.now(timezone.utc).date()
    first = current.replace(day=1)
    previous = first - timedelta(days=1)
    return f"{previous.year:04d}-{previous.month:02d}"


def redact(value: Any) -> str:
    return re.sub(
        r"\s+", " ", CARD_OR_ACCOUNT_PATTERN.sub(" [REDACTED] ", str(value or ""))
    ).strip()


def safe_description(value: Any) -> str | None:
    text = re.sub(r"\s+", " ", redact(value)).strip()

    if not text or len(text) > 80:
        return None

    return text


def money(value: float) -> str:
    formatted = f"{round(value, 2):,.2f}".replace(",", " ")
    formatted = formatted.rstrip("0").rstrip(".")
    return f"{formatted} KZT"


def avg(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


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
            with urllib.request.urlopen(
                request, timeout=REQUEST_TIMEOUT_SECONDS
            ) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise WorkerError(
                f"Supabase {method} {table} failed: {exc.code} {detail[:500]}"
            ) from exc
        except urllib.error.URLError as exc:
            raise WorkerError(f"Supabase {method} {table} failed: {exc.reason}") from exc

        return json.loads(raw) if raw else None

    def fetch_monthly_rows(self, user_id: str, period_month: str) -> JsonObject:
        start, next_month, _days = month_bounds(period_month)
        start_day = start.isoformat()
        next_day = next_month.isoformat()
        start_ts = f"{start_day}T00:00:00.000Z"
        next_ts = f"{next_day}T00:00:00.000Z"

        return {
            "finance_transactions": self.request(
                "GET",
                "finance_transactions",
                {
                    "select": "*",
                    "user_id": f"eq.{user_id}",
                    "and": f"(occurred_on.gte.{start_day},occurred_on.lt.{next_day})",
                    "order": "occurred_on.asc",
                },
            )
            or [],
            "finance_categories": self.request(
                "GET",
                "finance_categories",
                {
                    "select": "*",
                    "user_id": f"eq.{user_id}",
                    "archived_at": "is.null",
                },
            )
            or [],
            "health_metrics": self.request(
                "GET",
                "health_metrics",
                {
                    "select": "*",
                    "user_id": f"eq.{user_id}",
                    "and": f"(metric_date.gte.{start_day},metric_date.lt.{next_day})",
                    "order": "metric_date.asc",
                },
            )
            or [],
            "reminders": self.request(
                "GET",
                "reminders",
                {
                    "select": "*",
                    "user_id": f"eq.{user_id}",
                    "and": f"(created_at.gte.{start_ts},created_at.lt.{next_ts})",
                    "order": "created_at.asc",
                },
            )
            or [],
            "source_events": self.request(
                "GET",
                "source_events",
                {
                    "select": "*",
                    "user_id": f"eq.{user_id}",
                    "and": f"(created_at.gte.{start_ts},created_at.lt.{next_ts})",
                    "order": "created_at.asc",
                },
            )
            or [],
            "bounds": {"start": start_day, "next": next_day, "start_ts": start_ts, "next_ts": next_ts},
        }

    def upsert_monthly_review(self, row: JsonObject) -> JsonObject:
        rows = self.request(
            "POST",
            "monthly_reviews",
            {"on_conflict": "user_id,period_month", "select": "*"},
            [row],
            prefer="resolution=merge-duplicates,return=representation",
        )

        if not rows:
            raise WorkerError("Monthly review upsert returned no rows")

        return rows[0]

    def latest_monthly_review(self, user_id: str) -> JsonObject | None:
        rows = self.request(
            "GET",
            "monthly_reviews",
            {
                "select": "*",
                "user_id": f"eq.{user_id}",
                "order": "period_month.desc",
                "limit": "1",
            },
        )
        return rows[0] if rows else None


def rows_in_month(rows: list[JsonObject], key: str, start: str, next_value: str) -> list[JsonObject]:
    return [
        row
        for row in rows
        if start <= str(row.get(key) or "")[: len(start)] < next_value
    ]


def aggregate(rows: JsonObject, period_month: str) -> JsonObject:
    start, next_month, days = month_bounds(period_month)
    start_day = start.isoformat()
    next_day = next_month.isoformat()
    categories = {
        str(item.get("id")): str(item.get("name") or "Другое")
        for item in rows.get("finance_categories", [])
    }
    transactions = rows_in_month(
        rows.get("finance_transactions", []), "occurred_on", start_day, next_day
    )
    metrics = rows_in_month(rows.get("health_metrics", []), "metric_date", start_day, next_day)
    reminders = rows_in_month(rows.get("reminders", []), "created_at", f"{start_day}T", f"{next_day}T")
    source_events = rows_in_month(
        rows.get("source_events", []), "created_at", f"{start_day}T", f"{next_day}T"
    )
    confirmed_income = [
        row
        for row in transactions
        if row.get("transaction_type") == "income" and row.get("status") == "confirmed"
    ]
    confirmed_expense = [
        row
        for row in transactions
        if row.get("transaction_type") == "expense" and row.get("status") == "confirmed"
    ]
    total_income = round(sum(number(row.get("amount")) for row in confirmed_income), 2)
    total_expense = round(sum(number(row.get("amount")) for row in confirmed_expense), 2)
    category_totals: dict[str, JsonObject] = {}
    description_totals: dict[str, JsonObject] = {}
    daily = {day: 0.0 for day in days}
    debt_count = 0
    debt_total = 0.0

    for row in confirmed_expense:
        amount = number(row.get("amount"))
        category = categories.get(str(row.get("category_id")), "Другое")
        current = category_totals.setdefault(category, {"category": category, "amount": 0.0, "count": 0})
        current["amount"] += amount
        current["count"] += 1
        description = safe_description(row.get("description") or row.get("merchant"))

        if description:
            desc = description_totals.setdefault(
                description, {"description": description, "amount": 0.0, "count": 0}
            )
            desc["amount"] += amount
            desc["count"] += 1

        day = str(row.get("occurred_on") or "")[:10]

        if day in daily:
            daily[day] += amount

        if category == "Долги":
            debt_count += 1
            debt_total += amount

    values_by_type: dict[str, list[float]] = {}
    health_days: set[str] = set()
    steps_by_day: dict[str, float] = {}

    for metric in metrics:
        metric_type = str(metric.get("metric_type") or "")
        value = number(metric.get("value"))
        metric_date = str(metric.get("metric_date") or "")[:10]
        values_by_type.setdefault(metric_type, []).append(value)
        health_days.add(metric_date)

        if metric_type == "steps":
            steps_by_day[metric_date] = value

    def source_of(reminder: JsonObject) -> str:
        metadata = reminder.get("metadata_json")

        if not isinstance(metadata, dict):
            return "manual"

        source = metadata.get("source")
        return str(source) if source else "manual"

    source_counts: dict[str, int] = {}

    for event in source_events:
        source_key = str(event.get("source_key") or "unknown")
        source_counts[source_key] = source_counts.get(source_key, 0) + 1

    step_days = [{"date": day, "steps": steps} for day, steps in steps_by_day.items()]
    best_steps = max(step_days, key=lambda item: item["steps"]) if step_days else None
    worst_steps = min(step_days, key=lambda item: item["steps"]) if step_days else None

    return {
        "periodMonth": period_month,
        "startDate": start_day,
        "endDate": (next_month - timedelta(days=1)).isoformat(),
        "finance": {
            "totalIncome": total_income,
            "totalExpense": total_expense,
            "netCashflow": round(total_income - total_expense, 2),
            "topCategories": sorted(
                (
                    {**item, "amount": round(float(item["amount"]), 2)}
                    for item in category_totals.values()
                ),
                key=lambda item: item["amount"],
                reverse=True,
            )[:8],
            "topDescriptions": sorted(
                (
                    {**item, "amount": round(float(item["amount"]), 2)}
                    for item in description_totals.values()
                ),
                key=lambda item: item["amount"],
                reverse=True,
            )[:8],
            "biggestTransactions": [
                {
                    "amount": number(row.get("amount")),
                    "category": categories.get(str(row.get("category_id")), "Другое"),
                    "description": safe_description(row.get("description") or row.get("merchant")),
                    "occurredOn": str(row.get("occurred_on") or "")[:10],
                }
                for row in sorted(
                    confirmed_expense,
                    key=lambda item: number(item.get("amount")),
                    reverse=True,
                )[:8]
            ],
            "dailySpendingTrend": [
                {"date": day, "amount": round(amount, 2)} for day, amount in daily.items()
            ],
            "draftCount": len([row for row in transactions if row.get("status") == "draft"]),
            "cancelledCount": len(
                [row for row in transactions if row.get("status") == "cancelled"]
            ),
            "debtTransactionCount": debt_count,
            "debtTotal": round(debt_total, 2),
        },
        "health": {
            "avgSteps": avg(values_by_type.get("steps", [])),
            "totalSteps": round(sum(values_by_type.get("steps", [])), 2),
            "avgSleepMinutes": avg(values_by_type.get("sleep_minutes", [])),
            "avgRestingHeartRate": avg(values_by_type.get("resting_heart_rate", [])),
            "avgActiveEnergyKcal": avg(values_by_type.get("active_energy_kcal", [])),
            "totalWorkoutMinutes": round(sum(values_by_type.get("workout_minutes", [])), 2),
            "missingHealthDays": [day for day in days if day not in health_days],
            "bestStepsDay": best_steps,
            "worstStepsDay": worst_steps,
        },
        "productivity": {
            "remindersCreated": len(reminders),
            "remindersSent": len([row for row in reminders if row.get("status") == "sent"]),
            "remindersFailed": len([row for row in reminders if row.get("status") == "failed"]),
            "googleTasksReminders": len(
                [row for row in reminders if source_of(row) == "google_tasks"]
            ),
            "manualReminders": len([row for row in reminders if source_of(row) == "manual"]),
            "overdueOrPending": len(
                [row for row in reminders if row.get("status") in {"pending", "processing"}]
            ),
        },
        "sources": {
            "sourceEventsByProvider": sorted(
                (
                    {"sourceKey": source_key, "count": count}
                    for source_key, count in source_counts.items()
                ),
                key=lambda item: item["count"],
                reverse=True,
            )
        },
    }


def summary_bullets(stats: JsonObject) -> list[str]:
    finance = stats["finance"]
    health = stats["health"]
    productivity = stats["productivity"]
    top = finance["topCategories"][0] if finance["topCategories"] else None

    return [
        f"Финансы: доход {money(finance['totalIncome'])}, расходы {money(finance['totalExpense'])}, net {money(finance['netCashflow'])}.",
        f"Главная категория расходов: {top['category']} ({money(top['amount'])})."
        if top
        else "Расходов за месяц не зафиксировано.",
        f"Здоровье: средние шаги {health['avgSteps'] or 'нет данных'}, сон {health['avgSleepMinutes'] or 'нет данных'} мин.",
        f"Тренировки: {health['totalWorkoutMinutes']} мин; missing health days: {len(health['missingHealthDays'])}.",
        f"Reminders: создано {productivity['remindersCreated']}, отправлено {productivity['remindersSent']}, failed {productivity['remindersFailed']}.",
        f"Finance drafts: {finance['draftCount']}; cancelled: {finance['cancelledCount']}.",
    ]


def fallback_markdown(stats: JsonObject) -> str:
    finance = stats["finance"]
    health = stats["health"]
    productivity = stats["productivity"]
    top_categories = "\n".join(
        f"- {item['category']}: {money(item['amount'])} ({item['count']})"
        for item in finance["topCategories"]
    ) or "- Нет расходов."
    leaks = "\n".join(
        f"- {item['description']}: {money(item['amount'])} ({item['count']})"
        for item in finance["topDescriptions"][:5]
    ) or "- Явных повторяющихся утечек не видно."
    daily_limit = max(1000, round((float(finance["totalExpense"]) / 31) * 0.9))
    steps_target = max(7000, round(float(health["avgSteps"] or 7000)))

    return f"""# LifeOS Monthly Review — {stats['periodMonth']}

## 1. Краткий вывод
{chr(10).join(f"- {item}" for item in summary_bullets(stats)[:6])}

## 2. Финансы
- Доход: {money(finance['totalIncome'])}
- Расходы: {money(finance['totalExpense'])}
- Net: {money(finance['netCashflow'])}
- Draft/cancelled: {finance['draftCount']}/{finance['cancelledCount']}
- Долги: {finance['debtTransactionCount']} транзакций на {money(finance['debtTotal'])}

### Top categories
{top_categories}

### Biggest leaks
{leaks}

Что резать в следующем месяце: top category и повторяющиеся мелкие покупки без пользы.

## 3. Здоровье
- Avg steps: {health['avgSteps'] or 'нет данных'}
- Total steps: {health['totalSteps']}
- Avg sleep: {health['avgSleepMinutes'] or 'нет данных'} мин
- Avg resting HR: {health['avgRestingHeartRate'] or 'нет данных'}
- Avg active kcal: {health['avgActiveEnergyKcal'] or 'нет данных'}
- Workout minutes: {health['totalWorkoutMinutes']}
- Missing health days: {len(health['missingHealthDays'])}

## 4. Продуктивность / Reminders
- Created: {productivity['remindersCreated']}
- Sent: {productivity['remindersSent']}
- Failed: {productivity['remindersFailed']}
- Google Tasks: {productivity['googleTasksReminders']}
- Manual: {productivity['manualReminders']}
- Pending/overdue: {productivity['overdueOrPending']}

## 5. Что было хорошо
- Данные собраны без ручного отчёта.
- Видны расходы, health consistency и reminders throughput.
- Можно принимать решения по цифрам, а не по настроению.

## 6. Что пошло плохо
- Missing health days: {len(health['missingHealthDays'])}.
- Finance drafts/cancelled: {finance['draftCount'] + finance['cancelledCount']}.
- Повторяющиеся расходы требуют отдельной проверки.

## 7. План на следующий месяц
- Finance: дневной лимит {money(daily_limit)}.
- Finance: weekly review drafts.
- Finance: проверить top category.
- Health: {steps_target} шагов в день.
- Health: 450 минут сна.
- Health: максимум 3 missing days.
- Productivity: pending reminders закрывать в конце дня.
- Productivity: failed reminders проверять сразу.
- Productivity: Google Tasks держать основным внешним источником.

## 8. Конкретные правила на месяц
- Daily spending limit: {money(daily_limit)}
- Sleep target: 450 минут.
- Steps target: {steps_target}.
- Review day: воскресенье 19:00.
"""


def ai_markdown(settings: Settings, stats: JsonObject) -> tuple[str, JsonObject, str | None]:
    if not settings.ai_enabled or not settings.openrouter_api_key:
        return fallback_markdown(stats), {"fallback": True, "reason": "ai_disabled_or_missing_key"}, None

    prompt = {
        "role": "system",
        "content": (
            "Ты LifeOS operator. Напиши краткий, прямой, практичный monthly review "
            "на русском markdown. Без мотивационного мусора. Не добавляй факты, "
            "которых нет в JSON. Сохрани секции 1-8 из задания."
        ),
    }
    user = {
        "role": "user",
        "content": json.dumps(stats, ensure_ascii=False, sort_keys=True),
    }
    payload = {
        "model": settings.ai_model,
        "temperature": 0.2,
        "messages": [prompt, user],
    }
    request = urllib.request.Request(
        f"{settings.ai_base_url.rstrip('/')}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "authorization": f"Bearer {settings.openrouter_api_key}",
            "content-type": "application/json",
            "accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            body = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        return fallback_markdown(stats), {"fallback": True, "error": str(exc)[:500]}, None

    try:
        content = str(body["choices"][0]["message"]["content"]).strip()
    except (KeyError, IndexError, TypeError):
        return fallback_markdown(stats), {"fallback": True, "error": "invalid_ai_response"}, None

    if not content.startswith("# LifeOS Monthly Review"):
        content = f"# LifeOS Monthly Review — {stats['periodMonth']}\n\n{content}"

    return content, {"fallback": False, "response": body}, settings.ai_model


def sanitize_segment(value: str) -> str:
    text = SAFE_SEGMENT_PATTERN.sub("-", value).strip(" .-")
    return text or "monthly-review"


def safe_vault_path(vault: Path, relative: str) -> Path:
    parts = [sanitize_segment(part) for part in re.split(r"[\\/]+", relative) if part]
    target = vault.joinpath(*parts).resolve()

    if os.path.commonpath([str(vault), str(target)]) != str(vault):
        raise WorkerError("Resolved Obsidian path is outside vault")

    return target


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, text=True
    )

    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())

    os.replace(temp_name, path)


def update_reviews_dashboard(vault: Path, period_month: str, relative_path: str) -> None:
    dashboard = safe_vault_path(vault, "Dashboards/Reviews.md")
    link = f"[[{relative_path.removesuffix('.md')}|{period_month} LifeOS Review]]"

    if dashboard.exists():
        current = dashboard.read_text(encoding="utf-8")
    else:
        current = "# Reviews\n\n```dataview\nTABLE created_at, source\nFROM \"Reviews\"\nSORT created_at DESC\n```\n"

    if link in current:
        return

    if "## Monthly Reviews" not in current:
        current = current.rstrip() + "\n\n## Monthly Reviews\n"

    current = current.rstrip() + f"\n- {link}\n"
    atomic_write(dashboard, current)


def write_obsidian(settings: Settings, period_month: str, markdown: str) -> str | None:
    if not settings.obsidian_vault_path:
        return None

    relative = f"Reviews/Monthly/{period_month}-LifeOS-Review.md"
    target = safe_vault_path(settings.obsidian_vault_path, relative)
    atomic_write(target, markdown)
    update_reviews_dashboard(settings.obsidian_vault_path, period_month, relative)
    return relative


def send_telegram(settings: Settings, review: JsonObject, bullets: list[str]) -> None:
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        return

    lines = [
        f"Monthly review generated: {review['period_month']}",
        f"Status: {review['status']}",
        f"Obsidian: {review.get('obsidian_path') or 'not configured'}",
        "",
        *[f"- {item}" for item in bullets[:5]],
    ]
    data = json.dumps(
        {
            "chat_id": settings.telegram_chat_id,
            "text": "\n".join(lines),
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
        data=data,
        headers={"content-type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            response.read()
    except Exception as exc:
        print(f"telegram notification failed: {str(exc)[:200]}", file=sys.stderr)


def generate(settings: Settings, period_month: str) -> JsonObject:
    client = SupabaseRestClient(settings.supabase_url, settings.service_role_key)
    rows = client.fetch_monthly_rows(settings.user_id, period_month)
    stats = aggregate(rows, period_month)
    markdown, ai_output, ai_model = ai_markdown(settings, stats)
    obsidian_path = write_obsidian(settings, period_month, markdown)
    review = client.upsert_monthly_review(
        {
            "user_id": settings.user_id,
            "period_month": period_month,
            "status": "generated",
            "report_title": f"LifeOS Monthly Review — {period_month}",
            "report_markdown": markdown,
            "ai_model": ai_model,
            "ai_input_json": stats,
            "ai_output_json": ai_output,
            "stats_json": stats,
            "obsidian_path": obsidian_path,
            "generated_at": utc_now(),
            "error_message": None,
        }
    )
    send_telegram(settings, review, summary_bullets(stats))
    return review


def print_status(settings: Settings) -> int:
    client = SupabaseRestClient(settings.supabase_url, settings.service_role_key)
    latest = client.latest_monthly_review(settings.user_id)

    if latest is None:
        print("No monthly reviews yet.")
        return 0

    stats = latest.get("stats_json") if isinstance(latest.get("stats_json"), dict) else {}
    bullets = summary_bullets(stats)[:3] if stats else []
    print(f"month={latest.get('period_month')}")
    print(f"status={latest.get('status')}")
    print(f"generated_at={latest.get('generated_at') or 'n/a'}")
    print(f"obsidian_path={latest.get('obsidian_path') or 'n/a'}")

    for bullet in bullets:
        print(f"- {bullet}")

    return 0


def run_loop(settings: Settings) -> int:
    generated_for: set[str] = set()

    while True:
        today = datetime.now(timezone.utc).date()

        if today.day == 1:
            month = previous_month(today)

            if month not in generated_for:
                review = generate(settings, month)
                generated_for.add(month)
                print(f"generated {review['period_month']} -> {review.get('obsidian_path') or 'monthly_reviews'}")

        time.sleep(settings.poll_seconds)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path)
    subcommands = parser.add_subparsers(dest="command", required=True)
    generate_parser = subcommands.add_parser("generate")
    generate_parser.add_argument("--month", required=True)
    subcommands.add_parser("generate-last-month")
    subcommands.add_parser("status")
    subcommands.add_parser("run-loop")
    args = parser.parse_args(argv)

    try:
        settings = load_settings(args.env_file)

        if args.command == "generate":
            review = generate(settings, args.month)
            print(f"generated {review['period_month']} -> {review.get('obsidian_path') or 'monthly_reviews'}")
            return 0

        if args.command == "generate-last-month":
            review = generate(settings, previous_month())
            print(f"generated {review['period_month']} -> {review.get('obsidian_path') or 'monthly_reviews'}")
            return 0

        if args.command == "status":
            return print_status(settings)

        if args.command == "run-loop":
            return run_loop(settings)
    except WorkerError as exc:
        print(f"monthly_review_worker error: {exc}", file=sys.stderr)
        return 1

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
