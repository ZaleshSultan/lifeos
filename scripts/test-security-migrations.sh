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
} | docker exec -i "$task_container" psql -X -q -U postgres -v ON_ERROR_STOP=1
printf '%s\n' 'PASS: full migration chain, profile escalation baseline/fix, realistic roles, tenant isolation, RPC grants'
