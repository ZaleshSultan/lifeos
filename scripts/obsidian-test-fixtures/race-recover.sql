begin;
set local statement_timeout='45s';
set local lock_timeout='40s';
set local application_name='lifeos_obsidian_race_recover';
set local role service_role;
select q.id from public.obsidian_sync_queue q join obsidian_test.expiry_race r using(id) for update of q;
-- Prove the old ACK has begun with the original live claim and is actually
-- blocked on this row. Expiry/recovery/reclaim happen only after that proof.
do $obsidian_wait_for_old_ack$
declare v_waiting boolean:=false;
begin
  for i in 1..1200 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='lifeos_obsidian_race_old' and wait_event_type='Lock') then
      v_waiting:=true;
      exit;
    end if;
    perform pg_sleep(0.025);
  end loop;
  if not v_waiting then raise exception 'Old ACK never waited on the held live claim'; end if;
  insert into obsidian_test.race_results(actor,acknowledged) values('waiter_seen',true);
end;
$obsidian_wait_for_old_ack$;
update public.obsidian_sync_queue set lease_expires_at=clock_timestamp()-interval '1 second' where id=(select id from obsidian_test.expiry_race);
select public.recover_obsidian_sync_jobs();
update public.obsidian_sync_queue set available_at=clock_timestamp()-interval '1 second' where id=(select id from obsidian_test.expiry_race);
with claimed as (select id,claim_token from public.claim_obsidian_sync_jobs(1))
  update obsidian_test.expiry_race r set new_token=c.claim_token from claimed c where c.id=r.id;
commit;
