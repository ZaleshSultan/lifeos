create table if not exists public.user_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_account_email text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scopes text[] not null default '{}'::text[],
  status text not null default 'connected',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_oauth_connections_provider_check
    check (provider in ('google')),
  constraint user_oauth_connections_status_check
    check (status in ('connected', 'expired', 'revoked', 'error')),
  constraint user_oauth_connections_user_provider_unique
    unique (user_id, provider)
);

create index if not exists user_oauth_connections_provider_status_idx
  on public.user_oauth_connections (provider, status);

create index if not exists user_oauth_connections_user_provider_idx
  on public.user_oauth_connections (user_id, provider);

alter table public.user_oauth_connections enable row level security;
alter table public.user_oauth_connections force row level security;

drop trigger if exists set_user_oauth_connections_updated_at
  on public.user_oauth_connections;
create trigger set_user_oauth_connections_updated_at
before update on public.user_oauth_connections
for each row execute function public.set_updated_at();

revoke all on public.user_oauth_connections from anon, authenticated;
grant all on public.user_oauth_connections to service_role;

create or replace view public.safe_user_oauth_connections
with (security_barrier = true) as
select
  id,
  user_id,
  provider,
  provider_account_email,
  expires_at,
  scopes,
  status,
  metadata,
  created_at,
  updated_at
from public.user_oauth_connections
where public.lifeos_is_owner(user_id);

grant select on public.safe_user_oauth_connections to authenticated;
revoke all on public.safe_user_oauth_connections from anon;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_oauth_connections'
      and policyname = 'user_oauth_connections_service_role_access'
  ) then
    create policy user_oauth_connections_service_role_access
      on public.user_oauth_connections
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end;
$$;

comment on table public.user_oauth_connections is
  'Per-user OAuth tokens for trusted backend/workers only. Browser/TMA callers must use safe metadata routes or the safe_user_oauth_connections view.';

comment on view public.safe_user_oauth_connections is
  'Token-free per-user OAuth metadata view. Filters rows with lifeos_is_owner(user_id) and intentionally omits access_token and refresh_token.';
