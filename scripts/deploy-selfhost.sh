#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_ORIGIN="https://lifeos.zalewko.me"

check_url() {
  local label="$1"
  local url="$2"

  printf 'Checking %-18s %s ... ' "$label" "$url"
  for _ in {1..20}; do
    if curl --fail --silent --show-error --location --max-time 20 --output /dev/null "$url"; then
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

  if [[ -t 0 ]]; then
    sudo systemctl restart "$service"
    return
  fi

  if sudo -n systemctl restart "$service" 2>/dev/null; then
    return
  fi

  local service_user
  local restart_policy
  local old_pid
  service_user="$(systemctl show "$service" -p User --value)"
  restart_policy="$(systemctl show "$service" -p Restart --value)"
  old_pid="$(systemctl show "$service" -p MainPID --value)"

  if [[ "$service_user" != "$(id -un)" || "$restart_policy" == "no" || ! "$old_pid" =~ ^[0-9]+$ || "$old_pid" -le 1 ]]; then
    printf 'ERROR: cannot restart %s without interactive sudo\n' "$service" >&2
    return 1
  fi

  printf 'sudo is unavailable; sending TERM to %s main PID %s and waiting for systemd restart ...\n' "$service" "$old_pid"
  kill -TERM "$old_pid"

  for _ in {1..15}; do
    sleep 1
    local new_pid
    new_pid="$(systemctl show "$service" -p MainPID --value)"
    if [[ "$new_pid" != "$old_pid" && "$new_pid" -gt 1 ]]; then
      return
    fi
  done

  printf 'TERM did not move %s; sending KILL to main PID %s ...\n' "$service" "$old_pid"
  kill -KILL "$old_pid"

  for _ in {1..20}; do
    sleep 1
    local new_pid
    new_pid="$(systemctl show "$service" -p MainPID --value)"
    if [[ "$new_pid" != "$old_pid" && "$new_pid" -gt 1 ]]; then
      return
    fi
  done

  printf 'ERROR: %s did not restart after process signal fallback\n' "$service" >&2
  return 1
}

cd "$REPO_ROOT"
"$REPO_ROOT/scripts/build-tma-selfhost.sh"

printf 'Restarting lifeos-bot.service ...\n'
restart_service lifeos-bot.service
systemctl is-active --quiet lifeos-bot.service
printf 'OK: lifeos-bot.service is active\n'

check_url "local healthz" "http://localhost:3000/healthz"
check_url "public healthz" "$PUBLIC_ORIGIN/healthz"
check_url "public TMA" "$PUBLIC_ORIGIN/tma/"

printf 'OK: self-host deployment checks passed\n'
