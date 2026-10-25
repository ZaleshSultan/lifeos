#!/usr/bin/env bash
# Tests only a new disposable local container; never uses project DB settings.
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_container="lifeos-lms-test-${RANDOM}-$$"
cleanup() { docker rm -f "$task_container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --rm -d --name "$task_container" --tmpfs /var/lib/postgresql/data:rw,size=256m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:15-alpine >/dev/null
task_ready=false
for attempt in {1..120}; do
  # The image's initialization server listens only on its Unix socket. Wait
  # for the final TCP listener so initialization cannot stop mid-fixture.
  if docker exec "$task_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then task_ready=true; break; fi
  sleep 1
done
if [[ "$task_ready" != true ]]; then
  printf '%s\n' 'Disposable PostgreSQL did not become ready' >&2
  exit 1
fi
for task_sql in \
  scripts/lms-test-fixtures/setup.sql \
  supabase/migrations/20260624000100_university_lms_settings.sql \
  supabase/migrations/20261010141237_secure_lms_sessions.sql \
  scripts/lms-test-fixtures/assertions.sql; do
  docker exec -i "$task_container" psql -h 127.0.0.1 -X -U postgres -v ON_ERROR_STOP=1 < "$task_root/$task_sql"
done
