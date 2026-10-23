-- Disposable DB only: Supabase API roles, JWT helpers and legacy default grants.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as
$$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
create schema storage;
create table storage.buckets (id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as
$$ select (string_to_array($1, '/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to service_role;
grant select, insert, update, delete on storage.objects to authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant select on auth.users to service_role;
