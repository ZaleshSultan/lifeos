#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${LIFEOS_BASE_URL:-http://localhost:3000}"
WEB_URL="${LIFEOS_WEB_URL:-http://localhost:3001}"
TMA_URL="${LIFEOS_TMA_URL:-http://localhost:5173}"

cat <<CHECKLIST
LifeOS manual test checklist

Backend:
  [ ] GET ${BASE_URL}/healthz returns status ok
  [ ] Telegram webhook rejects bad X-Telegram-Bot-Api-Secret-Token
  [ ] /start responds for a mapped Telegram user
  [ ] /cap creates a life_entities row and Obsidian queue row
  [ ] /task creates tasks plus life_entities
  [ ] /deadline records due_at
  [ ] /workout returns an inline TMA open button without workout data in URL
  [ ] /workout creates an active workout with exercises and sets
  [ ] /spend records amount metadata
  [ ] /healthsync_status reports health_sync_runs
  [ ] POST /api/health/ingest rejects missing Bearer health token
  [ ] POST /health/ingest accepts a valid previous-day payload

Web:
  [ ] ${WEB_URL}/today loads
  [ ] ${WEB_URL}/health loads
  [ ] ${WEB_URL}/finance loads
  [ ] ${WEB_URL}/study loads
  [ ] ${WEB_URL}/settings shows backend API status
  [ ] Mobile nav works at narrow viewport

TMA:
  [ ] ${TMA_URL} loads in browser
  [ ] Telegram WebApp initData header is sent from API client
  [ ] GET ${BASE_URL}/api/tma/workout/current returns exercises and sets
  [ ] POST ${BASE_URL}/api/tma/workout/sets/:setId/complete completes one set
  [ ] POST ${BASE_URL}/api/tma/workout/sets/:setId/undo undoes one set
  [ ] POST ${BASE_URL}/api/tma/workout/:workoutId/complete completes and queues sync
  [ ] Workout screen handles loading and error states

Supabase:
  [ ] RLS is enabled on user tables
  [ ] No public write policies exist
  [ ] obsidian_sync_queue receives expected rows

Obsidian worker:
  [ ] render-test succeeds
  [ ] init-dashboards creates dashboards only inside vault
  [ ] run-once writes Markdown atomically

Android:
  [ ] Health Connect permissions screen opens
  [ ] Manual sync posts previous-day payload
  [ ] Retry and reconcile schedules are registered
CHECKLIST

if command -v curl >/dev/null 2>&1; then
  printf "\nBackend health probe:\n"
  curl -fsS "${BASE_URL}/healthz" || true
  printf "\n"
fi
