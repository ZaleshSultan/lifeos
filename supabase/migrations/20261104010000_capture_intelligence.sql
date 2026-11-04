-- Nighthawk v2 is an additive compatibility boundary. The original capture RPC,
-- public projection, executable payloads and transaction receipts remain intact.
-- Presentation is stored separately and is never confirmation authority.
create function public.capture_validate_presentation(p jsonb) returns void
language plpgsql stable security invoker set search_path='' as $$
declare f text;
begin
 if jsonb_typeof(p) is distinct from 'object'
 or exists(select from jsonb_object_keys(p) k where k not in('title','description','suggestedDate','timeHint','relation','language','evidence','warnings','timezone','dateBasis'))
 or not(p ?& array['title','description','suggestedDate','timeHint','relation','language','evidence','warnings','timezone','dateBasis'])
 then raise exception 'capture_invalid_input' using errcode='22023';end if;
 foreach f in array array['title','description','timeHint','relation'] loop
  if jsonb_typeof(p->f) not in('string','null') or(f='title' and(jsonb_typeof(p->f)<>'string' or length(btrim(p->>f))<1))
  or(jsonb_typeof(p->f)='string' and(length(p->>f)>case f when 'description' then 2000 when 'timeHint' then 120 else 240 end or not public.capture_text_safe(p->>f)))
  then raise exception 'capture_invalid_input' using errcode='22023';end if;
 end loop;
 if jsonb_typeof(p->'suggestedDate') not in('string','null')
 or(jsonb_typeof(p->'suggestedDate')='string' and(p->>'suggestedDate')!~'^\d{4}-\d{2}-\d{2}$')
 or jsonb_typeof(p->'language') is distinct from 'string' or(p->>'language')not in('ru','kk','en','mixed','und')
 or jsonb_typeof(p->'evidence') is distinct from 'string' or(p->>'evidence')not in('user_statement','recommendation')
 or jsonb_typeof(p->'dateBasis') is distinct from 'string' or(p->>'dateBasis')not in('profile','ideal_human')
 or jsonb_typeof(p->'timezone') is distinct from 'string' or not exists(select from pg_catalog.pg_timezone_names where name=p->>'timezone')
 or jsonb_typeof(p->'warnings') is distinct from 'array' or jsonb_array_length(p->'warnings')>8
 or exists(select from jsonb_array_elements(p->'warnings') w where jsonb_typeof(w)<>'string' or length(w#>>'{}')>240 or not public.capture_text_safe(w#>>'{}'))
 then raise exception 'capture_invalid_input' using errcode='22023';end if;
 if jsonb_typeof(p->'suggestedDate')='string' then
  begin perform (p->>'suggestedDate')::date;exception when others then raise exception 'capture_invalid_input' using errcode='22023';end;
 end if;
end;$$;

create function public.capture_public_v2_view(p public.life_captures) returns jsonb
language sql stable security invoker set search_path='' as $$
 select public.capture_public_view(p)||jsonb_build_object(
  'actions',coalesce((select jsonb_agg(a||
   case when p.capture_deleted_at is null and jsonb_typeof(p.capture_workflow->'presentations'->(a->>'id'))='object'
    then jsonb_build_object('presentation',p.capture_workflow->'presentations'->(a->>'id'))else '{}'::jsonb end||
   jsonb_build_object('extractionOrigin',case when p.capture_workflow->'actionOrigins'->>(a->>'id')in('deterministic','model')then p.capture_workflow->'actionOrigins'->(a->>'id')else 'null'::jsonb end)
   order by ord)from jsonb_array_elements(public.capture_public_view(p)->'actions')with ordinality x(a,ord)),'[]'::jsonb),
  'processingStage',case when p.capture_state='processing' and p.capture_deleted_at is null then
   case when p.capture_external_attempt and p.capture_workflow->'external'->>'mode'='transcription'then 'transcribing'else 'extracting'end else null end,
  'transcriptSource',case when p.capture_deleted_at is null and jsonb_typeof(p.capture_workflow->'transcript')='string'
   and p.capture_workflow->>'transcriptSource'in('manual','provider')then p.capture_workflow->>'transcriptSource'else null end)
$$;

create function public.capture_service_v2(p_user_id uuid,p_operation text,p_capture_id uuid,p_expected_revision integer,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.life_captures%rowtype;v jsonb;inp jsonb:=p_input;w jsonb;a jsonb;item jsonb;presentations jsonb;origins jsonb;result jsonb;target_id text;found_action boolean;now_at timestamptz:=clock_timestamp();saved_revision integer;lease text;expiry timestamptz;
begin
 if p_user_id is null or p_operation is null or jsonb_typeof(p_input)is distinct from'object' or octet_length(p_input::text)>4194304
 then raise exception'capture_invalid_input'using errcode='22023';end if;
 if p_operation in('claim_external','revise')then
  -- Preserve the lock order of the original owner-scoped domain transactions.
  perform 1 from public.profiles where user_id=p_user_id and status='active'for update;
  if not found then raise exception'capture_permission_denied'using errcode='42501';end if;
  now_at:=clock_timestamp();
  select *into c from public.life_captures where id=p_capture_id and user_id=p_user_id and capture_deleted_at is null and(capture_expires_at is null or capture_expires_at>now_at)for update;
  if not found then raise exception'capture_not_found'using errcode='P0002';end if;
  now_at:=clock_timestamp();
  if c.capture_expires_at is not null and c.capture_expires_at<=now_at then raise exception'capture_not_found'using errcode='P0002';end if;
  if c.capture_version is distinct from 1 or c.capture_archived_at is not null then raise exception'capture_conflict'using errcode='P0001';end if;
  w:=c.capture_workflow;
  if p_operation='claim_external'then
   if exists(select from jsonb_object_keys(p_input)k where k not in('mode','requestId','leaseToken','consentExpiresAt','policy'))
   or not(p_input?&array['mode','requestId','leaseToken','consentExpiresAt','policy'])
   or p_input->>'mode'not in('model','transcription')or jsonb_typeof(p_input->'mode')<>'string'
   or jsonb_typeof(p_input->'requestId')is distinct from'string'or(p_input->>'requestId')!~'^[A-Za-z0-9:_-]{8,120}$'
   or jsonb_typeof(p_input->'leaseToken')is distinct from'string'or(p_input->>'leaseToken')!~'^[A-Za-z0-9:_-]{8,120}$'
   or jsonb_typeof(p_input->'policy')is distinct from'object'or octet_length((p_input->'policy')::text)>2000
   or exists(select from jsonb_object_keys(p_input->'policy')k where k not in('settingsRevision','modelId','provider','maxRequestCostMicros'))
   or not((p_input->'policy')?&array['settingsRevision','modelId','provider','maxRequestCostMicros'])
   or jsonb_typeof(p_input->'policy'->'settingsRevision')is distinct from'number'or(p_input->'policy'->>'settingsRevision')!~'^\d{1,10}$'
   or jsonb_typeof(p_input->'policy'->'modelId')is distinct from'string'or(p_input->'policy'->>'modelId')!~'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'
   or jsonb_typeof(p_input->'policy'->'provider')is distinct from'string'or(p_input->'policy'->>'provider')not in('gemini','openrouter','openai','anthropic')
   or jsonb_typeof(p_input->'policy'->'maxRequestCostMicros')is distinct from'number'or(p_input->'policy'->>'maxRequestCostMicros')!~'^\d{1,13}$'
   then raise exception'capture_invalid_input'using errcode='22023';end if;
   -- A lost HTTP response never authorizes another provider attempt with this ID.
   if w->'external'->>'requestId'=p_input->>'requestId'then
    if w->'external'->>'mode'<>p_input->>'mode'then raise exception'capture_conflict'using errcode='P0001';end if;
    return null;
   end if;
   if p_expected_revision is null or c.capture_revision<>p_expected_revision then raise exception'capture_conflict'using errcode='P0001';end if;
   if c.capture_state='processing'or c.capture_state='cancelled'or exists(select from jsonb_array_elements(coalesce(w->'actions','[]'::jsonb))x where x->>'status'='succeeded')then raise exception'capture_conflict'using errcode='P0001';end if;
   if c.capture_attempt_count>=3 then raise exception'capture_expired'using errcode='P0001';end if;
   begin expiry:=(p_input->>'consentExpiresAt')::timestamptz;exception when others then raise exception'capture_invalid_input'using errcode='22023';end;
   if expiry is null or expiry<=now_at or expiry>now_at+interval'5 minutes'then raise exception'capture_permission_denied'using errcode='42501';end if;
   if p_input->>'mode'='transcription'and(w->>'inputType'<>'voice'or coalesce(w->>'transcript','')<>''or jsonb_typeof(w->'voice')is distinct from'object'or(w->'voice'->>'referenceExpiresAt')::timestamptz<=now_at)then raise exception'capture_conflict'using errcode='P0001';end if;
   lease:=p_input->>'leaseToken';
   w:=jsonb_set(w,'{external}',jsonb_build_object('mode',p_input->'mode','requestId',p_input->'requestId','consentExpiresAt',p_input->'consentExpiresAt','policy',p_input->'policy','confirmedAt',now_at));
   update public.life_captures set capture_state='processing',capture_revision=capture_revision+1,capture_attempt_count=capture_attempt_count+1,capture_lease_token=lease,capture_lease_expires_at=now_at+interval'60 seconds',capture_external_attempt=true,capture_review_expires_at=null,capture_workflow=w where id=c.id and user_id=p_user_id returning *into c;
   return jsonb_build_object('capture',public.capture_public_v2_view(c),'leaseToken',lease,'leaseExpiresAt',c.capture_lease_expires_at,'attemptCount',c.capture_attempt_count,'voice',c.capture_workflow->'voice','referenceTime',coalesce(c.capture_workflow->'sourceReference'->>'occurredAt',c.created_at::text));
  end if;
  -- Revision-bound correction/rejection changes only unapproved proposals. All
  -- patches are in this single transaction; original IDs/receipts are preserved.
  if p_expected_revision is null or c.capture_revision<>p_expected_revision then raise exception'capture_conflict'using errcode='P0001';end if;
  if c.capture_state not in('needs_review','failed')then raise exception'capture_conflict'using errcode='P0001';end if;
  if exists(select from jsonb_object_keys(p_input)k where k not in('updates','cancelActionIds'))
  or jsonb_typeof(p_input->'updates')is distinct from'array'or jsonb_array_length(p_input->'updates')>16
  or jsonb_typeof(p_input->'cancelActionIds')is distinct from'array'or jsonb_array_length(p_input->'cancelActionIds')>16
  or jsonb_array_length(p_input->'updates')+jsonb_array_length(p_input->'cancelActionIds')not between 1 and 16
  then raise exception'capture_invalid_input'using errcode='22023';end if;
  if(select count(*)<>count(distinct id)from(select x->>'actionId'as id from jsonb_array_elements(p_input->'updates')x union all select x#>>'{}'from jsonb_array_elements(p_input->'cancelActionIds')x)s)then raise exception'capture_invalid_input'using errcode='22023';end if;
  saved_revision:=c.capture_revision;
  for item in select value from jsonb_array_elements(p_input->'updates')loop
   if jsonb_typeof(item)is distinct from'object'or exists(select from jsonb_object_keys(item)k where k not in('actionId','action','presentation'))or not(item?&array['actionId','action','presentation'])then raise exception'capture_invalid_input'using errcode='22023';end if;
   perform public.capture_validate_presentation(item->'presentation');
   v:=public.capture_service(p_user_id,'edit',p_capture_id,saved_revision,jsonb_build_object('actionId',item->'actionId','action',item->'action'));
   saved_revision:=(v->>'revision')::integer;
   select *into c from public.life_captures where id=p_capture_id and user_id=p_user_id;
   w:=jsonb_set(c.capture_workflow,'{presentations}',coalesce(c.capture_workflow->'presentations','{}'::jsonb)||jsonb_build_object(item->>'actionId',item->'presentation'));
   update public.life_captures set capture_workflow=w where id=p_capture_id and user_id=p_user_id;
  end loop;
  select *into c from public.life_captures where id=p_capture_id and user_id=p_user_id;w:=c.capture_workflow;
  for item in select value from jsonb_array_elements(p_input->'cancelActionIds')loop
   if jsonb_typeof(item)is distinct from'string'or(item#>>'{}')!~'^action-([1-9]|1[0-6])$'then raise exception'capture_invalid_input'using errcode='22023';end if;
   target_id:=item#>>'{}';found_action:=false;result:='[]'::jsonb;
   for a in select value from jsonb_array_elements(w->'actions')loop
    if a->>'id'=target_id then
     if a->>'status'not in('pending','needs_input','conflict')then raise exception'capture_conflict'using errcode='P0001';end if;
     a:=a||jsonb_build_object('status','cancelled');found_action:=true;
    end if;result:=result||jsonb_build_array(a);
   end loop;
   if not found_action then raise exception'capture_invalid_input'using errcode='22023';end if;
   w:=jsonb_set(w,'{actions}',result);
  end loop;
  update public.life_captures set capture_workflow=w,capture_revision=capture_revision+1,capture_review_expires_at=now_at+interval'10 minutes',capture_state=case when exists(select from jsonb_array_elements(w->'actions')x where x->>'status'not in('succeeded','cancelled'))then'needs_review'else'completed'end where id=p_capture_id and user_id=p_user_id returning *into c;
  return public.capture_public_v2_view(c);
 end if;
 if p_operation='finish'then
  if p_input?'presentations'then
   presentations:=p_input->'presentations';
   if jsonb_typeof(presentations)is distinct from'object'or(select count(*)from jsonb_object_keys(presentations))>16 then raise exception'capture_invalid_input'using errcode='22023';end if;
   for target_id,item in select key,value from jsonb_each(presentations)loop
    if not exists(select from jsonb_array_elements(p_input->'proposals')x where x->>'id'=target_id)then raise exception'capture_invalid_input'using errcode='22023';end if;
    perform public.capture_validate_presentation(item);
   end loop;
  end if;
  if p_input?'fallbackCode'and(jsonb_typeof(p_input->'fallbackCode')is distinct from'string'or(p_input->>'fallbackCode')not in('capture_model_fallback')or not(p_input?'proposals')or p_input?'errorCode')then raise exception'capture_invalid_input'using errcode='22023';end if;
  if p_input?'transcriptSource'and(jsonb_typeof(p_input->'transcriptSource')is distinct from'string'or(p_input->>'transcriptSource')not in('provider','manual')or not(p_input?'transcript'))then raise exception'capture_invalid_input'using errcode='22023';end if;
  inp:=p_input-'presentations'-'fallbackCode'-'transcriptSource';
 end if;
 v:=public.capture_service(p_user_id,p_operation,p_capture_id,p_expected_revision,inp);
 if v is null then return null;end if;
 if p_operation='search'then
  select coalesce(jsonb_agg(public.capture_public_v2_view(c2)order by x.ord),'[]'::jsonb)into result
  from jsonb_array_elements(v->'captures')with ordinality x(a,ord)join public.life_captures c2 on c2.id=(x.a->>'id')::uuid and c2.user_id=p_user_id;
  return jsonb_set(v,'{captures}',result);
 end if;
 if p_operation='ingest'then p_capture_id:=(v->'capture'->>'id')::uuid;end if;
 select *into c from public.life_captures where id=p_capture_id and user_id=p_user_id;
 if not found then return v;end if;
 w:=c.capture_workflow;
 if p_operation='finish'and p_input?'proposals'and not(p_input?'errorCode')then
  select coalesce(jsonb_object_agg(x->>'id',x->'origin'),'{}'::jsonb)into origins from jsonb_array_elements(p_input->'proposals')x;
  w:=jsonb_set(jsonb_set(w,'{presentations}',coalesce(presentations,'{}'::jsonb)),'{actionOrigins}',origins);
  if p_input?'transcript'then w:=jsonb_set(w,'{transcriptSource}',coalesce(p_input->'transcriptSource','"provider"'::jsonb));end if;
  if p_input?'fallbackCode'then w:=jsonb_set(w,'{errorCode}',p_input->'fallbackCode');end if;
 elsif p_operation='finish'and p_input?'errorCode'and(p_input->>'errorCode')in('voice_unsupported','voice_too_large','voice_reference_expired','voice_download_origin_rejected','voice_download_failed','voice_download_timeout','voice_cancelled','voice_transcription_unavailable','voice_consent_required','voice_transcription_failed','voice_transcription_timeout','voice_quota_exceeded')then
  -- Preserve a normalized actionable error, but retain the external-attempt
  -- marker and failed state. No automatic retry or cost refund is implied.
  w:=jsonb_set(w,'{errorCode}',p_input->'errorCode');
 elsif p_operation='edit'then
  if p_input?'transcript'then w:=jsonb_set(w-'presentations'-'actionOrigins','{transcriptSource}','"manual"'::jsonb);
  elsif p_input?'actionId'then w:=jsonb_set(w,'{presentations}',coalesce(w->'presentations','{}'::jsonb)-(p_input->>'actionId'));end if;
 end if;
 if w is distinct from c.capture_workflow then update public.life_captures set capture_workflow=w where id=p_capture_id and user_id=p_user_id returning *into c;end if;
 result:=public.capture_public_v2_view(c);
 if p_operation in('ingest','claim')then return jsonb_set(v,'{capture}',result);end if;
 if p_operation='delete'then return v;end if;
 return result;
end;$$;

revoke all on function public.capture_validate_presentation(jsonb) from public,anon,authenticated;
revoke all on function public.capture_public_v2_view(public.life_captures) from public,anon,authenticated;
revoke all on function public.capture_service_v2(uuid,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.capture_validate_presentation(jsonb) to service_role;
grant execute on function public.capture_public_v2_view(public.life_captures) to service_role;
grant execute on function public.capture_service_v2(uuid,text,uuid,integer,jsonb) to service_role;
