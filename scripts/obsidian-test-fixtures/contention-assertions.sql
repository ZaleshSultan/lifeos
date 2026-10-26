select obsidian_test.assert((select count(*)=2 from obsidian_test.claims where stage='contention'),'same-note contention has one winner for each vault');
select obsidian_test.assert((select count(*)=count(distinct id) from obsidian_test.claims where stage='contention'),'same-note contention never duplicates a job claim');
select obsidian_test.assert((select count(*)=count(distinct claim_token) from obsidian_test.claims where stage='contention'),'same-note claim ownership tokens remain unique');
select obsidian_test.assert(not exists(select 1 from public.obsidian_sync_queue where status='processing' group by user_id having count(*)>1),'no user vault admits two active writers');
select obsidian_test.assert((select count(distinct q.user_id)=2 from obsidian_test.claims c join public.obsidian_sync_queue q using(id) where c.stage='contention'),'same-note contention preserves cross-user independence');
select obsidian_test.assert((select count(*)=14 from public.obsidian_sync_queue where life_entity_id in ('00000000-0000-4000-8000-000000005001','00000000-0000-4000-8000-000000005002') and status='pending'),'unclaimed duplicate jobs stay pending without lost history');
select obsidian_test.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.obsidian_managed_notes'::regclass),'managed-note ledger retains forced RLS');
select obsidian_test.assert((select count(*)=1 from public.obsidian_sync_queue where id='00000000-0000-4000-8000-000000004002' and status='completed' and completed_at='2000-01-02T00:00:00Z'),'complete lifecycle tests preserve legacy completed record');

set role service_role;
select obsidian_test.cancel_jobs();
do $$
declare r public.obsidian_sync_queue; p jsonb;
begin
  r:=obsidian_test.claim('expired-claim-race');
  p:=public.prepare_obsidian_sync_job(r.id,r.user_id,r.claim_token,'LifeOS/Captures/' || r.life_entity_id || '.md',repeat('a',64),null);
  insert into obsidian_test.expiry_race(id,user_id,old_token,old_revision) values(r.id,r.user_id,r.claim_token,(p->>'revision')::bigint);
end;
$$;
reset role;
