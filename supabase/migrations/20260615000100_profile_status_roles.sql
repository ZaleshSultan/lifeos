alter table public.profiles
  add column if not exists status text,
  add column if not exists role text;

update public.profiles
set
  status = coalesce(status, 'active'),
  role = coalesce(role, 'user')
where status is null
   or role is null;

alter table public.profiles
  alter column status set default 'pending',
  alter column status set not null,
  alter column role set default 'user',
  alter column role set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_status_check
      check (status in ('pending', 'active', 'blocked'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('user', 'admin'));
  end if;
end;
$$;

create index if not exists profiles_status_idx
  on public.profiles (status);

create index if not exists profiles_role_idx
  on public.profiles (role);
