-- Deadlines share source eligibility; assignments retain the established planner.
create function intelligence_test.task(cmid int,kind text,lead_minutes int,state text default'not_submitted')returns uuid language plpgsql as $$declare eid uuid;due timestamptz:=clock_timestamp()+make_interval(mins=>lead_minutes)-interval'1 minute';begin
 insert into public.source_events(user_id,source_key,external_id,event_type,title,status,due_at,last_synced_at,source_url,raw_json)
 values('f6000000-0000-4000-8000-000000000001','university_platform','activity:moodle:42:'||kind||':'||cmid,'task','Synthetic deadline '||cmid,'active',due,clock_timestamp(),
 'https://lms.astanait.edu.kz/mod/'||kind||'/view.php?id='||cmid,
 jsonb_build_object('moodle_course_id','42','moodle_cmid',cmid::text,'module_type',kind,'course_title','Synthetic course','submission_status',state,'closes_at',case when kind='quiz'then to_char(due at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')else null end,'parser_warnings','[]'::jsonb))returning id into eid;return eid;
end;$$;
grant execute on function intelligence_test.task(int,text,int,text)to service_role;
set role service_role;
select intelligence_test.assert(public.academic_default_preferences()->'assignmentOffsetsMinutes'='[4320,1440]'::jsonb,'new assignment suggestions are seventy two and twenty four hours');
select public.academic_intelligence_service('f6000000-0000-4000-8000-000000000001','preferences','{"expectedRevision":2,"expectedAcademicRevision":1,"preferences":{"gradeAlertsEnabled":false,"assignmentAlertsEnabled":true,"quizAlertsEnabled":false,"assignmentOffsetsMinutes":[4320,1440,180],"quizOffsetsMinutes":[4320,1440,180],"quietStart":"00:00","quietEnd":"00:00"}}');
select intelligence_test.task(7201,'assign',4320);
select intelligence_test.task(2401,'assign',1440);
select intelligence_test.task(301,'quiz',180);
select intelligence_test.assert((select count(*)=2 from public.academic_candidate_rows('f6000000-0000-4000-8000-000000000001',clock_timestamp())v where v->>'kind'='assignment'),'actual legacy planner keeps seventy two and twenty four hour assignments eligible');
select intelligence_test.assert(not exists(select from public.academic_intelligence_deadline_candidates('f6000000-0000-4000-8000-000000000001',clock_timestamp())v where v->>'kind'='quiz'),'quiz remains separate and off');
select intelligence_test.assert(public.plan_academic_notifications('f6000000-0000-4000-8000-000000000001')->>'queued'='2','one authoritative assignment planner prepares both saved offsets');
select public.academic_intelligence_service('f6000000-0000-4000-8000-000000000001','preferences','{"expectedRevision":3,"expectedAcademicRevision":2,"preferences":{"gradeAlertsEnabled":false,"assignmentAlertsEnabled":true,"quizAlertsEnabled":true,"assignmentOffsetsMinutes":[4320,1440,180],"quizOffsetsMinutes":[4320,1440,180],"quietStart":"00:00","quietEnd":"00:00"}}');
select intelligence_test.assert(exists(select from public.academic_intelligence_deadline_candidates('f6000000-0000-4000-8000-000000000001',clock_timestamp())v where v->>'kind'='quiz'and(v->>'offsetMinutes')::int=180),'three hour quiz closing reminder requires explicit quiz consent');
select intelligence_test.assert(not exists(select from public.academic_intelligence_planning_candidates('f6000000-0000-4000-8000-000000000001',clock_timestamp())v where v->>'kind'='assignment'),'V6 planning cannot duplicate the existing assignment route');
do $$declare u uuid:='f6000000-0000-4000-8000-000000000001';c jsonb;refreshed jsonb;rid uuid;token uuid;recipient bigint;begin
 select v into c from public.academic_candidate_rows(u,clock_timestamp())v where v->>'kind'='assignment'and(v->>'offset')::int=4320 limit 1;
 select reminder_id into rid from public.academic_notification_jobs where user_id=u and kind='assignment'and reference_id=(c->>'referenceId')::uuid and offset_minutes=4320;
 select claim_token into token from public.claim_due_reminders(clock_timestamp(),100)where id=rid and user_id=u;
 update public.source_events set last_synced_at=clock_timestamp(),updated_at=clock_timestamp(),external_updated_at=clock_timestamp(),
  raw_json=raw_json||jsonb_build_object('transport_refresh',jsonb_build_object('attempt',2,'observed_at',clock_timestamp()))where user_id=u and id=(c->>'referenceId')::uuid;
 update public.user_lms_settings set last_sync_success_at=clock_timestamp()where user_id=u;
 select v into refreshed from public.academic_candidate_rows(u,clock_timestamp())v where v->>'kind'='assignment'and v->>'referenceKey'=c->>'referenceKey'and(v->>'offset')::int=4320;
 perform intelligence_test.assert(refreshed->>'fingerprint'=c->>'fingerprint'and(select status='processing'and claim_token=token from public.reminders where id=rid),'benign timestamps and unrelated raw refresh preserve claimed legacy deadline');
 begin
  recipient:=public.begin_notification_delivery('reminder',u,rid,token);
  raise exception using errcode='ZX001',message='rollback_synthetic_begin';
 exception when sqlstate'ZX001'then null;end;
 perform intelligence_test.assert(recipient=760001 and(select status='processing'and delivery_attempts=0 from public.reminders where id=rid),'unchanged refreshed legacy deadline passes real send fence without retaining synthetic attempt');
 update public.source_events set status='completed',raw_json=raw_json||'{"submission_status":"submitted"}'::jsonb where user_id=u and id=(c->>'referenceId')::uuid;
 perform intelligence_test.assert(public.begin_notification_delivery('reminder',u,rid,token)is null,'no legacy send after verified submission');
end;$$;
do $$declare u uuid:='f6000000-0000-4000-8000-000000000001';c jsonb;changed jsonb;probe jsonb;rid uuid;token uuid;recipient bigint;job_count bigint;original_row jsonb;outcome text;receipt_preserved boolean;begin
 select v into c from public.academic_candidate_rows(u,clock_timestamp())v where v->>'kind'='assignment'and(v->>'offset')::int=1440 limit 1;
 select reminder_id into rid from public.academic_notification_jobs where user_id=u and kind='assignment'and reference_id=(c->>'referenceId')::uuid and offset_minutes=1440;
 -- The first case claimed this second reminder too; restore its unused claim by
 -- existing defer only, preserving original notification instant and receipts.
 select claim_token into token from public.reminders where user_id=u and id=rid;
 if token is not null then
  perform public.finish_notification_delivery('reminder',u,rid,token,'cancelled','synthetic_reclaim',null,null);
 end if;
 select to_jsonb(r)-array['status','message','remind_at','notification_at','metadata_json','last_error_code','updated_at']into original_row from public.reminders r where id=rid;
 select count(*)into job_count from public.academic_notification_jobs where user_id=u;
 update public.source_events set raw_json=raw_json||'{"course_title":"Synthetic corrected title"}'::jsonb where user_id=u and id=(c->>'referenceId')::uuid;
 perform public.plan_academic_notifications(u);
 select v into changed from public.academic_candidate_rows(u,clock_timestamp())v where v->>'referenceKey'=c->>'referenceKey'and(v->>'offset')::int=1440;
 perform intelligence_test.assert(changed->>'fingerprint'<>c->>'fingerprint'and(select status='pending'and delivery_attempts=0 and failure_count=0 from public.reminders where user_id=u and id=rid),'semantic non due legacy revision safely reprepares only never attempted work');
 perform intelligence_test.assert((select count(*)=job_count from public.academic_notification_jobs where user_id=u)and(select reminder_id=rid and source_fingerprint=changed->>'fingerprint'from public.academic_notification_jobs where user_id=u and kind='assignment'and reference_id=(c->>'referenceId')::uuid and offset_minutes=1440),'legacy revision reuses one durable binding without new receipt');
 perform intelligence_test.assert((select original_row=to_jsonb(r)-array['status','message','remind_at','notification_at','metadata_json','last_error_code','updated_at']from public.reminders r where id=rid),'legacy reprepare preserves immutable row and receipt fields');
 perform intelligence_test.assert(public.plan_academic_notifications(u)->>'queued'='0','same legacy fingerprint never reopens prepared deadline');
 foreach outcome in array array['sent','unknown']loop
  begin
   select claim_token into token from public.claim_due_reminders(clock_timestamp(),100)where id=rid and user_id=u;
   recipient:=public.begin_notification_delivery('reminder',u,rid,token);
   perform intelligence_test.assert(recipient=760001,'legacy outcome '||outcome||' starts through durable fence');
   perform public.finish_notification_delivery('reminder',u,rid,token,outcome,'synthetic_outcome',case when outcome='sent'then 880001 else null end,null);
   update public.source_events set raw_json=raw_json||jsonb_build_object('course_title','Synthetic closed '||outcome)where user_id=u and id=(c->>'referenceId')::uuid;
   perform public.plan_academic_notifications(u);
   select status=outcome and delivery_attempts=1 and(case when outcome='sent'then telegram_message_id=880001 and sent_at is not null else telegram_message_id is null end)into receipt_preserved from public.reminders where id=rid;
   if not receipt_preserved then raise exception'legacy closed receipt reopened';end if;
   raise exception using errcode='ZX001',message='rollback_synthetic_outcome';
  exception when sqlstate'ZX001'then null;end;
  perform intelligence_test.assert(receipt_preserved,'legacy '||outcome||' remains closed after source revision');
 end loop;
 begin
  select claim_token into token from public.claim_due_reminders(clock_timestamp(),100)where id=rid and user_id=u;
  recipient:=public.begin_notification_delivery('reminder',u,rid,token);
  perform public.finish_notification_delivery('reminder',u,rid,token,'retry','synthetic_rejected',null,60);
  update public.source_events set raw_json=raw_json||'{"course_title":"Synthetic retry changed"}'::jsonb where user_id=u and id=(c->>'referenceId')::uuid;
  perform public.plan_academic_notifications(u);
  if not exists(select from public.reminders where id=rid and status='cancelled'and delivery_attempts=1 and failure_count=1)then raise exception'legacy retry receipt reset';end if;
  raise exception using errcode='ZX001',message='rollback_synthetic_retry';
 exception when sqlstate'ZX001'then null;end;
 perform intelligence_test.assert((select status='pending'and delivery_attempts=0 from public.reminders where id=rid),'synthetic retry probe rolled back without mutating base receipt');
 update public.source_events set due_at=due_at+interval'1 minute'where user_id=u and id=(c->>'referenceId')::uuid;
 perform intelligence_test.assert(not exists(select from public.reminders where id=rid and status in('pending','processing')),'due revision retires old prepared legacy deadline before revalidation');
 perform public.plan_academic_notifications(u);
 select v into probe from public.academic_candidate_rows(u,clock_timestamp())v where v->>'referenceKey'=c->>'referenceKey'and(v->>'offset')::int=1440;
 perform intelligence_test.assert(probe->>'targetAt'<>c->>'targetAt'and(select source_fingerprint=probe->>'fingerprint'and target_at=(probe->>'targetAt')::timestamptz from public.academic_notification_jobs where user_id=u and reminder_id=rid),'due revision updates exact target and fingerprint without duplicate binding');
end;$$;
update public.source_events set raw_json=raw_json||'{"submission_status":"unknown"}'::jsonb where user_id='f6000000-0000-4000-8000-000000000001'and external_id='activity:moodle:42:quiz:301';
select intelligence_test.assert(not exists(select from public.academic_intelligence_deadline_candidates('f6000000-0000-4000-8000-000000000001',clock_timestamp())v where v->>'kind'='quiz'),'unknown quiz completion is never not submitted');
select intelligence_test.task(302,'quiz',180);
update public.source_events set raw_json=raw_json||'{"closes_at":null}'::jsonb where user_id='f6000000-0000-4000-8000-000000000001'and external_id='activity:moodle:42:quiz:302';
select intelligence_test.assert(not exists(select from public.academic_intelligence_deadline_rows('f6000000-0000-4000-8000-000000000001',clock_timestamp())v where v->>'kind'='quiz'),'quiz requires verified closing semantics');
select intelligence_test.task(181,'assign',180);
select intelligence_test.facts('777',0);
update public.source_events set raw_json=raw_json||'{"related_grade_external_id":"academic:moodle:42:777"}'::jsonb where user_id='f6000000-0000-4000-8000-000000000001'and external_id='activity:moodle:42:assign:181';
select intelligence_test.assert(not exists(select from public.academic_candidate_rows('f6000000-0000-4000-8000-000000000001',clock_timestamp())v join public.source_events e on e.id=(v->>'referenceId')::uuid and e.user_id='f6000000-0000-4000-8000-000000000001'where v->>'kind'='assignment'and e.external_id='activity:moodle:42:assign:181'),'verified zero grade suppresses actual legacy pending submission reminder');
select intelligence_test.task(182,'assign',180);
select intelligence_test.facts('778',null);
update public.academic_records a set percentage=0 from public.source_events g where a.source_event_id=g.id and a.user_id=g.user_id and g.user_id='f6000000-0000-4000-8000-000000000001'and g.external_id='academic:moodle:42:778';
update public.source_events set raw_json=raw_json||'{"related_grade_external_id":"academic:moodle:42:778"}'::jsonb where user_id='f6000000-0000-4000-8000-000000000001'and external_id='activity:moodle:42:assign:182';
select intelligence_test.assert(not exists(select from public.academic_candidate_rows('f6000000-0000-4000-8000-000000000001',clock_timestamp())v join public.source_events e on e.id=(v->>'referenceId')::uuid and e.user_id='f6000000-0000-4000-8000-000000000001'where v->>'kind'='assignment'and e.external_id='activity:moodle:42:assign:182'),'percentage only verified grading suppresses actual legacy reminders');
select intelligence_test.task(183,'assign',180);
update public.source_events set raw_json=raw_json||'{"percentage":0}'::jsonb where user_id='f6000000-0000-4000-8000-000000000001'and external_id='activity:moodle:42:assign:183';
select intelligence_test.assert(not exists(select from public.academic_candidate_rows('f6000000-0000-4000-8000-000000000001',clock_timestamp())v join public.source_events e on e.id=(v->>'referenceId')::uuid and e.user_id='f6000000-0000-4000-8000-000000000001'where v->>'kind'='assignment'and e.external_id='activity:moodle:42:assign:183'),'raw verified percentage never becomes unfinished legacy work');
update public.user_lms_settings set last_sync_success_at=clock_timestamp()-interval'7 hours'where user_id='f6000000-0000-4000-8000-000000000001';
select intelligence_test.assert(not exists(select from public.academic_intelligence_deadline_rows('f6000000-0000-4000-8000-000000000001',clock_timestamp()))and not exists(select from public.academic_candidate_rows('f6000000-0000-4000-8000-000000000001',clock_timestamp())v where v->>'kind'='assignment'),'stale Moodle data supplies neither legacy nor V6 eligible deadlines');
update public.user_lms_settings set last_sync_success_at=clock_timestamp(),last_error_category='partial_sync',unsupported_features=array['html_inventory_not_provably_complete']where user_id='f6000000-0000-4000-8000-000000000001';
select intelligence_test.assert(public.academic_intelligence_lms_status('f6000000-0000-4000-8000-000000000001',clock_timestamp())->'stale'='false'::jsonb,'unproven inventory completeness does not invalidate verified item freshness');
update public.user_lms_settings set unsupported_features=array['grade_html_incomplete']where user_id='f6000000-0000-4000-8000-000000000001';
select intelligence_test.assert(public.academic_intelligence_lms_status('f6000000-0000-4000-8000-000000000001',clock_timestamp())->'stale'='true'::jsonb,'partial grade transport remains stale');
update public.user_lms_settings set last_error_category=null,unsupported_features='{}'where user_id='f6000000-0000-4000-8000-000000000001';
select intelligence_test.assert(not exists(select from public.academic_intelligence_deadline_candidates('f6000000-0000-4000-8000-000000000001',clock_timestamp()+interval'10 minutes'))and not exists(select from public.academic_candidate_rows('f6000000-0000-4000-8000-000000000001',clock_timestamp()+interval'10 minutes')v where v->>'kind'='assignment'),'missed legacy and V6 windows never replay after downtime');
select intelligence_test.assert((select count(*)=1 from public.reminders where user_id='f6000000-0000-4000-8000-000000000001'and status='unknown'),'deadline changes preserve earlier ambiguous grade receipt');
reset role;
select intelligence_test.assert(not has_function_privilege('authenticated','public.prepare_academic_intelligence_notification(uuid,text,text,text,jsonb)','EXECUTE'),'deadline prepare wrapper remains service only');
select intelligence_test.assert(not has_function_privilege('anon','public.prepare_academic_intelligence_notification_before_reprepare(uuid,text,text,text,jsonb)','EXECUTE'),'retained preparation implementation is not public');
