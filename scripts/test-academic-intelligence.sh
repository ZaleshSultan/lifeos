#!/usr/bin/env bash
# Synthetic owners only in a new network-none PostgreSQL 17 container.
set -euo pipefail
intelligence_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
intelligence_container="lifeos-intelligence-test-${RANDOM}-$$"
intelligence_results="$(mktemp -d)"
cleanup(){ docker rm -f "$intelligence_container" >/dev/null 2>&1 || true; rm -rf -- "$intelligence_results"; }
trap cleanup EXIT
docker run --rm --pull=missing -d --network none --log-driver none --memory 256m --cpus 1 --pids-limit 96 --name "$intelligence_container" --tmpfs /var/lib/postgresql/data:rw,size=256m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17 >/dev/null
intelligence_ready=false
for intelligence_attempt in {1..90};do
 if docker exec "$intelligence_container" pg_isready -h127.0.0.1 -U postgres >/dev/null 2>&1;then intelligence_ready=true;break;fi
 sleep 1
done
if [[ "$intelligence_ready" != true ]];then printf 'Academic intelligence PostgreSQL unavailable\n' >&2;exit 1;fi
intelligence_psql(){ docker exec -i "$intelligence_container" psql -h127.0.0.1 -X -qAt -U postgres -vON_ERROR_STOP=1 "$@"; }
if ! {
 cat "$intelligence_root/scripts/security-test-fixtures/setup.sql"
 for intelligence_migration in "$intelligence_root"/supabase/migrations/*.sql;do cat "$intelligence_migration";printf '\n';done
 cat "$intelligence_root/scripts/academic-intelligence-test-fixtures/assertions.sql"
 if [[ -f "$intelligence_root/scripts/academic-intelligence-test-fixtures/deadlines.sql" ]];then cat "$intelligence_root/scripts/academic-intelligence-test-fixtures/deadlines.sql";fi
} | intelligence_psql >"$intelligence_results/assertions.log" 2>&1;then tail -100 "$intelligence_results/assertions.log" >&2;exit 1;fi
intelligence_pids=()
for intelligence_worker in {1..8};do
 intelligence_psql -c "set role service_role;select public.capture_moodle_grade_snapshot('f6000000-0000-4000-8000-000000000001',(select run_id from intelligence_test.parallel), 'f6100000-0000-4000-8000-000000000001',false,(select payload from intelligence_test.parallel));" >"$intelligence_results/parallel-$intelligence_worker.log" 2>&1 &
 intelligence_pids+=("$!")
done
for intelligence_pid in "${intelligence_pids[@]}";do if ! wait "$intelligence_pid";then cat "$intelligence_results"/parallel-*.log >&2;exit 1;fi;done
intelligence_psql -c "select intelligence_test.assert((select count(*)=1 from public.academic_grade_events where user_id='f6000000-0000-4000-8000-000000000001'and moodle_item_id='99'),'eight concurrent snapshots have one event');"
intelligence_count="$(intelligence_psql -c 'select count(*)from intelligence_test.assertions;')"
printf 'PASS: %s academic intelligence SQL assertions; eight concurrent snapshot replays\n' "$intelligence_count"
