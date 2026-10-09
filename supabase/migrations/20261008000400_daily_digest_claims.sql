-- Add durable claim phases without replacing or deleting historical deliveries.
-- `sending` rows from the old worker have an unknown outcome and stay blocked.
begin;
alter table public.daily_digest_deliveries
  add column if not exists claim_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists telegram_message_id bigint;

alter table public.daily_digest_deliveries
  drop constraint if exists daily_digest_deliveries_status_allowed;
alter table public.daily_digest_deliveries
  add constraint daily_digest_deliveries_status_allowed
  check (status in ('preparing','sending','sent','retry','uncertain'));

revoke all on public.daily_digest_deliveries from anon, authenticated;
grant select,insert,update on public.daily_digest_deliveries to service_role;
grant select on public.profiles to service_role;

create or replace function public.claim_daily_digest_delivery(
  p_user_id uuid, p_local_date date, p_chat_id bigint
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  new_token uuid := gen_random_uuid();
  acquired_token uuid;
begin
  -- Service credentials alone do not authorize an arbitrary chat for a user.
  if p_local_date is null or not exists (
    select 1 from public.profiles
    where user_id=p_user_id and telegram_user_id=p_chat_id and status='active'
  ) then return null; end if;

  insert into public.daily_digest_deliveries(
    user_id,local_date,telegram_chat_id,status,claim_token,lease_expires_at,attempt_count
  ) values (
    p_user_id,p_local_date,p_chat_id,'preparing',new_token,clock_timestamp()+interval '5 minutes',1
  ) on conflict (user_id,local_date) do nothing
  returning claim_token into acquired_token;

  if acquired_token is not null then return acquired_token; end if;

  -- The UPDATE predicate is rechecked after acquiring the row lock, so only
  -- one concurrent worker can reclaim a retry/expired preparation.
  update public.daily_digest_deliveries
  set status='preparing',claim_token=new_token,telegram_chat_id=p_chat_id,
      lease_expires_at=clock_timestamp()+interval '5 minutes',attempt_count=attempt_count+1
  where user_id=p_user_id and local_date=p_local_date
    and (status='retry' or (status='preparing' and lease_expires_at<clock_timestamp()))
  returning claim_token into acquired_token;
  return acquired_token;
end $$;

create or replace function public.start_daily_digest_delivery(
  p_user_id uuid, p_local_date date, p_claim_token uuid
) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  update public.daily_digest_deliveries d set status='sending',lease_expires_at=null
  where d.user_id=p_user_id and d.local_date=p_local_date and d.claim_token=p_claim_token
    and d.status='preparing' and d.lease_expires_at>=clock_timestamp()
    and exists (select 1 from public.profiles p
                where p.user_id=d.user_id and p.telegram_user_id=d.telegram_chat_id and p.status='active');
  return found;
end $$;

create or replace function public.complete_daily_digest_delivery(
  p_user_id uuid, p_local_date date, p_claim_token uuid, p_message_id bigint
) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  if p_message_id is null or p_message_id<=0 then return false; end if;
  update public.daily_digest_deliveries
  set status='sent',sent_at=coalesce(sent_at,clock_timestamp()),
      telegram_message_id=p_message_id,lease_expires_at=null
  where user_id=p_user_id and local_date=p_local_date and claim_token=p_claim_token
    and status in ('sending','uncertain','sent')
    and (telegram_message_id is null or telegram_message_id=p_message_id);
  return found;
end $$;

create or replace function public.release_daily_digest_delivery(
  p_user_id uuid, p_local_date date, p_claim_token uuid, p_outcome text
) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  if p_outcome is null or p_outcome not in ('retry','uncertain') then return false; end if;
  update public.daily_digest_deliveries
  set status=p_outcome,lease_expires_at=null
  where user_id=p_user_id and local_date=p_local_date and claim_token=p_claim_token
    and ((p_outcome='retry' and status in ('preparing','sending'))
         or (p_outcome='uncertain' and status in ('sending','uncertain')));
  return found;
end $$;

revoke all on function public.claim_daily_digest_delivery(uuid,date,bigint) from public,anon,authenticated;
revoke all on function public.start_daily_digest_delivery(uuid,date,uuid) from public,anon,authenticated;
revoke all on function public.complete_daily_digest_delivery(uuid,date,uuid,bigint) from public,anon,authenticated;
revoke all on function public.release_daily_digest_delivery(uuid,date,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_daily_digest_delivery(uuid,date,bigint) to service_role;
grant execute on function public.start_daily_digest_delivery(uuid,date,uuid) to service_role;
grant execute on function public.complete_daily_digest_delivery(uuid,date,uuid,bigint) to service_role;
grant execute on function public.release_daily_digest_delivery(uuid,date,uuid,text) to service_role;

comment on function public.claim_daily_digest_delivery(uuid,date,bigint) is
  'Worker-only atomic daily claim; repeats return NULL, preparation lease can recover, outbound/legacy claims never auto-resend.';

notify pgrst, 'reload schema';

commit;
