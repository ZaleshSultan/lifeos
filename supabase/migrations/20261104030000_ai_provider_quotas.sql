-- Additive provider request quotas inside an existing governed execution.
-- No prompts, credentials, real project/account IDs or provider bodies are stored.
begin;
create table public.ai_provider_quota_buckets (
  provider text not null check (provider in ('gemini','openrouter')),
  quota_domain text not null check (quota_domain ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  requests_per_minute integer not null check (requests_per_minute between 1 and 100000),
  requests_per_day integer not null check (requests_per_day between 1 and 10000000),
  tokens_per_minute bigint not null check (tokens_per_minute between 1 and 1000000000),
  tokens_per_day bigint not null check (tokens_per_day between 1 and 1000000000),
  limits_day date not null,
  cooldown_until timestamptz,
  review_required boolean not null default false,
  primary key(provider,quota_domain)
);
create table public.ai_provider_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null,
  attempt smallint not null check (attempt between 1 and 3),
  provider text not null check (provider in ('gemini','openrouter')),
  quota_domain text not null check (quota_domain ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  model text not null check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$' and model not like '%://%'),
  reserved_tokens integer not null check (reserved_tokens between 1 and 1000000),
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,request_id,attempt),
  foreign key(user_id,request_id) references public.ai_execution_reservations(user_id,request_id) on delete cascade,
  foreign key(provider,quota_domain) references public.ai_provider_quota_buckets(provider,quota_domain)
);
create index ai_provider_attempt_window_idx on public.ai_provider_attempts(provider,quota_domain,created_at);
alter table public.ai_provider_attempts enable row level security;
alter table public.ai_provider_quota_buckets enable row level security;
revoke all on public.ai_provider_attempts,public.ai_provider_quota_buckets from public,anon,authenticated,service_role;
grant select,insert on public.ai_provider_attempts to service_role;
grant select,insert,update on public.ai_provider_quota_buckets to service_role;

create function public.reserve_ai_provider_attempt(
  p_user_id uuid,p_request_id text,p_feature text,p_attempt integer,p_provider text,
  p_quota_domain text,p_model text,p_tokens integer,p_limits jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp(); v_start timestamptz; v_next timestamptz;
  v_zone text; v_execution public.ai_execution_reservations; v_bucket public.ai_provider_quota_buckets;
  v_existing public.ai_provider_attempts; v_rpm integer; v_rpd integer; v_tpm bigint; v_tpd bigint;
  v_min_requests bigint; v_day_requests bigint; v_min_tokens bigint; v_day_tokens bigint;
begin
  if p_user_id is null or p_request_id is null or p_request_id !~ '^[A-Za-z0-9:_-]{1,128}$'
    or p_feature is null or p_feature not in ('chat','classification','finance','meal_photo','morning_briefing','evening_review','documentary','agata')
    or p_attempt is null or p_attempt not between 1 and 3 or p_provider is null or p_provider not in ('gemini','openrouter')
    or p_quota_domain is null or p_quota_domain !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
    or p_model is null or p_model !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$' or p_model like '%://%'
    or p_tokens is null or p_tokens not between 1 and 1000000
    or p_limits is null or jsonb_typeof(p_limits)<>'object'
    or (select count(*) from jsonb_object_keys(p_limits))<>4
    or not(p_limits ?& array['requestsPerMinute','requestsPerDay','tokensPerMinute','tokensPerDay'])
    or exists(select from jsonb_each(p_limits) e where jsonb_typeof(e.value)<>'number' or e.value::text !~ '^[0-9]+$') then
    raise exception using errcode='22023',message='invalid_ai_provider_quota';
  end if;
  begin
    v_rpm := (p_limits->>'requestsPerMinute')::integer; v_rpd := (p_limits->>'requestsPerDay')::integer;
    v_tpm := (p_limits->>'tokensPerMinute')::bigint; v_tpd := (p_limits->>'tokensPerDay')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode='22023',message='invalid_ai_provider_quota';
  end;
  if v_rpm not between 1 and 100000 or v_rpd not between 1 and 10000000 or v_tpm not between 1 and 1000000000 or v_tpd not between 1 and 1000000000 then
    raise exception using errcode='22023',message='invalid_ai_provider_quota';
  end if;
  -- Use the same existing accounting lock: no independent execution budget.
  perform pg_catalog.pg_advisory_xact_lock(7271032401);
  perform 1 from public.profiles where user_id=p_user_id and status='active' for share;
  if not found then return jsonb_build_object('outcome','profile_inactive','retryAt',null); end if;
  select * into v_execution from public.ai_execution_reservations where user_id=p_user_id and request_id=p_request_id and feature=p_feature and state='reserved' for update;
  if not found then return jsonb_build_object('outcome','execution_inactive','retryAt',null); end if;
  select * into v_existing from public.ai_provider_attempts where user_id=p_user_id and request_id=p_request_id and attempt=p_attempt;
  if found then
    if v_existing.provider<>p_provider or v_existing.quota_domain<>p_quota_domain or v_existing.model<>p_model or v_existing.reserved_tokens<>p_tokens then
      raise exception using errcode='22023',message='ai_provider_attempt_conflict';
    end if;
    return jsonb_build_object('outcome','duplicate','retryAt',null);
  end if;
  if p_attempt<>(select count(*)+1 from public.ai_provider_attempts where user_id=p_user_id and request_id=p_request_id)
    or p_tokens+(select coalesce(sum(reserved_tokens),0) from public.ai_provider_attempts where user_id=p_user_id and request_id=p_request_id)>v_execution.reserved_tokens then
    return jsonb_build_object('outcome','attempt_limit','retryAt',null);
  end if;
  v_zone := case when p_provider='gemini' then 'America/Los_Angeles' else 'UTC' end;
  v_start := ((v_now at time zone v_zone)::date)::timestamp at time zone v_zone;
  v_next := (((v_now at time zone v_zone)::date)+1)::timestamp at time zone v_zone;
  insert into public.ai_provider_quota_buckets(provider,quota_domain,requests_per_minute,requests_per_day,tokens_per_minute,tokens_per_day,limits_day)
    values(p_provider,p_quota_domain,v_rpm,v_rpd,v_tpm,v_tpd,(v_now at time zone v_zone)::date)
    on conflict(provider,quota_domain) do update set
      requests_per_minute=case when ai_provider_quota_buckets.limits_day=excluded.limits_day then least(ai_provider_quota_buckets.requests_per_minute,excluded.requests_per_minute) else excluded.requests_per_minute end,
      requests_per_day=case when ai_provider_quota_buckets.limits_day=excluded.limits_day then least(ai_provider_quota_buckets.requests_per_day,excluded.requests_per_day) else excluded.requests_per_day end,
      tokens_per_minute=case when ai_provider_quota_buckets.limits_day=excluded.limits_day then least(ai_provider_quota_buckets.tokens_per_minute,excluded.tokens_per_minute) else excluded.tokens_per_minute end,
      tokens_per_day=case when ai_provider_quota_buckets.limits_day=excluded.limits_day then least(ai_provider_quota_buckets.tokens_per_day,excluded.tokens_per_day) else excluded.tokens_per_day end,
      limits_day=excluded.limits_day;
  select * into v_bucket from public.ai_provider_quota_buckets where provider=p_provider and quota_domain=p_quota_domain for update;
  if v_bucket.review_required or v_bucket.cooldown_until>v_now then
    return jsonb_build_object('outcome','cooldown','retryAt',v_bucket.cooldown_until);
  end if;
  select count(*) filter(where created_at>v_now-interval '1 minute'),count(*) filter(where created_at>=v_start),
    coalesce(sum(reserved_tokens) filter(where created_at>v_now-interval '1 minute'),0),coalesce(sum(reserved_tokens) filter(where created_at>=v_start),0)
    into v_min_requests,v_day_requests,v_min_tokens,v_day_tokens
    from public.ai_provider_attempts where provider=p_provider and quota_domain=p_quota_domain and created_at>=least(v_start,v_now-interval '1 minute');
  if v_day_requests+1>v_bucket.requests_per_day or v_day_tokens+p_tokens>v_bucket.tokens_per_day then
    return jsonb_build_object('outcome','day_limit','retryAt',v_next);
  end if;
  if v_min_requests+1>v_bucket.requests_per_minute or v_min_tokens+p_tokens>v_bucket.tokens_per_minute then
    return jsonb_build_object('outcome','minute_limit','retryAt',v_now+interval '1 minute');
  end if;
  insert into public.ai_provider_attempts(user_id,request_id,attempt,provider,quota_domain,model,reserved_tokens)
    values(p_user_id,p_request_id,p_attempt,p_provider,p_quota_domain,p_model,p_tokens);
  return jsonb_build_object('outcome','reserved','retryAt',null);
end;
$$;

create function public.cooldown_ai_provider_quota(p_user_id uuid,p_request_id text,p_provider text,p_quota_domain text,p_retry_at timestamptz,p_review_required boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_review_required is null or (p_review_required=false and p_retry_at is null)
    or (p_retry_at is not null and (not isfinite(p_retry_at) or p_retry_at>clock_timestamp()+interval '366 days')) then
    raise exception using errcode='22023',message='invalid_ai_provider_cooldown';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(7271032401);
  perform 1 from public.profiles where user_id=p_user_id and status='active' for share;
  if not found then return false; end if;
  if not exists(select from public.ai_provider_attempts a join public.ai_execution_reservations e using(user_id,request_id)
    where a.user_id=p_user_id and a.request_id=p_request_id and a.provider=p_provider and a.quota_domain=p_quota_domain) then return false; end if;
  update public.ai_provider_quota_buckets set cooldown_until=greatest(cooldown_until,p_retry_at),review_required=review_required or p_review_required
    where provider=p_provider and quota_domain=p_quota_domain;
  return found;
end;
$$;

create function public.read_ai_provider_quota(p_user_id uuid,p_provider text,p_quota_domain text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); v_start timestamptz; v_bucket public.ai_provider_quota_buckets; v_result jsonb;
begin
  -- A caller cannot discover another owner's private quota alias through this RPC.
  if not exists(select from public.profiles where user_id=p_user_id and status='active') or not exists(select from public.ai_provider_attempts where user_id=p_user_id and provider=p_provider and quota_domain=p_quota_domain) then return null; end if;
  select * into v_bucket from public.ai_provider_quota_buckets where provider=p_provider and quota_domain=p_quota_domain;
  if not found then return null; end if;
  v_start:=((v_now at time zone case when p_provider='gemini' then 'America/Los_Angeles' else 'UTC' end)::date)::timestamp at time zone case when p_provider='gemini' then 'America/Los_Angeles' else 'UTC' end;
  select jsonb_build_object('requestsInMinute',count(*) filter(where created_at>v_now-interval '1 minute'),'requestsInDay',count(*) filter(where created_at>=v_start),
    'tokensInMinute',coalesce(sum(reserved_tokens) filter(where created_at>v_now-interval '1 minute'),0),'tokensInDay',coalesce(sum(reserved_tokens) filter(where created_at>=v_start),0),
    'requestsPerDay',v_bucket.requests_per_day,'retryAt',case when v_bucket.cooldown_until>v_now then v_bucket.cooldown_until else null end,'reviewRequired',v_bucket.review_required)
    into v_result from public.ai_provider_attempts where provider=p_provider and quota_domain=p_quota_domain and created_at>=least(v_start,v_now-interval '1 minute');
  return v_result;
end;
$$;
revoke all on function public.reserve_ai_provider_attempt(uuid,text,text,integer,text,text,text,integer,jsonb) from public,anon,authenticated;
revoke all on function public.cooldown_ai_provider_quota(uuid,text,text,text,timestamptz,boolean) from public,anon,authenticated;
revoke all on function public.read_ai_provider_quota(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_ai_provider_attempt(uuid,text,text,integer,text,text,text,integer,jsonb) to service_role;
grant execute on function public.cooldown_ai_provider_quota(uuid,text,text,text,timestamptz,boolean) to service_role;
grant execute on function public.read_ai_provider_quota(uuid,text,text) to service_role;
commit;
