do $$
begin
  create type public.life_entity_type as enum (
    'capture',
    'task',
    'deadline',
    'health',
    'mode',
    'review',
    'finance',
    'spend',
    'workout'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.obsidian_sync_status as enum (
    'pending',
    'processing',
    'completed',
    'failed',
    'cancelled'
  );
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.life_entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type public.life_entity_type not null,
  title text not null,
  body text,
  occurred_at timestamptz not null default now(),
  due_at timestamptz,
  source text not null default 'telegram',
  source_command text,
  telegram_chat_id bigint,
  telegram_message_id bigint,
  linked_table text,
  linked_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint life_entities_title_not_blank check (length(btrim(title)) > 0)
);

create table if not exists public.obsidian_sync_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  life_entity_id uuid references public.life_entities(id) on delete cascade,
  operation text not null default 'upsert_note',
  status public.obsidian_sync_status not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint obsidian_sync_queue_operation_not_blank check (length(btrim(operation)) > 0),
  constraint obsidian_sync_queue_attempts_nonnegative check (attempts >= 0)
);

create index if not exists life_entities_user_id_occurred_at_idx
  on public.life_entities (user_id, occurred_at desc);

create index if not exists life_entities_user_id_entity_type_idx
  on public.life_entities (user_id, entity_type, occurred_at desc);

create index if not exists life_entities_user_id_due_at_idx
  on public.life_entities (user_id, due_at)
  where due_at is not null;

create index if not exists life_entities_telegram_message_idx
  on public.life_entities (telegram_chat_id, telegram_message_id)
  where telegram_chat_id is not null and telegram_message_id is not null;

create index if not exists life_entities_metadata_idx
  on public.life_entities using gin (metadata);

create index if not exists obsidian_sync_queue_user_id_status_idx
  on public.obsidian_sync_queue (user_id, status, available_at);

create index if not exists obsidian_sync_queue_life_entity_id_idx
  on public.obsidian_sync_queue (life_entity_id)
  where life_entity_id is not null;

alter table public.life_entities enable row level security;
alter table public.life_entities force row level security;
alter table public.obsidian_sync_queue enable row level security;
alter table public.obsidian_sync_queue force row level security;

drop trigger if exists set_life_entities_updated_at on public.life_entities;
create trigger set_life_entities_updated_at
before update on public.life_entities
for each row execute function public.set_updated_at();

drop trigger if exists set_obsidian_sync_queue_updated_at on public.obsidian_sync_queue;
create trigger set_obsidian_sync_queue_updated_at
before update on public.obsidian_sync_queue
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'life_entities'
      and policyname = 'life_entities_owner_access'
  ) then
    create policy life_entities_owner_access
      on public.life_entities
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'obsidian_sync_queue'
      and policyname = 'obsidian_sync_queue_owner_access'
  ) then
    create policy obsidian_sync_queue_owner_access
      on public.obsidian_sync_queue
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;
