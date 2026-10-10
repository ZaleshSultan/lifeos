-- Disposable PostgreSQL fixture only. Never apply this setup to LifeOS.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function public.lifeos_is_owner(id uuid) returns boolean language sql stable as
$$ select auth.uid()=id $$;
create function public.set_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at=now(); return new; end $$;
grant usage on schema public,auth to anon,authenticated,service_role;
create table public.source_events (user_id uuid,id uuid,source_key text,event_type text,status text);
