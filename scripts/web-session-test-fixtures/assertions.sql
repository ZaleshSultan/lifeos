create function pg_temp.assert(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;

select pg_temp.assert((select count(*) = 2 from pg_class where oid in ('public.web_login_tokens'::regclass, 'public.web_sessions'::regclass) and relrowsecurity), 'RLS enabled');
do $$
declare r text; f regprocedure; t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach t in array array['web_sessions', 'web_login_tokens'] loop
      perform pg_temp.assert(not has_table_privilege(r, 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE'), r || ' has no table privileges');
    end loop;
    foreach f in array array[
      'public.issue_web_login_token(uuid,text,timestamptz)'::regprocedure,
      'public.exchange_web_login_token(uuid,text,text)'::regprocedure,
      'public.resolve_web_session(text)'::regprocedure,
      'public.revoke_web_session(uuid,text)'::regprocedure,
      'public.invalidate_inactive_web_sessions()'::regprocedure
    ] loop
      perform pg_temp.assert(not has_function_privilege(r, f, 'EXECUTE'), r || ' has no function privileges');
    end loop;
  end loop;
end;
$$;
select pg_temp.assert(not exists(select 1 from pg_proc where proname in ('issue_web_login_token','exchange_web_login_token','resolve_web_session','revoke_web_session','invalidate_inactive_web_sessions') and prosecdef), 'no security definer bypass');
set role service_role;

select pg_temp.assert(public.issue_web_login_token('00000000-0000-4000-8000-000000000001', repeat('a',64), clock_timestamp() + interval '120 seconds'), 'issue');
select pg_temp.assert(public.exchange_web_login_token('00000000-0000-4000-8000-000000000002', repeat('a',64), repeat('1',64)) is null, 'cross-user exchange rejected');
select pg_temp.assert(public.exchange_web_login_token('00000000-0000-4000-8000-000000000001', repeat('a',64), repeat('1',64)) is not null, 'initial exchange');
select pg_temp.assert(public.exchange_web_login_token('00000000-0000-4000-8000-000000000001', repeat('a',64), repeat('2',64)) is null, 'replay rejected');
select pg_temp.assert(public.resolve_web_session(repeat('1',64)) = '00000000-0000-4000-8000-000000000001', 'session identity');
select public.revoke_web_session('00000000-0000-4000-8000-000000000002', repeat('1',64));
select pg_temp.assert(public.resolve_web_session(repeat('1',64)) is not null, 'cross-user revoke rejected');
select public.revoke_web_session('00000000-0000-4000-8000-000000000001', repeat('1',64));
select pg_temp.assert(public.resolve_web_session(repeat('1',64)) is null, 'revocation');

insert into public.web_login_tokens(token_hash,user_id,created_at,expires_at) values
  (repeat('b',64),'00000000-0000-4000-8000-000000000001',clock_timestamp()-interval '120 seconds',clock_timestamp()-interval '1 second');
select pg_temp.assert(public.exchange_web_login_token('00000000-0000-4000-8000-000000000001',repeat('b',64),repeat('2',64)) is null,'expired login');
insert into public.web_sessions(session_hash,user_id,created_at,expires_at) values
  (repeat('3',64),'00000000-0000-4000-8000-000000000001',clock_timestamp()-interval '31 days',clock_timestamp()-interval '2 days');
select pg_temp.assert(public.resolve_web_session(repeat('3',64)) is null,'expired session');

do $$
begin
  begin
    perform public.issue_web_login_token('00000000-0000-4000-8000-000000000001',repeat('c',64),clock_timestamp()+interval '121 seconds');
    raise exception 'Allowed excessive login lifetime';
  exception when check_violation then null; end;
end;
$$;

-- An insert failure must roll back consumption of the login token.
select public.issue_web_login_token('00000000-0000-4000-8000-000000000001',repeat('c',64),clock_timestamp()+interval '120 seconds');
do $$
begin
  begin
    perform public.exchange_web_login_token('00000000-0000-4000-8000-000000000001',repeat('c',64),repeat('1',64));
    raise exception 'Expected duplicate session hash';
  exception when unique_violation then null; end;
end;
$$;
select pg_temp.assert(public.exchange_web_login_token('00000000-0000-4000-8000-000000000001',repeat('c',64),repeat('4',64)) is not null, 'failed insert did not burn login');
select public.issue_web_login_token('00000000-0000-4000-8000-000000000001',repeat('d',64),clock_timestamp()+interval '120 seconds');
select public.issue_web_login_token('00000000-0000-4000-8000-000000000002',repeat('e',64),clock_timestamp()+interval '120 seconds');
select public.exchange_web_login_token('00000000-0000-4000-8000-000000000002',repeat('e',64),repeat('5',64));
update public.profiles set status='blocked' where user_id='00000000-0000-4000-8000-000000000001';
select pg_temp.assert(public.resolve_web_session(repeat('4',64)) is null, 'blocked session');
select pg_temp.assert(public.exchange_web_login_token('00000000-0000-4000-8000-000000000001',repeat('d',64),repeat('6',64)) is null, 'blocked login');
select pg_temp.assert(not public.issue_web_login_token('00000000-0000-4000-8000-000000000001',repeat('f',64),clock_timestamp()+interval '120 seconds'), 'blocked issuance');
select pg_temp.assert(public.resolve_web_session(repeat('5',64)) is not null, 'other user unaffected');
update public.profiles set status='active' where user_id='00000000-0000-4000-8000-000000000001';
select pg_temp.assert(public.resolve_web_session(repeat('4',64)) is null, 'unblocking does not revive sessions');
select pg_temp.assert(public.exchange_web_login_token('00000000-0000-4000-8000-000000000001',repeat('d',64),repeat('6',64)) is null, 'unblocking does not revive links');
