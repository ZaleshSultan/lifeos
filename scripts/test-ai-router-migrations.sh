#!/usr/bin/env bash
# New offline, synthetic PostgreSQL only; never reads .env or hosted credentials.
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_container="lifeos-ai-router-test-${RANDOM}-$$"
task_results="$(mktemp -d)"
cleanup(){ docker rm -f "$task_container" >/dev/null 2>&1 || true; rm -rf -- "$task_results"; }
trap cleanup EXIT
docker run --rm -d --network none --log-driver none --name "$task_container" --tmpfs /var/lib/postgresql/data:rw,size=128m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:15-alpine >/dev/null
task_ready=false
for attempt in {1..60}; do
 if docker exec "$task_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then task_ready=true; break; fi
 sleep 1
done
if [[ "$task_ready" != true ]]; then printf '%s\n' 'Disposable AI router database did not become ready' >&2; exit 1; fi
for task_sql in scripts/ai-budget-test-fixtures/setup.sql supabase/migrations/20261103020000_ai_execution_budget.sql supabase/migrations/20261103040000_ai_router_settings.sql supabase/migrations/20261103050000_ai_router_accounting.sql scripts/ai-budget-test-fixtures/assertions.sql scripts/ai-router-test-fixtures/setup.sql scripts/ai-router-test-fixtures/assertions.sql; do
 docker exec -i "$task_container" psql -h 127.0.0.1 -X -q -U postgres -v ON_ERROR_STOP=1 < "$task_root/$task_sql" > "$task_results/sql-output"
done
# Eight identical first saves are retries, not eight revisions.
task_pids=()
for attempt in {1..8}; do
 docker exec "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "set role service_role; select public.save_ai_router_settings('00000000-0000-4000-8000-000000000008',public.router_test_settings(),0)->>'revision';" > "$task_results/same-$attempt" &
 task_pids+=("$!")
done
for task_pid in "${task_pids[@]}"; do wait "$task_pid"; done
python3 - "$task_results" <<'PY'
from pathlib import Path
import sys
assert [(Path(sys.argv[1])/f'same-{i}').read_text().strip() for i in range(1,9)]==['1']*8
PY
# Eight distinct updates with revision 1 yield one success and seven conflicts.
task_pids=()
for attempt in {1..8}; do
 (
  if docker exec "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "set role service_role;select public.save_ai_router_settings('00000000-0000-4000-8000-000000000008',jsonb_set(public.router_test_settings(),'{spending,maxRequestCostMicros}',to_jsonb($attempt)),1)->>'revision';" > "$task_results/cas-$attempt" 2> "$task_results/cas-$attempt.err"; then printf '%s' success > "$task_results/cas-$attempt.result";
  else if ! grep -q ai_router_settings_conflict "$task_results/cas-$attempt.err"; then cat "$task_results/cas-$attempt.err" >&2; exit 1; fi; printf '%s' conflict > "$task_results/cas-$attempt.result"; fi
 ) & task_pids+=("$!")
done
for task_pid in "${task_pids[@]}"; do wait "$task_pid"; done
python3 - "$task_results" <<'PY'
from pathlib import Path
import sys
values=[(Path(sys.argv[1])/f'cas-{i}.result').read_text() for i in range(1,9)]
assert values.count('success')==1 and values.count('conflict')==7,values
PY
# Identical execution IDs cannot reserve twice under concurrent backend calls.
task_pids=()
for attempt in {1..8}; do
 docker exec "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "set role service_role;select public.reserve_ai_router_execution('00000000-0000-4000-8000-000000000001','chat','concurrent-same','concurrent-same-task',10,0,public.ai_test_limits(),public.router_test_metadata());" > "$task_results/replay-$attempt" &
 task_pids+=("$!")
done
for task_pid in "${task_pids[@]}"; do wait "$task_pid"; done
python3 - "$task_results" <<'PY'
from pathlib import Path
import sys
values=[(Path(sys.argv[1])/f'replay-{i}').read_text().strip() for i in range(1,9)]
assert values.count('reserved')==1 and values.count('duplicate')==7,values
PY
# Existing global durable accounting still serializes router calls across owners.
task_pids=()
for attempt in {1..8}; do
 docker exec "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "set role service_role;select public.reserve_ai_router_execution(('00000000-0000-4000-8000-'||lpad('$attempt',12,'0'))::uuid,'chat','concurrent-global-$attempt','global-task-$attempt',60,0,public.ai_test_limits(1000,1000,100),public.router_test_metadata());" > "$task_results/global-$attempt" &
 task_pids+=("$!")
done
for task_pid in "${task_pids[@]}"; do wait "$task_pid"; done
python3 - "$task_results" <<'PY'
from pathlib import Path
import sys
values=[(Path(sys.argv[1])/f'global-{i}').read_text().strip() for i in range(1,9)]
assert values.count('reserved')==1 and values.count('token_budget_exceeded')==7,values
print('PASS: AI router settings/accounting migrations, prior governor API compatibility, RLS/grants, owner isolation, consent schema, null/secret rejection, immutable receipts, observed cost caps, plan/API separation, and four 8-connection concurrency cases')
PY
