-- Disposable PostgreSQL only; deliberately uses separate fixture users/dates.
\set ON_ERROR_STOP on
insert into auth.users(id,email) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','digest-a@example.invalid'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','digest-b@example.invalid');
insert into public.profiles(user_id,telegram_user_id,status,timezone) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',123456,'active','Asia/Almaty'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',654321,'pending','Asia/Almaty');

-- Preserve old successful and ambiguous rows. The migration cannot infer
-- whether an old `sending` row reached Telegram.
insert into public.daily_digest_deliveries(user_id,local_date,telegram_chat_id,status,sent_at) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-01',123456,'sent','2040-01-01T01:00:00Z'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-02',123456,'sending',null);

do $$ begin
  if has_function_privilege('anon','public.claim_daily_digest_delivery(uuid,date,bigint)','execute')
     or has_function_privilege('authenticated','public.claim_daily_digest_delivery(uuid,date,bigint)','execute')
     or has_function_privilege('authenticated','public.start_daily_digest_delivery(uuid,date,uuid)','execute')
     or has_function_privilege('authenticated','public.complete_daily_digest_delivery(uuid,date,uuid,bigint)','execute')
     or has_function_privilege('authenticated','public.release_daily_digest_delivery(uuid,date,uuid,text)','execute')
  then raise exception 'Digest RPC exposed to browser role'; end if;
  if has_table_privilege('authenticated','public.daily_digest_deliveries','select')
  then raise exception 'Digest table exposed to browser role'; end if;
end $$;

set role authenticated;
do $$ begin
  begin
    perform public.claim_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',123456);
    raise exception 'Browser invoked digest claim';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set role service_role;
do $$ declare token uuid; new_token uuid; i integer; begin
  if public.claim_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',654321) is not null
     or public.claim_daily_digest_delivery('dddddddd-dddd-4ddd-8ddd-dddddddddddd','2040-01-03',654321) is not null
  then raise exception 'Inactive/mismatched linked profile claimed'; end if;
  if public.claim_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-01',123456) is not null
     or public.claim_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-02',123456) is not null
  then raise exception 'Legacy delivery reclaimed'; end if;
  if (select sent_at from public.daily_digest_deliveries where local_date='2040-01-01')<>'2040-01-01T01:00:00Z'::timestamptz
  then raise exception 'Legacy sent_at changed'; end if;

  token:=public.claim_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',123456);
  if token is null then raise exception 'Fresh claim failed'; end if;
  for i in 1..1440 loop
    if public.claim_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',123456) is not null
    then raise exception 'Repeated claim succeeded'; end if;
  end loop;
  if (select count(*) from public.daily_digest_deliveries where local_date='2040-01-03')<>1
  then raise exception 'Repeated claims created rows'; end if;

  -- Recover a crash while preparing, then prove the previous worker is fenced.
  update public.daily_digest_deliveries set lease_expires_at=clock_timestamp()-interval '1 minute'
  where user_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' and local_date='2040-01-03';
  new_token:=public.claim_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',123456);
  if new_token is null or new_token=token then raise exception 'Expired preparation not recovered'; end if;
  if public.start_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',token)
     or public.release_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',token,'retry')
  then raise exception 'Stale worker changed reclaimed delivery'; end if;
  if not public.start_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',new_token)
  then raise exception 'Current worker cannot start'; end if;
  if public.start_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',new_token)
  then raise exception 'Worker started outbound phase twice'; end if;
  if public.claim_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',123456) is not null
  then raise exception 'Crash after outbound start caused automatic resend'; end if;

  -- A definite refusal can retry, but an ambiguous outbound outcome cannot.
  if not public.release_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',new_token,'retry')
  then raise exception 'Definite rejection not retryable'; end if;
  token:=public.claim_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',123456);
  if token is null or not public.start_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',token)
  then raise exception 'Retry failed'; end if;
  if not public.release_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',token,'uncertain')
  then raise exception 'Ambiguous outcome not recorded'; end if;
  if public.claim_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',123456) is not null
     or public.release_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',token,'retry')
  then raise exception 'Ambiguous outcome auto-retried'; end if;

  -- A known Telegram success can be finalized repeatedly without another send.
  if public.complete_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',token,0)
     or public.complete_daily_digest_delivery('dddddddd-dddd-4ddd-8ddd-dddddddddddd','2040-01-03',token,42)
  then raise exception 'Invalid completion accepted'; end if;
  if not public.complete_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',token,42)
     or not public.complete_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',token,42)
  then raise exception 'Completion not idempotent'; end if;
  if public.complete_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',token,43)
     or public.release_daily_digest_delivery('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-03',token,'uncertain')
  then raise exception 'Sent delivery was changed'; end if;
  if (select attempt_count from public.daily_digest_deliveries where local_date='2040-01-03')<>3
  then raise exception 'Incorrect recovery attempt count'; end if;
end $$;
reset role;
select 'OK: 1440 conflict-free repeats, preparation lease recovery, stale-worker fencing, restricted RPCs, legacy preservation, outbound ambiguity and completion idempotency' result;
