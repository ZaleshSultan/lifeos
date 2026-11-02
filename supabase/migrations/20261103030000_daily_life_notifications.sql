-- Consent-gated extensions of the existing digest/reminder queues. Defaults create no jobs.
begin;
create table public.daily_life_notification_jobs (
 user_id uuid not null references auth.users(id) on delete cascade,
 local_date date not null,
 kind text not null check(kind in ('evening','hydration_1','hydration_2')),
 reminder_id uuid not null unique references public.reminders(id) on delete cascade,
 preferences_revision integer not null check(preferences_revision>0),
 timezone text not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(user_id,local_date,kind)
);
alter table public.daily_life_notification_jobs enable row level security;
revoke all on public.daily_life_notification_jobs from public,anon,authenticated,service_role;
grant select,insert,update on public.daily_life_notification_jobs to service_role;
alter table public.daily_digest_deliveries add column daily_life_preferences_revision integer;
alter table public.daily_digest_deliveries add column daily_life_timezone text;

create function public.daily_life_notification_allowed(p_user_id uuid,p_kind text,p_at timestamptz,p_revision integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_preferences jsonb;v_revision integer;v_timezone text;v_clock time;v_start time;v_end time;v_flag text;
begin
 select p.timezone,d.preferences,d.revision into v_timezone,v_preferences,v_revision from public.profiles p
 join public.daily_life_preferences d on d.user_id=p.user_id where p.user_id=p_user_id and p.status='active' and p.telegram_user_id is not null;
 if not found or p_at is null or not isfinite(p_at) or p_revision is null or v_revision<>p_revision or not exists(select from pg_catalog.pg_timezone_names where name=v_timezone) then return false;end if;
 v_flag:=case p_kind when 'morning' then 'morningEnabled' when 'evening' then 'eveningEnabled' when 'hydration_1' then 'hydrationRemindersEnabled' when 'hydration_2' then 'hydrationRemindersEnabled' end;
 if v_flag is null or v_preferences->v_flag is distinct from 'true'::jsonb
   or jsonb_typeof(v_preferences->'quietStart') is distinct from 'string' or jsonb_typeof(v_preferences->'quietEnd') is distinct from 'string'
   or (v_preferences->>'quietStart')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or (v_preferences->>'quietEnd')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false;end if;
 v_clock:=(p_at at time zone v_timezone)::time;v_start:=(v_preferences->>'quietStart')::time;v_end:=(v_preferences->>'quietEnd')::time;
 if v_start=v_end then return true;end if;
 return not(case when v_start<v_end then v_clock>=v_start and v_clock<v_end else v_clock>=v_start or v_clock<v_end end);
end;$$;

create function public.claim_daily_life_digest(p_user_id uuid,p_local_date date,p_preferences_revision integer)
returns setof public.daily_digest_deliveries language plpgsql security invoker set search_path='' as $$
declare v_timezone text;v_claim public.daily_digest_deliveries%rowtype;
begin
 select timezone into v_timezone from public.profiles where user_id=p_user_id and status='active' for update;
 if not found or not public.daily_life_notification_allowed(p_user_id,'morning',clock_timestamp(),p_preferences_revision) then return;end if;
 if p_local_date is null or p_local_date<>(clock_timestamp() at time zone v_timezone)::date then return;end if;
 perform 1 from public.daily_life_preferences where user_id=p_user_id and revision=p_preferences_revision for share;
 if not found then return;end if;
 update public.daily_digest_deliveries set status='pending',claim_token=null,lease_expires_at=null,failure_count=0,next_attempt_at=null
 where user_id=p_user_id and local_date=p_local_date and status='cancelled' and delivery_attempts=0
   and (daily_life_preferences_revision is distinct from p_preferences_revision or daily_life_timezone is distinct from v_timezone);
 select * into v_claim from public.claim_daily_digest(p_user_id,p_local_date);
 if not found then return;end if;
 return query update public.daily_digest_deliveries set daily_life_preferences_revision=p_preferences_revision,daily_life_timezone=v_timezone
 where id=v_claim.id and user_id=p_user_id and claim_token=v_claim.claim_token returning *;
end;$$;

create function public.enqueue_daily_life_notification(p_user_id uuid,p_local_date date,p_kind text,p_preferences_revision integer,p_message text,p_due_at timestamptz)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_timezone text;v_job public.daily_life_notification_jobs%rowtype;v_reminder public.reminders%rowtype;v_reminder_id uuid;
begin
 if p_kind is null or p_kind not in ('evening','hydration_1','hydration_2') or p_local_date is null or p_message is null or length(trim(p_message)) not between 1 and 3500 or octet_length(p_message)>16000 or p_due_at is null or not isfinite(p_due_at) then raise exception using errcode='22023',message='invalid_daily_life_notification';end if;
 select timezone into v_timezone from public.profiles where user_id=p_user_id and status='active' for update;
 if not found or not public.daily_life_notification_allowed(p_user_id,p_kind,p_due_at,p_preferences_revision) then return false;end if;
 perform 1 from public.daily_life_preferences where user_id=p_user_id and revision=p_preferences_revision for share;
 if not found or p_local_date<>(clock_timestamp() at time zone v_timezone)::date or p_local_date<>(p_due_at at time zone v_timezone)::date or p_due_at<clock_timestamp()-interval '60 minutes' then return false;end if;
 select * into v_job from public.daily_life_notification_jobs where user_id=p_user_id and local_date=p_local_date and kind=p_kind for update;
 if found then
  select * into v_reminder from public.reminders where user_id=p_user_id and id=v_job.reminder_id for update;
  if v_reminder.status<>'cancelled' or v_reminder.delivery_attempts<>0 or (v_job.preferences_revision=p_preferences_revision and v_job.timezone=v_timezone) then return false;end if;
  update public.reminders set message=p_message,remind_at=p_due_at,status='pending',claim_token=null,lease_expires_at=null,claimed_at=null,next_attempt_at=null,failure_count=0,last_error_code=null
   where id=v_reminder.id and user_id=p_user_id;
  update public.daily_life_notification_jobs set preferences_revision=p_preferences_revision,timezone=v_timezone where user_id=p_user_id and local_date=p_local_date and kind=p_kind;
  return true;
 end if;
 insert into public.reminders(user_id,channel,remind_at,message,metadata_json)
  values(p_user_id,'telegram',p_due_at,p_message,jsonb_build_object('daily_life_kind',p_kind,'daily_life_date',p_local_date)) returning id into v_reminder_id;
 insert into public.daily_life_notification_jobs(user_id,local_date,kind,reminder_id,preferences_revision,timezone)
  values(p_user_id,p_local_date,p_kind,v_reminder_id,p_preferences_revision,v_timezone);
 return true;
end;$$;

-- Retain the established fencing/active-profile/chat checks behind an extra consent boundary.
alter function public.begin_notification_delivery(text,uuid,uuid,uuid) rename to begin_notification_delivery_legacy;
create function public.begin_notification_delivery(p_kind text,p_user_id uuid,p_id uuid,p_claim_token uuid)
returns bigint language plpgsql security invoker set search_path='' as $$
declare v_revision integer;v_date date;v_kind text;v_job_timezone text;v_timezone text;v_valid boolean;
begin
 select timezone into v_timezone from public.profiles where user_id=p_user_id and status='active' for update;
 if not found then return null;end if;
 if p_kind='digest' then
  select daily_life_preferences_revision,local_date,'morning',daily_life_timezone into v_revision,v_date,v_kind,v_job_timezone
   from public.daily_digest_deliveries where id=p_id and user_id=p_user_id and claim_token=p_claim_token;
 elsif p_kind='reminder' then
  select preferences_revision,local_date,kind,timezone into v_revision,v_date,v_kind,v_job_timezone from public.daily_life_notification_jobs where user_id=p_user_id and reminder_id=p_id;
 end if;
 if p_kind='digest' or v_kind is not null then
  v_valid:=v_revision is not null and v_job_timezone=v_timezone and public.daily_life_notification_allowed(p_user_id,v_kind,clock_timestamp(),v_revision);
  if v_valid then v_valid:=v_date=(clock_timestamp() at time zone v_timezone)::date;end if;
  if not coalesce(v_valid,false) then
   if p_kind='digest' then
    update public.daily_digest_deliveries set status='cancelled',claim_token=null,lease_expires_at=null,last_error_code='daily_life_consent_or_time_changed'
     where id=p_id and user_id=p_user_id and claim_token=p_claim_token and status='processing';
   else
    update public.reminders set status='cancelled',claim_token=null,lease_expires_at=null,claimed_at=null,last_error_code='daily_life_consent_or_time_changed'
     where id=p_id and user_id=p_user_id and claim_token=p_claim_token and status='processing';
   end if;
   return null;
  end if;
 end if;
 return public.begin_notification_delivery_legacy(p_kind,p_user_id,p_id,p_claim_token);
end;$$;

-- Owners retain the established authenticated UPDATE(timezone) grant on profiles.
-- Only this trigger may cancel service-only queue bindings on that owner's behalf;
-- browser roles cannot call the function or choose a different affected owner.
create function public.cancel_changed_daily_life_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare v_user uuid;
begin
 if TG_TABLE_SCHEMA<>'public' or TG_TABLE_NAME not in ('profiles','daily_life_preferences') then raise exception using errcode='42501',message='invalid_notification_trigger';end if;
 if TG_TABLE_NAME='profiles' then
  if new.timezone is not distinct from old.timezone then return new;end if;v_user:=new.user_id;
 elsif TG_OP='DELETE' then v_user:=old.user_id;
 else
  if new.preferences is not distinct from old.preferences and new.revision is not distinct from old.revision then return new;end if;v_user:=new.user_id;
 end if;
 update public.reminders r set status='cancelled',claim_token=null,lease_expires_at=null,claimed_at=null,last_error_code='daily_life_preferences_changed'
  from public.daily_life_notification_jobs j where j.user_id=v_user and r.user_id=v_user and r.id=j.reminder_id and r.status in ('pending','processing');
 update public.daily_digest_deliveries set status='cancelled',claim_token=null,lease_expires_at=null,last_error_code='daily_life_preferences_changed'
  where user_id=v_user and status in ('pending','processing');
 if TG_OP='DELETE' then return old;end if;return new;
end;$$;
create trigger daily_life_preferences_cancel_notifications after update or delete on public.daily_life_preferences for each row execute function public.cancel_changed_daily_life_notifications();
create trigger daily_life_timezone_cancel_notifications after update of timezone on public.profiles for each row execute function public.cancel_changed_daily_life_notifications();

revoke all on function public.daily_life_notification_allowed(uuid,text,timestamptz,integer),public.claim_daily_life_digest(uuid,date,integer),public.enqueue_daily_life_notification(uuid,date,text,integer,text,timestamptz),public.begin_notification_delivery(text,uuid,uuid,uuid),public.cancel_changed_daily_life_notifications() from public,anon,authenticated;
grant execute on function public.daily_life_notification_allowed(uuid,text,timestamptz,integer),public.claim_daily_life_digest(uuid,date,integer),public.enqueue_daily_life_notification(uuid,date,text,integer,text,timestamptz),public.begin_notification_delivery(text,uuid,uuid,uuid),public.cancel_changed_daily_life_notifications() to service_role;
commit;
