-- This fixture is permitted only in a freshly created disposable local DB.
do $$ begin
  if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key);
create table public.profiles(user_id uuid primary key references auth.users(id), status text not null);
create table public.user_settings(user_id uuid primary key references auth.users(id), settings jsonb not null default '{}');
grant usage on schema public, auth to anon, authenticated, service_role;
grant select, update on public.profiles to service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
insert into auth.users values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
insert into public.profiles select id, 'active' from auth.users;
insert into public.user_settings values
('00000000-0000-4000-8000-000000000001','{"unrelated":{"keep":"yes"},"workout_program":{"exercises":["existing"]},"ideal_human_days":{"2026-11-03":{"date":"2026-11-03","weightKg":51.2,"notes":"Legacy observation"},"2026-11-31":{"date":"2026-11-31","notes":"Invalid legacy date preserved only"},"not-a-date":{"notes":"Retain raw invalid entry"}}}');
