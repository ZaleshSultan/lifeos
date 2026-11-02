create function public.ideal_test_assert(value boolean, message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Assertion failed: %', message; end if; end; $$;

select public.ideal_test_assert((select relrowsecurity from pg_class where oid='public.ideal_human_days'::regclass), 'RLS enabled');
select public.ideal_test_assert(not has_table_privilege('anon','public.ideal_human_days','SELECT,INSERT,UPDATE,DELETE'), 'anon has no table access');
select public.ideal_test_assert(not has_table_privilege('authenticated','public.ideal_human_days','SELECT,INSERT,UPDATE,DELETE'), 'authenticated has no table access');
select public.ideal_test_assert(not has_table_privilege('service_role','public.ideal_human_days','DELETE'), 'service has no delete grant');
select public.ideal_test_assert(not has_function_privilege('anon','public.save_ideal_human_day(uuid,date,jsonb,integer)','EXECUTE'), 'anon no RPC access');
select public.ideal_test_assert(not has_function_privilege('authenticated','public.save_ideal_human_day(uuid,date,jsonb,integer)','EXECUTE'), 'authenticated no RPC access');
select public.ideal_test_assert((select count(*)=1 from public.ideal_human_days), 'only valid legacy date copied');
select public.ideal_test_assert((select entry->>'weightKg'='51.2' and revision=1 from public.ideal_human_days where user_id='00000000-0000-4000-8000-000000000001' and date='2026-11-03'), 'legacy entry preserved');
select public.ideal_test_assert((select settings->'unrelated'->>'keep'='yes' and settings->'workout_program'->'exercises'->>0='existing' and settings->'ideal_human_days' ? 'not-a-date' from public.user_settings where user_id='00000000-0000-4000-8000-000000000001'), 'settings untouched including malformed legacy entry');

set role service_role;
select public.ideal_test_assert(public.save_ideal_human_day('00000000-0000-4000-8000-000000000001','2026-11-03','{"date":"2026-11-03","notes":"Updated"}',1)->>'revision'='2', 'CAS increments');
select public.ideal_test_assert(public.save_ideal_human_day('00000000-0000-4000-8000-000000000001','2026-11-03','{"date":"2026-11-03","notes":"Updated"}',1)->>'revision'='2', 'lost response retry idempotent');
select public.ideal_test_assert(public.save_ideal_human_day('00000000-0000-4000-8000-000000000002','2026-11-03','{"date":"2026-11-03","notes":"Other owner"}',0)->>'revision'='1', 'other user same date independent');
select public.ideal_test_assert((select entry->>'notes'='Updated' from public.ideal_human_days where user_id='00000000-0000-4000-8000-000000000001' and date='2026-11-03'), 'other user did not overwrite');
select public.ideal_test_assert(public.save_ideal_human_day('00000000-0000-4000-8000-000000000001','2026-11-04','{"date":"2026-11-04","notes":"Another day"}',0)->>'revision'='1', 'another date independent');

do $$ begin
  perform public.save_ideal_human_day('00000000-0000-4000-8000-000000000001','2026-11-03','{"date":"2026-11-03","notes":"Stale write"}',1);
  raise exception 'Stale write accepted';
exception when raise_exception then
  if sqlerrm <> 'ideal_human_conflict' then raise; end if;
end $$;

do $$ begin
  perform public.save_ideal_human_day('00000000-0000-4000-8000-000000000001','2026-11-05','{"date":"2026-11-05","notes":"Wrong revision"}',4);
  raise exception 'Missing row wrong revision accepted';
exception when raise_exception then
  if sqlerrm <> 'ideal_human_conflict' then raise; end if;
end $$;

do $$ begin
  perform public.save_ideal_human_day('00000000-0000-4000-8000-000000000001','2026-11-05','{"date":"2026-11-06","notes":"Wrong date"}',0);
  raise exception 'Mismatched date accepted';
exception when invalid_parameter_value then null;
end $$;

do $$ begin
  perform public.save_ideal_human_day('00000000-0000-4000-8000-000000000001','2026-12-03','{"date":"2026-12-03","notes":"Outside experiment"}',0);
  raise exception 'Out-of-range date accepted';
exception when invalid_parameter_value then null;
end $$;

do $$ begin
  perform public.save_ideal_human_day('00000000-0000-4000-8000-000000000001','2026-11-05','{"date":"2026-11-05","revision":99}',0);
  raise exception 'Embedded revision accepted';
exception when invalid_parameter_value then null;
end $$;

do $$ begin
  perform public.save_ideal_human_day('00000000-0000-4000-8000-000000000001','2026-11-05',jsonb_build_object('date','2026-11-05','notes',repeat('x',140000)),0);
  raise exception 'Oversize input accepted';
exception when invalid_parameter_value then null;
end $$;

-- Transaction abort must not leave a partially saved entry.
begin;
select public.save_ideal_human_day('00000000-0000-4000-8000-000000000001','2026-11-05','{"date":"2026-11-05","notes":"Rollback me"}',0);
rollback;
select public.ideal_test_assert(not exists(select from public.ideal_human_days where date='2026-11-05'), 'rollback leaves no partial entry');
reset role;
update public.profiles set status='blocked' where user_id='00000000-0000-4000-8000-000000000002';
set role service_role;
do $$ begin
  perform public.save_ideal_human_day('00000000-0000-4000-8000-000000000002','2026-11-04','{"date":"2026-11-04","notes":"Blocked"}',0);
  raise exception 'Blocked profile write accepted';
exception when insufficient_privilege then null;
end $$;
reset role;
set role authenticated;
do $$ begin
  perform public.save_ideal_human_day('00000000-0000-4000-8000-000000000001','2026-11-05','{"date":"2026-11-05","notes":"Browser"}',0);
  raise exception 'Browser RPC allowed';
exception when insufficient_privilege then null;
end $$;
reset role;
