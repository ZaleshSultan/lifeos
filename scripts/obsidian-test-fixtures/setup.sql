-- Synthetic rows in a fresh local PostgreSQL instance only.
-- The race barrier observes backend wait states. This diagnostics privilege is
-- fixture-only and is never included in a production migration.
grant pg_read_all_stats to service_role;
create schema obsidian_test;
create table obsidian_test.assertions(name text primary key);
create function obsidian_test.assert(ok boolean, message text)
returns void language plpgsql security invoker as $$
begin
  if ok is distinct from true then raise exception 'Assertion failed: %', message; end if;
  insert into obsidian_test.assertions(name) values(message);
end;
$$;
create function obsidian_test.denied(statement text, message text)
returns void language plpgsql security invoker as $$
begin
  begin
    execute statement;
  exception when insufficient_privilege then
    perform obsidian_test.assert(true,message);
    return;
  end;
  raise exception 'Expected permission denial: %',message;
end;
$$;
create function obsidian_test.claim_lost(statement text, message text)
returns void language plpgsql security invoker as $$
begin
  begin
    execute statement;
  exception when serialization_failure then
    perform obsidian_test.assert(true,message);
    return;
  end;
  raise exception 'Expected lost claim: %',message;
end;
$$;
create function obsidian_test.invalid(statement text, message text)
returns void language plpgsql security invoker as $$
begin
  begin
    execute statement;
  exception when invalid_parameter_value then
    perform obsidian_test.assert(true,message);
    return;
  end;
  raise exception 'Expected invalid parameter: %',message;
end;
$$;
create table obsidian_test.claims(stage text not null,worker integer not null,id uuid not null,claim_token uuid not null);
create table obsidian_test.expiry_race(id uuid primary key,user_id uuid not null,old_token uuid not null,old_revision bigint not null,new_token uuid);
create table obsidian_test.race_results(actor text primary key,acknowledged boolean not null);
create function obsidian_test.cancel_jobs()
returns void language sql security invoker as $$
  update public.obsidian_sync_queue set status='cancelled',claim_token=null,lease_expires_at=null,locked_at=null
    where status::text in ('pending','retry','processing');
$$;
create function obsidian_test.claim(p_name text,
  p_user_id uuid default '00000000-0000-4000-8000-000000000001',p_entity_id uuid default null)
returns public.obsidian_sync_queue language plpgsql security invoker as $$
declare v_id uuid; v_entity_id uuid:=p_entity_id; v_job public.obsidian_sync_queue;
begin
  if v_entity_id is null then
    insert into public.life_entities(user_id,entity_type,title) values(p_user_id,'capture','synthetic ' || p_name) returning id into v_entity_id;
  end if;
  insert into public.obsidian_sync_queue(user_id,life_entity_id,entity_type,available_at)
    values(p_user_id,v_entity_id,'capture',clock_timestamp()-interval '1 second') returning id into v_id;
  select * into v_job from public.claim_obsidian_sync_jobs(1) where id=v_id;
  if v_job.id is null then raise exception 'Fixture could not claim expected job'; end if;
  return v_job;
end;
$$;
grant usage on schema obsidian_test to anon,authenticated,service_role;
grant all on all tables in schema obsidian_test to anon,authenticated,service_role;
grant execute on all functions in schema obsidian_test to anon,authenticated,service_role;

insert into public.life_entities(id,user_id,entity_type,title)
select md5('parallel-obsidian-entity-' || n)::uuid,
       case when n<=12 then '00000000-0000-4000-8000-000000000001'::uuid
            else '00000000-0000-4000-8000-000000000002'::uuid end,
       'capture','synthetic independent fixture'
from generate_series(1,24) n;
insert into public.obsidian_sync_queue(id,user_id,life_entity_id,entity_type,available_at)
select md5('parallel-obsidian-job-' || n)::uuid,
       case when n<=12 then '00000000-0000-4000-8000-000000000001'::uuid
            else '00000000-0000-4000-8000-000000000002'::uuid end,
       md5('parallel-obsidian-entity-' || n)::uuid,'capture',clock_timestamp()-interval '1 minute'
from generate_series(1,24) n;
