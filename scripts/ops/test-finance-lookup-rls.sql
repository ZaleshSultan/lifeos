\set ON_ERROR_STOP on
begin;
do $$ begin
  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.finance_currencies'::regclass)
    or not (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.finance_exchange_rates'::regclass)
  then raise exception 'lookup RLS must be enabled and forced'; end if;
  if has_table_privilege('anon','public.finance_currencies','insert')
    or has_table_privilege('authenticated','public.finance_exchange_rates','update')
    or has_table_privilege('anon','public.finance_exchange_rates','truncate')
  then raise exception 'browser write grants must be absent'; end if;
end $$;

set local role anon;
select count(*) as anonymous_currency_read from public.finance_currencies;
select count(*) as anonymous_rate_read from public.finance_exchange_rates;
do $$ begin
  begin insert into public.finance_currencies(code,name,symbol) values('TST','test','t');
    raise exception 'anonymous write unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin delete from public.finance_exchange_rates;
    raise exception 'anonymous delete unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
select count(*) as authenticated_currency_read from public.finance_currencies;
select count(*) as authenticated_rate_read from public.finance_exchange_rates;
do $$ begin
  begin update public.finance_exchange_rates set rate=rate;
    raise exception 'authenticated update unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin truncate public.finance_currencies cascade;
    raise exception 'authenticated truncate unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role service_role;
insert into public.finance_currencies(code,name,symbol) values('TST','isolated test','t');
insert into public.finance_exchange_rates(from_currency,to_currency,rate,rate_date)
  values('TST','KZT',2,current_date)
  on conflict(from_currency,to_currency,rate_date) do update set rate=excluded.rate;
update public.finance_exchange_rates set rate=3
  where from_currency='TST' and to_currency='KZT' and rate_date=current_date;
do $$ begin
  if not exists(select 1 from public.finance_exchange_rates where from_currency='TST' and rate=3)
  then raise exception 'backend FX upsert/update must work'; end if;
end $$;
reset role;
rollback;
