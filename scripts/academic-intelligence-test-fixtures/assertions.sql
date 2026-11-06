-- Invented owners and source observations. No network or private schedule.
create schema intelligence_test;
create table intelligence_test.assertions(name text primary key);
create function intelligence_test.assert(ok boolean,label text)returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Academic intelligence assertion failed: %',label;end if;
 insert into intelligence_test.assertions values(label);
end;$$;
grant usage on schema intelligence_test to service_role;
grant all on all tables in schema intelligence_test to service_role;
grant execute on all functions in schema intelligence_test to service_role;
insert into auth.users values('f6000000-0000-4000-8000-000000000001'),('f6000000-0000-4000-8000-000000000002'),('f6000000-0000-4000-8000-000000000003');
insert into public.profiles(user_id,status,role,telegram_user_id,timezone)values
 ('f6000000-0000-4000-8000-000000000001','active','user',760001,'UTC'),
 ('f6000000-0000-4000-8000-000000000002','active','user',760002,'UTC'),
 ('f6000000-0000-4000-8000-000000000003','blocked','user',760003,'UTC');
insert into public.user_lms_settings(user_id,platform_type,username,encrypted_password,is_active,is_token_valid,last_sync_success_at,session_state)values
 ('f6000000-0000-4000-8000-000000000001','aitu_moodle','synthetic','enc:v1:AA:BB:CC',true,true,clock_timestamp(),'connected'),
 ('f6000000-0000-4000-8000-000000000002','aitu_moodle','synthetic','enc:v1:AA:BB:CC',true,true,clock_timestamp(),'connected');
insert into public.lms_sync_leases(user_id,platform_type,owner,expires_at)values
 ('f6000000-0000-4000-8000-000000000001','aitu_moodle','f6100000-0000-4000-8000-000000000001',clock_timestamp()+interval'10 minutes'),
 ('f6000000-0000-4000-8000-000000000002','aitu_moodle','f6100000-0000-4000-8000-000000000002',clock_timestamp()+interval'10 minutes');
insert into public.external_sources(user_id,source_key,source_type,display_name,status)values
 ('f6000000-0000-4000-8000-000000000001','university_platform','university','Synthetic source','connected'),
 ('f6000000-0000-4000-8000-000000000002','university_platform','university','Synthetic source','connected');
create function intelligence_test.item(item text,score numeric,maximum numeric default 10)returns jsonb language sql as $$
 select jsonb_build_object('courseId','42','itemId',item,'courseTitle','Synthetic course','itemTitle','Synthetic item '||item,'score',score,'maxScore',maximum,'sourceUrl','https://lms.astanait.edu.kz/course/view.php?id=42');
$$;
create function intelligence_test.run(complete boolean default false,success boolean default true)returns uuid language plpgsql as $$declare r uuid;begin
 insert into public.sync_runs(user_id,source_id,source_key,status,started_at,finished_at,metadata_json)
 select user_id,id,source_key,case when success then'success'else'failed'end,clock_timestamp()-interval'1 second',clock_timestamp(),
 jsonb_build_object('moodle_grades_synced',true,'moodle_grade_inventory_complete',complete)
 from public.external_sources where user_id='f6000000-0000-4000-8000-000000000001'returning id into r;return r;
end;$$;
create function intelligence_test.staged(payload jsonb,complete boolean default false,success boolean default true)returns uuid language plpgsql as $$declare r uuid;begin
 r:=intelligence_test.run(complete);update public.sync_runs set status='running',finished_at=null where id=r;
 perform public.stage_moodle_grade_snapshot('f6000000-0000-4000-8000-000000000001',r,'f6100000-0000-4000-8000-000000000001',complete,payload);
 update public.sync_runs set status=case when success then'success'else'failed'end,finished_at=clock_timestamp()where id=r;return r;
end;$$;
create function intelligence_test.capture(payload jsonb,complete boolean default false)returns jsonb language sql as $$
 select public.capture_moodle_grade_snapshot('f6000000-0000-4000-8000-000000000001',intelligence_test.staged(payload,complete),'f6100000-0000-4000-8000-000000000001',complete,payload);
$$;
create function intelligence_test.facts(item text,score numeric,maximum numeric default 10)returns void language plpgsql as $$declare eid uuid;begin
 insert into public.source_events(user_id,source_key,external_id,event_type,title,status,raw_json)
 select user_id,source_key,'academic:moodle:42:'||item,'academic_grade','Synthetic item '||item,'active',jsonb_build_object('moodle_course_id','42','moodle_item_id',item)
 from public.external_sources where user_id='f6000000-0000-4000-8000-000000000001'
 on conflict(user_id,source_key,external_id)do update set raw_json=excluded.raw_json returning id into eid;
 if exists(select from public.academic_records where user_id='f6000000-0000-4000-8000-000000000001'and source_event_id=eid)then
  update public.academic_records set score=facts.score,max_score=maximum,raw_json=jsonb_build_object('moodle_course_id','42','moodle_item_id',item)where user_id='f6000000-0000-4000-8000-000000000001'and source_event_id=eid;
 else insert into public.academic_records(user_id,source_event_id,course_title,record_type,title,score,max_score,raw_json)
 values('f6000000-0000-4000-8000-000000000001',eid,'Synthetic course','assignment','Synthetic item '||item,score,maximum,jsonb_build_object('moodle_course_id','42','moodle_item_id',item));end if;
end;$$;
grant execute on all functions in schema intelligence_test to service_role;
set role service_role;
select intelligence_test.assert(public.academic_intelligence_forecast_key('{"calculator":{"values":{"a":0},"target":70}}',clock_timestamp())=public.academic_intelligence_forecast_key('{"calculator":{"values":{"a":100},"target":70}}',clock_timestamp()),'saved hypothetical calculator values do not invalidate actual grade preparation');
select intelligence_test.assert((public.academic_intelligence_feed('f6000000-0000-4000-8000-000000000001')->'preferences'->'gradeAlertsEnabled')='false','grade consent starts off');
select intelligence_test.assert((public.academic_intelligence_feed('f6000000-0000-4000-8000-000000000001')->'preferences'->'quizAlertsEnabled')='false','quiz consent starts off');
select intelligence_test.assert((intelligence_test.capture(jsonb_build_array(intelligence_test.item('1',null),intelligence_test.item('2',6)))->>'eventsCreated')::int=0,'incomplete first observation is baseline only');
select intelligence_test.assert((intelligence_test.capture(jsonb_build_array(intelligence_test.item('1',0,null),intelligence_test.item('3',8)))->>'eventsCreated')::int=1,'known unknown becomes posted zero; unseen incomplete grade stays baseline');
select intelligence_test.assert((select new_score=0 and new_max_score is null and old_score is null and kind='posted'from public.academic_grade_events),'zero and unknown maximum preserved');
select intelligence_test.assert((select count(*)=3 from public.academic_grade_observations),'missing observed items are retained');
select intelligence_test.capture(jsonb_build_array(intelligence_test.item('1',9,30)));
select intelligence_test.capture(jsonb_build_array(intelligence_test.item('1',0,null)));
select intelligence_test.assert((select count(*)=3 and count(distinct revision)=3 from public.academic_grade_events where moodle_item_id='1'),'A to B to A corrections remain distinct');
select intelligence_test.assert((select count(*)=0 from public.reminders),'history capture creates no delivery');
do $$declare r uuid;before_count bigint;payload jsonb;begin
 payload:=jsonb_build_array(intelligence_test.item('1',4));r:=intelligence_test.staged(payload);
 perform public.capture_moodle_grade_snapshot('f6000000-0000-4000-8000-000000000001',r,'f6100000-0000-4000-8000-000000000001',false,payload);
 select count(*)into before_count from public.academic_grade_events;
 perform intelligence_test.assert((select records is null and fingerprint is not null from public.academic_grade_pending_snapshots where run_id=r),'successful capture clears payload after immutable receipt');
 perform intelligence_test.assert(public.capture_moodle_grade_snapshot('f6000000-0000-4000-8000-000000000001',r,'f6100000-0000-4000-8000-000000000001',false,payload)=(select result from public.academic_grade_sync_receipts where run_id=r),'lost acknowledgement returns original result after payload clearing');
 perform intelligence_test.assert((select count(*)=before_count from public.academic_grade_events),'exact run replay after consumed payload does not duplicate history');
 begin perform public.capture_moodle_grade_snapshot('f6000000-0000-4000-8000-000000000001',r,'f6100000-0000-4000-8000-000000000001',false,jsonb_build_array(intelligence_test.item('1',5)));raise exception'run collision accepted';exception when serialization_failure then null;end;
 perform intelligence_test.assert((select count(*)=before_count from public.academic_grade_events),'changed run replay rolls back');
 begin perform public.capture_moodle_grade_snapshot('f6000000-0000-4000-8000-000000000001',intelligence_test.run(false,false),'f6100000-0000-4000-8000-000000000001',false,payload);raise exception'failed run accepted';exception when insufficient_privilege then null;end;
 perform intelligence_test.assert((select count(*)=before_count from public.academic_grade_events),'failed synchronization advances no observation');
 begin perform public.capture_moodle_grade_snapshot('f6000000-0000-4000-8000-000000000001',intelligence_test.run(false),'f6100000-0000-4000-8000-000000000002',false,payload);raise exception'foreign lease accepted';exception when insufficient_privilege then null;end;
 perform intelligence_test.assert((select count(*)=before_count from public.academic_grade_events),'foreign lease cannot mutate history');
 begin update public.academic_grade_events set new_score=999;raise exception'history updated';exception when insufficient_privilege then null;end;
 perform intelligence_test.assert(true,'service cannot rewrite event history');
end;$$;
-- The 15 snapshot is successful but its capture RPC fails before acknowledgement.
-- A later fetch must replay 15 before 20; no next-snapshot substitution is safe.
select intelligence_test.capture(jsonb_build_array(intelligence_test.item('50',10,30)));
do $$declare r15 uuid;r20 uuid;failed uuid;before_count bigint;result jsonb;begin
 select count(*)into before_count from public.academic_grade_events;
 r15:=intelligence_test.staged(jsonb_build_array(intelligence_test.item('50',15,30)));
 begin
  perform public.capture_moodle_grade_snapshot('f6000000-0000-4000-8000-000000000001',r15,'f6100000-0000-4000-8000-000000000001',false,jsonb_build_array(intelligence_test.item('50',15,30)));
  raise exception'simulated capture transaction failure'using errcode='P9001';
 exception when sqlstate'P9001'then null;end;
 failed:=intelligence_test.staged(jsonb_build_array(intelligence_test.item('50',17,30)),false,false);
 r20:=intelligence_test.staged(jsonb_build_array(intelligence_test.item('50',20,30)));
 begin
  perform public.capture_moodle_grade_snapshot('f6000000-0000-4000-8000-000000000001',r20,'f6100000-0000-4000-8000-000000000001',false,jsonb_build_array(intelligence_test.item('50',20,30)));
  raise exception'out of order capture accepted';
 exception when serialization_failure then null;end;
 perform intelligence_test.assert((select score=10 from public.academic_grade_observations where moodle_item_id='50')and public.academic_intelligence_feed('f6000000-0000-4000-8000-000000000001')->'historyPending'='true'::jsonb,'unacknowledged successful snapshot is durably pending and visible as processing');
 result:=public.drain_moodle_grade_snapshots('f6000000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000001');
 perform intelligence_test.assert(result->>'drained'='2'and result->>'remaining'='false','successful staged snapshots recover in observed order');
 perform intelligence_test.assert((select array_agg(new_score order by revision)=array[15,20]::numeric[]and array_agg(old_score order by revision)=array[10,15]::numeric[]from public.academic_grade_events where moodle_item_id='50'),'capture failure preserves both 10 to15 and15 to20 transitions');
 perform intelligence_test.assert(not exists(select from public.academic_grade_sync_receipts where run_id=failed)and(select count(*)=before_count+2 from public.academic_grade_events)and(select records is not null from public.academic_grade_pending_snapshots where run_id=failed),'staged failed run never publishes and its unconsumed payload remains');
 begin update public.academic_grade_pending_snapshots set records=null where run_id=failed;raise exception'unconsumed payload cleared';exception when insufficient_privilege then null;end;
 perform intelligence_test.assert((select records is not null from public.academic_grade_pending_snapshots where run_id=failed),'service cannot clear an unconsumed or failed staged payload');
 result:=public.drain_moodle_grade_snapshots('f6000000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000001');
 perform intelligence_test.assert(result->>'drained'='0'and public.academic_intelligence_feed('f6000000-0000-4000-8000-000000000001')->'historyPending'='false'::jsonb,'ambiguous capture acknowledgement replays without duplication and failed stages are not pending history');
end;$$;
select public.academic_intelligence_service('f6000000-0000-4000-8000-000000000001','preferences','{"expectedRevision":0,"expectedAcademicRevision":0,"preferences":{"gradeAlertsEnabled":true,"assignmentAlertsEnabled":false,"quizAlertsEnabled":false,"assignmentOffsetsMinutes":[4320,1440],"quizOffsetsMinutes":[4320,1440],"quietStart":"00:00","quietEnd":"00:00"}}');
select intelligence_test.assert((select count(*)=0 from public.academic_intelligence_candidates('f6000000-0000-4000-8000-000000000001',clock_timestamp())),'opt in does not replay old history');
select intelligence_test.facts('1',8);
select intelligence_test.capture(jsonb_build_array(intelligence_test.item('1',8)));
do $$declare c jsonb;rid uuid;token uuid;recipient bigint;begin
 select v into c from public.academic_intelligence_candidates('f6000000-0000-4000-8000-000000000001',clock_timestamp())v limit 1;
 perform intelligence_test.assert(c is not null,'new consented grade is eligible');
 perform intelligence_test.assert(public.prepare_academic_intelligence_notification('f6000000-0000-4000-8000-000000000001',c->>'key',c->>'fingerprint','Synthetic prepared grade','[]'),'first prepare succeeds');
 perform intelligence_test.assert(not public.prepare_academic_intelligence_notification('f6000000-0000-4000-8000-000000000001',c->>'key',c->>'fingerprint','Synthetic prepared grade','[]'),'repeated preparation preserves one receipt');
 perform intelligence_test.capture(jsonb_build_array(intelligence_test.item('1',8)));
 update public.user_lms_settings set last_sync_success_at=clock_timestamp()where user_id='f6000000-0000-4000-8000-000000000001';
 perform intelligence_test.assert(exists(select from public.academic_intelligence_candidates('f6000000-0000-4000-8000-000000000001',clock_timestamp())v where v->>'key'=c->>'key'and v->>'fingerprint'=c->>'fingerprint'),'unchanged verified refresh preserves semantic prepared fingerprint');
 select id,claim_token into rid,token from public.claim_due_reminders(clock_timestamp(),1);
 recipient:=public.begin_notification_delivery('reminder','f6000000-0000-4000-8000-000000000001',rid,token);
 perform intelligence_test.assert(recipient=760001,'existing durable begin accepts current bound grade');
 perform public.finish_notification_delivery('reminder','f6000000-0000-4000-8000-000000000001',rid,token,'unknown','transport_unknown',null,null);
 perform intelligence_test.assert((select status='unknown'and delivery_attempts=1 from public.reminders where id=rid),'ambiguous delivery receipt preserved');
 perform intelligence_test.assert(not public.prepare_academic_intelligence_notification('f6000000-0000-4000-8000-000000000001',c->>'key',c->>'fingerprint','Synthetic prepared grade','[]'),'unknown delivery never reopens');
end;$$;
select intelligence_test.facts('1',6);
select intelligence_test.capture(jsonb_build_array(intelligence_test.item('1',6)));
do $$declare c jsonb;rid uuid;token uuid;begin
 select v into c from public.academic_intelligence_candidates('f6000000-0000-4000-8000-000000000001',clock_timestamp())v limit 1;
 perform public.prepare_academic_intelligence_notification('f6000000-0000-4000-8000-000000000001',c->>'key',c->>'fingerprint','Synthetic prepared grade','[]');
 select id,claim_token into rid,token from public.claim_due_reminders(clock_timestamp(),1);
 perform intelligence_test.facts('1',7);
 perform intelligence_test.assert(public.begin_notification_delivery('reminder','f6000000-0000-4000-8000-000000000001',rid,token)is null,'changed grade blocks already prepared old value');
end;$$;
select intelligence_test.facts('1',7);
select intelligence_test.capture(jsonb_build_array(intelligence_test.item('1',7)));
do $$declare c jsonb;rid uuid;token uuid;begin
 select v into c from public.academic_intelligence_candidates('f6000000-0000-4000-8000-000000000001',clock_timestamp())v limit 1;
 perform public.prepare_academic_intelligence_notification('f6000000-0000-4000-8000-000000000001',c->>'key',c->>'fingerprint','Synthetic prepared grade','[]');
 select id,claim_token into rid,token from public.claim_due_reminders(clock_timestamp(),1);
 perform public.academic_intelligence_service('f6000000-0000-4000-8000-000000000001','preferences','{"expectedRevision":1,"expectedAcademicRevision":1,"preferences":{"gradeAlertsEnabled":false,"assignmentAlertsEnabled":false,"quizAlertsEnabled":false,"assignmentOffsetsMinutes":[4320,1440],"quizOffsetsMinutes":[4320,1440],"quietStart":"00:00","quietEnd":"00:00"}}');
 perform intelligence_test.assert(public.begin_notification_delivery('reminder','f6000000-0000-4000-8000-000000000001',rid,token)is null,'revoked consent blocks already prepared grade');
 perform intelligence_test.assert((select status='cancelled'and delivery_attempts=0 from public.reminders where id=rid),'revoked job never begins external send');
end;$$;
select intelligence_test.assert(jsonb_array_length(public.academic_intelligence_feed('f6000000-0000-4000-8000-000000000002')->'events')=0,'different owner history is empty');
-- The second invented owner isolates this quiet-hour race from the first
-- owner's receipt/rate-limit assertions. No SQL clock or external sender exists.
do $$declare owner_id uuid:='f6000000-0000-4000-8000-000000000002';lease_id uuid:='f6100000-0000-4000-8000-000000000002';
 run_id uuid;source_id uuid;record_source uuid;rid uuid;token uuid;value numeric;payload jsonb;c jsonb;current_candidate jsonb;saved_preferences jsonb;
 quiet_start text;quiet_end text;original_created_at timestamptz;begin
 perform public.academic_intelligence_service(owner_id,'preferences','{"expectedRevision":0,"expectedAcademicRevision":0,"preferences":{"gradeAlertsEnabled":true,"assignmentAlertsEnabled":false,"quizAlertsEnabled":false,"assignmentOffsetsMinutes":[4320,1440],"quizOffsetsMinutes":[4320,1440],"quietStart":"00:00","quietEnd":"00:00"}}');
 select id into source_id from public.external_sources where user_id=owner_id and source_key='university_platform';
 foreach value in array array[null::numeric,8::numeric]loop
  payload:=jsonb_build_array(intelligence_test.item('901',value,0));
  insert into public.sync_runs(user_id,source_id,source_key,status,started_at,metadata_json)
  values(owner_id,source_id,'university_platform','running',clock_timestamp(),'{"moodle_grades_synced":true,"moodle_grade_inventory_complete":false}')returning id into run_id;
  perform public.stage_moodle_grade_snapshot(owner_id,run_id,lease_id,false,payload);
  update public.sync_runs set status='success',finished_at=clock_timestamp()where id=run_id and user_id=owner_id;
  perform public.capture_moodle_grade_snapshot(owner_id,run_id,lease_id,false,payload);
 end loop;
 insert into public.source_events(user_id,source_key,external_id,event_type,title,status,raw_json)
 values(owner_id,'university_platform','academic:moodle:42:901','academic_grade','Synthetic quiet grade','active','{"moodle_course_id":"42","moodle_item_id":"901"}')returning id into record_source;
 insert into public.academic_records(user_id,source_event_id,course_title,record_type,title,score,max_score,raw_json)
 values(owner_id,record_source,'Synthetic course','assignment','Synthetic quiet grade',8,0,'{"moodle_course_id":"42","moodle_item_id":"901"}');
 perform intelligence_test.assert((select new_score=8 and new_max_score is null from public.academic_grade_events where user_id=owner_id),'zero placeholder maximum remains unknown without suppressing known score');
 select v into c from public.academic_intelligence_grade_candidates(owner_id,clock_timestamp())v limit 1;
 perform intelligence_test.assert(c is not null and public.prepare_academic_intelligence_notification(owner_id,c->>'key',c->>'fingerprint','Synthetic quiet grade','[]'),'quiet race begins with a current prepared grade');
 select reminder_id into rid from public.academic_intelligence_jobs where user_id=owner_id and job_key=c->>'key';
 select created_at into original_created_at from public.reminders where id=rid and user_id=owner_id;
 perform public.academic_intelligence_service(owner_id,'preferences','{"expectedRevision":1,"expectedAcademicRevision":1,"preferences":{"gradeAlertsEnabled":true,"assignmentAlertsEnabled":false,"quizAlertsEnabled":true,"assignmentOffsetsMinutes":[4320,1440],"quizOffsetsMinutes":[4320,1440],"quietStart":"00:00","quietEnd":"00:00"}}');
 select v into c from public.academic_intelligence_grade_candidates(owner_id,clock_timestamp())v limit 1;
 perform intelligence_test.assert(c is not null and(select grade_consent_revision=1 and revision=2 from public.academic_intelligence_preferences where user_id=owner_id),'unrelated preference edit preserves the original grade consent epoch');
 perform intelligence_test.assert(public.prepare_academic_intelligence_notification(owner_id,c->>'key',c->>'fingerprint','Synthetic updated grade','[]'),'current grade can be safely reprepared after unrelated preference change');
 select claim_token into token from public.claim_due_reminders(clock_timestamp(),100)where id=rid and user_id=owner_id;
 select preferences into saved_preferences from public.academic_notification_preferences where user_id=owner_id;
 quiet_start:=to_char((clock_timestamp()at time zone'UTC')-interval'1 minute','HH24:MI');
 quiet_end:=to_char((clock_timestamp()at time zone'UTC')+interval'2 minutes','HH24:MI');
 -- Direct fixture changes keep the consent revision fixed while moving the
 -- current clock into/out of quiet hours; production changes use the API.
 update public.academic_notification_preferences set preferences=preferences||jsonb_build_object('quietStart',quiet_start,'quietEnd',quiet_end)where user_id=owner_id;
 perform intelligence_test.assert(public.academic_intelligence_quiet(owner_id,clock_timestamp())and public.begin_notification_delivery('reminder',owner_id,rid,token)is null
  and(select status='cancelled'and delivery_attempts=0 from public.reminders where user_id=owner_id and id=rid),'quiet hours cancel a claimed grade before external delivery');
 update public.academic_notification_preferences set preferences=saved_preferences where user_id=owner_id;
 select v into current_candidate from public.academic_intelligence_grade_candidates(owner_id,clock_timestamp())v where v->>'key'=c->>'key';
 perform intelligence_test.assert(current_candidate->>'fingerprint'=c->>'fingerprint'
  and exists(select from public.academic_intelligence_planning_candidates(owner_id,clock_timestamp())v where v->>'key'=c->>'key'),'unchanged current grade returns to planning after quiet hours');
 perform intelligence_test.assert(public.prepare_academic_intelligence_notification(owner_id,current_candidate->>'key',current_candidate->>'fingerprint','Synthetic quiet grade resumed','[]'),'quiet recovery preparation succeeds');
 perform intelligence_test.assert((select status='pending'and delivery_attempts=0 and failure_count=0 and created_at=original_created_at from public.reminders where user_id=owner_id and id=rid)
  and(select count(*)=1 from public.academic_intelligence_jobs where user_id=owner_id),'quiet recovery reuses the never attempted grade binding without resetting receipts');
 update public.academic_intelligence_preferences set grade_alerts_enabled=false where user_id=owner_id;
 update public.reminders set status='cancelled'where user_id=owner_id and id=rid;
end;$$;

select intelligence_test.assert(public.academic_intelligence_feed('f6000000-0000-4000-8000-000000000003')is null,'blocked owner feed denied');
reset role;
select intelligence_test.assert(not has_table_privilege('authenticated','public.academic_grade_events','SELECT'),'browser has no raw grade history table privilege');
select intelligence_test.assert(not has_function_privilege('authenticated','public.capture_moodle_grade_snapshot(uuid,uuid,uuid,boolean,jsonb)','EXECUTE'),'browser cannot submit snapshots');
create table intelligence_test.parallel(run_id uuid,payload jsonb);
insert into intelligence_test.parallel select intelligence_test.run(false),jsonb_build_array(intelligence_test.item('99',null));
select intelligence_test.capture((select payload from intelligence_test.parallel));
update intelligence_test.parallel set run_id=intelligence_test.staged(jsonb_build_array(intelligence_test.item('99',9))),payload=jsonb_build_array(intelligence_test.item('99',9));
grant select on intelligence_test.parallel to service_role;
