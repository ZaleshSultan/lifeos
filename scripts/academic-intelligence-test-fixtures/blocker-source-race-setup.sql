-- The updater will hold source FOR UPDATE before begin starts. A correct begin
-- waits on that source without holding reminder, so its trigger cannot deadlock.
reset role;
insert into auth.users values('f6000000-0000-4000-8000-000000000050');
insert into public.profiles(user_id,status,role,telegram_user_id,timezone)values('f6000000-0000-4000-8000-000000000050','active','user',760050,'UTC');
insert into public.user_lms_settings(user_id,platform_type,username,encrypted_password,is_active,is_token_valid,last_sync_success_at,session_state)
values('f6000000-0000-4000-8000-000000000050','aitu_moodle','synthetic','enc:v1:AA:BB:CC',true,true,clock_timestamp(),'connected');
insert into public.external_sources(user_id,source_key,source_type,display_name,status)values('f6000000-0000-4000-8000-000000000050','university_platform','university','Synthetic source lock race','connected');
create table intelligence_blocker_test.source_race_claim(source_id uuid not null,reminder_id uuid not null,token uuid not null);
create table intelligence_blocker_test.source_race_results(recipient bigint);
grant all on intelligence_blocker_test.source_race_claim,intelligence_blocker_test.source_race_results to service_role;
set role service_role;
select public.academic_intelligence_service('f6000000-0000-4000-8000-000000000050','preferences','{"expectedRevision":0,"expectedAcademicRevision":0,"preferences":{"gradeAlertsEnabled":false,"assignmentAlertsEnabled":true,"quizAlertsEnabled":false,"assignmentOffsetsMinutes":[30],"quizOffsetsMinutes":[4320,1440],"quietStart":"00:00","quietEnd":"00:00"}}');
do $$declare u uuid:='f6000000-0000-4000-8000-000000000050';eid uuid;rid uuid;claim uuid;begin
 insert into public.source_events(user_id,source_key,external_id,event_type,title,status,due_at,last_synced_at,source_url,raw_json)
 values(u,'university_platform','activity:moodle:42:assign:5001','task','Synthetic concurrent source update','active',clock_timestamp()+interval'29 minutes',clock_timestamp(),'https://lms.astanait.edu.kz/mod/assign/view.php?id=5001',
 '{"moodle_course_id":"42","moodle_cmid":"5001","module_type":"assign","submission_status":"not_submitted","parser_warnings":[]}'::jsonb)returning id into eid;
 perform public.plan_academic_notifications(u);
 select reminder_id into rid from public.academic_notification_jobs where user_id=u and reference_id=eid;
 select claim_token into claim from public.claim_due_reminders(clock_timestamp(),100)where user_id=u and id=rid;
 insert into intelligence_blocker_test.source_race_claim values(eid,rid,claim);
end;$$;
reset role;
