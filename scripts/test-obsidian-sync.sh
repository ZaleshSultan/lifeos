#!/usr/bin/env bash
# Complete migration chain and real competing transactions in a disposable DB.
# No .env, personal vault, linked Supabase project, or external DB is consulted.
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_container="lifeos-obsidian-test-${RANDOM}-$$"
task_results="$(mktemp -d)"
cleanup() {
  docker rm -f "$task_container" >/dev/null 2>&1 || true
  rm -rf -- "$task_results"
}
trap cleanup EXIT
docker run --rm -d --name "$task_container" --tmpfs /var/lib/postgresql/data:rw,size=256m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:15-alpine >/dev/null
task_ready=false
for attempt in {1..120}; do
  if docker exec "$task_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then task_ready=true; break; fi
  sleep 1
done
if [[ "$task_ready" != true ]]; then
  printf '%s\n' 'Disposable PostgreSQL did not become ready' >&2
  exit 1
fi
task_psql() {
  docker exec -i "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 "$@"
}
if ! {
  cat "$task_root/scripts/security-test-fixtures/setup.sql"
  for task_migration in "$task_root"/supabase/migrations/*.sql; do
    if [[ "$task_migration" == *obsidian_sync_recovery.sql ]]; then
      cat "$task_root/scripts/obsidian-test-fixtures/legacy.sql"
    fi
    cat "$task_migration"
    printf '\n'
  done
  cat "$task_root/scripts/obsidian-test-fixtures/setup.sql"
} | task_psql >"$task_results/setup.log" 2>&1; then
  cat "$task_results/setup.log" >&2
  exit 1
fi

# Each transaction keeps its row locks open while competing workers claim.
# Fixture assertions run only after every process has committed successfully.
task_claim_wave() {
  local task_stage="$1"
  local task_pids=()
  for task_worker in {1..8}; do
    task_psql -v worker="$task_worker" -v stage="$task_stage" <"$task_root/scripts/obsidian-test-fixtures/claim.sql" >"$task_results/$task_stage-$task_worker.log" 2>&1 &
    task_pids+=("$!")
  done
  for task_pid in "${task_pids[@]}"; do
    if ! wait "$task_pid"; then
      cat "$task_results/$task_stage-"*.log >&2
      exit 1
    fi
  done
}
task_claim_wave independent
if ! task_psql <"$task_root/scripts/obsidian-test-fixtures/assertions.sql" >"$task_results/assertions.log" 2>&1; then
  cat "$task_results/assertions.log" >&2
  exit 1
fi
task_claim_wave contention
if ! task_psql <"$task_root/scripts/obsidian-test-fixtures/contention-assertions.sql" >"$task_results/contention-assertions.log" 2>&1; then
  cat "$task_results/contention-assertions.log" >&2
  exit 1
fi
task_pids=()
for task_actor in old recover; do
  task_psql <"$task_root/scripts/obsidian-test-fixtures/race-$task_actor.sql" >"$task_results/race-$task_actor.log" 2>&1 &
  task_pids+=("$!")
done
for task_pid in "${task_pids[@]}"; do
  if ! wait "$task_pid"; then
    cat "$task_results"/race-*.log >&2
    exit 1
  fi
done
if ! task_psql <"$task_root/scripts/obsidian-test-fixtures/race-assertions.sql" >"$task_results/race-assertions.log" 2>&1; then
  cat "$task_results/race-assertions.log" >&2
  exit 1
fi
task_count="$(task_psql -c 'select count(*) from obsidian_test.assertions;')"
printf 'PASS: %s Obsidian SQL assertions; full migration chain, 8 independent-job workers, 8 same-note contenders and expired-claim recovery race\n' "$task_count"
