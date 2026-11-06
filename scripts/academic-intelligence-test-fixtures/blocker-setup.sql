-- Shared invented owners and helpers for independent intended-contract cases.
reset role;
create schema intelligence_blocker_test;
create table intelligence_blocker_test.proofs(name text primary key);
create table intelligence_blocker_test.render_inputs(label text primary key,input jsonb not null);
create function intelligence_blocker_test.assert(ok boolean,label text)returns void
language plpgsql as $$begin
 if ok is distinct from true then raise exception 'REVIEW REPRO ASSERTION FAILED: %',label;end if;
 insert into intelligence_blocker_test.proofs values(label);
end;$$;
-- New invented owners keep existing regression fixtures and their quotas apart.
insert into auth.users values('f6000000-0000-4000-8000-000000000041'),('f6000000-0000-4000-8000-000000000042');
insert into public.profiles(user_id,status,role,telegram_user_id,timezone)values
 ('f6000000-0000-4000-8000-000000000041','active','user',760041,'UTC'),
 ('f6000000-0000-4000-8000-000000000042','active','user',760042,'UTC');
insert into public.user_lms_settings(user_id,platform_type,username,encrypted_password,is_active,is_token_valid,last_sync_success_at,session_state)
select user_id,'aitu_moodle','synthetic-review','enc:v1:AA:BB:CC',true,true,clock_timestamp(),'connected'
from public.profiles where user_id in('f6000000-0000-4000-8000-000000000041','f6000000-0000-4000-8000-000000000042');
insert into public.external_sources(user_id,source_key,source_type,display_name,status)
select user_id,'university_platform','university','Synthetic independent migration review','connected'
from public.profiles where user_id in('f6000000-0000-4000-8000-000000000041','f6000000-0000-4000-8000-000000000042');

create function intelligence_blocker_test.new_run(u uuid)returns uuid language plpgsql as $$declare rid uuid;begin
 insert into public.sync_runs(user_id,source_id,source_key,status,started_at,finished_at,metadata_json)
 select user_id,id,source_key,'success',clock_timestamp()-interval'1 second',clock_timestamp(),
 '{"moodle_grades_synced":true,"moodle_grade_inventory_complete":false}'::jsonb
 from public.external_sources where user_id=u and source_key='university_platform' returning id into rid;
 return rid;
end;$$;
-- Direct fixture seeding isolates FINAL delivery validation from fetch staging.
-- It represents internally consistent committed observations/facts/events, uses
-- the same public tables as the harness, and never alters an immutable event.
create function intelligence_blocker_test.fact(u uuid,item text,score_value numeric,run_id uuid,verified timestamptz,event_at timestamptz default null)
returns uuid language plpgsql as $$declare eid uuid;record_id uuid;begin
 insert into public.academic_grade_observations(user_id,moodle_course_id,moodle_item_id,course_title,item_title,score,max_score,revision,source_url,first_verified_at,last_verified_at,last_run_id)
 values(u,'42',item,'Synthetic review course','Synthetic review item '||item,score_value,10,1,'https://lms.astanait.edu.kz/course/view.php?id=42',verified,verified,run_id);
 insert into public.source_events(user_id,source_key,external_id,event_type,title,status,raw_json)
 values(u,'university_platform','academic:moodle:42:'||item,'academic_grade','Synthetic review item '||item,'active',jsonb_build_object('moodle_course_id','42','moodle_item_id',item)) returning id into eid;
 insert into public.academic_records(user_id,source_event_id,course_title,record_type,title,score,max_score,raw_json)
 values(u,eid,'Synthetic review course','assignment','Synthetic review item '||item,score_value,10,jsonb_build_object('moodle_course_id','42','moodle_item_id',item)) returning id into record_id;
 if event_at is not null then
  insert into public.academic_grade_events(user_id,moodle_course_id,moodle_item_id,revision,kind,course_title,item_title,old_score,old_max_score,new_score,new_max_score,source_url,observed_at,sync_run_id,consent_revision)
  values(u,'42',item,1,'posted','Synthetic review course','Synthetic review item '||item,null,null,score_value,10,'https://lms.astanait.edu.kz/course/view.php?id=42',event_at,run_id,1);
 end if;
 return record_id;
end;$$;
grant usage on schema intelligence_blocker_test to service_role;
grant all on all tables in schema intelligence_blocker_test to service_role;
grant execute on all functions in schema intelligence_blocker_test to service_role;
set role service_role;
select public.academic_intelligence_service('f6000000-0000-4000-8000-000000000041','preferences','{"expectedRevision":0,"expectedAcademicRevision":0,"preferences":{"gradeAlertsEnabled":true,"assignmentAlertsEnabled":false,"quizAlertsEnabled":false,"assignmentOffsetsMinutes":[4320,1440],"quizOffsetsMinutes":[4320,1440],"quietStart":"00:00","quietEnd":"00:00"}}');
select public.academic_intelligence_service('f6000000-0000-4000-8000-000000000042','preferences','{"expectedRevision":0,"expectedAcademicRevision":0,"preferences":{"gradeAlertsEnabled":true,"assignmentAlertsEnabled":false,"quizAlertsEnabled":false,"assignmentOffsetsMinutes":[4320,1440],"quizOffsetsMinutes":[4320,1440],"quietStart":"00:00","quietEnd":"00:00"}}');

