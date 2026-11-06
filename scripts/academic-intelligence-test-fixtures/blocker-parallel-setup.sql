reset role;
insert into auth.users values('f6000000-0000-4000-8000-000000000044');
insert into public.profiles(user_id,status,role,telegram_user_id,timezone)values('f6000000-0000-4000-8000-000000000044','active','user',760044,'UTC');
insert into public.user_lms_settings(user_id,platform_type,username,encrypted_password,is_active,is_token_valid,last_sync_success_at,session_state)
values('f6000000-0000-4000-8000-000000000044','aitu_moodle','synthetic','enc:v1:AA:BB:CC',true,true,clock_timestamp(),'connected');
insert into public.external_sources(user_id,source_key,source_type,display_name,status)values('f6000000-0000-4000-8000-000000000044','university_platform','university','Synthetic concurrent source','connected');
create table intelligence_blocker_test.parallel_prepare(worker integer primary key,key text not null,fingerprint text not null);
create table intelligence_blocker_test.parallel_begin(reminder_id uuid not null,token uuid,key text not null);
grant all on intelligence_blocker_test.parallel_prepare,intelligence_blocker_test.parallel_begin to service_role;
set role service_role;
select public.academic_intelligence_service('f6000000-0000-4000-8000-000000000044','preferences','{"expectedRevision":0,"expectedAcademicRevision":0,"preferences":{"gradeAlertsEnabled":true,"assignmentAlertsEnabled":false,"quizAlertsEnabled":false,"assignmentOffsetsMinutes":[4320,1440],"quizOffsetsMinutes":[4320,1440],"quietStart":"00:00","quietEnd":"00:00"}}');
do $$declare u uuid:='f6000000-0000-4000-8000-000000000044';n integer;run_id uuid;c jsonb;bound_key text;begin
 for n in 1..12 loop
  run_id:=intelligence_blocker_test.new_run(u);
  perform intelligence_blocker_test.fact(u,(4400+n)::text,8,run_id,clock_timestamp(),clock_timestamp()-interval'2 minutes'+make_interval(secs=>n));
  if n=10 then bound_key:='grade:'||run_id||':42';end if;
 end loop;
 for c in select v from public.academic_intelligence_planning_candidates(u,clock_timestamp())v limit 2 loop
  perform public.prepare_academic_intelligence_notification(u,c->>'key',c->>'fingerprint','Synthetic handled earlier this hour','[]');
  update public.reminders r set status='sent',sent_at=clock_timestamp(),delivery_started_at=clock_timestamp(),delivery_attempts=1,telegram_message_id=760044
  from public.academic_intelligence_jobs j where j.user_id=u and j.job_key=c->>'key'and r.user_id=u and r.id=j.reminder_id;
 end loop;
 c:=public.academic_intelligence_candidate(u,bound_key,clock_timestamp());
 perform intelligence_blocker_test.assert(public.prepare_academic_intelligence_notification(u,bound_key,c->>'fingerprint','Synthetic bound tenth group','[]'),'exact keyed preparation is independent of the oldest five display candidates');
 insert into intelligence_blocker_test.parallel_begin(reminder_id,key)select reminder_id,job_key from public.academic_intelligence_jobs where user_id=u and job_key=bound_key;
 insert into intelligence_blocker_test.parallel_prepare(worker,key,fingerprint)
 select row_number()over(order by k.due_at,k.job_key),k.job_key,public.academic_intelligence_candidate(u,k.job_key,clock_timestamp())->>'fingerprint'
 from public.academic_intelligence_candidate_keys(u,clock_timestamp())k
 where not exists(select from public.academic_intelligence_jobs j where j.user_id=u and j.job_key=k.job_key)order by k.due_at,k.job_key limit 8;
 perform intelligence_blocker_test.assert(public.academic_intelligence_remaining_quota(u,clock_timestamp())=2,'parallel fixture has exactly two new-job slots remaining');
end;$$;
reset role;
