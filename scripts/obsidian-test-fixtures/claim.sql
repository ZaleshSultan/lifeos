begin;
set local statement_timeout='10s';
set local lock_timeout='5s';
set local role service_role;
insert into obsidian_test.claims(stage,worker,id,claim_token)
  select :'stage',:worker,id,claim_token from public.claim_obsidian_sync_jobs(3);
select pg_sleep(0.25);
commit;
