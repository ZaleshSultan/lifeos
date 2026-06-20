-- ============================================================================
-- LifeOS Multi-tenant Syncthing + RLS hardening
-- ============================================================================
-- This migration moves Obsidian sync from single-user/local-vault mode toward a
-- server-owned multi-tenant Syncthing model:
--   /var/lifeos/vaults/{user_id}
-- Each tenant gets a stable Syncthing folder id and a vault path that cannot be
-- supplied arbitrarily by the client.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. user_obsidian_settings: Syncthing fields and server-owned path defaults
-- ---------------------------------------------------------------------------

alter table if exists public.user_obsidian_settings
  add column if not exists syncthing_folder_id text,
  add column if not exists is_active boolean not null default false;

alter table if exists public.user_obsidian_settings
  drop constraint if exists user_obsidian_settings_mode_check;

alter table if exists public.user_obsidian_settings
  add constraint user_obsidian_settings_mode_check
  check (mode in ('local_vault', 'agent', 'syncthing'));

update public.user_obsidian_settings
set
  syncthing_folder_id = coalesce(
    nullif(btrim(syncthing_folder_id), ''),
    'lifeos-' || replace(user_id::text, '-', '')
  ),
  vault_path = '/var/lifeos/vaults/' || user_id::text,
  is_active = enabled and status = 'connected'
where syncthing_folder_id is null
   or btrim(syncthing_folder_id) = ''
   or vault_path is null
   or btrim(vault_path) = ''
   or vault_path <> '/var/lifeos/vaults/' || user_id::text;

alter table if exists public.user_obsidian_settings
  alter column syncthing_folder_id set not null,
  alter column vault_path set not null;

create unique index if not exists user_obsidian_settings_syncthing_folder_id_key
  on public.user_obsidian_settings (syncthing_folder_id);

create unique index if not exists user_obsidian_settings_vault_path_key
  on public.user_obsidian_settings (vault_path);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_obsidian_settings_syncthing_folder_id_safe_check'
  ) then
    alter table public.user_obsidian_settings
      add constraint user_obsidian_settings_syncthing_folder_id_safe_check
      check (syncthing_folder_id ~ '^lifeos-[a-f0-9]{32}$');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_obsidian_settings_vault_path_server_owned_check'
  ) then
    alter table public.user_obsidian_settings
      add constraint user_obsidian_settings_vault_path_server_owned_check
      check (vault_path = '/var/lifeos/vaults/' || user_id::text);
  end if;
end;
$$;

create or replace function public.set_user_obsidian_syncthing_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.syncthing_folder_id is null or btrim(new.syncthing_folder_id) = '' then
    new.syncthing_folder_id := 'lifeos-' || replace(new.user_id::text, '-', '');
  end if;

  if new.vault_path is null or btrim(new.vault_path) = '' then
    new.vault_path := '/var/lifeos/vaults/' || new.user_id::text;
  end if;

  if new.vault_path <> '/var/lifeos/vaults/' || new.user_id::text then
    raise exception 'Invalid vault_path for user %', new.user_id
      using errcode = '22023';
  end if;

  if new.syncthing_folder_id !~ '^lifeos-[a-f0-9]{32}$' then
    raise exception 'Invalid syncthing_folder_id for user %', new.user_id
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists set_user_obsidian_syncthing_defaults
  on public.user_obsidian_settings;

create trigger set_user_obsidian_syncthing_defaults
before insert or update on public.user_obsidian_settings
for each row
execute function public.set_user_obsidian_syncthing_defaults();

-- ---------------------------------------------------------------------------
-- 2. RLS hardening: owner-only access through auth.uid() = user_id
-- ---------------------------------------------------------------------------

do $$
declare
  target_table text;
  target_tables text[] := array[
    'life_entities',
    'fitness_logs',
    'fitness_exercises',
    'workouts',
    'workout_sets',
    'health_metrics',
    'user_obsidian_settings',
    'obsidian_sync_queue',
    'user_oauth_connections'
  ];
begin
  foreach target_table in array target_tables loop
    if to_regclass(format('public.%I', target_table)) is not null
       and exists (
         select 1
         from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = target_table
           and c.column_name = 'user_id'
       ) then

      execute format(
        'alter table public.%I enable row level security',
        target_table
      );

      execute format(
        'alter table public.%I force row level security',
        target_table
      );

      if not exists (
        select 1
        from pg_policies p
        where p.schemaname = 'public'
          and p.tablename = target_table
          and p.policyname = target_table || '_owner_access'
      ) then
        execute format(
          'create policy %I on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
          target_table || '_owner_access',
          target_table
        );
      end if;
    end if;
  end loop;
end;
$$;

-- OAuth ciphertext is backend-only. The TMA/frontend reads metadata through a
-- safe view without access_token / refresh_token.
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
where auth.uid() = user_id;

grant select on public.safe_user_oauth_connections to authenticated;
revoke all on public.safe_user_oauth_connections from anon;

-- ---------------------------------------------------------------------------
-- 3. RPC hardening: one PostgreSQL transaction for entity + Obsidian queue
-- ---------------------------------------------------------------------------

create or replace function public.create_life_entity_with_sync(
  p_user_id              uuid,
  p_entity_type          public.life_entity_type,
  p_title                text,
  p_description          text                         default null,
  p_body                 text                         default null,
  p_domain               text                         default 'personal',
  p_status               text                         default 'inbox',
  p_source               text                         default 'telegram',
  p_source_command       text                         default null,
  p_telegram_chat_id     bigint                       default null,
  p_telegram_message_id  bigint                       default null,
  p_due_at               timestamptz                  default null,
  p_linked_table         text                         default null,
  p_linked_id            uuid                         default null,
  p_metadata             jsonb                        default '{}'::jsonb,
  p_raw_payload          jsonb                        default '{}'::jsonb,
  p_sync_operation       text                         default 'upsert_note',
  p_sync_entity_type     public.life_entity_type      default null,
  p_sync_action          text                         default 'upsert',
  p_sync_target_path     text                         default null,
  p_sync_payload         jsonb                        default '{}'::jsonb
)
returns public.life_entities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity public.life_entities;
  v_sync_payload jsonb;
begin
  if auth.role() <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_user_id) then
    raise exception 'Forbidden: p_user_id does not match auth.uid()'
      using errcode = '42501';
  end if;

  insert into public.life_entities (
    user_id,
    entity_type,
    title,
    description,
    body,
    domain,
    status,
    source,
    source_command,
    telegram_chat_id,
    telegram_message_id,
    due_at,
    linked_table,
    linked_id,
    metadata,
    raw_payload_json
  )
  values (
    p_user_id,
    p_entity_type,
    p_title,
    p_description,
    p_body,
    coalesce(nullif(btrim(p_domain), ''), 'personal'),
    coalesce(nullif(btrim(p_status), ''), 'inbox'),
    coalesce(nullif(btrim(p_source), ''), 'telegram'),
    p_source_command,
    p_telegram_chat_id,
    p_telegram_message_id,
    p_due_at,
    p_linked_table,
    p_linked_id,
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_raw_payload, '{}'::jsonb)
  )
  returning * into v_entity;

  v_sync_payload :=
    coalesce(p_sync_payload, '{}'::jsonb)
    || jsonb_build_object('entity_id', v_entity.id);

  insert into public.obsidian_sync_queue (
    user_id,
    life_entity_id,
    operation,
    entity_type,
    action,
    target_path,
    status,
    payload,
    payload_json
  )
  values (
    p_user_id,
    v_entity.id,
    coalesce(nullif(btrim(p_sync_operation), ''), 'upsert_note'),
    coalesce(p_sync_entity_type, p_entity_type),
    coalesce(nullif(btrim(p_sync_action), ''), 'upsert'),
    p_sync_target_path,
    'pending',
    v_sync_payload,
    v_sync_payload
  );

  return v_entity;
end;
$$;

grant execute on function public.create_life_entity_with_sync to authenticated;
grant execute on function public.create_life_entity_with_sync to service_role;
