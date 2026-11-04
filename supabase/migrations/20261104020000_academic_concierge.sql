-- Academic records and opt-in jobs extend the existing reminder delivery protocol.
-- This migration imports no personal records, opts nobody in and enqueues nothing.
begin;

create function public.academic_json_object(v jsonb,keys text[]) returns boolean
language sql immutable set search_path='' as $$
 select jsonb_typeof(v)='object' and not exists(select from jsonb_object_keys(case when jsonb_typeof(v)='object' then v else '{}'::jsonb end) k where not(k=any(keys)));
$$;
create function public.academic_object_length(v jsonb) returns integer language sql immutable set search_path='' as $$select count(*)::integer from jsonb_object_keys(v);$$;
create function public.academic_input_error() returns void language plpgsql immutable set search_path='' as $$
begin raise exception 'academic_invalid_input' using errcode='22023';end;$$;
create function public.academic_valid_date(v text) returns boolean language plpgsql immutable set search_path='' as $$
begin return v~'^(20[0-9]{2}|2100)-[0-9]{2}-[0-9]{2}$' and to_char(v::date,'YYYY-MM-DD')=v;
exception when others then return false;end;$$;
create function public.academic_valid_timestamp(v text) returns boolean language plpgsql immutable set search_path='' as $$
begin return v~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' and public.academic_valid_date(left(v,10)) and isfinite(v::timestamptz);
exception when others then return false;end;$$;
create function public.academic_hash(v jsonb) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(v::text,'UTF8')),'hex');
$$;
create function public.academic_validate_source(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text;begin
 if not coalesce(public.academic_json_object(v,array['key','kind','label','sha256','sourceUrl','page','academicYear','groupCode','verifiedAt']),false) or public.academic_object_length(v)<>9 then return false;end if;
 if jsonb_typeof(v->'key') is distinct from 'string' or (v->>'key')!~'^[A-Za-z0-9][A-Za-z0-9:_.-]{0,159}$' or jsonb_typeof(v->'kind')is distinct from'string' or(v->>'kind')not in('official_timetable','official_calendar','owner_provided') or jsonb_typeof(v->'sha256')is distinct from'string' or (v->>'sha256')!~'^[a-f0-9]{64}$' or not coalesce(public.academic_valid_timestamp(v->>'verifiedAt'),false) then return false;end if;
 for k in select unnest(array['label','sourceUrl','academicYear','groupCode'])loop
  if v->k='null'::jsonb and k<>'label' then continue;end if;
  if jsonb_typeof(v->k)is distinct from'string' or length(trim(v->>k))not between 1 and(case k when 'label'then 300 when'sourceUrl'then 1000 when'academicYear'then 9 else 40 end)then return false;end if;
 end loop;
 if v->'page'<>'null'::jsonb and (jsonb_typeof(v->'page')is distinct from'number' or (v->>'page')!~'^[0-9]{1,5}$' or (v->>'page')::int not between 1 and 10000)then return false;end if;
 if v->'academicYear'<>'null'::jsonb and(v->>'academicYear')!~'^20[0-9]{2}-20[0-9]{2}$' then return false;end if;
 if v->'sourceUrl'<>'null'::jsonb and(v->>'sourceUrl')!~'^https://(www\.)?astanait\.edu\.kz/[^?#[:space:]]*$'then return false;end if;
 return true;
exception when others then return false;end;$$;
create function public.academic_validate_event(v jsonb) returns boolean language plpgsql stable set search_path='' as $$
declare k text;timed boolean;begin
 if not coalesce(public.academic_json_object(v,array['key','sourceKey','kind','title','startsAt','endsAt','startsOn','endsOn','timezone','location','courseCode','sourceTypeCode','trimester','periodType','status']),false) or public.academic_object_length(v)<>15 then return false;end if;
 for k in select unnest(array['key','sourceKey'])loop if jsonb_typeof(v->k)is distinct from'string' or(v->>k)!~'^[A-Za-z0-9][A-Za-z0-9:_.-]{0,159}$'then return false;end if;end loop;
 if jsonb_typeof(v->'kind')is distinct from'string'or jsonb_typeof(v->'status')is distinct from'string'or(v->>'kind')not in('university_exam','personal_exam','calendar_period','holiday')or(v->>'status')not in('proposed','confirmed','cancelled')or jsonb_typeof(v->'timezone')is distinct from'string' or not exists(select from pg_catalog.pg_timezone_names where name=v->>'timezone')then return false;end if;
 for k in select unnest(array['title','location','courseCode','periodType'])loop
  if v->k='null'::jsonb and k<>'title'then continue;end if;
  if jsonb_typeof(v->k)is distinct from'string' or length(trim(v->>k))not between 1 and(case when k in('courseCode','periodType')then 100 else 500 end)then return false;end if;
 end loop;
 if v->>'kind'<>'personal_exam'and v->>'timezone'<>'Asia/Almaty'then return false;end if;
 timed:=(v->>'kind')in('university_exam','personal_exam');
 if timed then
  if not coalesce(public.academic_valid_timestamp(v->>'startsAt'),false)or v->'startsOn'<>'null'::jsonb or v->'endsOn'<>'null'::jsonb then return false;end if;
  if v->'endsAt'<>'null'::jsonb and(not coalesce(public.academic_valid_timestamp(v->>'endsAt'),false)or(v->>'endsAt')::timestamptz<=(v->>'startsAt')::timestamptz)then return false;end if;
 else
  if v->'startsAt'<>'null'::jsonb or v->'endsAt'<>'null'::jsonb or not coalesce(public.academic_valid_date(v->>'startsOn'),false)or not coalesce(public.academic_valid_date(v->>'endsOn'),false)or(v->>'endsOn')::date<(v->>'startsOn')::date then return false;end if;
 end if;
 if v->'sourceTypeCode'<>'null'::jsonb and(v->>'sourceTypeCode')not in('exam','examfx')then return false;end if;
 if v->>'kind'='personal_exam'and(v->'courseCode'<>'null'::jsonb or v->'sourceTypeCode'<>'null'::jsonb)then return false;end if;
 if v->>'kind'='university_exam'and(v->>'sourceTypeCode'not in('exam','examfx')or v->'sourceTypeCode'='null'::jsonb)then return false;end if;
 if v->'trimester'<>'null'::jsonb and v->'trimester'not in('1'::jsonb,'2'::jsonb,'3'::jsonb)then return false;end if;
 return true;
exception when others then return false;end;$$;
create function public.academic_event_identity(v jsonb) returns text language sql immutable set search_path='' as $$
 select public.academic_hash(jsonb_build_object('kind',v->>'kind','title',lower(regexp_replace(trim(v->>'title'),'[[:space:]]+',' ','g')),
 'start',case when v->>'kind'in('university_exam','personal_exam')then to_jsonb(extract(epoch from(v->>'startsAt')::timestamptz))else v->'startsOn'end,
 'endDate',case when v->>'kind'in('calendar_period','holiday')then v->'endsOn'else'null'::jsonb end,
 'type',v->'sourceTypeCode','period',case when v->>'kind'in('calendar_period','holiday')then v->'periodType'else'null'::jsonb end,'trimester',case when v->>'kind'in('calendar_period','holiday')then v->'trimester'else'null'::jsonb end));
$$;
create function public.academic_event_facts(v jsonb) returns jsonb language sql immutable set search_path='' as $$
 select (v-array['key','sourceKey','courseCode','timezone','status','title','startsAt','endsAt','periodType','trimester'])||jsonb_build_object('title',lower(regexp_replace(trim(v->>'title'),'[[:space:]]+',' ','g')),
 'startsAtEpoch',case when v->'startsAt'='null'::jsonb then null else extract(epoch from(v->>'startsAt')::timestamptz)end,
 'endsAtEpoch',case when v->'endsAt'='null'::jsonb then null else extract(epoch from(v->>'endsAt')::timestamptz)end,'periodType',case when v->>'kind'in('calendar_period','holiday')then v->'periodType'else'null'::jsonb end,'trimester',case when v->>'kind'in('calendar_period','holiday')then v->'trimester'else'null'::jsonb end);
$$;
create function public.academic_default_preferences() returns jsonb language sql immutable set search_path='' as $$
 select '{"classAlertsEnabled":false,"assignmentAlertsEnabled":false,"examAlertsEnabled":false,"personalAlertsEnabled":false,"staleWarningEnabled":false,"includeOnlineClasses":false,"classOffsetMinutes":10,"assignmentOffsetsMinutes":[1440,180,30],"examOffsetsMinutes":[1440,120],"personalOffsetsMinutes":[1440,120,30],"quietStart":"22:00","quietEnd":"07:00"}'::jsonb;
$$;
create function public.academic_validate_preferences(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text;a jsonb;begin
 if not coalesce(public.academic_json_object(v,array(select jsonb_object_keys(public.academic_default_preferences()))),false)or public.academic_object_length(v)<>12 then return false;end if;
 for k in select unnest(array['classAlertsEnabled','assignmentAlertsEnabled','examAlertsEnabled','personalAlertsEnabled','staleWarningEnabled','includeOnlineClasses'])loop if jsonb_typeof(v->k)is distinct from'boolean'then return false;end if;end loop;
 for k in select unnest(array['quietStart','quietEnd'])loop if jsonb_typeof(v->k)is distinct from'string'or(v->>k)!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'then return false;end if;end loop;
 if jsonb_typeof(v->'classOffsetMinutes')is distinct from'number'or(v->>'classOffsetMinutes')!~'^[0-9]{1,3}$'or(v->>'classOffsetMinutes')::int not between 1 and 120 then return false;end if;
 for k in select unnest(array['assignmentOffsetsMinutes','examOffsetsMinutes','personalOffsetsMinutes'])loop
  a:=v->k;if jsonb_typeof(a)is distinct from'array'or jsonb_array_length(a)not between 1 and 6 then return false;end if;
  if exists(select from jsonb_array_elements(a)x where jsonb_typeof(x)is distinct from'number'or x::text!~'^[0-9]{1,5}$')then return false;end if;
  if exists(select from jsonb_array_elements(a)x where x::text::int not between 1 and 10080)or(select count(*)<>count(distinct x)from jsonb_array_elements(a)x)then return false;end if;
 end loop;return true;
exception when others then return false;end;$$;

create table public.academic_sources(
 user_id uuid not null references auth.users(id)on delete cascade,source_key text not null,
 source_kind text not null check(source_kind in('official_timetable','official_calendar','owner_provided','verified_schedule')),
 source jsonb not null,revision integer not null default 1 check(revision>0),verification jsonb not null default'{}',updated_at timestamptz not null default clock_timestamp(),
 primary key(user_id,source_key),check(source_kind='verified_schedule'or public.academic_validate_source(source)),check(source->>'key'=source_key)
);
create table public.academic_events(
 id uuid not null unique default gen_random_uuid(),user_id uuid not null references auth.users(id)on delete cascade,
 event_key text not null,source_key text not null,record jsonb not null check(public.academic_validate_event(record)),original_record jsonb not null,
 revision integer not null default 1 check(revision>0),history jsonb not null default'[]'check(jsonb_typeof(history)='array'and jsonb_array_length(history)<=100),manually_edited boolean not null default false,updated_at timestamptz not null default clock_timestamp(),
 primary key(user_id,event_key),foreign key(user_id,source_key)references public.academic_sources(user_id,source_key),
 check(record->>'key'=event_key and record->>'sourceKey'=source_key)
);
create unique index academic_events_original_identity on public.academic_events(user_id,public.academic_event_identity(original_record));
create unique index academic_events_current_identity on public.academic_events(user_id,public.academic_event_identity(record));
create table public.academic_notification_preferences(
 user_id uuid primary key references auth.users(id)on delete cascade,preferences jsonb not null default public.academic_default_preferences()check(public.academic_validate_preferences(preferences)),
 revision integer not null default 0 check(revision>=0),import_receipts jsonb not null default'{}'check(jsonb_typeof(import_receipts)='object'),updated_at timestamptz not null default clock_timestamp()
);
create table public.academic_notification_jobs(
 user_id uuid not null references auth.users(id)on delete cascade,job_key text not null,reminder_id uuid not null unique references public.reminders(id)on delete cascade,
 kind text not null check(kind in('class','assignment','university_exam','personal_exam','lms_stale')),
 reference_id uuid,reference_key text not null,offset_minutes integer not null check(offset_minutes between 0 and 10080),
 preferences_revision integer not null,source_fingerprint text not null,timezone text not null,due_at timestamptz not null,target_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),
 primary key(user_id,job_key)
);
do $$declare t text;begin foreach t in array array['academic_sources','academic_events','academic_notification_preferences','academic_notification_jobs']loop
 execute format('alter table public.%I enable row level security',t);execute format('alter table public.%I force row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select,insert,update on public.%I to service_role',t);
 execute format('create policy %I on public.%I for select to authenticated using(public.lifeos_is_owner(user_id))',t||'_owner_read',t);
end loop;end;$$;

create function public.academic_schedule_hash(p_user_id uuid) returns text language sql stable set search_path='' as $$
 select public.academic_hash(coalesce(jsonb_agg(jsonb_build_object('course',jsonb_build_object('id',c.id,'code',c.code,'title',c.title,'startsOn',c.starts_on,'endsOn',c.ends_on),'slot',to_jsonb(s))order by s.id),'[]'::jsonb))
 from public.course_schedules s join public.study_courses c on c.id=s.study_course_id where c.user_id=p_user_id and c.status='active';
$$;
create function public.academic_schedule_verification(p_user_id uuid,p_at timestamptz)returns jsonb language sql stable set search_path='' as $$
 select case when s.user_id is null then jsonb_build_object('revision',0,'validFrom',null,'validThrough',null,'sourceLabel',null,'verifiedAt',null,'current',false,'changed',false)else
 jsonb_build_object('revision',s.revision,'validFrom',s.verification->'validFrom','validThrough',s.verification->'validThrough','sourceLabel',s.source->'label','verifiedAt',s.source->'verifiedAt',
 'changed',s.verification->>'signature'is distinct from public.academic_schedule_hash(p_user_id),
 'current',s.verification->>'signature'=public.academic_schedule_hash(p_user_id)and(p_at at time zone 'Asia/Almaty')::date between(s.verification->>'validFrom')::date and(s.verification->>'validThrough')::date)end
 from public.profiles p left join public.academic_sources s on s.user_id=p.user_id and s.source_key='__weekly_schedule' where p.user_id=p_user_id;
$$;
create function public.academic_lms_status(p_user_id uuid,p_at timestamptz)returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('configured',coalesce(s.is_active and s.is_token_valid and(s.auth_mode<>'session'or s.session_expires_at>p_at)and s.session_state in('connected','syncing','error'),false),
 'stale',s.user_id is null or s.last_sync_success_at is null or s.last_sync_success_at<p_at-interval'6 hours'or not coalesce(s.is_active and s.is_token_valid,false)or s.last_error_category is not null or(s.auth_mode='session'and(s.session_expires_at is null or s.session_expires_at<=p_at)),
 'lastSuccessfulSyncAt',s.last_sync_success_at,'state',coalesce(case when s.auth_mode='session'and(s.session_expires_at is null or s.session_expires_at<=p_at)then'session_expired'else s.session_state end,'not_configured'))
 from(select p_user_id user_id)x left join public.user_lms_settings s on s.user_id=x.user_id and s.platform_type='aitu_moodle';
$$;
create function public.academic_class_occurrences(p_user_id uuid,p_at timestamptz)returns setof jsonb language sql stable set search_path='' as $$
 with context as(select 'Asia/Almaty'::text timezone,public.academic_schedule_verification(p_user_id,p_at)v from public.profiles p where p.user_id=p_user_id and p.status='active'),
 days as(select d::date as occurrence_date,c.*from context c cross join lateral generate_series((p_at at time zone c.timezone)::date,least((p_at at time zone c.timezone)::date+14,(c.v->>'validThrough')::date),interval'1 day')d where c.v->'current'='true'),
 slots as(select s.id,c.code,left(c.title,500)title,left(s.room,500)room,s.session_type,d.occurrence_date,d.timezone,((d.occurrence_date+s.start_time)at time zone d.timezone)start_at,((d.occurrence_date+s.end_time)at time zone d.timezone)end_at,s.start_time
 from days d join public.study_courses c on c.user_id=p_user_id and c.status='active'and length(c.code)between 1 and 100 join public.course_schedules s on s.study_course_id=c.id
 where s.day_of_week=lower(to_char(d.occurrence_date,'FMDay'))and(c.starts_on is null or c.starts_on<=d.occurrence_date)and(c.ends_on is null or c.ends_on>=d.occurrence_date)
 and exists(select from public.academic_events a where a.user_id=p_user_id and a.record->>'kind'='calendar_period'and a.record->>'status'='confirmed'and a.record->>'periodType'='teaching'and d.occurrence_date between(a.record->>'startsOn')::date and(a.record->>'endsOn')::date)
 and not exists(select from public.academic_events a where a.user_id=p_user_id and a.record->>'kind'='holiday'and a.record->>'status'='confirmed'and d.occurrence_date between(a.record->>'startsOn')::date and(a.record->>'endsOn')::date))
 select jsonb_build_object('key','class:'||s.id||':'||s.occurrence_date,'id',s.id,'title',s.title,'startsAt',s.start_at,'endsAt',s.end_at,'location',s.room,'courseCode',s.code,'online',coalesce((coalesce(s.session_type,'')||' '||coalesce(s.room,''))~*'online|онлайн|remote|zoom|teams|https?://',false))from slots s
 where s.end_at>p_at and(s.start_at at time zone s.timezone)::time=s.start_time
 order by s.start_at,s.id limit 100;
$$;
create function public.academic_assignment_stale(e public.source_events,p_at timestamptz)returns boolean language sql stable set search_path='' as $$
 select coalesce((public.academic_lms_status(e.user_id,p_at)->>'stale')::boolean,true)
 or coalesce(e.last_synced_at,e.updated_at,e.created_at)<p_at-interval'6 hours'
 or coalesce(e.last_synced_at,e.updated_at,e.created_at)>p_at+interval'5 minutes'
 or(e.raw_json?'parser_warnings'and jsonb_typeof(e.raw_json->'parser_warnings')is distinct from'array')
 or exists(select from jsonb_array_elements(case when jsonb_typeof(e.raw_json->'parser_warnings')='array'then e.raw_json->'parser_warnings'else'[]'::jsonb end)w
 where jsonb_typeof(w)is distinct from'string'or(w#>>'{}')in('previous_due_date_retained','due_date_unknown'));
$$;
create function public.academic_assignment_rows(p_user_id uuid,p_at timestamptz)returns setof jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('key','assignment:'||public.academic_hash(to_jsonb(e.id)),'id',e.id,'title',left(trim(e.title),500),'courseTitle',case when jsonb_typeof(e.raw_json->'course_title')='string'then to_jsonb(left(e.raw_json->>'course_title',500))else'null'::jsonb end,'dueAt',e.due_at,
 'sourceUrl',case when e.source_url~'^https://lms\.astanait\.edu\.kz/mod/assign/view\.php\?id=[1-9][0-9]*$'then e.source_url else null end,
 'submissionState',case when jsonb_typeof(e.raw_json->'score')='number'then'graded'when e.raw_json->>'submission_status'in('not_submitted','overdue')then'not_submitted'when e.raw_json->>'submission_status'in('submitted','graded')then e.raw_json->>'submission_status'else'unknown'end,
 'verified',not public.academic_assignment_stale(e,p_at),'stale',public.academic_assignment_stale(e,p_at),'active',e.status='active',
 'fingerprint',public.academic_hash(jsonb_build_object('id',e.id,'dueAt',e.due_at,'status',e.status,'module',e.raw_json->'module_type','title',left(trim(e.title),500),'courseTitle',e.raw_json->'course_title','sourceUrl',e.source_url,'submission',e.raw_json->'submission_status','score',e.raw_json->'score','grade',e.raw_json->'related_grade_external_id','parserWarnings',e.raw_json->'parser_warnings')))
 from public.source_events e where e.user_id=p_user_id and e.title is not null and length(trim(e.title))>0 and e.source_key='university_platform'and e.event_type='task'
 and e.raw_json->>'module_type'='assign'and e.raw_json->>'moodle_course_id'~'^[1-9][0-9]*$'and(e.raw_json->>'moodle_cmid'~'^[1-9][0-9]*$'or(e.raw_json->>'moodle_assignment_id'~'^[1-9][0-9]*$'and e.external_id='assignment:moodle:'||(e.raw_json->>'moodle_course_id')||':'||(e.raw_json->>'moodle_assignment_id')))
 and e.due_at is not null and isfinite(e.due_at)and e.due_at>=p_at-interval'7 days'and e.due_at<=p_at+interval'30 days'
 order by e.due_at,e.id limit 100;
$$;
create function public.academic_overview(p_user_id uuid)returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('timezone',p.timezone,
 'sources',coalesce((select jsonb_agg(s.source||jsonb_build_object('revision',s.revision)order by s.source_key)from(select *from public.academic_sources where user_id=p_user_id and source_kind<>'verified_schedule'order by source_key limit 100)s),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(e.record||jsonb_build_object('id',e.id,'revision',e.revision,'manuallyEdited',e.manually_edited,'updatedAt',e.updated_at)order by coalesce(e.record->>'startsAt',e.record->>'startsOn'),e.event_key)from(select *from public.academic_events where user_id=p_user_id order by coalesce(record->>'startsAt',record->>'startsOn'),event_key limit 500)e),'[]'::jsonb),
 'preferences',coalesce(a.preferences,public.academic_default_preferences())||jsonb_build_object('revision',coalesce(a.revision,0)),
 'scheduleVerification',public.academic_schedule_verification(p_user_id,clock_timestamp()),'lms',public.academic_lms_status(p_user_id,clock_timestamp()),
 'classes',coalesce((select jsonb_agg(c-'id'-'online')from public.academic_class_occurrences(p_user_id,clock_timestamp())c),'[]'::jsonb),
 'assignments',coalesce((select jsonb_agg(c-'id'-'fingerprint'-'active')from public.academic_assignment_rows(p_user_id,clock_timestamp())c),'[]'::jsonb),
 'warnings',to_jsonb(array_remove(array[case when(public.academic_schedule_verification(p_user_id,clock_timestamp())->>'current')::boolean is not true then'academic_schedule_verification_required'end,case when(public.academic_lms_status(p_user_id,clock_timestamp())->>'stale')::boolean then'lms_stale_or_reconnect_required'end],null)),
 'truncated',(select count(*)>500 from public.academic_events where user_id=p_user_id)or(select count(*)>100 from public.academic_sources where user_id=p_user_id and source_kind<>'verified_schedule')or(select count(*)>=100 from public.academic_class_occurrences(p_user_id,clock_timestamp()))or(select count(*)>=100 from public.academic_assignment_rows(p_user_id,clock_timestamp())))
 from public.profiles p left join public.academic_notification_preferences a on a.user_id=p.user_id where p.user_id=p_user_id and p.status='active';
$$;

create function public.academic_service(p_user_id uuid,p_operation text,p_args jsonb default'{}')returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.profiles;pref public.academic_notification_preferences;source_row public.academic_sources;e public.academic_events;
 v jsonb;s jsonb;record_value jsonb;result jsonb;request_hash text;request_key text;created_count int:=0;unchanged_count int:=0;conflicts text[]:='{}';expected int;k text;patch jsonb;
begin
 if p_operation is null or p_operation not in('overview','save_preferences','import','revise_event','verify_schedule')or jsonb_typeof(p_args)is distinct from'object'then perform public.academic_input_error();end if;
 if p_operation='overview'then select *into p from public.profiles where user_id=p_user_id and status='active';else select *into p from public.profiles where user_id=p_user_id and status='active'for update;end if;
 if p.user_id is null then raise exception'academic_not_found'using errcode='P0002';end if;
 if not exists(select from pg_catalog.pg_timezone_names where name=p.timezone)then raise exception'academic_invalid_timezone'using errcode='22023';end if;
 if p_operation='overview'then return public.academic_overview(p_user_id);end if;
 insert into public.academic_notification_preferences(user_id)values(p_user_id)on conflict do nothing;
 select *into pref from public.academic_notification_preferences where user_id=p_user_id for update;
 if p_operation='save_preferences'then
  if not public.academic_json_object(p_args,array['expectedRevision','preferences'])or(p_args->>'expectedRevision')!~'^[0-9]{1,10}$'then perform public.academic_input_error();end if;
  expected:=(p_args->>'expectedRevision')::int;v:=p_args->'preferences';
  if not public.academic_validate_preferences(v)then perform public.academic_input_error();end if;
  if pref.revision<>expected then raise exception'academic_conflict'using errcode='40001';end if;
  if pref.preferences is distinct from v then update public.academic_notification_preferences set preferences=v,revision=revision+1,updated_at=clock_timestamp()where user_id=p_user_id;end if;
  return public.academic_overview(p_user_id);
 elsif p_operation='verify_schedule'then
  if not public.academic_json_object(p_args,array['expectedRevision','validFrom','validThrough','sourceLabel','confirmed'])or p_args->'confirmed'is distinct from'true'::jsonb or(p_args->>'expectedRevision')!~'^[0-9]{1,10}$'or not coalesce(public.academic_valid_date(p_args->>'validFrom'),false)or not coalesce(public.academic_valid_date(p_args->>'validThrough'),false)or jsonb_typeof(p_args->'sourceLabel')is distinct from'string'or length(trim(p_args->>'sourceLabel'))not between 1 and 300 then perform public.academic_input_error();end if;
  if(p_args->>'validThrough')::date<(p_args->>'validFrom')::date or(p_args->>'validThrough')::date-(p_args->>'validFrom')::date>180 then perform public.academic_input_error();end if;
  select *into source_row from public.academic_sources where user_id=p_user_id and source_key='__weekly_schedule'for update;
  if coalesce(source_row.revision,0)<>(p_args->>'expectedRevision')::int then raise exception'academic_conflict'using errcode='40001';end if;
  if not exists(select from public.course_schedules cs join public.study_courses c on c.id=cs.study_course_id where c.user_id=p_user_id and c.status='active')then raise exception'academic_schedule_empty'using errcode='22023';end if;
  insert into public.academic_sources(user_id,source_key,source_kind,source,verification)values(p_user_id,'__weekly_schedule','verified_schedule',jsonb_build_object('key','__weekly_schedule','label',p_args->>'sourceLabel','verifiedAt',clock_timestamp()),jsonb_build_object('validFrom',p_args->>'validFrom','validThrough',p_args->>'validThrough','signature',public.academic_schedule_hash(p_user_id),'timezone','Asia/Almaty'))
  on conflict(user_id,source_key)do update set source=excluded.source,verification=excluded.verification,revision=academic_sources.revision+1,updated_at=clock_timestamp();
  return public.academic_overview(p_user_id);
 elsif p_operation='revise_event'then
  if not public.academic_json_object(p_args,array['id','expectedRevision','patch','confirmed'])or p_args->'confirmed'is distinct from'true'::jsonb or(p_args->>'expectedRevision')!~'^[0-9]{1,10}$'or(p_args->>'id')!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'or not public.academic_json_object(p_args->'patch',array['title','startsAt','endsAt','location','status'])or p_args->'patch'='{}'::jsonb then perform public.academic_input_error();end if;
  select *into e from public.academic_events where user_id=p_user_id and id=(p_args->>'id')::uuid for update;
  if not found then raise exception'academic_not_found'using errcode='P0002';end if;
  if e.revision<>(p_args->>'expectedRevision')::int then raise exception'academic_conflict'using errcode='40001';end if;
  record_value:=e.record||(p_args->'patch');if not public.academic_validate_event(record_value)then perform public.academic_input_error();end if;
  if exists(select from public.academic_events other where other.user_id=p_user_id and other.id<>e.id and(public.academic_event_identity(other.record)=public.academic_event_identity(record_value)or public.academic_event_identity(other.original_record)=public.academic_event_identity(record_value)))then raise exception'academic_conflict'using errcode='40001';end if;
  if jsonb_array_length(e.history)>=100 then raise exception'academic_history_full'using errcode='22023';end if;
  update public.academic_events set history=history||jsonb_build_array(jsonb_build_object('revision',revision,'record',record,'changedAt',clock_timestamp())),record=record_value,revision=revision+1,manually_edited=true,updated_at=clock_timestamp()where user_id=p_user_id and id=e.id;
  return public.academic_overview(p_user_id);
 end if;
 -- All import inputs are validated before writes and the entire call is one transaction.
 if not public.academic_json_object(p_args,array['requestId','sources','events'])or(p_args->>'requestId')!~'^[A-Za-z0-9][A-Za-z0-9:_.-]{0,159}$'or jsonb_typeof(p_args->'sources')is distinct from'array'or jsonb_array_length(p_args->'sources')not between 1 and 100 or jsonb_typeof(p_args->'events')is distinct from'array'or jsonb_array_length(p_args->'events')not between 1 and 500 then perform public.academic_input_error();end if;
 request_key:=p_args->>'requestId';request_hash:=public.academic_hash(p_args-'requestId');
 if pref.import_receipts?request_key then
  if pref.import_receipts->request_key->>'hash'<>request_hash then raise exception'academic_conflict'using errcode='40001';end if;
  return(pref.import_receipts->request_key->'result')||jsonb_build_object('overview',public.academic_overview(p_user_id));
 end if;
 if public.academic_object_length(pref.import_receipts)>=256 then raise exception'academic_import_history_full'using errcode='22023';end if;
 if(select count(*)<>count(distinct x->>'key')from jsonb_array_elements(p_args->'sources')x)or(select count(*)<>count(distinct x->>'key')from jsonb_array_elements(p_args->'events')x)then perform public.academic_input_error();end if;
 for s in select x from jsonb_array_elements(p_args->'sources')x loop
  if not public.academic_validate_source(s)or(s->>'verifiedAt')::timestamptz>clock_timestamp()+interval'5 minutes'then perform public.academic_input_error();end if;
 end loop;
 for v in select x from jsonb_array_elements(p_args->'events')x loop
  if not public.academic_validate_event(v)or(v->>'kind'='personal_exam'and v->>'status'<>'proposed')then perform public.academic_input_error();end if;
  select x into s from jsonb_array_elements(p_args->'sources')x where x->>'key'=v->>'sourceKey';
  if s is null or(v->>'kind'='personal_exam'and s->>'kind'<>'owner_provided')or(v->>'kind'='university_exam'and s->>'kind'<>'official_timetable')or(v->>'kind'in('calendar_period','holiday')and s->>'kind'<>'official_calendar')then perform public.academic_input_error();end if;
  if v->'courseCode'<>'null'::jsonb and not exists(select from public.study_courses c where c.user_id=p_user_id and c.status='active'and c.code=v->>'courseCode')then raise exception'academic_course_not_found'using errcode='22023';end if;
 end loop;
 for s in select x from jsonb_array_elements(p_args->'sources')x order by x->>'key'loop
  select *into source_row from public.academic_sources where user_id=p_user_id and source_key=s->>'key'for update;
  if found and (source_row.source-'verifiedAt') is distinct from(s-'verifiedAt') then conflicts:=array_append(conflicts,'source:'||(s->>'key'));
  elsif not found then insert into public.academic_sources(user_id,source_key,source_kind,source)values(p_user_id,s->>'key',s->>'kind',s);end if;
 end loop;
 for v in select x from jsonb_array_elements(p_args->'events')x order by x->>'key'loop
  if ('source:'||(v->>'sourceKey'))=any(conflicts)then conflicts:=array_append(conflicts,v->>'key');continue;end if;
  select *into e from public.academic_events where user_id=p_user_id and event_key=v->>'key'for update;
  if not found then
   select *into e from public.academic_events where user_id=p_user_id and(public.academic_event_identity(original_record)=public.academic_event_identity(v)or public.academic_event_identity(record)=public.academic_event_identity(v))order by event_key limit 1 for update;
   if found then
    if public.academic_event_facts(e.original_record)=public.academic_event_facts(v)and(e.original_record->'courseCode'='null'::jsonb or v->'courseCode'='null'::jsonb or e.original_record->'courseCode'=v->'courseCode')then unchanged_count:=unchanged_count+1;else conflicts:=array_append(conflicts,v->>'key');end if;
   else insert into public.academic_events(user_id,event_key,source_key,record,original_record)values(p_user_id,v->>'key',v->>'sourceKey',v,v);created_count:=created_count+1;end if;
  elsif e.original_record=v then unchanged_count:=unchanged_count+1;
  else conflicts:=array_append(conflicts,v->>'key');end if;
 end loop;
 result:=jsonb_build_object('created',created_count,'unchanged',unchanged_count,'conflicts',to_jsonb(conflicts));
 update public.academic_notification_preferences set import_receipts=import_receipts||jsonb_build_object(request_key,jsonb_build_object('hash',request_hash,'result',result))where user_id=p_user_id;
 return result||jsonb_build_object('overview',public.academic_overview(p_user_id));
end;$$;

create function public.academic_candidate_rows(p_user_id uuid,p_at timestamptz)returns setof jsonb language plpgsql stable set search_path='' as $$
declare p public.profiles;pref public.academic_notification_preferences;v jsonb;e public.academic_events;o int;target timestamptz;due timestamptz;kind text;flag text;clock time;qstart time;qend time;body text;
begin
 select *into p from public.profiles where user_id=p_user_id and status='active'and telegram_user_id is not null;
 select *into pref from public.academic_notification_preferences where user_id=p_user_id;
 if p.user_id is null or pref.user_id is null or not exists(select from pg_catalog.pg_timezone_names where name=p.timezone)then return;end if;
 clock:=(p_at at time zone p.timezone)::time;qstart:=(pref.preferences->>'quietStart')::time;qend:=(pref.preferences->>'quietEnd')::time;
 if qstart<>qend and(case when qstart<qend then clock>=qstart and clock<qend else clock>=qstart or clock<qend end)then return;end if;
 if pref.preferences->'classAlertsEnabled'='true'::jsonb then
  for v in select *from public.academic_class_occurrences(p_user_id,p_at)loop
   if v->'online'='true'::jsonb and pref.preferences->'includeOnlineClasses'<>'true'::jsonb then continue;end if;
   target:=(v->>'startsAt')::timestamptz;o:=(pref.preferences->>'classOffsetMinutes')::int;due:=target-make_interval(mins=>o);
   if due<=p_at and p_at<least(target,due+interval'5 minutes')then
    return next jsonb_build_object('kind','class','timezone','Asia/Almaty','title',v->>'title','room',v->>'location','referenceId',v->>'id','referenceKey',v->>'key','offset',o,'targetAt',target,'dueAt',due,'fingerprint',public.academic_hash((v-array['startsAt','endsAt'])||jsonb_build_object('startsAtEpoch',extract(epoch from(v->>'startsAt')::timestamptz),'endsAtEpoch',extract(epoch from(v->>'endsAt')::timestamptz),'verification',public.academic_schedule_verification(p_user_id,p_at))),'message','📚 '||(v->>'title')||E'\nНачало: '||to_char(target at time zone 'Asia/Almaty','DD.MM.YYYY HH24:MI')||E' (Asia/Almaty)\nАудитория: '||coalesce(v->>'location','не подтверждена')||case when v->'online'='true'::jsonb then E'\nФормат: онлайн'else E'\nКарта: https://yuujiso.github.io/aitumap/'end);
   end if;
  end loop;
 end if;
 for e in select *from public.academic_events where user_id=p_user_id and record->>'status'='confirmed'and record->>'kind'in('university_exam','personal_exam')loop
  kind:=e.record->>'kind';flag:=case kind when'university_exam'then'examAlertsEnabled'else'personalAlertsEnabled'end;
  if pref.preferences->flag<>'true'::jsonb then continue;end if;
  target:=(e.record->>'startsAt')::timestamptz;
  for o in select x::text::int from jsonb_array_elements(pref.preferences->case kind when'university_exam'then'examOffsetsMinutes'else'personalOffsetsMinutes'end)x loop
   due:=target-make_interval(mins=>o);if due<=p_at and p_at<least(target,due+interval'5 minutes')then
    body:=case kind when'university_exam'then'🎓 Университетский экзамен: 'else'📝 Личный экзамен: 'end||(e.record->>'title')||E'\nНачало: '||to_char(target at time zone(e.record->>'timezone'),'DD.MM.YYYY HH24:MI')||' ('||(e.record->>'timezone')||E')\nМесто: '||coalesce(e.record->>'location','не подтверждено');
    if kind='university_exam'then body:=body||E'\nКод источника: '||(e.record->>'sourceTypeCode')||E'\nКарта: https://yuujiso.github.io/aitumap/';end if;
    return next jsonb_build_object('kind',kind,'timezone',e.record->>'timezone','title',e.record->>'title','room',case when kind='university_exam'then e.record->>'location'else null end,'sourceTypeCode',e.record->>'sourceTypeCode','referenceId',e.id,'referenceKey',e.event_key,'offset',o,'targetAt',target,'dueAt',due,'fingerprint',public.academic_hash(e.record||jsonb_build_object('revision',e.revision)),'message',body);
   end if;
  end loop;
 end loop;
 if pref.preferences->'assignmentAlertsEnabled'='true'::jsonb then
  for v in select *from public.academic_assignment_rows(p_user_id,p_at)loop
   if v->'stale'<>'false'::jsonb or v->>'submissionState'<>'not_submitted'or v->'active'<>'true'::jsonb then continue;end if;
   -- A linked real grade, including zero, is terminal even during a slow source refresh.
   if exists(select from public.academic_records a join public.source_events g on g.id=a.source_event_id and g.user_id=a.user_id join public.source_events task on task.user_id=a.user_id and task.raw_json->>'related_grade_external_id'=g.external_id where task.id=(v->>'id')::uuid and a.user_id=p_user_id and a.score is not null)then continue;end if;
   target:=(v->>'dueAt')::timestamptz;
   for o in select x::text::int from jsonb_array_elements(pref.preferences->'assignmentOffsetsMinutes')x loop
    due:=target-make_interval(mins=>o);if due<=p_at and p_at<least(target,due+interval'5 minutes')then
     return next jsonb_build_object('kind','assignment','timezone',p.timezone,'referenceId',v->>'id','referenceKey',v->>'key','offset',o,'targetAt',target,'dueAt',due,'fingerprint',v->>'fingerprint','message','⏰ Задание Moodle: '||(v->>'title')||E'\nКурс: '||coalesce(v->>'courseTitle','не указан')||E'\nСдать до: '||to_char(target at time zone p.timezone,'DD.MM.YYYY HH24:MI')||' ('||p.timezone||E')\nСтатус последней проверки: не сдано.'||case when v->>'sourceUrl'is not null then E'\n'||(v->>'sourceUrl')else''end);
    end if;
   end loop;
  end loop;
 end if;
 if pref.preferences->'staleWarningEnabled'='true'::jsonb and public.academic_lms_status(p_user_id,p_at)->'stale'='true'::jsonb then
  target:=p_at;due:=date_trunc('day',p_at at time zone p.timezone)at time zone p.timezone;
  return next jsonb_build_object('kind','lms_stale','timezone',p.timezone,'referenceId',null,'referenceKey','lms:'||(p_at at time zone p.timezone)::date,'offset',0,'targetAt',target,'dueAt',due,'fingerprint','lms_stale','message','⚠️ Данные LMS устарели или требуется повторное подключение. Отсутствие новых записей не означает отсутствие заданий. Проверь подключение в LifeOS → Учёба.');
 end if;
end;$$;

create function public.plan_academic_notifications(p_user_id uuid)returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.profiles;pref public.academic_notification_preferences;candidate jsonb;v_job public.academic_notification_jobs;v_reminder public.reminders;key text;rid uuid;queued int:=0;cancelled int:=0;
begin
 select *into p from public.profiles where user_id=p_user_id and status='active'for update;if not found then return jsonb_build_object('queued',0,'cancelled',0);end if;
 select *into pref from public.academic_notification_preferences where user_id=p_user_id for share;if not found then return jsonb_build_object('queued',0,'cancelled',0);end if;
 -- Cancel obsolete pending/prepared jobs without erasing any send/unknown receipt.
 update public.reminders queued_reminder set status='cancelled',claim_token=null,lease_expires_at=null,claimed_at=null,last_error_code='academic_source_or_consent_changed'
 from public.academic_notification_jobs bound_job where bound_job.user_id=p_user_id and queued_reminder.user_id=p_user_id and queued_reminder.id=bound_job.reminder_id and queued_reminder.status in('pending','processing')and not exists(select from public.academic_candidate_rows(p_user_id,clock_timestamp())eligible where eligible->>'kind'=bound_job.kind and eligible->>'referenceKey'=bound_job.reference_key and(eligible->>'offset')::int=bound_job.offset_minutes and eligible->>'fingerprint'=bound_job.source_fingerprint and bound_job.preferences_revision=pref.revision and bound_job.timezone=p.timezone and(bound_job.kind='lms_stale'or(eligible->>'dueAt')::timestamptz=bound_job.due_at));
 get diagnostics cancelled=row_count;
 for candidate in select *from public.academic_candidate_rows(p_user_id,clock_timestamp())limit 100 loop
  key:=(candidate->>'kind')||':'||(candidate->>'referenceKey')||':'||(candidate->>'offset');
  select *into v_job from public.academic_notification_jobs where user_id=p_user_id and job_key=key for update;
  if found then
   select *into v_reminder from public.reminders where user_id=p_user_id and id=v_job.reminder_id for update;
   if v_reminder.status<>'cancelled'or v_reminder.delivery_attempts<>0 or v_reminder.failure_count<>0 or(v_job.source_fingerprint=candidate->>'fingerprint'and v_job.preferences_revision=pref.revision and v_job.timezone=p.timezone)then continue;end if;
   update public.reminders set status='pending',message=candidate->>'message',remind_at=(candidate->>'dueAt')::timestamptz,next_attempt_at=null,claim_token=null,lease_expires_at=null,claimed_at=null,last_error_code=null,metadata_json=jsonb_build_object('academic_concierge_kind',candidate->>'kind','event_at',candidate->>'targetAt','title',candidate->>'message','academic_room',candidate->>'room','academic_title',candidate->>'title','academic_start',candidate->>'targetAt','academic_source_type',candidate->>'sourceTypeCode','academic_timezone',candidate->>'timezone')where id=v_reminder.id and user_id=p_user_id;
   update public.academic_notification_jobs set preferences_revision=pref.revision,source_fingerprint=candidate->>'fingerprint',timezone=p.timezone,due_at=(candidate->>'dueAt')::timestamptz,target_at=(candidate->>'targetAt')::timestamptz where user_id=p_user_id and job_key=key;
  else
   -- A matching legacy source reminder must not coexist at the same source/instant.
   if candidate->>'kind'='assignment'and exists(select from public.reminders old where old.user_id=p_user_id and old.source_event_id=(candidate->>'referenceId')::uuid and old.remind_at=(candidate->>'dueAt')::timestamptz and old.status in('sending','sent','unknown'))then continue;end if;
   if candidate->>'kind'='assignment'then update public.reminders old set status='cancelled',claim_token=null,lease_expires_at=null,claimed_at=null,last_error_code='academic_reconciled'where old.user_id=p_user_id and old.source_event_id=(candidate->>'referenceId')::uuid and old.remind_at=(candidate->>'dueAt')::timestamptz and old.status in('pending','processing')and old.delivery_attempts=0;end if;
   insert into public.reminders(user_id,channel,remind_at,message,metadata_json)values(p_user_id,'telegram',(candidate->>'dueAt')::timestamptz,candidate->>'message',jsonb_build_object('academic_concierge_kind',candidate->>'kind','event_at',candidate->>'targetAt','title',candidate->>'message','academic_room',candidate->>'room','academic_title',candidate->>'title','academic_start',candidate->>'targetAt','academic_source_type',candidate->>'sourceTypeCode','academic_timezone',candidate->>'timezone'))returning id into rid;
   insert into public.academic_notification_jobs(user_id,job_key,reminder_id,kind,reference_id,reference_key,offset_minutes,preferences_revision,source_fingerprint,timezone,due_at,target_at)values(p_user_id,key,rid,candidate->>'kind',(candidate->>'referenceId')::uuid,candidate->>'referenceKey',(candidate->>'offset')::int,pref.revision,candidate->>'fingerprint',p.timezone,(candidate->>'dueAt')::timestamptz,(candidate->>'targetAt')::timestamptz);
  end if;queued:=queued+1;
 end loop;return jsonb_build_object('queued',queued,'cancelled',cancelled);
end;$$;

alter function public.begin_notification_delivery(text,uuid,uuid,uuid)rename to begin_notification_delivery_before_academic;
create function public.begin_notification_delivery(p_kind text,p_user_id uuid,p_id uuid,p_claim_token uuid)returns bigint language plpgsql security invoker set search_path='' as $$
declare j public.academic_notification_jobs;pref public.academic_notification_preferences;tz text;valid boolean:=false;
begin
 select timezone into tz from public.profiles where user_id=p_user_id and status='active'for update;if not found then return null;end if;
 if p_kind='reminder'then
  select *into j from public.academic_notification_jobs where user_id=p_user_id and reminder_id=p_id for share;
  if found then
   select *into pref from public.academic_notification_preferences where user_id=p_user_id for share;
   if j.kind in('university_exam','personal_exam')then perform 1 from public.academic_events where user_id=p_user_id and id=j.reference_id for share;
   elsif j.kind='assignment'then perform 1 from public.source_events where user_id=p_user_id and id=j.reference_id for share;perform 1 from public.user_lms_settings where user_id=p_user_id and platform_type='aitu_moodle'for share;
   elsif j.kind='class'then perform 1 from public.academic_sources where user_id=p_user_id and source_key='__weekly_schedule'for share;perform 1 from public.course_schedules s join public.study_courses c on c.id=s.study_course_id where s.id=j.reference_id and c.user_id=p_user_id for share of s,c;end if;
   valid:=pref.revision=j.preferences_revision and tz=j.timezone and exists(select from public.academic_candidate_rows(p_user_id,clock_timestamp())v join public.reminders delivered on delivered.id=p_id and delivered.user_id=p_user_id where delivered.message=v->>'message'and delivered.metadata_json->'academic_room'is not distinct from coalesce(v->'room','null'::jsonb)and delivered.metadata_json->'academic_title'is not distinct from coalesce(v->'title','null'::jsonb)and(j.kind='lms_stale'or(delivered.metadata_json->>'academic_start')::timestamptz=(v->>'targetAt')::timestamptz)and v->>'kind'=j.kind and v->>'referenceKey'=j.reference_key and(v->>'offset')::int=j.offset_minutes and v->>'fingerprint'=j.source_fingerprint and(j.kind='lms_stale'or((v->>'dueAt')::timestamptz=j.due_at and(v->>'targetAt')::timestamptz=j.target_at)));
   if not coalesce(valid,false)then
    update public.reminders set status='cancelled',claim_token=null,lease_expires_at=null,claimed_at=null,last_error_code='academic_source_or_consent_changed'where id=p_id and user_id=p_user_id and claim_token=p_claim_token and status='processing';return null;
   end if;
  elsif exists(select from public.reminders r left join public.source_events e on e.id=r.source_event_id and e.user_id=r.user_id where r.id=p_id and r.user_id=p_user_id and(r.metadata_json?'academic_concierge_kind'or(e.source_key='university_platform'and e.event_type='task'and r.metadata_json->>'provider'='university_platform')))then
   update public.reminders set status='cancelled',claim_token=null,lease_expires_at=null,claimed_at=null,last_error_code='academic_binding_required'where id=p_id and user_id=p_user_id and claim_token=p_claim_token and status='processing';return null;
  end if;
 end if;
 return public.begin_notification_delivery_before_academic(p_kind,p_user_id,p_id,p_claim_token);
end;$$;
create function public.cancel_changed_academic_notifications()returns trigger language plpgsql security definer set search_path='' as $$
declare u uuid;reference uuid;begin
 if TG_TABLE_SCHEMA<>'public'or TG_TABLE_NAME not in('profiles','academic_notification_preferences','academic_events','academic_sources')then raise exception using errcode='42501',message='invalid_notification_trigger';end if;
 if TG_TABLE_NAME='profiles'then if new.timezone is not distinct from old.timezone then return new;end if;u:=new.user_id;
 elsif TG_TABLE_NAME='academic_notification_preferences'then if new.preferences is not distinct from old.preferences and new.revision is not distinct from old.revision then return new;end if;u:=new.user_id;
 else u:=new.user_id;if TG_TABLE_NAME='academic_events'then reference:=new.id;end if;end if;
 update public.reminders r set status='cancelled',claim_token=null,lease_expires_at=null,claimed_at=null,last_error_code='academic_source_or_consent_changed'from public.academic_notification_jobs j where j.user_id=u and r.user_id=u and r.id=j.reminder_id and r.status in('pending','processing')and(case when TG_TABLE_NAME='academic_events'then j.reference_id=reference when TG_TABLE_NAME='academic_sources'then j.kind='class'else true end);return new;
end;$$;
create trigger academic_preferences_cancel_jobs after update on public.academic_notification_preferences for each row execute function public.cancel_changed_academic_notifications();
create trigger academic_events_cancel_jobs after update on public.academic_events for each row execute function public.cancel_changed_academic_notifications();
create trigger academic_sources_cancel_jobs after update on public.academic_sources for each row execute function public.cancel_changed_academic_notifications();
create trigger academic_timezone_cancel_jobs after update of timezone on public.profiles for each row execute function public.cancel_changed_academic_notifications();

do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and(p.proname like'academic_%'or p.proname in('plan_academic_notifications','cancel_changed_academic_notifications','begin_notification_delivery','begin_notification_delivery_before_academic'))loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
end loop;end;$$;
commit;
