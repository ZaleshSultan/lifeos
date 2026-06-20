-- Single-user LifeOS bootstrap.
--
-- Replace the placeholder UUID and Telegram id before running.
-- The profile row references auth.users(id), so the auth user must exist first.

insert into public.profiles (
  user_id,
  telegram_user_id,
  display_name,
  timezone,
  locale,
  status,
  role
)
values (
  '00000000-0000-0000-0000-000000000000',
  123456789,
  'LifeOS User',
  'Asia/Qyzylorda',
  'en',
  'active',
  'admin'
)
on conflict (user_id) do update set
  telegram_user_id = excluded.telegram_user_id,
  display_name = coalesce(public.profiles.display_name, excluded.display_name),
  timezone = excluded.timezone,
  locale = excluded.locale,
  status = excluded.status,
  role = excluded.role,
  updated_at = now();
