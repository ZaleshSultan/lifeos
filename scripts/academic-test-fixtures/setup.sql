-- Invented records in disposable PostgreSQL only. No credentials or private pack data.
create schema academic_test;
create table academic_test.assertions(name text primary key);
create function academic_test.assert(ok boolean,label text)returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Academic assertion failed: %',label;end if;
 insert into academic_test.assertions values(label);
end;$$;
create function academic_test.source(k text,kind text default'official_timetable')returns jsonb language sql as $$
 select jsonb_build_object('key',k,'kind',kind,'label','Synthetic reviewed document','sha256',repeat('a',64),'sourceUrl',null,'page',case when kind='owner_provided'then null else 9 end,'academicYear',case when kind='owner_provided'then null else'2026-2027'end,'groupCode',case when kind='owner_provided'then null else'TEST-100'end,'verifiedAt',clock_timestamp());
$$;
create function academic_test.event(k text,source_key text,kind text,title text,start_at timestamptz,end_at timestamptz default null)returns jsonb language sql as $$
 select jsonb_build_object('key',k,'sourceKey',source_key,'kind',kind,'title',title,
 'startsAt',case when start_at is null then null else to_char(start_at at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')end,
 'endsAt',case when end_at is null then null else to_char(end_at at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')end,
 'startsOn',null,'endsOn',null,'timezone','Asia/Almaty','location','Synthetic location','courseCode',case when kind='university_exam'then'SYN101'else null end,
 'sourceTypeCode',case when kind='university_exam'then'exam'else null end,'trimester',case when kind='university_exam'then 1 else null end,'periodType',null,'status',case when kind='personal_exam'then'proposed'else'confirmed'end);
$$;
create function academic_test.period(k text,kind text,term int,first_day date,last_day date,period_type text)returns jsonb language sql as $$
 select academic_test.event(k,'synthetic-calendar',kind,'Synthetic period '||k,null)||jsonb_build_object('startsOn',first_day,'endsOn',last_day,'trimester',term,'periodType',period_type);
$$;
create table academic_test.payloads(key text primary key,value jsonb);
create table academic_test.parallel_imports(worker int,result jsonb);
create table academic_test.parallel_plans(worker int,result jsonb);
create table academic_test.parallel_claims(worker int,id uuid,claim_token uuid);
grant usage on schema academic_test to service_role;
grant all on all tables in schema academic_test to service_role;
grant execute on all functions in schema academic_test to service_role;
insert into auth.users values('f0000000-0000-4000-8000-000000000001'),('f0000000-0000-4000-8000-000000000002'),('f0000000-0000-4000-8000-000000000003');
insert into public.profiles(user_id,status,role,telegram_user_id,timezone)values
 ('f0000000-0000-4000-8000-000000000001','active','user',700001,'Asia/Almaty'),
 ('f0000000-0000-4000-8000-000000000002','active','user',700002,'Asia/Almaty'),
 ('f0000000-0000-4000-8000-000000000003','blocked','user',700003,'Asia/Almaty');
insert into public.study_courses(id,user_id,code,title,status)values
 ('f1000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001','SYN101','Synthetic systems','active'),
 ('f1000000-0000-4000-8000-000000000002','f0000000-0000-4000-8000-000000000002','SYN101','Synthetic other owner systems','active');
insert into academic_test.payloads values('base',jsonb_build_object('requestId','synthetic-base-import','sources',jsonb_build_array(academic_test.source('synthetic-timetable'),academic_test.source('synthetic-owner','owner_provided'),academic_test.source('synthetic-calendar','official_calendar')),
 'events',jsonb_build_array(
 academic_test.event('base-exam','synthetic-timetable','university_exam','Synthetic university exam',((clock_timestamp()at time zone'Asia/Almaty')::date+30+time'10:00')at time zone'Asia/Almaty',((clock_timestamp()at time zone'Asia/Almaty')::date+30+time'11:00')at time zone'Asia/Almaty'),
 academic_test.event('base-personal','synthetic-owner','personal_exam','Synthetic personal examination',((clock_timestamp()at time zone'Asia/Almaty')::date+30+time'16:00')at time zone'Asia/Almaty'),
 academic_test.period('synthetic-teaching','calendar_period',1,(clock_timestamp()at time zone'Asia/Almaty')::date-1,(clock_timestamp()at time zone'Asia/Almaty')::date+60,'teaching'),
 academic_test.period('term1-registration','calendar_period',1,'2026-09-01','2026-09-07','registration'),
 academic_test.period('term2-registration','calendar_period',2,'2026-12-01','2026-12-07','registration'),
 academic_test.period('term3-registration','calendar_period',3,'2027-03-01','2027-03-07','registration'))));
insert into academic_test.payloads values('parallel',jsonb_build_object('sources',jsonb_build_array((select value->'sources'->0 from academic_test.payloads where key='base')),
 'events',jsonb_build_array(academic_test.event('parallel-placeholder','synthetic-timetable','university_exam','Synthetic concurrent exam',clock_timestamp()+interval'2 hours',clock_timestamp()+interval'3 hours'))));

set role service_role;
select academic_test.assert((public.academic_service('f0000000-0000-4000-8000-000000000001','overview')->'preferences'->>'revision')::int=0,'missing preferences revision zero');
select academic_test.assert((public.academic_service('f0000000-0000-4000-8000-000000000001','overview')->'preferences'->'classAlertsEnabled')='false','class default off');
select academic_test.assert((public.academic_service('f0000000-0000-4000-8000-000000000001','overview')->'preferences'->'examAlertsEnabled')='false','exam default off');
select academic_test.assert((public.academic_service('f0000000-0000-4000-8000-000000000001','overview')->'preferences'->'personalAlertsEnabled')='false','personal default off');
select academic_test.assert((public.academic_service('f0000000-0000-4000-8000-000000000001','import',(select value from academic_test.payloads where key='base'))->>'created')::int=6,'atomic initial import six synthetic events');
select academic_test.assert((select count(*)=0 from public.reminders),'import creates no reminders');
select academic_test.assert((public.plan_academic_notifications('f0000000-0000-4000-8000-000000000001')->>'queued')::int=0,'default-off plan zero notifications');
select academic_test.assert((public.academic_service('f0000000-0000-4000-8000-000000000001','import',(select value from academic_test.payloads where key='base'))->>'created')::int=6,'same request returns durable original receipt');
select academic_test.assert((select count(*)=6 from public.academic_events where user_id='f0000000-0000-4000-8000-000000000001'),'receipt replay creates no duplicates');
select academic_test.assert((select count(distinct(record->>'trimester'))=3 from public.academic_events where user_id='f0000000-0000-4000-8000-000000000001'and record->>'kind'='calendar_period'),'three trimester periods remain separate');
select academic_test.assert((select record->'endsAt'='null'and record->'courseCode'='null'and record->'sourceTypeCode'='null'and record->>'status'='proposed'from public.academic_events where user_id='f0000000-0000-4000-8000-000000000001'and event_key='base-personal'),'personal proposal has unknown end no institutional fields');
select academic_test.assert((select(record->>'startsAt')::timestamptz::date=(select(record->>'startsAt')::timestamptz::date from public.academic_events where user_id='f0000000-0000-4000-8000-000000000001'and event_key='base-exam')from public.academic_events where user_id='f0000000-0000-4000-8000-000000000001'and event_key='base-personal'),'university and personal examinations coexist on one day');

do $$declare payload jsonb;r jsonb;before_count int;event_id uuid;begin
 select value into payload from academic_test.payloads where key='base';
 select count(*)into before_count from public.academic_events;
 begin
  perform public.academic_service('f0000000-0000-4000-8000-000000000001','import',jsonb_set(jsonb_set(payload,'{requestId}','"synthetic-invalid-type"'),'{events,0,sourceTypeCode}','"examUnknown"'));
  raise exception 'invalid type unexpectedly accepted';
 exception when invalid_parameter_value then null;end;
 perform academic_test.assert((select count(*)=before_count from public.academic_events),'invalid manifest leaves all rows untouched');
 begin perform public.academic_service('f0000000-0000-4000-8000-000000000001','import',jsonb_set(payload,'{events,0,title}','"Changed request body"'));raise exception 'request collision accepted';exception when serialization_failure then null;end;
 perform academic_test.assert(true,'request reuse with changed payload conflicts');
 select id into event_id from public.academic_events where user_id='f0000000-0000-4000-8000-000000000001'and event_key='base-exam';
 begin perform public.academic_service('f0000000-0000-4000-8000-000000000002','revise_event',jsonb_build_object('id',event_id,'expectedRevision',1,'patch',jsonb_build_object('title','Wrong owner'),'confirmed',true));raise exception 'foreign edit accepted';exception when no_data_found then null;end;
 perform academic_test.assert(true,'foreign event mutation denied');
 perform public.academic_service('f0000000-0000-4000-8000-000000000001','revise_event',jsonb_build_object('id',event_id,'expectedRevision',1,'patch',jsonb_build_object('title','Synthetic manually edited exam'),'confirmed',true));
 perform academic_test.assert((select manually_edited and revision=2 and jsonb_array_length(history)=1 from public.academic_events where id=event_id),'revision append preserves complete earlier event');
 begin perform public.academic_service('f0000000-0000-4000-8000-000000000001','revise_event',jsonb_build_object('id',event_id,'expectedRevision',1,'patch',jsonb_build_object('title','Stale edit'),'confirmed',true));raise exception 'stale revision accepted';exception when serialization_failure then null;end;
 perform academic_test.assert(true,'stale per-event revision rejected');
 r:=public.academic_service('f0000000-0000-4000-8000-000000000001','import',jsonb_set(payload,'{requestId}','"synthetic-base-repeat"'));
 perform academic_test.assert((r->>'created')::int=0 and(select record->>'title'='Synthetic manually edited exam'from public.academic_events where id=event_id),'repeat import preserves owner override');
 payload:=jsonb_build_object('requestId','synthetic-cross-format','sources',jsonb_build_array(academic_test.source('different-file-source')),'events',jsonb_build_array((payload->'events'->0)||jsonb_build_object('key','different-ics-uid','sourceKey','different-file-source')));
 r:=public.academic_service('f0000000-0000-4000-8000-000000000001','import',payload);
 perform academic_test.assert((r->>'created')::int=0 and(r->>'unchanged')::int=1,'cross-format original identity reuses manually edited event');
 payload:=jsonb_set(payload,'{requestId}','"synthetic-room-conflict"');payload:=jsonb_set(payload,'{events,0,location}','"Different room"');
 r:=public.academic_service('f0000000-0000-4000-8000-000000000001','import',payload);
 perform academic_test.assert((r->>'created')::int=0 and jsonb_array_length(r->'conflicts')=1,'changed room under same natural identity conflicts not duplicates');
 begin perform public.academic_service('f0000000-0000-4000-8000-000000000003','overview');raise exception 'blocked owner accepted';exception when no_data_found then null;end;
 perform academic_test.assert(true,'blocked profile denied');
end;$$;
-- Explicit consent in an invented disposable owner only. A due exam is added by
-- eight concurrent import transactions after this setup.
select public.academic_service('f0000000-0000-4000-8000-000000000001','save_preferences',jsonb_build_object('expectedRevision',0,'preferences',public.academic_default_preferences()||'{"examAlertsEnabled":true,"quietStart":"00:00","quietEnd":"00:00"}'::jsonb));
reset role;
