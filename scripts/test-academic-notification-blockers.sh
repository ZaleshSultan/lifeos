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
blocker_count="$(blocker_psql -c 'select count(*)from intelligence_blocker_test.proofs;')"
printf 'PASS: all3 notification blocker contracts; %s assertions; no external sends\n' "$blocker_count"
