-- Mismatched source links do not become authoritative reminder destinations.
reset role;
insert into auth.users values('f6000000-0000-4000-8000-000000000049');
insert into public.profiles(user_id,status,role,telegram_user_id,timezone)values('f6000000-0000-4000-8000-000000000049','active','user',760049,'UTC');
insert into public.user_lms_settings(user_id,platform_type,username,encrypted_password,is_active,is_token_valid,last_sync_success_at,session_state)
values('f6000000-0000-4000-8000-000000000049','aitu_moodle','synthetic','enc:v1:AA:BB:CC',true,true,clock_timestamp(),'connected');
insert into public.external_sources(user_id,source_key,source_type,display_name,status)values('f6000000-0000-4000-8000-000000000049','university_platform','university','Synthetic mismatched source link','connected');
set role service_role;
select public.academic_intelligence_service('f6000000-0000-4000-8000-000000000049','preferences','{"expectedRevision":0,"expectedAcademicRevision":0,"preferences":{"gradeAlertsEnabled":false,"assignmentAlertsEnabled":true,"quizAlertsEnabled":false,"assignmentOffsetsMinutes":[30],"quizOffsetsMinutes":[4320,1440],"quietStart":"00:00","quietEnd":"00:00"}}');
do $$declare u uuid:='f6000000-0000-4000-8000-000000000049';eid uuid;rid uuid;claim uuid;c jsonb;recipient bigint;begin
 insert into public.source_events(user_id,source_key,external_id,event_type,title,status,due_at,last_synced_at,source_url,raw_json)
 values(u,'university_platform','activity:moodle:42:assign:4901','task','Synthetic known task mismatched URL','active',clock_timestamp()+interval'29 minutes',clock_timestamp(),'https://lms.astanait.edu.kz/mod/assign/view.php?id=9999',
 '{"moodle_course_id":"42","moodle_cmid":"4901","module_type":"assign","submission_status":"not_submitted","parser_warnings":[]}'::jsonb)returning id into eid;
 perform intelligence_blocker_test.assert(exists(select from public.academic_intelligence_deadline_rows(u,clock_timestamp())v where v->>'id'=eid::text and v->'sourceUrl'='null'::jsonb),'strict eligibility preserves task but omits mismatched module destination');
 select v into c from public.academic_candidate_rows(u,clock_timestamp())v where v->>'kind'='assignment'and v->>'referenceId'=eid::text;
 perform intelligence_blocker_test.assert(c is not null and (c->>'message')not like'%id=9999%','actual legacy notification never renders a different module URL');
 perform public.plan_academic_notifications(u);
 select reminder_id into rid from public.academic_notification_jobs where user_id=u and reference_id=eid;
 select claim_token into claim from public.claim_due_reminders(clock_timestamp(),100)where user_id=u and id=rid;
 -- Simulate an old queued text without changing source facts or receipt state.
 update public.reminders set message=message||E'\nhttps://lms.astanait.edu.kz/mod/assign/view.php?id=9999'where user_id=u and id=rid;
 recipient:=public.begin_notification_delivery('reminder',u,rid,claim);
 perform intelligence_blocker_test.assert(recipient is null and exists(select from public.reminders where id=rid and user_id=u and status='cancelled'and delivery_attempts=0),'final begin refuses an old mismatched-link render without starting delivery');
end;$$;
reset role;
