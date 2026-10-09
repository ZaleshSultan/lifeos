#!/usr/bin/env bash
set -uo pipefail
SERVICES=(lifeos-bot.service lifeos-reminder-worker.service lifeos-daily-digest.service lifeos-google-sync.service lifeos-obsidian-mirror.service)
for service in "${SERVICES[@]}"; do
  printf '%s: ' "$service"
  systemctl is-active "$service" || true
done
# Avoid systemctl status/cat: service command lines may contain private tokens.
if [[ -n "${TMA_URL:-}" ]]; then
  python3 "$(dirname -- "${BASH_SOURCE[0]}")/smoke-tma.py" "$TMA_URL"
else
  printf 'Set TMA_URL to check public frontend HTML and assets.\n'
fi
curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:${PORT:-3000}/healthz"
printf '\n'
