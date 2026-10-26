begin;
-- Device IDs are public management handles; only SHA-256 credential hashes persist.
create table public.health_ingest_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '30 days')
);
create index health_ingest_credentials_user_idx on public.health_ingest_credentials(user_id, created_at desc);
create index health_ingest_credentials_expiry_idx on public.health_ingest_credentials(expires_at);
alter table public.health_ingest_credentials enable row level security;
revoke all on public.health_ingest_credentials from public, anon, authenticated, service_role;
grant select, insert, update on public.health_ingest_credentials to service_role;

create function public.issue_health_ingest_credential(p_user_id uuid,p_token_hash text,p_expires_at timestamptz)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  -- Serialize registration with profile blocking. Reapproval never revives a device.
  perform 1 from public.profiles where user_id=p_user_id and status='active' for update;
  if not found or p_expires_at <= clock_timestamp() then return null; end if;
  insert into public.health_ingest_credentials(user_id,token_hash,expires_at)
    values(p_user_id,p_token_hash,p_expires_at) returning id into v_id;
  return v_id;
end $$;
create function public.resolve_health_ingest_credential(p_user_id uuid,p_token_hash text)
returns boolean language sql security invoker set search_path = '' as $$
  select exists(select 1 from public.health_ingest_credentials c
    join public.profiles p on p.user_id=c.user_id
    where c.user_id=p_user_id and c.token_hash=p_token_hash and c.revoked_at is null
      and c.expires_at > clock_timestamp() and p.status='active');
$$;
create function public.revoke_health_ingest_credential(p_user_id uuid,p_device_id uuid)
returns void language sql security invoker set search_path = '' as $$
  update public.health_ingest_credentials set revoked_at=coalesce(revoked_at,clock_timestamp())
    where user_id=p_user_id and id=p_device_id;
$$;
create function public.list_health_ingest_credentials(p_user_id uuid)
returns table(device_id uuid,created_at timestamptz,expires_at timestamptz,revoked_at timestamptz)
language sql security invoker set search_path = '' as $$
  select c.id,c.created_at,c.expires_at,c.revoked_at from public.health_ingest_credentials c
    where c.user_id=p_user_id order by c.created_at desc limit 100;
$$;
create function public.invalidate_inactive_health_credentials()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status <> 'active' then
    update public.health_ingest_credentials set revoked_at=clock_timestamp()
      where user_id=new.user_id and revoked_at is null;
  end if;
  return new;
end $$;
create trigger profiles_invalidate_health_credentials after update of status on public.profiles
  for each row when (old.status is distinct from new.status)
  execute function public.invalidate_inactive_health_credentials();

revoke all on function public.issue_health_ingest_credential(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.resolve_health_ingest_credential(uuid,text) from public,anon,authenticated;
revoke all on function public.revoke_health_ingest_credential(uuid,uuid) from public,anon,authenticated;
revoke all on function public.list_health_ingest_credentials(uuid) from public,anon,authenticated;
revoke all on function public.invalidate_inactive_health_credentials() from public,anon,authenticated;
grant execute on function public.issue_health_ingest_credential(uuid,text,timestamptz) to service_role;
grant execute on function public.resolve_health_ingest_credential(uuid,text) to service_role;
grant execute on function public.revoke_health_ingest_credential(uuid,uuid) to service_role;
grant execute on function public.list_health_ingest_credentials(uuid) to service_role;
grant execute on function public.invalidate_inactive_health_credentials() to service_role;
commit;
