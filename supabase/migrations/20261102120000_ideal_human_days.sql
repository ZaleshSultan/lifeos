-- Additive Ideal Human persistence. Keeps legacy settings and all workout/LMS data.
begin;

create table public.ideal_human_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null check (date between date '2026-11-03' and date '2026-12-02'),
  entry jsonb not null check (
    jsonb_typeof(entry) = 'object'
    and entry ? 'date'
    and jsonb_typeof(entry -> 'date') = 'string'
    and entry ->> 'date' = date::text
    and not entry ? 'revision'
    and octet_length(entry::text) <= 131072
  ),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, date)
);
alter table public.ideal_human_days enable row level security;
-- No browser table/RPC access, even in projects with permissive default grants.
revoke all on public.ideal_human_days from public, anon, authenticated, service_role;
grant select, insert, update on public.ideal_human_days to service_role;

-- Copy only structurally recognizable records. Original JSON is retained intact,
-- including unrecognized entries, for safe investigation/recovery. No existing row
-- is overwritten, and the database remains authoritative after the transition.
insert into public.ideal_human_days(user_id, date, entry)
select s.user_id, e.key::date, e.value - 'revision'
from public.user_settings s
cross join lateral jsonb_each(
  case when jsonb_typeof(s.settings -> 'ideal_human_days') = 'object'
       then s.settings -> 'ideal_human_days' else '{}'::jsonb end
) as e
where e.key ~ '^(2026-11-(0[3-9]|[12][0-9]|30)|2026-12-0[12])$'
  and jsonb_typeof(e.value) = 'object'
  and e.value ->> 'date' = e.key
  and octet_length(e.value::text) <= 131072
on conflict (user_id, date) do nothing;

create function public.save_ideal_human_day(
  p_user_id uuid,
  p_date date,
  p_entry jsonb,
  p_expected_revision integer
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_current public.ideal_human_days%rowtype;
  v_saved public.ideal_human_days%rowtype;
begin
  if p_expected_revision is null or p_expected_revision < 0 or p_expected_revision >= 2147483647
    or p_date is null or p_date < date '2026-11-03' or p_date > date '2026-12-02'
    or p_entry is null or jsonb_typeof(p_entry) <> 'object'
    or not p_entry ? 'date' or jsonb_typeof(p_entry -> 'date') <> 'string'
    or p_entry ->> 'date' <> p_date::text or p_entry ? 'revision'
    or octet_length(p_entry::text) > 131072 then
    raise exception using errcode = '22023', message = 'invalid_ideal_human_day';
  end if;

  -- Serializes creation of a missing day and profile blocking without advisory
  -- lock hash collisions. A block committed before this lock rejects the write.
  perform 1 from public.profiles where user_id = p_user_id and status = 'active' for update;
  if not found then
    raise exception using errcode = '42501', message = 'ideal_human_profile_inactive';
  end if;
  select * into v_current from public.ideal_human_days
    where user_id = p_user_id and date = p_date for update;
  if found then
    -- A response can be lost after commit. Exact retries return the stored
    -- revision without another write or an artificial conflict.
    if p_expected_revision < v_current.revision and v_current.entry = p_entry then
      return v_current.entry || jsonb_build_object('revision', v_current.revision);
    end if;
    if v_current.revision <> p_expected_revision then
      raise exception using errcode = 'P0001', message = 'ideal_human_conflict';
    end if;
    update public.ideal_human_days
      set entry = p_entry, revision = revision + 1, updated_at = clock_timestamp()
      where user_id = p_user_id and date = p_date returning * into v_saved;
  else
    if p_expected_revision <> 0 then
      raise exception using errcode = 'P0001', message = 'ideal_human_conflict';
    end if;
    insert into public.ideal_human_days(user_id, date, entry)
      values (p_user_id, p_date, p_entry) returning * into v_saved;
  end if;
  return v_saved.entry || jsonb_build_object('revision', v_saved.revision);
end;
$$;
revoke all on function public.save_ideal_human_day(uuid, date, jsonb, integer) from public, anon, authenticated;
grant execute on function public.save_ideal_human_day(uuid, date, jsonb, integer) to service_role;
comment on table public.ideal_human_days is 'Private experiment journal and editable plans; legacy settings retained. Rollback disables feature; never drop observed data.';

commit;
