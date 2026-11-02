#!/usr/bin/env bash
# Starts only a new offline database with synthetic identities; never uses project credentials.
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_container="lifeos-daily-life-test-${RANDOM}-$$"
task_results="$(mktemp -d)"
cleanup(){ docker rm -f "$task_container" >/dev/null 2>&1 || true;rm -rf -- "$task_results"; }
trap cleanup EXIT
docker run --rm -d --network none --name "$task_container" --tmpfs /var/lib/postgresql/data:rw,size=128m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:15-alpine > /dev/null
task_ready=false
for attempt in {1..60};do if docker exec "$task_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1;then task_ready=true;break;fi;sleep 1;done
if [[ "$task_ready" != true ]];then printf '%s\n' 'Disposable Daily Life database did not become ready' >&2;exit 1;fi
for task_sql in scripts/daily-life-test-fixtures/setup.sql supabase/migrations/20260518020100_lifeos_kernel.sql scripts/daily-life-test-fixtures/prepare.sql supabase/migrations/20261103010000_daily_life_logs.sql scripts/daily-life-test-fixtures/assertions.sql;do
 docker exec -i "$task_container" psql -h 127.0.0.1 -X -q -U postgres -v ON_ERROR_STOP=1 < "$task_root/$task_sql" > "$task_results/sql-output"
done
# Independent requests repeat one callback: exactly one water entry may exist.
task_pids=()
for attempt in {1..8};do
 docker exec "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "set role service_role;select public.log_hydration('00000000-0000-4000-8000-000000000001','concurrent-water-1',250,'telegram')->>'id';" > "$task_results/water-$attempt" &
 task_pids+=("$!")
done
for task_pid in "${task_pids[@]}";do wait "$task_pid";done
python3 - "$task_results" <<'PY'
from pathlib import Path
import sys
values=[(Path(sys.argv[1])/f'water-{i}').read_text().strip() for i in range(1,9)]
assert len(set(values))==1,values
PY
docker exec "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "select public.daily_test_assert(count(*)=1 and sum(amount_ml)=250,'concurrent callback counted once') from public.hydration_entries;set role service_role;select public.save_daily_life_preferences('00000000-0000-4000-8000-000000000001',public.daily_test_prefs(),0);" > /dev/null
# Different concurrent edits all start with revision1; one wins and seven conflict.
task_pids=()
for attempt in {1..8};do
 (
  if docker exec "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "set role service_role;select public.save_daily_life_preferences('00000000-0000-4000-8000-000000000001',public.daily_test_prefs('08:0$attempt'),1)->>'revision';" > "$task_results/pref-$attempt" 2> "$task_results/pref-$attempt.err";then printf '%s' success > "$task_results/pref-$attempt.result";
  else if ! grep -q daily_life_conflict "$task_results/pref-$attempt.err";then cat "$task_results/pref-$attempt.err" >&2;exit 1;fi;printf '%s' conflict > "$task_results/pref-$attempt.result";fi
 ) & task_pids+=("$!")
done
for task_pid in "${task_pids[@]}";do wait "$task_pid";done
python3 - "$task_results" <<'PY'
from pathlib import Path
import sys
values=[(Path(sys.argv[1])/f'pref-{i}.result').read_text() for i in range(1,9)]
assert values.count('success')==1 and values.count('conflict')==7,values
print('PASS: Daily Life migration, RLS/grants, owner isolation, complete hydration aggregates with200history, timezone, idempotent add/undo, task creation/CAS/completion, preference consent/schema/CAS, 8 concurrent callback+preference writers')
PY
