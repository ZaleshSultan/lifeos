begin;
set local statement_timeout='45s';
set local lock_timeout='40s';
set local application_name='lifeos_obsidian_race_old';
set local role service_role;
-- The other transaction must hold the live claim's row lock before this ACK
-- captures its statement snapshot. Its DO barrier begins only after that lock.
do $old_ack_gate$
declare v_ready boolean:=false;
begin
  for i in 1..1200 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='lifeos_obsidian_race_recover' and state='active' and query like '%obsidian_wait_for_old_ack%') then
      v_ready:=true;
      exit;
    end if;
    perform pg_sleep(0.025);
  end loop;
  if not v_ready then raise exception 'Recovery transaction did not reach row-lock barrier'; end if;
end;
$old_ack_gate$;
insert into obsidian_test.race_results(actor,acknowledged)
  select 'old',public.complete_obsidian_sync_job(id,user_id,old_token,repeat('a',64),old_revision) from obsidian_test.expiry_race;
commit;
