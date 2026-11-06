-- Completed UI/history rows cannot consume a current notification candidate cap.
reset role;
insert into auth.users values('f6000000-0000-4000-8000-000000000048');
insert into public.profiles(user_id,status,role,telegram_user_id,timezone)values('f6000000-0000-4000-8000-000000000048','active','user',760048,'UTC');
insert into public.user_lms_settings(user_id,platform_type,username,encrypted_password,is_active,is_token_valid,last_sync_success_at,session_state)
values('f6000000-0000-4000-8000-000000000048','aitu_moodle','synthetic','enc:v1:AA:BB:CC',true,true,clock_timestamp(),'connected');
insert into public.external_sources(user_id,source_key,source_type,display_name,status)values('f6000000-0000-4000-8000-000000000048','university_platform','university','Synthetic completed work history','connected');
set role service_role;
select public.academic_intelligence_service('f6000000-0000-4000-8000-000000000048','preferences','{"expectedRevision":0,"expectedAcademicRevision":0,"preferences":{"gradeAlertsEnabled":false,"assignmentAlertsEnabled":true,"quizAlertsEnabled":false,"assignmentOffsetsMinutes":[30],"quizOffsetsMinutes":[4320,1440],"quietStart":"00:00","quietEnd":"00:00"}}');
do $$declare u uuid:='f6000000-0000-4000-8000-000000000048';eid uuid;rid uuid;claim uuid;begin
 insert into public.source_events(user_id,source_key,external_id,event_type,title,status,due_at,last_synced_at,source_url,raw_json)
 select u,'university_platform','activity:moodle:42:assign:'||(48000+n),'task','Synthetic completed task '||n,'completed',clock_timestamp()-interval'1 day',clock_timestamp(),
 'https://lms.astanait.edu.kz/mod/assign/view.php?id='||(48000+n),jsonb_build_object('moodle_course_id','42','moodle_cmid',(48000+n)::text,'module_type','assign','submission_status','submitted','parser_warnings','[]'::jsonb)from generate_series(1,100)n;
 insert into public.source_events(user_id,source_key,external_id,event_type,title,status,due_at,last_synced_at,source_url,raw_json)
 values(u,'university_platform','activity:moodle:42:assign:4801','task','Synthetic current task after history','active',clock_timestamp()+interval'29 minutes',clock_timestamp(),'https://lms.astanait.edu.kz/mod/assign/view.php?id=4801',
 '{"moodle_course_id":"42","moodle_cmid":"4801","module_type":"assign","submission_status":"not_submitted","parser_warnings":[]}'::jsonb)returning id into eid;
 perform intelligence_blocker_test.assert(exists(select from public.academic_intelligence_deadline_rows(u,clock_timestamp())v where v->>'id'=eid::text),'strict task eligibility sees current task beyond completed UI rows');
 perform intelligence_blocker_test.assert(exists(select from public.academic_candidate_rows(u,clock_timestamp())v where v->>'kind'='assignment'and v->>'referenceId'=eid::text),'completed history rows cannot hide the valid101st assignment from actual planner');
 perform intelligence_blocker_test.assert(public.plan_academic_notifications(u)->>'queued'='1','actual planner prepares current task beyond completed row cap');
 select reminder_id into rid from public.academic_notification_jobs where user_id=u and reference_id=eid;
 select claim_token into claim from public.claim_due_reminders(clock_timestamp(),100)where user_id=u and id=rid;
 perform intelligence_blocker_test.assert(public.begin_notification_delivery('reminder',u,rid,claim)=760048,'current assignment beyond history cap keeps actual delivery rights');
 perform public.finish_notification_delivery('reminder',u,rid,claim,'unknown','synthetic_no_send',null,null);
end;$$;
reset role;
