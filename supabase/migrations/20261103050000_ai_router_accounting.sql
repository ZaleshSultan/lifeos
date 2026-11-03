-- Extend the existing governor ledger, not a second budget or agent framework.
begin;
alter table public.ai_execution_reservations
  add column routing jsonb,
  add column reported_cost_micros bigint check (reported_cost_micros between 0 and 1000000000000);
create index ai_execution_owner_routed_recent_idx
  on public.ai_execution_reservations(user_id,created_at desc) where routing is not null;

create function public.valid_ai_routing_metadata(v jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; n bigint;
begin
  if v is null or jsonb_typeof(v)<>'object' or octet_length(v::text)>4096
    or (select count(*) from jsonb_object_keys(v))<>12 then return false; end if;
  for k in select jsonb_object_keys(v) loop
    if k not in ('version','provider','model','selectedModelId','credentialLabel','billing','attempts','fallback','inputTokens','outputTokens','reportedCostMicros','costSource') then return false; end if;
  end loop;
  if v->'version'<>'1'::jsonb
    or jsonb_typeof(v->'provider') is distinct from 'string'
    or v->>'provider' not in ('gemini','openrouter','openai','anthropic','chatgpt_plan')
    or jsonb_typeof(v->'billing') is distinct from 'string'
    or v->>'billing' not in ('api','free','chatgpt_plan')
    or (v->>'provider'='chatgpt_plan')<>(v->>'billing'='chatgpt_plan')
    or jsonb_typeof(v->'costSource') is distinct from 'string'
    or v->>'costSource' not in ('provider_reported','rate_estimate','unknown')
    or jsonb_typeof(v->'fallback')<>'boolean'
    or jsonb_typeof(v->'model')<>'string' or v->>'model' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'
    or position('://' in v->>'model')>0
    or jsonb_typeof(v->'selectedModelId')<>'string' or v->>'selectedModelId' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'
    or position('://' in v->>'selectedModelId')>0
    or jsonb_typeof(v->'credentialLabel')<>'string' or v->>'credentialLabel' !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
    or jsonb_typeof(v->'attempts')<>'number' or v->>'attempts' !~ '^[1-3]$' then return false; end if;
  for k in select unnest(array['inputTokens','outputTokens','reportedCostMicros']) loop
    if jsonb_typeof(v->k)='null' then continue; end if;
    if jsonb_typeof(v->k)<>'number' or v->>k !~ '^[0-9]+$' then return false; end if;
    n:=(v->>k)::bigint;
    if n<0 or n>(case when k='reportedCostMicros' then 1000000000000 else 10000000 end) then return false; end if;
  end loop;
  if v->>'billing'='chatgpt_plan' and (v->'reportedCostMicros'<>'null'::jsonb or v->>'costSource'<>'unknown') then return false; end if;
  if v->>'billing'='free' and coalesce((v->>'reportedCostMicros')::bigint,0)<>0 then return false; end if;
  return true;
exception when others then return false;
end; $$;
revoke all on function public.valid_ai_routing_metadata(jsonb) from public,anon,authenticated;
grant execute on function public.valid_ai_routing_metadata(jsonb) to service_role;

create or replace function public.reserve_ai_execution(p_user_id uuid,p_feature text,p_request_id text,p_task_id text,p_tokens integer,p_estimated_cost_micros bigint,p_limits jsonb)
returns text language plpgsql security invoker set search_path='' as $$
declare
  v_day date := (clock_timestamp() at time zone 'UTC')::date;
  v_user_tokens bigint; v_feature_tokens bigint; v_global_tokens bigint;
  v_user_cost bigint; v_feature_cost bigint; v_global_cost bigint;
  v_unknown_user boolean; v_unknown_feature boolean; v_unknown_global boolean;
  v_user_cap bigint; v_feature_cap bigint; v_global_cap bigint;
  v_user_cost_cap bigint; v_feature_cost_cap bigint; v_global_cost_cap bigint;
  v_max_iterations integer;
begin
  if p_user_id is null or p_request_id is null or p_request_id !~ '^[A-Za-z0-9:_-]{1,128}$'
    or p_task_id is null or p_task_id !~ '^[A-Za-z0-9:_-]{1,128}$'
    or p_feature is null or p_feature not in ('chat','classification','finance','meal_photo','morning_briefing','evening_review','documentary','agata')
    or p_tokens is null or p_tokens < 1 or p_tokens > 1000000
    or (p_estimated_cost_micros is not null and (p_estimated_cost_micros < 0 or p_estimated_cost_micros > 1000000000000))
    or p_limits is null or jsonb_typeof(p_limits) <> 'object' then
    raise exception using errcode='22023',message='invalid_ai_budget_request';
  end if;
  begin
    v_user_cap := (p_limits->>'userTokens')::bigint;
    v_feature_cap := (p_limits->>'featureTokens')::bigint;
    v_global_cap := (p_limits->>'globalTokens')::bigint;
    v_user_cost_cap := (p_limits->>'userCostMicros')::bigint;
    v_feature_cost_cap := (p_limits->>'featureCostMicros')::bigint;
    v_global_cost_cap := (p_limits->>'globalCostMicros')::bigint;
    v_max_iterations := (p_limits->>'maxIterations')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode='22023',message='invalid_ai_budget_limits';
  end;
  if v_user_cap is null or v_feature_cap is null or v_global_cap is null or v_max_iterations is null
    or v_user_cap not between 1 and 1000000000 or v_feature_cap not between 1 and 1000000000
    or v_global_cap not between 1 and 1000000000 or v_max_iterations not between 1 and 20
    or (v_user_cost_cap is not null and v_user_cost_cap not between 0 and 1000000000000)
    or (v_feature_cost_cap is not null and v_feature_cost_cap not between 0 and 1000000000000)
    or (v_global_cost_cap is not null and v_global_cost_cap not between 0 and 1000000000000) then
    raise exception using errcode='22023',message='invalid_ai_budget_limits';
  end if;
  -- One database-wide accounting lock covers concurrent backend processes.
  perform pg_catalog.pg_advisory_xact_lock(7271032401);
  perform 1 from public.profiles where user_id=p_user_id and status='active' for share;
  if not found then return 'profile_inactive'; end if;
  if exists(select from public.ai_execution_reservations where user_id=p_user_id and request_id=p_request_id) then return 'duplicate'; end if;
  if (select count(*) from public.ai_execution_reservations where user_id=p_user_id and task_id=p_task_id) >= v_max_iterations then return 'iteration_limit'; end if;
  select
    coalesce(sum(greatest(reserved_tokens,coalesce(reported_tokens,0))) filter(where user_id=p_user_id),0),
    coalesce(sum(greatest(reserved_tokens,coalesce(reported_tokens,0))) filter(where user_id=p_user_id and feature=p_feature),0),
    coalesce(sum(greatest(reserved_tokens,coalesce(reported_tokens,0))),0),
    coalesce(sum(greatest(estimated_cost_micros,coalesce(reported_cost_micros,0))) filter(where user_id=p_user_id),0),
    coalesce(sum(greatest(estimated_cost_micros,coalesce(reported_cost_micros,0))) filter(where user_id=p_user_id and feature=p_feature),0),
    coalesce(sum(greatest(estimated_cost_micros,coalesce(reported_cost_micros,0))),0),
    coalesce(bool_or(estimated_cost_micros is null) filter(where user_id=p_user_id),false),
    coalesce(bool_or(estimated_cost_micros is null) filter(where user_id=p_user_id and feature=p_feature),false),
    coalesce(bool_or(estimated_cost_micros is null),false)
  into v_user_tokens,v_feature_tokens,v_global_tokens,v_user_cost,v_feature_cost,v_global_cost,v_unknown_user,v_unknown_feature,v_unknown_global
  from public.ai_execution_reservations where day=v_day;
  if v_user_tokens+p_tokens > v_user_cap or v_feature_tokens+p_tokens > v_feature_cap or v_global_tokens+p_tokens > v_global_cap then return 'token_budget_exceeded'; end if;
  if (v_user_cost_cap is not null and (p_estimated_cost_micros is null or v_unknown_user or v_user_cost+p_estimated_cost_micros>v_user_cost_cap))
    or (v_feature_cost_cap is not null and (p_estimated_cost_micros is null or v_unknown_feature or v_feature_cost+p_estimated_cost_micros>v_feature_cost_cap))
    or (v_global_cost_cap is not null and (p_estimated_cost_micros is null or v_unknown_global or v_global_cost+p_estimated_cost_micros>v_global_cost_cap)) then return 'cost_budget_exceeded'; end if;
  insert into public.ai_execution_reservations(user_id,request_id,task_id,feature,day,reserved_tokens,estimated_cost_micros)
    values(p_user_id,p_request_id,p_task_id,p_feature,v_day,p_tokens,p_estimated_cost_micros);
  return 'reserved';
end;
$$;


create function public.reserve_ai_router_execution(p_user_id uuid,p_feature text,p_request_id text,p_task_id text,p_tokens integer,p_estimated_cost_micros bigint,p_limits jsonb,p_routing jsonb)
returns text language plpgsql security invoker set search_path='' as $$
declare outcome text;
begin
  if not public.valid_ai_routing_metadata(p_routing) then raise exception using errcode='22023',message='invalid_ai_router_metadata'; end if;
  if p_routing->>'billing'='chatgpt_plan' and p_estimated_cost_micros is not null then raise exception using errcode='22023',message='invalid_ai_router_plan_billing'; end if;
  outcome:=public.reserve_ai_execution(p_user_id,p_feature,p_request_id,p_task_id,p_tokens,p_estimated_cost_micros,p_limits);
  if outcome='reserved' then
    update public.ai_execution_reservations set routing=p_routing where user_id=p_user_id and request_id=p_request_id;
  end if;
  return outcome;
end; $$;
create function public.finish_ai_router_execution(p_user_id uuid,p_request_id text,p_state text,p_reported_tokens integer,p_routing jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare row_state text; previous jsonb; previous_tokens integer; reserved_cost bigint;
begin
  if not public.valid_ai_routing_metadata(p_routing) then raise exception using errcode='22023',message='invalid_ai_router_metadata'; end if;
  perform pg_catalog.pg_advisory_xact_lock(7271032401);
  select state,routing,reported_tokens,estimated_cost_micros into row_state,previous,previous_tokens,reserved_cost from public.ai_execution_reservations where user_id=p_user_id and request_id=p_request_id for update;
  if not found then return false; end if;
  if previous is null then return false; end if;
  if (p_routing->>'billing') is distinct from (previous->>'billing') then
    raise exception using errcode='22023',message='invalid_ai_router_billing';
  end if;
  -- Plan usage has no API-money price. Never relabel an API reservation as a
  -- subscription request, or silently change a plan request's billing path.
  if (p_routing->>'billing'='chatgpt_plan' or previous->>'billing'='chatgpt_plan')
    and reserved_cost is not null then
    raise exception using errcode='22023',message='invalid_ai_router_plan_billing';
  end if;
  if row_state<>'reserved' then return row_state=p_state and previous=p_routing and previous_tokens is not distinct from p_reported_tokens; end if;
  if not public.finish_ai_execution(p_user_id,p_request_id,p_state,p_reported_tokens) then return false; end if;
  update public.ai_execution_reservations set routing=p_routing,reported_cost_micros=(p_routing->>'reportedCostMicros')::bigint
    where user_id=p_user_id and request_id=p_request_id;
  return true;
end; $$;
revoke all on function public.reserve_ai_router_execution(uuid,text,text,text,integer,bigint,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.finish_ai_router_execution(uuid,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_ai_router_execution(uuid,text,text,text,integer,bigint,jsonb,jsonb) to service_role;
grant execute on function public.finish_ai_router_execution(uuid,text,text,integer,jsonb) to service_role;
commit;
