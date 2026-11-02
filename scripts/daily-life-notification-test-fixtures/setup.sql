-- Purely synthetic owners in the disposable database; no user opts in implicitly.
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000003'),
 ('00000000-0000-4000-8000-000000000004'),
 ('00000000-0000-4000-8000-000000000005');
insert into public.profiles(user_id,status,role,telegram_user_id,timezone) values
 ('00000000-0000-4000-8000-000000000003','active','user',103,'UTC'),
 ('00000000-0000-4000-8000-000000000004','active','user',104,'UTC'),
 ('00000000-0000-4000-8000-000000000005','active','user',105,'UTC');
insert into public.daily_life_preferences(user_id,preferences) values
 ('00000000-0000-4000-8000-000000000004','{"morningEnabled":true,"morningTime":"08:00","eveningEnabled":true,"eveningTime":"21:00","quietStart":"00:00","quietEnd":"00:00","hydrationRemindersEnabled":true,"includeHealth":false,"includeFilming":true}'),
 ('00000000-0000-4000-8000-000000000005','{"morningEnabled":false,"morningTime":"08:00","eveningEnabled":false,"eveningTime":"21:00","quietStart":"22:00","quietEnd":"07:00","hydrationRemindersEnabled":false,"includeHealth":false,"includeFilming":true}');
create table notification_test.job_enqueues(worker integer,result boolean);
grant select,insert on notification_test.job_enqueues to service_role;
