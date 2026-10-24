-- Synthetic identities only, in the disposable test database.
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002')
on conflict(id) do nothing;
insert into public.profiles(user_id,status,role,telegram_user_id,timezone) values
  ('00000000-0000-4000-8000-000000000001','active','user',101,'America/New_York'),
  ('00000000-0000-4000-8000-000000000002','active','user',102,'Asia/Almaty')
on conflict(user_id) do nothing;

create schema notification_test;
create table notification_test.assertions(name text primary key);
create function notification_test.assert(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Assertion failed: %', message; end if;
  insert into notification_test.assertions(name) values(message);
end;
$$;
create table notification_test.reminder_claims(worker integer not null,id uuid not null,claim_token uuid not null);
create table notification_test.digest_claims(worker integer not null,id uuid not null,claim_token uuid not null);
grant usage on schema notification_test to service_role;
grant all on all tables in schema notification_test to service_role;
grant execute on function notification_test.assert(boolean,text) to service_role;

insert into public.reminders(id,user_id,channel,remind_at,message)
select md5('parallel-reminder-' || n)::uuid,
       case when n <= 12 then '00000000-0000-4000-8000-000000000001'::uuid
            else '00000000-0000-4000-8000-000000000002'::uuid end,
       'telegram', clock_timestamp()-interval '1 minute', 'synthetic fixture'
from generate_series(1,24) n;

create function notification_test.claim_reminder(p_name text,p_user_id uuid default '00000000-0000-4000-8000-000000000001')
returns public.reminders language plpgsql as $$
declare v_id uuid; v_row public.reminders;
begin
  insert into public.reminders(user_id,channel,remind_at,message)
  values(p_user_id,'telegram',clock_timestamp()-interval '1 minute','synthetic fixture ' || p_name)
  returning id into v_id;
  select * into v_row from public.claim_due_reminders(clock_timestamp(),100) where id=v_id;
  if v_row.id is null then raise exception 'Fixture could not claim reminder'; end if;
  return v_row;
end;
$$;
grant execute on function notification_test.claim_reminder(text,uuid) to service_role;
