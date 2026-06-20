#!/usr/bin/env bash
set -uo pipefail

PUBLIC_ORIGIN="https://archlinux.tail2492c9.ts.net"
SERVICES=(
  lifeos-bot.service
  lifeos-reminder-worker.service
  lifeos-google-sync.service
  lifeos-obsidian-mirror.service
  tailscaled.service
)

for service in "${SERVICES[@]}"; do
  printf '\n== %s ==\n' "$service"
  systemctl --no-pager --full status "$service" || true
done

printf '\n== Tailscale Funnel ==\n'
tailscale funnel status || true

check_url() {
  local label="$1"
  local url="$2"

  printf '\n== %s ==\n' "$label"
  curl --fail --silent --show-error --location --max-time 20 "$url" || true
  printf '\n'
}

check_url "Local healthz" "http://localhost:3000/healthz"
check_url "Public healthz" "$PUBLIC_ORIGIN/healthz"
check_url "Public TMA" "$PUBLIC_ORIGIN/tma/"
