-- Security audit fixes: OAuth state replay protection.

create table if not exists public.google_oauth_state_nonces (
  nonce text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  telegram_user_id bigint,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists google_oauth_state_nonces_user_idx
  on public.google_oauth_state_nonces (user_id, expires_at desc);

create index if not exists google_oauth_state_nonces_cleanup_idx
  on public.google_oauth_state_nonces (expires_at, consumed_at);

alter table public.google_oauth_state_nonces enable row level security;
alter table public.google_oauth_state_nonces force row level security;

grant all on public.google_oauth_state_nonces to service_role;

create or replace function public.purge_expired_google_oauth_state_nonces()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  delete from public.google_oauth_state_nonces
  where expires_at <= now()
     or consumed_at is not null;
  get diagnostics affected = row_count;
  return affected;
end;
$$;
