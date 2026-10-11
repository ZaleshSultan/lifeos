#!/usr/bin/env bash
# Creates only a disposable container. Never reads production env/configuration.
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
task_container="lifeos-assistant-test-${RANDOM}-$$"
cleanup() { docker rm -f "$task_container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --rm -d --name "$task_container" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:15-alpine >/dev/null
for attempt in {1..30}; do
  if docker exec "$task_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
for task_sql in \
  supabase/tests/assistant-setup.sql \
  supabase/migrations/20260518020100_lifeos_kernel.sql \
  supabase/migrations/20260518020500_bot_life_entities.sql \
  supabase/migrations/20260524000100_dynamic_sources_mvp.sql \
  supabase/migrations/20260606000100_external_reminder_foundation.sql \
  supabase/migrations/20261011084249_assistant_brain_persistence.sql \
  supabase/tests/assistant-assertions.sql; do
  docker exec -i "$task_container" psql -h 127.0.0.1 -X -U postgres -v ON_ERROR_STOP=1 < "$task_root/$task_sql"
done
# Separate sessions exercise simultaneous retries, not only sequential unit mocks.
task_call="set role service_role; select public.assistant_execute_mutation('11111111-1111-4111-8111-111111111111','concurrent-reminder','telegram',jsonb_build_object('type','reminder.create','message','Concurrent reminder','remindAt',to_char(now()+interval '1 day','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')));"
docker exec "$task_container" psql -h 127.0.0.1 -X -U postgres -v ON_ERROR_STOP=1 -c "$task_call" >/dev/null &
task_first=$!
docker exec "$task_container" psql -h 127.0.0.1 -X -U postgres -v ON_ERROR_STOP=1 -c "$task_call" >/dev/null &
task_second=$!
wait "$task_first"
wait "$task_second"
docker exec "$task_container" psql -h 127.0.0.1 -X -U postgres -v ON_ERROR_STOP=1 -c \
  "do \$\$ begin assert (select count(*)=1 from public.reminders where message='Concurrent reminder'); assert (select count(*)=1 from public.assistant_actions where request_id='concurrent-reminder'); end \$\$;"
echo "Assistant PostgreSQL migration, RLS, deletion, rollback and concurrent retry assertions passed."
