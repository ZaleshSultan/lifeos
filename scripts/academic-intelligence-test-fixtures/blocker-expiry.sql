-- Intended contract: freshness changes must fence old exact forecast at begin.
set role service_role;
do $$declare
 u uuid:='f6000000-0000-4000-8000-000000000041';course_uuid uuid:='f6410000-0000-4000-8000-000000000041';
 run_id uuid;record_a uuid;record_b uuid;definition_text text;bindings_key text;binding jsonb;review jsonb;
 before_candidate jsonb;after_candidate jsonb;before_time timestamptz;after_time timestamptz;rid uuid;token uuid;recipient bigint;
begin
 run_id:=intelligence_blocker_test.new_run(u);
 record_a:=intelligence_blocker_test.fact(u,'4101',8,run_id,clock_timestamp(),clock_timestamp()-interval'1 minute');
 record_b:=intelligence_blocker_test.fact(u,'4102',5,run_id,clock_timestamp()-interval'47 hours',null);
 definition_text:='{"version":1,"sourceName":"Reviewed synthetic syllabus p2","attestationThreshold":25,"fields":[{"id":"a","label":"ATT1","period":"att1","weightPercent":100},{"id":"b","label":"ATT2","period":"att2","weightPercent":100},{"id":"exam","label":"Exam","period":"exam","weightPercent":100}]}';
 binding:=jsonb_build_object('a',jsonb_build_object('mode','aggregate','ruleConfirmed',true,'entries',jsonb_build_array(jsonb_build_object('recordId',record_a,'weight',100))),
 'b',jsonb_build_object('mode','aggregate','ruleConfirmed',true,'entries',jsonb_build_array(jsonb_build_object('recordId',record_b,'weight',100))));
 bindings_key:=format('[["a","aggregate",true,[["%s",100]]],["b","aggregate",true,[["%s",100]]]]',record_a,record_b);
 insert into public.study_courses(id,user_id,code,title,status,external_course_key,metadata)
 values(course_uuid,u,'SYNTHETIC_REVIEW','Synthetic review course','active','moodle:42',jsonb_build_object(
 'study_calculator_v1',jsonb_build_object('definition',definition_text::jsonb,'values','{"a":100,"b":100,"exam":100}'::jsonb,'target',70),
 'scholarship_planner_v1',jsonb_build_object('version',1,'bindings',binding)));
 review:=jsonb_build_object('version',1,'externalCourseKey','moodle:42','definitionKey',definition_text,'bindingsKey',bindings_key,
 'contextKey','{"externalCourseKey":"moodle:42","startsOn":null,"endsOn":null}','reviewedAt',clock_timestamp()-interval'1 minute',
 'sourceRef','Synthetic owner-reviewed syllabus p2','supportedPolicy','linear-30-30-40');
 update public.academic_intelligence_preferences set course_reviews=jsonb_build_object(course_uuid::text,review)where user_id=u;
 -- Tight two-second edge is set only after fixture construction.
 update public.academic_grade_observations set last_verified_at=clock_timestamp()-interval'48 hours'+interval'2 seconds'
 where user_id=u and moodle_item_id='4102';
 before_time:=clock_timestamp();
 select v into before_candidate from public.academic_intelligence_grade_candidates(u,before_time)v;
 perform intelligence_blocker_test.assert(before_candidate is not null,'repro1 current mapped posted grade is eligible');
 perform intelligence_blocker_test.assert(exists(select from jsonb_array_elements(before_candidate->'forecast'->'records')r
 where r->>'id'=record_b::text and (r->>'updatedAt')::timestamptz between before_time-interval'48 hours'and before_time),'repro1 contributing recordB is fresh at render time');
 insert into intelligence_blocker_test.render_inputs values('before',jsonb_build_object('candidate',before_candidate,'now',before_time));
 perform intelligence_blocker_test.assert(public.prepare_academic_intelligence_notification(u,before_candidate->>'key',before_candidate->>'fingerprint','Synthetic confirmed forecast rendered before48h threshold','[]'),'repro1 old render is prepared under live consent');
 select reminder_id into rid from public.academic_intelligence_jobs where user_id=u and job_key=before_candidate->>'key';
 select claim_token into token from public.claim_due_reminders(clock_timestamp(),100)where id=rid and user_id=u;
 perform intelligence_blocker_test.assert(token is not null,'repro1 real reminder claim acquired');
 perform pg_sleep(3);
 after_time:=clock_timestamp();
 select v into after_candidate from public.academic_intelligence_grade_candidates(u,after_time)v where v->>'key'=before_candidate->>'key';
 perform intelligence_blocker_test.assert(after_candidate is not null,'repro1 grade itself and source remain eligible after48h boundary');
 perform intelligence_blocker_test.assert(exists(select from jsonb_array_elements(after_candidate->'forecast'->'records')r
 where r->>'id'=record_b::text and (r->>'updatedAt')::timestamptz<after_time-interval'48 hours'),'repro1 contributing recordB is now stale by actual elapsed time');
 insert into intelligence_blocker_test.render_inputs values('after',jsonb_build_object('candidate',after_candidate,'now',after_time));
  recipient:=public.begin_notification_delivery('reminder',u,rid,token);
 perform intelligence_blocker_test.assert(recipient is null and exists(select from public.reminders where id=rid and user_id=u and status='cancelled'and delivery_attempts=0),'final begin rejects the queued exact forecast after a mapped record expires');
 perform intelligence_blocker_test.assert(before_candidate->>'fingerprint'<>after_candidate->>'fingerprint','mapped record48h expiry changes semantic forecast eligibility');
 perform intelligence_blocker_test.assert(public.begin_notification_delivery('reminder',u,rid,token)is null,'replayed stale claim cannot begin after rejection');
 perform intelligence_blocker_test.assert(public.prepare_academic_intelligence_notification(u,after_candidate->>'key',after_candidate->>'fingerprint','Synthetic uncertainty fallback after evidence expiry','[]'),'fresh planner process can reprepare only the never-attempted downgraded grade');
 perform intelligence_blocker_test.assert(not public.prepare_academic_intelligence_notification(u,after_candidate->>'key',after_candidate->>'fingerprint','Synthetic repeated fallback','[]'),'restart replay does not duplicate a prepared fallback binding');
 select claim_token into token from public.claim_due_reminders(clock_timestamp(),100)where id=rid and user_id=u;
 recipient:=public.begin_notification_delivery('reminder',u,rid,token);
 perform intelligence_blocker_test.assert(recipient=760041,'current uncertainty fallback may cross original owner/token/lease fence');
 -- No actual sender exists. Preserve a closed synthetic ambiguous receipt.
 perform public.finish_notification_delivery('reminder',u,rid,token,'unknown','synthetic_no_send',null,null);
end;$$;


reset role;
