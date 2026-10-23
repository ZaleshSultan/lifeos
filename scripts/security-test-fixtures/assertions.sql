-- Assertions run as real API roles, never as postgres when testing access.
create schema test;
grant usage on schema test to anon, authenticated, service_role;
create function test.denied(sql text) returns void language plpgsql security invoker as $$
begin
  begin execute sql; exception when insufficient_privilege then return; end;
  raise exception 'Expected insufficient_privilege for %', sql;
end $$;
create function test.assert(ok boolean) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Security assertion failed'; end if; end $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

set role authenticated;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set request.jwt.claim.role='authenticated';
select test.denied($q$update public.profiles set role='admin' where user_id=auth.uid()$q$);
select test.denied($q$update public.profiles set status='active' where user_id=auth.uid()$q$);
select test.denied($q$update public.profiles set telegram_user_id=102 where user_id=auth.uid()$q$);
select test.denied($q$update public.profiles set metadata='{"admin":true}' where user_id=auth.uid()$q$);
select test.denied($q$update public.profiles set user_id='00000000-0000-4000-8000-000000000002' where user_id=auth.uid()$q$);
select test.denied($q$delete from public.profiles where user_id=auth.uid()$q$);
select test.denied($q$insert into public.profiles(user_id,status,role) values(auth.uid(),'active','admin')$q$);
update public.profiles set display_name='Safe name',timezone='UTC',locale='en' where user_id=auth.uid();
select test.assert((select status='blocked' and role='user' and display_name='Safe name' from public.profiles where user_id=auth.uid()));
select test.assert((select count(*)=1 from public.profiles));
with changed as (update public.profiles set display_name='stolen' where user_id<>'00000000-0000-4000-8000-000000000001' returning *) select test.assert(count(*)=0) from changed;
select test.denied('truncate public.health_metrics');
select test.denied('select * from public.user_oauth_connections');
select test.denied('select * from public.user_lms_settings');
select test.denied('select public.purge_expired_google_oauth_state_nonces()');
select test.denied($q$select public.claim_due_reminders(now(),1)$q$);
select test.denied($q$select public.create_life_entity_with_sync('00000000-0000-4000-8000-000000000002','capture','foreign')$q$);
-- A missing JWT role must not turn the SECURITY DEFINER ownership check into NULL.
set request.jwt.claim.role='';
set request.jwt.claim.sub='';
select test.denied($q$select public.create_life_entity_with_sync('00000000-0000-4000-8000-000000000002','capture','foreign')$q$);
reset role;

-- Admin operations through the trusted backend role still work.
set role service_role;
set request.jwt.claim.role='service_role';
update public.profiles set status='active',role='admin' where user_id='00000000-0000-4000-8000-000000000001';
select test.assert((select status='active' and role='admin' from public.profiles where user_id='00000000-0000-4000-8000-000000000001'));
insert into public.tasks(user_id,title) select id,'synthetic task' from auth.users;
insert into public.health_metrics(user_id,metric_date,metric_type,value) values
('00000000-0000-4000-8000-000000000001','2026-01-01','steps',100),
('00000000-0000-4000-8000-000000000002','2026-01-01','steps',200);
insert into public.life_entities(user_id,entity_type,title) values
('00000000-0000-4000-8000-000000000001','capture','synthetic'),
('00000000-0000-4000-8000-000000000002','capture','synthetic');
insert into public.user_oauth_connections(user_id,provider,provider_account_email) values
('00000000-0000-4000-8000-000000000001','google','a@example.invalid'),
('00000000-0000-4000-8000-000000000002','google','b@example.invalid');
insert into public.user_lms_settings(user_id,platform_type,username,encrypted_password) values
('00000000-0000-4000-8000-000000000001','aitu_moodle','synthetic-a','enc:v1:synthetic'),
('00000000-0000-4000-8000-000000000002','aitu_moodle','synthetic-b','enc:v1:synthetic');
reset role;

set role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
select test.assert((select count(*)=1 from public.safe_user_oauth_connections));
select test.assert((select count(*)=1 from public.safe_user_lms_settings));
-- Actual CRUD checks for private task, health and timeline records.
do $$ declare t text; n bigint; begin
  foreach t in array array['tasks','health_metrics','life_entities'] loop
    execute format('select count(*) from public.%I',t) into n;
    assert n=1, 'cross-user read';
    execute format('update public.%I set user_id=user_id where user_id<>auth.uid()',t);
    get diagnostics n=row_count; assert n=0, 'cross-user update';
    execute format('delete from public.%I where user_id<>auth.uid()',t);
    get diagnostics n=row_count; assert n=0, 'cross-user delete';
    perform test.denied(format('update public.%I set user_id=%L where user_id=auth.uid()',t,'00000000-0000-4000-8000-000000000002'));
  end loop;
end $$;
select test.denied($q$insert into public.health_metrics(user_id,metric_date,metric_type,value) values ('00000000-0000-4000-8000-000000000002','2026-01-02','steps',500)$q$);
insert into public.health_metrics(user_id,metric_date,metric_type,value) values (auth.uid(),'2026-01-02','steps',500);
update public.health_metrics set value=600 where user_id=auth.uid() and metric_date='2026-01-02';
delete from public.health_metrics where user_id=auth.uid() and metric_date='2026-01-02';
select public.create_life_entity_with_sync(auth.uid(),'capture','approved RPC');
reset role;

-- Inspect the entire loaded schema, including prior web/LMS migration grants.
do $$ declare f record; t record; begin
  for t in select c.oid,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='user_id') loop
    assert t.relrowsecurity, 'private table without RLS: '||t.relname;
    assert not has_table_privilege('authenticated',t.oid,'TRUNCATE'), 'browser truncate: '||t.relname;
  end loop;
  for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.prosecdef or p.proname in ('issue_web_login_token','exchange_web_login_token','resolve_web_session','revoke_web_session','claim_lms_sync_lease','release_lms_sync_lease','save_lms_session','delete_lms_session')) loop
    assert not has_function_privilege('anon',f.oid,'EXECUTE'), 'anon RPC: '||f.proname;
    if f.proname<>'create_life_entity_with_sync' then
      assert not has_function_privilege('authenticated',f.oid,'EXECUTE'), 'browser RPC: '||f.proname;
    end if;
    assert has_function_privilege('service_role',f.oid,'EXECUTE'), 'service RPC lost: '||f.proname;
  end loop;
end $$;
