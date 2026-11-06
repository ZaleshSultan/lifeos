-- Candidate only: verified, owner-scoped grade history and explicit consent.
-- No private import, notification opt-in, provider call or receipt deletion.
begin;

create table public.academic_intelligence_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 grade_alerts_enabled boolean not null default false,
 grade_consent_revision integer not null default 0 check(grade_consent_revision>=0),
 quiz_alerts_enabled boolean not null default false,
 quiz_offsets_minutes jsonb not null default '[4320,1440]',
 course_reviews jsonb not null default '{}' check(jsonb_typeof(course_reviews)='object'),
 revision integer not null default 0 check(revision>=0),updated_at timestamptz not null default clock_timestamp()
);
create table public.academic_grade_sync_state (
 user_id uuid primary key references auth.users(id)on delete cascade,
 complete_baseline boolean not null default false,last_verified_at timestamptz not null,
 last_run_id uuid not null references public.sync_runs(id)
);
create table public.academic_grade_observations (
 user_id uuid not null references auth.users(id)on delete cascade,
 moodle_course_id text not null,moodle_item_id text not null,
 course_title text not null,item_title text not null,score numeric,max_score numeric,
 revision integer not null default 1 check(revision>0),source_url text,
 first_verified_at timestamptz not null,last_verified_at timestamptz not null,
 last_run_id uuid not null references public.sync_runs(id),
 primary key(user_id,moodle_course_id,moodle_item_id),
 check(moodle_course_id~'^[1-9][0-9]{0,15}$'),
 check(moodle_item_id~'^([1-9][0-9]{0,15}|mod-[a-z][a-z0-9_]*-[1-9][0-9]{0,15})$'),
 check(score is null or(score>=0 and score<'Infinity'::numeric)),
 check(max_score is null or(max_score>=0 and max_score<'Infinity'::numeric))
);
create table public.academic_grade_events (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id)on delete cascade,
 moodle_course_id text not null,moodle_item_id text not null,revision integer not null,
 kind text not null check(kind in('posted','corrected')),
 course_title text not null,item_title text not null,old_score numeric,old_max_score numeric,
 new_score numeric not null,new_max_score numeric,source_url text,observed_at timestamptz not null,
 sync_run_id uuid not null references public.sync_runs(id),consent_revision integer,
 unique(user_id,moodle_course_id,moodle_item_id,revision),
 foreign key(user_id,moodle_course_id,moodle_item_id)references public.academic_grade_observations(user_id,moodle_course_id,moodle_item_id),
 check(new_score>=0 and new_score<'Infinity'::numeric),
 check(new_max_score is null or(new_max_score>=0 and new_max_score<'Infinity'::numeric))
);
create index academic_grade_events_owner_recent on public.academic_grade_events(user_id,observed_at desc,id);
-- Immutable verified fetch outbox: staged before any source writes/run success.
-- Failed runs remain nonpublishable; successful runs drain in observation order.
create table public.academic_grade_pending_snapshots (
 user_id uuid not null references auth.users(id)on delete cascade,
 run_id uuid not null references public.sync_runs(id),inventory_complete boolean not null,
 records jsonb check(records is null or(jsonb_typeof(records)='array'and jsonb_array_length(records)<=2000 and octet_length(records::text)<=2097152)),
 fingerprint text not null,observed_at timestamptz not null default clock_timestamp(),consent_revision integer,
 primary key(user_id,run_id)
);
create table public.academic_grade_sync_receipts (
 user_id uuid not null references auth.users(id)on delete cascade,run_id uuid not null references public.sync_runs(id),
 fingerprint text not null,result jsonb not null,primary key(user_id,run_id)
);
create table public.academic_intelligence_jobs (
 user_id uuid not null references auth.users(id)on delete cascade,job_key text not null,
 reminder_id uuid not null unique references public.reminders(id),
 kind text not null check(kind in('grade','assignment','quiz')),reference_key text not null,
 event_ids uuid[] not null default '{}',source_fingerprint text not null,render_fingerprint text not null,
 preferences_revision integer not null,academic_revision integer not null,
 due_at timestamptz not null,target_at timestamptz not null,
 primary key(user_id,job_key)
);
do $$declare t text;begin
 foreach t in array array['academic_intelligence_preferences','academic_grade_sync_state','academic_grade_observations','academic_grade_events','academic_grade_pending_snapshots','academic_grade_sync_receipts','academic_intelligence_jobs']loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select,insert,update on public.%I to service_role',t);
  execute format('create policy %I on public.%I for select to authenticated using(public.lifeos_is_owner(user_id))',t||'_owner_read',t);
 end loop;
end;$$;
-- History and run receipts are append-only, including for application service callers.
revoke update on public.academic_grade_events,public.academic_grade_pending_snapshots,public.academic_grade_sync_receipts from service_role;

-- Only consumed payloads may be cleared. Identity/hash/receipt rows are kept.
-- Column-only privilege plus this trigger also guards direct service-role SQL.
grant update(records)on public.academic_grade_pending_snapshots to service_role;
create function public.academic_intelligence_guard_stage_consumption()returns trigger
language plpgsql security invoker set search_path='' as $$begin
 if TG_TABLE_SCHEMA<>'public'or TG_TABLE_NAME<>'academic_grade_pending_snapshots'or TG_OP<>'UPDATE'
 or new.records is not null or old.records is null or(to_jsonb(new)-'records')is distinct from(to_jsonb(old)-'records')
 or not exists(select from public.academic_grade_sync_receipts r where r.user_id=old.user_id and r.run_id=old.run_id and r.fingerprint=old.fingerprint)
 then raise exception'grade_stage_immutable'using errcode='42501';end if;return new;
end;$$;
create trigger grade_stage_consumption before update on public.academic_grade_pending_snapshots for each row execute function public.academic_intelligence_guard_stage_consumption();
create function public.academic_intelligence_consume_grade_snapshot(p_user_id uuid,p_run_id uuid,p_fingerprint text)returns void
language plpgsql security invoker set search_path='' as $$begin
 update public.academic_grade_pending_snapshots q set records=null where q.user_id=p_user_id and q.run_id=p_run_id and q.fingerprint=p_fingerprint and q.records is not null
 and exists(select from public.academic_grade_sync_receipts r where r.user_id=q.user_id and r.run_id=q.run_id and r.fingerprint=q.fingerprint);
 if not found then raise exception'grade_stage_consumption_conflict'using errcode='40001';end if;
end;$$;

create function public.academic_intelligence_preferences_view(p_user_id uuid)returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('revision',coalesce(i.revision,0),'academicRevision',coalesce(a.revision,0),
 'gradeAlertsEnabled',coalesce(i.grade_alerts_enabled,false),'quizAlertsEnabled',coalesce(i.quiz_alerts_enabled,false),
 'assignmentAlertsEnabled',coalesce(a.preferences,public.academic_default_preferences())->'assignmentAlertsEnabled',
 'assignmentOffsetsMinutes',coalesce(a.preferences,public.academic_default_preferences())->'assignmentOffsetsMinutes',
 'quizOffsetsMinutes',coalesce(i.quiz_offsets_minutes,'[4320,1440]'::jsonb),
 'quietStart',coalesce(a.preferences,public.academic_default_preferences())->'quietStart',
 'quietEnd',coalesce(a.preferences,public.academic_default_preferences())->'quietEnd',
 'courseReviews',coalesce(i.course_reviews,'{}'::jsonb))
 from public.profiles p left join public.academic_intelligence_preferences i on i.user_id=p.user_id
 left join public.academic_notification_preferences a on a.user_id=p.user_id where p.user_id=p_user_id and p.status='active';
$$;

create function public.academic_intelligence_validate_grade_snapshot(p_complete boolean,p_records jsonb)returns void
language plpgsql immutable set search_path='' as $$declare v jsonb;score numeric;maximum numeric;begin
 if p_complete is null or jsonb_typeof(p_records)is distinct from'array'or jsonb_array_length(p_records)>2000
 or octet_length(p_records::text)>2097152 then raise exception'grade_snapshot_invalid'using errcode='22023';end if;
 if exists(select from jsonb_array_elements(p_records)t(v)group by t.v->>'courseId',t.v->>'itemId'having count(*)>1)then raise exception'grade_identity_ambiguous'using errcode='22023';end if;
 for v in select *from jsonb_array_elements(p_records)loop
  if jsonb_typeof(v)is distinct from'object'or not public.academic_json_object(v,array['courseId','itemId','courseTitle','itemTitle','score','maxScore','sourceUrl'])
   or public.academic_object_length(v)<>7 or coalesce(v->>'courseId','')!~'^[1-9][0-9]{0,15}$'
   or coalesce(v->>'itemId','')!~'^([1-9][0-9]{0,15}|mod-[a-z][a-z0-9_]*-[1-9][0-9]{0,15})$'
   or jsonb_typeof(v->'courseTitle')is distinct from'string'or length(trim(v->>'courseTitle'))not between 1 and 500
   or jsonb_typeof(v->'itemTitle')is distinct from'string'or length(trim(v->>'itemTitle'))not between 1 and 500
   or(v->'score'<>'null'::jsonb and jsonb_typeof(v->'score')is distinct from'number')
   or(v->'maxScore'<>'null'::jsonb and jsonb_typeof(v->'maxScore')is distinct from'number')
   or(v->'sourceUrl'<>'null'::jsonb and(v->>'sourceUrl')!~'^https://lms\.astanait\.edu\.kz/(course/view|mod/(assign|quiz)/view)\.php\?id=[1-9][0-9]{0,15}$')
  then raise exception'grade_snapshot_invalid'using errcode='22023';end if;
  score:=(v->>'score')::numeric;maximum:=nullif((v->>'maxScore')::numeric,0);
  if score<0 or score>='Infinity'::numeric or maximum<0 or maximum>='Infinity'::numeric then raise exception'grade_snapshot_invalid'using errcode='22023';end if;
 end loop;
end;$$;

create function public.stage_moodle_grade_snapshot(p_user_id uuid,p_run_id uuid,p_lease_owner uuid,p_complete boolean,p_records jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare digest text;prior public.academic_grade_pending_snapshots;at_time timestamptz;begin
 perform public.academic_intelligence_validate_grade_snapshot(p_complete,p_records);
 perform 1 from public.profiles where user_id=p_user_id and status='active'for update;
 if not found then raise exception'grade_owner_inactive'using errcode='42501';end if;
 at_time:=clock_timestamp();
 perform 1 from public.lms_sync_leases where user_id=p_user_id and platform_type='aitu_moodle'and owner=p_lease_owner and expires_at>at_time for share;
 if not found then raise exception'grade_lease_lost'using errcode='42501';end if;
 -- Fetch just authenticated under this shared lease; stale prior is_token_valid
 -- must not prevent recovery. Session expiry/revocation remains authoritative.
 perform 1 from public.user_lms_settings where user_id=p_user_id and platform_type='aitu_moodle'and is_active
 and(auth_mode<>'session'or(session_expires_at>at_time and sso_cookie_encrypted is not null and session_state in('connected','syncing','error')))for share;
 if not found then raise exception'grade_source_unauthorized'using errcode='42501';end if;
 perform 1 from public.sync_runs where id=p_run_id and user_id=p_user_id and source_key='university_platform'and status='running'for share;
 if not found then raise exception'grade_sync_not_running'using errcode='42501';end if;
 digest:=public.academic_hash(jsonb_build_object('complete',p_complete,'records',p_records));
 select *into prior from public.academic_grade_pending_snapshots where user_id=p_user_id and run_id=p_run_id;
 if found then if prior.fingerprint<>digest then raise exception'grade_run_conflict'using errcode='40001';end if;return true;end if;
 insert into public.academic_grade_pending_snapshots(user_id,run_id,inventory_complete,records,fingerprint,observed_at,consent_revision)
 select p_user_id,p_run_id,p_complete,p_records,digest,at_time,case when i.grade_alerts_enabled then i.grade_consent_revision else null end
 from public.profiles p left join public.academic_intelligence_preferences i on i.user_id=p.user_id where p.user_id=p_user_id;
 if not exists(select from public.lms_sync_leases where user_id=p_user_id and platform_type='aitu_moodle'and owner=p_lease_owner and expires_at>clock_timestamp())then raise exception'grade_lease_lost'using errcode='42501';end if;
 return true;
end;$$;

create function public.capture_moodle_grade_snapshot(p_user_id uuid,p_run_id uuid,p_lease_owner uuid,p_complete boolean,p_records jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior public.academic_grade_observations;s public.academic_grade_sync_state;r public.academic_grade_sync_receipts;
 pending public.academic_grade_pending_snapshots;v jsonb;score numeric;maximum numeric;changed boolean;known boolean;baseline boolean;
 digest text;created_count int:=0;seen_count int:=0;revision int;at_time timestamptz:=clock_timestamp();result jsonb;
begin
 if p_complete is null or jsonb_typeof(p_records)is distinct from'array'or jsonb_array_length(p_records)>2000
 or octet_length(p_records::text)>2097152 then raise exception'grade_snapshot_invalid'using errcode='22023';end if;
 perform 1 from public.profiles where user_id=p_user_id and status='active'for update;
 if not found then raise exception'grade_owner_inactive'using errcode='42501';end if;
 at_time:=clock_timestamp();
 perform 1 from public.lms_sync_leases where user_id=p_user_id and platform_type='aitu_moodle'and owner=p_lease_owner and expires_at>at_time for share;
 if not found then raise exception'grade_lease_lost'using errcode='42501';end if;
 perform 1 from public.user_lms_settings where user_id=p_user_id and platform_type='aitu_moodle'and is_active and is_token_valid
 and(auth_mode<>'session'or(session_expires_at>at_time and session_state in('connected','syncing','error')))for share;
 if not found then raise exception'grade_source_unauthorized'using errcode='42501';end if;
 perform 1 from public.sync_runs where id=p_run_id and user_id=p_user_id and source_key='university_platform'and status='success'
 and metadata_json->'moodle_grades_synced'='true'::jsonb
 and metadata_json->'moodle_grade_inventory_complete'=to_jsonb(p_complete)
 and finished_at<=at_time+interval'5 minutes'for share;
 if not found then raise exception'grade_sync_not_verified'using errcode='42501';end if;
 digest:=public.academic_hash(jsonb_build_object('complete',p_complete,'records',p_records));
 select *into r from public.academic_grade_sync_receipts where user_id=p_user_id and run_id=p_run_id;
 if found then if r.fingerprint<>digest then raise exception'grade_run_conflict'using errcode='40001';end if;return r.result;end if;
 select *into pending from public.academic_grade_pending_snapshots where user_id=p_user_id and run_id=p_run_id;
 if not found or pending.fingerprint<>digest then raise exception'grade_snapshot_not_staged'using errcode='42501';end if;
 if exists(select from public.academic_grade_pending_snapshots q join public.sync_runs history_run on history_run.id=q.run_id and history_run.user_id=q.user_id and history_run.status='success'
 where q.user_id=p_user_id and(q.observed_at,q.run_id)<(pending.observed_at,pending.run_id)
 and not exists(select from public.academic_grade_sync_receipts x where x.user_id=q.user_id and x.run_id=q.run_id))then raise exception'grade_prior_snapshot_pending'using errcode='40001';end if;
 at_time:=pending.observed_at;

 if exists(select from jsonb_array_elements(p_records)item_record(value) group by item_record.value->>'courseId',item_record.value->>'itemId'having count(*)>1)then raise exception'grade_identity_ambiguous'using errcode='22023';end if;
 select *into s from public.academic_grade_sync_state where user_id=p_user_id for update;
 baseline:=not found;

 for v in select *from jsonb_array_elements(p_records)loop
  if jsonb_typeof(v)is distinct from'object'or not public.academic_json_object(v,array['courseId','itemId','courseTitle','itemTitle','score','maxScore','sourceUrl'])
   or public.academic_object_length(v)<>7 or(v->>'courseId')!~'^[1-9][0-9]{0,15}$'
   or(v->>'itemId')!~'^([1-9][0-9]{0,15}|mod-[a-z][a-z0-9_]*-[1-9][0-9]{0,15})$'
   or jsonb_typeof(v->'courseTitle')is distinct from'string'or length(trim(v->>'courseTitle'))not between 1 and 500
   or jsonb_typeof(v->'itemTitle')is distinct from'string'or length(trim(v->>'itemTitle'))not between 1 and 500
   or(v->'score'<>'null'::jsonb and jsonb_typeof(v->'score')is distinct from'number')
   or(v->'maxScore'<>'null'::jsonb and jsonb_typeof(v->'maxScore')is distinct from'number')
   or(v->'sourceUrl'<>'null'::jsonb and(v->>'sourceUrl')!~'^https://lms\.astanait\.edu\.kz/(course/view|mod/(assign|quiz)/view)\.php\?id=[1-9][0-9]{0,15}$')
  then raise exception'grade_snapshot_invalid'using errcode='22023';end if;
  score:=(v->>'score')::numeric;maximum:=nullif((v->>'maxScore')::numeric,0);
  if score<0 or score>='Infinity'::numeric or maximum<0 or maximum>='Infinity'::numeric then raise exception'grade_snapshot_invalid'using errcode='22023';end if;
  select *into prior from public.academic_grade_observations where user_id=p_user_id and moodle_course_id=v->>'courseId'and moodle_item_id=v->>'itemId'for update;
  known:=found;
  changed:=score is not null and(known and(prior.score is null or prior.score<>score or(maximum is not null and prior.max_score is distinct from maximum))
       or not known and not baseline and s.complete_baseline and p_complete);
  revision:=case when known then prior.revision+case when changed then 1 else 0 end else 1 end;
  insert into public.academic_grade_observations(user_id,moodle_course_id,moodle_item_id,course_title,item_title,score,max_score,revision,source_url,first_verified_at,last_verified_at,last_run_id)
  values(p_user_id,v->>'courseId',v->>'itemId',v->>'courseTitle',v->>'itemTitle',score,maximum,revision,v->>'sourceUrl',at_time,at_time,p_run_id)
  on conflict(user_id,moodle_course_id,moodle_item_id)do update set course_title=excluded.course_title,item_title=excluded.item_title,
   score=coalesce(excluded.score,academic_grade_observations.score),max_score=case when excluded.score is null then academic_grade_observations.max_score else excluded.max_score end,
   revision=excluded.revision,source_url=excluded.source_url,last_verified_at=excluded.last_verified_at,last_run_id=excluded.last_run_id;
  if changed then
   insert into public.academic_grade_events(user_id,moodle_course_id,moodle_item_id,revision,kind,course_title,item_title,old_score,old_max_score,new_score,new_max_score,source_url,observed_at,sync_run_id,consent_revision)
   values(p_user_id,v->>'courseId',v->>'itemId',revision,case when prior.score is null then'posted'else'corrected'end,v->>'courseTitle',v->>'itemTitle',prior.score,prior.max_score,score,maximum,v->>'sourceUrl',at_time,p_run_id,
     pending.consent_revision);
   created_count:=created_count+1;
  end if;
  seen_count:=seen_count+1;
 end loop;
 insert into public.academic_grade_sync_state(user_id,complete_baseline,last_verified_at,last_run_id)values(p_user_id,p_complete,at_time,p_run_id)
 on conflict(user_id)do update set complete_baseline=academic_grade_sync_state.complete_baseline or excluded.complete_baseline,last_verified_at=excluded.last_verified_at,last_run_id=excluded.last_run_id;
 result:=jsonb_build_object('seen',seen_count,'eventsCreated',created_count,'baseline',baseline,'inventoryComplete',p_complete);
 if not exists(select from public.lms_sync_leases where user_id=p_user_id and platform_type='aitu_moodle'and owner=p_lease_owner and expires_at>clock_timestamp())then raise exception'grade_lease_lost'using errcode='42501';end if;
 insert into public.academic_grade_sync_receipts(user_id,run_id,fingerprint,result)values(p_user_id,p_run_id,digest,result);
 perform public.academic_intelligence_consume_grade_snapshot(p_user_id,p_run_id,digest);
 return result;
end;$$;

create function public.drain_moodle_grade_snapshots(p_user_id uuid,p_lease_owner uuid)returns jsonb
language plpgsql security invoker set search_path='' as $$declare staged_snapshot public.academic_grade_pending_snapshots;n integer:=0;remaining boolean;begin
 perform 1 from public.profiles where user_id=p_user_id and status='active'for update;
 if not found then raise exception'grade_owner_inactive'using errcode='42501';end if;
 perform 1 from public.lms_sync_leases where user_id=p_user_id and platform_type='aitu_moodle'and owner=p_lease_owner and expires_at>clock_timestamp()for share;
 if not found then raise exception'grade_lease_lost'using errcode='42501';end if;
 for staged_snapshot in select q.*from public.academic_grade_pending_snapshots q join public.sync_runs history_run on history_run.id=q.run_id and history_run.user_id=q.user_id and history_run.status='success'
 where q.user_id=p_user_id and not exists(select from public.academic_grade_sync_receipts x where x.user_id=q.user_id and x.run_id=q.run_id)
 order by q.observed_at,q.run_id limit 50 loop
  perform public.capture_moodle_grade_snapshot(p_user_id,staged_snapshot.run_id,p_lease_owner,staged_snapshot.inventory_complete,staged_snapshot.records);n:=n+1;
 end loop;
 select exists(select from public.academic_grade_pending_snapshots q join public.sync_runs history_run on history_run.id=q.run_id and history_run.user_id=q.user_id and history_run.status='success'
 where q.user_id=p_user_id and not exists(select from public.academic_grade_sync_receipts x where x.user_id=q.user_id and x.run_id=q.run_id))into remaining;
 return jsonb_build_object('drained',n,'remaining',remaining);
end;$$;

create function public.academic_intelligence_deadlines(p_user_id uuid,p_at timestamptz)returns setof jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('key',v->>'key','courseId',(select case when count(*)=1 then min(c.id::text)else null end from public.study_courses c join public.source_events e on e.id=(v->>'id')::uuid and e.user_id=c.user_id where c.user_id=p_user_id and c.status='active'and c.external_course_key='moodle:'||(e.raw_json->>'moodle_course_id')),
 'courseTitle',v->'courseTitle','title',v->'title','kind','assignment','dueAt',v->'dueAt','sourceUrl',v->'sourceUrl',
 'lastSuccessfulSyncAt',public.academic_lms_status(p_user_id,p_at)->'lastSuccessfulSyncAt')
 from public.academic_assignment_rows(p_user_id,p_at)v where v->'active'='true'::jsonb and v->'stale'='false'::jsonb
 and v->>'submissionState'='not_submitted'and(v->>'dueAt')::timestamptz>p_at
 and not exists(select from public.source_events task join public.source_events g on g.user_id=task.user_id and g.external_id=task.raw_json->>'related_grade_external_id'join public.academic_records a on a.user_id=g.user_id and a.source_event_id=g.id where task.id=(v->>'id')::uuid and task.user_id=p_user_id and a.score is not null)
 order by(v->>'dueAt')::timestamptz,v->>'key'limit 100;
$$;

create function public.academic_intelligence_lms_status(p_user_id uuid,p_at timestamptz)returns jsonb language sql stable set search_path='' as $$
 select public.academic_lms_status(p_user_id,p_at)||jsonb_build_object('stale',not coalesce(
  s.is_active and s.is_token_valid and(s.auth_mode<>'session'or s.session_expires_at>p_at)
  and s.session_state in('connected','syncing','error')and s.last_sync_success_at between p_at-interval'6 hours'and p_at+interval'5 minutes'
  and(s.last_error_category is null or(s.last_error_category='partial_sync'and cardinality(s.unsupported_features)>0
    and not exists(select from unnest(s.unsupported_features)f where f<>'html_inventory_not_provably_complete'))),false))
 from public.profiles p left join public.user_lms_settings s on s.user_id=p.user_id and s.platform_type='aitu_moodle'
 where p.user_id=p_user_id and p.status='active';
$$;

create function public.academic_intelligence_feed(p_user_id uuid)returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'courseId',(select case when count(*)=1 then min(c.id::text)else null end from public.study_courses c where c.user_id=p_user_id and c.status='active'and c.external_course_key='moodle:'||e.moodle_course_id),
 'courseTitle',e.course_title,'itemTitle',e.item_title,'kind',e.kind,'observedAt',e.observed_at,'oldScore',e.old_score,'oldMaxScore',e.old_max_score,'newScore',e.new_score,'newMaxScore',e.new_max_score,'moodleCourseId',e.moodle_course_id,'moodleItemId',e.moodle_item_id,'sourceUrl',e.source_url)order by e.observed_at desc,e.id)
 from(select *from public.academic_grade_events where user_id=p_user_id order by observed_at desc,id limit 100)e),'[]'::jsonb),
 'eligibleDeadlines',coalesce((select jsonb_agg(v)from public.academic_intelligence_deadlines(p_user_id,clock_timestamp())v),'[]'::jsonb),
 'preferences',public.academic_intelligence_preferences_view(p_user_id),'lms',public.academic_intelligence_lms_status(p_user_id,clock_timestamp()),
 'truncated',(select count(*)>100 from public.academic_grade_events where user_id=p_user_id),
 'historyPending',exists(select from public.academic_grade_pending_snapshots q join public.sync_runs r on r.id=q.run_id and r.user_id=q.user_id and r.status='success'where q.user_id=p_user_id and not exists(select from public.academic_grade_sync_receipts receipt where receipt.user_id=q.user_id and receipt.run_id=q.run_id)))
 from public.profiles where user_id=p_user_id and status='active';
$$;

create function public.academic_intelligence_service(p_user_id uuid,p_operation text,p_args jsonb default'{}')returns jsonb
language plpgsql security invoker set search_path='' as $$
declare i public.academic_intelligence_preferences;a public.academic_notification_preferences;v jsonb;r jsonb;c public.study_courses;
begin
 if p_operation='feed'then return public.academic_intelligence_feed(p_user_id);end if;
 if p_operation not in('preferences','review_policy')or jsonb_typeof(p_args)is distinct from'object'then raise exception'academic_intelligence_invalid_input'using errcode='22023';end if;
 perform 1 from public.profiles where user_id=p_user_id and status='active'for update;
 if not found then raise exception'academic_intelligence_not_found'using errcode='P0002';end if;
 insert into public.academic_intelligence_preferences(user_id)values(p_user_id)on conflict do nothing;
 select *into i from public.academic_intelligence_preferences where user_id=p_user_id for update;
 if(p_args->>'expectedRevision')::int is distinct from i.revision then raise exception'academic_intelligence_conflict'using errcode='40001';end if;
 if p_operation='review_policy'then
  select *into c from public.study_courses where user_id=p_user_id and id=(p_args->>'courseId')::uuid and status='active'for share;
  if not found then raise exception'academic_intelligence_not_found'using errcode='P0002';end if;
  r:=p_args->'review';
  if jsonb_typeof(r)is distinct from'object'or not public.academic_json_object(r,array['version','externalCourseKey','definitionKey','bindingsKey','contextKey','sourceRef','supportedPolicy'])or public.academic_object_length(r)<>7
   or exists(select from jsonb_each(r)kv where kv.key<>'version'and jsonb_typeof(kv.value)is distinct from'string')
   or length(r->>'contextKey')not between 1 and 2000 or(r->>'sourceRef')~'[[:cntrl:]]'
   or c.updated_at is distinct from(p_args->>'courseUpdatedAt')::timestamptz or c.external_course_key is distinct from r->>'externalCourseKey'
   or r->>'supportedPolicy'<>'linear-30-30-40'or r->'version'<>'1'::jsonb or length(r->>'definitionKey')not between 1 and 65536
   or length(r->>'bindingsKey')not between 1 and 65536 or length(r->>'sourceRef')not between 1 and 500
  then raise exception'academic_intelligence_conflict'using errcode='40001';end if;
  update public.academic_intelligence_preferences set course_reviews=course_reviews||jsonb_build_object(c.id::text,r||jsonb_build_object('reviewedAt',clock_timestamp())),revision=revision+1,updated_at=clock_timestamp()where user_id=p_user_id;
 else
  insert into public.academic_notification_preferences(user_id)values(p_user_id)on conflict do nothing;
  select *into a from public.academic_notification_preferences where user_id=p_user_id for update;
  if(p_args->>'expectedAcademicRevision')::int is distinct from a.revision then raise exception'academic_intelligence_conflict'using errcode='40001';end if;
  v:=p_args->'preferences';
  if not public.academic_json_object(v,array['gradeAlertsEnabled','assignmentAlertsEnabled','quizAlertsEnabled','assignmentOffsetsMinutes','quizOffsetsMinutes','quietStart','quietEnd'])or public.academic_object_length(v)<>7
    or jsonb_typeof(v->'gradeAlertsEnabled')is distinct from'boolean'or jsonb_typeof(v->'quizAlertsEnabled')is distinct from'boolean'
    or not public.academic_validate_preferences(a.preferences||jsonb_build_object('assignmentAlertsEnabled',v->'assignmentAlertsEnabled','assignmentOffsetsMinutes',v->'assignmentOffsetsMinutes','quietStart',v->'quietStart','quietEnd',v->'quietEnd'))
    or not public.academic_validate_preferences(a.preferences||jsonb_build_object('assignmentOffsetsMinutes',v->'quizOffsetsMinutes'))
  then raise exception'academic_intelligence_invalid_input'using errcode='22023';end if;
  update public.academic_notification_preferences set preferences=preferences||jsonb_build_object('assignmentAlertsEnabled',v->'assignmentAlertsEnabled','assignmentOffsetsMinutes',v->'assignmentOffsetsMinutes','quietStart',v->'quietStart','quietEnd',v->'quietEnd'),revision=revision+1,updated_at=clock_timestamp()where user_id=p_user_id;
  update public.academic_intelligence_preferences set grade_consent_revision=grade_consent_revision+case when grade_alerts_enabled is distinct from(v->>'gradeAlertsEnabled')::boolean then 1 else 0 end,grade_alerts_enabled=(v->>'gradeAlertsEnabled')::boolean,quiz_alerts_enabled=(v->>'quizAlertsEnabled')::boolean,quiz_offsets_minutes=v->'quizOffsetsMinutes',revision=revision+1,updated_at=clock_timestamp()where user_id=p_user_id;
 end if;
 return public.academic_intelligence_feed(p_user_id);
end;$$;

create function public.academic_intelligence_quiet(p_user_id uuid,p_at timestamptz)returns boolean language sql stable set search_path='' as $$
 with p as(select timezone,public.academic_intelligence_preferences_view(user_id)v from public.profiles where user_id=p_user_id and status='active'),
 t as(select(p_at at time zone timezone)::time clock,(v->>'quietStart')::time first,(v->>'quietEnd')::time last from p)
 select coalesce((select case when first=last then false when first<last then clock>=first and clock<last else clock>=first or clock<last end from t),true);
$$;

create function public.academic_intelligence_forecast_key(f jsonb,p_at timestamptz)returns jsonb language sql stable set search_path='' as $$
 select(f-array['records','lms','calculator'])||jsonb_build_object(
 'calculator',case when jsonb_typeof(f->'calculator')='object'then(f->'calculator')-'values'else'null'::jsonb end,
 'records',coalesce((select jsonb_agg(r-'updatedAt'order by r->>'id')from jsonb_array_elements(coalesce(f->'records','[]'::jsonb))r),'[]'::jsonb),
 'sourceEligible',f->'lms'->'configured'='true'::jsonb and f->'lms'->'stale'='false'::jsonb,
 'reviewCurrent',coalesce((f->'review'->>'reviewedAt')::timestamptz between p_at-interval'90 days'and p_at,false),
 'enrollmentCurrent',(f->>'courseStartsOn'is null or(f->>'courseStartsOn')::date<=(p_at at time zone'Asia/Almaty')::date)
 and(f->>'courseEndsOn'is null or(f->>'courseEndsOn')::date>=(p_at at time zone'Asia/Almaty')::date));
$$;

create function public.academic_intelligence_grade_candidates(p_user_id uuid,p_at timestamptz)returns setof jsonb
language sql stable set search_path='' as $$
 with eligible as(
 select e.* from public.academic_grade_events e
 join public.academic_intelligence_preferences pref on pref.user_id=e.user_id and pref.grade_alerts_enabled and pref.grade_consent_revision=e.consent_revision
 join public.academic_grade_observations o on o.user_id=e.user_id and o.moodle_course_id=e.moodle_course_id and o.moodle_item_id=e.moodle_item_id and o.revision=e.revision
 join public.sync_runs r on r.id=e.sync_run_id and r.user_id=e.user_id and r.status='success'
 where e.user_id=p_user_id and e.observed_at between p_at-interval'24 hours'and p_at
 and o.last_verified_at between p_at-interval'6 hours'and p_at+interval'5 minutes'
 and public.academic_intelligence_lms_status(p_user_id,p_at)->'stale'='false'::jsonb
 and not public.academic_intelligence_quiet(p_user_id,p_at)
 and exists(select from public.source_events s join public.academic_records a on a.user_id=s.user_id and a.source_event_id=s.id
 where s.user_id=e.user_id and s.external_id='academic:moodle:'||e.moodle_course_id||':'||e.moodle_item_id
 and a.score is not distinct from e.new_score and nullif(a.max_score,0)is not distinct from e.new_max_score
 and coalesce(a.raw_json->'_grade_visibility_unknown','false'::jsonb)<>'true'::jsonb)),
 groups as(select sync_run_id,moodle_course_id,max(observed_at)observed_at,array_agg(id order by id)event_ids,
 jsonb_agg(jsonb_build_object('id',id,'kind',kind,'moodleCourseId',moodle_course_id,'moodleItemId',moodle_item_id,'itemTitle',item_title,'oldScore',old_score,'oldMaxScore',old_max_score,'newScore',new_score,'newMaxScore',new_max_score,'sourceUrl',source_url)order by id)events,
 min(course_title)course_title from eligible group by sync_run_id,moodle_course_id),
 contexts as(select g.*,p.timezone,pref.revision,coalesce(ap.revision,0)academic_revision,
 (select case when count(*)=1 then min(c.id::text)else null end from public.study_courses c where c.user_id=p_user_id and c.status='active'and c.external_course_key='moodle:'||g.moodle_course_id)course_id
 from groups g join public.profiles p on p.user_id=p_user_id and p.status='active'
 join public.academic_intelligence_preferences pref on pref.user_id=p.user_id
 left join public.academic_notification_preferences ap on ap.user_id=p.user_id),
 payloads as(select c.*,jsonb_build_object('courseId',c.course_id,'externalCourseKey',s.external_course_key,'courseStartsOn',s.starts_on,'courseEndsOn',s.ends_on,
 'calculator',s.metadata->'study_calculator_v1','bindings',coalesce(s.metadata->'scholarship_planner_v1'->'bindings','{}'::jsonb),
 'review',pref.course_reviews->c.course_id,'lms',public.academic_intelligence_lms_status(p_user_id,p_at),
 'records',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'courseTitle',a.course_title,'title',a.title,'score',a.score,'maxScore',a.max_score,
 'updatedAt',o.last_verified_at,'rawJson',jsonb_build_object('moodle_course_id',o.moodle_course_id,'moodle_item_id',o.moodle_item_id,'_is_mocked',false,'_grade_visibility_unknown',coalesce(a.raw_json->'_grade_visibility_unknown','false'::jsonb)))order by a.id)
 from public.academic_records a join public.source_events e on e.id=a.source_event_id and e.user_id=a.user_id
 join public.academic_grade_observations o on o.user_id=a.user_id and e.external_id='academic:moodle:'||o.moodle_course_id||':'||o.moodle_item_id
 where a.user_id=p_user_id and o.moodle_course_id=c.moodle_course_id),'[]'::jsonb))forecast
 from contexts c left join public.study_courses s on s.id=c.course_id::uuid and s.user_id=p_user_id
 join public.academic_intelligence_preferences pref on pref.user_id=p_user_id)
 select jsonb_build_object('key','grade:'||sync_run_id||':'||moodle_course_id,'kind','grade','referenceKey',moodle_course_id,
 'courseId',course_id,'courseTitle',course_title,'events',events,'eventIds',to_jsonb(event_ids),'forecast',forecast,
 'preferencesRevision',revision,'academicRevision',academic_revision,'dueAt',observed_at,'targetAt',observed_at+interval'24 hours',
 'fingerprint',public.academic_hash(jsonb_build_object('events',events,'preferencesRevision',revision,'academicRevision',academic_revision,
 'forecast',public.academic_intelligence_forecast_key(forecast,p_at))))
 from payloads order by observed_at,sync_run_id,moodle_course_id limit 5;
$$;

create function public.academic_intelligence_candidates(p_user_id uuid,p_at timestamptz)returns setof jsonb
language sql stable set search_path='' as $$select *from public.academic_intelligence_grade_candidates(p_user_id,p_at);$$;

create function public.academic_intelligence_planning_candidates(p_user_id uuid,p_at timestamptz)returns setof jsonb
language sql stable set search_path='' as $$select c from public.academic_intelligence_candidates(p_user_id,p_at)c
 where not exists(select from public.academic_intelligence_jobs j where j.user_id=p_user_id and j.job_key=c->>'key')limit 10;$$;

create function public.prepare_academic_intelligence_notification(p_user_id uuid,p_key text,p_fingerprint text,p_message text,p_links jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare c jsonb;rid uuid;ids uuid[];
begin
 if p_message is null or length(p_message)not between 1 and 3500 or jsonb_typeof(p_links)is distinct from'array'or jsonb_array_length(p_links)>3
 or exists(select from jsonb_array_elements(p_links)l where jsonb_typeof(l)is distinct from'object'or not public.academic_json_object(l,array['text','url'])or length(l->>'text')not between 1 and 80
 or(l->>'url')!~'^https://(lifeos\.zalewko\.me/tma/\?screen=(study|settings)(&[A-Za-z]+=[A-Za-z0-9_-]+)*|lms\.astanait\.edu\.kz/(course/view|mod/(assign|quiz)/view)\.php\?id=[1-9][0-9]{0,15})$')
 then raise exception'academic_intelligence_invalid_input'using errcode='22023';end if;
 perform 1 from public.profiles where user_id=p_user_id and status='active'for update;if not found then return false;end if;
 select v into c from public.academic_intelligence_candidates(p_user_id,clock_timestamp())v where v->>'key'=p_key and v->>'fingerprint'=p_fingerprint;
 if c is null or exists(select from public.academic_intelligence_jobs where user_id=p_user_id and job_key=p_key)
 or(select count(*)from public.academic_intelligence_jobs j join public.reminders r on r.id=j.reminder_id and r.user_id=j.user_id where j.user_id=p_user_id and r.created_at>clock_timestamp()-interval'1 hour')>=5 then return false;end if;
 select coalesce(array_agg(x::uuid),'{}')into ids from jsonb_array_elements_text(coalesce(c->'eventIds','[]'::jsonb))x;
 insert into public.reminders(user_id,channel,remind_at,message,metadata_json)
 values(p_user_id,'telegram',clock_timestamp(),p_message,jsonb_build_object('academic_concierge_kind',c->>'kind','academic_intelligence',true,'academic_intelligence_key',p_key,
 'academic_intelligence_fingerprint',p_fingerprint,'academic_links',p_links,'title',p_message))returning id into rid;
 insert into public.academic_intelligence_jobs(user_id,job_key,reminder_id,kind,reference_key,event_ids,source_fingerprint,render_fingerprint,preferences_revision,academic_revision,due_at,target_at)
 values(p_user_id,p_key,rid,c->>'kind',c->>'referenceKey',ids,p_fingerprint,public.academic_hash(jsonb_build_object('message',p_message,'links',p_links)),(c->>'preferencesRevision')::int,(c->>'academicRevision')::int,(c->>'dueAt')::timestamptz,(c->>'targetAt')::timestamptz);
 return true;
end;$$;

-- A cancelled render can be prepared again only before any delivery or retry
-- boundary. Grades may resume after quiet hours with the same current facts;
-- deadlines additionally require a changed source/consent fingerprint.
create function public.academic_intelligence_job_repreparable(j public.academic_intelligence_jobs,r public.reminders,c jsonb)returns boolean
language sql stable set search_path='' as $$
 select coalesce(j.kind in('grade','assignment','quiz')and j.kind=c->>'kind'and j.job_key=c->>'key'
 and j.reference_key=c->>'referenceKey'and j.target_at=(c->>'targetAt')::timestamptz
 and(j.kind='grade'or j.source_fingerprint is distinct from c->>'fingerprint')
 and r.user_id=j.user_id and r.id=j.reminder_id and r.status='cancelled'
 and r.last_error_code='academic_source_or_consent_changed'
 and r.delivery_attempts=0 and r.failure_count=0 and r.next_attempt_at is null
 and r.delivery_started_at is null and r.sent_at is null and r.telegram_message_id is null
 and r.metadata_json->'academic_intelligence'='true'::jsonb
 and r.metadata_json->>'academic_intelligence_key'=j.job_key
 and r.metadata_json->>'academic_intelligence_fingerprint'=j.source_fingerprint
 and public.academic_hash(jsonb_build_object('message',r.message,'links',r.metadata_json->'academic_links'))=j.render_fingerprint,false);
$$;

create or replace function public.academic_intelligence_planning_candidates(p_user_id uuid,p_at timestamptz)returns setof jsonb
language sql stable set search_path='' as $$
 select c from public.academic_intelligence_candidates(p_user_id,p_at)c
 where not exists(select from public.academic_intelligence_jobs j where j.user_id=p_user_id and j.job_key=c->>'key')
 or exists(select from public.academic_intelligence_jobs j join public.reminders r on r.user_id=j.user_id and r.id=j.reminder_id
  where j.user_id=p_user_id and j.job_key=c->>'key'and public.academic_intelligence_job_repreparable(j,r,c))limit 10;
$$;

alter function public.prepare_academic_intelligence_notification(uuid,text,text,text,jsonb)rename to prepare_academic_intelligence_notification_before_reprepare;
create function public.prepare_academic_intelligence_notification(p_user_id uuid,p_key text,p_fingerprint text,p_message text,p_links jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare c jsonb;j public.academic_intelligence_jobs;r public.reminders;
begin
 if p_message is null or length(p_message)not between 1 and 3500 or jsonb_typeof(p_links)is distinct from'array'then
  raise exception'academic_intelligence_invalid_input'using errcode='22023';end if;
 if jsonb_array_length(p_links)>3 or exists(select from jsonb_array_elements(p_links)l
  where jsonb_typeof(l)is distinct from'object'or not public.academic_json_object(l,array['text','url'])
  or jsonb_typeof(l->'text')is distinct from'string'or length(l->>'text')not between 1 and 80
  or jsonb_typeof(l->'url')is distinct from'string'
  or(l->>'url')!~'^https://(lifeos\.zalewko\.me/tma/\?screen=(study|settings)(&[A-Za-z]+=[A-Za-z0-9_-]+)*|lms\.astanait\.edu\.kz/(course/view|mod/(assign|quiz)/view)\.php\?id=[1-9][0-9]{0,15})$')then
  raise exception'academic_intelligence_invalid_input'using errcode='22023';end if;
 perform 1 from public.profiles where user_id=p_user_id and status='active'for update;if not found then return false;end if;
 select *into j from public.academic_intelligence_jobs where user_id=p_user_id and job_key=p_key;
 if not found then
  return public.prepare_academic_intelligence_notification_before_reprepare(p_user_id,p_key,p_fingerprint,p_message,p_links);
 end if;
 -- Match the durable sender's owner -> reminder -> job locking order.
 select *into r from public.reminders where user_id=p_user_id and id=j.reminder_id for update;
 if not found then return false;end if;
 select *into j from public.academic_intelligence_jobs where user_id=p_user_id and job_key=p_key for update;
 select v into c from public.academic_intelligence_candidates(p_user_id,clock_timestamp())v where v->>'key'=p_key and v->>'fingerprint'=p_fingerprint;
 if c is null or not public.academic_intelligence_job_repreparable(j,r,c)then return false;end if;
 update public.reminders set message=p_message,remind_at=clock_timestamp(),status='pending',claim_token=null,lease_expires_at=null,claimed_at=null,last_error_code=null,
  metadata_json=metadata_json||jsonb_build_object('academic_concierge_kind',c->>'kind','academic_intelligence',true,'academic_intelligence_key',p_key,
   'academic_intelligence_fingerprint',p_fingerprint,'academic_links',p_links,'title',p_message)
 where user_id=p_user_id and id=r.id;
 update public.academic_intelligence_jobs set source_fingerprint=p_fingerprint,
  render_fingerprint=public.academic_hash(jsonb_build_object('message',p_message,'links',p_links)),
  preferences_revision=(c->>'preferencesRevision')::int,academic_revision=(c->>'academicRevision')::int,
  due_at=(c->>'dueAt')::timestamptz,target_at=(c->>'targetAt')::timestamptz
 where user_id=p_user_id and job_key=p_key and reminder_id=r.id;
 return true;
end;$$;

create function public.academic_intelligence_cancel_preference_jobs()returns trigger language plpgsql security definer set search_path='' as $$begin
 if TG_TABLE_SCHEMA<>'public'or TG_TABLE_NAME not in('academic_intelligence_preferences','academic_notification_preferences','profiles')then raise exception'invalid_intelligence_trigger'using errcode='42501';end if;
 update public.reminders r set status='cancelled',claim_token=null,lease_expires_at=null,claimed_at=null,last_error_code='academic_source_or_consent_changed'
 from public.academic_intelligence_jobs j where j.user_id=new.user_id and r.user_id=new.user_id and r.id=j.reminder_id and r.status in('pending','processing');
 return new;
end;$$;
create trigger intelligence_preferences_jobs after update on public.academic_intelligence_preferences for each row execute function public.academic_intelligence_cancel_preference_jobs();
create trigger intelligence_academic_preferences_jobs after update on public.academic_notification_preferences for each row execute function public.academic_intelligence_cancel_preference_jobs();
create trigger intelligence_timezone_jobs after update of timezone on public.profiles for each row execute function public.academic_intelligence_cancel_preference_jobs();

alter function public.begin_notification_delivery(text,uuid,uuid,uuid)rename to begin_notification_delivery_before_v6_grade;
create function public.begin_notification_delivery(p_kind text,p_user_id uuid,p_id uuid,p_claim_token uuid)returns bigint
language plpgsql security invoker set search_path='' as $$
declare j public.academic_intelligence_jobs;r public.reminders;valid boolean;
begin
 if p_kind='reminder'then
  perform 1 from public.profiles where user_id=p_user_id and status='active'for update;if not found then return null;end if;
  select *into r from public.reminders where user_id=p_user_id and id=p_id for update;
  select *into j from public.academic_intelligence_jobs where user_id=p_user_id and reminder_id=p_id for share;
  if found then
   select exists(select from public.academic_intelligence_candidates(p_user_id,clock_timestamp())c where c->>'key'=j.job_key and c->>'fingerprint'=j.source_fingerprint
    and(c->>'preferencesRevision')::int=j.preferences_revision and(c->>'academicRevision')::int=j.academic_revision)into valid;
   if not valid or r.metadata_json->>'academic_intelligence_key'is distinct from j.job_key or r.metadata_json->>'academic_intelligence_fingerprint'is distinct from j.source_fingerprint
    or public.academic_hash(jsonb_build_object('message',r.message,'links',r.metadata_json->'academic_links'))<>j.render_fingerprint then
    update public.reminders set status='cancelled',claim_token=null,lease_expires_at=null,claimed_at=null,last_error_code='academic_source_or_consent_changed'where id=p_id and user_id=p_user_id and claim_token=p_claim_token and status='processing';return null;
   end if;
   -- The V6 binding replaces the older unbound-academic rejection, while the
   -- original active-owner/token/lease and Daily Life fences remain mandatory.
   return public.begin_notification_delivery_before_academic(p_kind,p_user_id,p_id,p_claim_token);
  elsif r.metadata_json->'academic_intelligence'='true'::jsonb or(r.metadata_json->>'notification_kind'='instant_academic'and r.reminder_policy_key in('academic_grade_posted','assignment_added'))then
   update public.reminders set status='cancelled',claim_token=null,lease_expires_at=null,claimed_at=null,last_error_code='academic_binding_required'where id=p_id and user_id=p_user_id and claim_token=p_claim_token and status='processing';return null;
  end if;
 end if;
 return public.begin_notification_delivery_before_v6_grade(p_kind,p_user_id,p_id,p_claim_token);
end;$$;
revoke all on function public.begin_notification_delivery(text,uuid,uuid,uuid),public.begin_notification_delivery_before_v6_grade(text,uuid,uuid,uuid),public.prepare_academic_intelligence_notification(uuid,text,text,text,jsonb)from public,anon,authenticated;
grant execute on function public.begin_notification_delivery(text,uuid,uuid,uuid),public.begin_notification_delivery_before_v6_grade(text,uuid,uuid,uuid),public.prepare_academic_intelligence_notification(uuid,text,text,text,jsonb)to service_role;

do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and(p.proname like'academic_intelligence_%'or p.proname in('capture_moodle_grade_snapshot','stage_moodle_grade_snapshot','drain_moodle_grade_snapshots','prepare_academic_intelligence_notification_before_reprepare'))loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
end loop;end;$$;
commit;
