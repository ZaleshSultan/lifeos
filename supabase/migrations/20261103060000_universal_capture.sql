-- Nighthawk extends the existing inbox. Existing rows are not processed or rewritten.
begin;
alter table public.life_captures
 add column capture_version smallint check(capture_version in(1,2)),
 add column capture_ingestion_key text check(capture_ingestion_key is null or capture_ingestion_key ~ '^[A-Za-z0-9:_-]{8,120}$'),
 add column capture_ingestion_hash text check(capture_ingestion_hash is null or capture_ingestion_hash ~ '^[a-f0-9]{32}$'),
 add column capture_revision integer not null default 0 check(capture_revision between 0 and 2147483646),
 add column capture_state text check(capture_state in('queued','processing','awaiting_transcript','needs_review','completed','failed','cancelled')),
 add column capture_archived_at timestamptz,
 add column capture_deleted_at timestamptz,
 add column capture_expires_at timestamptz,
 add column capture_review_expires_at timestamptz,
 add column capture_lease_token text,
 add column capture_lease_expires_at timestamptz,
 add column capture_attempt_count integer not null default 0 check(capture_attempt_count between 0 and 3),
 add column capture_external_attempt boolean not null default false,
 add column capture_workflow jsonb check(capture_workflow is null or(jsonb_typeof(capture_workflow)='object' and octet_length(capture_workflow::text)<=262144));
create unique index life_captures_ingestion_key_idx on public.life_captures(user_id,capture_ingestion_key) where capture_ingestion_key is not null;
create index life_captures_processing_idx on public.life_captures(capture_state,capture_lease_expires_at,created_at) where capture_version=1 and capture_deleted_at is null;
create index life_captures_retention_idx on public.life_captures(capture_expires_at) where capture_version=1 and capture_deleted_at is null and capture_expires_at is not null;
-- Current frontends use the bot trust boundary, not direct Supabase browser grants.
revoke all on public.life_captures from public,anon,authenticated,service_role;
grant select,insert,update on public.life_captures to service_role;

create function public.capture_text_safe(p_text text) returns boolean language sql immutable set search_path='' as $$
 select p_text is not null and not pg_catalog.regexp_replace(normalize(p_text,NFKC),U&'[\200B-\200F\202A-\202E\2060-\206F\FEFF]','','g') ~*
 '\m(password|passwd|passphrase|otp|2fa|mfa|seed[_ -]?phrase|recovery[_ -]?(code|phrase)|cookies?|bearer|authorization|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|private[_ -]?key|service[_ -]?role|session[_ -]?(id|key|token)|secret|token)\M|парол|куки|токен|-----BEGIN [A-Z ]*PRIVATE KEY-----|\msk-[a-z0-9_-]{12,}|eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+|https?://[^[:space:]/]+:[^[:space:]]+@|\m[0-9]{6,}:[a-z0-9_-]{20,}|\m(AIza[a-z0-9_-]{20,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|sb_secret_[a-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\M'
$$;

create function public.capture_validate_action(p_action jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare k text:=p_action->>'kind';a jsonb:=p_action->'args';allowed text[];field text;value jsonb;stamp timestamptz;d date;
begin
 if jsonb_typeof(p_action) is distinct from 'object' or jsonb_typeof(a) is distinct from 'object' or k is null or exists(select from jsonb_object_keys(p_action) f where f not in('kind','args')) then raise exception 'capture_invalid_input' using errcode='22023';end if;
 allowed:=case k
  when 'task.create' then array['title','notes','dueAt'] when 'task.update' then array['taskId','expectedUpdatedAt','title','notes','dueAt'] when 'task.complete' then array['taskId','expectedUpdatedAt','title']
  when 'reminder.create' then array['title','remindAt'] when 'planning.suggest' then array['date','title','notes','time'] when 'study.record' then array['date','topic','minutes','notes','category','completed']
  when 'learning.note' then array['date','topic','content'] when 'meal.record' then array['date','label','caloriesKcal','proteinG','fatG','carbsG','mealTime','portion','estimated'] when 'water.log' then array['amountMl']
  when 'workout.note' then array['date','content'] when 'reflection.add' then array['date','content'] when 'filming.idea' then array['date','content'] when 'note.save' then array['title','content'] when 'question.read' then array['text','tool']
  when 'memory.remember' then array['key','category','content'] when 'memory.update' then array['key','category','content'] when 'memory.archive' then array['key'] when 'memory.delete' then array['key'] else null end;
 if allowed is null or exists(select from jsonb_object_keys(a) f where not f=any(allowed)) or octet_length(a::text)>65536 then raise exception 'capture_invalid_input' using errcode='22023';end if;
 foreach field in array array['title','notes','topic','content','label','portion','key','text'] loop
  if a?field and(jsonb_typeof(a->field) is distinct from 'string' or length(a->>field)>case field when 'content' then case when k='note.save' then 8000 when k like 'memory.%' then 1000 else 2000 end when 'notes' then 5000 when 'text' then 2000 when 'key' then 80 when 'title' then 500 else 240 end or not public.capture_text_safe(a->>field)) then raise exception 'capture_invalid_input' using errcode='22023';end if;
 end loop;
 if a?'date' then
  if jsonb_typeof(a->'date') is distinct from 'string' or(a->>'date')!~'^\d{4}-\d\d-\d\d$' then raise exception 'capture_invalid_input' using errcode='22023';end if;
  begin d:=(a->>'date')::date;exception when others then raise exception 'capture_invalid_input' using errcode='22023';end;
 end if;
 foreach field in array array['dueAt','remindAt','expectedUpdatedAt'] loop
  if a?field and jsonb_typeof(a->field)<>'null' then
   if jsonb_typeof(a->field) is distinct from 'string' or(a->>field)!~'^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d{1,6})?)?(Z|[+-]\d\d:\d\d)$' then raise exception 'capture_invalid_input' using errcode='22023';end if;
   begin stamp:=(a->>field)::timestamptz;exception when others then raise exception 'capture_invalid_input' using errcode='22023';end;
  end if;
 end loop;
 if a?'taskId' and jsonb_typeof(a->'taskId')<>'null' then
  if jsonb_typeof(a->'taskId') is distinct from 'string' or(a->>'taskId')!~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then raise exception 'capture_invalid_input' using errcode='22023';end if;
 end if;
 foreach field in array array['amountMl','minutes','caloriesKcal','proteinG','fatG','carbsG'] loop
  value:=a->field;
  if value is not null and jsonb_typeof(value)<>'null' then
   if jsonb_typeof(value) is distinct from 'number' or(value::text)::numeric<0 or(value::text)::numeric>(case field when 'amountMl' then 5000 when 'minutes' then 900 when 'caloriesKcal' then 10000 when 'proteinG' then 400 when 'fatG' then 1000 else 2000 end)then raise exception 'capture_invalid_input' using errcode='22023';end if;
   if field='amountMl' and((value::text)::numeric<1 or(value::text)::numeric<>trunc((value::text)::numeric))then raise exception 'capture_invalid_input' using errcode='22023';end if;
  end if;
 end loop;
 if a?'category' and(jsonb_typeof(a->'category') is distinct from 'string' or(case when k='study.record' then(a->>'category') not in('programming','english','cybersecurity','science','other')else(a->>'category')not in('preference','goal','constraint','learning','fact')end))then raise exception 'capture_invalid_input' using errcode='22023';end if;
 if a?'key' and(a->>'key')<>'' and((a->>'key')!~'^[a-z0-9][a-z0-9_.-]{0,79}$' or(a->>'key')in('__proto__','constructor','prototype'))then raise exception 'capture_invalid_input' using errcode='22023';end if;
 foreach field in array array['estimated','completed'] loop
  if a?field and jsonb_typeof(a->field) not in('boolean','null')then raise exception 'capture_invalid_input' using errcode='22023';end if;
 end loop;
 foreach field in array array['time','mealTime'] loop
  if a?field and jsonb_typeof(a->field)<>'null' and(jsonb_typeof(a->field)<>'string' or(a->>field)!~'^([01]\d|2[0-3]):[0-5]\d$')then raise exception 'capture_invalid_input' using errcode='22023';end if;
 end loop;
 if k='question.read' and a->'tool' is not null and jsonb_typeof(a->'tool')<>'null' then
  if jsonb_typeof(a->'tool')<>'object' or jsonb_typeof(a->'tool'->'tool')is distinct from'string'or(a->'tool'->>'tool') not in('classes.today','classes.tomorrow','classes.next','study.deadlines','study.grades','study.changes','study.forecast','study.scholarship','productivity.tasks','productivity.reminders','productivity.calendar','productivity.availability','memory.list','memory.search') or jsonb_typeof(a->'tool'->'args') is distinct from 'object' or exists(select from jsonb_object_keys(a->'tool') f where f not in('tool','args'))then raise exception 'capture_invalid_input' using errcode='22023';end if;
 end if;
end;$$;

create function public.capture_missing_fields(p_action jsonb)returns jsonb language plpgsql immutable set search_path=''as $$
declare a jsonb:=p_action->'args';k text:=p_action->>'kind';f text;missing jsonb:='[]'::jsonb;
begin
 foreach f in array(case k when'task.create'then array['title']when'task.update'then array['title']when'task.complete'then array['title']when'reminder.create'then array['title']when'planning.suggest'then array['title']when'study.record'then array['topic']when'learning.note'then array['topic','content']when'meal.record'then array['label']when'workout.note'then array['content']when'reflection.add'then array['content']when'filming.idea'then array['content']when'note.save'then array['title','content']when'question.read'then array['text']when'memory.remember'then array['key','content']when'memory.update'then array['key','content']when'memory.archive'then array['key']when'memory.delete'then array['key']else array[]::text[]end)loop if coalesce(length(btrim(a->>f)),0)=0 then missing:=missing||to_jsonb(f);end if;end loop;
 if k in('task.update','task.complete')then if coalesce(a->>'taskId','')=''then missing:=missing||'"taskId"'::jsonb;end if;if coalesce(a->>'expectedUpdatedAt','')=''then missing:=missing||'"expectedUpdatedAt"'::jsonb;end if;end if;
 if k='reminder.create'and coalesce(a->>'remindAt','')=''then missing:=missing||'"remindAt"'::jsonb;end if;
 if k='water.log'and(a->'amountMl'is null or a->'amountMl'='null'::jsonb)then missing:=missing||'"amountMl"'::jsonb;end if;
 if k='study.record'and(a->'minutes'is null or a->'minutes'='null'::jsonb)then missing:=missing||'"minutes"'::jsonb;end if;
 if k='question.read'and(a->'tool'is null or a->'tool'='null'::jsonb)then missing:=missing||'"supportedQuestion"'::jsonb;end if;
 if a?'date'and((a->>'date')<'2026-11-03'or(a->>'date')>'2026-12-02')then missing:=missing||'"experimentDate"'::jsonb;end if;
 return missing;
end;$$;

create function public.capture_public_view(p public.life_captures) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p.id,'inputType',coalesce(p.capture_workflow->>'inputType','text'),
  'source',case when p.source in('telegram','tma','web')then p.source else 'legacy'end,
  'sourceLabel',case when p.capture_version is distinct from 1 then 'Existing capture'when p.source='telegram' and p.capture_workflow->>'inputType'='voice'then 'Telegram voice note'when p.source='telegram'then 'Telegram'when p.source='web'then 'Web dashboard'else 'Telegram Mini App'end,
  'text',case when p.capture_deleted_at is not null then ''else left(p.text,8000)end,'transcript',case when p.capture_deleted_at is not null then null else p.capture_workflow->'transcript'end,
  'state',coalesce(p.capture_state,'completed'),'revision',greatest(1,p.capture_revision),'createdAt',p.created_at,'updatedAt',p.updated_at,
  'archivedAt',p.capture_archived_at,'expiresAt',p.capture_expires_at,'reviewExpiresAt',p.capture_review_expires_at,
  'errorCode',case when p.capture_deleted_at is not null then to_jsonb('capture_deleted'::text)else p.capture_workflow->'errorCode'end,
  'actions',case when p.capture_deleted_at is not null then '[]'::jsonb else coalesce((select jsonb_agg(a-'resourceId'-'receiptHash' order by ord)from jsonb_array_elements(coalesce(p.capture_workflow->'actions','[]'::jsonb))with ordinality x(a,ord)),'[]'::jsonb)end)
$$;

create function public.capture_service(p_user_id uuid,p_operation text,p_capture_id uuid,p_expected_revision integer,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.life_captures%rowtype;w jsonb;v_now timestamptz:=clock_timestamp();v_source text;v_text text;v_key text;v_hash text;v_type text;v_voice jsonb;v_ref jsonb;v_query text;v_limit integer;v_cursor_time timestamptz;v_cursor_id uuid;v_result jsonb;v_actions jsonb;v_action jsonb;v_payload jsonb;v_args jsonb;v_ids jsonb;v_receipt jsonb;v_kind text;v_id text;v_resource uuid;v_summary text;v_rows integer;v_index integer;v_saved_revision integer;v_any_success boolean;v_all_success boolean;v_provided jsonb;v_date date;v_target public.tasks%rowtype;v_patch jsonb;v_request text;v_approval_hash text;v_current jsonb;
begin
 if p_user_id is null or p_operation is null or p_operation not in('search','get','ingest','edit','retry','claim','finish','confirm','cancel','archive','delete','mark_external')or jsonb_typeof(p_input) is distinct from 'object'or octet_length(p_input::text)>4194304 then raise exception 'capture_invalid_input' using errcode='22023';end if;
 -- Same lock order as task/hydration/journal RPCs; profile blocking cannot race a write.
 perform 1 from public.profiles where user_id=p_user_id and status='active' for update;
 if not found then raise exception 'capture_permission_denied' using errcode='42501';end if;
 v_now:=clock_timestamp();
 if p_operation='search' then
  if exists(select from jsonb_object_keys(p_input)k where k not in('query','state','includeArchived','cursor','limit')) or jsonb_typeof(p_input->'query') is distinct from 'string' or length(p_input->>'query')>200 or jsonb_typeof(p_input->'includeArchived') is distinct from 'boolean' or jsonb_typeof(p_input->'limit') is distinct from 'number' then raise exception 'capture_invalid_input' using errcode='22023';end if;
  v_query:=lower(p_input->>'query');v_limit:=(p_input->>'limit')::integer;
  if v_limit<1 or v_limit>50 or(p_input?'state' and(p_input->>'state')not in('queued','processing','awaiting_transcript','needs_review','completed','failed','cancelled'))then raise exception 'capture_invalid_input' using errcode='22023';end if;
  if p_input?'cursor' then
   if jsonb_typeof(p_input->'cursor') is distinct from 'object' or exists(select from jsonb_object_keys(p_input->'cursor')k where k not in('createdAt','id'))then raise exception 'capture_invalid_input' using errcode='22023';end if;
   begin v_cursor_time:=(p_input->'cursor'->>'createdAt')::timestamptz;v_cursor_id:=(p_input->'cursor'->>'id')::uuid;exception when others then raise exception 'capture_invalid_input' using errcode='22023';end;
   if v_cursor_time is null or v_cursor_id is null then raise exception 'capture_invalid_input' using errcode='22023';end if;
  end if;
  with found as materialized(select x.* from public.life_captures x where x.user_id=p_user_id and x.capture_deleted_at is null and(x.capture_expires_at is null or x.capture_expires_at>v_now)and((p_input->>'includeArchived')::boolean or x.capture_archived_at is null)and(not p_input?'state' or coalesce(x.capture_state,'completed')=p_input->>'state')and(v_query=''or position(v_query in lower(x.text||coalesce(x.capture_workflow->>'transcript','')))>0)and(v_cursor_time is null or(x.created_at,x.id)<(v_cursor_time,v_cursor_id))order by x.created_at desc,x.id desc limit v_limit+1),page as(select *from found order by created_at desc,id desc limit v_limit)
  select jsonb_build_object('captures',coalesce((select jsonb_agg(public.capture_public_view(page::public.life_captures)order by created_at desc,id desc)from page),'[]'::jsonb),'nextCursor',case when(select count(*)from found)>v_limit then(select jsonb_build_object('createdAt',created_at,'id',id)from page order by created_at,id limit 1)else null end)into v_result;
  return v_result;
 end if;
 if p_operation='ingest' then
  if exists(select from jsonb_object_keys(p_input)k where k not in('requestId','inputType','text','retentionDays','source','voice','sourceReference'))then raise exception 'capture_invalid_input' using errcode='22023';end if;
  v_key:=p_input->>'requestId';v_source:=p_input->>'source';v_type:=p_input->>'inputType';v_text:=p_input->>'text';v_voice:=p_input->'voice';v_ref:=p_input->'sourceReference';
  if jsonb_typeof(p_input->'requestId')is distinct from'string'or v_key is null or v_key!~'^[A-Za-z0-9:_-]{8,120}$'or v_source is null or v_source not in('telegram','tma','web')or v_type is null or v_type not in('text','voice','link')or jsonb_typeof(p_input->'text') is distinct from 'string'or length(v_text)>8000 or(v_type<>'voice'and length(btrim(v_text))<1)or not public.capture_text_safe(v_text)or(p_input->'retentionDays' is not null and jsonb_typeof(p_input->'retentionDays')<>'null'and(p_input->'retentionDays'not in('7'::jsonb,'30'::jsonb,'90'::jsonb)))then raise exception 'capture_invalid_input' using errcode='22023';end if;
  if v_type='link'and(v_text!~*'^https?://'or v_text~*'^https?://[^/[:space:]]*@'or length(v_text)>2000)then raise exception 'capture_invalid_input' using errcode='22023';end if;
  if v_ref is not null and jsonb_typeof(v_ref)<>'null' then
   if v_source<>'telegram'or jsonb_typeof(v_ref) is distinct from 'object'or exists(select from jsonb_object_keys(v_ref)k where k not in('chatId','messageId','updateId','occurredAt'))or jsonb_typeof(v_ref->'chatId') is distinct from 'number'or jsonb_typeof(v_ref->'messageId') is distinct from 'number'or jsonb_typeof(v_ref->'updateId') is distinct from 'number' then raise exception 'capture_invalid_input' using errcode='22023';end if;
   if exists(select from jsonb_each(v_ref) f where f.key in('chatId','messageId','updateId')and((f.value::text)::numeric<>trunc((f.value::text)::numeric)or abs((f.value::text)::numeric)>9007199254740991))or(v_ref->>'chatId')::numeric=0 or(v_ref->>'messageId')::numeric<1 or(v_ref->>'updateId')::numeric<0 then raise exception 'capture_invalid_input' using errcode='22023';end if;
   if v_ref?'occurredAt' then
    begin if jsonb_typeof(v_ref->'occurredAt')is distinct from'string'or(v_ref->>'occurredAt')!~'(Z|[+-]\d\d:\d\d)$'or(v_ref->>'occurredAt')::timestamptz>v_now+interval '5 minutes'then raise exception 'capture_invalid_input' using errcode='22023';end if;exception when others then raise exception 'capture_invalid_input' using errcode='22023';end;
   end if;
  end if;
  if v_voice is not null and jsonb_typeof(v_voice)<>'null' then
   if v_source<>'telegram'or v_type<>'voice'or jsonb_typeof(v_voice) is distinct from 'object'or exists(select from jsonb_object_keys(v_voice)k where k not in('fileId','fileUniqueId','durationSeconds','mimeType','fileSize','referenceExpiresAt'))or jsonb_typeof(v_voice->'fileId')is distinct from'string'or jsonb_typeof(v_voice->'fileUniqueId')is distinct from'string'or(v_voice->>'fileId')!~'^[-A-Za-z0-9_]+$'or length(v_voice->>'fileId')not between 1 and 512 or(v_voice->>'fileUniqueId')!~'^[-A-Za-z0-9_]{1,200}$'or jsonb_typeof(v_voice->'durationSeconds') is distinct from 'number'or(v_voice->>'durationSeconds')::numeric<1 or(v_voice->>'durationSeconds')::numeric>120 or(v_voice->>'durationSeconds')::numeric<>trunc((v_voice->>'durationSeconds')::numeric)or(jsonb_typeof(v_voice->'fileSize')is distinct from'null'and(jsonb_typeof(v_voice->'fileSize')is distinct from'number'or(v_voice->>'fileSize')::numeric<1 or(v_voice->>'fileSize')::numeric>5242880))or(jsonb_typeof(v_voice->'mimeType')is distinct from'null'and(jsonb_typeof(v_voice->'mimeType')is distinct from'string'or(v_voice->>'mimeType')not in('audio/ogg','audio/opus','audio/ogg; codecs=opus')))then raise exception 'capture_invalid_input' using errcode='22023';end if;
   begin if jsonb_typeof(v_voice->'referenceExpiresAt')is distinct from'string'or(v_voice->>'referenceExpiresAt')::timestamptz>v_now+interval '24 hours'or(v_voice->>'referenceExpiresAt')!~'(Z|[+-]\d\d:\d\d)$'then raise exception 'capture_invalid_input' using errcode='22023';end if;exception when others then raise exception 'capture_invalid_input' using errcode='22023';end;
  end if;
  -- Stable original input fingerprint, never a processing timestamp or caller authority.
  v_hash:=md5(p_input::text);
  select *into c from public.life_captures where user_id=p_user_id and capture_ingestion_key=v_key for update;
  if found then
   if c.capture_ingestion_hash<>v_hash then raise exception 'capture_conflict' using errcode='P0001';end if;
   -- A retry can arrive before periodic maintenance: enforce expiry before projection.
   if c.capture_deleted_at is null and c.capture_expires_at is not null and c.capture_expires_at<=v_now then
    update public.life_captures set text='[Deleted capture]',status='deleted',metadata='{}'::jsonb,chat_id=null,message_id=null,capture_state='cancelled',capture_deleted_at=v_now,capture_revision=capture_revision+1,capture_review_expires_at=null,capture_lease_token=null,capture_lease_expires_at=null,capture_external_attempt=false,capture_workflow=jsonb_build_object('inputType',capture_workflow->>'inputType','transcript',null,'voice',null,'sourceReference',null,'actions','[]'::jsonb,'approvals','{}'::jsonb,'errorCode',null)where id=c.id and user_id=p_user_id returning *into c;
   elsif jsonb_typeof(c.capture_workflow->'voice')='object'and(c.capture_workflow->'voice'->>'referenceExpiresAt')::timestamptz<=v_now then
    update public.life_captures set capture_workflow=jsonb_set(capture_workflow,'{voice}','null'::jsonb)where id=c.id and user_id=p_user_id returning *into c;
   end if;
   return jsonb_build_object('capture',public.capture_public_view(c),'created',false);
  end if;
  if jsonb_typeof(v_voice)='object'and(v_voice->>'referenceExpiresAt')::timestamptz<=v_now then v_voice:=null;end if;
  if jsonb_typeof(v_voice)='object'then v_voice:=jsonb_set(v_voice,'{referenceExpiresAt}',to_jsonb(least((v_voice->>'referenceExpiresAt')::timestamptz,v_now+interval '24 hours')));end if;
  insert into public.life_captures(user_id,text,source,status,chat_id,message_id,capture_version,capture_ingestion_key,capture_ingestion_hash,capture_revision,capture_state,capture_expires_at,capture_workflow)
   values(p_user_id,case when v_type='voice'and v_text=''then '[Voice note]'else v_text end,v_source,'inbox',(v_ref->>'chatId')::bigint,(v_ref->>'messageId')::bigint,1,v_key,v_hash,1,case when v_type='voice'and v_text=''then 'awaiting_transcript'else 'queued'end,case when jsonb_typeof(p_input->'retentionDays')='number'then v_now+make_interval(days=>(p_input->>'retentionDays')::integer)else null end,jsonb_build_object('inputType',v_type,'transcript',null,'voice',v_voice,'sourceReference',v_ref,'actions','[]'::jsonb,'approvals','{}'::jsonb,'errorCode',null))returning *into c;
  return jsonb_build_object('capture',public.capture_public_view(c),'created',true);
 end if;
 if p_capture_id is null then raise exception 'capture_invalid_input' using errcode='22023';end if;
 select *into c from public.life_captures where user_id=p_user_id and id=p_capture_id for update;
 v_now:=clock_timestamp();
 if not found then if p_operation='get'then return null;end if;raise exception 'capture_not_found' using errcode='P0002';end if;
 if c.capture_deleted_at is not null then if p_operation='get'then return null;elsif p_operation='delete'then return jsonb_build_object('deleted',true);end if;raise exception'capture_not_found'using errcode='P0002';end if;
 if c.capture_expires_at is not null and c.capture_expires_at<=v_now then if p_operation='get'then return null;end if;raise exception'capture_not_found'using errcode='P0002';end if;
 if p_operation='get'then if p_input<>'{}'::jsonb then raise exception 'capture_invalid_input'using errcode='22023';end if;return public.capture_public_view(c);end if;
 if p_operation in('archive','delete')then
  if p_expected_revision is null or p_expected_revision<>greatest(1,c.capture_revision)then raise exception 'capture_conflict'using errcode='P0001';end if;
  if p_operation='archive'then
   if jsonb_typeof(p_input->'archived')is distinct from'boolean'or exists(select from jsonb_object_keys(p_input)k where k<>'archived')then raise exception'capture_invalid_input'using errcode='22023';end if;
   update public.life_captures set capture_version=coalesce(capture_version,2),capture_revision=greatest(1,capture_revision)+1,capture_archived_at=case when(p_input->>'archived')::boolean then coalesce(capture_archived_at,v_now)else null end,capture_state=case when(p_input->>'archived')::boolean and capture_state='processing'then'failed'else coalesce(capture_state,'completed')end,capture_lease_token=null,capture_lease_expires_at=null,capture_external_attempt=false,capture_workflow=coalesce(capture_workflow,'{"inputType":"text","transcript":null,"actions":[],"approvals":{},"errorCode":null}'::jsonb)where id=c.id and user_id=p_user_id returning *into c;
   return public.capture_public_view(c);
  else
   if p_input<>'{}'::jsonb then raise exception'capture_invalid_input'using errcode='22023';end if;
   update public.life_captures set text='[Deleted capture]',status='deleted',metadata='{}'::jsonb,chat_id=null,message_id=null,capture_version=coalesce(capture_version,2),capture_revision=greatest(1,capture_revision)+1,capture_state='cancelled',capture_deleted_at=v_now,capture_review_expires_at=null,capture_lease_token=null,capture_lease_expires_at=null,capture_external_attempt=false,capture_workflow=jsonb_build_object('inputType',coalesce(capture_workflow->>'inputType','text'),'transcript',null,'voice',null,'sourceReference',null,'actions','[]'::jsonb,'approvals','{}'::jsonb,'errorCode',null)where id=c.id and user_id=p_user_id;
   return jsonb_build_object('deleted',true);
  end if;
 end if;
 if c.capture_version is distinct from 1 then raise exception'capture_permission_denied'using errcode='42501';end if;
 w:=c.capture_workflow;v_actions:=coalesce(w->'actions','[]'::jsonb);
 select exists(select from jsonb_array_elements(v_actions)a where a->>'status'='succeeded')into v_any_success;
 if p_operation='claim'then
  if exists(select from jsonb_object_keys(p_input)k where k<>'leaseToken')or jsonb_typeof(p_input->'leaseToken')is distinct from'string'or(p_input->>'leaseToken')!~'^[A-Za-z0-9:_-]{8,120}$'then raise exception'capture_invalid_input'using errcode='22023';end if;
  if c.capture_archived_at is not null then return null;end if;
  if c.capture_state='processing'and c.capture_lease_expires_at<=v_now and c.capture_external_attempt then
   update public.life_captures set capture_state='failed',capture_lease_token=null,capture_lease_expires_at=null,capture_revision=capture_revision+1,capture_workflow=jsonb_set(w,'{errorCode}','"capture_provider_ambiguous"'::jsonb)where id=c.id and user_id=p_user_id;return null;
  end if;
  if(c.capture_state<>'queued'and not(c.capture_state='processing'and c.capture_lease_expires_at<=v_now))or v_any_success then return null;end if;
  if c.capture_attempt_count>=3 then update public.life_captures set capture_state='failed',capture_lease_token=null,capture_lease_expires_at=null,capture_revision=capture_revision+1,capture_workflow=jsonb_set(w,'{errorCode}','"capture_attempts_exhausted"'::jsonb)where id=c.id and user_id=p_user_id;return null;end if;
  if c.capture_workflow->'voice' is not null and jsonb_typeof(c.capture_workflow->'voice')='object'and(c.capture_workflow->'voice'->>'referenceExpiresAt')::timestamptz<=v_now then w:=jsonb_set(w,'{voice}','null'::jsonb);end if;
  update public.life_captures set capture_state='processing',capture_lease_token=p_input->>'leaseToken',capture_lease_expires_at=v_now+interval'60 seconds',capture_attempt_count=capture_attempt_count+1,capture_external_attempt=false,capture_revision=capture_revision+1,capture_workflow=w where id=c.id and user_id=p_user_id returning *into c;
  return jsonb_build_object('capture',public.capture_public_view(c),'leaseToken',c.capture_lease_token,'leaseExpiresAt',c.capture_lease_expires_at,'attemptCount',c.capture_attempt_count,'voice',c.capture_workflow->'voice','referenceTime',coalesce(c.capture_workflow->'sourceReference'->>'occurredAt',c.created_at::text));
 end if;
 if p_operation in('mark_external','finish')then
  if jsonb_typeof(p_input->'leaseToken')is distinct from'string'or(p_input->>'leaseToken')!~'^[A-Za-z0-9:_-]{8,120}$'then raise exception'capture_invalid_input'using errcode='22023';end if;
  if c.capture_state<>'processing'or c.capture_archived_at is not null or c.capture_lease_token is distinct from p_input->>'leaseToken'or c.capture_lease_expires_at is null or c.capture_lease_expires_at<=v_now then raise exception'capture_lease_lost'using errcode='P0001';end if;
  if p_operation='mark_external'then
   if exists(select from jsonb_object_keys(p_input)k where k<>'leaseToken')or c.capture_external_attempt then raise exception'capture_conflict'using errcode='P0001';end if;
   update public.life_captures set capture_external_attempt=true where id=c.id and user_id=p_user_id;return jsonb_build_object('marked',true);
  end if;
  if exists(select from jsonb_object_keys(p_input)k where k not in('leaseToken','proposals','transcript','errorCode','ambiguousProvider'))then raise exception'capture_invalid_input'using errcode='22023';end if;
  if p_input?'transcript'then if jsonb_typeof(p_input->'transcript')is distinct from'string'or length(btrim(p_input->>'transcript'))not between 1 and 8000 or not public.capture_text_safe(p_input->>'transcript')then raise exception'capture_invalid_input'using errcode='22023';end if;w:=jsonb_set(w,'{transcript}',p_input->'transcript');end if;
  if p_input?'errorCode'then
   if jsonb_typeof(p_input->'errorCode')is distinct from'string'or(p_input->>'errorCode')!~'^[a-z][a-z0-9_]{0,99}$'then raise exception'capture_invalid_input'using errcode='22023';end if;
   w:=jsonb_set(w,'{errorCode}',case when c.capture_external_attempt or p_input->>'ambiguousProvider'='true'then'"capture_provider_ambiguous"'::jsonb else p_input->'errorCode'end);
   update public.life_captures set capture_state='failed',capture_revision=capture_revision+1,capture_lease_token=null,capture_lease_expires_at=null,capture_workflow=w where id=c.id and user_id=p_user_id returning *into c;return public.capture_public_view(c);
  end if;
  if jsonb_typeof(p_input->'proposals')is distinct from'array'or jsonb_array_length(p_input->'proposals')>16 then raise exception'capture_invalid_input'using errcode='22023';end if;
  v_result:='[]'::jsonb;v_index:=0;
  for v_action in select value from jsonb_array_elements(p_input->'proposals')loop
   v_index:=v_index+1;if jsonb_typeof(v_action)is distinct from'object'or exists(select from jsonb_object_keys(v_action)k where k not in('id','kind','args','origin','summary','missingFields'))or v_action->>'id'is distinct from('action-'||v_index)or jsonb_typeof(v_action->'origin')is distinct from'string'or(v_action->>'origin')not in('deterministic','model','edited')or jsonb_typeof(v_action->'summary')is distinct from'string'or length(v_action->>'summary')>600 or jsonb_typeof(v_action->'missingFields')is distinct from'array'or jsonb_array_length(v_action->'missingFields')>10 or exists(select from jsonb_array_elements(v_action->'missingFields')f where jsonb_typeof(f)<>'string'or(f#>>'{}')!~'^[A-Za-z][A-Za-z0-9_]{0,79}$')then raise exception'capture_invalid_input'using errcode='22023';end if;
   perform public.capture_validate_action(jsonb_build_object('kind',v_action->'kind','args',v_action->'args'));
   v_current:=public.capture_missing_fields(jsonb_build_object('kind',v_action->'kind','args',v_action->'args'));
   v_result:=v_result||jsonb_build_array(v_action||jsonb_build_object('missingFields',v_current,'status',case when jsonb_array_length(v_current)>0 then'needs_input'else'pending'end,'resultSummary',null,'completedAt',null));
  end loop;
  w:=jsonb_set(jsonb_set(jsonb_set(w,'{actions}',v_result),'{errorCode}','null'::jsonb),'{voice}','null'::jsonb);
  update public.life_captures set capture_state=case when jsonb_array_length(v_result)=0 then'completed'else'needs_review'end,capture_revision=capture_revision+1,capture_lease_token=null,capture_lease_expires_at=null,capture_external_attempt=false,capture_review_expires_at=v_now+interval'10 minutes',capture_workflow=w where id=c.id and user_id=p_user_id returning *into c;
  return public.capture_public_view(c);
 end if;
 if p_operation='confirm'then
  if exists(select from jsonb_object_keys(p_input)k where k not in('requestId','expectedRevision','actionIds','confirmed','allowMemoryDelete','journalEntries','readResults'))or jsonb_typeof(p_input->'expectedRevision')is distinct from'number'or(p_input->>'expectedRevision')!~'^[1-9][0-9]{0,9}$'or p_input->'confirmed'is distinct from'true'::jsonb or jsonb_typeof(p_input->'allowMemoryDelete')is distinct from'boolean'or jsonb_typeof(p_input->'actionIds')is distinct from'array'or jsonb_array_length(p_input->'actionIds')not between 1 and 16 or(p_input->>'requestId')is null or(p_input->>'requestId')!~'^[A-Za-z0-9:_-]{8,120}$'or exists(select from jsonb_array_elements(p_input->'actionIds')a where jsonb_typeof(a)<>'string'or(a#>>'{}')!~'^action-([1-9]|1[0-6])$')then raise exception'capture_invalid_input'using errcode='22023';end if;
  if jsonb_typeof(p_input->'requestId')is distinct from'string'then raise exception'capture_invalid_input'using errcode='22023';end if;
  foreach v_kind in array array['journalEntries','readResults']loop
   if p_input?v_kind then
    if jsonb_typeof(p_input->v_kind)is distinct from'array'or jsonb_array_length(p_input->v_kind)>16 then raise exception'capture_invalid_input'using errcode='22023';end if;
    v_ids:='[]'::jsonb;
    for v_provided in select value from jsonb_array_elements(p_input->v_kind)loop
     if jsonb_typeof(v_provided)is distinct from'object'or jsonb_typeof(v_provided->'actionId')is distinct from'string'or(v_provided->>'actionId')!~'^action-([1-9]|1[0-6])$'or v_ids?(v_provided->>'actionId')then raise exception'capture_invalid_input'using errcode='22023';end if;
     if exists(select from jsonb_object_keys(v_provided)k where not k=any(case when v_kind='journalEntries'then array['actionId','action','date','expectedRevision','entry']else array['actionId','action','summary']end))then raise exception'capture_invalid_input'using errcode='22023';end if;
     v_ids:=v_ids||(v_provided->'actionId');
    end loop;
   end if;
  end loop;
  v_ids:=p_input->'actionIds';if(select count(distinct value)from jsonb_array_elements(v_ids))<>jsonb_array_length(v_ids)then raise exception'capture_invalid_input'using errcode='22023';end if;
  v_approval_hash:=md5(jsonb_build_object('expectedRevision',p_expected_revision,'actionIds',(select jsonb_agg(value order by value)from jsonb_array_elements(v_ids)))::text);
  v_receipt:=w->'approvals'->(p_input->>'requestId');
  if v_receipt is not null then if v_receipt->>'hash'is distinct from v_approval_hash then raise exception'capture_conflict'using errcode='P0001';end if;return public.capture_public_view(c);end if;
  if(select count(*)from jsonb_array_elements(v_actions)a where v_ids? (a->>'id'))<>jsonb_array_length(v_ids)then raise exception'capture_invalid_input'using errcode='22023';end if;
  select bool_and(a->>'status'='succeeded')into v_all_success from jsonb_array_elements(v_actions)a where v_ids?(a->>'id');
  -- Receipts are immutable: even an expired/lost-response retry cannot repeat a domain write.
  if v_all_success then return public.capture_public_view(c);end if;
  if p_expected_revision is null or p_expected_revision<>c.capture_revision or(p_input->>'expectedRevision')::integer<>p_expected_revision then raise exception'capture_conflict'using errcode='P0001';end if;
  if c.capture_state<>'needs_review'or c.capture_archived_at is not null then raise exception'capture_conflict'using errcode='P0001';end if;
  if c.capture_review_expires_at is null or c.capture_review_expires_at<=v_now then raise exception'capture_expired'using errcode='P0001';end if;
  v_result:='[]'::jsonb;
  for v_action in select value from jsonb_array_elements(v_actions)loop
   if not(v_ids?(v_action->>'id'))or v_action->>'status'='succeeded'then v_result:=v_result||jsonb_build_array(v_action);continue;end if;
   if v_action->>'status'<>'pending'or jsonb_array_length(v_action->'missingFields')<>0 or jsonb_array_length(public.capture_missing_fields(jsonb_build_object('kind',v_action->'kind','args',v_action->'args')))<>0 then raise exception'capture_invalid_input'using errcode='22023';end if;
   v_id:=v_action->>'id';v_kind:=v_action->>'kind';v_args:=v_action->'args';v_payload:=jsonb_build_object('kind',v_kind,'args',v_args);perform public.capture_validate_action(v_payload);v_resource:=null;v_summary:='Saved: '||left(v_action->>'summary',590);v_request:='capture:'||c.id||':'||v_id;
   if v_kind='task.create'then v_receipt:=public.manage_lifeos_task(p_user_id,null,v_request,jsonb_build_object('title',v_args->'title','notes',v_args->'notes','dueAt',v_args->'dueAt'),null);v_resource:=(v_receipt->>'id')::uuid;
   elsif v_kind in('task.update','task.complete')then
    v_patch:=case when v_kind='task.complete'then'{"status":"done"}'::jsonb else jsonb_build_object('title',v_args->'title')end;
    if v_kind='task.update'and v_args?'notes'then v_patch:=v_patch||jsonb_build_object('notes',v_args->'notes');end if;if v_kind='task.update'and v_args?'dueAt'then v_patch:=v_patch||jsonb_build_object('dueAt',v_args->'dueAt');end if;
    v_receipt:=public.manage_lifeos_task(p_user_id,(v_args->>'taskId')::uuid,null,v_patch,(v_args->>'expectedUpdatedAt')::timestamptz);v_resource:=(v_receipt->>'id')::uuid;
   elsif v_kind='water.log'then v_receipt:=public.log_hydration(p_user_id,v_request,(v_args->>'amountMl')::integer,case when c.source in('telegram','tma','web')then c.source else'tma'end);v_resource:=(v_receipt->>'id')::uuid;
   elsif v_kind='reminder.create'then v_receipt:=public.assistant_execute_mutation(p_user_id,v_request,case when c.source='telegram'then'telegram'else'tma'end,jsonb_build_object('type','reminder.create','message',v_args->'title','remindAt',v_args->'remindAt'));v_resource:=(v_receipt->>'resourceId')::uuid;
   elsif v_kind like'memory.%'then
    if v_kind='memory.delete'and p_input->'allowMemoryDelete'is distinct from'true'::jsonb then raise exception'capture_permission_denied'using errcode='42501';end if;
    v_patch:=jsonb_build_object('type',v_kind,'memoryKey',v_args->'key');if v_kind in('memory.remember','memory.update')then v_patch:=v_patch||jsonb_build_object('category',v_args->'category','content',v_args->'content');end if;
    v_receipt:=public.assistant_execute_mutation(p_user_id,v_request,case when c.source='telegram'then'telegram'else'tma'end,v_patch);v_resource:=(v_receipt->>'resourceId')::uuid;v_summary:=case when v_receipt->>'status'='not_found'then'No matching memory exists'else v_summary end;
   elsif v_kind='question.read'then
    select value into v_provided from jsonb_array_elements(coalesce(p_input->'readResults','[]'::jsonb))r(value)where value->>'actionId'=v_id;
    if not found or v_provided->'action'is distinct from v_payload or jsonb_typeof(v_provided->'summary')is distinct from'string'or length(btrim(v_provided->>'summary'))not between 1 and 8000 then raise exception'capture_invalid_input'using errcode='22023';end if;v_summary:=v_provided->>'summary';
   elsif v_kind='note.save'then
    if length(btrim(v_args->>'title'))<1 or length(btrim(v_args->>'content'))<1 then raise exception'capture_invalid_input'using errcode='22023';end if;
    insert into public.life_entities(user_id,entity_type,title,body,source,source_command,metadata)values(p_user_id,'capture',v_args->>'title',v_args->>'content','lifeos','capture.confirm',jsonb_build_object('captureId',c.id,'actionId',v_id,'kind','personal_note'))returning id into v_resource;
   else
    if v_kind not in('planning.suggest','study.record','learning.note','meal.record','workout.note','reflection.add','filming.idea')then raise exception'capture_invalid_input'using errcode='22023';end if;
    begin v_date:=(v_args->>'date')::date;exception when others then raise exception'capture_invalid_input'using errcode='22023';end;
    if v_date is null or v_date<date'2026-11-03'or v_date>date'2026-12-02'then raise exception'capture_journal_unavailable'using errcode='22023';end if;
    select value into v_provided from jsonb_array_elements(coalesce(p_input->'journalEntries','[]'::jsonb))r(value)where value->>'actionId'=v_id;
    if not found or v_provided->'action'is distinct from v_payload or(v_provided->>'date')is distinct from(v_args->>'date')or jsonb_typeof(v_provided->'entry')is distinct from'object'or jsonb_typeof(v_provided->'expectedRevision')is distinct from'number'then raise exception'capture_invalid_input'using errcode='22023';end if;
    perform public.save_ideal_human_day(p_user_id,v_date,v_provided->'entry',(v_provided->>'expectedRevision')::integer);
   end if;
   v_action:=v_action||jsonb_build_object('status','succeeded','resultSummary',v_summary,'completedAt',v_now,'resourceId',v_resource,'receiptHash',md5(v_payload::text));v_result:=v_result||jsonb_build_array(v_action);
  end loop;
  w:=jsonb_set(jsonb_set(w,'{actions}',v_result),array['approvals',p_input->>'requestId'],jsonb_build_object('hash',v_approval_hash,'completedAt',v_now));
  update public.life_captures set capture_workflow=w,capture_revision=capture_revision+1,capture_state=case when exists(select from jsonb_array_elements(v_result)a where a->>'status'in('pending','needs_input','conflict'))then'needs_review'else'completed'end where id=c.id and user_id=p_user_id returning *into c;
  return public.capture_public_view(c);
 end if;
 if p_expected_revision is null or p_expected_revision<>c.capture_revision then raise exception'capture_conflict'using errcode='P0001';end if;
 if p_operation='edit'then
  if exists(select from jsonb_object_keys(p_input)k where k not in('expectedRevision','transcript','actionId','action'))then raise exception'capture_invalid_input'using errcode='22023';end if;
  if p_input?'transcript'then
   if p_input?'actionId'or p_input?'action'or jsonb_typeof(p_input->'transcript')is distinct from'string'or length(btrim(p_input->>'transcript'))not between 1 and 8000 or not public.capture_text_safe(p_input->>'transcript')then raise exception'capture_invalid_input'using errcode='22023';end if;
   if w->>'transcript'=p_input->>'transcript'then return public.capture_public_view(c);end if;if v_any_success then raise exception'capture_conflict'using errcode='P0001';end if;
   w:=jsonb_set(jsonb_set(jsonb_set(w,'{transcript}',p_input->'transcript'),'{actions}','[]'::jsonb),'{errorCode}','null'::jsonb);
   update public.life_captures set capture_workflow=w,capture_revision=capture_revision+1,capture_state='queued',capture_review_expires_at=null,capture_lease_token=null,capture_lease_expires_at=null,capture_external_attempt=false where id=c.id and user_id=p_user_id returning *into c;
  else
   if(p_input->>'actionId')is null or(p_input->>'actionId')!~'^action-([1-9]|1[0-6])$'then raise exception'capture_invalid_input'using errcode='22023';end if;perform public.capture_validate_action(p_input->'action');v_rows:=0;v_result:='[]'::jsonb;
   for v_action in select value from jsonb_array_elements(v_actions)loop
    if v_action->>'id'=p_input->>'actionId'then
     if v_action->>'status'='succeeded'then raise exception'capture_conflict'using errcode='P0001';end if;v_rows:=v_rows+1;
     -- The trusted backend computes missing fields; SQL also revalidates every final domain write.
     v_current:=public.capture_missing_fields(p_input->'action');
     v_action:=jsonb_build_object('id',v_action->'id','kind',p_input->'action'->'kind','args',p_input->'action'->'args','origin','edited','summary',left((p_input->'action'->>'kind')||': '||coalesce(p_input->'action'->'args'->>'title',p_input->'action'->'args'->>'content',p_input->'action'->'args'->>'label',p_input->'action'->'args'->>'topic',p_input->'action'->'args'->>'key','Reviewed action'),600),'missingFields',v_current,'status',case when jsonb_array_length(v_current)>0 then'needs_input'else'pending'end,'resultSummary',null,'completedAt',null);
    end if;v_result:=v_result||jsonb_build_array(v_action);
   end loop;
   if v_rows<>1 then raise exception'capture_invalid_input'using errcode='22023';end if;
   update public.life_captures set capture_workflow=jsonb_set(w,'{actions}',v_result),capture_revision=capture_revision+1,capture_state='needs_review',capture_review_expires_at=v_now+interval'10 minutes'where id=c.id and user_id=p_user_id returning *into c;
  end if;return public.capture_public_view(c);
 elsif p_operation='retry'then
  if p_input<>'{}'::jsonb then raise exception'capture_invalid_input'using errcode='22023';end if;
  if c.capture_state='processing'and c.capture_lease_expires_at>v_now then raise exception'capture_conflict'using errcode='P0001';end if;
  if c.capture_attempt_count>=3 and not v_any_success then raise exception'capture_expired'using errcode='P0001';end if;
  update public.life_captures set capture_state=case when v_any_success then'needs_review'when capture_workflow->>'inputType'='voice'and coalesce(capture_workflow->>'transcript','')=''then'awaiting_transcript'else'queued'end,capture_revision=capture_revision+1,capture_review_expires_at=case when v_any_success then v_now+interval'10 minutes'else null end,capture_lease_token=null,capture_lease_expires_at=null,capture_external_attempt=false,capture_workflow=jsonb_set(w,'{errorCode}','null'::jsonb)where id=c.id and user_id=p_user_id returning *into c;return public.capture_public_view(c);
 elsif p_operation='cancel'then
  if p_input<>'{}'::jsonb then raise exception'capture_invalid_input'using errcode='22023';end if;
  select coalesce(jsonb_agg(case when a->>'status'='succeeded'then a else a||jsonb_build_object('status','cancelled')end order by ord),'[]'::jsonb)into v_result from jsonb_array_elements(v_actions)with ordinality x(a,ord);
  update public.life_captures set capture_state='cancelled',capture_revision=capture_revision+1,capture_workflow=jsonb_set(w,'{actions}',v_result),capture_lease_token=null,capture_lease_expires_at=null,capture_review_expires_at=null where id=c.id and user_id=p_user_id returning *into c;return public.capture_public_view(c);
 end if;
 raise exception'capture_invalid_input'using errcode='22023';
end;$$;

create function public.capture_claim_next(p_lease_token text)returns jsonb language plpgsql security invoker set search_path='' as $$
declare candidate record;job jsonb;v_now timestamptz:=clock_timestamp();
begin
 if p_lease_token is null or p_lease_token!~'^[A-Za-z0-9:_-]{8,120}$'then raise exception'capture_invalid_input'using errcode='22023';end if;
 for candidate in select c.user_id,c.id from public.life_captures c join public.profiles p on p.user_id=c.user_id and p.status='active'where c.capture_version=1 and c.capture_deleted_at is null and c.capture_archived_at is null and(c.capture_expires_at is null or c.capture_expires_at>v_now)and(c.capture_state='queued'or(c.capture_state='processing'and c.capture_lease_expires_at<=v_now))order by c.created_at,c.id limit 50 loop
  perform 1 from public.profiles where user_id=candidate.user_id and status='active'for update skip locked;if not found then continue;end if;
  perform 1 from public.life_captures where user_id=candidate.user_id and id=candidate.id for update skip locked;if not found then continue;end if;
  job:=public.capture_service(candidate.user_id,'claim',candidate.id,null,jsonb_build_object('leaseToken',p_lease_token));if job is not null then return jsonb_build_object('userId',candidate.user_id,'job',job);end if;
 end loop;return null;
end;$$;

create function public.capture_sweep(p_limit integer default 50)returns jsonb language plpgsql security invoker set search_path='' as $$
declare candidate record;c public.life_captures%rowtype;v_count integer:=0;v_now timestamptz:=clock_timestamp();
begin
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception'capture_invalid_input'using errcode='22023';end if;
 for candidate in select id,user_id from public.life_captures where capture_version=1 and capture_deleted_at is null and((capture_expires_at is not null and capture_expires_at<=v_now)or(jsonb_typeof(capture_workflow->'voice')='object'and(capture_workflow->'voice'->>'referenceExpiresAt')::timestamptz<=v_now))order by created_at,id limit p_limit loop
  perform 1 from public.profiles where user_id=candidate.user_id for update skip locked;if not found then continue;end if;
  select *into c from public.life_captures where user_id=candidate.user_id and id=candidate.id for update skip locked;if not found then continue;end if;
  if c.capture_expires_at is not null and c.capture_expires_at<=v_now then
   update public.life_captures set text='[Deleted capture]',status='deleted',metadata='{}'::jsonb,chat_id=null,message_id=null,capture_state='cancelled',capture_deleted_at=v_now,capture_revision=capture_revision+1,capture_review_expires_at=null,capture_lease_token=null,capture_lease_expires_at=null,capture_external_attempt=false,capture_workflow=jsonb_build_object('inputType',capture_workflow->>'inputType','transcript',null,'voice',null,'sourceReference',null,'actions','[]'::jsonb,'approvals','{}'::jsonb,'errorCode',null)where id=c.id and user_id=c.user_id;
  else update public.life_captures set capture_workflow=jsonb_set(capture_workflow,'{voice}','null'::jsonb)where id=c.id and user_id=c.user_id;end if;v_count:=v_count+1;
 end loop;return jsonb_build_object('scrubbed',v_count);
end;$$;
revoke all on function public.capture_text_safe(text),public.capture_validate_action(jsonb),public.capture_missing_fields(jsonb),public.capture_public_view(public.life_captures),public.capture_service(uuid,text,uuid,integer,jsonb),public.capture_claim_next(text),public.capture_sweep(integer)from public,anon,authenticated;
grant execute on function public.capture_text_safe(text),public.capture_validate_action(jsonb),public.capture_missing_fields(jsonb),public.capture_public_view(public.life_captures),public.capture_service(uuid,text,uuid,integer,jsonb),public.capture_claim_next(text),public.capture_sweep(integer)to service_role;
comment on column public.life_captures.capture_ingestion_hash is 'Content-free original ingestion fingerprint retained with scrubbed tombstones to reject replay. Never reset for application rollback.';
commit;
