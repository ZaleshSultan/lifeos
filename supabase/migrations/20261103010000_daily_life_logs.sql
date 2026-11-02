-- Additive owner-scoped quick logs and preferences. Existing factual rows retained.
begin;
create table public.hydration_entries (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id text not null check (length(request_id) between 8 and 120),
 amount_ml integer not null check (amount_ml between 1 and 5000),
 occurred_at timestamptz not null default clock_timestamp(),
 local_date date not null,
 source text not null check (source in ('telegram','tma','web')),
 undone_at timestamptz,
 unique(user_id,request_id)
);
create index hydration_entries_day_idx on public.hydration_entries(user_id,local_date,occurred_at);
alter table public.hydration_entries enable row level security;
revoke all on public.hydration_entries from public,anon,authenticated,service_role;
grant select,insert,update on public.hydration_entries to service_role;

create table public.daily_life_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 preferences jsonb not null check(jsonb_typeof(preferences)='object' and octet_length(preferences::text)<=4096),
 revision integer not null default 1 check(revision>0),
 updated_at timestamptz not null default clock_timestamp()
);
alter table public.daily_life_preferences enable row level security;
revoke all on public.daily_life_preferences from public,anon,authenticated,service_role;
grant select,insert,update on public.daily_life_preferences to service_role;

alter table public.tasks add column client_request_id text;
alter table public.tasks add column client_request_hash text;
create unique index tasks_client_request_idx on public.tasks(user_id,client_request_id) where client_request_id is not null;

create function public.log_hydration(p_user_id uuid,p_request_id text,p_amount_ml integer,p_source text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_timezone text; v_row public.hydration_entries%rowtype; v_now timestamptz:=clock_timestamp();
begin
 if p_request_id is null or p_request_id !~ '^[a-zA-Z0-9:_-]{8,120}$' or p_amount_ml is null or p_amount_ml<1 or p_amount_ml>5000 or p_source is null or p_source not in ('telegram','tma','web') then raise exception using errcode='22023',message='invalid_hydration';end if;
 select timezone into v_timezone from public.profiles where user_id=p_user_id and status='active' for update;
 if not found then raise exception using errcode='42501',message='profile_inactive';end if;
 if v_timezone is null or not exists(select from pg_catalog.pg_timezone_names where name=v_timezone) then raise exception using errcode='22023',message='invalid_hydration_timezone';end if;
 select * into v_row from public.hydration_entries where user_id=p_user_id and request_id=p_request_id;
 if found then
  if v_row.amount_ml<>p_amount_ml or v_row.source<>p_source then raise exception using errcode='P0001',message='daily_life_conflict';end if;
 else
  insert into public.hydration_entries(user_id,request_id,amount_ml,occurred_at,local_date,source)
   values(p_user_id,p_request_id,p_amount_ml,v_now,(v_now at time zone v_timezone)::date,p_source) returning * into v_row;
 end if;
 return jsonb_build_object('id',v_row.id,'amountMl',v_row.amount_ml,'occurredAt',v_row.occurred_at,'source',v_row.source,'undoneAt',v_row.undone_at,'date',v_row.local_date);
end;$$;
create function public.undo_hydration(p_user_id uuid,p_entry_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_row public.hydration_entries%rowtype;
begin
 perform 1 from public.profiles where user_id=p_user_id and status='active' for update;
 if not found then raise exception using errcode='42501',message='profile_inactive';end if;
 update public.hydration_entries set undone_at=coalesce(undone_at,clock_timestamp()) where user_id=p_user_id and id=p_entry_id returning * into v_row;
 if not found then raise exception using errcode='P0002',message='hydration_not_found';end if;
 return jsonb_build_object('date',v_row.local_date);
end;$$;

-- Aggregate every owned entry in one snapshot; history pagination never changes the total.
create function public.get_hydration_summary(p_user_id uuid,p_date date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_timezone text;v_result jsonb;
begin
 if p_date is null or not isfinite(p_date) then raise exception using errcode='22023',message='invalid_hydration_date';end if;
 select timezone into v_timezone from public.profiles where user_id=p_user_id and status='active' for share;
 if not found then raise exception using errcode='42501',message='profile_inactive';end if;
 with owned as materialized (
   select id,amount_ml,occurred_at,source,undone_at from public.hydration_entries where user_id=p_user_id and local_date=p_date
 ), totals as (
   select coalesce(sum(amount_ml) filter(where undone_at is null),0) total_ml,count(*) total_count from owned
 ), history as (
   select * from owned order by occurred_at desc,id desc limit 200
 )
 select jsonb_build_object('date',p_date,'timezone',v_timezone,'totalMl',totals.total_ml,'truncated',totals.total_count>200,
   'entries',coalesce((select jsonb_agg(jsonb_build_object('id',id,'amountMl',amount_ml,'occurredAt',occurred_at,'source',source,'undoneAt',undone_at) order by occurred_at desc,id desc) from history),'[]'::jsonb)) into v_result from totals;
 return v_result;
end;$$;
revoke all on function public.get_hydration_summary(uuid,date) from public,anon,authenticated;
grant execute on function public.get_hydration_summary(uuid,date) to service_role;

-- The legacy timestamp trigger uses transaction-start now(). Keep task CAS tokens
-- strictly monotonic even for multiple updates in one transaction or clock skew.
create function public.ensure_task_cas_timestamp() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');return new;end;$$;
create trigger zz_tasks_cas_timestamp before update on public.tasks for each row execute function public.ensure_task_cas_timestamp();
revoke all on function public.ensure_task_cas_timestamp() from public,anon,authenticated;


create function public.save_daily_life_preferences(p_user_id uuid,p_preferences jsonb,p_expected_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_row public.daily_life_preferences%rowtype;v_key text;
begin
 if p_preferences is null or jsonb_typeof(p_preferences)<>'object' or octet_length(p_preferences::text)>4096 or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=2147483647 then raise exception using errcode='22023',message='invalid_preferences';end if;
 if exists(select from jsonb_object_keys(p_preferences) k where k not in ('morningEnabled','morningTime','eveningEnabled','eveningTime','quietStart','quietEnd','hydrationRemindersEnabled','includeHealth','includeFilming')) then raise exception using errcode='22023',message='invalid_preferences';end if;
 foreach v_key in array array['morningEnabled','eveningEnabled','hydrationRemindersEnabled','includeHealth','includeFilming'] loop
  if jsonb_typeof(p_preferences->v_key) is distinct from 'boolean' then raise exception using errcode='22023',message='invalid_preferences';end if;
 end loop;
 foreach v_key in array array['morningTime','eveningTime','quietStart','quietEnd'] loop
  if jsonb_typeof(p_preferences->v_key) is distinct from 'string' or (p_preferences->>v_key)!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception using errcode='22023',message='invalid_preferences';end if;
 end loop;
 perform 1 from public.profiles where user_id=p_user_id and status='active' for update;
 if not found then raise exception using errcode='42501',message='profile_inactive';end if;
 select * into v_row from public.daily_life_preferences where user_id=p_user_id for update;
 if found then
  if v_row.preferences=p_preferences and p_expected_revision<v_row.revision then return v_row.preferences||jsonb_build_object('revision',v_row.revision);end if;
  if v_row.revision<>p_expected_revision then raise exception using errcode='P0001',message='daily_life_conflict';end if;
  update public.daily_life_preferences set preferences=p_preferences,revision=revision+1,updated_at=clock_timestamp() where user_id=p_user_id returning * into v_row;
 else
  if p_expected_revision<>0 then raise exception using errcode='P0001',message='daily_life_conflict';end if;
  insert into public.daily_life_preferences(user_id,preferences)values(p_user_id,p_preferences)returning * into v_row;
 end if;
 return v_row.preferences||jsonb_build_object('revision',v_row.revision);
end;$$;

create function public.manage_lifeos_task(p_user_id uuid,p_task_id uuid,p_request_id text,p_patch jsonb,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_row public.tasks%rowtype;v_hash text:=md5(p_patch::text);v_due_at timestamptz;
begin
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb or octet_length(p_patch::text)>16384 or exists(select from jsonb_object_keys(p_patch) k where k not in ('title','notes','dueAt','status')) then raise exception using errcode='22023',message='invalid_task';end if;
 if p_patch?'title' and (jsonb_typeof(p_patch->'title') is distinct from 'string' or length(trim(p_patch->>'title')) not between 1 and 500) then raise exception using errcode='22023',message='invalid_task';end if;
 if p_patch?'notes' and (jsonb_typeof(p_patch->'notes') is distinct from 'string' or length(p_patch->>'notes')>5000) then raise exception using errcode='22023',message='invalid_task';end if;
 if p_patch?'status' and (jsonb_typeof(p_patch->'status') is distinct from 'string' or (p_patch->>'status') not in ('inbox','next','scheduled','waiting','done','cancelled')) then raise exception using errcode='22023',message='invalid_task';end if;
 if p_patch?'dueAt' and jsonb_typeof(p_patch->'dueAt') is distinct from 'null' then
  if jsonb_typeof(p_patch->'dueAt') is distinct from 'string' or (p_patch->>'dueAt')!~'^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,6})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$' then raise exception using errcode='22023',message='invalid_task';end if;
  begin v_due_at:=(p_patch->>'dueAt')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception using errcode='22023',message='invalid_task';end;
 end if;
 perform 1 from public.profiles where user_id=p_user_id and status='active' for update;
 if not found then raise exception using errcode='42501',message='profile_inactive';end if;
 if p_task_id is null then
  if p_expected_updated_at is not null or p_patch?'status' then raise exception using errcode='22023',message='invalid_task';end if;
  if p_request_id is null or p_request_id!~'^[a-zA-Z0-9:_-]{8,120}$' or not(p_patch?'title') then raise exception using errcode='22023',message='invalid_task';end if;
  select * into v_row from public.tasks where user_id=p_user_id and client_request_id=p_request_id;
  if found then
   if v_row.client_request_hash<>v_hash then raise exception using errcode='P0001',message='daily_life_conflict';end if;
  else
   insert into public.tasks(user_id,title,notes,due_at,source,client_request_id,client_request_hash)
   values(p_user_id,trim(p_patch->>'title'),coalesce(p_patch->>'notes',''),(p_patch->>'dueAt')::timestamptz,'lifeos',p_request_id,v_hash) returning * into v_row;
  end if;
 else
  if p_request_id is not null then raise exception using errcode='22023',message='invalid_task';end if;
  select * into v_row from public.tasks where user_id=p_user_id and id=p_task_id for update;
  if not found then raise exception using errcode='P0002',message='task_not_found';end if;
  if p_expected_updated_at is null or v_row.updated_at<>p_expected_updated_at then raise exception using errcode='P0001',message='daily_life_conflict';end if;
  update public.tasks set title=case when p_patch?'title' then trim(p_patch->>'title') else title end,
   notes=case when p_patch?'notes' then p_patch->>'notes' else notes end,
   due_at=case when p_patch?'dueAt' then (p_patch->>'dueAt')::timestamptz else due_at end,
   status=case when p_patch?'status' then (p_patch->>'status')::public.lifeos_task_status else status end,
   completed_at=case when p_patch?'status' then case when p_patch->>'status'='done' then coalesce(completed_at,clock_timestamp()) else null end else completed_at end
  where user_id=p_user_id and id=p_task_id returning * into v_row;
 end if;
 return jsonb_build_object('id',v_row.id,'title',v_row.title,'notes',coalesce(v_row.notes,''),'dueAt',v_row.due_at,'status',v_row.status,'priority',v_row.priority,'updatedAt',v_row.updated_at,'completedAt',v_row.completed_at);
end;$$;

revoke all on function public.log_hydration(uuid,text,integer,text),public.undo_hydration(uuid,uuid),public.save_daily_life_preferences(uuid,jsonb,integer),public.manage_lifeos_task(uuid,uuid,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.log_hydration(uuid,text,integer,text),public.undo_hydration(uuid,uuid),public.save_daily_life_preferences(uuid,jsonb,integer),public.manage_lifeos_task(uuid,uuid,text,jsonb,timestamptz) to service_role;
commit;
