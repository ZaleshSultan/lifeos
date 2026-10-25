#!/usr/bin/env bash
# Full migration chain and real overlapping transactions in an isolated database.
# Never reads .env, project DB credentials, or a production connection string.
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_container="lifeos-notification-test-${RANDOM}-$$"
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
# Deliberately excludes the security harness's exploit baseline and fixtures.
if ! {
  cat "$task_root/scripts/security-test-fixtures/setup.sql"
  for task_migration in "$task_root"/supabase/migrations/*.sql; do
    if [[ "$task_migration" == *notification_delivery_leases.sql ]]; then
      cat "$task_root/scripts/notification-test-fixtures/legacy.sql"
    fi
    cat "$task_migration"
    printf '\n'
  done
  cat "$task_root/scripts/notification-test-fixtures/setup.sql"
} | task_psql >"$task_results/setup.log" 2>&1; then
  cat "$task_results/setup.log" >&2
  exit 1
fi

# Each claim keeps row locks until COMMIT so SKIP LOCKED runs against actual
# competing transactions instead of sequential calls or a mocked scheduler.
task_pids=()
for task_worker in {1..8}; do
  task_psql -c "begin; set local role service_role; insert into notification_test.reminder_claims(worker,id,claim_token) select $task_worker,id,claim_token from public.claim_due_reminders(clock_timestamp(),3); select pg_sleep(0.25); commit;" >"$task_results/reminder-$task_worker.log" 2>&1 &
  task_pids+=("$!")
done
for task_pid in "${task_pids[@]}"; do
  if ! wait "$task_pid"; then
    cat "$task_results"/reminder-*.log >&2
    exit 1
  fi
done

task_pids=()
for task_worker in {1..8}; do
  task_psql -c "begin; set local role service_role; insert into notification_test.digest_claims(worker,id,claim_token) select $task_worker,id,claim_token from public.claim_daily_digest('00000000-0000-4000-8000-000000000001',(clock_timestamp() at time zone 'America/New_York')::date); select pg_sleep(0.25); commit;" >"$task_results/digest-$task_worker.log" 2>&1 &
  task_pids+=("$!")
done
for task_pid in "${task_pids[@]}"; do
  if ! wait "$task_pid"; then
    cat "$task_results"/digest-*.log >&2
    exit 1
  fi
done

if ! task_psql <"$task_root/scripts/notification-test-fixtures/assertions.sql" >"$task_results/assertions.log" 2>&1; then
  cat "$task_results/assertions.log" >&2
  exit 1
fi

task_count="$(task_psql -c 'select count(*) from notification_test.assertions;')"
printf 'PASS: %s notification SQL assertions; full migration chain, 8 concurrent reminder workers and 8 concurrent digest workers\n' "$task_count"
