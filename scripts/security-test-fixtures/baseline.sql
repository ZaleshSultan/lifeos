insert into auth.users values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
insert into public.profiles(user_id,status,role,telegram_user_id) values
('00000000-0000-4000-8000-000000000001','blocked','user',101),
('00000000-0000-4000-8000-000000000002','active','user',102);
-- Reproduce the pre-migration flaw under realistic authenticated defaults.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
set request.jwt.claim.role = 'authenticated';
update public.profiles set role='admin',status='active',telegram_user_id=103,metadata='{"admin":true}' where user_id=auth.uid();
do $$ begin
  assert (select role='admin' and status='active' and telegram_user_id=103 from public.profiles where user_id=auth.uid()), 'baseline exploit not reproduced';
end $$;
reset role;
update public.profiles set role='user',status='blocked',telegram_user_id=101,metadata='{}' where user_id='00000000-0000-4000-8000-000000000001';
