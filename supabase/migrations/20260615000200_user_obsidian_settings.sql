create table if not exists public.user_obsidian_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  mode text not null default 'local_vault',
  vault_path text,
  status text not null default 'disconnected',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_obsidian_settings_mode_check
    check (mode in ('local_vault', 'agent')),
  constraint user_obsidian_settings_status_check
    check (status in ('disconnected', 'connected', 'error'))
);

alter table public.user_obsidian_settings enable row level security;
alter table public.user_obsidian_settings force row level security;

drop trigger if exists set_user_obsidian_settings_updated_at
  on public.user_obsidian_settings;
create trigger set_user_obsidian_settings_updated_at
before update on public.user_obsidian_settings
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_obsidian_settings'
      and policyname = 'user_obsidian_settings_owner_access'
  ) then
    create policy user_obsidian_settings_owner_access
      on public.user_obsidian_settings
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;
