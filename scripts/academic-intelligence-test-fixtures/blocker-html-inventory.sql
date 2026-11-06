-- A successful but incomplete HTML inventory can verify a known individual task;
-- a failed/incomplete grade fetch cannot establish a current assignment fact.
reset role;
insert into auth.users values('f6000000-0000-4000-8000-000000000047');
insert into public.profiles(user_id,status,role,telegram_user_id,timezone)values('f6000000-0000-4000-8000-000000000047','active','user',760047,'UTC');
insert into public.user_lms_settings(user_id,platform_type,username,encrypted_password,is_active,is_token_valid,last_sync_success_at,session_state,last_error_category,unsupported_features)
values('f6000000-0000-4000-8000-000000000047','aitu_moodle','synthetic','enc:v1:AA:BB:CC',true,true,clock_timestamp(),'connected','partial_sync',array['html_inventory_not_provably_complete']);
insert into public.external_sources(user_id,source_key,source_type,display_name,status)values('f6000000-0000-4000-8000-000000000047','university_platform','university','Synthetic incomplete inventory','connected');
set role service_role;
select public.academic_intelligence_service('f6000000-0000-4000-8000-000000000047','preferences','{"expectedRevision":0,"expectedAcademicRevision":0,"preferences":{"gradeAlertsEnabled":false,"assignmentAlertsEnabled":true,"quizAlertsEnabled":false,"assignmentOffsetsMinutes":[30],"quizOffsetsMinutes":[4320,1440],"quietStart":"00:00","quietEnd":"00:00"}}');
do $$declare u uuid:='f6000000-0000-4000-8000-000000000047';eid uuid;rid uuid;claim uuid;recipient bigint;begin
 insert into public.source_events(user_id,source_key,external_id,event_type,title,status,due_at,last_synced_at,source_url,raw_json)
 values(u,'university_platform','activity:moodle:42:assign:4701','task','Synthetic individually verified assignment','active',clock_timestamp()+interval'29 minutes',clock_timestamp(),'https://lms.astanait.edu.kz/mod/assign/view.php?id=4701',
 '{"moodle_course_id":"42","moodle_cmid":"4701","module_type":"assign","submission_status":"not_submitted","parser_warnings":[]}'::jsonb)returning id into eid;
 perform intelligence_blocker_test.assert(exists(select from public.academic_intelligence_deadline_rows(u,clock_timestamp())v where v->>'id'=eid::text),'known assignment is verified despite incomplete whole inventory');
 perform intelligence_blocker_test.assert(exists(select from public.academic_candidate_rows(u,clock_timestamp())v where v->>'kind'='assignment'and v->>'referenceId'=eid::text),'actual legacy route preserves individually verified HTML assignment eligibility');
 perform intelligence_blocker_test.assert(public.plan_academic_notifications(u)->>'queued'='1','actual planner queues verified partial inventory assignment once');
 select reminder_id into rid from public.academic_notification_jobs where user_id=u and reference_id=eid;
 select claim_token into claim from public.claim_due_reminders(clock_timestamp(),100)where user_id=u and id=rid;
 begin
  recipient:=public.begin_notification_delivery('reminder',u,rid,claim);
  if recipient is distinct from 760047::bigint then raise exception'verified partial inventory lost delivery right';end if;
  raise exception using errcode='ZX001',message='rollback_partial_inventory_begin';
 exception when sqlstate'ZX001'then null;end;
 perform intelligence_blocker_test.assert(recipient=760047,'verified incomplete HTML inventory passes actual final begin');
 update public.user_lms_settings set unsupported_features=array['grade_html_incomplete']where user_id=u;
 perform intelligence_blocker_test.assert(not exists(select from public.academic_candidate_rows(u,clock_timestamp())v where v->>'kind'='assignment')and not exists(select from public.academic_intelligence_deadline_rows(u,clock_timestamp())),'incomplete grade fetch remains fail closed in both shared eligibility paths');
 perform intelligence_blocker_test.assert(public.begin_notification_delivery('reminder',u,rid,claim)is null and exists(select from public.reminders where user_id=u and id=rid and status='cancelled'and delivery_attempts=0),'grade-incomplete source prevents queued assignment from starting');
end;$$;
reset role;
