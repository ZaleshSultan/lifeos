-- Extra independent owners prove expiry and policy races at real DB boundaries.
reset role;
insert into auth.users values('f6000000-0000-4000-8000-000000000045'),('f6000000-0000-4000-8000-000000000046');
insert into public.profiles(user_id,status,role,telegram_user_id,timezone)values
 ('f6000000-0000-4000-8000-000000000045','active','user',760045,'UTC'),('f6000000-0000-4000-8000-000000000046','active','user',760046,'UTC');
insert into public.user_lms_settings(user_id,platform_type,username,encrypted_password,is_active,is_token_valid,last_sync_success_at,session_state)
select user_id,'aitu_moodle','synthetic','enc:v1:AA:BB:CC',true,true,clock_timestamp(),'connected'from public.profiles where user_id in('f6000000-0000-4000-8000-000000000045','f6000000-0000-4000-8000-000000000046');
insert into public.external_sources(user_id,source_key,source_type,display_name,status)
select user_id,'university_platform','university','Synthetic notification race','connected'from public.profiles where user_id in('f6000000-0000-4000-8000-000000000045','f6000000-0000-4000-8000-000000000046');
create table intelligence_blocker_test.expiry_claim(reminder_id uuid not null,token uuid not null,key text not null);
create table intelligence_blocker_test.expiry_results(worker integer primary key,recipient bigint);
create table intelligence_blocker_test.policy_claim(reminder_id uuid not null,token uuid not null,args jsonb not null);
create table intelligence_blocker_test.policy_results(worker text primary key,status text not null,recipient bigint);
grant all on intelligence_blocker_test.expiry_claim,intelligence_blocker_test.expiry_results,intelligence_blocker_test.policy_claim,intelligence_blocker_test.policy_results to service_role;
create function intelligence_blocker_test.competing_review(worker text)returns void language plpgsql as $$declare result text;begin
 begin
  perform public.academic_intelligence_service('f6000000-0000-4000-8000-000000000046','review_policy',(select args from intelligence_blocker_test.policy_claim));
  result:='accepted';
 exception when serialization_failure then result:='conflict';end;
 insert into intelligence_blocker_test.policy_results values(worker,result,null);
end;$$;
grant execute on function intelligence_blocker_test.competing_review(text)to service_role;
set role service_role;
select public.academic_intelligence_service('f6000000-0000-4000-8000-000000000045','preferences','{"expectedRevision":0,"expectedAcademicRevision":0,"preferences":{"gradeAlertsEnabled":true,"assignmentAlertsEnabled":false,"quizAlertsEnabled":false,"assignmentOffsetsMinutes":[4320,1440],"quizOffsetsMinutes":[4320,1440],"quietStart":"00:00","quietEnd":"00:00"}}');
do $$declare u uuid:='f6000000-0000-4000-8000-000000000045';course_uuid uuid:='f6450000-0000-4000-8000-000000000045';run_id uuid;record_a uuid;record_b uuid;definition_key text;bindings jsonb;review jsonb;c jsonb;rid uuid;claim uuid;begin
 run_id:=intelligence_blocker_test.new_run(u);
 record_a:=intelligence_blocker_test.fact(u,'4501',8,run_id,clock_timestamp(),clock_timestamp()-interval'1 minute');
 record_b:=intelligence_blocker_test.fact(u,'4502',5,run_id,clock_timestamp()-interval'47 hours');
 select input->'candidate'->'forecast'->'review'->>'definitionKey'into definition_key from intelligence_blocker_test.render_inputs where label='before';
 bindings:=jsonb_build_object('a',jsonb_build_object('mode','aggregate','ruleConfirmed',true,'entries',jsonb_build_array(jsonb_build_object('recordId',record_a,'weight',100))),
 'b',jsonb_build_object('mode','aggregate','ruleConfirmed',true,'entries',jsonb_build_array(jsonb_build_object('recordId',record_b,'weight',100))));
 insert into public.study_courses(id,user_id,code,title,status,external_course_key,metadata)values(course_uuid,u,'SYNTHETIC_EXPIRY_RACE','Synthetic expiry race','active','moodle:42',
 jsonb_build_object('study_calculator_v1',jsonb_build_object('definition',definition_key::jsonb,'values','{"a":100,"b":100,"exam":100}'::jsonb,'target',70),'scholarship_planner_v1',jsonb_build_object('bindings',bindings)));
 review:=jsonb_build_object('version',1,'externalCourseKey','moodle:42','definitionKey',definition_key,
 'bindingsKey',format('[["a","aggregate",true,[["%s",100]]],["b","aggregate",true,[["%s",100]]]]',record_a,record_b),
 'contextKey','{"externalCourseKey":"moodle:42","startsOn":null,"endsOn":null}','reviewedAt',clock_timestamp()-interval'1 minute','sourceRef','Synthetic reviewed policy','supportedPolicy','linear-30-30-40');
 update public.academic_intelligence_preferences set course_reviews=jsonb_build_object(course_uuid::text,review)where user_id=u;
 update public.academic_grade_observations set last_verified_at=clock_timestamp()-interval'48 hours'+interval'2 seconds'where user_id=u and moodle_item_id='4502';
 c:=public.academic_intelligence_candidate(u,'grade:'||run_id||':42',clock_timestamp());
 perform intelligence_blocker_test.assert(public.prepare_academic_intelligence_notification(u,c->>'key',c->>'fingerprint','Synthetic exact forecast before concurrent expiry','[]'),'expiry race starts with one current prepared exact forecast');
 select reminder_id into rid from public.academic_intelligence_jobs where user_id=u and job_key=c->>'key';
 select claim_token into claim from public.claim_due_reminders(clock_timestamp(),100)where user_id=u and id=rid;
 insert into intelligence_blocker_test.expiry_claim values(rid,claim,c->>'key');
 -- Every concurrently launched begin runs only after this actual expiry.
 perform pg_sleep(3);
end;$$;
do $$declare u uuid:='f6000000-0000-4000-8000-000000000046';course_uuid uuid:='f6460000-0000-4000-8000-000000000046';course_at timestamptz;metadata jsonb;review jsonb;eid uuid;rid uuid;claim uuid;begin
 select c.metadata,(i.course_reviews->c.id::text)-'reviewedAt'into metadata,review from public.study_courses c join public.academic_intelligence_preferences i on i.user_id=c.user_id
 where c.user_id='f6000000-0000-4000-8000-000000000043'and c.id='f6430000-0000-4000-8000-000000000043';
 insert into public.study_courses(id,user_id,code,title,status,external_course_key,metadata)values(course_uuid,u,'SYNTHETIC_POLICY_RACE','Synthetic policy race','active','moodle:42',metadata)returning updated_at into course_at;
 perform public.academic_service(u,'save_preferences',jsonb_build_object('expectedRevision',0,'preferences',public.academic_default_preferences()||'{"assignmentAlertsEnabled":true,"assignmentOffsetsMinutes":[30],"quietStart":"00:00","quietEnd":"00:00"}'::jsonb));
 insert into public.source_events(user_id,source_key,external_id,event_type,title,status,due_at,last_synced_at,source_url,raw_json)
 values(u,'university_platform','activity:moodle:42:assign:4601','task','Synthetic policy race assignment','active',clock_timestamp()+interval'29 minutes',clock_timestamp(),'https://lms.astanait.edu.kz/mod/assign/view.php?id=4601',
 '{"moodle_course_id":"42","moodle_cmid":"4601","module_type":"assign","submission_status":"not_submitted","parser_warnings":[]}'::jsonb)returning id into eid;
 perform public.plan_academic_notifications(u);
 select reminder_id into rid from public.academic_notification_jobs where user_id=u and reference_id=eid and kind='assignment';
 select claim_token into claim from public.claim_due_reminders(clock_timestamp(),100)where user_id=u and id=rid;
 insert into intelligence_blocker_test.policy_claim values(rid,claim,jsonb_build_object('expectedRevision',0,'courseId',course_uuid,'courseUpdatedAt',course_at,'review',review));
end;$$;
reset role;
