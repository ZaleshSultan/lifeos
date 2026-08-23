#!/usr/bin/env python3
"""Sync university grades and marks from Platonus into LifeOS."""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Resolve the workers/ directory path for imports
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from common.lifeos_sync import (  # noqa: E402
    BaseSettings,
    SupabaseRestClient,
    SyncError,
    SyncStats,
    getenv_bool,
    getenv_int,
    getenv_required,
    iso_utc,
    load_base_settings,
    load_dotenv,
    stable_checksum,
)

MOCK_COURSES = [
    {
        "course_id": "crop_prod",
        "course_title": "Crop Production",
        "assessments": [
            {"assessment_id": "assign_1", "title": "Lab 1: Seed Quality", "record_type": "assignment", "score": 8.5, "max_score": 10.0},
            {"assessment_id": "assign_2", "title": "Homework 2: Yield Estimation", "record_type": "assignment", "score": 9.0, "max_score": 10.0},
            {"assessment_id": "midterm", "title": "Midterm Examination", "record_type": "midterm", "score": 18.0, "max_score": 20.0},
            {"assessment_id": "final", "title": "Final Examination", "record_type": "final", "score": 52.0, "max_score": 60.0},
        ]
    },
    {
        "course_id": "agri_mach",
        "course_title": "Agricultural Machinery",
        "assessments": [
            {"assessment_id": "assign_1", "title": "Project: Tractor Design", "record_type": "assignment", "score": 9.5, "max_score": 10.0},
            {"assessment_id": "midterm", "title": "Midterm Exam", "record_type": "midterm", "score": 17.5, "max_score": 20.0},
            {"assessment_id": "final", "title": "Final Examination", "record_type": "final", "score": 54.0, "max_score": 60.0},
        ]
    },
    {
        "course_id": "soil_sci",
        "course_title": "Soil Science",
        "assessments": [
            {"assessment_id": "assign_1", "title": "Lab: Soil pH measurement", "record_type": "assignment", "score": 7.0, "max_score": 10.0},
            {"assessment_id": "midterm", "title": "Midterm Test", "record_type": "midterm", "score": 15.0, "max_score": 20.0},
            {"assessment_id": "final", "title": "Final Examination", "record_type": "final", "score": 48.0, "max_score": 60.0},
        ]
    }
]


@dataclass(frozen=True)
class Settings:
    base: BaseSettings
    username: str
    password: str
    poll_seconds: int
    allow_mock: bool  # Explicit opt-in for mock fallback (never automatic)


def load_settings(env_file: Path | None = None) -> Settings:
    load_dotenv(Path(__file__).with_name(".env"))
    if env_file:
        load_dotenv(env_file)
    return Settings(
        base=load_base_settings(
            legacy_guard_env="LIFEOS_ENABLE_LEGACY_SINGLE_USER_PLATONUS_SYNC",
            worker_name="Platonus sync",
        ),
        username=getenv_required("PLATONUS_USERNAME"),
        password=getenv_required("PLATONUS_PASSWORD"),
        poll_seconds=getenv_int("PLATONUS_SYNC_POLL_SECONDS", 3600),
        allow_mock=getenv_bool("PLATONUS_SYNC_MOCK_MODE", False),
    )


class PlatonusClient:
    """Resilient client for interacting with the Platonus API."""

    def __init__(self, settings: Settings):
        self.username = settings.username
        self.password = settings.password
        self.base_url = "https://platonus.kazatu.kz"
        self.token: str | None = None
        self.is_mocked = False
        self._allow_mock = settings.allow_mock

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        url = f"{self.base_url}/{path.lstrip('/')}"
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "LifeOS Platonus Sync Worker/1.0",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            logging.debug("Platonus API HTTP Error %d on %s: %s", exc.code, path, exc.read())
            raise
        except Exception as exc:
            logging.debug("Platonus API network exception on %s: %s", path, exc)
            raise

    def authenticate(self) -> None:
        """Authenticate with the Platonus portal."""
        # Standard endpoints tried: /api/auth/login or /api/login or /api/client/login
        auth_paths = ["api/auth/login", "api/login", "api/client/login"]
        for path in auth_paths:
            try:
                res = self._request("POST", path, {"username": self.username, "password": self.password})
                if res and isinstance(res, dict):
                    # Check standard response formats
                    token = res.get("access_token") or res.get("token") or res.get("jwt")
                    if token:
                        self.token = token
                        logging.info("Successfully authenticated with Platonus at endpoint: %s", path)
                        return
            except Exception:
                continue

        # If all login attempts fail (due to Cloudflare, captcha, IP block, portal down, etc.), fallback to mock mode
        if not self._allow_mock:
            raise SyncError(
                "Platonus authentication failed or is blocked (Cloudflare, CAPTCHA, IP "
                "block, or portal down). Refusing to fall back to mock data automatically. "
                "Set PLATONUS_SYNC_MOCK_MODE=true to explicitly opt into mock mode "
                "(e.g. for local pipeline testing)."
            )
        self.is_mocked = True
        logging.warning(
            "[WARNING] Platonus authentication failed or is blocked by portal security (e.g. Cloudflare, CAPTCHA). "
            "Running in resilient mock mode with simulated academic records."
        )

    def fetch_grades(self) -> list[dict[str, Any]]:
        """Fetch academic marks/grades."""
        if self.is_mocked:
            return self._get_mock_grades()

        # Try standard endpoints for grades
        endpoints = ["api/student/marks", "api/student/grades", "api/v1/student/marks"]
        for endpoint in endpoints:
            try:
                res = self._request("GET", endpoint)
                if res and isinstance(res, list):
                    logging.info("Successfully fetched grades from Platonus endpoint: %s", endpoint)
                    return res
            except Exception:
                continue

        # Fallback to mocked data if fetch fails
        if not self._allow_mock:
            raise SyncError(
                "Platonus grades request failed or is blocked. Refusing to fall back to "
                "mock data automatically. Set PLATONUS_SYNC_MOCK_MODE=true to explicitly "
                "opt into mock mode (e.g. for local pipeline testing)."
            )
        self.is_mocked = True
        logging.warning(
            "[WARNING] Platonus grades request failed or is blocked. Running in resilient mock mode."
        )
        return self._get_mock_grades()

    def _get_mock_grades(self) -> list[dict[str, Any]]:
        records = []
        for course in MOCK_COURSES:
            for ass in course["assessments"]:
                records.append({
                    "course_id": course["course_id"],
                    "course_title": course["course_title"],
                    "assessment_id": ass["assessment_id"],
                    "title": ass["title"],
                    "record_type": ass["record_type"],
                    "score": ass["score"],
                    "max_score": ass["max_score"],
                })
        return records


def sync_grades(client: SupabaseRestClient, settings: Settings, grades: list[dict[str, Any]], mode: str, run_id: str | None = None) -> SyncStats:
    """Sync the fetched grades to Supabase source_events and academic_records."""
    if run_id is None:
        source = client.ensure_source("university_platform", "university", "University Platform")
        run_id = client.start_sync_run(source)
    stats = SyncStats(seen=len(grades))

    try:
        seen_ids = set()
        for record in grades:
            course_id = record.get("course_id", "unknown")
            assessment_id = record.get("assessment_id", "unknown")
            course_title = record.get("course_title", "Unknown Course")
            assessment_title = record.get("title", "Assessment")
            record_type = record.get("record_type", "assignment")
            score = float(record.get("score") or 0.0)
            max_score = float(record.get("max_score") or 10.0)
            percentage = (score / max_score * 100.0) if max_score > 0 else 0.0

            external_id = f"academic:platonus:{course_id}:{assessment_id}"
            seen_ids.add(external_id)

            # Build source event dictionary
            event_dict = {
                "source_key": "university_platform",
                "external_id": external_id,
                "event_type": "academic_grade",
                "title": assessment_title,
                "description": f"Platonus grade entry for course {course_title}",
                "status": "active",
                "due_at": iso_utc(datetime.now(timezone.utc)),
                "raw_json": record,
            }

            # Upsert into source_events
            synced_event, created, reminder_stats = client.upsert_event(event_dict, mode)
            stats.created += int(created)
            stats.updated += int(not created)
            stats.reminders_created += reminder_stats.created
            stats.reminders_updated += reminder_stats.updated
            stats.reminders_cancelled += reminder_stats.cancelled

            # Upsert into public.academic_records idempotently
            source_event_id = synced_event["id"]
            existing = client.request(
                "GET",
                "academic_records",
                query={
                    "select": "id",
                    "user_id": f"eq.{client.settings.user_id}",
                    "source_event_id": f"eq.{source_event_id}",
                    "limit": "1",
                }
            )

            academic_record_payload = {
                "user_id": settings.base.user_id,
                "source_event_id": source_event_id,
                "course_title": course_title,
                "record_type": record_type,
                "title": assessment_title,
                "score": score,
                "max_score": max_score,
                "percentage": percentage,
                "raw_json": record,
            }

            if existing:
                record_id = existing[0]["id"]
                client.request("PATCH", "academic_records", query={"id": f"eq.{record_id}"}, body=academic_record_payload)
            else:
                client.request("POST", "academic_records", body=academic_record_payload)

        # Mark any no-longer-reported events as missing
        stats.missing = client.mark_missing("university_platform", seen_ids)
        client.finish_sync_run(run_id, "success", stats)
        return stats
    except Exception as exc:
        client.finish_sync_run(run_id, "failed", stats, str(exc))
        raise


def sync_once(settings: Settings) -> SyncStats:
    """Run single sync execution."""
    client = PlatonusClient(settings)
    db_client = SupabaseRestClient(settings.base)

    # Open the sync_run before attempting live auth/fetch, so a failure here
    # (e.g. mock mode disabled and the portal is blocked) still lands in
    # sync_runs instead of only the systemd journal.
    source = db_client.ensure_source("university_platform", "university", "University Platform")
    run_id = db_client.start_sync_run(source)

    try:
        client.authenticate()
        grades = client.fetch_grades()
    except Exception as exc:
        db_client.finish_sync_run(run_id, "failed", SyncStats(), str(exc))
        raise

    mode = db_client.get_reminder_mode()
    return sync_grades(db_client, settings, grades, mode, run_id=run_id)


def status(settings: Settings) -> None:
    """Print sync status details."""
    print("Platonus university sync status")
    print(f"Credentials configured for user: {settings.username}")
    db_client = SupabaseRestClient(settings.base)
    for row in db_client.source_status(["university_platform"]):
        print(f"{row['source_key']}: {row['status']} last_sync={row.get('last_sync_at') or 'never'}")


def run_loop(settings: Settings) -> None:
    """Sync continuously in a loop."""
    while True:
        try:
            results = sync_once(settings)
            logging.info("platonus_sync complete stats=%s", results)
        except Exception as exc:  # noqa: BLE001
            logging.exception("platonus_sync iteration failed: %s", exc)
        time.sleep(settings.poll_seconds)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="LifeOS Platonus university sync")
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("command", choices=("status", "sync-once", "run-loop"))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        settings = load_settings(args.env_file)
        if args.command == "status":
            status(settings)
        elif args.command == "sync-once":
            stats = sync_once(settings)
            print(json.dumps(vars(stats), indent=2))
        else:
            run_loop(settings)
        return 0
    except (SyncError, OSError, ValueError) as exc:
        logging.error("%s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
