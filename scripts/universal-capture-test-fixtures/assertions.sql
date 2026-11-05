select public.capture_test_assert((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.life_captures'::regclass),'existing capture RLS remains forced');
select public.capture_test_assert(not has_table_privilege('authenticated','public.life_captures','SELECT,INSERT,UPDATE,DELETE'),'browser capture grants denied');
select public.capture_test_assert(not has_table_privilege('anon','public.life_captures','SELECT,INSERT,UPDATE,DELETE'),'anonymous capture grants denied');
select public.capture_test_assert(not has_table_privilege('service_role','public.life_captures','DELETE'),'service cannot remove dedupe tombstones');
select public.capture_test_assert(not has_function_privilege('authenticated','public.capture_service(uuid,text,uuid,integer,jsonb)','EXECUTE'),'browser workflow RPC denied');
select public.capture_test_assert(not has_function_privilege('anon','public.capture_claim_next(text)','EXECUTE'),'anonymous worker denied');
select public.capture_test_assert(not has_function_privilege('authenticated','public.capture_sweep(integer)','EXECUTE'),'browser maintenance denied');
select public.capture_test_assert((select count(*)=2 and bool_and(original=to_jsonb(c)-array['capture_version','capture_ingestion_key','capture_ingestion_hash','capture_revision','capture_state','capture_archived_at','capture_deleted_at','capture_expires_at','capture_review_expires_at','capture_lease_token','capture_lease_expires_at','capture_attempt_count','capture_external_attempt','capture_workflow'])from public.capture_test_legacy l join public.life_captures c using(id)),'legacy duplicate references and full original rows preserved');

begin;set local role service_role;
do $$declare a jsonb;b jsonb;c jsonb;bad jsonb;owner uuid:='00000000-0000-4000-8000-000000000001';begin
 a:=public.capture_service(owner,'ingest',null,null,public.capture_test_input('dedupe-ingest-1'));
 b:=public.capture_service(owner,'ingest',null,null,public.capture_test_input('dedupe-ingest-1'));
 perform public.capture_test_assert((a->>'created')::boolean and not(b->>'created')::boolean and a->'capture'=b->'capture','ingest replay is duplicate');
 perform public.capture_test_error(format('select public.capture_service(%L,''ingest'',null,null,%L)',owner,public.capture_test_input('dedupe-ingest-1','Changed text')),'capture_conflict');
 perform public.capture_test_assert(public.capture_service('00000000-0000-4000-8000-000000000002','get',(a->'capture'->>'id')::uuid,null,'{}')is null,'foreign capture hidden');
 b:=public.capture_service(owner,'search',null,null,'{"query":"Existing","includeArchived":false,"limit":20}');
 perform public.capture_test_assert(jsonb_array_length(b->'captures')=2,'legacy history visible');
 perform public.capture_test_assert(exists(select from jsonb_array_elements(b->'captures')x where x->>'source'='legacy'and x->>'sourceLabel'='Existing capture'and x->>'state'='completed'and x->'actions'='[]'::jsonb),'unknown legacy source safely projected');
 perform public.capture_test_error(format('select public.capture_service(%L,''claim'',%L,null,''{"leaseToken":"legacy-lease-1"}'')',owner,(select id from public.capture_test_legacy limit 1)),'capture_permission_denied');
 foreach bad in array array[
  public.capture_test_input('invalid-input-1','my API key is hidden'),
  public.capture_test_input('invalid-input-2')||'{"source":"legacy"}',
  public.capture_test_input('invalid-input-3')||'{"owner":"forged"}',
  public.capture_test_input('invalid-input-4')||'{"inputType":"voice","voice":{"fileId":"abc"}}',
  public.capture_test_input('invalid-input-5')||'{"sourceReference":{"chatId":1,"messageId":2,"updateId":3}}',
  public.capture_test_input('invalid-input-6')||'{"source":"telegram","sourceReference":{"chatId":1,"messageId":2.5,"updateId":3}}',
  public.capture_test_input('invalid-input-7')||'{"inputType":"link","text":"file:///private"}',
  public.capture_test_input('invalid-input-8')||'{"requestId":12345678}'
 ]loop perform public.capture_test_error(format('select public.capture_service(%L,''ingest'',null,null,%L)',owner,bad),'capture_invalid_input');end loop;
 c:=public.capture_service(owner,'ingest',null,null,public.capture_test_input('uppercase-link-1','HTTPS://example.invalid/note')||'{"inputType":"link"}')->'capture';
 perform public.capture_test_assert(c->>'inputType'='link','URL schemes are case insensitive at both trust boundaries');
 c:=public.capture_service(owner,'ingest',null,null,public.capture_test_input('source-anchor-1')||jsonb_build_object('source','telegram','sourceReference',jsonb_build_object('chatId',101,'messageId',202,'updateId',303,'occurredAt','2026-11-02T23:59:00+05:00')))->'capture';
 b:=public.capture_service(owner,'claim',(c->>'id')::uuid,null,'{"leaseToken":"anchor-lease-1"}');
 perform public.capture_test_assert(b->>'referenceTime'='2026-11-02T23:59:00+05:00','relative time anchored to original trusted event');
 perform public.capture_test_assert(not(c?'voice')and not(c?'sourceReference')and not(c?'userId'),'private source/file references never projected');
end;$$;
rollback;

-- Selective approval and lost-response retries must not double-write any domain.
begin;set local role service_role;
 do $$declare a jsonb;b jsonb;c jsonb;owner uuid:='00000000-0000-4000-8000-000000000001';begin
 -- This fixture executes a future-only reminder mutation. Keep it future-dated
 -- when CI runs after the original overnight mission; production validation stays strict.
 a:=public.capture_test_ready('selective-review-1',jsonb_set('[{"kind":"task.create","args":{"title":"Captured task","notes":"Keep evidence","dueAt":null}},{"kind":"water.log","args":{"amountMl":250}},{"kind":"reminder.create","args":{"title":"Remember review","remindAt":null}}]'::jsonb,'{2,args,remindAt}',to_jsonb(date_trunc('milliseconds',clock_timestamp()+interval '1 day'))));
 b:=public.capture_test_confirm(a,'["action-1","action-2"]','selective-approval-1');
 perform public.capture_test_assert((select count(*)=1 from public.tasks where title='Captured task')and(select count(*)=1 from public.hydration_entries),'selected task and water saved');
 perform public.capture_test_assert((select count(*)=0 from public.reminders),'unselected reminder remains unwritten');
 perform public.capture_test_assert(b->'actions'->2->>'status'='pending','unselected proposal remains pending');
 c:=public.capture_test_confirm(a,'["action-1","action-2"]','selective-approval-1');
 perform public.capture_test_assert(b=c,'same approval receipt replay');
 perform public.capture_test_error(format('select public.capture_test_confirm(%L,''["action-3"]'',''selective-approval-1'')',a),'capture_conflict');
 update public.life_captures set capture_review_expires_at=clock_timestamp()-interval'1 second'where id=(a->>'id')::uuid;
 c:=public.capture_test_confirm(b,'["action-1"]','executed-after-expiry');
 perform public.capture_test_assert(c->'actions'->0->>'status'='succeeded','executed receipt before expiry validation');
 perform public.capture_test_error(format('select public.capture_test_confirm(%L,''["action-3"]'',''pending-after-expiry'')',c),'capture_expired');
 perform public.capture_test_error(format('select public.capture_service(%L,''edit'',%L,%s,''{"transcript":"Replace after actions"}'')',owner,a->>'id',c->>'revision'),'capture_conflict');
 perform public.capture_test_error(format('select public.capture_service(%L,''edit'',%L,%s,''{"actionId":"action-1","action":{"kind":"note.save","args":{"title":"Overwrite","content":"Forbidden"}}}'')',owner,a->>'id',c->>'revision'),'capture_conflict');
 c:=public.capture_service(owner,'retry',(c->>'id')::uuid,(c->>'revision')::int,'{}');
 perform public.capture_test_assert(c->'actions'->0->>'status'='succeeded'and c->>'state'='needs_review','partial retry renews review without re-extracting successes');
 c:=public.capture_test_confirm(c,'["action-3"]','selective-approval-2');
 perform public.capture_test_assert(c->>'state'='completed'and(select count(*)=1 from public.reminders),'remaining selected action completes independently');
 perform public.capture_test_assert((select count(*)=1 from public.tasks where title='Captured task')and(select count(*)=1 from public.hydration_entries),'domain records remain exactly once');
end;$$;
rollback;

-- A later task CAS failure rolls back earlier writes and approval receipts atomically.
begin;set local role service_role;
do $$declare a jsonb;target jsonb;before_count integer;begin
 target:=public.manage_lifeos_task('00000000-0000-4000-8000-000000000002',null,'foreign-task-1','{"title":"Foreign task"}',null);
 a:=public.capture_test_ready('atomic-rollback-1',jsonb_build_array('{"kind":"task.create","args":{"title":"Must roll back","notes":"","dueAt":null}}'::jsonb,jsonb_build_object('kind','task.complete','args',jsonb_build_object('title','Foreign task','taskId',target->'id','expectedUpdatedAt',target->'updatedAt'))));
 perform public.capture_test_error(format('select public.capture_test_confirm(%L,''["action-1","action-2"]'',''atomic-approval-1'')',a),'task_not_found');
 perform public.capture_test_assert((select count(*)=0 from public.tasks where title='Must roll back'),'earlier task rolled back');
 perform public.capture_test_assert((select capture_workflow->'approvals'='{}'::jsonb and capture_workflow->'actions'->0->>'status'='pending'from public.life_captures where id=(a->>'id')::uuid),'approval and action receipt rolled back');
 target:=public.manage_lifeos_task('00000000-0000-4000-8000-000000000001',null,'own-cas-task-1','{"title":"Owned task","notes":"Preserve notes","dueAt":"2026-11-05T09:00:00+05:00"}',null);
 a:=public.capture_test_ready('task-update-1',jsonb_build_array(jsonb_build_object('kind','task.update','args',jsonb_build_object('title','Renamed task','taskId',target->'id','expectedUpdatedAt',target->'updatedAt'))));
 a:=public.capture_test_confirm(a,'["action-1"]','task-update-approval-1');
 perform public.capture_test_assert((select notes='Preserve notes'and due_at is not null from public.tasks where id=(target->>'id')::uuid),'omitted update fields preserve current task data');
end;$$;
rollback;

-- Missing inputs cannot be promoted by a model claiming empty missingFields.
begin;set local role service_role;
do $$declare a jsonb;b jsonb;begin
 a:=public.capture_test_ready('missing-quantity-1','[{"kind":"water.log","args":{"amountMl":null}}]');
 perform public.capture_test_assert(a->'actions'->0->>'status'='needs_input'and a->'actions'->0->'missingFields'='["amountMl"]'::jsonb,'SQL computes readiness independently');
 perform public.capture_test_error(format('select public.capture_test_confirm(%L,''["action-1"]'',''missing-approval-1'')',a),'capture_invalid_input');
 b:=public.capture_service('00000000-0000-4000-8000-000000000001','edit',(a->>'id')::uuid,(a->>'revision')::int,'{"actionId":"action-1","action":{"kind":"water.log","args":{"amountMl":300}}}');
 perform public.capture_test_assert(b->'actions'->0->>'origin'='edited'and b->'actions'->0->>'status'='pending','explicit edit yields ready proposal');
 b:=public.capture_test_confirm(b,'["action-1"]','edited-approval-1');
 perform public.capture_test_assert((select sum(amount_ml)=300 from public.hydration_entries),'edited quantity only saved after explicit approval');
end;$$;
rollback;

-- Lease recovery never repeats a possibly dispatched external operation.
begin;set local role service_role;
do $$declare a jsonb;b jsonb;c jsonb;owner uuid:='00000000-0000-4000-8000-000000000001';begin
 a:=public.capture_service(owner,'ingest',null,null,public.capture_test_input('lease-recovery-1'))->'capture';
 b:=public.capture_service(owner,'claim',(a->>'id')::uuid,null,'{"leaseToken":"lease-recovery-old"}');
 update public.life_captures set capture_lease_expires_at=clock_timestamp()-interval'1 second'where id=(a->>'id')::uuid;
 c:=public.capture_service(owner,'claim',(a->>'id')::uuid,null,'{"leaseToken":"lease-recovery-new"}');
 perform public.capture_test_assert((c->>'attemptCount')::int=2,'expired deterministic work safely reclaimed');
 perform public.capture_test_error(format('select public.capture_service(%L,''finish'',%L,null,''{"leaseToken":"lease-recovery-old","proposals":[]}'')',owner,a->>'id'),'capture_lease_lost');
 perform public.capture_service(owner,'mark_external',(a->>'id')::uuid,null,'{"leaseToken":"lease-recovery-new"}');
 update public.life_captures set capture_lease_expires_at=clock_timestamp()-interval'1 second'where id=(a->>'id')::uuid;
 perform public.capture_test_assert(public.capture_service(owner,'claim',(a->>'id')::uuid,null,'{"leaseToken":"lease-no-repeat"}')is null,'possibly dispatched external work not reclaimed');
 b:=public.capture_service(owner,'get',(a->>'id')::uuid,null,'{}');
 perform public.capture_test_assert(b->>'state'='failed'and b->>'errorCode'='capture_provider_ambiguous','external timeout requires owner retry');
 b:=public.capture_service(owner,'retry',(a->>'id')::uuid,(b->>'revision')::int,'{}');
 c:=public.capture_service(owner,'claim',(a->>'id')::uuid,null,'{"leaseToken":"lease-third-attempt"}');
 update public.life_captures set capture_lease_expires_at=clock_timestamp()-interval'1 second'where id=(a->>'id')::uuid;
 perform public.capture_test_assert(public.capture_service(owner,'claim',(a->>'id')::uuid,null,'{"leaseToken":"lease-fourth-blocked"}')is null,'max three processing attempts');
 b:=public.capture_service(owner,'get',(a->>'id')::uuid,null,'{}');
 perform public.capture_test_assert(b->>'errorCode'='capture_attempts_exhausted','exhausted attempts terminal');
 a:=public.capture_service(owner,'ingest',null,null,public.capture_test_input('archive-processing-1'))->'capture';
 b:=public.capture_service(owner,'claim',(a->>'id')::uuid,null,'{"leaseToken":"lease-before-archive"}');
 b:=public.capture_service(owner,'archive',(a->>'id')::uuid,(b->'capture'->>'revision')::int,'{"archived":true}');
 perform public.capture_test_error(format('select public.capture_service(%L,''mark_external'',%L,null,''{"leaseToken":"lease-before-archive"}'')',owner,a->>'id'),'capture_lease_lost');
 perform public.capture_test_assert(public.capture_service(owner,'claim',(a->>'id')::uuid,null,'{"leaseToken":"archive-not-claimed"}')is null,'archive fences worker');
end;$$;
rollback;

-- Deleted captures retain only stable deduplication; domain actions are not undone.
begin;set local role service_role;
do $$declare a jsonb;b jsonb;c jsonb;owner uuid:='00000000-0000-4000-8000-000000000001';begin
 a:=public.capture_test_ready('delete-tombstone-1','[{"kind":"task.create","args":{"title":"Approved task survives deletion","notes":"","dueAt":null}}]');
 a:=public.capture_test_confirm(a,'["action-1"]','delete-approval-1');
 b:=public.capture_service(owner,'delete',(a->>'id')::uuid,(a->>'revision')::int,'{}');
 perform public.capture_test_assert(b='{"deleted":true}'::jsonb,'delete acknowledged');
 b:=public.capture_service(owner,'ingest',null,null,public.capture_test_input('delete-tombstone-1'));
 perform public.capture_test_assert(not(b->>'created')::boolean and b->'capture'->>'state'='cancelled'and b->'capture'->>'text'=''and b->'capture'->'actions'='[]'::jsonb,'deleted transport replay cannot create another capture/action');
 perform public.capture_test_assert(public.capture_service(owner,'get',(a->>'id')::uuid,null,'{}')is null,'deleted history hidden');
 perform public.capture_test_assert(public.capture_service(owner,'delete',(a->>'id')::uuid,(a->>'revision')::int,'{}')='{"deleted":true}'::jsonb,'delete repeat idempotent');
 perform public.capture_test_assert((select count(*)=1 from public.tasks where title='Approved task survives deletion'),'capture deletion preserves explicitly approved domain data');
 perform public.capture_test_assert((select capture_ingestion_key is not null and capture_ingestion_hash is not null and chat_id is null and message_id is null and metadata='{}'::jsonb and capture_workflow->'sourceReference'='null'::jsonb and capture_workflow->'voice'='null'::jsonb and capture_workflow->'transcript'='null'::jsonb from public.life_captures where id=(a->>'id')::uuid),'private source/transcript/proposal content scrubbed');
 a:=public.capture_service(owner,'ingest',null,null,public.capture_test_input('expired-duplicate-1')||'{"retentionDays":7}')->'capture';
 update public.life_captures set capture_expires_at=clock_timestamp()-interval'1 second'where id=(a->>'id')::uuid;
 c:=public.capture_service(owner,'ingest',null,null,public.capture_test_input('expired-duplicate-1')||'{"retentionDays":7}');
 perform public.capture_test_assert(not(c->>'created')::boolean and c->'capture'->>'text'=''and c->'capture'->'actions'='[]'::jsonb and c->'capture'->>'errorCode'='capture_deleted','unswept expired duplicate redacted before reply');
 perform public.capture_test_assert((select capture_deleted_at is not null and text='[Deleted capture]'from public.life_captures where id=(a->>'id')::uuid),'unswept duplicate content actually scrubbed');
 a:=public.capture_service(owner,'ingest',null,null,public.capture_test_input('retention-expiry-1')||'{"retentionDays":7}')->'capture';
 update public.life_captures set capture_expires_at=clock_timestamp()-interval'1 second'where id=(a->>'id')::uuid;
 b:=public.capture_service(owner,'ingest',null,null,public.capture_test_input('audio-expiry-1','')||jsonb_build_object('source','telegram','inputType','voice','voice',jsonb_build_object('fileId','synthetic-file','fileUniqueId','synthetic-unique','durationSeconds',10,'fileSize',100,'mimeType','audio/ogg','referenceExpiresAt',clock_timestamp()+interval'1 hour')))->'capture';
 update public.life_captures set capture_workflow=jsonb_set(capture_workflow,'{voice,referenceExpiresAt}',to_jsonb(clock_timestamp()-interval'1 second'))where id=(b->>'id')::uuid;
 c:=public.capture_sweep(20);
 perform public.capture_test_assert((c->>'scrubbed')::int=2,'bounded retention/audio maintenance active');
 perform public.capture_test_assert((select capture_deleted_at is not null from public.life_captures where id=(a->>'id')::uuid),'explicit retention expires content');
 perform public.capture_test_assert((select capture_deleted_at is null and capture_workflow->'voice'='null'::jsonb from public.life_captures where id=(b->>'id')::uuid),'audio reference expires independently of history');
 perform public.capture_test_assert((select bool_and(capture_version is null and capture_deleted_at is null)from public.life_captures where id in(select id from public.capture_test_legacy)),'unsolicited maintenance never mutates legacy captures');
end;$$;
rollback;

-- Explicit memory commands reuse the existing durable permission and receipt boundary.
begin;set local role service_role;
do $$declare a jsonb;begin
 a:=public.capture_test_ready('memory-remember-1','[{"kind":"memory.remember","args":{"key":"capture_test","category":"preference","content":"Keep evenings clear"}}]');
 a:=public.capture_test_confirm(a,'["action-1"]','remember-approval-1');
 perform public.capture_test_assert((select count(*)=1 from public.assistant_memories where memory_key='capture_test'),'memory saved only after approval');
 a:=public.capture_test_ready('memory-delete-1','[{"kind":"memory.delete","args":{"key":"capture_test"}}]');
 perform public.capture_test_error(format('select public.capture_test_confirm(%L,''["action-1"]'',''delete-memory-optout'')',a),'capture_permission_denied');
 perform public.capture_test_assert((select count(*)=1 from public.assistant_memories where memory_key='capture_test'),'delete opt-out preserved');
 a:=public.capture_test_confirm(a,'["action-1"]','delete-memory-authorized','{"allowMemoryDelete":true}');
 perform public.capture_test_assert((select count(*)=0 from public.assistant_memories where memory_key='capture_test'),'explicit memory delete authorized');
end;$$;
rollback;

-- Prepared journal/READ data must be bound to the exact reviewed stored action.
begin;set local role service_role;
do $$declare a jsonb;action jsonb;entry jsonb;begin
 action:='{"kind":"filming.idea","args":{"date":"2026-11-03","content":"Film a morning walk"}}';
 a:=public.capture_test_ready('journal-action-1',jsonb_build_array(action));
 perform public.capture_test_error(format('select public.capture_test_confirm(%L,''["action-1"]'',''missing-prepared-journal'')',a),'capture_invalid_input');
 entry:='{"date":"2026-11-03","weightKg":51.2,"notes":"Preserve existing observations","filming":{"storyboard":[{"id":"capture_action-1","content":"Film a morning walk"}],"footage":[],"flags":{}}}';
 a:=public.capture_test_confirm(a,'["action-1"]','prepared-journal-1',jsonb_build_object('journalEntries',jsonb_build_array(jsonb_build_object('actionId','action-1','action',action,'date','2026-11-03','expectedRevision',0,'entry',entry))));
 perform public.capture_test_assert((select d.entry->>'weightKg'='51.2'and d.entry->>'notes'='Preserve existing observations'and jsonb_array_length(d.entry->'filming'->'footage')=0 from public.ideal_human_days d where user_id='00000000-0000-4000-8000-000000000001'and date='2026-11-03'),'prepared full journal preserved and idea never footage');
 a:=public.capture_test_ready('journal-outside-1','[{"kind":"reflection.add","args":{"date":"2027-01-01","content":"Outside experiment"}}]');
 perform public.capture_test_assert(a->'actions'->0->'missingFields'?'experimentDate','out of experiment journal blocked visibly');
 action:='{"kind":"question.read","args":{"text":"What tasks are pending?","tool":{"tool":"productivity.tasks","args":{"status":"pending"}}}}';
 a:=public.capture_test_ready('read-question-1',jsonb_build_array(action));
 perform public.capture_test_error(format('select public.capture_test_confirm(%L,''["action-1"]'',''read-no-prepared-result'')',a),'capture_invalid_input');
 a:=public.capture_test_confirm(a,'["action-1"]','read-prepared-result',jsonb_build_object('readResults',jsonb_build_array(jsonb_build_object('actionId','action-1','action',action,'summary','No pending tasks in this synthetic fixture'))));
 perform public.capture_test_assert(a->'actions'->0->>'resultSummary'='No pending tasks in this synthetic fixture','bounded READ result saved as receipt');
end;$$;
rollback;

begin;
update public.profiles set status='blocked'where user_id='00000000-0000-4000-8000-000000000001';
set local role service_role;
select public.capture_test_error('select public.capture_service(''00000000-0000-4000-8000-000000000001'',''ingest'',null,null,public.capture_test_input(''blocked-owner-1''))','capture_permission_denied');
rollback;

-- Durable state used only by the shell's independent concurrent connections.
set role service_role;
insert into public.capture_test_facts values('concurrent-confirm',public.capture_test_ready('concurrent-task-capture','[{"kind":"task.create","args":{"title":"Concurrent captured task","notes":"Exactly once","dueAt":null}}]'));
insert into public.capture_test_facts values('concurrent-edit',public.capture_test_ready('concurrent-edit-capture','[{"kind":"note.save","args":{"title":"Original review","content":"Owner review"}}]'));
insert into public.capture_test_facts values('concurrent-claim',public.capture_service('00000000-0000-4000-8000-000000000002','ingest',null,null,public.capture_test_input('concurrent-claim-capture'))->'capture');
reset role;
