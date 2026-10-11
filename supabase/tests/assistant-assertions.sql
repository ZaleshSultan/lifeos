\set ON_ERROR_STOP on
-- Production grants and SECURITY INVOKER must exclude both browser roles.
do $$ begin
  assert not has_table_privilege('anon','public.assistant_memories','select');
  assert not has_table_privilege('authenticated','public.assistant_memories','insert');
  assert not has_table_privilege('authenticated','public.assistant_actions','select');
  assert not has_function_privilege('anon','public.assistant_execute_mutation(uuid,text,text,jsonb)','execute');
  assert not has_function_privilege('authenticated','public.assistant_execute_mutation(uuid,text,text,jsonb)','execute');
  assert not (select prosecdef from pg_proc where oid = 'public.assistant_execute_mutation(uuid,text,text,jsonb)'::regprocedure);
  assert (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.assistant_memories'::regclass);
  assert (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.assistant_actions'::regclass);
end $$;
grant select,insert,update on public.reminders to service_role;
set role service_role;
do $$ declare
  u uuid := '11111111-1111-4111-8111-111111111111';
  v uuid := '22222222-2222-4222-8222-222222222222';
  first_result jsonb; second_result jsonb;
  credential_sample text; credential_index integer := 0;
begin
  first_result := public.assistant_execute_mutation(u,'remember-1','tma',
    '{"type":"memory.remember","memoryKey":"study.format","category":"learning","content":"Explain with concrete examples"}');
  assert first_result->>'replayed' = 'false';
  second_result := public.assistant_execute_mutation(u,'remember-1','tma',
    '{"type":"memory.remember","memoryKey":"study.format","category":"learning","content":"Changed retry must not rewrite original"}');
  assert second_result->>'replayed' = 'true';
  assert first_result->>'resourceId' = second_result->>'resourceId';
  assert (select content = 'Explain with concrete examples' from public.assistant_memories where user_id=u and memory_key='study.format');
  -- Same request key belongs independently to each user.
  perform public.assistant_execute_mutation(v,'remember-1','telegram',
    '{"type":"memory.remember","memoryKey":"study.format","category":"fact","content":"The other user owns this fact"}');
  assert (select count(*) = 2 from public.assistant_memories where memory_key='study.format');
  -- Updating and deleting cannot reach another user's key.
  first_result := public.assistant_execute_mutation(u,'missing-update','tma',
    '{"type":"memory.update","memoryKey":"other.only","content":"Cannot create through update"}');
  assert first_result->>'status' = 'not_found';
  perform public.assistant_execute_mutation(v,'other-key','tma',
    '{"type":"memory.remember","memoryKey":"other.only","category":"fact","content":"Private to user two"}');
  first_result := public.assistant_execute_mutation(u,'missing-delete','tma',
    '{"type":"memory.delete","memoryKey":"other.only"}');
  assert first_result->>'status' = 'not_found';
  assert (select count(*)=1 from public.assistant_memories where user_id=v and memory_key='other.only');
  perform public.assistant_execute_mutation(u,'update-1','tma',
    '{"type":"memory.update","memoryKey":"study.format","content":"Explain step by step","category":"preference"}');
  assert (select content='Explain step by step' and category='preference' from public.assistant_memories where user_id=u and memory_key='study.format');
  perform public.assistant_execute_mutation(u,'archive-1','tma',
    '{"type":"memory.archive","memoryKey":"study.format"}');
  assert (select archived_at is not null from public.assistant_memories where user_id=u and memory_key='study.format');
  perform public.assistant_execute_mutation(u,'delete-1','tma',
    '{"type":"memory.delete","memoryKey":"study.format"}');
  assert not exists(select 1 from public.assistant_memories where user_id=u and memory_key='study.format');
  assert not exists(select 1 from public.assistant_actions where to_jsonb(assistant_actions)::text like '%Explain%');
  -- Old receipts never resurrect permanently deleted content.
  perform public.assistant_execute_mutation(u,'remember-1','tma',
    '{"type":"memory.remember","memoryKey":"study.format","category":"learning","content":"Explain with concrete examples"}');
  assert not exists(select 1 from public.assistant_memories where user_id=u and memory_key='study.format');
  begin
    perform public.assistant_execute_mutation(u,'remember-1','tma','{"type":"memory.delete","memoryKey":"study.format"}');
    raise exception 'expected idempotency type conflict';
  exception when invalid_parameter_value then null; end;
  foreach credential_sample in array array[
    'AIza' || repeat('x',35), 'ghp_' || repeat('x',30),
    'github_pat_' || repeat('x',30), 'sb_secret_' || repeat('x',30),
    'AKIA' || repeat('A',16), 'код подтверждения: 123456'
  ] loop
    credential_index := credential_index + 1;
    begin
      perform public.assistant_execute_mutation(u,'credential-raw-' || credential_index,'tma',
        jsonb_build_object('type','memory.remember','memoryKey','secret','category','fact','content',credential_sample));
      raise exception 'expected raw credential rejection';
    exception when invalid_parameter_value then null; end;
  end loop;
  assert not exists(select 1 from public.assistant_actions where request_id like 'credential-raw-%');
  -- No malformed/credential input may write either state or a receipt.
  begin
    perform public.assistant_execute_mutation(u,'credential','tma',
      '{"type":"memory.remember","memoryKey":"secret","category":"fact","content":"password: do-not-store-this"}');
    raise exception 'expected credential rejection';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.assistant_execute_mutation(u,'injection','tma',
      '{"type":"memory.remember","memoryKey":"fact","category":"fact","content":"Valid fact","sql":"delete from profiles"}');
    raise exception 'expected schema rejection';
  exception when invalid_parameter_value then null; end;
  assert not exists(select 1 from public.assistant_actions where request_id in ('credential','injection'));
  begin
    perform public.assistant_execute_mutation(u,'credential-natural','tma',
      '{"type":"memory.remember","memoryKey":"secret","category":"fact","content":"my password is do-not-store"}');
    raise exception 'expected natural language credential rejection';
  exception when invalid_parameter_value then null; end;
  -- A lost response retries the same reminder rather than inserting another.
  first_result := public.assistant_execute_mutation(u,'reminder-1','telegram',
    jsonb_build_object('type','reminder.create','message','Review DBMS notes','remindAt',to_char(now()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  second_result := public.assistant_execute_mutation(u,'reminder-1','telegram',
    jsonb_build_object('type','reminder.create','message','Review DBMS notes','remindAt',to_char(now()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  assert first_result->>'resourceId' = second_result->>'resourceId';
  assert second_result->>'replayed' = 'true';
  assert (select count(*)=1 from public.reminders where user_id=u and message='Review DBMS notes');
  assert not exists(select 1 from public.assistant_actions where to_jsonb(assistant_actions)::text like '%Review DBMS%');
end $$;
reset role;
-- Even if SELECT is accidentally granted later, RLS still isolates owners.
grant select on public.assistant_memories to authenticated;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$ begin
  assert (select count(*)=0 from public.assistant_memories);
  begin
    perform public.assistant_execute_mutation('11111111-1111-4111-8111-111111111111','browser','tma',
      '{"type":"memory.remember","memoryKey":"browser","category":"fact","content":"Forbidden browser mutation"}');
    raise exception 'expected browser RPC denial';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.assistant_memories;
    raise exception 'expected browser delete denial';
  exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ begin assert (select count(*)=2 from public.assistant_memories); end $$;
reset role;
revoke select on public.assistant_memories from authenticated;
-- The entire mutation rolls back if the transaction aborts.
begin;
set local role service_role;
select public.assistant_execute_mutation('11111111-1111-4111-8111-111111111111','rollback','tma',
  '{"type":"memory.remember","memoryKey":"rollback","category":"fact","content":"This must roll back"}');
rollback;
do $$ begin
  assert not exists(select 1 from public.assistant_actions where request_id='rollback');
  assert not exists(select 1 from public.assistant_memories where memory_key='rollback');
end $$;
-- If receipt persistence fails after the domain INSERT, neither may survive.
create function public.assistant_test_receipt_failure() returns trigger
language plpgsql set search_path = '' as $$ begin
  if new.request_id='receipt-failure' then raise exception 'fixture receipt failure'; end if;
  return new;
end $$;
create trigger assistant_test_receipt_failure before insert on public.assistant_actions
  for each row execute function public.assistant_test_receipt_failure();
set role service_role;
do $$ begin
  begin
    perform public.assistant_execute_mutation('11111111-1111-4111-8111-111111111111','receipt-failure','tma',
      '{"type":"memory.remember","memoryKey":"receipt.failure","category":"fact","content":"Must disappear when receipt fails"}');
    raise exception 'expected receipt failure';
  exception when raise_exception then
    if sqlerrm <> 'fixture receipt failure' then raise; end if;
  end;
  assert not exists(select 1 from public.assistant_memories where memory_key='receipt.failure');
  assert not exists(select 1 from public.assistant_actions where request_id='receipt-failure');
end $$;
reset role;
drop trigger assistant_test_receipt_failure on public.assistant_actions;
drop function public.assistant_test_receipt_failure();
