set role service_role;
select academic_test.assert((select count(*)=8 from academic_test.parallel_imports),'eight import transactions completed');
select academic_test.assert((select sum((result->>'created')::int)=1 and sum((result->>'unchanged')::int)=7 from academic_test.parallel_imports),'concurrent different format keys create one natural event');
select academic_test.assert((select count(*)=1 from public.academic_events where user_id='f0000000-0000-4000-8000-000000000001'and original_record->>'title'='Synthetic concurrent exam'),'natural identity unique under concurrent imports');
select academic_test.assert((select count(*)=8 from academic_test.parallel_plans),'eight planner transactions completed');
select academic_test.assert((select sum((result->>'queued')::int)=1 from academic_test.parallel_plans),'concurrent planners enqueue one job');
select academic_test.assert((select count(*)=1 and count(distinct id)=1 from academic_test.parallel_claims),'eight competing claimers claim one existing reminder once');

do $$declare u uuid:='f0000000-0000-4000-8000-000000000001';r public.reminders;j public.academic_notification_jobs;v jsonb;payload jsonb;event_id uuid;next_revision int;assignment_id uuid:='f2000000-0000-4000-8000-000000000001';claim public.reminders;target timestamptz;local_day date;slot_id uuid:='f3000000-0000-4000-8000-000000000001';caught boolean;
begin
 select *into j from public.academic_notification_jobs where user_id=u and kind='university_exam';select *into r from public.reminders where id=j.reminder_id;
 perform academic_test.assert(public.begin_notification_delivery('reminder',u,r.id,r.claim_token)=700001,'approved bound job crosses existing begin boundary');
 perform academic_test.assert(public.finish_notification_delivery('reminder',u,r.id,r.claim_token,'sent','none',42,null),'acknowledged message receipt persists through existing finish');
 perform academic_test.assert((public.plan_academic_notifications(u)->>'queued')::int=0,'sent notification never replanned');
 select id into event_id from public.academic_events where user_id=u and original_record->>'title'='Synthetic concurrent exam';
 perform public.academic_service(u,'revise_event',jsonb_build_object('id',event_id,'expectedRevision',1,'patch',jsonb_build_object('title','Synthetic edited after sent'),'confirmed',true));
 perform academic_test.assert((public.plan_academic_notifications(u)->>'queued')::int=0,'source edits preserve sent delivery identity');
 select revision into next_revision from public.academic_notification_preferences where user_id=u;
 begin perform public.academic_service(u,'save_preferences',jsonb_build_object('expectedRevision',0,'preferences',public.academic_default_preferences()));raise exception 'stale preference accepted';exception when serialization_failure then null;end;
 perform academic_test.assert((select revision=next_revision from public.academic_notification_preferences where user_id=u),'stale preference CAS cannot revoke or enable');

 -- A genuine assignment from a fresh synthetic session is distinct from a quiz
 -- or a grade row with a missing score. There are no actual LMS requests.
 insert into public.user_lms_settings(user_id,platform_type,auth_mode,session_state,is_active,is_token_valid,session_expires_at,last_sync_success_at)values(u,'aitu_moodle','session','connected',true,true,clock_timestamp()+interval'1 day',clock_timestamp());
 insert into public.source_events(id,user_id,source_key,external_id,event_type,title,due_at,source_url,raw_json)values
 (assignment_id,u,'university_platform','activity:moodle:101:assign:901','task','Synthetic verified assignment',clock_timestamp()+interval'30 minutes','https://lms.astanait.edu.kz/mod/assign/view.php?id=901','{"module_type":"assign","assessment_type":"assignment","moodle_course_id":"101","moodle_cmid":"901","submission_status":"not_submitted","course_title":"Synthetic systems"}'),
 ('f2000000-0000-4000-8000-000000000002',u,'university_platform','activity:moodle:101:quiz:902','task','Synthetic quiz',clock_timestamp()+interval'30 minutes',null,'{"module_type":"quiz","assessment_type":"quiz","moodle_course_id":"101","moodle_cmid":"902","submission_status":"not_submitted"}'),
 ('f2000000-0000-4000-8000-000000000003',u,'university_platform','activity:moodle:101:assign:903','task','Synthetic unknown submission',clock_timestamp()+interval'30 minutes',null,'{"module_type":"assign","assessment_type":"assignment","moodle_course_id":"101","moodle_cmid":"903","submission_status":"unknown"}');
 perform public.academic_service(u,'save_preferences',jsonb_build_object('expectedRevision',next_revision,'preferences',public.academic_default_preferences()||'{"assignmentAlertsEnabled":true,"assignmentOffsetsMinutes":[30],"quietStart":"00:00","quietEnd":"00:00"}'::jsonb));
 perform academic_test.assert((public.plan_academic_notifications(u)->>'queued')::int=1,'only verified unfinished assign module is scheduled');
 perform academic_test.assert((select count(*)=2 from public.academic_assignment_rows(u,clock_timestamp())),'quiz not listed as genuine Moodle assignment');
 insert into public.source_events(id,user_id,source_key,external_id,event_type,title,due_at,raw_json)values
 ('f2000000-0000-4000-8000-000000000004',u,'university_platform','activity:moodle:101:assign:904','task','Synthetic Midterm project upload',clock_timestamp()+interval'30 minutes','{"module_type":"assign","assessment_type":"midterm","moodle_course_id":"101","moodle_cmid":"904","submission_status":"not_submitted"}'),
 ('f2000000-0000-4000-8000-000000000005',u,'university_platform','activity:moodle:101:assign:905','task','Synthetic Exam preparation upload',clock_timestamp()+interval'30 minutes','{"module_type":"assign","assessment_type":"exam","moodle_course_id":"101","moodle_cmid":"905","submission_status":"not_submitted"}'),
 ('f2000000-0000-4000-8000-000000000006',u,'university_platform','activity:moodle:101:quiz:906','task','Synthetic assignment titled quiz',clock_timestamp()+interval'30 minutes','{"module_type":"quiz","assessment_type":"assignment","moodle_course_id":"101","moodle_cmid":"906","submission_status":"not_submitted"}'),
 ('f2000000-0000-4000-8000-000000000007',u,'university_platform','grade-only-907','task','Synthetic grade-only missing score',clock_timestamp()+interval'30 minutes','{"assessment_type":"assignment","submission_status":"not_submitted"}');
 perform academic_test.assert((select count(*)=4 from public.academic_assignment_rows(u,clock_timestamp())),'actual assign module wins over midterm or exam title classifier');
 perform academic_test.assert((select count(*)=3 from public.academic_candidate_rows(u,clock_timestamp())c where c->>'kind'='assignment'),'three genuine unfinished assignment modules eligible regardless misleading title');
 insert into public.source_events(id,user_id,source_key,external_id,event_type,title,due_at,raw_json)values
 ('f2000000-0000-4000-8000-000000000008',u,'university_platform','assignment:moodle:101:908','task','Synthetic WS assignment without cmid',clock_timestamp()+interval'30 minutes','{"module_type":"assign","assessment_type":"assignment","moodle_course_id":"101","moodle_assignment_id":"908","submission_status":"not_submitted"}'),
 ('f2000000-0000-4000-8000-000000000009',u,'university_platform','activity:moodle:101:assign:909','task','Synthetic fresh incomplete HTML assignment',clock_timestamp()+interval'30 minutes','{"module_type":"assign","assessment_type":"assignment","moodle_course_id":"101","moodle_cmid":"909","submission_status":"not_submitted","ingestion_complete":false,"parser_warnings":[]}'),
 ('f2000000-0000-4000-8000-000000000010',u,'university_platform','activity:moodle:101:assign:910','task','Synthetic retained due assignment',clock_timestamp()+interval'30 minutes','{"module_type":"assign","assessment_type":"assignment","moodle_course_id":"101","moodle_cmid":"910","submission_status":"not_submitted","ingestion_complete":false,"parser_warnings":["previous_due_date_retained"]}'),
 ('f2000000-0000-4000-8000-000000000011',u,'university_platform','activity:moodle:101:assign:911','task','Synthetic old individual assignment',clock_timestamp()+interval'30 minutes','{"module_type":"assign","assessment_type":"assignment","moodle_course_id":"101","moodle_cmid":"911","submission_status":"not_submitted"}'),
 ('f2000000-0000-4000-8000-000000000012',u,'university_platform','activity:moodle:101:assign:912','task','Synthetic future row clock',clock_timestamp()+interval'30 minutes','{"module_type":"assign","assessment_type":"assignment","moodle_course_id":"101","moodle_cmid":"912","submission_status":"not_submitted"}'),
 ('f2000000-0000-4000-8000-000000000013',u,'university_platform','assignment:moodle:102:913','task','Synthetic mismatched WS identity',clock_timestamp()+interval'30 minutes','{"module_type":"assign","assessment_type":"assignment","moodle_course_id":"101","moodle_assignment_id":"913","submission_status":"not_submitted"}');
 update public.source_events set last_synced_at=clock_timestamp()-interval'7 hours'where id='f2000000-0000-4000-8000-000000000011';
 update public.source_events set last_synced_at=clock_timestamp()+interval'10 minutes'where id='f2000000-0000-4000-8000-000000000012';
 perform academic_test.assert(exists(select from public.academic_assignment_rows(u,clock_timestamp())a where a->>'id'='f2000000-0000-4000-8000-000000000008'and a->'verified'='true'),'verified matching WS assignment identity needs no fabricated cmid');
 perform academic_test.assert(not exists(select from public.academic_assignment_rows(u,clock_timestamp())a where a->>'id'='f2000000-0000-4000-8000-000000000013'),'mismatched WS identity cannot establish module provenance');
 perform academic_test.assert((select count(*)=5 from public.academic_candidate_rows(u,clock_timestamp())c where c->>'kind'='assignment'),'fresh incomplete HTML and matching WS eligible alongside three genuine assignments');
 perform academic_test.assert((select count(*)=3 from public.academic_assignment_rows(u,clock_timestamp())a where a->>'id'in('f2000000-0000-4000-8000-000000000010','f2000000-0000-4000-8000-000000000011','f2000000-0000-4000-8000-000000000012')and a->'stale'='true'and a->'verified'='false'),'retained due old row and future row clocks stale despite fresh global LMS');

 perform academic_test.assert(not exists(select from public.academic_assignment_rows(u,clock_timestamp())a where a->>'id'in('f2000000-0000-4000-8000-000000000006','f2000000-0000-4000-8000-000000000007')),'quiz and grade-only metadata cannot invent assign provenance');
 perform academic_test.assert(not exists(select from public.academic_events where user_id=u and record->>'title'in('Synthetic Midterm project upload','Synthetic Exam preparation upload')),'assignment titles do not create university examination events');
 update public.source_events set status='completed',raw_json=jsonb_set(raw_json,'{submission_status}','"submitted"')where user_id=u and id in('f2000000-0000-4000-8000-000000000004','f2000000-0000-4000-8000-000000000005','f2000000-0000-4000-8000-000000000008','f2000000-0000-4000-8000-000000000009');

 select *into j from public.academic_notification_jobs where user_id=u and kind='assignment';
 select *into claim from public.claim_due_reminders(clock_timestamp(),20)where id=j.reminder_id;
 update public.source_events set raw_json=raw_json||'{"parser_warnings":["previous_due_date_retained"],"ingestion_complete":false}'::jsonb where user_id=u and id=assignment_id;
 perform academic_test.assert(public.begin_notification_delivery('reminder',u,claim.id,claim.claim_token)is null,'retained due warning after claim blocks send despite fresh global sync');
 perform academic_test.assert((select status='cancelled'and delivery_attempts=0 from public.reminders where id=j.reminder_id),'retained due rejected before external delivery');
 update public.source_events set raw_json=jsonb_set(raw_json,'{parser_warnings}','[]')where user_id=u and id=assignment_id;
 perform academic_test.assert((public.plan_academic_notifications(u)->>'queued')::int=1,'fresh authoritative due can replace canceled zero-attempt retained-data job');
 select *into claim from public.claim_due_reminders(clock_timestamp(),20)where id=j.reminder_id;
 update public.source_events set status='completed',raw_json=jsonb_set(raw_json,'{submission_status}','"submitted"')where user_id=u and id=assignment_id;
 perform academic_test.assert(public.begin_notification_delivery('reminder',u,claim.id,claim.claim_token)is null,'submission after preparation prevents delivery');
 perform academic_test.assert((select status='cancelled'and delivery_attempts=0 from public.reminders where id=j.reminder_id),'submitted job cancelled before Telegram boundary');
 perform academic_test.assert((public.plan_academic_notifications(u)->>'queued')::int=0,'confirmed submission stops later pending-submission notices');

 -- A future legacy sync cannot bypass new default-off academic preferences.
 insert into public.reminders(user_id,source_event_id,channel,remind_at,message,metadata_json)values(u,assignment_id,'telegram',clock_timestamp()-interval'1 second','Synthetic legacy assignment','{"provider":"university_platform","notification_kind":"academic_assignment_deadline"}')returning id into event_id;
 select *into claim from public.claim_due_reminders(clock_timestamp(),20)where id=event_id;
 perform academic_test.assert(public.begin_notification_delivery('reminder',u,claim.id,claim.claim_token)is null,'unbound legacy source task cannot bypass academic consent');
 insert into public.reminders(user_id,channel,remind_at,message)values(u,'telegram',clock_timestamp()-interval'1 second','Synthetic explicit manual reminder')returning id into event_id;
 select *into claim from public.claim_due_reminders(clock_timestamp(),20)where id=event_id;
 perform academic_test.assert(public.begin_notification_delivery('reminder',u,claim.id,claim.claim_token)=700001,'ordinary manual reminder retains established begin behavior');
 perform public.finish_notification_delivery('reminder',u,claim.id,claim.claim_token,'sent','none',43,null);

 -- Campus clocks are Almaty wall times even when the profile travels to Tokyo.
 update public.profiles set timezone='Asia/Tokyo'where user_id=u;
 local_day:=(clock_timestamp()at time zone'Asia/Almaty')::date+1;
 insert into public.course_schedules(id,study_course_id,day_of_week,start_time,end_time,room)values(slot_id,'f1000000-0000-4000-8000-000000000001',lower(to_char(local_day,'FMDay')),'09:00','10:00','C1.3.319'),('f3000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001',lower(to_char(local_day,'FMDay')),'08:00','09:00','Zoom');
 perform academic_test.assert(not(public.academic_schedule_verification(u,clock_timestamp())->>'current')::boolean,'saved weekly slots alone do not establish current verified schedule');
 perform public.academic_service(u,'verify_schedule',jsonb_build_object('expectedRevision',0,'validFrom',(clock_timestamp()at time zone'Asia/Almaty')::date,'validThrough',local_day+10,'sourceLabel','Synthetic reviewed current timetable','confirmed',true));
 select c into v from public.academic_class_occurrences(u,clock_timestamp())c where c->>'key'='class:'||slot_id||':'||local_day;
 perform academic_test.assert((v->>'startsAt')::timestamptz=(local_day+time'09:00')at time zone'Asia/Almaty','travel profile does not reinterpret campus 09 clock');
 perform academic_test.assert(to_char((v->>'startsAt')::timestamptz at time zone'UTC','HH24:MI')='04:00','Almaty nine is UTC four regardless Tokyo profile');
 select revision into next_revision from public.academic_notification_preferences where user_id=u;
 perform public.academic_service(u,'save_preferences',jsonb_build_object('expectedRevision',next_revision,'preferences',public.academic_default_preferences()||'{"classAlertsEnabled":true,"quietStart":"00:00","quietEnd":"00:00"}'::jsonb));
 perform academic_test.assert(not exists(select from public.academic_candidate_rows(u,(local_day+time'07:50')at time zone'Asia/Almaty')c where c->>'kind'='class'),'explicit Zoom location excluded from physical class alerts');
 select revision into next_revision from public.academic_notification_preferences where user_id=u;
 perform public.academic_service(u,'save_preferences',jsonb_build_object('expectedRevision',next_revision,'preferences',public.academic_default_preferences()||'{"classAlertsEnabled":true,"includeOnlineClasses":true,"quietStart":"00:00","quietEnd":"00:00"}'::jsonb));
 perform academic_test.assert(exists(select from public.academic_candidate_rows(u,(local_day+time'07:50')at time zone'Asia/Almaty')c where c->>'kind'='class'and c->>'room'='Zoom'),'explicit online opt-in allows genuine online class');
 target:=clock_timestamp()+interval'10 minutes';
 insert into public.course_schedules(id,study_course_id,day_of_week,start_time,end_time,room)values('f3000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000001',lower(to_char(target at time zone'Asia/Almaty','FMDay')),(target at time zone'Asia/Almaty')::time,case when(target at time zone'Asia/Almaty')::time<time'23:59'then(target at time zone'Asia/Almaty')::time+interval'1 minute'else time'24:00'end,'C1.3.319');
 perform public.academic_service(u,'verify_schedule',jsonb_build_object('expectedRevision',(public.academic_schedule_verification(u,clock_timestamp())->>'revision')::int,'validFrom',(clock_timestamp()at time zone'Asia/Almaty')::date,'validThrough',local_day+10,'sourceLabel','Synthetic reviewed occurrence test','confirmed',true));
 perform public.plan_academic_notifications(u);
 select *into j from public.academic_notification_jobs where user_id=u and kind='class'and reference_id='f3000000-0000-4000-8000-000000000003';
 select *into claim from public.claim_due_reminders(clock_timestamp(),20)where id=j.reminder_id;
 update public.course_schedules set room='Synthetic changed room'where id='f3000000-0000-4000-8000-000000000003';
 perform academic_test.assert(public.begin_notification_delivery('reminder',u,claim.id,claim.claim_token)is null,'classroom change after preparation prevents old-map delivery');
 perform academic_test.assert((select status='cancelled'and delivery_attempts=0 from public.reminders where id=j.reminder_id),'changed class rejected before Telegram boundary');

 update public.course_schedules set room='C1.2.334'where id=slot_id;
 perform academic_test.assert((public.academic_schedule_verification(u,clock_timestamp())->>'changed')::boolean,'changed classroom invalidates prior timetable verification');
 perform academic_test.assert((select count(*)=0 from public.academic_class_occurrences(u,clock_timestamp())),'unverified changed weekly template yields no class reminders');
 perform public.academic_service(u,'verify_schedule',jsonb_build_object('expectedRevision',(public.academic_schedule_verification(u,clock_timestamp())->>'revision')::int,'validFrom',(clock_timestamp()at time zone'Asia/Almaty')::date,'validThrough',local_day+10,'sourceLabel','Synthetic reviewed changed timetable','confirmed',true));
 payload:=jsonb_build_object('requestId','synthetic-holiday-import','sources',jsonb_build_array((select value->'sources'->2 from academic_test.payloads where key='base')),'events',jsonb_build_array(academic_test.period('synthetic-holiday','holiday',1,local_day,local_day,'holiday')));
 perform public.academic_service(u,'import',payload);
 perform academic_test.assert(not exists(select from public.academic_class_occurrences(u,clock_timestamp())c where c->>'key'='class:'||slot_id||':'||local_day),'confirmed holiday suppresses weekly class occurrence');

 -- Staleness is visible and does not become a claim that no assignments exist.
 update public.user_lms_settings set session_expires_at=clock_timestamp()-interval'1 second',session_state='session_expired'where user_id=u and platform_type='aitu_moodle';
 perform academic_test.assert((public.academic_lms_status(u,clock_timestamp())->>'stale')::boolean,'expired LMS session explicitly stale');
 perform academic_test.assert(exists(select from public.academic_assignment_rows(u,clock_timestamp())a where(a->>'stale')::boolean),'stale assignment records remain available with warnings');
 perform academic_test.assert(not exists(select from public.academic_candidate_rows(u,clock_timestamp())c where c->>'kind'='assignment'),'stale source cannot assert current pending submission');

 -- Prepared jobs cannot survive consent or timezone revocation; acknowledged
 -- sends stay intact. No fixture ever invokes a Telegram HTTP method.
 select revision into next_revision from public.academic_notification_preferences where user_id=u;
 perform public.academic_service(u,'save_preferences',jsonb_build_object('expectedRevision',next_revision,'preferences',public.academic_default_preferences()));
 perform academic_test.assert((select status='sent'and telegram_message_id=42 and delivery_attempts=1 from public.reminders where id=r.id),'revocation preserves acknowledged receipt and attempt count');
 perform academic_test.assert((public.plan_academic_notifications(u)->>'queued')::int=0,'all categories off produces no new jobs');
end;$$;
reset role;

-- Actual grants and RLS, not a mocked owner filter.
select academic_test.assert(not has_function_privilege('anon','public.academic_service(uuid,text,jsonb)','execute'),'anonymous academic RPC execution revoked');
select academic_test.assert(not has_function_privilege('authenticated','public.plan_academic_notifications(uuid)','execute'),'browser planner execution revoked');
select academic_test.assert(not has_table_privilege('authenticated','public.academic_events','select'),'browser direct event read grant absent');
select academic_test.assert(not has_table_privilege('authenticated','public.academic_notification_preferences','update'),'browser direct consent mutation absent');
select academic_test.assert((select bool_and(relrowsecurity and relforcerowsecurity)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and c.relname in('academic_sources','academic_events','academic_notification_preferences','academic_notification_jobs')),'all four academic tables force RLS');
grant select on public.academic_events to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000002',false);
do $$begin if exists(select from public.academic_events)then raise exception 'RLS exposed other owner events';end if;end;$$;
reset role;
revoke select on public.academic_events from authenticated;
select academic_test.assert(true,'real browser role sees no other owner records through RLS');

begin read only;
set local role service_role;
select public.academic_service('f0000000-0000-4000-8000-000000000001','overview');
commit;
select academic_test.assert(true,'academic overview works in a read-only transaction');
