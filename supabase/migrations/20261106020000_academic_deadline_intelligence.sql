-- Candidate only. Suggested timings are not consent; existing saved values survive.
begin;
create or replace function public.academic_default_preferences()returns jsonb language sql immutable set search_path='' as $$
 select '{"classAlertsEnabled":false,"assignmentAlertsEnabled":false,"examAlertsEnabled":false,"personalAlertsEnabled":false,"staleWarningEnabled":false,"includeOnlineClasses":false,"classOffsetMinutes":10,"assignmentOffsetsMinutes":[4320,1440],"examOffsetsMinutes":[1440,120],"personalOffsetsMinutes":[1440,120,30],"quietStart":"22:00","quietEnd":"07:00"}'::jsonb;
$$;

-- A refresh timestamp or unrelated transport payload is not a new deadline.
-- Planning and source invalidation share the same explicit notification facts.
create function public.academic_intelligence_deadline_source_facts(e public.source_events)returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',e.id,'userId',e.user_id,'sourceKey',e.source_key,'externalId',e.external_id,
 'eventType',e.event_type,'provider',e.provider,'moduleType',e.raw_json->>'module_type',
 'moodleCourseId',e.raw_json->>'moodle_course_id','moodleCmid',e.raw_json->>'moodle_cmid',
 'moodleAssignmentId',e.raw_json->>'moodle_assignment_id','moodleItemId',e.raw_json->>'moodle_item_id',
 'dueAt',extract(epoch from e.due_at),'closesAt',case when public.academic_valid_timestamp(e.raw_json->>'closes_at')then to_jsonb(extract(epoch from(e.raw_json->>'closes_at')::timestamptz))else e.raw_json->'closes_at'end,
 'submissionStatus',e.raw_json->>'submission_status',
 'score',e.raw_json->'score','maxScore',e.raw_json->'max_score','percentage',e.raw_json->'percentage',
 'relatedGradeExternalId',e.raw_json->'related_grade_external_id','parserWarnings',e.raw_json->'parser_warnings',
 'title',trim(e.title),'courseTitle',case when jsonb_typeof(e.raw_json->'course_title')='string'then to_jsonb(left(e.raw_json->>'course_title',500))else'null'::jsonb end,
 'sourceUrl',e.source_url,'status',e.status);
$$;

create function public.academic_intelligence_deadline_rows_for_id(p_user_id uuid,p_at timestamptz,p_reference uuid default null)returns setof jsonb
language sql stable set search_path='' as $$
 with eligible as(select e.*,case when e.raw_json->>'module_type'='quiz'then'quiz'else'assignment'end kind,
 public.academic_hash(public.academic_intelligence_deadline_source_facts(e))source_fingerprint,
 public.academic_intelligence_lms_status(p_user_id,p_at)lms,
 (select case when count(*)=1 then min(c.id::text)else null end from public.study_courses c where c.user_id=e.user_id and c.status='active'and c.external_course_key='moodle:'||(e.raw_json->>'moodle_course_id'))course_id
 from public.source_events e where e.user_id=p_user_id and(p_reference is null or e.id=p_reference)and e.source_key='university_platform'and e.event_type='task'and e.status='active'
 and e.title is not null and length(trim(e.title))between 1 and 500
 and e.raw_json->>'module_type'in('assign','quiz')and e.raw_json->>'moodle_course_id'~'^[1-9][0-9]{0,15}$'
 and(e.raw_json->>'moodle_cmid'~'^[1-9][0-9]{0,15}$'or(e.raw_json->>'module_type'='assign'and e.raw_json->>'moodle_assignment_id'~'^[1-9][0-9]{0,15}$'and e.external_id='assignment:moodle:'||(e.raw_json->>'moodle_course_id')||':'||(e.raw_json->>'moodle_assignment_id')))
 and e.due_at is not null and isfinite(e.due_at)and e.due_at>p_at and e.due_at<=p_at+interval'30 days'
 and e.raw_json->>'submission_status'='not_submitted'and jsonb_typeof(e.raw_json->'score')is distinct from'number'
 and jsonb_typeof(e.raw_json->'percentage')is distinct from'number'
 and coalesce(e.last_synced_at,e.updated_at,e.created_at)between p_at-interval'6 hours'and p_at+interval'5 minutes'
 and(e.raw_json->>'module_type'<>'quiz'or e.due_at=case when public.academic_valid_timestamp(e.raw_json->>'closes_at')then(e.raw_json->>'closes_at')::timestamptz end)
 and(not(e.raw_json?'parser_warnings')or jsonb_typeof(e.raw_json->'parser_warnings')='array')
 and not exists(select from jsonb_array_elements(case when jsonb_typeof(e.raw_json->'parser_warnings')='array'then e.raw_json->'parser_warnings'else'[]'::jsonb end)w
  where jsonb_typeof(w)is distinct from'string'or(w#>>'{}')in('previous_due_date_retained','previous_closes_at_retained','due_date_unknown','submission_status_unknown','activity_date_unrecognized'))
 and not exists(select from public.source_events g join public.academic_records a on a.user_id=g.user_id and a.source_event_id=g.id
  where g.user_id=e.user_id and g.external_id=e.raw_json->>'related_grade_external_id'and(a.score is not null or a.percentage is not null)))
 select jsonb_build_object('id',id,'key',kind||':'||public.academic_hash(to_jsonb(id)),'courseId',course_id,
 'courseTitle',case when jsonb_typeof(raw_json->'course_title')='string'then to_jsonb(left(raw_json->>'course_title',500))else'null'::jsonb end,
 'title',trim(title),'kind',kind,'dueAt',due_at,
 'sourceUrl',case when source_url='https://lms.astanait.edu.kz/mod/'||(case when kind='quiz'then'quiz'else'assign'end)||'/view.php?id='||(raw_json->>'moodle_cmid')then source_url else null end,
 'lastSuccessfulSyncAt',lms->'lastSuccessfulSyncAt',
 'fingerprint',source_fingerprint)
 from eligible where lms->'stale'='false'::jsonb order by due_at,id limit 101;
$$;

create function public.academic_intelligence_deadline_rows(p_user_id uuid,p_at timestamptz)returns setof jsonb
language sql stable set search_path='' as $$select *from public.academic_intelligence_deadline_rows_for_id(p_user_id,p_at);$$;

create or replace function public.academic_intelligence_deadlines(p_user_id uuid,p_at timestamptz)returns setof jsonb
language sql stable set search_path='' as $$select v-array['id','fingerprint']from public.academic_intelligence_deadline_rows(p_user_id,p_at)v limit 100;$$;

create function public.academic_intelligence_deadline_candidates_for_id(p_user_id uuid,p_at timestamptz,p_reference uuid default null)returns setof jsonb
language sql stable set search_path='' as $$
 with context as(select p.user_id,p.timezone,i.notification_revision revision,coalesce(a.revision,0)academic_revision,public.academic_intelligence_preferences_view(p.user_id)pref
 from public.profiles p join public.academic_intelligence_preferences i on i.user_id=p.user_id
 left join public.academic_notification_preferences a on a.user_id=p.user_id where p.user_id=p_user_id and p.status='active'
 and not public.academic_intelligence_quiet(p.user_id,p_at)),
 candidates as(select c.*,v,lead_time.value::text::int offset_minutes,(v->>'dueAt')::timestamptz target,
 (v->>'dueAt')::timestamptz-make_interval(mins=>lead_time.value::text::int)due
 from context c cross join lateral public.academic_intelligence_deadline_rows_for_id(p_user_id,p_at,p_reference)v
 cross join lateral jsonb_array_elements(case when v->>'kind'='quiz'then c.pref->'quizOffsetsMinutes'else c.pref->'assignmentOffsetsMinutes'end)lead_time(value)
 where c.pref->(case when v->>'kind'='quiz'then'quizAlertsEnabled'else'assignmentAlertsEnabled'end)='true'::jsonb)
 select jsonb_build_object('key','deadline:'||(v->>'id')||':'||offset_minutes||':'||public.academic_hash(to_jsonb(target)),
 'kind',v->>'kind','referenceKey',v->>'id','eventIds','[]'::jsonb,'courseId',v->'courseId','courseTitle',v->'courseTitle','title',v->'title',
 'sourceUrl',v->'sourceUrl','lastSuccessfulSyncAt',v->'lastSuccessfulSyncAt','offsetMinutes',offset_minutes,'timezone',timezone,
 'preferencesRevision',revision,'academicRevision',academic_revision,'dueAt',due,'targetAt',target,
 'fingerprint',public.academic_hash(jsonb_build_object('source',v->>'fingerprint','offset',offset_minutes,'preferencesRevision',revision,'academicRevision',academic_revision,'timezone',timezone)))
 from candidates where due<=p_at and p_at<least(target,due+interval'5 minutes')order by due,v->>'id',offset_minutes;
$$;

create function public.academic_intelligence_deadline_candidates(p_user_id uuid,p_at timestamptz)returns setof jsonb
language sql stable set search_path='' as $$select *from public.academic_intelligence_deadline_candidates_for_id(p_user_id,p_at)limit 5;$$;

-- One assignment route remains authoritative regardless of history/planner flags.
-- Only explicit quiz consent adds a V6 deadline job; policy CAS never changes its
-- notification revision or invalidates an unrelated prepared deadline.
create or replace function public.academic_intelligence_candidate_keys(p_user_id uuid,p_at timestamptz)
returns table(job_key text,kind text,reference_key text,due_at timestamptz,target_at timestamptz,source_fingerprint text)
language sql stable set search_path='' as $$
 select k.job_key,'grade',split_part(k.job_key,':',3),k.observed_at,k.observed_at+interval'24 hours',null::text
 from public.academic_intelligence_grade_group_keys(p_user_id,p_at)k
 union all select v->>'key','quiz',v->>'referenceKey',(v->>'dueAt')::timestamptz,(v->>'targetAt')::timestamptz,v->>'fingerprint'
 from public.academic_intelligence_deadline_candidates_for_id(p_user_id,p_at)v where v->>'kind'='quiz';
$$;
create or replace function public.academic_intelligence_candidate(p_user_id uuid,p_key text,p_at timestamptz)returns jsonb
language plpgsql stable set search_path='' as $$declare candidate jsonb;begin
 if p_key like'grade:%'then
  select v into candidate from public.academic_intelligence_grade_candidates_for_keys(p_user_id,p_at,array[p_key])v where v->>'key'=p_key;
 elsif p_key~'^deadline:[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}:[0-9]+:[a-f0-9]{64}$'then
  select v into candidate from public.academic_intelligence_deadline_candidates_for_id(p_user_id,p_at,split_part(p_key,':',2)::uuid)v where v->>'kind'='quiz'and v->>'key'=p_key;
 end if;
 return candidate;
end;$$;
create or replace function public.academic_intelligence_candidates(p_user_id uuid,p_at timestamptz)returns setof jsonb
language sql stable set search_path='' as $$
 select *from public.academic_intelligence_grade_candidates(p_user_id,p_at)
 union all select v from public.academic_intelligence_deadline_candidates(p_user_id,p_at)v where v->>'kind'='quiz'limit 10;
$$;

-- Notification selection is independent of the UI's history/completed-row cap.
-- For valid unchanged facts these are the exact58 binding, fingerprint and text;
-- only a noncanonical source URL is omitted and invalidates its old unsafe text.
create function public.academic_intelligence_legacy_assignment_candidates(p_user_id uuid,p_at timestamptz,p_reference uuid default null)
returns setof jsonb language sql stable set search_path='' as $$
 with context as(select p.user_id,p.timezone,a.preferences from public.profiles p join public.academic_notification_preferences a on a.user_id=p.user_id
 where p.user_id=p_user_id and p.status='active'and p.telegram_user_id is not null and exists(select from pg_catalog.pg_timezone_names where name=p.timezone)
 and a.preferences->'assignmentAlertsEnabled'='true'::jsonb and not public.academic_intelligence_quiet(p.user_id,p_at)),
 rows as(select c.*,v,e.id,e.due_at target,lead_time.position,lead_time.value::text::int offset_minutes,
 e.due_at-make_interval(mins=>lead_time.value::text::int)due,
 public.academic_hash(jsonb_build_object('id',e.id,'dueAt',e.due_at,'status',e.status,'module',e.raw_json->'module_type','title',left(trim(e.title),500),
 'courseTitle',e.raw_json->'course_title','sourceUrl',v->'sourceUrl','submission',e.raw_json->'submission_status','score',e.raw_json->'score','grade',e.raw_json->'related_grade_external_id','parserWarnings',e.raw_json->'parser_warnings'))fingerprint
 from context c cross join lateral public.academic_intelligence_deadline_rows_for_id(p_user_id,p_at,p_reference)v
 join public.source_events e on e.user_id=c.user_id and e.id=(v->>'id')::uuid
 cross join lateral jsonb_array_elements(c.preferences->'assignmentOffsetsMinutes')with ordinality lead_time(value,position)where v->>'kind'='assignment')
 select jsonb_build_object('kind','assignment','timezone',timezone,'referenceId',id,'referenceKey',v->>'key','offset',offset_minutes,
 'targetAt',target,'dueAt',due,'fingerprint',fingerprint,'message','⏰ Задание Moodle: '||(v->>'title')||E'\nКурс: '||coalesce(v->>'courseTitle','не указан')||E'\nСдать до: '||to_char(target at time zone timezone,'DD.MM.YYYY HH24:MI')||' ('||timezone||E')\nСтатус последней проверки: не сдано.'||case when v->>'sourceUrl'is not null then E'\n'||(v->>'sourceUrl')else''end)
 from rows where due<=p_at and p_at<least(target,due+interval'5 minutes')order by target,id,position;
$$;

-- Other established class/exam/stale-warning policy is inherited unchanged.
alter function public.academic_candidate_rows(uuid,timestamptz)rename to academic_candidate_rows_before_v6_deadlines;
create function public.academic_candidate_rows(p_user_id uuid,p_at timestamptz)returns setof jsonb language sql stable set search_path='' as $$
 with inherited as materialized(select v,ordinal from public.academic_candidate_rows_before_v6_deadlines(p_user_id,p_at)with ordinality t(v,ordinal)where v->>'kind'<>'assignment'),
 combined as(select v,case when v->>'kind'='lms_stale'then 2 else 0 end section,ordinal from inherited
 union all select v,1,ordinal from public.academic_intelligence_legacy_assignment_candidates(p_user_id,p_at)with ordinality t(v,ordinal))
 select v from combined order by section,ordinal;
$$;

-- Exact bound-assignment validation must not depend on a planning/UI page.
-- Lock the source BEFORE the reminder: source UPDATE already holds that row
-- when its cancellation trigger needs the reminder. The reverse order deadlocks.
alter function public.begin_notification_delivery(text,uuid,uuid,uuid)rename to begin_notification_delivery_before_v6_assignments;
create function public.begin_notification_delivery(p_kind text,p_user_id uuid,p_id uuid,p_claim_token uuid)returns bigint
language plpgsql security invoker set search_path='' as $$
declare j public.academic_notification_jobs;pref public.academic_notification_preferences;r public.reminders;c jsonb;tz text;valid boolean;begin
 if p_kind='reminder'then
  select timezone into tz from public.profiles where user_id=p_user_id and status='active'for update;if not found then return null;end if;
  select *into j from public.academic_notification_jobs where user_id=p_user_id and reminder_id=p_id and kind='assignment'for share;
  if found and not exists(select from public.academic_intelligence_jobs where user_id=p_user_id and reminder_id=p_id)then
   perform 1 from public.source_events where user_id=p_user_id and id=j.reference_id for share;
   perform 1 from public.user_lms_settings where user_id=p_user_id and platform_type='aitu_moodle'for share;
   select *into pref from public.academic_notification_preferences where user_id=p_user_id for share;
   select *into r from public.reminders where user_id=p_user_id and id=p_id for update;
   select v into c from public.academic_intelligence_legacy_assignment_candidates(p_user_id,clock_timestamp(),j.reference_id)v
   where v->>'referenceKey'=j.reference_key and(v->>'offset')::int=j.offset_minutes;
   valid:=coalesce(pref.revision=j.preferences_revision and tz=j.timezone and c is not null
   and c->>'fingerprint'=j.source_fingerprint and(c->>'dueAt')::timestamptz=j.due_at and(c->>'targetAt')::timestamptz=j.target_at
   and r.message=c->>'message'and r.metadata_json->'academic_room'is not distinct from coalesce(c->'room','null'::jsonb)
   and r.metadata_json->'academic_title'is not distinct from coalesce(c->'title','null'::jsonb)
   and(r.metadata_json->>'academic_start')::timestamptz=(c->>'targetAt')::timestamptz,false);
   if not valid then
    update public.reminders set status='cancelled',claim_token=null,lease_expires_at=null,claimed_at=null,last_error_code='academic_source_or_consent_changed'
    where id=p_id and user_id=p_user_id and claim_token=p_claim_token and status='processing';return null;
   end if;
   -- The same original DailyLife/active-recipient/token/lease/attempt boundary
   -- follows the exact academic validation, with no second queue or sender.
   return public.begin_notification_delivery_before_academic(p_kind,p_user_id,p_id,p_claim_token);
  end if;
 end if;
 return public.begin_notification_delivery_before_v6_assignments(p_kind,p_user_id,p_id,p_claim_token);
end;$$;
revoke all on function public.begin_notification_delivery(text,uuid,uuid,uuid),public.begin_notification_delivery_before_v6_assignments(text,uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.begin_notification_delivery(text,uuid,uuid,uuid),public.begin_notification_delivery_before_v6_assignments(text,uuid,uuid,uuid)to service_role;

alter function public.academic_intelligence_feed(uuid)rename to academic_intelligence_feed_before_deadlines;
create function public.academic_intelligence_feed(p_user_id uuid)returns jsonb language sql stable set search_path='' as $$
 select public.academic_intelligence_feed_before_deadlines(p_user_id)||jsonb_build_object('truncated',
 coalesce((public.academic_intelligence_feed_before_deadlines(p_user_id)->>'truncated')::boolean,false)
 or(select count(*)>100 from public.academic_intelligence_deadline_rows(p_user_id,clock_timestamp())));
$$;

create function public.cancel_changed_academic_intelligence_jobs()returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;reference text;begin
 if TG_TABLE_SCHEMA<>'public'or TG_TABLE_NAME not in('source_events','academic_intelligence_preferences','academic_notification_preferences','profiles')then raise exception'invalid_intelligence_trigger'using errcode='42501';end if;
 owner_id:=new.user_id;
 if TG_TABLE_NAME='source_events'then
  if public.academic_intelligence_deadline_source_facts(new)is not distinct from public.academic_intelligence_deadline_source_facts(old)then return new;end if;
  reference:=new.id::text;
  -- The same source facts fence the retained assignment planner. Harmless
  -- timestamp/transport refreshes returned above without touching claims.
  update public.reminders r set status='cancelled',claim_token=null,lease_expires_at=null,claimed_at=null,last_error_code='academic_source_or_consent_changed'
  from public.academic_notification_jobs j where j.user_id=owner_id and r.user_id=owner_id and r.id=j.reminder_id
  and j.kind='assignment'and j.reference_id=new.id and r.status in('pending','processing');
 end if;
 update public.reminders r set status='cancelled',claim_token=null,lease_expires_at=null,claimed_at=null,last_error_code='academic_source_or_consent_changed'
 from public.academic_intelligence_jobs j where j.user_id=owner_id and r.user_id=owner_id and r.id=j.reminder_id
 and r.status in('pending','processing')and(reference is null or j.reference_key=reference);
 return new;
end;$$;
create trigger intelligence_source_jobs after update on public.source_events for each row execute function public.cancel_changed_academic_intelligence_jobs();

do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and(p.proname like'academic_intelligence_%'or p.proname in('academic_candidate_rows','academic_candidate_rows_before_v6_deadlines','cancel_changed_academic_intelligence_jobs'))loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
end loop;end;$$;
commit;
