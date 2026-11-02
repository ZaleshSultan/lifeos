#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_container="lifeos-finance-rls-test-$$"
trap 'docker rm -f "$task_container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$task_container" --network none \
  --tmpfs /var/lib/postgresql/data:rw,size=128m \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:15-alpine >/dev/null
for _ in {1..60}; do
  if docker exec "$task_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec -i "$task_container" psql -U postgres -Xq -v ON_ERROR_STOP=1 <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create table public.finance_currencies(code char(3) primary key,name text not null,symbol text not null);
create table public.finance_exchange_rates(id uuid default gen_random_uuid() primary key,
  from_currency char(3) references public.finance_currencies(code),
  to_currency char(3) references public.finance_currencies(code),
  rate numeric not null,rate_date date not null,
  unique(from_currency,to_currency,rate_date));
insert into public.finance_currencies values('KZT','Tenge','T'),('USD','Dollar','$');
grant all on public.finance_currencies,public.finance_exchange_rates to anon,authenticated,service_role;
SQL
docker exec -i "$task_container" psql -U postgres -Xq -v ON_ERROR_STOP=1 \
  < "$ROOT/supabase/migrations/20261103000100_finance_lookup_rls.sql"
docker exec -i "$task_container" psql -U postgres -Xq -v ON_ERROR_STOP=1 \
  < "$ROOT/scripts/ops/test-finance-lookup-rls.sql"
printf 'PASS: finance reference reads, browser write denial and backend FX upsert\n'
