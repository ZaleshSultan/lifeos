-- Assistant-owned state only. Existing academic/calendar records remain authoritative.
create table public.assistant_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_key text not null check (memory_key ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  category text not null check (category in ('preference','goal','constraint','learning','fact')),
  content text not null check (length(btrim(content)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (user_id, memory_key)
);
create index assistant_memories_user_active_updated_idx
  on public.assistant_memories(user_id, updated_at desc) where archived_at is null;
create trigger assistant_memories_updated before update on public.assistant_memories
  for each row execute function public.set_updated_at();

-- This table is both the minimal audit and the durable mutation receipt. It never
-- contains prompts, conversations, memory text, reminder messages or argument JSON.
create table public.assistant_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null check (request_id ~ '^[A-Za-z0-9:_-]{1,120}$'),
  tool text not null check (tool ~ '^[a-z][a-z0-9_.]{0,79}$'),
  source text not null check (source in ('telegram','tma')),
  permission text not null check (permission in ('READ','WRITE','DESTRUCTIVE')),
  status text not null check (status in ('succeeded','not_found','rejected','failed')),
  resource_id uuid,
  duration_ms integer check (duration_ms between 0 and 3600000),
  error_code text check (error_code in ('invalid_input','unauthorized','unavailable','confirmation_required','storage_error','handler_error')),
  created_at timestamptz not null default now(),
  unique(user_id, request_id)
);
create index assistant_actions_user_created_idx
  on public.assistant_actions(user_id, created_at desc);

alter table public.assistant_memories enable row level security;
alter table public.assistant_memories force row level security;
alter table public.assistant_actions enable row level security;
alter table public.assistant_actions force row level security;
revoke all on public.assistant_memories, public.assistant_actions from public, anon, authenticated;
grant all on public.assistant_memories, public.assistant_actions to service_role;
-- Defense in depth if an operator later grants authenticated SELECT. Client writes
-- have no policy: explicit consent must continue to cross the backend registry.
create policy assistant_memories_owner_read on public.assistant_memories
  for select to authenticated using ((select auth.uid()) = user_id);

-- SECURITY INVOKER deliberately retains caller privileges. Only service_role can
-- execute this RPC; it must receive user identity from the authenticated API boundary.
create function public.assistant_execute_mutation(
  p_user_id uuid, p_request_id text, p_source text, p_action jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  action_type text := p_action->>'type';
  allowed_keys text[];
  target_id uuid;
  receipt public.assistant_actions%rowtype;
  result_status text := 'succeeded';
  reminder_time timestamptz;
begin
  if p_user_id is null or p_request_id is null
    or p_request_id !~ '^[A-Za-z0-9:_-]{1,120}$'
    or p_source is null or p_source not in ('telegram','tma')
    or jsonb_typeof(p_action) is distinct from 'object'
    or action_type is null then
    raise exception 'assistant_invalid_input' using errcode = '22023';
  end if;
  allowed_keys := case action_type
    when 'memory.remember' then array['type','memoryKey','category','content']
    when 'memory.update' then array['type','memoryKey','category','content']
    when 'memory.archive' then array['type','memoryKey']
    when 'memory.delete' then array['type','memoryKey']
    when 'reminder.create' then array['type','message','remindAt']
    else null end;
  if allowed_keys is null or exists (
    select 1 from jsonb_object_keys(p_action) as k where not k = any(allowed_keys)
  ) then raise exception 'assistant_invalid_input' using errcode = '22023'; end if;

  -- Serialize only the same user's same request. One transaction owns both the
  -- domain write and receipt, so failure/rollback cannot leave a stale claim.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':' || p_request_id, 0));
  select * into receipt from public.assistant_actions
    where user_id = p_user_id and request_id = p_request_id;
  if found then
    if receipt.tool <> action_type or receipt.permission = 'READ' then
      raise exception 'assistant_idempotency_conflict' using errcode = '22023';
    end if;
    return jsonb_build_object('actionId',receipt.id,'resourceId',receipt.resource_id,
      'status',receipt.status,'replayed',true);
  end if;

  if action_type like 'memory.%' then
    if jsonb_typeof(p_action->'memoryKey') is distinct from 'string'
      or p_action->>'memoryKey' !~ '^[a-z0-9][a-z0-9_.-]{0,79}$' then
      raise exception 'assistant_invalid_input' using errcode = '22023';
    end if;
    if action_type in ('memory.remember','memory.update') then
      if jsonb_typeof(p_action->'content') is distinct from 'string'
        or length(btrim(p_action->>'content')) not between 1 and 1000
        or (action_type = 'memory.remember' and not p_action ? 'category')
        or (p_action ? 'category' and (jsonb_typeof(p_action->'category') is distinct from 'string'
          or p_action->>'category' not in ('preference','goal','constraint','learning','fact'))) then
        raise exception 'assistant_invalid_input' using errcode = '22023';
      end if;
      -- A final credential guard at the persistence boundary. No credentials are
      -- sent to a provider or retained as memory, even through direct RPC calls.
      if p_action->>'content' ~* '\m(password|passwd|passphrase|pin|otp|2fa|mfa|seed[_ -]?phrase|recovery[_ -]?(code|phrase)|authentication[_ -]?code|cookies?|bearer|authorization|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|private[_ -]?key|service[_ -]?role|session[_ -]?(id|key|token)|secret|token)\M|парол|пин[ -]?код|код[[:space:]]+(подтверждения|аутентификации|восстановления)|сид[ -]?фраз|куки|токен|секретн[^[:space:]]*[[:space:]]+ключ|-----BEGIN [A-Z ]*PRIVATE KEY-----|\msk-[a-z0-9_-]{12,}|eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+|https?://[^[:space:]/]+:[^[:space:]]+@|\m[0-9]{6,}:[a-z0-9_-]{20,}|\m(AIza[a-z0-9_-]{20,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|sb_secret_[a-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\M' then
        raise exception 'assistant_invalid_input' using errcode = '22023';
      end if;
    end if;
    case action_type
      when 'memory.remember' then
        insert into public.assistant_memories(user_id,memory_key,category,content)
          values(p_user_id,p_action->>'memoryKey',p_action->>'category',btrim(p_action->>'content'))
          on conflict(user_id,memory_key) do update set category = excluded.category,
            content = excluded.content, archived_at = null
          returning id into target_id;
      when 'memory.update' then
        update public.assistant_memories set content = btrim(p_action->>'content'),
          category = coalesce(p_action->>'category',category)
          where user_id = p_user_id and memory_key = p_action->>'memoryKey'
          returning id into target_id;
      when 'memory.archive' then
        update public.assistant_memories set archived_at = coalesce(archived_at,now())
          where user_id = p_user_id and memory_key = p_action->>'memoryKey'
          returning id into target_id;
      when 'memory.delete' then
        delete from public.assistant_memories
          where user_id = p_user_id and memory_key = p_action->>'memoryKey'
          returning id into target_id;
    end case;
    if target_id is null then result_status := 'not_found'; end if;
  else
    if jsonb_typeof(p_action->'message') is distinct from 'string'
      or length(btrim(p_action->>'message')) not between 1 and 1000
      or jsonb_typeof(p_action->'remindAt') is distinct from 'string'
      or p_action->>'remindAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$' then
      raise exception 'assistant_invalid_input' using errcode = '22023';
    end if;
    reminder_time := (p_action->>'remindAt')::timestamptz;
    if reminder_time <= now() or reminder_time > now() + interval '366 days' then
      raise exception 'assistant_invalid_input' using errcode = '22023';
    end if;
    insert into public.reminders(user_id,channel,remind_at,message,metadata_json)
      values(p_user_id,'telegram',reminder_time,btrim(p_action->>'message'),'{"origin":"assistant"}'::jsonb)
      returning id into target_id;
  end if;
  insert into public.assistant_actions(user_id,request_id,tool,source,permission,status,resource_id)
    values(p_user_id,p_request_id,action_type,p_source,
      case when action_type = 'memory.delete' then 'DESTRUCTIVE' else 'WRITE' end,
      result_status,target_id) returning * into receipt;
  return jsonb_build_object('actionId',receipt.id,'resourceId',target_id,
    'status',result_status,'replayed',false);
end;
$$;
revoke all on function public.assistant_execute_mutation(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.assistant_execute_mutation(uuid,text,text,jsonb) to service_role;
