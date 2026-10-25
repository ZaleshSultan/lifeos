begin;

-- Stop every old mirror writer before applying. Legacy in-flight effects are
-- unknown: quarantine them rather than guessing whether a note was published.
alter table public.obsidian_sync_queue
  add column claim_token uuid,
  add column lease_expires_at timestamptz,
  add column last_error_code text;

update public.obsidian_sync_queue
set status = 'conflict', last_error_code = 'legacy_claim_unverified'
where status = 'processing';

create unique index obsidian_one_processing_vault
  on public.obsidian_sync_queue(user_id) where status = 'processing';
create index obsidian_ready_jobs on public.obsidian_sync_queue(available_at, created_at)
  where status in ('pending', 'retry');
create index obsidian_expiring_claims on public.obsidian_sync_queue(lease_expires_at)
  where status = 'processing';

-- No note bodies; stable identity/path plus durable publication intent. Pending
-- hashes survive lease loss, including a successful rename with a lost DB ACK.
create table public.obsidian_managed_notes (
  user_id uuid not null references auth.users(id),
  note_key text not null,
  relative_path text not null,
  applied_content_hash text,
  expected_content_hash text,
  pending_content_hash text,
  revision bigint not null default 0 check (revision >= 0),
  applied_revision bigint not null default 0 check (applied_revision >= 0),
  pending_job_id uuid references public.obsidian_sync_queue(id),
  pending_claim_token uuid,
  updated_at timestamptz not null default now(),
  primary key (user_id, note_key),
  unique (user_id, relative_path),
  check (applied_content_hash is null or applied_content_hash ~ '^[a-f0-9]{64}$'),
  check (expected_content_hash is null or expected_content_hash ~ '^[a-f0-9]{64}$'),
  check (pending_content_hash is null or pending_content_hash ~ '^[a-f0-9]{64}$')
);
alter table public.obsidian_managed_notes enable row level security;
alter table public.obsidian_managed_notes force row level security;
revoke all on public.obsidian_managed_notes from public, anon, authenticated;
grant all on public.obsidian_managed_notes to service_role;
-- Queue producers use the existing trusted backend/creation RPC. A browser must
-- not manufacture completion, leases or managed-note ownership through REST.
revoke insert, update, delete, truncate, references, trigger
  on public.obsidian_sync_queue from public, anon, authenticated;

create function public.obsidian_sync_user_enabled(p_user_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    join public.user_obsidian_settings s on s.user_id = p.user_id
    where p.user_id = p_user_id and p.status = 'active'
      and s.enabled and s.is_active and s.status = 'connected'
      and s.mode in ('local_vault', 'syncthing')
      and s.vault_path = '/var/lifeos/vaults/' || p_user_id::text
  );
$$;

create function public.obsidian_sync_claim_valid(p_job_id uuid, p_user_id uuid, p_claim_token uuid)
returns boolean language sql volatile security invoker set search_path = '' as $$
  select exists (select 1 from public.obsidian_sync_queue q
    where q.id = p_job_id and q.user_id = p_user_id
      and q.claim_token = p_claim_token and q.status = 'processing'
      and q.lease_expires_at > clock_timestamp())
    and public.obsidian_sync_user_enabled(p_user_id);
$$;

create function public.recover_obsidian_sync_jobs()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare recovered integer; terminal integer;
begin
  update public.obsidian_sync_queue q
  set status = case
        when not public.obsidian_sync_user_enabled(q.user_id) then 'cancelled'::public.obsidian_sync_status
        when q.claim_token is null then 'conflict'::public.obsidian_sync_status
        when q.attempts >= 5 then 'failed'::public.obsidian_sync_status
        else 'retry'::public.obsidian_sync_status end,
      available_at = clock_timestamp() + make_interval(secs => least(3600, 60 * power(2, least(q.attempts, 6))::integer)),
      last_error_code = case when q.claim_token is null then 'legacy_claim_unverified'
        when not public.obsidian_sync_user_enabled(q.user_id) then 'recipient_inactive'
        when q.attempts >= 5 then 'attempts_exhausted' else 'lease_expired' end,
      last_error = null, claim_token = null, lease_expires_at = null
  where q.status = 'processing' and (q.lease_expires_at is null or q.lease_expires_at <= clock_timestamp());
  get diagnostics recovered = row_count;
  update public.obsidian_sync_queue q
  set status = 'failed', last_error_code = case when q.attempts >= 5 then 'attempts_exhausted'
      when q.operation not in ('upsert_note', 'upsert') or q.action <> 'upsert' then 'unsupported_operation'
      else 'entity_unavailable' end,
      last_error = null, claim_token = null, lease_expires_at = null
  where q.status in ('pending', 'retry') and (q.attempts >= 5
    or q.operation not in ('upsert_note', 'upsert') or q.action <> 'upsert'
    or not exists (select 1 from public.life_entities e where e.id = q.life_entity_id and e.user_id = q.user_id));
  get diagnostics terminal = row_count;
  return jsonb_build_object('recovered', recovered, 'terminal', terminal);
end;
$$;

create function public.claim_obsidian_sync_jobs(p_limit integer default 1)
returns setof public.obsidian_sync_queue language plpgsql security invoker set search_path = '' as $$
declare v_user uuid; v_job public.obsidian_sync_queue; i integer;
begin
  -- Lock a durable per-vault row, then exactly one job for it. SKIP LOCKED
  -- permits independent vaults to progress; the partial index is a backstop.
  for i in 1..greatest(0, least(coalesce(p_limit, 1), 100)) loop
    select s.user_id into v_user from public.user_obsidian_settings s
    where public.obsidian_sync_user_enabled(s.user_id)
      and not exists (select 1 from public.obsidian_sync_queue q where q.user_id = s.user_id and q.status = 'processing')
      and exists (select 1 from public.obsidian_sync_queue q
        join public.life_entities e on e.id = q.life_entity_id and e.user_id = q.user_id
        where q.user_id = s.user_id and q.status in ('pending', 'retry')
          and q.available_at <= clock_timestamp() and q.attempts < 5
          and q.operation in ('upsert_note', 'upsert') and q.action = 'upsert')
    order by s.user_id for update of s skip locked limit 1;
    exit when not found;
    -- Recheck with a fresh command snapshot after acquiring the vault lock.
    -- A competing claimant may have committed after the candidate scan.
    if exists (select 1 from public.obsidian_sync_queue q
      where q.user_id = v_user and q.status = 'processing') then
      continue;
    end if;
    select q.* into v_job from public.obsidian_sync_queue q
      join public.life_entities e on e.id = q.life_entity_id and e.user_id = q.user_id
      where q.user_id = v_user and q.status in ('pending', 'retry')
        and q.available_at <= clock_timestamp() and q.attempts < 5
        and q.operation in ('upsert_note', 'upsert') and q.action = 'upsert'
      order by q.created_at, q.id for update of q skip locked limit 1;
    if found then
      update public.obsidian_sync_queue q set status = 'processing', attempts = q.attempts + 1,
        claim_token = gen_random_uuid(), locked_at = clock_timestamp(),
        lease_expires_at = clock_timestamp() + interval '5 minutes', last_error = null, last_error_code = null
      where q.id = v_job.id returning q.* into v_job;
      return next v_job;
    end if;
  end loop;
end;
$$;

create function public.renew_obsidian_sync_claim(p_job_id uuid, p_user_id uuid, p_claim_token uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.obsidian_sync_queue q set lease_expires_at = clock_timestamp() + interval '5 minutes'
  where q.id = p_job_id and q.user_id = p_user_id and q.claim_token = p_claim_token
    and q.status = 'processing' and q.lease_expires_at > clock_timestamp()
    and public.obsidian_sync_user_enabled(p_user_id);
  return found;
end;
$$;

create function public.get_obsidian_note_state(p_job_id uuid, p_user_id uuid, p_claim_token uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if not public.obsidian_sync_claim_valid(p_job_id, p_user_id, p_claim_token) then
    raise exception 'obsidian_claim_lost' using errcode = '40001';
  end if;
  select to_jsonb(n) into result from public.obsidian_managed_notes n
    join public.obsidian_sync_queue q on q.user_id = n.user_id and q.life_entity_id::text = n.note_key
    where q.id = p_job_id and q.user_id = p_user_id;
  return result;
end;
$$;

create function public.prepare_obsidian_sync_job(p_job_id uuid, p_user_id uuid, p_claim_token uuid,
  p_relative_path text, p_content_hash text, p_observed_hash text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare q public.obsidian_sync_queue; n public.obsidian_managed_notes; has_note boolean;
begin
  select * into q from public.obsidian_sync_queue where id = p_job_id and user_id = p_user_id for update;
  if not found or q.claim_token is distinct from p_claim_token or q.status <> 'processing'
    or q.lease_expires_at is null or q.lease_expires_at <= clock_timestamp()
    or not public.obsidian_sync_user_enabled(p_user_id) then
    raise exception 'obsidian_claim_lost' using errcode = '40001';
  end if;
  if q.operation not in ('upsert_note', 'upsert') or q.action <> 'upsert'
    or not exists (select 1 from public.life_entities e where e.id = q.life_entity_id and e.user_id = p_user_id) then
    raise exception 'obsidian_entity_unavailable' using errcode = '22023';
  end if;
  if p_content_hash is null or p_content_hash !~ '^[a-f0-9]{64}$'
    or (p_observed_hash is not null and p_observed_hash !~ '^[a-f0-9]{64}$') then
    raise exception 'obsidian_invalid_hash' using errcode = '22023';
  end if;
  if p_relative_path is null or length(p_relative_path) > 1024 or p_relative_path = ''
    or p_relative_path ~ '(^/|\\|(^|/)\.{1,2}(/|$)|//|/$|[[:cntrl:]])'
    or p_relative_path ~ '(^|/)\.lifeos-' or p_relative_path !~ '\.md$' then
    return jsonb_build_object('conflict', true, 'error_code', 'unsafe_path');
  end if;
  select * into n from public.obsidian_managed_notes where user_id = p_user_id and note_key = q.life_entity_id::text for update;
  has_note := found;
  if has_note and n.relative_path <> p_relative_path then
    return jsonb_build_object('conflict', true, 'error_code', 'path_collision');
  end if;
  if not has_note then
    if exists (select 1 from public.obsidian_managed_notes where user_id = p_user_id and relative_path = p_relative_path) then
      return jsonb_build_object('conflict', true, 'error_code', 'path_collision');
    end if;
    if p_observed_hash is not null and p_observed_hash <> p_content_hash then
      return jsonb_build_object('conflict', true, 'error_code', 'external_modification');
    end if;
    insert into public.obsidian_managed_notes(user_id, note_key, relative_path)
      values(p_user_id, q.life_entity_id::text, p_relative_path) returning * into n;
  elsif (p_observed_hash is null and (n.applied_content_hash is not null or n.expected_content_hash is not null))
    or (p_observed_hash is not null and p_observed_hash is distinct from n.applied_content_hash
      and p_observed_hash is distinct from n.expected_content_hash and p_observed_hash is distinct from n.pending_content_hash) then
    return jsonb_build_object('conflict', true, 'error_code', 'external_modification');
  end if;
  update public.obsidian_managed_notes set expected_content_hash = p_observed_hash,
    pending_content_hash = p_content_hash, pending_job_id = p_job_id, pending_claim_token = p_claim_token,
    revision = revision + 1, updated_at = clock_timestamp()
    where user_id = p_user_id and note_key = q.life_entity_id::text returning * into n;
  return to_jsonb(n) || jsonb_build_object('conflict', false);
end;
$$;

create function public.complete_obsidian_sync_job(p_job_id uuid, p_user_id uuid, p_claim_token uuid,
  p_content_hash text, p_revision bigint)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare q public.obsidian_sync_queue;
begin
  select * into q from public.obsidian_sync_queue where id = p_job_id and user_id = p_user_id for update;
  if not found or q.claim_token is distinct from p_claim_token or q.status <> 'processing'
    or q.lease_expires_at is null or q.lease_expires_at <= clock_timestamp()
    or not public.obsidian_sync_user_enabled(p_user_id) then return false; end if;
  update public.obsidian_managed_notes set applied_content_hash = p_content_hash, applied_revision = p_revision,
    expected_content_hash = null, pending_content_hash = null, pending_job_id = null, pending_claim_token = null,
    updated_at = clock_timestamp()
  where user_id = p_user_id and note_key = q.life_entity_id::text
    and pending_job_id = p_job_id and pending_claim_token = p_claim_token
    and revision = p_revision and pending_content_hash = p_content_hash;
  if not found then return false; end if;
  update public.obsidian_sync_queue set status = 'completed', completed_at = clock_timestamp(),
    claim_token = null, lease_expires_at = null, last_error_code = null, last_error = null
  where id = p_job_id;
  return true;
end;
$$;

create function public.finish_obsidian_sync_job(p_job_id uuid, p_user_id uuid, p_claim_token uuid,
  p_error_code text, p_retryable boolean, p_conflict boolean default false)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_error_code is null or p_error_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'obsidian_invalid_error_code' using errcode = '22023';
  end if;
  update public.obsidian_sync_queue q set status = case when p_conflict then 'conflict'::public.obsidian_sync_status
      when p_retryable and q.attempts < 5 then 'retry'::public.obsidian_sync_status else 'failed'::public.obsidian_sync_status end,
    available_at = clock_timestamp() + make_interval(secs => least(3600, 60 * power(2, least(q.attempts - 1, 6))::integer)),
    last_error_code = p_error_code, last_error = null, claim_token = null, lease_expires_at = null
  where q.id = p_job_id and q.user_id = p_user_id and q.claim_token = p_claim_token
    and q.status = 'processing' and q.lease_expires_at > clock_timestamp();
  return found;
end;
$$;

create function public.obsidian_sync_status()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'counts', coalesce((select jsonb_object_agg(status, total) from
      (select status, count(*) total from public.obsidian_sync_queue group by status) c), '{}'::jsonb),
    'stale_claims', (select count(*) from public.obsidian_sync_queue where status = 'processing'
      and (lease_expires_at is null or lease_expires_at <= clock_timestamp())),
    'backlog', (select count(*) from public.obsidian_sync_queue where status in ('pending', 'retry')),
    'retry_attempts', (select coalesce(sum(greatest(attempts - 1, 0)), 0) from public.obsidian_sync_queue),
    'oldest_ready_age_seconds', (select greatest(0, extract(epoch from clock_timestamp() - min(created_at)))
      from public.obsidian_sync_queue where status in ('pending', 'retry')),
    'last_completed_duration_seconds', (select extract(epoch from completed_at - locked_at)
      from public.obsidian_sync_queue where status = 'completed' order by completed_at desc limit 1)
  );
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'obsidian_sync_user_enabled', 'obsidian_sync_claim_valid', 'recover_obsidian_sync_jobs',
      'claim_obsidian_sync_jobs', 'renew_obsidian_sync_claim', 'get_obsidian_note_state',
      'prepare_obsidian_sync_job', 'complete_obsidian_sync_job', 'finish_obsidian_sync_job', 'obsidian_sync_status')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end;
$$;

commit;
