#!/usr/bin/env bash
# Disposable migration/RLS checks. Never accepts a production DATABASE_URL.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
LIFEOS_TEST_PG_BIN="${LIFEOS_TEST_PG_BIN:-}"
if [[ -z "$LIFEOS_TEST_PG_BIN" ]] && command -v pg_config >/dev/null; then
  LIFEOS_TEST_PG_BIN="$(pg_config --bindir)"
fi
LIFEOS_TEST_CLUSTER="$(mktemp -d /tmp/lifeos-study-sql-XXXXXX)"
LIFEOS_TEST_CONTAINER=""
cleanup() {
  if [[ -n "$LIFEOS_TEST_CONTAINER" ]]; then
    docker rm -f "$LIFEOS_TEST_CONTAINER" >/dev/null 2>&1 || true
  elif [[ -x "$LIFEOS_TEST_PG_BIN/pg_ctl" ]]; then
    "$LIFEOS_TEST_PG_BIN/pg_ctl" -D "$LIFEOS_TEST_CLUSTER/data" -m fast stop >/dev/null 2>&1 || true
  fi
  rm -rf -- "$LIFEOS_TEST_CLUSTER"
}
trap cleanup EXIT
if [[ -x "$LIFEOS_TEST_PG_BIN/initdb" && -x "$LIFEOS_TEST_PG_BIN/pg_ctl" ]]; then
  "$LIFEOS_TEST_PG_BIN/initdb" -D "$LIFEOS_TEST_CLUSTER/data" -A trust --no-locale --encoding=UTF8 >/dev/null
  "$LIFEOS_TEST_PG_BIN/pg_ctl" -D "$LIFEOS_TEST_CLUSTER/data" -l "$LIFEOS_TEST_CLUSTER/server.log" \
    -o "-h '' -k $LIFEOS_TEST_CLUSTER -p 55491 -c jit=off" start >/dev/null
else
  # Use only an already cached test image. No registry pull, network, published
  # ports, external database URL or production volume can enter this harness.
  LIFEOS_TEST_PG_IMAGE="${LIFEOS_TEST_PG_IMAGE:-postgres:16-alpine}"
  if ! command -v docker >/dev/null || ! docker image inspect "$LIFEOS_TEST_PG_IMAGE" >/dev/null 2>&1; then
    printf '%s\n' 'PostgreSQL server binaries or a cached postgres:16-alpine Docker image are required.' >&2
    exit 1
  fi
  # The container writes only its ephemeral PGDATA and this disposable socket.
  # Keep the socket directory owned by the caller so cleanup needs no sudo.
  # The image's initialization psql resets PGHOST and needs its internal default
  # socket too; only the disposable socket is mounted back onto the host.
  chmod 0777 "$LIFEOS_TEST_CLUSTER"
  LIFEOS_TEST_CONTAINER="$(docker run --detach --pull never --network none \
    --tmpfs /var/lib/postgresql/data:rw \
    --mount "type=bind,src=$LIFEOS_TEST_CLUSTER,dst=$LIFEOS_TEST_CLUSTER" \
    --env "POSTGRES_USER=$(id -un)" --env POSTGRES_DB=postgres \
    --env PGPORT=55491 \
    --env POSTGRES_HOST_AUTH_METHOD=trust \
    "$LIFEOS_TEST_PG_IMAGE" postgres -h '' \
    -k "$LIFEOS_TEST_CLUSTER,/var/run/postgresql" -p 55491 -c jit=off)"
  LIFEOS_TEST_READY=false
  for _attempt in {1..120}; do
    # The image starts and stops a temporary server during initialization.
    # Do not begin migrations on that short-lived first accepting connection.
    if [[ "$(docker logs "$LIFEOS_TEST_CONTAINER" 2>&1)" == *'PostgreSQL init process complete; ready for start up.'* ]] &&
      psql -XAtq -h "$LIFEOS_TEST_CLUSTER" -p 55491 -d postgres -c 'select 1' >/dev/null 2>&1; then
      LIFEOS_TEST_READY=true
      break
    fi
    sleep 0.25
  done
  if [[ "$LIFEOS_TEST_READY" != true ]]; then
    docker logs "$LIFEOS_TEST_CONTAINER" >&2
    exit 1
  fi
  printf 'OK disposable PostgreSQL Docker backend: %s (network disabled, Unix socket only)\n' "$LIFEOS_TEST_PG_IMAGE"
fi
LIFEOS_TEST_PSQL=(psql -X -h "$LIFEOS_TEST_CLUSTER" -p 55491 -d postgres -v ON_ERROR_STOP=1)
"${LIFEOS_TEST_PSQL[@]}" -q <<'SQL'
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
create function auth.role() returns text language sql stable as
  $$select current_user::text$$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on all functions in schema auth to authenticated, service_role;
-- Minimal Storage catalog for ownership policies; no production connection.
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean default false,
  file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),
  name text not null,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated,service_role;
grant select on storage.objects to authenticated;
grant all on all tables in schema storage to service_role;
SQL
for migration in \
  20260518020100_lifeos_kernel.sql \
  20260518020500_bot_life_entities.sql \
  20260521000100_life_modes.sql \
  20260523000100_life_modes_phase1_study_courses.sql \
  20260524000100_dynamic_sources_mvp.sql \
  20260615000100_profile_status_roles.sql \
  20260828182500_academic_phase1_foundation.sql \
  20260831144000_academic_phase1_fixes.sql \
  20260901120000_course_schedules_instructor_name.sql \
  20260906130000_academic_terms.sql \
  20261005000100_daily_digest_deliveries.sql; do
  "${LIFEOS_TEST_PSQL[@]}" -q -f "$REPO_ROOT/supabase/migrations/$migration" >/dev/null
done
for pass in 1 2; do
  for migration in "$REPO_ROOT"/supabase/migrations/20261008*.sql; do
    "${LIFEOS_TEST_PSQL[@]}" -q -f "$migration" >/dev/null
  done
  printf 'OK study migrations pass %s\n' "$pass"
done
"${LIFEOS_TEST_PSQL[@]}" -q -c "grant all on all tables in schema public to service_role; grant usage,select on all sequences in schema public to service_role;"
"${LIFEOS_TEST_PSQL[@]}" -f "$REPO_ROOT/supabase/tests/study_workspace.sql"
"${LIFEOS_TEST_PSQL[@]}" -f "$REPO_ROOT/supabase/tests/study_pdf_storage.sql"
"${LIFEOS_TEST_PSQL[@]}" -f "$REPO_ROOT/supabase/tests/daily_digest_claims.sql"
python3 "$REPO_ROOT/scripts/test-digest-concurrency.py" "$LIFEOS_TEST_CLUSTER"
