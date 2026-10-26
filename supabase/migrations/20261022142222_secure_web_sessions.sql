-- Web credentials are owned by the bot auth boundary. Browser roles get no access.
begin;

create table public.web_login_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '120 seconds')
);
create index web_login_tokens_user_idx on public.web_login_tokens(user_id);
create index web_login_tokens_expiry_idx on public.web_login_tokens(expires_at);

create table public.web_sessions (
  session_hash text primary key check (session_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '30 days')
);
create index web_sessions_user_idx on public.web_sessions(user_id);
create index web_sessions_expiry_idx on public.web_sessions(expires_at);

alter table public.web_login_tokens enable row level security;
alter table public.web_sessions enable row level security;
revoke all on public.web_login_tokens, public.web_sessions from public, anon, authenticated, service_role;
grant select, insert, update on public.web_login_tokens, public.web_sessions to service_role;

create function public.issue_web_login_token(p_user_id uuid, p_token_hash text, p_expires_at timestamptz)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  -- Serialize issuance/exchange with profile blocking, including direct admin updates.
  perform 1 from public.profiles where user_id = p_user_id and status = 'active' for update;
  if not found or p_expires_at <= clock_timestamp() then return false; end if;
  insert into public.web_login_tokens(token_hash, user_id, expires_at)
    values (p_token_hash, p_user_id, p_expires_at);
  return true;
end;
$$;

create function public.exchange_web_login_token(p_user_id uuid, p_token_hash text, p_session_hash text)
returns timestamptz language plpgsql security invoker set search_path = '' as $$
declare
  v_created_at timestamptz;
  v_expires_at timestamptz;
begin
  perform 1 from public.profiles where user_id = p_user_id and status = 'active' for update;
  if not found then return null; end if;

  -- The conditional update and session insert are one transaction: one winner,
  -- and an insert failure cannot burn the token without creating its session.
  update public.web_login_tokens set consumed_at = clock_timestamp()
    where token_hash = p_token_hash and user_id = p_user_id
      and consumed_at is null and expires_at > clock_timestamp();
  if not found then return null; end if;

  v_created_at := clock_timestamp();
  v_expires_at := v_created_at + interval '30 days';
  insert into public.web_sessions(session_hash, user_id, created_at, expires_at)
    values (p_session_hash, p_user_id, v_created_at, v_expires_at);
  return v_expires_at;
end;
$$;

-- Credential-to-identity lookup only. Resource access remains user_id scoped.
create function public.resolve_web_session(p_session_hash text)
returns uuid language sql security invoker set search_path = '' as $$
  select s.user_id from public.web_sessions s
    join public.profiles p on p.user_id = s.user_id
    where s.session_hash = p_session_hash and s.revoked_at is null
      and s.expires_at > clock_timestamp() and p.status = 'active';
$$;

create function public.revoke_web_session(p_user_id uuid, p_session_hash text)
returns void language sql security invoker set search_path = '' as $$
  update public.web_sessions set revoked_at = coalesce(revoked_at, clock_timestamp())
    where user_id = p_user_id and session_hash = p_session_hash;
$$;

create function public.invalidate_inactive_web_sessions()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status <> 'active' then
    update public.web_sessions set revoked_at = clock_timestamp()
      where user_id = new.user_id and revoked_at is null;
    update public.web_login_tokens set consumed_at = clock_timestamp()
      where user_id = new.user_id and consumed_at is null;
  end if;
  return new;
end;
$$;
create trigger profiles_invalidate_web_sessions after update of status on public.profiles
  for each row when (old.status is distinct from new.status)
  execute function public.invalidate_inactive_web_sessions();

revoke all on function public.issue_web_login_token(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.exchange_web_login_token(uuid, text, text) from public, anon, authenticated;
revoke all on function public.resolve_web_session(text) from public, anon, authenticated;
revoke all on function public.revoke_web_session(uuid, text) from public, anon, authenticated;
revoke all on function public.invalidate_inactive_web_sessions() from public, anon, authenticated;
grant execute on function public.issue_web_login_token(uuid, text, timestamptz) to service_role;
grant execute on function public.exchange_web_login_token(uuid, text, text) to service_role;
grant execute on function public.resolve_web_session(text) to service_role;
grant execute on function public.revoke_web_session(uuid, text) to service_role;
grant execute on function public.invalidate_inactive_web_sessions() to service_role;

commit;
