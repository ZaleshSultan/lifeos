#!/usr/bin/env bash
# Only disposable, network-isolated PostgreSQL and synthetic owners; no .env reads.
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_container="lifeos-ai-provider-quota-${RANDOM}-$$"
task_results="$(mktemp -d)"
cleanup(){ docker rm -f "$task_container" >/dev/null 2>&1 || true; rm -rf -- "$task_results"; }
trap cleanup EXIT
docker run --rm -d --network none --log-driver none --memory 256m --cpus 1 --pids-limit 96 --name "$task_container" --tmpfs /var/lib/postgresql/data:rw,size=128m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:15-alpine >/dev/null
task_ready=false
for attempt in {1..60}; do
  if docker exec "$task_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then task_ready=true; break; fi
  sleep 1
done
if [[ "$task_ready" != true ]]; then printf '%s\n' 'Isolated provider-quota database unavailable' >&2; exit 1; fi
for task_sql in scripts/ai-budget-test-fixtures/setup.sql supabase/migrations/20261103020000_ai_execution_budget.sql supabase/migrations/20261103050000_ai_router_accounting.sql scripts/ai-router-test-fixtures/setup.sql supabase/migrations/20261104030000_ai_provider_quotas.sql scripts/ai-provider-quota-test-fixtures/assertions.sql; do
  docker exec -i "$task_container" psql -h 127.0.0.1 -X -q -U postgres -v ON_ERROR_STOP=1 < "$task_root/$task_sql" > "$task_results/sql-output"
done
task_pids=()
for attempt in {1..8}; do
  docker exec "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "set role service_role; select public.reserve_ai_provider_attempt(('00000000-0000-4000-8000-'||lpad('$attempt',12,'0'))::uuid,'parallel-$attempt','classification',1,'openrouter','concurrent-account','fixture/free:free',10,public.quota_test_limits(20,3))->>'outcome';" > "$task_results/parallel-$attempt" &
  task_pids+=("$!")
done
for task_pid in "${task_pids[@]}"; do wait "$task_pid"; done
task_pids=()
for attempt in {1..8}; do
  docker exec "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "set role service_role; select public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000008','same-attempt','classification',1,'gemini','concurrent-project','gemini-free',10,public.quota_test_limits())->>'outcome';" > "$task_results/replay-$attempt" &
  task_pids+=("$!")
done
for task_pid in "${task_pids[@]}"; do wait "$task_pid"; done
python3 - "$task_results" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
parallel=[(p/f'parallel-{i}').read_text().strip()for i in range(1,9)]
replay=[(p/f'replay-{i}').read_text().strip()for i in range(1,9)]
assert parallel.count('reserved')==3 and parallel.count('day_limit')==5,parallel
assert replay.count('reserved')==1 and replay.count('duplicate')==7,replay
print('PASS: provider quotas link existing governed executions, RLS/grants, owner isolation, zero-cost budget, failed attempt retention, shared request/token caps, durable cooldown, Pacific/UTC/DST boundaries; two 8-connection concurrency groups')
PY
