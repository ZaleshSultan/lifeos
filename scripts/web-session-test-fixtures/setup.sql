-- Only for a new disposable local database. Mimic legacy Supabase default grants.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create table public.profiles (
  user_id uuid primary key references auth.users(id),
  status text not null default 'active'
);
grant usage on schema public, auth to anon, authenticated, service_role;
grant select, update on public.profiles to service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
insert into auth.users values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
insert into public.profiles select id, 'active' from auth.users;
