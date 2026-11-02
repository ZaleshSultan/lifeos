-- Durable conservative reservations. Retained on failures/timeouts because billing is unknown.
begin;
create table public.ai_execution_reservations (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null check (request_id ~ '^[A-Za-z0-9:_-]{1,128}$'),
  task_id text not null check (task_id ~ '^[A-Za-z0-9:_-]{1,128}$'),
  feature text not null check (feature in ('chat','classification','finance','meal_photo','morning_briefing','evening_review','documentary','agata')),
  day date not null default ((clock_timestamp() at time zone 'UTC')::date),
  reserved_tokens integer not null check (reserved_tokens between 1 and 1000000),
  estimated_cost_micros bigint check (estimated_cost_micros between 0 and 1000000000000),
  reported_tokens integer check (reported_tokens between 0 and 10000000),
  state text not null default 'reserved' check (state in ('reserved','completed','failed','cancelled','timed_out')),
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  primary key (user_id,request_id)
);
create index ai_execution_day_idx on public.ai_execution_reservations(day,user_id,feature);
create index ai_execution_task_idx on public.ai_execution_reservations(user_id,task_id);
alter table public.ai_execution_reservations enable row level security;
revoke all on public.ai_execution_reservations from public,anon,authenticated,service_role;
grant select,insert,update on public.ai_execution_reservations to service_role;

create function public.reserve_ai_execution(p_user_id uuid,p_feature text,p_request_id text,p_task_id text,p_tokens integer,p_estimated_cost_micros bigint,p_limits jsonb)
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
    or (v_user_cost_cap is not null and v_user_cost_cap not between 1 and 1000000000000)
    or (v_feature_cost_cap is not null and v_feature_cost_cap not between 1 and 1000000000000)
    or (v_global_cost_cap is not null and v_global_cost_cap not between 1 and 1000000000000) then
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
    coalesce(sum(estimated_cost_micros) filter(where user_id=p_user_id),0),
    coalesce(sum(estimated_cost_micros) filter(where user_id=p_user_id and feature=p_feature),0),
    coalesce(sum(estimated_cost_micros),0),
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

create function public.finish_ai_execution(p_user_id uuid,p_request_id text,p_state text,p_reported_tokens integer)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_state is null or p_state not in ('completed','failed','cancelled','timed_out')
    or (p_reported_tokens is not null and (p_reported_tokens<0 or p_reported_tokens>10000000)) then
    raise exception using errcode='22023',message='invalid_ai_budget_receipt';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(7271032401);
  update public.ai_execution_reservations set state=p_state,reported_tokens=p_reported_tokens,finished_at=clock_timestamp()
    where user_id=p_user_id and request_id=p_request_id and state='reserved';
  return found or exists(select from public.ai_execution_reservations where user_id=p_user_id and request_id=p_request_id and state=p_state);
end;
$$;
revoke all on function public.reserve_ai_execution(uuid,text,text,text,integer,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.finish_ai_execution(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.reserve_ai_execution(uuid,text,text,text,integer,bigint,jsonb) to service_role;
grant execute on function public.finish_ai_execution(uuid,text,text,integer) to service_role;
commit;
