create table if not exists public.life_captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  source text not null default 'telegram',
  status text not null default 'inbox',
  chat_id bigint,
  message_id bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint life_captures_text_not_blank check (length(btrim(text)) > 0),
  constraint life_captures_status_not_blank check (length(btrim(status)) > 0)
);

create index if not exists life_captures_user_id_created_at_idx
  on public.life_captures (user_id, created_at desc);

create index if not exists life_captures_user_id_status_idx
  on public.life_captures (user_id, status, created_at desc);

create index if not exists life_captures_chat_message_idx
  on public.life_captures (chat_id, message_id)
  where chat_id is not null and message_id is not null;

alter table public.life_captures enable row level security;
alter table public.life_captures force row level security;

drop trigger if exists set_life_captures_updated_at on public.life_captures;
create trigger set_life_captures_updated_at
before update on public.life_captures
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'life_captures'
      and policyname = 'life_captures_owner_access'
  ) then
    create policy life_captures_owner_access
      on public.life_captures
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

alter table public.life_entities
  add column if not exists domain text not null default 'personal',
  add column if not exists status text not null default 'inbox',
  add column if not exists description text,
  add column if not exists raw_payload_json jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'life_entities_domain_not_blank'
      and conrelid = 'public.life_entities'::regclass
  ) then
    alter table public.life_entities
      add constraint life_entities_domain_not_blank check (length(btrim(domain)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'life_entities_status_not_blank'
      and conrelid = 'public.life_entities'::regclass
  ) then
    alter table public.life_entities
      add constraint life_entities_status_not_blank check (length(btrim(status)) > 0);
  end if;
end;
$$;

create index if not exists life_entities_user_id_status_idx
  on public.life_entities (user_id, status, occurred_at desc);

alter table public.obsidian_sync_queue
  add column if not exists entity_type public.life_entity_type,
  add column if not exists action text not null default 'upsert',
  add column if not exists target_path text,
  add column if not exists payload_json jsonb not null default '{}'::jsonb;

update public.obsidian_sync_queue
set payload_json = payload
where payload_json = '{}'::jsonb
  and payload <> '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'obsidian_sync_queue_action_not_blank'
      and conrelid = 'public.obsidian_sync_queue'::regclass
  ) then
    alter table public.obsidian_sync_queue
      add constraint obsidian_sync_queue_action_not_blank check (length(btrim(action)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'obsidian_sync_queue_target_path_not_blank'
      and conrelid = 'public.obsidian_sync_queue'::regclass
  ) then
    alter table public.obsidian_sync_queue
      add constraint obsidian_sync_queue_target_path_not_blank
      check (target_path is null or length(btrim(target_path)) > 0);
  end if;
end;
$$;

create index if not exists obsidian_sync_queue_entity_type_status_idx
  on public.obsidian_sync_queue (entity_type, status, available_at);
