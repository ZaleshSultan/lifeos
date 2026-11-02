select notification_test.assert((select count(*)=8 and count(*) filter(where result)=1 from notification_test.job_enqueues),'eight concurrent daily job writers produce one enqueue');
select notification_test.assert((select count(*)=1 from public.daily_life_notification_jobs where user_id='00000000-0000-4000-8000-000000000004'),'daily job unique key survives concurrent enqueue');
select notification_test.assert((select relrowsecurity from pg_class where oid='public.daily_life_notification_jobs'::regclass),'daily notification job RLS enabled');
select notification_test.assert(not has_table_privilege('authenticated','public.daily_life_notification_jobs','SELECT'),'browser cannot read private queued job bindings');
select notification_test.assert(not has_table_privilege('authenticated','public.daily_life_notification_jobs','INSERT'),'browser cannot enqueue daily jobs directly');

set role service_role;
do $$
declare u uuid:='00000000-0000-4000-8000-000000000004'; d date:=(clock_timestamp() at time zone 'UTC')::date;
 r public.reminders; legacy public.daily_digest_deliveries; n integer;
begin
 perform notification_test.assert((select count(*)=0 from public.claim_daily_life_digest('00000000-0000-4000-8000-000000000003',d,1)),'missing preferences deny morning claim');
 perform notification_test.assert(not public.enqueue_daily_life_notification('00000000-0000-4000-8000-000000000003',d,'evening',1,'synthetic',clock_timestamp()),'missing preferences deny optional jobs');
 perform notification_test.assert((select count(*)=0 from public.claim_daily_life_digest('00000000-0000-4000-8000-000000000005',d,1)),'default OFF denies morning claim');
 perform notification_test.assert(not public.enqueue_daily_life_notification('00000000-0000-4000-8000-000000000005',d,'hydration_1',1,'synthetic',clock_timestamp()),'default OFF denies hydration job');
 select * into legacy from public.claim_daily_digest('00000000-0000-4000-8000-000000000003',d);
 perform notification_test.assert(legacy.id is not null,'legacy worker claim fixture can be prepared');
 perform notification_test.assert(public.begin_notification_delivery('digest',legacy.user_id,legacy.id,legacy.claim_token) is null,'legacy unbound worker cannot send without consent');
 perform notification_test.assert((select status='cancelled' and delivery_attempts=0 from public.daily_digest_deliveries where id=legacy.id),'denied legacy claim consumes no send attempt');
 perform notification_test.assert(not public.daily_life_notification_allowed(u,'morning','infinity'::timestamptz,1),'infinite scheduling time denied');
 perform notification_test.assert(not public.daily_life_notification_allowed(u,'unknown',clock_timestamp(),1),'unknown notification kind denied');
 perform notification_test.assert(not public.daily_life_notification_allowed(u,'morning',clock_timestamp(),2),'stale preferences revision denied');
 perform notification_test.assert(not public.enqueue_daily_life_notification(u,d,'evening',1,'replacement',clock_timestamp()),'restart does not duplicate queued evening');
 perform notification_test.assert(public.enqueue_daily_life_notification(u,d,'hydration_1',1,'gentle one',clock_timestamp()),'first optional hydration slot queued');
 perform notification_test.assert(public.enqueue_daily_life_notification(u,d,'hydration_2',1,'gentle two',clock_timestamp()),'second optional hydration slot queued');
 begin
  perform public.enqueue_daily_life_notification(u,d,'hydration_3',1,'never',clock_timestamp());
  raise exception 'Expected invalid kind';
 exception when sqlstate '22023' then null; end;
 perform notification_test.assert((select count(*)=2 from public.daily_life_notification_jobs where user_id=u and kind like 'hydration_%'),'no third hydration reminder slot exists');
 select * into r from public.claim_due_reminders(clock_timestamp(),100) where id=(select reminder_id from public.daily_life_notification_jobs where user_id=u and kind='evening');
 perform notification_test.assert(r.id is not null,'daily evening uses existing reminder lease claim');
 perform notification_test.assert(public.begin_notification_delivery('reminder','00000000-0000-4000-8000-000000000005',r.id,r.claim_token) is null,'daily job cannot send to another owner');
 perform notification_test.assert(public.begin_notification_delivery('reminder',u,r.id,r.claim_token)=104,'consented daily evening crosses existing send fence');
 perform notification_test.assert(public.finish_notification_delivery('reminder',u,r.id,r.claim_token,'sent','none',1004),'daily evening acknowledgement persisted');
 update public.daily_life_preferences set revision=2 where user_id=u;
 perform notification_test.assert((select count(*)=2 from public.reminders reminder_row join public.daily_life_notification_jobs j on j.reminder_id=reminder_row.id where j.user_id=u and j.kind like 'hydration_%' and reminder_row.status='cancelled' and delivery_attempts=0),'preferences change cancels pending and prepared hydration jobs');
 perform notification_test.assert(not public.enqueue_daily_life_notification(u,d,'evening',2,'never resend',clock_timestamp()),'changed preferences do not resend confirmed evening');
 perform notification_test.assert(public.enqueue_daily_life_notification(u,d,'hydration_1',2,'reconfigured gentle one',clock_timestamp()),'explicit changed preferences may replace never-attempted canceled job');
 select * into r from public.claim_due_reminders(clock_timestamp(),100) where id=(select reminder_id from public.daily_life_notification_jobs where user_id=u and kind='hydration_1');
 update public.daily_life_preferences set revision=3,preferences=jsonb_set(preferences,'{hydrationRemindersEnabled}','false') where user_id=u;
 perform notification_test.assert(public.begin_notification_delivery('reminder',u,r.id,r.claim_token) is null,'revoked opt-in blocks previously prepared hydration send');
 perform notification_test.assert((select status='cancelled' and delivery_attempts=0 from public.reminders where id=r.id),'revocation preserves zero attempts');
 perform notification_test.assert(not public.enqueue_daily_life_notification(u,d,'hydration_2',2,'stale worker',clock_timestamp()),'old worker snapshot cannot enqueue after revocation');
 update public.daily_life_preferences set revision=4,preferences=jsonb_set(preferences,'{hydrationRemindersEnabled}','true') where user_id=u;
 perform notification_test.assert(public.enqueue_daily_life_notification(u,d,'hydration_2',4,'new consent',clock_timestamp()),'new explicit consent can reconfigure unsent slot');
 update public.profiles set timezone='Asia/Almaty' where user_id=u;
 perform notification_test.assert((select reminder_row.status='cancelled' from public.reminders reminder_row join public.daily_life_notification_jobs j on j.reminder_id=reminder_row.id where j.user_id=u and j.kind='hydration_2'),'timezone changes cancel stale queued slots');
 update public.profiles set timezone='Invalid/Zone' where user_id=u;
 perform notification_test.assert((select count(*)=0 from public.claim_daily_life_digest(u,d,4)),'invalid timezone fails closed without SQL error');
 perform notification_test.assert(not public.enqueue_daily_life_notification(u,d,'hydration_2',4,'invalid zone',clock_timestamp()),'invalid timezone cannot queue optional notification');
 update public.profiles set timezone='UTC' where user_id=u;
 -- A fixed date/time makes the quiet check independent of test execution hour.
 update public.daily_life_preferences set revision=5,preferences=jsonb_set(jsonb_set(preferences,'{quietStart}','"22:00"'),'{quietEnd}','"07:00"') where user_id=u;
 perform notification_test.assert(not public.daily_life_notification_allowed(u,'morning','2026-11-03T23:00:00Z',5),'overnight quiet hours block late notification');
 perform notification_test.assert(public.daily_life_notification_allowed(u,'morning','2026-11-03T08:00:00Z',5),'awake local time permits opted-in notification');
 update public.daily_life_preferences set revision=6,preferences=jsonb_set(jsonb_set(preferences,'{quietStart}','"12:00"'),'{quietEnd}','"14:00"') where user_id=u;
 perform notification_test.assert(not public.daily_life_notification_allowed(u,'evening','2026-11-03T13:00:00Z',6),'daytime quiet window is respected');
 perform notification_test.assert(not public.enqueue_daily_life_notification(u,d-1,'evening',6,'past date',clock_timestamp()),'notification cannot queue for another local day');
end;$$;
reset role;

-- The existing browser profile grant must keep working after the new trigger.
-- Queue tables remain inaccessible and the trigger can only cancel its row owner.
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000006'),
 ('00000000-0000-4000-8000-000000000007');
insert into public.profiles(user_id,status,role,telegram_user_id,timezone) values
 ('00000000-0000-4000-8000-000000000006','active','user',106,'UTC'),
 ('00000000-0000-4000-8000-000000000007','active','user',107,'UTC');
insert into public.daily_life_preferences(user_id,preferences)
select user_id,'{"morningEnabled":true,"morningTime":"08:00","eveningEnabled":true,"eveningTime":"21:00","quietStart":"00:00","quietEnd":"00:00","hydrationRemindersEnabled":true,"includeHealth":false,"includeFilming":false}'::jsonb
from public.profiles where user_id in ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000007');
select notification_test.assert(public.enqueue_daily_life_notification(user_id,(clock_timestamp() at time zone 'UTC')::date,'hydration_1',1,'owner-scoped timezone fixture',clock_timestamp()),'timezone fixture queued '||telegram_user_id)
from public.profiles where user_id in ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000007');
set role authenticated;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000006';
set request.jwt.claim.role='authenticated';
do $$declare n integer;begin
 update public.profiles set timezone='Asia/Almaty' where user_id='00000000-0000-4000-8000-000000000006';
 get diagnostics n=row_count;
 if n<>1 then raise exception 'Owner timezone update did not persist';end if;
 update public.profiles set timezone='Asia/Almaty' where user_id='00000000-0000-4000-8000-000000000007';
 get diagnostics n=row_count;
 if n<>0 then raise exception 'Foreign timezone update bypassed RLS';end if;
 begin
  update public.profiles set status='blocked' where user_id='00000000-0000-4000-8000-000000000006';
  raise exception 'Owner gained protected profile update';
 exception when insufficient_privilege then null;end;
end;$$;
reset role;
set request.jwt.claim.sub='';
set request.jwt.claim.role='';
select notification_test.assert((select timezone='Asia/Almaty' and status='active' from public.profiles where user_id='00000000-0000-4000-8000-000000000006'),'authenticated owner timezone grant remains usable');
select notification_test.assert((select timezone='UTC' from public.profiles where user_id='00000000-0000-4000-8000-000000000007'),'profile RLS still rejects foreign timezone change');
select notification_test.assert((select r.status='cancelled' from public.reminders r join public.daily_life_notification_jobs j on j.reminder_id=r.id where j.user_id='00000000-0000-4000-8000-000000000006'),'owner timezone update cancels own queued notification');
select notification_test.assert((select r.status='pending' from public.reminders r join public.daily_life_notification_jobs j on j.reminder_id=r.id where j.user_id='00000000-0000-4000-8000-000000000007'),'owner timezone update preserves foreign queued notification');
select notification_test.assert(not has_function_privilege('authenticated','public.cancel_changed_daily_life_notifications()','EXECUTE'),'browser cannot invoke privileged cancellation trigger');
select notification_test.assert(not has_table_privilege('authenticated','public.daily_life_notification_jobs','SELECT,UPDATE'),'browser gains no private queue access');
