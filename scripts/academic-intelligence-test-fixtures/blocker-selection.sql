-- Intended contract: handled groups do not consume planning slots or quota.
set role service_role;
do $$declare
 u uuid:='f6000000-0000-4000-8000-000000000042';n int;run_id uuid;sixth_key text;c jsonb;rid uuid;at_time timestamptz;
begin
 for n in 1..6 loop
  run_id:=intelligence_blocker_test.new_run(u);
  perform intelligence_blocker_test.fact(u,(4200+n)::text,8,run_id,clock_timestamp(),
   case when n<=5 then clock_timestamp()-interval'2 hours'-make_interval(secs=>6-n)else clock_timestamp()-interval'1 minute'end);
  if n=6 then sixth_key:='grade:'||run_id||':42';end if;
 end loop;
 for c in select v from public.academic_intelligence_grade_candidates(u,clock_timestamp())v loop
  perform intelligence_blocker_test.assert(public.prepare_academic_intelligence_notification(u,c->>'key',c->>'fingerprint','Synthetic previously sent grade','[]'),'repro2 prepare old group '||(c->>'key'));
  select reminder_id into rid from public.academic_intelligence_jobs where user_id=u and job_key=c->>'key';
  -- Seed the legitimate previous-hour sent state without any external sender.
  update public.reminders set status='sent',created_at=clock_timestamp()-interval'2 hours',sent_at=clock_timestamp()-interval'2 hours',
   delivery_started_at=clock_timestamp()-interval'2 hours',delivery_attempts=1,telegram_message_id=760042,
   claim_token=null,lease_expires_at=null,claimed_at=null where user_id=u and id=rid;
 end loop;
 at_time:=clock_timestamp();
 perform intelligence_blocker_test.assert((select count(*)=5 from public.academic_intelligence_jobs where user_id=u),'repro2 exactly five existing sent groups');
 perform intelligence_blocker_test.assert((select count(*)=0 from public.academic_intelligence_jobs j join public.reminders r on r.id=j.reminder_id and r.user_id=j.user_id where j.user_id=u and r.created_at>at_time-interval'1 hour'),'repro2 current hourly job count zero so five/hour cap cannot explain omission');
 perform intelligence_blocker_test.assert(public.academic_intelligence_lms_status(u,at_time)->'stale'='false'::jsonb and not public.academic_intelligence_quiet(u,at_time),'repro2 source is fresh and quiet hours do not explain omission');
 perform intelligence_blocker_test.assert((select count(distinct e.sync_run_id)=6 from public.academic_grade_events e
 join public.academic_intelligence_preferences pref on pref.user_id=e.user_id and pref.grade_alerts_enabled and pref.grade_consent_revision=e.consent_revision
 join public.academic_grade_observations o on o.user_id=e.user_id and o.moodle_course_id=e.moodle_course_id and o.moodle_item_id=e.moodle_item_id and o.revision=e.revision
 join public.sync_runs r on r.id=e.sync_run_id and r.user_id=e.user_id and r.status='success'
 where e.user_id=u and e.observed_at between at_time-interval'24 hours'and at_time and o.last_verified_at between at_time-interval'6 hours'and at_time+interval'5 minutes'
 and exists(select from public.source_events s join public.academic_records a on a.user_id=s.user_id and a.source_event_id=s.id
 where s.user_id=e.user_id and s.external_id='academic:moodle:'||e.moodle_course_id||':'||e.moodle_item_id
 and a.score is not distinct from e.new_score and nullif(a.max_score,0)is not distinct from e.new_max_score
 and coalesce(a.raw_json->'_grade_visibility_unknown','false'::jsonb)<>'true'::jsonb)),'repro2 all six underlying groups meet the actual grade eligibility conditions');
 perform intelligence_blocker_test.assert(not exists(select from public.academic_intelligence_jobs where user_id=u and job_key=sixth_key),'repro2 sixth eligible group has no prior receipt or binding');
 
 perform intelligence_blocker_test.assert((select count(*)=1 from public.academic_intelligence_planning_candidates(u,at_time)v where v->>'key'=sixth_key),'the unseen sixth grade plans after dedup with recovered hourly allowance');
 select v into c from public.academic_intelligence_planning_candidates(u,at_time)v where v->>'key'=sixth_key;
 perform intelligence_blocker_test.assert(public.prepare_academic_intelligence_notification(u,c->>'key',c->>'fingerprint','Synthetic newly eligible sixth grade','[]'),'keyed preparation accepts sixth grade independently of old handled candidates');
 perform intelligence_blocker_test.assert(not public.prepare_academic_intelligence_notification(u,c->>'key',c->>'fingerprint','Synthetic restarted sixth grade','[]'),'replayed preparation never duplicates the sixth group');
 perform intelligence_blocker_test.assert((select count(*)=6 from public.academic_intelligence_jobs where user_id=u),'old receipt bindings are preserved and exactly one new binding is added');
end;$$;

reset role;
