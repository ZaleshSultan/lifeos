#!/usr/bin/env bash
# No project environment, network, credentials, production database or provider calls.
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_container="lifeos-capture-test-${RANDOM}-$$"
task_results="$(mktemp -d)"
cleanup(){ docker rm -f "$task_container" >/dev/null 2>&1 || true;rm -rf -- "$task_results"; }
trap cleanup EXIT
docker run --rm -d --network none --log-driver none --memory 256m --pids-limit 96 --name "$task_container" --tmpfs /var/lib/postgresql/data:rw,size=256m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:15-alpine >/dev/null
task_ready=false
for task_attempt in {1..45};do
 if docker exec "$task_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1;then task_ready=true;break;fi
 sleep 1
done
if [[ "$task_ready" != true ]];then printf '%s\n' 'Disposable capture database did not become ready' >&2;exit 1;fi
task_psql(){ docker exec -i "$task_container" psql -h 127.0.0.1 -X -qAt -U postgres -v ON_ERROR_STOP=1 "$@"; }
for task_sql in \
 scripts/universal-capture-test-fixtures/setup.sql \
 supabase/migrations/20260518020100_lifeos_kernel.sql \
 supabase/migrations/20260518020500_bot_life_entities.sql \
 supabase/migrations/20260524000100_dynamic_sources_mvp.sql \
 supabase/migrations/20260606000100_external_reminder_foundation.sql \
 supabase/migrations/20260520000100_telegram_log_inbox.sql \
 scripts/universal-capture-test-fixtures/prepare.sql \
 supabase/migrations/20261011084249_assistant_brain_persistence.sql \
 supabase/migrations/20261102120000_ideal_human_days.sql \
 supabase/migrations/20261103010000_daily_life_logs.sql \
 supabase/migrations/20261103060000_universal_capture.sql \
 scripts/universal-capture-test-fixtures/helpers.sql \
 scripts/universal-capture-test-fixtures/assertions.sql;do
 task_psql < "$task_root/$task_sql" > "$task_results/sql-output"
done
# Eight independent transport retries must resolve one durable capture.
task_pids=()
for task_attempt in {1..8};do
 task_psql -c "set role service_role;select public.capture_service('00000000-0000-4000-8000-000000000001','ingest',null,null,public.capture_test_input('concurrent-ingest-1'))->'capture'->>'id';" > "$task_results/ingest-$task_attempt" &
 task_pids+=("$!")
done
for task_pid in "${task_pids[@]}";do wait "$task_pid";done
# Same reviewed approval repeated concurrently creates a domain task exactly once.
task_pids=()
for task_attempt in {1..8};do
 task_psql -c "set role service_role;select public.capture_test_confirm((select payload from public.capture_test_facts where key='concurrent-confirm'),'[\"action-1\"]','concurrent-approval-1')->>'revision';" > "$task_results/confirm-$task_attempt" &
 task_pids+=("$!")
done
for task_pid in "${task_pids[@]}";do wait "$task_pid";done
# Different edits of one reviewed revision: exactly one writer wins.
task_pids=()
for task_attempt in {1..8};do
 (
  if task_psql -c "set role service_role;select public.capture_service('00000000-0000-4000-8000-000000000001','edit',(select (payload->>'id')::uuid from public.capture_test_facts where key='concurrent-edit'),(select (payload->>'revision')::int from public.capture_test_facts where key='concurrent-edit'),'{\"actionId\":\"action-1\",\"action\":{\"kind\":\"note.save\",\"args\":{\"title\":\"Edit $task_attempt\",\"content\":\"Owner review\"}}}')->>'revision';" > "$task_results/edit-$task_attempt" 2> "$task_results/edit-$task_attempt.err";then printf '%s' success > "$task_results/edit-$task_attempt.result";
  else if ! grep -q capture_conflict "$task_results/edit-$task_attempt.err";then cat "$task_results/edit-$task_attempt.err" >&2;exit 1;fi;printf '%s' conflict > "$task_results/edit-$task_attempt.result";fi
 ) & task_pids+=("$!")
done
for task_pid in "${task_pids[@]}";do wait "$task_pid";done
# Remove the synthetic concurrent-ingest queue candidate; only the claim fixture remains.
task_psql -c "update public.life_captures set capture_state='cancelled'where capture_ingestion_key='concurrent-ingest-1';" >/dev/null
task_pids=()
for task_attempt in {1..8};do
 task_psql -c "set role service_role;select coalesce(public.capture_claim_next('concurrent-lease-$task_attempt')->'job'->'capture'->>'id','none');" > "$task_results/claim-$task_attempt" &
 task_pids+=("$!")
done
for task_pid in "${task_pids[@]}";do wait "$task_pid";done
task_psql -c "select public.capture_test_assert(count(*)=1,'concurrent approval creates one task')from public.tasks where title='Concurrent captured task';select public.capture_test_assert(count(*)=1,'one durable ingestion')from public.life_captures where capture_ingestion_key='concurrent-ingest-1';" >/dev/null
python3 - "$task_results" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1])
values=lambda stem:[(root/f'{stem}-{i}').read_text().strip() for i in range(1,9)]
assert len(set(values('ingest')))==1,values('ingest')
assert len(set(values('confirm')))==1,values('confirm')
edits=[(root/f'edit-{i}.result').read_text()for i in range(1,9)]
assert edits.count('success')==1 and edits.count('conflict')==7,edits
claims=values('claim')
assert claims.count('none')==7 and len([x for x in claims if x!='none'])==1,claims
print('PASS: capture migration, legacy preservation, grants/RLS, owner isolation, idempotence, atomic selective confirmation/rollback, domain CAS, expiry/replay, memory opt-out, lease fencing/ambiguity/recovery, content deletion/retention, and four 8-request concurrency checks')
PY
