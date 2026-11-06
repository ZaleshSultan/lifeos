#!/usr/bin/env bash
# Independent intended-contract cases in ONE disposable network-none database.
# Each case is a separate psql transaction/session; report all failures before exit.
set -euo pipefail
blocker_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
blocker_container="lifeos-notification-blockers-${RANDOM}-$$"
blocker_results="$(mktemp -d)"
blocker_container_id=""
blocker_created=false
cleanup(){
 if [[ "$blocker_created" == true && "$blocker_container_id" =~ ^[a-f0-9]{64}$ ]];then
  # A failed name collision grants no ownership. Remove only the successful
  # run's immutable ID after checking this fixture's unique label and network.
  blocker_identity="$(docker inspect -f '{{index .Config.Labels "lifeos.notification-blocker-fixture"}}|{{.HostConfig.NetworkMode}}' "$blocker_container_id" 2>/dev/null || true)"
  if [[ "$blocker_identity" == "$blocker_container|none" ]];then docker rm -f -- "$blocker_container_id" >/dev/null 2>&1 || true;fi
 fi
 rm -rf -- "$blocker_results"
}
trap cleanup EXIT
if ! blocker_container_id="$(docker run --rm --pull=never -d --network none --log-driver none --memory 256m --cpus 1 --pids-limit 96 --name "$blocker_container" --label "lifeos.notification-blocker-fixture=$blocker_container" --tmpfs /var/lib/postgresql/data:rw,size=256m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17)";then
 printf 'Notification fixture creation failed; no container ownership acquired\n' >&2;exit 1
fi
if [[ ! "$blocker_container_id" =~ ^[a-f0-9]{64}$ ]];then printf 'Notification fixture did not return an immutable container ID\n' >&2;exit 1;fi
blocker_created=true
blocker_ready=false
for blocker_attempt in {1..90};do
 if docker exec "$blocker_container_id" pg_isready -h127.0.0.1 -U postgres >/dev/null 2>&1;then blocker_ready=true;break;fi
 sleep 1
done
if [[ "$blocker_ready" != true ]];then printf 'Notification regression PostgreSQL unavailable\n' >&2;exit 1;fi
blocker_psql(){ docker exec -i "$blocker_container_id" psql -h127.0.0.1 -X -qAt -U postgres -vON_ERROR_STOP=1 "$@"; }
if ! {
 cat "$blocker_root/scripts/security-test-fixtures/setup.sql"
 for blocker_migration in "$blocker_root"/supabase/migrations/*.sql;do cat "$blocker_migration";printf '\n';done
 cat "$blocker_root/scripts/academic-intelligence-test-fixtures/assertions.sql"
 cat "$blocker_root/scripts/academic-intelligence-test-fixtures/deadlines.sql"
 cat "$blocker_root/scripts/academic-intelligence-test-fixtures/blocker-setup.sql"
} | blocker_psql >"$blocker_results/setup.log" 2>&1;then tail -100 "$blocker_results/setup.log" >&2;exit 1;fi
if [[ "${1:-all}" == html-inventory ]];then
 if ! blocker_psql <"$blocker_root/scripts/academic-intelligence-test-fixtures/blocker-html-inventory.sql" >"$blocker_results/html-inventory.log" 2>&1;then tail -60 "$blocker_results/html-inventory.log" >&2;exit 1;fi
 printf 'PASS: verified incomplete HTML inventory preserves assignment delivery\n';exit 0
fi
if [[ "${1:-all}" != all ]];then printf 'Unsupported notification regression case\n' >&2;exit 1;fi
blocker_failed=0
for blocker_case in expiry cutover selection;do
 if blocker_psql <"$blocker_root/scripts/academic-intelligence-test-fixtures/blocker-$blocker_case.sql" >"$blocker_results/$blocker_case.log" 2>&1;then
  printf 'PASS: notification contract %s\n' "$blocker_case"
 else
  printf 'FAIL: notification contract %s\n' "$blocker_case" >&2
  tail -30 "$blocker_results/$blocker_case.log" >&2
  blocker_failed=$((blocker_failed+1))
 fi
done
if [[ "$blocker_failed" -ne 0 ]];then printf 'FAIL: %s/3 intended notification contracts\n' "$blocker_failed" >&2;exit 1;fi
# Verify the real credential-free renderer on the persisted before/after inputs.
for blocker_label in before after;do
 blocker_psql -c "select input::text from intelligence_blocker_test.render_inputs where label='$blocker_label';" >"$blocker_results/render-$blocker_label-input.json"
 if ! (cd "$blocker_root" && env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 NODE_ENV=production /usr/bin/node --max-old-space-size=128 --import tsx scripts/render-academic-notification.ts) <"$blocker_results/render-$blocker_label-input.json" >"$blocker_results/render-$blocker_label-output.json";then exit 1;fi
done
python3 - "$blocker_results" <<'PY_CHECK'
import json,sys
from pathlib import Path
results=Path(sys.argv[1])
before=json.loads((results/'render-before-output.json').read_text())['message']
after=json.loads((results/'render-after-output.json').read_text())['message']
assert '39.00/100' in before, 'actual renderer did not prove the original exact forecast'
assert 'Заработано итоговых баллов' not in after and 'сведения об оценках устарели' in after, 'actual renderer did not honestly downgrade expired evidence'
print('PASS: actual bounded formatter exact39.00 forecast becomes explicit stale-evidence uncertainty')
PY_CHECK
for blocker_case in temporal parallel-setup;do
 if ! blocker_psql <"$blocker_root/scripts/academic-intelligence-test-fixtures/blocker-$blocker_case.sql" >"$blocker_results/$blocker_case.log" 2>&1;then tail -60 "$blocker_results/$blocker_case.log" >&2;exit 1;fi
done
blocker_pids=()
for blocker_worker in {1..8};do
 blocker_psql -c "set role service_role;select public.prepare_academic_intelligence_notification('f6000000-0000-4000-8000-000000000044',key,fingerprint,'Synthetic concurrent bounded preparation','[]')from intelligence_blocker_test.parallel_prepare where worker=$blocker_worker;" >"$blocker_results/prepare-$blocker_worker.log" 2>&1 &
 blocker_pids+=("$!")
done
for blocker_pid in "${blocker_pids[@]}";do if ! wait "$blocker_pid";then cat "$blocker_results"/prepare-*.log >&2;exit 1;fi;done
if ! blocker_psql <"$blocker_root/scripts/academic-intelligence-test-fixtures/blocker-parallel-claim.sql" >"$blocker_results/parallel-claim.log" 2>&1;then tail -60 "$blocker_results/parallel-claim.log" >&2;exit 1;fi
blocker_pids=()
for blocker_worker in {1..8};do
 blocker_psql -c "set role service_role;select public.begin_notification_delivery('reminder','f6000000-0000-4000-8000-000000000044',reminder_id,token)from intelligence_blocker_test.parallel_begin;" >"$blocker_results/begin-$blocker_worker.log" 2>&1 &
 blocker_pids+=("$!")
done
for blocker_pid in "${blocker_pids[@]}";do if ! wait "$blocker_pid";then cat "$blocker_results"/begin-*.log >&2;exit 1;fi;done
if ! blocker_psql <"$blocker_root/scripts/academic-intelligence-test-fixtures/blocker-parallel-assertions.sql" >"$blocker_results/parallel-assertions.log" 2>&1;then tail -60 "$blocker_results/parallel-assertions.log" >&2;exit 1;fi
if ! blocker_psql <"$blocker_root/scripts/academic-intelligence-test-fixtures/blocker-race-setup.sql" >"$blocker_results/race-setup.log" 2>&1;then tail -60 "$blocker_results/race-setup.log" >&2;exit 1;fi
blocker_pids=()
for blocker_worker in {1..8};do
 blocker_psql -c "set role service_role;insert into intelligence_blocker_test.expiry_results select $blocker_worker,public.begin_notification_delivery('reminder','f6000000-0000-4000-8000-000000000045',reminder_id,token)from intelligence_blocker_test.expiry_claim;" >"$blocker_results/expiry-race-$blocker_worker.log" 2>&1 &
 blocker_pids+=("$!")
done
for blocker_pid in "${blocker_pids[@]}";do if ! wait "$blocker_pid";then cat "$blocker_results"/expiry-race-*.log >&2;exit 1;fi;done
blocker_psql -c "begin;set local role service_role;select public.academic_intelligence_service('f6000000-0000-4000-8000-000000000046','review_policy',args)from intelligence_blocker_test.policy_claim;insert into intelligence_blocker_test.policy_results values('review','accepted',null);select pg_sleep(0.5);commit;" >"$blocker_results/policy-review-race.log" 2>&1 &
blocker_review_pid="$!"
blocker_psql -c "begin;set local role service_role;insert into intelligence_blocker_test.policy_results select 'delivery','authorized',public.begin_notification_delivery('reminder','f6000000-0000-4000-8000-000000000046',reminder_id,token)from intelligence_blocker_test.policy_claim;select pg_sleep(0.5);commit;" >"$blocker_results/policy-begin-race.log" 2>&1 &
blocker_begin_pid="$!"
for blocker_pid in "$blocker_review_pid" "$blocker_begin_pid";do if ! wait "$blocker_pid";then cat "$blocker_results"/policy-*-race.log >&2;exit 1;fi;done
if ! blocker_psql <"$blocker_root/scripts/academic-intelligence-test-fixtures/blocker-policy-race-assertions.sql" >"$blocker_results/policy-race-assertions.log" 2>&1;then tail -60 "$blocker_results/policy-race-assertions.log" >&2;exit 1;fi
blocker_pids=()
for blocker_worker in {1..2};do
 blocker_psql -c "set role service_role;select intelligence_blocker_test.competing_review('cas$blocker_worker');" >"$blocker_results/policy-cas-$blocker_worker.log" 2>&1 &
 blocker_pids+=("$!")
done
for blocker_pid in "${blocker_pids[@]}";do if ! wait "$blocker_pid";then cat "$blocker_results"/policy-cas-*.log >&2;exit 1;fi;done
for blocker_case in race-assertions html-inventory;do
 if ! blocker_psql <"$blocker_root/scripts/academic-intelligence-test-fixtures/blocker-$blocker_case.sql" >"$blocker_results/$blocker_case.log" 2>&1;then tail -60 "$blocker_results/$blocker_case.log" >&2;exit 1;fi
done
blocker_count="$(blocker_psql -c 'select count(*)from intelligence_blocker_test.proofs;')"
printf 'PASS: all3 notification blocker contracts; %s assertions; no external sends\n' "$blocker_count"
