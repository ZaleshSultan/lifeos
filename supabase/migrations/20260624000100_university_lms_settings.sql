-- ============================================================================
-- LifeOS University LMS Settings
-- Migration: 20260624000100_university_lms_settings.sql
-- ============================================================================
-- Stores per-user credentials for university learning management systems
-- (AITU Moodle + Platonus). Sensitive fields (password, ws_token) are stored
-- as enc:v1 AES-256-GCM ciphertext produced by the application layer, mirroring
-- the convention established for user_oauth_connections in
-- 20260619000300_require_encrypted_oauth_tokens.sql.
--
-- The service-role worker (lms_grades_worker.py) is the only reader of the
-- plaintext via the application-side decrypt helper.  Authenticated (browser/TMA)
-- clients receive only the token-free safe_user_lms_settings view.
-- ============================================================================

-- ── 1. Table ─────────────────────────────────────────────────────────────────
create table if not exists public.user_lms_settings (
  id                     uuid        primary key default gen_random_uuid(),
  user_id                uuid        not null references auth.users(id) on delete cascade,

  -- Platform discriminator
  platform_type          text        not null,

  -- Credentials (application-side AES-256-GCM; format enc:v1:<base64>)
  username               text        not null,
  encrypted_password     text        not null,
  ws_token_encrypted     text,            -- Moodle Web Services token (optional)

  -- Optional iCal deadline feed
  ical_feed_url          text,

  -- State flags
  is_active              boolean     not null default true,
  is_token_valid         boolean     not null default true,

  -- Sync audit timestamps (written by the worker, not the user)
  last_sync_attempt_at   timestamptz,
  last_sync_success_at   timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint user_lms_settings_platform_type_check
    check (platform_type in ('aitu_moodle', 'platonus')),

  constraint user_lms_settings_username_not_blank
    check (length(btrim(username)) > 0),

  -- Enforce enc:v1 ciphertext prefix so plaintext is never accidentally stored
  constraint user_lms_settings_password_encrypted
    check (encrypted_password like 'enc:v1:%'),

  constraint user_lms_settings_ws_token_encrypted
    check (ws_token_encrypted is null or ws_token_encrypted like 'enc:v1:%'),

  constraint user_lms_settings_user_platform_unique
    unique (user_id, platform_type)
);

comment on table public.user_lms_settings is
  'Per-user credentials for university LMS integrations (AITU Moodle, Platonus). '
  'Passwords and WS tokens are encrypted application-side as enc:v1 AES-256-GCM. '
  'The service-role worker is the sole reader of ciphertext. '
  'Browser/TMA callers must use safe_user_lms_settings view.';

comment on column public.user_lms_settings.encrypted_password is
  'Encrypted application-side as enc:v1 AES-256-GCM. Never store plaintext.';

comment on column public.user_lms_settings.ws_token_encrypted is
  'Moodle Web Services token encrypted as enc:v1 AES-256-GCM. '
  'Preferred over form login when available.';

comment on column public.user_lms_settings.ical_feed_url is
  'Optional Moodle/university iCal feed URL for deadline ingestion.';


-- ── 2. Indexes ───────────────────────────────────────────────────────────────
create index if not exists user_lms_settings_user_id_idx
  on public.user_lms_settings (user_id);

create index if not exists user_lms_settings_platform_active_idx
  on public.user_lms_settings (platform_type, is_active)
  where is_active = true;


-- ── 3. updated_at trigger ────────────────────────────────────────────────────
-- Reuse the canonical set_updated_at() function from 20260518020100_lifeos_kernel.sql
drop trigger if exists set_user_lms_settings_updated_at on public.user_lms_settings;

create trigger set_user_lms_settings_updated_at
  before update on public.user_lms_settings
  for each row execute function public.set_updated_at();


-- ── 4. RLS ───────────────────────────────────────────────────────────────────
alter table public.user_lms_settings enable row level security;
alter table public.user_lms_settings force row level security;

-- Service role worker has unrestricted access (reads encrypted creds for sync)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'user_lms_settings'
      and policyname = 'user_lms_settings_service_role_access'
  ) then
    create policy user_lms_settings_service_role_access
      on public.user_lms_settings
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end;
$$;

-- Authenticated users may only touch their own rows (credential storage from TMA/web)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'user_lms_settings'
      and policyname = 'user_lms_settings_owner_access'
  ) then
    create policy user_lms_settings_owner_access
      on public.user_lms_settings
      for all
      to authenticated
      using  (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

-- anon role has no access
revoke all on public.user_lms_settings from anon;
grant all  on public.user_lms_settings to service_role;


-- ── 5. Safe metadata view (no ciphertext) ────────────────────────────────────
-- Mirrors the pattern from safe_user_oauth_connections.
-- Intentionally omits encrypted_password and ws_token_encrypted.
create or replace view public.safe_user_lms_settings
  with (security_barrier = true)
as
select
  id,
  user_id,
  platform_type,
  username,
  ical_feed_url,
  is_active,
  is_token_valid,
  last_sync_attempt_at,
  last_sync_success_at,
  created_at,
  updated_at
from public.user_lms_settings
where auth.uid() = user_id;

grant select on public.safe_user_lms_settings to authenticated;
revoke all   on public.safe_user_lms_settings from anon;

comment on view public.safe_user_lms_settings is
  'Credential-free view of user_lms_settings. '
  'Filters rows for the calling auth.uid(). '
  'Does not expose encrypted_password or ws_token_encrypted.';
