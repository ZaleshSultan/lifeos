-- These checks run after independent overlapping reminder/digest transactions.
select notification_test.assert((select count(*)=24 from notification_test.reminder_claims),'all due reminders claimed');
select notification_test.assert((select count(distinct id)=24 from notification_test.reminder_claims),'parallel reminder claims never overlap');
select notification_test.assert((select count(distinct claim_token)=24 from notification_test.reminder_claims),'each reminder has a distinct ownership token');
select notification_test.assert((select count(*)=24 from public.reminders where status='processing' and lease_expires_at>clock_timestamp()),'claimed reminders have live leases');
select notification_test.assert((select count(*)=24 from public.reminders r join notification_test.reminder_claims c on c.id=r.id where delivery_attempts=0),'claiming does not count a Telegram attempt');
select notification_test.assert((select count(*)=1 from notification_test.digest_claims),'parallel digest claims return exactly one winner');
select notification_test.assert((select count(*)=1 from public.daily_digest_deliveries where local_date>'2000-01-01'),'parallel digests preserve daily unique record');
select notification_test.assert((select status='unknown' from public.reminders where id='00000000-0000-4000-8000-000000001001'),'upgrade preserves ambiguous legacy reminder without resending');
select notification_test.assert((select status='unknown' from public.daily_digest_deliveries where id='00000000-0000-4000-8000-000000002001'),'upgrade preserves ambiguous legacy digest without resending');
select notification_test.assert((select status='sent' and sent_at='2000-01-01T06:00:00Z' from public.daily_digest_deliveries where id='00000000-0000-4000-8000-000000002002'),'upgrade preserves confirmed historical delivery');
select notification_test.assert((select count(*)=0 from public.claim_daily_digest('00000000-0000-4000-8000-000000000002',(clock_timestamp() at time zone 'Asia/Almaty')::date-1)),'digest claim rejects previous local date');

do $$
declare v_role text; v_function regprocedure;
begin
  foreach v_role in array array['anon','authenticated'] loop
    foreach v_function in array array[
      'public.claim_due_reminders(timestamptz,integer)'::regprocedure,
      'public.claim_daily_digest(uuid,date)'::regprocedure,
      'public.begin_notification_delivery(text,uuid,uuid,uuid)'::regprocedure,
      'public.finish_notification_delivery(text,uuid,uuid,uuid,text,text,bigint,integer)'::regprocedure,
      'public.defer_reminder_delivery(uuid,uuid,uuid,timestamptz)'::regprocedure,
      'public.recover_notification_deliveries(text,integer)'::regprocedure,
      'public.notification_queue_health()'::regprocedure,
      'public.invalidate_inactive_notification_claims()'::regprocedure
    ] loop
      perform notification_test.assert(not has_function_privilege(v_role,v_function,'EXECUTE'),v_role || ' cannot execute ' || v_function::text);
    end loop;
  end loop;
end;
$$;
select notification_test.assert((select count(*)=2 from pg_class where oid in ('public.reminders'::regclass,'public.daily_digest_deliveries'::regclass) and relrowsecurity and relforcerowsecurity),'notification tables preserve forced RLS');
select notification_test.assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('claim_daily_digest','begin_notification_delivery','finish_notification_delivery','defer_reminder_delivery','recover_notification_deliveries','notification_queue_health','invalidate_inactive_notification_claims') and p.prosecdef),'new notification RPCs preserve invoker security');

set role service_role;
update public.reminders set status='cancelled',claim_token=null,lease_expires_at=null where status='processing';

do $$
declare r public.reminders; v_token uuid; v_old_time timestamptz; v_new_token uuid;
begin
  r := notification_test.claim_reminder('ownership');
  perform notification_test.assert(public.begin_notification_delivery('reminder','00000000-0000-4000-8000-000000000002',r.id,r.claim_token) is null,'cross-user reminder begin rejected');
  perform notification_test.assert(not public.finish_notification_delivery('reminder','00000000-0000-4000-8000-000000000002',r.id,r.claim_token,'sent','none',999),'cross-user reminder finish rejected');
  perform notification_test.assert(not public.defer_reminder_delivery('00000000-0000-4000-8000-000000000002',r.id,r.claim_token,clock_timestamp()+interval '1 hour'),'cross-user reminder defer rejected');
  perform notification_test.assert(public.begin_notification_delivery('reminder',r.user_id,r.id,gen_random_uuid()) is null,'wrong reminder claim token rejected');
  perform notification_test.assert(public.begin_notification_delivery('reminder',r.user_id,r.id,r.claim_token)=101,'valid reminder begin returns current recipient');
  perform notification_test.assert((select delivery_attempts=1 and status='sending' from public.reminders where id=r.id),'begin increments Telegram attempts once');
  perform notification_test.assert(public.begin_notification_delivery('reminder',r.user_id,r.id,r.claim_token) is null,'repeated begin cannot send twice');
  perform notification_test.assert(public.finish_notification_delivery('reminder',r.user_id,r.id,r.claim_token,'sent','none',1234),'acknowledged reminder finishes sent');
  perform notification_test.assert((select status='sent' and telegram_message_id=1234 from public.reminders where id=r.id),'acknowledged reminder message id recorded');
  perform notification_test.assert(not public.finish_notification_delivery('reminder',r.user_id,r.id,r.claim_token,'retry','network'),'late finish cannot overwrite sent reminder');

  r := notification_test.claim_reminder('defer');
  v_old_time := r.remind_at;
  perform notification_test.assert(public.defer_reminder_delivery(r.user_id,r.id,r.claim_token,clock_timestamp()+interval '2 hours'),'owned reminder may be deferred before send');
  perform notification_test.assert((select status='pending' and remind_at=v_old_time and next_attempt_at>clock_timestamp()+interval '1 hour' and delivery_attempts=0 from public.reminders where id=r.id),'quiet deferral preserves original event time and attempt count');
  perform notification_test.assert((select notification_at=next_attempt_at and notification_at>remind_at from public.reminders where id=r.id),'generated notification time follows quiet-hour deferral');
  perform notification_test.assert((select (metadata_json->>'event_at')::timestamptz=v_old_time from public.reminders where id=r.id),'quiet deferral records original event timestamp');
  perform notification_test.assert(not public.defer_reminder_delivery(r.user_id,r.id,r.claim_token,clock_timestamp()+interval '3 hours'),'deferred reminder no longer accepts stale token');

  r := notification_test.claim_reminder('expired-before-send');
  v_token := r.claim_token;
  update public.reminders set lease_expires_at=clock_timestamp()-interval '1 second' where id=r.id;
  perform notification_test.assert(public.begin_notification_delivery('reminder',r.user_id,r.id,v_token) is null,'expired processing lease cannot start send');
  perform public.recover_notification_deliveries('reminder',100);
  perform notification_test.assert((select status='pending' and failure_count=1 and delivery_attempts=0 and next_attempt_at>clock_timestamp() from public.reminders where id=r.id),'crash before Telegram safely retries with bounded backoff');
  perform notification_test.assert((select claimed_at is null from public.reminders where id=r.id),'stale recovery clears obsolete reminder claim timestamp');
  update public.reminders set next_attempt_at=clock_timestamp()-interval '1 second' where id=r.id;
  select claim_token into v_new_token from public.claim_due_reminders(clock_timestamp(),100) where id=r.id;
  perform notification_test.assert(v_new_token is not null and v_new_token<>v_token,'recovered reminder gets fresh claim ownership');
  perform notification_test.assert(not public.finish_notification_delivery('reminder',r.user_id,r.id,v_token,'sent','none',999),'old worker cannot finish a newer reminder claim');
  perform notification_test.assert(public.begin_notification_delivery('reminder',r.user_id,r.id,v_token) is null,'old worker cannot begin a newer reminder claim');
  update public.reminders set status='cancelled' where id=r.id;
  perform notification_test.assert(public.begin_notification_delivery('reminder',r.user_id,r.id,v_new_token) is null,'cancelled reminder cannot begin delivery');
  update public.reminders set lease_expires_at=clock_timestamp()-interval '1 second' where id=r.id;
  perform public.recover_notification_deliveries('reminder',100);
  perform notification_test.assert((select status='cancelled' from public.reminders where id=r.id),'recovery never restores a cancelled reminder');

  r := notification_test.claim_reminder('expired-during-send');
  perform public.begin_notification_delivery('reminder',r.user_id,r.id,r.claim_token);
  update public.reminders set lease_expires_at=clock_timestamp()-interval '1 second' where id=r.id;
  perform notification_test.assert(not public.finish_notification_delivery('reminder',r.user_id,r.id,r.claim_token,'sent','none',999),'expired sending lease cannot overwrite recovery');
  perform public.recover_notification_deliveries('reminder',100);
  perform notification_test.assert((select status='unknown' and delivery_attempts=1 from public.reminders where id=r.id),'crash during Telegram becomes terminal unknown');
  perform notification_test.assert(not exists(select 1 from public.claim_due_reminders(clock_timestamp(),100) where id=r.id),'unknown reminder is never blindly retried');
end;
$$;

do $$
declare r public.reminders; v_id uuid; v_token uuid; v_attempt integer;
begin
  r := notification_test.claim_reminder('bounded-retries');
  v_id := r.id;
  for v_attempt in 1..3 loop
    perform notification_test.assert(public.begin_notification_delivery('reminder',r.user_id,r.id,r.claim_token)=101,'retry attempt ' || v_attempt || ' begins once');
    perform notification_test.assert(public.finish_notification_delivery('reminder',r.user_id,r.id,r.claim_token,'retry','rate_limited',null,1),'retry attempt ' || v_attempt || ' result persists');
    perform notification_test.assert((select delivery_attempts=v_attempt and failure_count=v_attempt from public.reminders where id=v_id),'retry attempt ' || v_attempt || ' counters are monotonic');
    if v_attempt<3 then
      update public.reminders set next_attempt_at=clock_timestamp()-interval '1 second' where id=v_id;
      select * into r from public.claim_due_reminders(clock_timestamp(),100) where id=v_id;
    end if;
  end loop;
  perform notification_test.assert((select status='failed' from public.reminders where id=v_id),'retry budget exhaustion becomes terminal failed');
  perform notification_test.assert(not exists(select 1 from public.claim_due_reminders(clock_timestamp(),100) where id=v_id),'terminal failed reminder cannot be reclaimed');

  r := notification_test.claim_reminder('permanent');
  perform public.begin_notification_delivery('reminder',r.user_id,r.id,r.claim_token);
  perform notification_test.assert(public.finish_notification_delivery('reminder',r.user_id,r.id,r.claim_token,'permanent','recipient_unavailable'),'permanent failure recorded');
  perform notification_test.assert((select status='failed' and delivery_attempts=1 from public.reminders where id=r.id),'permanent failure stops immediately');

  r := notification_test.claim_reminder('network-timeout');
  perform public.begin_notification_delivery('reminder',r.user_id,r.id,r.claim_token);
  perform notification_test.assert(public.finish_notification_delivery('reminder',r.user_id,r.id,r.claim_token,'unknown','network_timeout'),'ambiguous result recorded');
  perform notification_test.assert((select status='unknown' from public.reminders where id=r.id),'ambiguous result stays terminal unknown');

  r := notification_test.claim_reminder('repeat-processing-crash');
  v_id := r.id;
  for v_attempt in 1..3 loop
    update public.reminders set lease_expires_at=clock_timestamp()-interval '1 second' where id=v_id;
    perform public.recover_notification_deliveries('reminder',100);
    if v_attempt<3 then
      update public.reminders set next_attempt_at=clock_timestamp()-interval '1 second' where id=v_id;
      perform id from public.claim_due_reminders(clock_timestamp(),100) where id=v_id;
    end if;
  end loop;
  perform notification_test.assert((select status='failed' and failure_count=3 and delivery_attempts=0 from public.reminders where id=v_id),'repeated pre-send crashes exhaust retry budget without pretending to send');
end;
$$;

do $$
declare r public.reminders; v_id uuid; v_original timestamptz; v_event timestamptz:=clock_timestamp()+interval '1 day';
begin
  r := notification_test.claim_reminder('defer-after-retry');
  v_id:=r.id;
  v_original:=r.remind_at;
  update public.reminders set metadata_json=jsonb_build_object('event_at',v_event) where id=v_id;
  perform public.begin_notification_delivery('reminder',r.user_id,r.id,r.claim_token);
  perform public.finish_notification_delivery('reminder',r.user_id,r.id,r.claim_token,'retry','rate_limited');
  update public.reminders set next_attempt_at=clock_timestamp()-interval '1 second' where id=v_id;
  select * into r from public.claim_due_reminders(clock_timestamp(),100) where id=v_id;
  perform notification_test.assert(public.defer_reminder_delivery(r.user_id,r.id,r.claim_token,clock_timestamp()+interval '2 hours'),'retry claim may defer safely');
  perform notification_test.assert((select delivery_attempts=1 and failure_count=1 from public.reminders where id=v_id),'quiet deferral never resets prior attempt or failure counters');
  perform notification_test.assert((select remind_at=v_original and (metadata_json->>'event_at')::timestamptz=v_event from public.reminders where id=v_id),'quiet deferral preserves preexisting actual event time');
end;
$$;

-- Subtransactions model failed database statements/commits without sending a
-- Telegram request. Recovery must classify the durable boundary conservatively.
do $$
declare r public.reminders; v_future_id uuid;
begin
  r := notification_test.claim_reminder('begin-write-failed');
  begin
    perform public.begin_notification_delivery('reminder',r.user_id,r.id,r.claim_token);
    raise exception using errcode='ZX001',message='synthetic database failure';
  exception when sqlstate 'ZX001' then null;
  end;
  perform notification_test.assert((select status='processing' and delivery_attempts=0 from public.reminders where id=r.id),'failed begin write rolls back attempt and send boundary');
  perform notification_test.assert(public.begin_notification_delivery('reminder',r.user_id,r.id,r.claim_token)=101,'retry after definitely failed begin is safe');
  begin
    perform public.finish_notification_delivery('reminder',r.user_id,r.id,r.claim_token,'sent','none',777);
    raise exception using errcode='ZX001',message='synthetic database failure';
  exception when sqlstate 'ZX001' then null;
  end;
  perform notification_test.assert((select status='sending' and telegram_message_id is null from public.reminders where id=r.id),'failed acknowledgement write preserves unresolved sending boundary');
  update public.reminders set lease_expires_at=clock_timestamp()-interval '1 second' where id=r.id;
  perform public.recover_notification_deliveries('reminder',100);
  perform notification_test.assert((select status='unknown' from public.reminders where id=r.id),'acknowledged Telegram plus failed DB write never blindly retries');

  insert into public.reminders(user_id,channel,remind_at,message)
  values(r.user_id,'telegram',clock_timestamp()+interval '1 day','synthetic future fixture') returning id into v_future_id;
  perform notification_test.assert(not exists(select 1 from public.claim_due_reminders(clock_timestamp()+interval '2 days',100) where id=v_future_id),'caller cannot advance reminder claim beyond database time');
  update public.reminders set next_attempt_at=remind_at+interval '1 hour' where id=v_future_id;
  perform notification_test.assert((select notification_at=next_attempt_at from public.reminders where id=v_future_id),'generated notification time follows later retry timestamp');
  update public.reminders set next_attempt_at=null where id=v_future_id;
  perform notification_test.assert((select notification_at=remind_at from public.reminders where id=v_future_id),'clearing retry timestamp restores scheduled notification time');
end;
$$;

-- UTC is the explicit SQL fallback for an invalid legacy IANA identifier.
-- Roll back this synthetic claim so later tests can still use the user's day.
do $$
declare d public.daily_digest_deliveries; v_claimed boolean:=false; v_old_id uuid; v_pending_id uuid; v_token uuid:=gen_random_uuid();
begin
  begin
    update public.profiles set timezone='Invalid/Zone' where user_id='00000000-0000-4000-8000-000000000002';
    select * into d from public.claim_daily_digest('00000000-0000-4000-8000-000000000002',(clock_timestamp() at time zone 'UTC')::date);
    v_claimed:=d.id is not null and d.local_date=(clock_timestamp() at time zone 'UTC')::date;
    raise exception using errcode='ZX002',message='roll back synthetic timezone fixture';
  exception when sqlstate 'ZX002' then null;
  end;
  perform notification_test.assert(v_claimed,'invalid profile timezone uses UTC local-date fallback');
  perform notification_test.assert((select count(*)=0 from public.claim_daily_digest('00000000-0000-4000-8000-000000000002',(clock_timestamp() at time zone 'Asia/Almaty')::date+1)),'digest claim rejects future local date');

  insert into public.daily_digest_deliveries(user_id,local_date,telegram_chat_id,status,claim_token,lease_expires_at)
  values('00000000-0000-4000-8000-000000000001',(clock_timestamp() at time zone 'America/New_York')::date-1,101,'processing',v_token,clock_timestamp()+interval '5 minutes')
  returning id into v_old_id;
  perform notification_test.assert(public.begin_notification_delivery('digest','00000000-0000-4000-8000-000000000001',v_old_id,v_token) is null,'digest preparation crossing local midnight cannot start yesterday delivery');
  perform notification_test.assert((select delivery_attempts=0 from public.daily_digest_deliveries where id=v_old_id),'obsolete digest preparation consumes no Telegram attempt');
  insert into public.daily_digest_deliveries(user_id,local_date,telegram_chat_id,status)
  values('00000000-0000-4000-8000-000000000002',(clock_timestamp() at time zone 'Asia/Almaty')::date-1,102,'pending')
  returning id into v_pending_id;
  perform public.recover_notification_deliveries('digest',100);
  perform notification_test.assert((select status='failed' and delivery_attempts=0 from public.daily_digest_deliveries where id=v_pending_id),'past-date pending digest becomes visible terminal failure');
end;
$$;

-- Current local-date row was initially claimed by one of eight digest workers.
do $$
declare d public.daily_digest_deliveries; v_token uuid; v_new_token uuid;
begin
  select * into d from public.daily_digest_deliveries where user_id='00000000-0000-4000-8000-000000000001' and local_date=(clock_timestamp() at time zone 'America/New_York')::date;
  v_token := d.claim_token;
  perform notification_test.assert(public.begin_notification_delivery('digest','00000000-0000-4000-8000-000000000002',d.id,v_token) is null,'cross-user digest begin rejected');
  perform notification_test.assert(not public.finish_notification_delivery('digest','00000000-0000-4000-8000-000000000002',d.id,v_token,'sent','none',999),'cross-user digest finish rejected');
  update public.daily_digest_deliveries set lease_expires_at=clock_timestamp()-interval '1 second' where id=d.id;
  perform public.recover_notification_deliveries('digest',100);
  perform notification_test.assert((select status='pending' and failure_count=1 and delivery_attempts=0 from public.daily_digest_deliveries where id=d.id),'digest crash before send recovers to pending');
  perform notification_test.assert((select count(*)=0 from public.claim_daily_digest(d.user_id,d.local_date)),'digest respects retry backoff');
  update public.daily_digest_deliveries set next_attempt_at=clock_timestamp()-interval '1 second' where id=d.id;
  select claim_token into v_new_token from public.claim_daily_digest(d.user_id,d.local_date);
  perform notification_test.assert(v_new_token is not null and v_new_token<>v_token,'digest restart acquires fresh claim token');
  perform notification_test.assert(not public.finish_notification_delivery('digest',d.user_id,d.id,v_token,'sent','none',999),'stale digest worker cannot overwrite new owner');
  perform notification_test.assert(public.begin_notification_delivery('digest',d.user_id,d.id,v_new_token)=101,'restarted digest begins with current recipient');
  update public.daily_digest_deliveries set lease_expires_at=clock_timestamp()-interval '1 second' where id=d.id;
  perform public.recover_notification_deliveries('digest',100);
  perform notification_test.assert((select status='unknown' and delivery_attempts=1 from public.daily_digest_deliveries where id=d.id),'stale sending digest becomes terminal unknown');
  perform notification_test.assert((select count(*)=0 from public.claim_daily_digest(d.user_id,d.local_date)),'unknown digest preserves daily deduplication');

  select * into d from public.claim_daily_digest('00000000-0000-4000-8000-000000000002',(clock_timestamp() at time zone 'Asia/Almaty')::date);
  perform notification_test.assert(public.begin_notification_delivery('digest',d.user_id,d.id,d.claim_token)=102,'second user digest targets second user');
  perform notification_test.assert(public.finish_notification_delivery('digest',d.user_id,d.id,d.claim_token,'sent','none',4321),'confirmed digest persisted');
  perform notification_test.assert((select count(*)=0 from public.claim_daily_digest(d.user_id,d.local_date)),'confirmed digest never rescheduled for same local date');
end;
$$;

do $$
declare r public.reminders; v_health jsonb;
begin
  r := notification_test.claim_reminder('blocked-before-begin');
  update public.profiles set status='blocked' where user_id=r.user_id;
  perform notification_test.assert(public.begin_notification_delivery('reminder',r.user_id,r.id,r.claim_token) is null,'blocked recipient cannot start reminder');
  perform notification_test.assert((select status='cancelled' from public.reminders where id=r.id),'blocking cancels processing reminder');
  perform notification_test.assert((select count(*)=0 from public.claim_daily_digest(r.user_id,(clock_timestamp() at time zone 'America/New_York')::date)),'blocked recipient cannot claim digest');
  update public.profiles set status='active' where user_id=r.user_id;
  perform notification_test.assert((select status='cancelled' from public.reminders where id=r.id),'unblocking never restores cancelled notification');
  r := notification_test.claim_reminder('blocked-during-send');
  perform public.begin_notification_delivery('reminder',r.user_id,r.id,r.claim_token);
  update public.profiles set status='blocked' where user_id=r.user_id;
  perform notification_test.assert((select status='unknown' from public.reminders where id=r.id),'blocking in-flight reminder preserves unknown outcome');
  perform notification_test.assert(not public.finish_notification_delivery('reminder',r.user_id,r.id,r.claim_token,'sent','none',999),'blocked stale worker cannot overwrite invalidated delivery');
  update public.profiles set status='active' where user_id=r.user_id;
  v_health := public.notification_queue_health();
  perform notification_test.assert(jsonb_typeof(v_health)='object','queue health returns structured counts');
  perform notification_test.assert(v_health::text not like '%synthetic fixture%' and v_health::text not like '%' || r.claim_token::text || '%','queue health excludes content and claim tokens');
end;
$$;
reset role;

-- The browser role still cannot write another user's reminder through table RLS.
set role authenticated;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set request.jwt.claim.role='authenticated';
do $$
declare v_count integer;
begin
  update public.reminders set message='cross-user mutation' where user_id='00000000-0000-4000-8000-000000000002';
  get diagnostics v_count=row_count;
  if v_count<>0 then raise exception 'Cross-user browser update escaped RLS'; end if;
end;
$$;
reset role;
select notification_test.assert(not exists(select 1 from public.reminders where message='cross-user mutation'),'authenticated browser cannot modify cross-user reminders');
