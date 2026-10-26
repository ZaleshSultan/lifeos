set role service_role;
set request.jwt.claim.role='service_role';
select test.assert(public.issue_health_ingest_credential('00000000-0000-4000-8000-000000000001',repeat('a',64),clock_timestamp()+interval '29 days') is not null);
select test.assert(public.issue_health_ingest_credential('00000000-0000-4000-8000-000000000002',repeat('b',64),clock_timestamp()+interval '29 days') is not null);
select test.assert(public.resolve_health_ingest_credential('00000000-0000-4000-8000-000000000001',repeat('a',64)));
select test.assert(not public.resolve_health_ingest_credential('00000000-0000-4000-8000-000000000002',repeat('a',64)));
-- Cross-owner revoke is a no-op, as is a nonexistent device (no enumeration).
select public.revoke_health_ingest_credential('00000000-0000-4000-8000-000000000002',(select id from public.health_ingest_credentials where token_hash=repeat('a',64)));
select test.assert(public.resolve_health_ingest_credential('00000000-0000-4000-8000-000000000001',repeat('a',64)));
select test.assert((select count(*)=1 from public.list_health_ingest_credentials('00000000-0000-4000-8000-000000000001')));
select public.revoke_health_ingest_credential('00000000-0000-4000-8000-000000000001',(select id from public.health_ingest_credentials where token_hash=repeat('a',64)));
select test.assert(not public.resolve_health_ingest_credential('00000000-0000-4000-8000-000000000001',repeat('a',64)));
select test.assert(public.issue_health_ingest_credential('00000000-0000-4000-8000-000000000001',repeat('c',64),clock_timestamp()+interval '29 days') is not null);
update public.profiles set status='blocked' where user_id='00000000-0000-4000-8000-000000000001';
select test.assert(not public.resolve_health_ingest_credential('00000000-0000-4000-8000-000000000001',repeat('c',64)));
select test.assert(public.issue_health_ingest_credential('00000000-0000-4000-8000-000000000001',repeat('d',64),clock_timestamp()+interval '29 days') is null);
update public.profiles set status='active' where user_id='00000000-0000-4000-8000-000000000001';
select test.assert(not public.resolve_health_ingest_credential('00000000-0000-4000-8000-000000000001',repeat('c',64)));
-- Blocking A leaves B unaffected. Database expiry is independently enforced.
select test.assert(public.resolve_health_ingest_credential('00000000-0000-4000-8000-000000000002',repeat('b',64)));
update public.health_ingest_credentials set created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' where token_hash=repeat('b',64);
select test.assert(not public.resolve_health_ingest_credential('00000000-0000-4000-8000-000000000002',repeat('b',64)));
select test.assert(public.issue_health_ingest_credential('00000000-0000-4000-8000-000000000001',repeat('e',64),clock_timestamp()-interval '1 second') is null);
reset role;
set role authenticated;
select test.denied('select * from public.health_ingest_credentials');
select test.denied($q$select public.issue_health_ingest_credential('00000000-0000-4000-8000-000000000001',repeat('f',64),now()+interval '1 day')$q$);
select test.denied($q$select public.resolve_health_ingest_credential('00000000-0000-4000-8000-000000000001',repeat('a',64))$q$);
select test.denied($q$select public.revoke_health_ingest_credential('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003')$q$);
select test.denied($q$select public.list_health_ingest_credentials('00000000-0000-4000-8000-000000000001')$q$);
reset role;
do $$ declare f record; begin
  for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname like '%health%credential%' loop
    assert not has_function_privilege('anon',f.oid,'EXECUTE'), 'anon health RPC';
    assert not has_function_privilege('authenticated',f.oid,'EXECUTE'), 'authenticated health RPC';
    assert has_function_privilege('service_role',f.oid,'EXECUTE'), 'service health RPC';
  end loop;
end $$;
