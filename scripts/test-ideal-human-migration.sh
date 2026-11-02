#!/usr/bin/env bash
# Runs exclusively against a newly-created disposable local PostgreSQL container.
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_container="lifeos-ideal-human-test-${RANDOM}-$$"
task_results="$(mktemp -d)"
cleanup() {
  docker rm -f "$task_container" >/dev/null 2>&1 || true
  rm -rf -- "$task_results"
}
trap cleanup EXIT
docker run --rm -d --network none --name "$task_container" --tmpfs /var/lib/postgresql/data:rw,size=128m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:15-alpine > /dev/null
task_ready=false
for attempt in {1..60}; do
  if docker exec "$task_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then task_ready=true; break; fi
  sleep 1
done
if [[ "$task_ready" != true ]]; then printf '%s\n' 'Disposable PostgreSQL did not become ready' >&2; exit 1; fi
for task_sql in scripts/ideal-human-test-fixtures/setup.sql supabase/migrations/20261102120000_ideal_human_days.sql scripts/ideal-human-test-fixtures/assertions.sql; do
  docker exec -i "$task_container" psql -h 127.0.0.1 -X -q -U postgres -v ON_ERROR_STOP=1 < "$task_root/$task_sql" > "$task_results/sql-output"
done
# Eight independent connections submit different versions of one missing date.
# Exactly one wins; all others must receive the explicit revision conflict.
task_pids=()
for attempt in {1..8}; do
  (
    if docker exec "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "set role service_role; select public.save_ideal_human_day('00000000-0000-4000-8000-000000000001','2026-11-06',jsonb_build_object('date','2026-11-06','notes','concurrent-$attempt'),0)->>'revision';" > "$task_results/$attempt" 2> "$task_results/$attempt.err"; then
      printf '%s\n' success > "$task_results/$attempt.result"
    else
      if ! grep -q 'ideal_human_conflict' "$task_results/$attempt.err"; then cat "$task_results/$attempt.err" >&2; exit 1; fi
      printf '%s\n' conflict > "$task_results/$attempt.result"
    fi
  ) &
  task_pids+=("$!")
done
for task_pid in "${task_pids[@]}"; do wait "$task_pid"; done
python3 - "$task_results" <<'PY'
from pathlib import Path
import sys
results=[(Path(sys.argv[1])/f'{i}.result').read_text().strip() for i in range(1,9)]
assert results.count('success') == 1 and results.count('conflict') == 7, results
print('PASS: Ideal Human migration, RLS/grants, legacy preservation, isolation, date validation, CAS, idempotent retry, atomic rollback, blocked profiles, 8 concurrent writes')
PY
