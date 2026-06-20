create or replace function public.claim_due_reminders(
  p_before timestamptz,
  p_limit integer default 20
)
returns setof public.reminders
language sql
security definer
set search_path = public
as $$
  with due as (
    select id
    from public.reminders
    where status = 'pending'
      and channel = 'telegram'
      and remind_at <= p_before
    order by remind_at asc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ), claimed as (
    update public.reminders r
    set
      status = 'processing',
      claimed_at = now(),
      updated_at = now()
    from due
    where r.id = due.id
    returning r.*
  )
  select *
  from claimed
  order by remind_at asc;
$$;

revoke all on function public.claim_due_reminders(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(timestamptz, integer) to service_role;

comment on function public.claim_due_reminders(timestamptz, integer) is
  'Atomically claims due Telegram reminders with FOR UPDATE SKIP LOCKED so parallel reminder workers do not send duplicates.';
