#!/usr/bin/env bash
# Full additive schema and actual competing transactions. No production config.
set -euo pipefail
academic_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
academic_container="lifeos-academic-test-${RANDOM}-$$"
academic_results="$(mktemp -d)"
cleanup(){ docker rm -f "$academic_container" >/dev/null 2>&1 || true; rm -rf -- "$academic_results"; }
trap cleanup EXIT
docker run --pids-limit 96 --rm -d --network none --log-driver none --memory 256m --cpus 1 --name "$academic_container" --tmpfs /var/lib/postgresql/data:rw,size=256m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:15-alpine >/dev/null
academic_ready=false
for academic_attempt in {1..120};do
 if docker exec "$academic_container" pg_isready -h127.0.0.1 -U postgres >/dev/null 2>&1;then academic_ready=true;break;fi
 sleep 1
done
if [[ "$academic_ready" != true ]];then printf 'Academic test PostgreSQL unavailable\n' >&2;exit 1;fi
academic_psql(){ docker exec -i "$academic_container" psql -h127.0.0.1 -X -qAt -U postgres -vON_ERROR_STOP=1 "$@"; }
if ! {
 cat "$academic_root/scripts/security-test-fixtures/setup.sql"
 for academic_migration in "$academic_root"/supabase/migrations/*.sql;do cat "$academic_migration";printf '\n';done
 cat "$academic_root/scripts/academic-test-fixtures/setup.sql"
} | academic_psql >"$academic_results/setup.log" 2>&1;then tail -100 "$academic_results/setup.log" >&2;exit 1;fi

academic_pids=()
for academic_worker in {1..8};do
 academic_psql -c "begin;set local role service_role;insert into academic_test.parallel_imports select $academic_worker,public.academic_service('f0000000-0000-4000-8000-000000000001','import',jsonb_set(value||jsonb_build_object('requestId','parallel-import-$academic_worker'),'{events,0,key}',to_jsonb('parallel-event-$academic_worker'::text)))from academic_test.payloads where key='parallel';select pg_sleep(0.05);commit;" >"$academic_results/import-$academic_worker.log" 2>&1 &
 academic_pids+=("$!")
done
for academic_pid in "${academic_pids[@]}";do if ! wait "$academic_pid";then cat "$academic_results"/import-*.log >&2;exit 1;fi;done
academic_pids=()
for academic_worker in {1..8};do
 academic_psql -c "begin;set local role service_role;insert into academic_test.parallel_plans select $academic_worker,public.plan_academic_notifications('f0000000-0000-4000-8000-000000000001');select pg_sleep(0.05);commit;" >"$academic_results/plan-$academic_worker.log" 2>&1 &
 academic_pids+=("$!")
done
for academic_pid in "${academic_pids[@]}";do if ! wait "$academic_pid";then cat "$academic_results"/plan-*.log >&2;exit 1;fi;done
academic_pids=()
for academic_worker in {1..8};do
 academic_psql -c "begin;set local role service_role;insert into academic_test.parallel_claims select $academic_worker,id,claim_token from public.claim_due_reminders(clock_timestamp(),1);select pg_sleep(0.1);commit;" >"$academic_results/claim-$academic_worker.log" 2>&1 &
 academic_pids+=("$!")
done
for academic_pid in "${academic_pids[@]}";do if ! wait "$academic_pid";then cat "$academic_results"/claim-*.log >&2;exit 1;fi;done
if ! academic_psql <"$academic_root/scripts/academic-test-fixtures/assertions.sql" >"$academic_results/assertions.log" 2>&1;then tail -120 "$academic_results/assertions.log" >&2;exit 1;fi
academic_count="$(academic_psql -c 'select count(*)from academic_test.assertions;')"
printf 'PASS: %s academic SQL assertions; 8 concurrent imports, planners and reminder claims\n' "$academic_count"
