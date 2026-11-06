#!/usr/bin/env bash
# Independent intended-contract cases in ONE disposable network-none database.
# Each case is a separate psql transaction/session; report all failures before exit.
set -euo pipefail
blocker_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
blocker_container="lifeos-notification-blockers-${RANDOM}-$$"
blocker_results="$(mktemp -d)"
cleanup(){ docker rm -f "$blocker_container" >/dev/null 2>&1 || true; rm -rf -- "$blocker_results"; }
trap cleanup EXIT
docker run --rm --pull=never -d --network none --log-driver none --memory 256m --cpus 1 --pids-limit 96 --name "$blocker_container" --tmpfs /var/lib/postgresql/data:rw,size=256m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17 >/dev/null
blocker_ready=false
for blocker_attempt in {1..90};do
 if docker exec "$blocker_container" pg_isready -h127.0.0.1 -U postgres >/dev/null 2>&1;then blocker_ready=true;break;fi
 sleep 1
done
if [[ "$blocker_ready" != true ]];then printf 'Notification regression PostgreSQL unavailable\n' >&2;exit 1;fi
blocker_psql(){ docker exec -i "$blocker_container" psql -h127.0.0.1 -X -qAt -U postgres -vON_ERROR_STOP=1 "$@"; }
if ! {
 cat "$blocker_root/scripts/security-test-fixtures/setup.sql"
 for blocker_migration in "$blocker_root"/supabase/migrations/*.sql;do cat "$blocker_migration";printf '\n';done
 cat "$blocker_root/scripts/academic-intelligence-test-fixtures/assertions.sql"
 cat "$blocker_root/scripts/academic-intelligence-test-fixtures/deadlines.sql"
 cat "$blocker_root/scripts/academic-intelligence-test-fixtures/blocker-setup.sql"
} | blocker_psql >"$blocker_results/setup.log" 2>&1;then tail -100 "$blocker_results/setup.log" >&2;exit 1;fi
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
blocker_count="$(blocker_psql -c 'select count(*)from intelligence_blocker_test.proofs;')"
printf 'PASS: all3 notification blocker contracts; %s assertions; no external sends\n' "$blocker_count"
