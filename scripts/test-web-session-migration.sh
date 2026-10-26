#!/usr/bin/env bash
# Uses only a newly created disposable container, never project DB credentials.
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_container="lifeos-web-session-test-${RANDOM}-$$"
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
for task_sql in \
  scripts/web-session-test-fixtures/setup.sql \
  supabase/migrations/20261022142222_secure_web_sessions.sql \
  scripts/web-session-test-fixtures/assertions.sql; do
  docker exec -i "$task_container" psql -h 127.0.0.1 -X -q -U postgres -v ON_ERROR_STOP=1 < "$task_root/$task_sql" > "$task_results/sql-output"
done

docker exec "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "set role service_role; select public.issue_web_login_token('00000000-0000-4000-8000-000000000001', repeat('f',64), clock_timestamp()+interval '120 seconds');" > /dev/null
# Independent database connections/transactions, not a mock's scheduling behavior.
task_pids=()
for attempt in {1..8}; do
  docker exec "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "set role service_role; select public.exchange_web_login_token('00000000-0000-4000-8000-000000000001', repeat('f',64), md5('concurrent-$attempt') || md5('concurrent-$attempt')) is not null;" > "$task_results/$attempt" &
  task_pids+=("$!")
done
for task_pid in "${task_pids[@]}"; do wait "$task_pid"; done
python3 - "$task_results" <<'PY'
from pathlib import Path
import sys
results = [(Path(sys.argv[1]) / str(i)).read_text().strip() for i in range(1, 9)]
assert results.count('t') == 1 and results.count('f') == 7, results
print('PASS: migration, privileges, expiration, replay, rollback, revocation, isolation, block/unblock, 8 concurrent exchanges')
PY

# Compete a fresh exchange with a profile block in separate transactions.
# Whichever acquires the profile lock first, no live session can survive the block.
docker exec "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "set role service_role; select public.issue_web_login_token('00000000-0000-4000-8000-000000000001', md5('block-race') || md5('block-race'), clock_timestamp()+interval '120 seconds');" > /dev/null
docker exec "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "begin; set local role service_role; select public.exchange_web_login_token('00000000-0000-4000-8000-000000000001', md5('block-race') || md5('block-race'), md5('race-session') || md5('race-session')); select pg_sleep(1); commit;" > /dev/null &
task_exchange_pid="$!"
docker exec "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "set role service_role; update public.profiles set status='blocked' where user_id='00000000-0000-4000-8000-000000000001';" > /dev/null
wait "$task_exchange_pid"
task_live="$(docker exec "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "select count(*) from public.web_sessions where user_id='00000000-0000-4000-8000-000000000001' and revoked_at is null;")"
[[ "$task_live" == "0" ]]
printf '%s\n' 'PASS: concurrent exchange versus profile block leaves no live sessions'
