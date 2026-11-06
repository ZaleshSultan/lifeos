-- Intended contract under either planner flag: a policy-only review preserves
-- saved assignment consent, pending job and actual final delivery rights.
reset role;
insert into auth.users values('f6000000-0000-4000-8000-000000000043');
insert into public.profiles(user_id,status,role,telegram_user_id,timezone)
values('f6000000-0000-4000-8000-000000000043','active','user',760043,'UTC');
insert into public.user_lms_settings(user_id,platform_type,username,encrypted_password,is_active,is_token_valid,last_sync_success_at,session_state)
values('f6000000-0000-4000-8000-000000000043','aitu_moodle','synthetic-review','enc:v1:AA:BB:CC',true,true,clock_timestamp(),'connected');
insert into public.external_sources(user_id,source_key,source_type,display_name,status)
values('f6000000-0000-4000-8000-000000000043','university_platform','university','Synthetic cutover review','connected');
set role service_role;
do $$declare
 u uuid:='f6000000-0000-4000-8000-000000000043';course_uuid uuid:='f6430000-0000-4000-8000-000000000043';
 definition_text text;config jsonb;scenarios jsonb:='{}';scenario text;score_value int;course_at timestamptz;
 event_id uuid;rid uuid;before_plan jsonb;after_plan jsonb;token uuid;recipient bigint;consent_before jsonb;consent_after jsonb;review jsonb;
begin
 definition_text:='{"version":1,"sourceName":"Reviewed synthetic syllabus p2","attestationThreshold":25,"fields":[{"id":"a","label":"ATT1","period":"att1","weightPercent":100},{"id":"b","label":"ATT2","period":"att2","weightPercent":100},{"id":"exam","label":"Exam","period":"exam","weightPercent":100}]}';
 foreach scenario in array array['pessimistic','realistic','optimistic']loop
  score_value:=case scenario when'pessimistic'then 50 when'realistic'then 70 else 90 end;
  scenarios:=scenarios||jsonb_build_object(scenario,jsonb_build_object('defaults',jsonb_build_object('assignment',score_value,'quiz',score_value,'midterm',score_value,'endterm',score_value,'exam',score_value,'other',score_value),'overrides','{}'::jsonb,'periodTotals','{"att1":null,"att2":null}'::jsonb));
 end loop;
 config:=jsonb_build_object('version',1,'included',true,'threshold',70,'target',70,'useManualValues',true,'scenarios',scenarios,'bindings','{}'::jsonb);
 insert into public.study_courses(id,user_id,code,title,status,external_course_key,metadata)
 values(course_uuid,u,'SYNTHETIC_CUTOVER','Synthetic cutover course','active','moodle:42',jsonb_build_object(
 'study_calculator_v1',jsonb_build_object('definition',definition_text::jsonb,'values','{"a":null,"b":null,"exam":null}'::jsonb,'target',70),
 'scholarship_planner_v1',config))returning updated_at into course_at;
 insert into public.source_events(user_id,source_key,external_id,event_type,title,status,due_at,last_synced_at,source_url,raw_json)
 values(u,'university_platform','activity:moodle:42:assign:4301','task','Synthetic cutover assignment','active',clock_timestamp()+interval'29 minutes',clock_timestamp(),
 'https://lms.astanait.edu.kz/mod/assign/view.php?id=4301',
 '{"moodle_course_id":"42","moodle_cmid":"4301","module_type":"assign","course_title":"Synthetic cutover course","submission_status":"not_submitted","parser_warnings":[]}'::jsonb)returning id into event_id;
 perform public.academic_service(u,'save_preferences',jsonb_build_object('expectedRevision',0,'preferences',
 public.academic_default_preferences()||'{"assignmentAlertsEnabled":true,"assignmentOffsetsMinutes":[30],"quietStart":"00:00","quietEnd":"00:00"}'::jsonb));
 select preferences into consent_before from public.academic_notification_preferences where user_id=u;
 perform intelligence_blocker_test.assert(not exists(select from public.academic_intelligence_preferences where user_id=u),'cutover no V6 preference exists initially');
 perform intelligence_blocker_test.assert((select count(*)=1 from public.academic_candidate_rows(u,clock_timestamp())v where v->>'kind'='assignment'),'cutover fresh consented legacy assignment is initially eligible');
 before_plan:=public.plan_academic_notifications(u);
 perform intelligence_blocker_test.assert(before_plan->>'queued'='1','cutover actual legacy planner prepares one opted-in assignment');
 select reminder_id into rid from public.academic_notification_jobs where user_id=u and kind='assignment';
 -- Exact current course metadata and canonical keys; this is the actual review
 -- operation used after authenticated store validation, not a bare table insert.
 review:=jsonb_build_object('version',1,'externalCourseKey','moodle:42','definitionKey',definition_text,'bindingsKey','[]',
 'contextKey','{"externalCourseKey":"moodle:42","startsOn":null,"endsOn":null}',
 'sourceRef','Synthetic explicit current owner review p2','supportedPolicy','linear-30-30-40');
 perform public.academic_intelligence_service(u,'review_policy',jsonb_build_object('expectedRevision',0,'courseId',course_uuid,'courseUpdatedAt',course_at,'review',review));
 select preferences into consent_after from public.academic_notification_preferences where user_id=u;
 perform intelligence_blocker_test.assert(consent_before=consent_after and consent_after->'assignmentAlertsEnabled'='true'::jsonb,'cutover policy review leaves existing assignment consent and intervals unchanged');
 perform intelligence_blocker_test.assert((select grade_alerts_enabled=false and quiz_alerts_enabled=false and course_reviews?course_uuid::text from public.academic_intelligence_preferences where user_id=u),'cutover only policy review initializes V6; grade and quiz consent stay OFF');
 perform intelligence_blocker_test.assert((select count(*)=1 from public.academic_candidate_rows_before_v6_deadlines(u,clock_timestamp())v where v->>'kind'='assignment'),'cutover original planner still has one eligible assignment');
 perform intelligence_blocker_test.assert((select count(*)=1 from public.academic_candidate_rows(u,clock_timestamp())v where v->>'kind'='assignment'),'policy-only review preserves the existing consented assignment route');
 after_plan:=public.plan_academic_notifications(u);
 perform intelligence_blocker_test.assert(after_plan->>'queued'='0'and after_plan->>'cancelled'='0'and exists(select from public.reminders where user_id=u and id=rid and status='pending'and delivery_attempts=0),'policy-only review does not cancel or replace the queued assignment');
 select claim_token into token from public.claim_due_reminders(clock_timestamp(),100)where user_id=u and id=rid;
 recipient:=public.begin_notification_delivery('reminder',u,rid,token);
 perform intelligence_blocker_test.assert(recipient=760043,'unchanged legacy assignment retains actual final delivery rights after policy review');
 perform public.finish_notification_delivery('reminder',u,rid,token,'unknown','synthetic_no_send',null,null);
 perform intelligence_blocker_test.assert((select count(*)=1 from public.academic_intelligence_deadline_candidates(u,clock_timestamp())v where v->>'kind'='assignment'),'assignment remains source-eligible for the shared stricter checks');
 perform intelligence_blocker_test.assert(not exists(select from public.academic_intelligence_planning_candidates(u,clock_timestamp())v where v->>'kind'='assignment'),'enabling V6 preparation cannot duplicate the authoritative legacy assignment route');
 perform intelligence_blocker_test.assert(not exists(select from public.academic_intelligence_jobs where user_id=u),'policy review creates no second assignment job');
end;$$;

reset role;
