-- V2 uses the same synthetic-only isolated database as the full v1 regression suite.
select public.capture_test_assert(not has_function_privilege('authenticated','public.capture_service_v2(uuid,text,uuid,integer,jsonb)','EXECUTE'),'browser v2 RPC denied');
select public.capture_test_assert(not has_function_privilege('anon','public.capture_public_v2_view(public.life_captures)','EXECUTE'),'anonymous presentation projection denied');
select public.capture_test_assert(not has_function_privilege('authenticated','public.capture_validate_presentation(jsonb)','EXECUTE'),'browser metadata helper denied');
create function public.capture_test_presentation(title text,day text default '2026-11-05')returns jsonb language sql as $$
 select jsonb_build_object('title',title,'description',null,'suggestedDate',day,'timeHint',null,'relation',null,'language','ru','evidence','user_statement','warnings','[]'::jsonb,'timezone','Asia/Almaty','dateBasis','profile');
$$;
begin;set local role service_role;
do $$declare a jsonb;b jsonb;c jsonb;job jsonb;props jsonb;presentations jsonb;before_revision int;owner uuid:='00000000-0000-4000-8000-000000000001';begin
 a:=public.capture_service_v2(owner,'ingest',null,null,public.capture_test_input('v2-russian-mixed','Завтра после университета нужно потренироваться, закончить DBMS и снять пару кадров для Ideal Human.'))->'capture';
 job:=public.capture_service_v2(owner,'claim',(a->>'id')::uuid,null,'{"leaseToken":"v2-mixed-lease"}');
 props:='[{"id":"action-1","kind":"task.create","args":{"title":"Закончить DBMS","notes":"Предложенная дата: 2026-11-05. Время не указано.","dueAt":null},"origin":"deterministic","summary":"Закончить DBMS","missingFields":[]},{"id":"action-2","kind":"planning.suggest","args":{"date":"2026-11-05","title":"Потренироваться после университета","notes":"После университета; расписание неизвестно","time":null},"origin":"deterministic","summary":"Тренировка","missingFields":[]},{"id":"action-3","kind":"filming.idea","args":{"date":"2026-11-05","content":"Снять пару кадров для Ideal Human"},"origin":"deterministic","summary":"Съёмка","missingFields":[]}]';
 presentations:=jsonb_build_object('action-1',public.capture_test_presentation('Закончить DBMS'),'action-2',public.capture_test_presentation('Потренироваться после университета'),'action-3',public.capture_test_presentation('Снять пару кадров для Ideal Human'));
 b:=public.capture_service_v2(owner,'finish',(a->>'id')::uuid,null,jsonb_build_object('leaseToken',job->'leaseToken','proposals',props,'presentations',presentations));
 perform public.capture_test_assert(jsonb_array_length(b->'actions')=3 and b->'actions'->0->'presentation'->>'title'='Закончить DBMS','three independent durable presentations');
 perform public.capture_test_assert(not exists(select from public.tasks where title='Закончить DBMS'),'no early domain write');
 c:=public.capture_service(owner,'get',(a->>'id')::uuid,null,'{}');
 perform public.capture_test_assert(not(c?'processingStage')and not(c?'transcriptSource')and not(c->'actions'->0?'presentation')and not(c->'actions'->0?'extractionOrigin'),'old RPC rollback projection remains unchanged');
 perform public.capture_test_assert(public.capture_service_v2('00000000-0000-4000-8000-000000000002','get',(a->>'id')::uuid,null,'{}')is null,'v2 foreign get hidden');
 perform public.capture_test_error(format('select public.capture_service_v2(%L,''revise'',%L,%s,''{"updates":[],"cancelActionIds":["action-1"]}'')','00000000-0000-4000-8000-000000000002',a->>'id',b->>'revision'),'capture_not_found');
 a:=b;
 b:=public.capture_service_v2(owner,'confirm',(a->>'id')::uuid,(a->>'revision')::int,jsonb_build_object('requestId','v2-dbms-selected','expectedRevision',a->'revision','actionIds','["action-1"]'::jsonb,'confirmed',true,'allowMemoryDelete',false));
 perform public.capture_test_assert((select count(*)=1 from public.tasks where title='Закончить DBMS')and b->'actions'->1->>'status'='pending'and b->'actions'->2->>'status'='pending','only selected DBMS writes');
 c:=public.capture_service_v2(owner,'confirm',(a->>'id')::uuid,(a->>'revision')::int,jsonb_build_object('requestId','v2-dbms-selected','expectedRevision',a->'revision','actionIds','["action-1"]'::jsonb,'confirmed',true,'allowMemoryDelete',false));
 perform public.capture_test_assert(b=c and(select count(*)=1 from public.tasks where title='Закончить DBMS'),'selected approval replay does not duplicate');
 before_revision:=(b->>'revision')::int;
 -- A later invalid update rolls back earlier valid updates in the same correction.
 perform public.capture_test_error(format('select public.capture_service_v2(%L,''revise'',%L,%s,%L)',owner,b->>'id',before_revision,jsonb_build_object('updates',jsonb_build_array(jsonb_build_object('actionId','action-3','action',jsonb_build_object('kind','filming.idea','args',jsonb_build_object('date','2026-11-05','content','Evening draft')),'presentation',public.capture_test_presentation('Evening draft')),jsonb_build_object('actionId','action-1','action',jsonb_build_object('kind','task.create','args',jsonb_build_object('title','Overwrite approved','notes','','dueAt',null)),'presentation',public.capture_test_presentation('Overwrite approved'))),'cancelActionIds','[]'::jsonb)),'capture_conflict');
 c:=public.capture_service_v2(owner,'get',(b->>'id')::uuid,null,'{}');perform public.capture_test_assert(c=b,'failed multi-correction is fully atomic');
 b:=public.capture_service_v2(owner,'revise',(b->>'id')::uuid,before_revision,jsonb_build_object('updates',jsonb_build_array(jsonb_build_object('actionId','action-3','action',jsonb_build_object('kind','filming.idea','args',jsonb_build_object('date','2026-11-05','content','Снять пару кадров для Ideal Human вечером')),'presentation',public.capture_test_presentation('Снять пару кадров вечером'))),'cancelActionIds','["action-2"]'::jsonb));
 perform public.capture_test_assert(b->'actions'->0=c->'actions'->0 and b->'actions'->1->>'status'='cancelled'and b->'actions'->2->>'id'='action-3'and b->'actions'->2->>'origin'='edited'and b->'actions'->2->>'extractionOrigin'='deterministic','partial approval receipts and stable provenance survive correction/rejection');
 perform public.capture_test_error(format('select public.capture_service_v2(%L,''revise'',%L,%s,''{"updates":[],"cancelActionIds":["action-3"]}'')',owner,b->>'id',before_revision),'capture_conflict');
 perform public.capture_test_error(format('select public.capture_service_v2(%L,''revise'',%L,%s,''{"updates":[],"cancelActionIds":["action-1"]}'')',owner,b->>'id',b->>'revision'),'capture_conflict');
 c:=public.capture_service_v2(owner,'archive',(b->>'id')::uuid,(b->>'revision')::int,'{"archived":true}');
 perform public.capture_test_error(format('select public.capture_service_v2(%L,''revise'',%L,%s,''{"updates":[],"cancelActionIds":["action-3"]}'')',owner,c->>'id',c->>'revision'),'capture_conflict');
end;$$;
rollback;

-- External consent is durable, one-use and lease-fenced, not a worker option.
begin;set local role service_role;
do $$declare a jsonb;b jsonb;c jsonb;job jsonb;body jsonb;owner uuid:='00000000-0000-4000-8000-000000000001';begin
 a:=public.capture_service_v2(owner,'ingest',null,null,public.capture_test_input('v2-voice-consent')||jsonb_build_object('source','telegram','inputType','voice','text','','voice',jsonb_build_object('fileId','synthetic_file','fileUniqueId','synthetic_unique','durationSeconds',2,'mimeType','audio/ogg','fileSize',128,'referenceExpiresAt',clock_timestamp()+interval'1 hour')))->'capture';
 body:=jsonb_build_object('mode','transcription','requestId','v2-stt-request-1','leaseToken','v2-stt-lease-1','consentExpiresAt',clock_timestamp()+interval'3 minutes','policy',jsonb_build_object('settingsRevision',1,'provider','openai','modelId','approved-voice','maxRequestCostMicros',9000));
 perform public.capture_test_error(format('select public.capture_service_v2(%L,''claim_external'',%L,%s,%L)','00000000-0000-4000-8000-000000000002',a->>'id',a->>'revision',body),'capture_not_found');
 perform public.capture_test_error(format('select public.capture_service_v2(%L,''claim_external'',%L,%s,%L)',owner,a->>'id',a->>'revision',body||jsonb_build_object('consentExpiresAt',clock_timestamp()+interval'1 hour')),'capture_permission_denied');
 perform public.capture_test_error(format('select public.capture_service_v2(%L,''claim_external'',%L,%s,%L)',owner,a->>'id',a->>'revision',body||'{"owner":"forged"}'),'capture_invalid_input');
 job:=public.capture_service_v2(owner,'claim_external',(a->>'id')::uuid,(a->>'revision')::int,body);
 perform public.capture_test_assert(job->'capture'->>'processingStage'='transcribing'and(select capture_external_attempt from public.life_captures where id=(a->>'id')::uuid),'actual consented transcription stage and durable ambiguity marker');
 perform public.capture_test_assert(public.capture_service_v2(owner,'claim_external',(a->>'id')::uuid,(a->>'revision')::int,body)is null,'same external request never dispatched twice');
 perform public.capture_test_assert(public.capture_service(owner,'claim',(a->>'id')::uuid,null,'{"leaseToken":"other-worker-lease"}')is null,'worker cannot steal external lease');
 update public.life_captures set capture_lease_expires_at=clock_timestamp()-interval'1 second'where id=(a->>'id')::uuid;
 perform public.capture_test_assert(public.capture_service(owner,'claim',(a->>'id')::uuid,null,'{"leaseToken":"restart-worker-lease"}')is null,'expired external worker never retries provider');
 b:=public.capture_service_v2(owner,'get',(a->>'id')::uuid,null,'{}');
 perform public.capture_test_assert(b->>'state'='failed'and b->>'errorCode'='capture_provider_ambiguous'and b->'processingStage'='null'::jsonb,'restart is ambiguous and requires explicit new consent');
 perform public.capture_test_error(format('select public.capture_service_v2(%L,''finish'',%L,null,%L)',owner,a->>'id',jsonb_build_object('leaseToken','v2-stt-lease-1','transcript','Late transcript','proposals','[]'::jsonb)),'capture_lease_lost');
 b:=public.capture_service_v2(owner,'edit',(a->>'id')::uuid,(b->>'revision')::int,'{"transcript":"Ручной текст после ошибки"}');
 perform public.capture_test_assert(b->>'transcriptSource'='manual'and b->>'state'='queued','manual fallback remains after ambiguous external attempt');
 b:=public.capture_service_v2(owner,'delete',(a->>'id')::uuid,(b->>'revision')::int,'{}');
 perform public.capture_test_assert((select capture_workflow->'voice'='null'::jsonb and not(capture_workflow?'external')and not(capture_workflow?'presentations')from public.life_captures where id=(a->>'id')::uuid),'delete scrubs voice, consent and presentation while retaining tombstone');
end;$$;
rollback;

-- Malformed presentation cannot bypass the exact executable payload validator.
begin;set local role service_role;
do $$declare a jsonb;j jsonb;props jsonb;p jsonb;owner uuid:='00000000-0000-4000-8000-000000000001';begin
 a:=public.capture_service_v2(owner,'ingest',null,null,public.capture_test_input('v2-invalid-presentation'))->'capture';j:=public.capture_service_v2(owner,'claim',(a->>'id')::uuid,null,'{"leaseToken":"v2-invalid-lease"}');
 props:='[{"id":"action-1","kind":"task.create","args":{"title":"Valid title","notes":"","dueAt":null},"origin":"model","summary":"Task","missingFields":[]}]';
 p:=public.capture_test_presentation('Review title');
 perform public.capture_test_error(format('select public.capture_service_v2(%L,''finish'',%L,null,%L)',owner,a->>'id',jsonb_build_object('leaseToken',j->'leaseToken','proposals',props,'presentations',jsonb_build_object('action-1',p||'{"ownerUserId":"forged"}'))),'capture_invalid_input');
 perform public.capture_test_error(format('select public.capture_service_v2(%L,''finish'',%L,null,%L)',owner,a->>'id',jsonb_build_object('leaseToken',j->'leaseToken','proposals',props,'presentations',jsonb_build_object('action-9',p))),'capture_invalid_input');
 a:=public.capture_service_v2(owner,'finish',(a->>'id')::uuid,null,jsonb_build_object('leaseToken',j->'leaseToken','proposals',props,'presentations',jsonb_build_object('action-1',p)));
 perform public.capture_test_assert(a->'actions'->0->>'extractionOrigin'='model','model provenance stored separately');
 a:=public.capture_service_v2(owner,'edit',(a->>'id')::uuid,(a->>'revision')::int,'{"actionId":"action-1","action":{"kind":"task.create","args":{"title":"Owner correction","notes":"","dueAt":null}}}');
 perform public.capture_test_assert(a->'actions'->0->>'origin'='edited'and a->'actions'->0->>'extractionOrigin'='model'and not(a->'actions'->0?'presentation'),'manual edit invalidates stale presentation but preserves AI participation');
end;$$;
rollback;
