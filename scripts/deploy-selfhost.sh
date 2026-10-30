#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_ORIGIN="https://lifeos.zalewko.me"
# The public edge rejects generic CLI user agents. Probe the same route used by
# a Telegram browser without changing reverse-proxy or Cloudflare settings.
BROWSER_USER_AGENT='Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Telegram-Android/11.0.0'
CHECK_BODY="$(mktemp "${TMPDIR:-/tmp}/lifeos-deploy-check.XXXXXX")"
trap 'rm -f -- "$CHECK_BODY"' EXIT

check_url() {
  local label="$1"
  local url="$2"
  local kind="$3"

  printf 'Checking %-18s %s ... ' "$label" "$url"
  for _ in {1..20}; do
    if curl --fail --silent --show-error --location --max-time 20 \
      --user-agent "$BROWSER_USER_AGENT" --output "$CHECK_BODY" "$url" && \
      node --input-type=module - "$CHECK_BODY" "$kind" <<'NODE'
import { readFileSync } from "node:fs";
try {
  const body = readFileSync(process.argv[2], "utf8");
  const valid = process.argv[3] === "health"
    ? JSON.parse(body)?.status === "ok"
    : /(?:src|href)=["']\/tma\/assets\/[^"']+\.js/.test(body);
  process.exit(valid ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
    then
      printf 'OK\n'
      return
    fi
    sleep 1
  done

  printf 'FAILED\n' >&2
  return 1
}

restart_service() {
  local service="$1"

  if sudo -n systemctl restart "$service" 2>/dev/null; then
    return
  fi

  local service_user
  local restart_policy
  local old_pid
  service_user="$(systemctl show "$service" -p User --value)"
  restart_policy="$(systemctl show "$service" -p Restart --value)"
  old_pid="$(systemctl show "$service" -p MainPID --value)"

  if [[ "$service_user" != "$(id -un)" || "$restart_policy" != "always" || ! "$old_pid" =~ ^[0-9]+$ || "$old_pid" -le 1 ]]; then
    printf 'ERROR: cannot restart %s without interactive sudo\n' "$service" >&2
    return 1
  fi

  printf 'sudo is unavailable; sending TERM to %s main PID %s and waiting for systemd restart ...\n' "$service" "$old_pid"
  kill -TERM "$old_pid"

  for _ in {1..15}; do
    sleep 1
    local new_pid
    new_pid="$(systemctl show "$service" -p MainPID --value)"
    if [[ "$new_pid" =~ ^[0-9]+$ && "$new_pid" != "$old_pid" && "$new_pid" -gt 1 ]]; then
      return
    fi
  done

  printf 'ERROR: %s did not restart after TERM; inspect it before retrying\n' "$service" >&2
  return 1
}

cd "$REPO_ROOT"
bash "$REPO_ROOT/scripts/build-tma-selfhost.sh"

printf 'Restarting lifeos-bot.service ...\n'
restart_service lifeos-bot.service
systemctl is-active --quiet lifeos-bot.service
printf 'OK: lifeos-bot.service is active\n'

check_url "local healthz" "http://localhost:3000/healthz" health
check_url "public healthz" "$PUBLIC_ORIGIN/healthz" health
check_url "public TMA" "$PUBLIC_ORIGIN/tma/" tma

printf 'OK: self-host deployment checks passed\n'
