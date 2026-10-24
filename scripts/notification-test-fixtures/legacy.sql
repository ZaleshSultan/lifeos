-- Existing rows are seeded before the additive migration, never reset by it.
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');
insert into public.profiles(user_id,status,role,telegram_user_id,timezone) values
  ('00000000-0000-4000-8000-000000000001','active','user',101,'America/New_York'),
  ('00000000-0000-4000-8000-000000000002','active','user',102,'Asia/Almaty');
insert into public.reminders(id,user_id,channel,remind_at,message,status,claimed_at)
values('00000000-0000-4000-8000-000000001001','00000000-0000-4000-8000-000000000001',
       'telegram','2000-01-01T00:00:00Z','synthetic legacy fixture','processing','2000-01-01T00:00:00Z');
insert into public.daily_digest_deliveries(id,user_id,local_date,telegram_chat_id,status,sent_at)
values
  ('00000000-0000-4000-8000-000000002001','00000000-0000-4000-8000-000000000001','2000-01-01',101,'sending',null),
  ('00000000-0000-4000-8000-000000002002','00000000-0000-4000-8000-000000000002','2000-01-01',102,'sent','2000-01-01T06:00:00Z');
