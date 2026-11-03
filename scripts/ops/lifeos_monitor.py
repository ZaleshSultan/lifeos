#!/usr/bin/env python3
"""Read-only service/data monitoring and opt-in, durable incident alerts to self."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request

from lifeos_backup import source_preflight
from ops_common import (Management, OpsError, atomic_json, command, env_file, load_config,
                        lock, private_dir, read_json, sha256, utcnow, utcstamp)

USER_AGENT = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Telegram-Android/11.0.0"
UNITS = ("lifeos-bot.service", "lifeos-web.service", "lifeos-lms-grades-worker.service",
         "lifeos-reminder-worker.service", "lifeos-daily-digest.service", "lifeos-obsidian-mirror.service")


def webhook_status(status: int, data: dict, origin: str, now: float) -> dict:
    """Telegram retains its last error after recovery; do not erase that history."""
    info = data.get("result", {})
    valid = (status == 200 and data.get("ok") is True and isinstance(info, dict)
             and info.get("url") == origin + "/telegram/webhook")
    if not valid:
        return {"status": "FAIL", "code": "webhook_error"}
    errors = [info.get("last_error_date"), info.get("last_synchronization_error_date")]
    if info.get("last_error_message"):
        if type(info.get("last_error_date")) is not int:
            return {"status": "FAIL", "code": "webhook_error"}
    errors = [value for value in errors if value is not None]
    if errors:
        # A recent error or an undrained queue is still an incident. Once the
        # queue is empty and all errors are at least 15 minutes old, report the
        # available configuration without claiming a fresh handset delivery.
        pending = info.get("pending_update_count")
        if (type(pending) is not int or pending != 0
                or any(type(value) is not int or value <= 0 or now - value < 900 for value in errors)):
            return {"status": "FAIL", "code": "webhook_error"}
        return {"status": "OK", "code": "webhook_available_with_history"}
    return {"status": "OK", "code": "webhook_available"}


def http(url: str, headers=None):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read(2 * 1024 * 1024 + 1)
            if len(body) > 2 * 1024 * 1024:
                raise OpsError("monitor_response_too_large")
            return response.status, body, response.headers
    except urllib.error.HTTPError as error:
        return error.code, b"", error.headers
    except OSError:
        raise OpsError("http_unavailable") from None


def signed_header(telegram_id: int, bot_token: str) -> str:
    params = {"auth_date": str(int(time.time())), "user": json.dumps({"id": telegram_id}, separators=(",", ":"))}
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    params["hash"] = hmac.new(secret, "\n".join(key + "=" + params[key] for key in sorted(params)).encode(), hashlib.sha256).hexdigest()
    return urllib.parse.urlencode(params)


def collect(config: dict) -> dict:
    checks = {}
    environment = env_file(Path(config["bot_env_file"]))
    origin = config["public_origin"].rstrip("/")
    parsed = urllib.parse.urlsplit(origin)
    bot_origin = urllib.parse.urlsplit(environment.get("TMA_URL", ""))
    if (parsed.scheme != "https" or parsed.username or parsed.password or parsed.path
            or parsed.query or parsed.fragment or parsed.netloc != bot_origin.netloc):
        raise OpsError("monitor_public_origin_mismatch")

    def check(name, callback):
        try:
            checks[name] = callback()
        except Exception as error:
            checks[name] = {"status": "FAIL", "code": str(error) if isinstance(error, OpsError) else "probe_unavailable"}

    def page(url, kind):
        status, body, headers = http(url)
        valid = status == 200
        if kind == "health":
            valid = valid and json.loads(body).get("status") == "ok"
        elif kind == "tma":
            valid = valid and b"/tma/assets/" in body
        elif kind == "web":
            valid = valid and "text/html" in headers.get("Content-Type", "")
        return {"status": "OK" if valid else "FAIL", "code": "available" if valid else "http_probe_failed", "http_status": status}

    check("backend_local", lambda: page("http://127.0.0.1:3000/healthz", "health"))
    check("backend_https", lambda: page(origin + "/healthz", "health"))
    check("tma_delivery", lambda: page(origin + "/tma/", "tma"))
    check("web_delivery", lambda: page(origin + "/web/access", "web"))
    check("tunnel_ready", lambda: page("http://127.0.0.1:20242/ready", "ready"))
    for unit in UNITS:
        def unit_state(name=unit):
            state = command(["systemctl", "is-active", name], timeout=10).decode().strip()
            return {"status": "OK" if state == "active" else "FAIL", "code": "active" if state == "active" else "worker_inactive"}
        check(unit, unit_state)

    token = environment.get("TELEGRAM_BOT_TOKEN", "")
    header = signed_header(config["canonical_telegram_user_id"], token)
    for name, path in [("ideal_human_api", "/api/tma/ideal-human/days"), ("study_api", "/api/tma/study")]:
        def authenticated(path=path):
            status, body, headers = http(origin + path, {"X-Telegram-Init-Data": header})
            valid = status == 200 and "data" in json.loads(body) and headers.get("Cache-Control") == "no-store"
            return {"status": "OK" if valid else "FAIL", "code": "authenticated_read_verified" if valid else "authenticated_read_failed", "http_status": status}
        check(name, authenticated)

    def telegram():
        status, raw, _ = http("https://api.telegram.org/bot" + token + "/getWebhookInfo")
        data = json.loads(raw)
        return webhook_status(status, data, origin, time.time())
    check("telegram_bot", telegram)
    management = Management(config)

    def database():
        source_preflight(config, management)
        return {"status": "OK", "code": "canonical_identity_and_userdata_verified"}
    check("database", database)

    def lms():
        from lifeos_backup import owner
        rows = management.query("select auth_mode,is_token_valid,session_state,session_expires_at,last_sync_success_at,is_active from public.user_lms_settings where user_id='" + owner(config) + "'::uuid and platform_type='aitu_moodle'")
        if not rows:
            return {"status": "WARN", "code": "lms_reconnect_required"}
        row = rows[0]
        session_expired = row.get("auth_mode") == "session" and (
            row.get("session_state") in {"not_configured", "session_expired", "reauthentication_required"}
            or (row.get("session_expires_at") is not None and dt.datetime.fromisoformat(row["session_expires_at"]) <= utcnow()))
        if not row.get("is_active") or not row.get("is_token_valid") or session_expired:
            return {"status": "WARN", "code": "lms_reconnect_required"}
        if not row.get("last_sync_success_at"):
            return {"status": "WARN", "code": "lms_no_verified_sync"}
        age = (utcnow() - dt.datetime.fromisoformat(row["last_sync_success_at"])).total_seconds()
        stale = age < 0 or age > config.get("lms_max_age_hours", 24) * 3600
        return {"status": "WARN" if stale else "OK", "code": "lms_sync_stale" if stale else "lms_sync_fresh", "sync_age_hours": round(age / 3600, 1)}
    check("lms_freshness", lms)

    def backup():
        state = Path(config["state_dir"])
        success = read_json(state / "last-success.json", {})
        attempt = read_json(state / "last-attempt.json", {})
        if not success.get("verified"):
            raise OpsError("backup_missing")
        age = (utcnow() - dt.datetime.fromisoformat(success["completed_at_utc"])).total_seconds()
        if age < 0 or age > config.get("backup_max_age_hours", 30) * 3600:
            raise OpsError("backup_stale")
        manifest = read_json(Path(success["manifest"]))
        archive = Path(success["manifest"]).parent / manifest["filename"]
        if sha256(archive) != success["cipher_sha256"]:
            raise OpsError("backup_checksum_failed")
        if attempt.get("status") == "failed" and attempt.get("at_utc", "") > success["completed_at_utc"]:
            raise OpsError("backup_last_attempt_failed")
        # Detect SIGKILL/OOM/timeout too: Python cannot update its state after
        # such a termination. A oneshot being inactive is normal after success.
        properties = command(["systemctl", "--user", "show", "lifeos-backup.service",
                              "-p", "LoadState", "-p", "Result"], timeout=10).decode()
        unit = dict(line.split("=", 1) for line in properties.splitlines() if "=" in line)
        if unit.get("LoadState") == "loaded" and unit.get("Result") not in {None, "success"}:
            raise OpsError("backup_service_failed")
        return {"status": "OK", "code": "encrypted_backup_verified", "age_hours": round(age / 3600, 1)}
    check("backup", backup)

    def offsite_backup():
        if not config.get("offsite_remote"):
            return {"status": "WARN", "code": "offsite_backup_not_configured"}
        success = read_json(Path(config["state_dir"]) / "last-success.json", {})
        offsite = success.get("offsite", {})
        return {"status": "OK" if offsite.get("verified") else "WARN",
                "code": "offsite_backup_verified" if offsite.get("verified") else "offsite_backup_unavailable"}
    check("offsite_backup", offsite_backup)

    def restore_age():
        state = read_json(Path(config["state_dir"]) / "last-restore-success.json", {})
        if not state.get("success"):
            raise OpsError("restore_drill_missing")
        age = (utcnow() - dt.datetime.fromisoformat(state["finished_at_utc"])).total_seconds()
        if age < 0 or age > 8 * 86400:
            raise OpsError("restore_drill_stale")
        return {"status": "OK", "code": "isolated_restore_verified", "age_hours": round(age / 3600, 1)}
    check("restore_drill", restore_age)
    check("disk", lambda: {"status": "OK" if shutil.disk_usage(config["backup_dir"]).free >= 2 * 1024**3 else "FAIL", "code": "space_available" if shutil.disk_usage(config["backup_dir"]).free >= 2 * 1024**3 else "disk_space_low"})
    return checks


def update_incident(previous: dict | None, current: dict, *, threshold=2, suppress_initial=True) -> tuple[dict, bool]:
    """Pure decision; a stable existing degraded baseline does not spam the user."""
    if current["status"] == "OK":
        return {"status": "OK", "code": current["code"], "failures": 0, "reserved": False, "baseline": False}, False
    same = previous and previous.get("status") == current["status"] and previous.get("code") == current["code"]
    state = {"status": current["status"], "code": current["code"],
             "failures": previous.get("failures", 0) + 1 if same else 1,
             "reserved": bool(previous.get("reserved")) if same else False,
             "baseline": current["status"] == "WARN" and (bool(previous.get("baseline")) if same else previous is None and suppress_initial)}
    notify = state["failures"] >= threshold and not state["reserved"] and not state["baseline"]
    return state, notify


def send_alert(config: dict, component: str, code: str) -> None:
    environment = env_file(Path(config["bot_env_file"]))
    destination = config["canonical_telegram_user_id"]
    admins = {int(value) for value in re.findall(r"\d+", environment.get("LIFEOS_ADMIN_TELEGRAM_IDS", ""))}
    if destination not in admins or not re.fullmatch(r"[A-Za-z0-9_.-]+", component) or not re.fullmatch(r"[a-z0-9_]+", code):
        raise OpsError("alert_recipient_or_code_rejected")
    request = urllib.request.Request("https://api.telegram.org/bot" + environment["TELEGRAM_BOT_TOKEN"] + "/sendMessage",
                                    data=json.dumps({"chat_id": destination, "text": "LifeOS operations: " + component + " — " + code + ". Check the private operations status/runbook."}).encode(),
                                    headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            data = json.loads(response.read(4096))
        if not data.get("ok"):
            raise OpsError("alert_delivery_unconfirmed")
    except Exception:
        raise OpsError("alert_delivery_unconfirmed") from None


def run_monitor(config: dict, *, dry_run=False) -> dict:
    state_dir = private_dir(Path(config["state_dir"]))
    with lock(state_dir / "monitor.lock"):
        checks = collect(config)
        path = state_dir / "incidents.json"
        previous = read_json(path, {})
        incidents = {}
        alerts = []
        for component, current in checks.items():
            state, notify = update_incident(previous.get(component), current,
                                            threshold=config.get("alert_failure_threshold", 2),
                                            suppress_initial=config.get("suppress_initial_alerts", True))
            if notify and config.get("alerts_enabled") and not dry_run:
                # Durable reservation BEFORE networking: a crash or ambiguous
                # response cannot resend the same incident after a restart.
                state["reserved"] = True
                alerts.append((component, current["code"]))
            incidents[component] = state
        if not dry_run:
            atomic_json(path, incidents)
        delivery = []
        for component, code in alerts:
            try:
                send_alert(config, component, code)
                delivery.append({"component": component, "status": "acknowledged"})
            except OpsError:
                delivery.append({"component": component, "status": "unconfirmed_no_automatic_retry"})
        status = "FAIL" if any(value["status"] == "FAIL" for value in checks.values()) else "WARN" if any(value["status"] == "WARN" for value in checks.values()) else "OK"
        result = {"checked_at_utc": utcstamp(), "status": status, "checks": checks,
                  "dry_run": dry_run, "alerts_attempted": len(delivery), "alert_delivery": delivery}
        if not dry_run:
            atomic_json(state_dir / "monitor-status.json", result)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path.home() / ".config/lifeos/ops.json")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        result = run_monitor(load_config(args.config), dry_run=args.dry_run)
        print(json.dumps(result, sort_keys=True))
        # Expected disconnected/stale integrations remain explicit WARNs. Only
        # critical failure marks the timer invocation failed.
        raise SystemExit(1 if result["status"] == "FAIL" else 0)
    except Exception as error:
        print(json.dumps({"status": "FAIL", "error": str(error) if isinstance(error, OpsError) else "monitor_internal_error"}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
