#!/usr/bin/env bash
# Always creates a disposable container; never consumes project DB credentials.
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_container="lifeos-security-test-${RANDOM}-$$"
trap 'docker rm -f "$task_container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$task_container" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:15-alpine >/dev/null
for attempt in {1..30}; do
  if docker exec "$task_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
# One connection also verifies that the migrations compose in sequence.
{
  cat "$task_root/scripts/security-test-fixtures/setup.sql"
  for task_migration in "$task_root"/supabase/migrations/*.sql; do
    if [[ "$task_migration" == *harden_profile_privileges.sql ]]; then
      cat "$task_root/scripts/security-test-fixtures/baseline.sql"
    fi
    cat "$task_migration"
    printf '\n'
  done
  cat "$task_root/scripts/security-test-fixtures/assertions.sql"
  cat "$task_root/scripts/security-test-fixtures/health.sql"
} | docker exec -i "$task_container" psql -X -q -U postgres -v ON_ERROR_STOP=1
printf '%s\n' 'PASS: full migration chain, profile escalation baseline/fix, realistic roles, tenant isolation, RPC grants'

# Competing transactions: whether issue or block wins the profile row lock,
# the blocked user cannot retain an active credential.
docker exec "$task_container" psql -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "begin; set local role service_role; select public.issue_health_ingest_credential('00000000-0000-4000-8000-000000000001',repeat('f',64),clock_timestamp()+interval '1 day'); select pg_sleep(1); commit;" >/dev/null &
task_issue_pid="$!"
docker exec "$task_container" psql -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "set role service_role; update public.profiles set status='blocked' where user_id='00000000-0000-4000-8000-000000000001';" >/dev/null
wait "$task_issue_pid"
task_live="$(docker exec "$task_container" psql -X -qAt -U postgres -v ON_ERROR_STOP=1 -c "select count(*) from public.health_ingest_credentials where user_id='00000000-0000-4000-8000-000000000001' and revoked_at is null;")"
[[ "$task_live" == "0" ]]
printf '%s\n' 'PASS: health ownership, expiry, revocation, block/unblock and concurrent issuance versus block'
