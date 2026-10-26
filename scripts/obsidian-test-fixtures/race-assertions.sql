select obsidian_test.assert((select acknowledged is false from obsidian_test.race_results where actor='old') and (select new_token is not null and new_token<>old_token from obsidian_test.expiry_race),'expired old acknowledgement loses to concurrent recovery and fresh claim');
select obsidian_test.assert((select acknowledged from obsidian_test.race_results where actor='waiter_seen'),'old ACK actually waits on the live claim before concurrent expiry and replacement');
select obsidian_test.assert((select q.status='processing' and q.claim_token=r.new_token and q.attempts=2 from public.obsidian_sync_queue q join obsidian_test.expiry_race r on r.id=q.id),'concurrent old worker cannot change new ownership or attempt history');
set role service_role;
select obsidian_test.assert((select not public.renew_obsidian_sync_claim(id,user_id,old_token) from obsidian_test.expiry_race),'concurrent recovery leaves old renewal permanently invalid');
select obsidian_test.assert((select public.renew_obsidian_sync_claim(id,user_id,new_token) from obsidian_test.expiry_race),'concurrent recovery leaves new renewal valid');
reset role;
