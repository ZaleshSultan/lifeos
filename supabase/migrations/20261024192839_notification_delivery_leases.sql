begin;

-- Extend existing queues; never recreate rows or clear confirmed delivery history.
do $$ declare t text; begin
  foreach t in array array['reminders','daily_digest_deliveries'] loop
    execute format('alter table public.%I add column claim_token uuid, add column lease_expires_at timestamptz,
      add column delivery_started_at timestamptz, add column delivery_attempts integer not null default 0 check (delivery_attempts>=0),
      add column failure_count integer not null default 0 check (failure_count>=0), add column next_attempt_at timestamptz,
      add column last_error_code text, add column telegram_message_id bigint',t);
  end loop;
end $$;
alter table public.reminders add column telegram_chat_id bigint;
-- Keep existing API notification-time displays correct after a quiet-hours defer,
-- while preserving the immutable original schedule/event timestamp.
alter table public.reminders add column notification_at timestamptz
  generated always as (greatest(remind_at,next_attempt_at)) stored;
alter table public.reminders drop constraint reminders_status_allowed;
alter table public.reminders add constraint reminders_status_allowed check(status in ('pending','processing','sending','sent','cancelled','failed','unknown'));
alter table public.daily_digest_deliveries drop constraint daily_digest_deliveries_status_allowed;
alter table public.daily_digest_deliveries add constraint daily_digest_deliveries_status_allowed check(status in ('pending','processing','sending','sent','cancelled','failed','unknown'));
alter table public.daily_digest_deliveries alter column status set default 'pending';
-- Old processing records have no durable boundary proving the request was not sent.
update public.reminders set status='unknown',last_error_code='legacy_delivery_unknown',claimed_at=null where status='processing';
update public.daily_digest_deliveries set status='unknown',last_error_code='legacy_delivery_unknown' where status='sending';
update public.reminders set delivery_attempts=(metadata_json #>> '{reminder_worker,attempts}')::integer
  where (metadata_json #>> '{reminder_worker,attempts}') ~ '^[0-9]{1,9}$';
create index reminders_delivery_lease_idx on public.reminders(lease_expires_at) where status in ('processing','sending');
create index digest_delivery_lease_idx on public.daily_digest_deliveries(lease_expires_at) where status in ('processing','sending');
create index reminders_delivery_due_idx on public.reminders(notification_at) where status='pending' and channel='telegram';

-- Preserve the existing atomic SKIP LOCKED claim API. Times from callers may
-- narrow due work, never advance it past the authoritative database clock.
create or replace function public.claim_due_reminders(p_before timestamptz,p_limit integer default 20)
returns setof public.reminders language sql security definer set search_path = public,pg_temp as $$
  with due as (
    select r.id from public.reminders r join public.profiles p on p.user_id=r.user_id
      where r.status='pending' and r.channel='telegram' and p.status='active' and p.telegram_user_id is not null
        and r.notification_at<=least(p_before,clock_timestamp())
        and r.delivery_attempts<3 and r.failure_count<3
      order by r.notification_at,r.id limit greatest(1,least(coalesce(p_limit,20),100))
      for update of r skip locked
  ), claimed as (
    update public.reminders r set status='processing',claimed_at=clock_timestamp(),claim_token=gen_random_uuid(),
      lease_expires_at=clock_timestamp()+interval '5 minutes',delivery_started_at=null
      from due where r.id=due.id returning r.*
  ) select * from claimed order by remind_at,id;
$$;

create function public.claim_daily_digest(p_user_id uuid,p_local_date date)
returns setof public.daily_digest_deliveries language plpgsql security invoker set search_path = '' as $$
declare v_profile public.profiles;
begin
  select * into v_profile from public.profiles where user_id=p_user_id and status='active' and telegram_user_id is not null for update;
  if not found then return; end if;
  if p_local_date is distinct from (clock_timestamp() at time zone
    case when exists(select 1 from pg_timezone_names where name=v_profile.timezone) then v_profile.timezone else 'UTC' end)::date then return; end if;
  insert into public.daily_digest_deliveries(user_id,local_date,telegram_chat_id,status)
    values(p_user_id,p_local_date,v_profile.telegram_user_id,'pending') on conflict(user_id,local_date) do nothing;
  return query update public.daily_digest_deliveries set status='processing',claim_token=gen_random_uuid(),
    lease_expires_at=clock_timestamp()+interval '5 minutes',delivery_started_at=null,telegram_chat_id=v_profile.telegram_user_id
    where user_id=p_user_id and local_date=p_local_date and status='pending' and delivery_attempts<3 and failure_count<3
      and (next_attempt_at is null or next_attempt_at<=clock_timestamp()) returning *;
end $$;

create function public.begin_notification_delivery(p_kind text,p_user_id uuid,p_id uuid,p_claim_token uuid)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare v_table text; v_chat bigint; v_rows integer; v_timezone text; v_date_predicate text;
begin
  v_table:=case p_kind when 'reminder' then 'reminders' when 'digest' then 'daily_digest_deliveries' end;
  if v_table is null then raise exception 'Invalid delivery kind' using errcode='22023'; end if;
  -- Lock order matches profile blocking and digest claims, preventing deadlocks.
  select telegram_user_id,timezone into v_chat,v_timezone from public.profiles where user_id=p_user_id and status='active' and telegram_user_id is not null for update;
  if not found then return null; end if;
  v_date_predicate:=case when p_kind='digest' then ' and local_date=(clock_timestamp() at time zone $5)::date' else '' end;
  if not exists(select 1 from pg_timezone_names where name=v_timezone) then v_timezone:='UTC'; end if;
  execute format('update public.%I set status=''sending'',delivery_started_at=clock_timestamp(),delivery_attempts=delivery_attempts+1,
    lease_expires_at=clock_timestamp()+interval ''2 minutes'',telegram_chat_id=$4
    where id=$1 and user_id=$2 and claim_token=$3 and status=''processing'' and lease_expires_at>clock_timestamp()
      and delivery_attempts<3 and failure_count<3 %s',v_table,v_date_predicate) using p_id,p_user_id,p_claim_token,v_chat,v_timezone;
  get diagnostics v_rows=row_count;
  if v_rows=0 then return null; end if;
  return v_chat;
end $$;

create function public.finish_notification_delivery(p_kind text,p_user_id uuid,p_id uuid,p_claim_token uuid,
  p_outcome text,p_reason text default 'none',p_message_id bigint default null,p_retry_after_seconds integer default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_table text; v_rows integer;
begin
  v_table:=case p_kind when 'reminder' then 'reminders' when 'digest' then 'daily_digest_deliveries' end;
  if v_table is null or p_outcome is null or p_outcome not in ('sent','retry','permanent','unknown','cancelled')
    or p_reason is null or p_reason !~ '^[a-z_]{1,64}$' or (p_outcome='sent' and (p_message_id is null or p_message_id<=0)) then
    raise exception 'Invalid delivery transition' using errcode='22023';
  end if;
  execute format('update public.%I set
    status=case when $4=''sent'' then ''sent'' when $4=''unknown'' then ''unknown'' when $4=''cancelled'' then ''cancelled''
      when $4=''permanent'' or failure_count+1>=3 or delivery_attempts>=3 then ''failed'' else ''pending'' end,
    failure_count=failure_count+case when $4 in (''retry'',''permanent'') then 1 else 0 end,
    next_attempt_at=case when $4=''retry'' and failure_count+1<3 and delivery_attempts<3 then clock_timestamp()+make_interval(secs=>greatest(60,least(coalesce($7,60*(2^least(failure_count,6))::integer),86400))) else null end,
    sent_at=case when $4=''sent'' then clock_timestamp() else sent_at end,
    telegram_message_id=case when $4=''sent'' then $6 else telegram_message_id end,
    last_error_code=case when $4=''sent'' then null else $5 end,claim_token=null,lease_expires_at=null
    where id=$1 and user_id=$2 and claim_token=$3 and lease_expires_at>clock_timestamp()
      and (status=''sending'' or (status=''processing'' and $4 in (''retry'',''permanent'',''cancelled'')))',v_table)
    using p_id,p_user_id,p_claim_token,p_outcome,p_reason,p_message_id,p_retry_after_seconds;
  get diagnostics v_rows=row_count;
  if p_kind='reminder' and v_rows>0 then update public.reminders set claimed_at=null where id=p_id and user_id=p_user_id; end if;
  return v_rows>0;
end $$;

create function public.defer_reminder_delivery(p_user_id uuid,p_id uuid,p_claim_token uuid,p_not_before timestamptz)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_rows integer;
begin
  if p_not_before is null or p_not_before<=clock_timestamp() then return false; end if;
  update public.reminders set status='pending',next_attempt_at=p_not_before,claim_token=null,lease_expires_at=null,claimed_at=null,
    metadata_json=case when metadata_json ? 'event_at' then metadata_json else metadata_json||jsonb_build_object('event_at',remind_at) end
    where id=p_id and user_id=p_user_id and claim_token=p_claim_token and status='processing' and lease_expires_at>clock_timestamp();
  get diagnostics v_rows=row_count;
  return v_rows>0;
end $$;

create function public.recover_notification_deliveries(p_kind text,p_limit integer default 100)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_table text; v_result jsonb; v_date_predicate text;
begin
  v_table:=case p_kind when 'reminder' then 'reminders' when 'digest' then 'daily_digest_deliveries' end;
  if v_table is null then raise exception 'Invalid delivery kind' using errcode='22023'; end if;
  v_date_predicate:=case when p_kind='digest' then ' or (n.status=''pending'' and n.local_date < (clock_timestamp() at time zone case when exists(select 1 from pg_timezone_names where name=p.timezone) then p.timezone else ''UTC'' end)::date)' else '' end;
  execute format('with stale as (
    select n.id from public.%I n join public.profiles p on p.user_id=n.user_id where
      (n.status in (''processing'',''sending'') and (n.lease_expires_at is null or n.lease_expires_at<=clock_timestamp()))
      or (n.status=''pending'' and (n.failure_count>=3 or n.delivery_attempts>=3)) %s
    order by n.created_at,n.id limit greatest(1,least(coalesce($1,100),1000)) for update of n skip locked
  ), recovered as (
    update public.%I n set status=case when n.status=''sending'' then ''unknown''
      when n.status=''pending'' or n.failure_count+1>=3 or n.delivery_attempts>=3 then ''failed'' else ''pending'' end,
      failure_count=failure_count+case when status=''processing'' then 1 else 0 end,
      last_error_code=case when status=''sending'' then ''delivery_outcome_unknown'' when status=''pending'' then ''delivery_budget_or_date_exhausted'' else ''preparation_lease_expired'' end,
      next_attempt_at=case when status=''processing'' and failure_count+1<3 and delivery_attempts<3 then clock_timestamp()+interval ''60 seconds'' else null end,
      claim_token=null,lease_expires_at=null %s from stale where n.id=stale.id returning n.status
  ) select jsonb_build_object(''pending'',count(*) filter(where status=''pending''),''unknown'',count(*) filter(where status=''unknown''),''failed'',count(*) filter(where status=''failed''),''stale'',count(*)) from recovered',v_table,v_date_predicate,v_table,case when p_kind='reminder' then ',claimed_at=null' else '' end)
    into v_result using p_limit;
  return v_result;
end $$;

create function public.notification_queue_health()
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_object_agg(kind,counts) from (
    select kind,jsonb_object_agg(status,n) counts from (
      select 'reminder' kind,status,count(*) n from public.reminders group by status
      union all select 'digest',status,count(*) from public.daily_digest_deliveries group by status
    ) s group by kind
  ) t;
$$;

create function public.invalidate_inactive_notification_claims()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status<>'active' then
    update public.reminders set status=case when status='sending' then 'unknown' else 'cancelled' end,
      last_error_code='recipient_inactive',claim_token=null,lease_expires_at=null,claimed_at=null
      where user_id=new.user_id and status in ('pending','processing','sending');
    update public.daily_digest_deliveries set status=case when status='sending' then 'unknown' else 'cancelled' end,
      last_error_code='recipient_inactive',claim_token=null,lease_expires_at=null
      where user_id=new.user_id and status in ('pending','processing','sending');
  end if;
  return new;
end $$;
create trigger profiles_invalidate_notification_claims after update of status on public.profiles
  for each row when(old.status is distinct from new.status) execute function public.invalidate_inactive_notification_claims();

-- Explicit grants override legacy Supabase defaults. Invoker functions do not
-- make any service-only table available to browser identities.
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('claim_due_reminders','claim_daily_digest','begin_notification_delivery','finish_notification_delivery','defer_reminder_delivery','recover_notification_deliveries','notification_queue_health','invalidate_inactive_notification_claims') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
commit;
