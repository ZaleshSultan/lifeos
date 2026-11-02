-- Global reference data remains publicly readable; only the trusted backend writes.
begin;

alter table public.finance_currencies enable row level security;
alter table public.finance_currencies force row level security;
alter table public.finance_exchange_rates enable row level security;
alter table public.finance_exchange_rates force row level security;

revoke all on public.finance_currencies, public.finance_exchange_rates
  from public, anon, authenticated;
grant select on public.finance_currencies, public.finance_exchange_rates
  to anon, authenticated;
grant select, insert, update, delete on public.finance_currencies, public.finance_exchange_rates
  to service_role;

create policy finance_currencies_public_read
  on public.finance_currencies for select to anon, authenticated using (true);
create policy finance_exchange_rates_public_read
  on public.finance_exchange_rates for select to anon, authenticated using (true);

comment on policy finance_currencies_public_read on public.finance_currencies
  is 'Intentionally shared, non-personal currency reference data; browser writes denied.';
comment on policy finance_exchange_rates_public_read on public.finance_exchange_rates
  is 'Intentionally shared reference rates; user finance tables retain their existing ownership policies.';

commit;
