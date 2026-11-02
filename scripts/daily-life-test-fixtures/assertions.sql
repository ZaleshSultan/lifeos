select public.daily_test_assert((select relrowsecurity from pg_class where oid='public.hydration_entries'::regclass),'hydration RLS');
select public.daily_test_assert((select relrowsecurity from pg_class where oid='public.daily_life_preferences'::regclass),'preferences RLS');
select public.daily_test_assert(not has_table_privilege('anon','public.hydration_entries','SELECT,INSERT,UPDATE,DELETE'),'anon water blocked');
select public.daily_test_assert(not has_table_privilege('authenticated','public.daily_life_preferences','SELECT,INSERT,UPDATE,DELETE'),'browser preferences blocked');
select public.daily_test_assert(not has_function_privilege('authenticated','public.get_hydration_summary(uuid,date)','EXECUTE'),'browser aggregate blocked');
select public.daily_test_assert(not has_function_privilege('anon','public.manage_lifeos_task(uuid,uuid,text,jsonb,timestamptz)','EXECUTE'),'anon task RPC blocked');
select public.daily_test_assert((select count(*)=0 from public.daily_life_preferences),'no default opt-in rows created');

begin;set local role service_role;
do $$declare a jsonb;b jsonb;d date;begin
 a:=public.log_hydration('00000000-0000-4000-8000-000000000001','water-request-1',250,'tma');
 b:=public.log_hydration('00000000-0000-4000-8000-000000000001','water-request-1',250,'tma');
 perform public.daily_test_assert(a=b,'water exact retry');
 d:=(a->>'date')::date;
 perform public.daily_test_assert(d=((a->>'occurredAt')::timestamptz at time zone 'Asia/Almaty')::date,'profile timezone day');
 perform public.daily_test_assert((public.get_hydration_summary('00000000-0000-4000-8000-000000000001',d)->>'totalMl')::int=250,'water total');
 perform public.undo_hydration('00000000-0000-4000-8000-000000000001',(a->>'id')::uuid);
 perform public.undo_hydration('00000000-0000-4000-8000-000000000001',(a->>'id')::uuid);
 b:=public.log_hydration('00000000-0000-4000-8000-000000000001','water-request-1',250,'tma');
 perform public.daily_test_assert(b->>'undoneAt' is not null,'retry does not reactivate undone water');
 perform public.daily_test_assert((public.get_hydration_summary('00000000-0000-4000-8000-000000000001',d)->>'totalMl')::int=0,'undo counted once');
 begin perform public.log_hydration('00000000-0000-4000-8000-000000000001','water-request-1',500,'tma');raise exception 'Changed replay accepted';exception when raise_exception then if sqlerrm<>'daily_life_conflict' then raise;end if;end;
 begin perform public.undo_hydration('00000000-0000-4000-8000-000000000002',(a->>'id')::uuid);raise exception 'Foreign undo accepted';exception when no_data_found then if sqlerrm<>'hydration_not_found' then raise;end if;end;
end;$$;
rollback;

begin;
insert into public.hydration_entries(user_id,request_id,amount_ml,occurred_at,local_date,source,undone_at)
select '00000000-0000-4000-8000-000000000001','bulk-water-'||i,1,clock_timestamp()-i*interval '1 second','2026-11-03','web',case when i=1005 then clock_timestamp() else null end from generate_series(1,1005)i;
insert into public.hydration_entries(user_id,request_id,amount_ml,local_date,source)values('00000000-0000-4000-8000-000000000002','foreign-water-1',5000,'2026-11-03','web');
set local role service_role;
select public.daily_test_assert((public.get_hydration_summary('00000000-0000-4000-8000-000000000001','2026-11-03')->>'totalMl')::int=1004,'all 1005 rows aggregated, including rows outside history');
select public.daily_test_assert(jsonb_array_length(public.get_hydration_summary('00000000-0000-4000-8000-000000000001','2026-11-03')->'entries')=200,'bounded history');
select public.daily_test_assert((public.get_hydration_summary('00000000-0000-4000-8000-000000000001','2026-11-03')->>'truncated')::boolean,'truncation explicit');
select public.daily_test_assert((public.get_hydration_summary('00000000-0000-4000-8000-000000000002','2026-11-03')->>'totalMl')::int=5000,'foreign total separate');
select public.daily_test_assert(('2026-11-02T19:00:00Z'::timestamptz at time zone 'Asia/Almaty')::date='2026-11-03','Almaty midnight boundary');
rollback;

begin;set local role service_role;
do $$declare a jsonb;b jsonb;c jsonb;begin
 a:=public.manage_lifeos_task('00000000-0000-4000-8000-000000000001',null,'task-request-1','{"title":"Read evidence","notes":"Original","dueAt":"2026-11-03T10:00:00+05:00"}',null);
 b:=public.manage_lifeos_task('00000000-0000-4000-8000-000000000001',null,'task-request-1','{"title":"Read evidence","notes":"Original","dueAt":"2026-11-03T10:00:00+05:00"}',null);
 perform public.daily_test_assert(a=b,'task creation retry idempotent');
 begin perform public.manage_lifeos_task('00000000-0000-4000-8000-000000000001',null,'task-request-1','{"title":"Changed"}',null);raise exception 'Changed task replay accepted';exception when raise_exception then if sqlerrm<>'daily_life_conflict' then raise;end if;end;
 b:=public.manage_lifeos_task('00000000-0000-4000-8000-000000000001',(a->>'id')::uuid,null,'{"status":"done"}',(a->>'updatedAt')::timestamptz);
 perform public.daily_test_assert(b->>'completedAt' is not null,'completion evidence');
 perform public.daily_test_assert((b->>'updatedAt')::timestamptz>(a->>'updatedAt')::timestamptz,'CAS timestamp monotonic within same transaction');
 c:=public.manage_lifeos_task('00000000-0000-4000-8000-000000000001',(a->>'id')::uuid,null,'{"notes":"After completion"}',(b->>'updatedAt')::timestamptz);
 perform public.daily_test_assert(c->>'completedAt'=b->>'completedAt','notes preserve completion time');
 begin perform public.manage_lifeos_task('00000000-0000-4000-8000-000000000001',(a->>'id')::uuid,null,'{"title":"Stale"}',(a->>'updatedAt')::timestamptz);raise exception 'Stale task accepted';exception when raise_exception then if sqlerrm<>'daily_life_conflict' then raise;end if;end;
 c:=public.manage_lifeos_task('00000000-0000-4000-8000-000000000001',(a->>'id')::uuid,null,'{"status":"next","dueAt":null}',(c->>'updatedAt')::timestamptz);
 perform public.daily_test_assert(c->>'completedAt' is null and c->>'dueAt' is null,'reopen clears completion; explicit null date clears deadline');
 begin perform public.manage_lifeos_task('00000000-0000-4000-8000-000000000002',(a->>'id')::uuid,null,'{"status":"done"}',(c->>'updatedAt')::timestamptz);raise exception 'Foreign task accepted';exception when no_data_found then if sqlerrm<>'task_not_found' then raise;end if;end;
end;$$;
rollback;

begin;set local role service_role;
select public.daily_test_assert((public.save_daily_life_preferences('00000000-0000-4000-8000-000000000001',public.daily_test_prefs(),0)->>'revision')::int=1,'first preferences save');
select public.daily_test_assert((public.save_daily_life_preferences('00000000-0000-4000-8000-000000000001',public.daily_test_prefs(),0)->>'revision')::int=1,'lost-response preference retry');
select public.daily_test_assert(not (select (preferences->>'morningEnabled')::boolean or (preferences->>'eveningEnabled')::boolean or (preferences->>'hydrationRemindersEnabled')::boolean or (preferences->>'includeHealth')::boolean from public.daily_life_preferences where user_id='00000000-0000-4000-8000-000000000001'),'no default notifications/health consent');
do $$begin
 perform public.save_daily_life_preferences('00000000-0000-4000-8000-000000000001',public.daily_test_prefs('09:00'),0);raise exception 'Stale preferences accepted';exception when raise_exception then if sqlerrm<>'daily_life_conflict' then raise;end if;end;$$;
rollback;

-- Invalid JSON nulls, local/relative dates and extra settings fail at SQL too.
do $$declare bad jsonb;begin
 foreach bad in array array['{"title":"x","status":null}'::jsonb,'{"title":"x","dueAt":"tomorrow"}'::jsonb,'{"title":"x","dueAt":"2026-11-03T10:00:00"}'::jsonb,'{"title":"x","dueAt":"2026-11-31T10:00:00Z"}'::jsonb,'{"title":"x","dueAt":"2026-11-03T24:00:00Z"}'::jsonb,'{}'::jsonb]loop
  begin perform public.manage_lifeos_task('00000000-0000-4000-8000-000000000001',null,'invalid-task-1',bad,null);raise exception 'Invalid task accepted';exception when invalid_parameter_value then null;end;
 end loop;
 foreach bad in array array[public.daily_test_prefs()||'{"unexpected":true}'::jsonb,public.daily_test_prefs()||'{"morningEnabled":null}'::jsonb,public.daily_test_prefs()||'{"morningTime":"24:00"}'::jsonb,public.daily_test_prefs()-'quietEnd']loop
  begin perform public.save_daily_life_preferences('00000000-0000-4000-8000-000000000001',bad,0);raise exception 'Invalid preferences accepted';exception when invalid_parameter_value then null;end;
 end loop;
end;$$;

begin;
update public.profiles set status='blocked' where user_id='00000000-0000-4000-8000-000000000001';
set local role service_role;
do $$begin
 begin perform public.log_hydration('00000000-0000-4000-8000-000000000001','blocked-water-1',250,'web');raise exception 'Blocked water accepted';exception when insufficient_privilege then null;end;
 begin perform public.save_daily_life_preferences('00000000-0000-4000-8000-000000000001',public.daily_test_prefs(),0);raise exception 'Blocked preferences accepted';exception when insufficient_privilege then null;end;
 begin perform public.manage_lifeos_task('00000000-0000-4000-8000-000000000001',null,'blocked-task-1','{"title":"x"}',null);raise exception 'Blocked task accepted';exception when insufficient_privilege then null;end;
end;$$;
rollback;
