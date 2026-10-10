-- Session-only AITU connections; existing password/WS configurations stay intact.
begin;
alter table public.user_lms_settings
  alter column username drop not null,
  alter column encrypted_password drop not null,
  add column auth_mode text not null default 'password',
  add column sso_cookie_encrypted text,
  add column session_expires_at timestamptz,
  add column session_version uuid not null default gen_random_uuid(),
  add column session_state text not null default 'not_configured',
  add column last_error_category text,
  add column sync_requested_at timestamptz,
  add column unsupported_features text[] not null default '{}',
  add constraint user_lms_settings_auth_mode_check check (auth_mode in ('password','session')),
  add constraint user_lms_settings_password_required check (
    auth_mode <> 'password' or (username is not null and encrypted_password is not null)
  ),
  add constraint user_lms_settings_session_platform check (auth_mode <> 'session' or platform_type = 'aitu_moodle'),
  add constraint user_lms_settings_session_encrypted check (
    sso_cookie_encrypted is null or (
      auth_mode = 'session' and sso_cookie_encrypted like 'enc:v1:%' and session_expires_at is not null
    )
  ),
  add constraint user_lms_settings_session_state_check check (
    session_state in ('not_configured','connected','session_expired','reauthentication_required','syncing','error')
  ),
  add constraint user_lms_settings_error_category_check check (
    last_error_category is null or last_error_category in (
      'encryption_unavailable','decryption_failed','session_expired','reauthentication_required',
      'connection_failed','unsupported_auth_flow','partial_sync','unsupported_page','sync_failed'
    )
  );

comment on column public.user_lms_settings.sso_cookie_encrypted is
  'AES-256-GCM enc:v1 owner-bound JSON. Microsoft ESTSAUTHPERSISTENT; never exposed to clients, logs or AI. Expires after at most 168 hours; default application retention 24 hours.';

-- Credential writes go through the Telegram-authenticated backend. Even an
-- authenticated database client must not read or inject encrypted credentials.
revoke all on public.user_lms_settings from public, anon, authenticated;
grant select (id,user_id,platform_type,username,ical_feed_url,is_active,is_token_valid,
  last_sync_attempt_at,last_sync_success_at,created_at,updated_at,auth_mode,
  session_expires_at,session_state,last_error_category,sync_requested_at,unsupported_features)
  on public.user_lms_settings to authenticated;

create or replace view public.safe_user_lms_settings
  with (security_invoker = true, security_barrier = true) as
select id,user_id,platform_type,username,ical_feed_url,is_active,is_token_valid,
  last_sync_attempt_at,last_sync_success_at,created_at,updated_at,auth_mode,
  session_expires_at,session_state,last_error_category,sync_requested_at,unsupported_features
from public.user_lms_settings where (select auth.uid()) = user_id;
revoke all on public.safe_user_lms_settings from public,anon;
grant select on public.safe_user_lms_settings to authenticated;

-- Both workers and credential rotation must hold this per-user lease. Service
-- role only; explicit EXECUTE revocation closes the default PUBLIC grant.
create table public.lms_sync_leases (
  user_id uuid not null references auth.users(id) on delete cascade,
  platform_type text not null check (platform_type in ('aitu_moodle','platonus')),
  owner uuid not null,
  expires_at timestamptz not null,
  primary key (user_id,platform_type)
);
alter table public.lms_sync_leases enable row level security;
alter table public.lms_sync_leases force row level security;
revoke all on public.lms_sync_leases from public,anon,authenticated;
grant all on public.lms_sync_leases to service_role;
create policy lms_sync_leases_service_role on public.lms_sync_leases
  for all to service_role using (true) with check (true);

create function public.claim_lms_sync_lease(
  p_user_id uuid, p_platform_type text, p_owner uuid, p_ttl_seconds integer default 900
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed boolean;
begin
  if p_ttl_seconds < 15 or p_ttl_seconds > 900 then
    raise exception 'Invalid lease duration';
  end if;
  insert into public.lms_sync_leases (user_id,platform_type,owner,expires_at)
  values (p_user_id,p_platform_type,p_owner,clock_timestamp() + make_interval(secs => p_ttl_seconds))
  on conflict (user_id,platform_type) do update
    set owner = excluded.owner, expires_at = excluded.expires_at
    where public.lms_sync_leases.expires_at <= clock_timestamp()
       or (public.lms_sync_leases.owner = p_owner and public.lms_sync_leases.expires_at > clock_timestamp())
  returning true into claimed;
  return coalesce(claimed,false);
end;
$$;
create function public.release_lms_sync_lease(p_user_id uuid,p_platform_type text,p_owner uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare released boolean;
begin
  delete from public.lms_sync_leases
    where user_id = p_user_id and platform_type = p_platform_type and owner = p_owner
    returning true into released;
  return coalesce(released,false);
end;
$$;
revoke all on function public.claim_lms_sync_lease(uuid,text,uuid,integer) from public,anon,authenticated;
revoke all on function public.release_lms_sync_lease(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_lms_sync_lease(uuid,text,uuid,integer) to service_role;
grant execute on function public.release_lms_sync_lease(uuid,text,uuid) to service_role;

-- Mutations check and lock the lease in the same database transaction as the
-- write. A delayed HTTP request cannot rotate credentials after its lease ends.
create function public.save_lms_session(p_user_id uuid,p_owner uuid,p_encrypted_cookie text,p_expires_at timestamptz)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.lms_sync_leases where user_id=p_user_id
    and platform_type='aitu_moodle' and owner=p_owner and expires_at>clock_timestamp() for update;
  if not found then return false; end if;
  if p_encrypted_cookie is null or p_encrypted_cookie !~ '^enc:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
    or length(p_encrypted_cookie)>50000 or p_expires_at is null
    or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '168 hours' then
    raise exception 'Invalid encrypted session';
  end if;
  insert into public.user_lms_settings (user_id,platform_type,auth_mode,sso_cookie_encrypted,session_expires_at,
    session_version,session_state,last_error_category,is_active,is_token_valid,sync_requested_at)
  values (p_user_id,'aitu_moodle','session',p_encrypted_cookie,p_expires_at,gen_random_uuid(),'connected',null,true,true,null)
  on conflict (user_id,platform_type) do update set
    auth_mode=excluded.auth_mode,sso_cookie_encrypted=excluded.sso_cookie_encrypted,
    session_expires_at=excluded.session_expires_at,session_version=excluded.session_version,
    session_state=excluded.session_state,last_error_category=null,is_active=true,is_token_valid=true,sync_requested_at=null;
  return true;
end;
$$;
create function public.delete_lms_session(p_user_id uuid,p_owner uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.lms_sync_leases where user_id=p_user_id
    and platform_type='aitu_moodle' and owner=p_owner and expires_at>clock_timestamp() for update;
  if not found then return false; end if;
  update public.user_lms_settings set sso_cookie_encrypted=null,session_expires_at=null,
    session_version=gen_random_uuid(),session_state='not_configured',last_error_category=null,
    is_active=false,is_token_valid=false,sync_requested_at=null
    where user_id=p_user_id and platform_type='aitu_moodle' and auth_mode='session';
  return true;
end;
$$;
revoke all on function public.save_lms_session(uuid,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.delete_lms_session(uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_lms_session(uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.delete_lms_session(uuid,uuid) to service_role;

create index source_events_lms_task_page_idx on public.source_events (user_id,id)
  where source_key = 'university_platform' and event_type = 'task' and status = 'active';
commit;
