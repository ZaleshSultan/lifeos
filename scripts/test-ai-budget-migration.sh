#!/usr/bin/env bash
# Never consumes project credentials or production containers; this DB is synthetic.
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_container="lifeos-ai-budget-test-${RANDOM}-$$"
task_results="$(mktemp -d)"
cleanup(){ docker rm -f "$task_container" >/dev/null 2>&1 || true; rm -rf -- "$task_results"; }
trap cleanup EXIT
docker run --log-driver none --memory 256m --cpus 1 --pids-limit 96 --rm -d --network none --name "$task_container" --tmpfs /var/lib/postgresql/data:rw,size=128m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:15-alpine > /dev/null
task_ready=false
for attempt in {1..60}; do
 if docker exec "$task_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then task_ready=true; break; fi
 sleep 1
done
if [[ "$task_ready" != true ]];then printf '%s\n' 'Disposable AI budget DB did not become ready' >&2;exit 1;fi
for task_sql in scripts/ai-budget-test-fixtures/setup.sql supabase/migrations/20261103020000_ai_execution_budget.sql scripts/ai-budget-test-fixtures/assertions.sql;do
 docker exec -i "$task_container" psql -h 127.0.0.1 -X -q -U postgres -v ON_ERROR_STOP=1 < "$task_root/$task_sql" > "$task_results/sql-output"
done
# Different owners compete for one durable global allowance through eight DB connections.
task_pids=()
for attempt in {1..8};do
 docker exec "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "set role service_role;select public.reserve_ai_execution(('00000000-0000-4000-8000-'||lpad('$attempt',12,'0'))::uuid,'chat','concurrent-$attempt','task-$attempt',60,null,public.ai_test_limits(1000,1000,100));" > "$task_results/$attempt" &
 task_pids+=("$!")
done
for task_pid in "${task_pids[@]}";do wait "$task_pid";done
python3 - "$task_results" <<'PY'
from pathlib import Path
import sys
values=[(Path(sys.argv[1])/str(i)).read_text().strip() for i in range(1,9)]
assert values.count('reserved')==1 and values.count('token_budget_exceeded')==7,values
print('PASS: durable AI accounting, RLS/grants, isolation, replay, owner/feature/global token and cost caps, loop limit, conservative failure receipts, 8 concurrent global reservations')
PY
