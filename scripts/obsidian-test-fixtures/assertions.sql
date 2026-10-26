-- These assertions follow real overlapping transactions, not sequential mocks.
select obsidian_test.assert((select count(*)>=2 from obsidian_test.claims where stage='independent'),'independent users can both claim work');
select obsidian_test.assert((select count(*)=2 from obsidian_test.claims where stage='independent'),'per-vault claim lease permits only one winner for each user');
select obsidian_test.assert((select count(*)=count(distinct id) from obsidian_test.claims where stage='independent'),'competing workers never claim the same job');
select obsidian_test.assert((select count(*)=count(distinct claim_token) from obsidian_test.claims where stage='independent'),'every claim has distinct ownership');
select obsidian_test.assert(not exists(select 1 from obsidian_test.claims c join public.obsidian_sync_queue q using(id) where c.stage='independent' and (q.status<>'processing' or q.lease_expires_at<=clock_timestamp() or q.claim_token is distinct from c.claim_token)),'all claimed jobs have durable live leases');
select obsidian_test.assert((select count(distinct q.user_id)=2 from obsidian_test.claims c join public.obsidian_sync_queue q using(id) where c.stage='independent'),'independent claims do not starve a second user');
select obsidian_test.assert((select status::text not in ('pending','processing','retry') and attempts=2 from public.obsidian_sync_queue where id='00000000-0000-4000-8000-000000004001'),'migration quarantines ambiguous legacy processing without resetting attempts');
select obsidian_test.assert((select status='completed' and attempts=1 and completed_at='2000-01-02T00:00:00Z' from public.obsidian_sync_queue where id='00000000-0000-4000-8000-000000004002'),'migration preserves confirmed completed history');
select obsidian_test.assert((select status='failed' and attempts=4 from public.obsidian_sync_queue where id='00000000-0000-4000-8000-000000004003'),'migration preserves existing failed history and retry count');
select obsidian_test.assert((select status='cancelled' and attempts=0 from public.obsidian_sync_queue where id='00000000-0000-4000-8000-000000004004'),'migration preserves cancelled history');
select obsidian_test.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.obsidian_sync_queue'::regclass),'queue retains forced RLS');

do $$
declare v_role text; v_function record;
begin
  foreach v_role in array array['anon','authenticated'] loop
    for v_function in
      select p.oid,p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like '%obsidian%'
    loop
      perform obsidian_test.assert(not has_function_privilege(v_role,v_function.oid,'EXECUTE'),v_role || ' cannot execute ' || v_function.signature::text);
      perform obsidian_test.assert(has_function_privilege('service_role',v_function.oid,'EXECUTE'),'service role can execute ' || v_function.signature::text || ' checked for ' || v_role);
    end loop;
  end loop;
end;
$$;

set role authenticated;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set request.jwt.claim.role='authenticated';
select obsidian_test.denied($q$update public.obsidian_sync_queue set status='completed' where user_id=auth.uid()$q$,'browser cannot bypass claim lifecycle for own jobs');
select obsidian_test.denied($q$update public.obsidian_sync_queue set status='completed' where user_id<>'00000000-0000-4000-8000-000000000001'$q$,'browser cannot bypass claim lifecycle for another user');
select obsidian_test.denied('truncate public.obsidian_sync_queue','browser cannot truncate sync history');
select obsidian_test.denied('select public.claim_obsidian_sync_jobs(1)','browser cannot invoke claim RPC');
select obsidian_test.denied('select * from public.obsidian_managed_notes','browser cannot read managed-note ledger');
select obsidian_test.denied($q$insert into public.obsidian_managed_notes(user_id,note_key,relative_path) values(auth.uid(),'forged','LifeOS/forged.md')$q$,'browser cannot create managed-note ownership');
select obsidian_test.denied($q$update public.obsidian_managed_notes set applied_content_hash=repeat('a',64)$q$,'browser cannot forge applied content');
select obsidian_test.assert(not exists(select 1 from public.obsidian_sync_queue where user_id<>auth.uid()),'queue SELECT remains isolated to authenticated owner');
select public.create_life_entity_with_sync(auth.uid(),'capture','synthetic compatible trusted creation RPC');
select obsidian_test.assert(exists(select 1 from public.obsidian_sync_queue where life_entity_id=(select id from public.life_entities where title='synthetic compatible trusted creation RPC')),'existing authenticated creation RPC still atomically enqueues');
reset role;

set role service_role;
select obsidian_test.cancel_jobs();

do $$
declare r public.obsidian_sync_queue; v_entity uuid; v_path text; p jsonb; v_revision bigint; v_hash_a text:=repeat('a',64); v_hash_b text:=repeat('b',64);
begin
  r:=obsidian_test.claim('normal');
  v_entity:=r.life_entity_id;
  v_path:='LifeOS/Captures/' || v_entity || '.md';
  perform obsidian_test.assert(r.attempts=1 and r.claim_token is not null and r.lease_expires_at>clock_timestamp(),'normal claim persists its first attempt and lease');
  perform obsidian_test.assert(public.get_obsidian_note_state(r.id,r.user_id,r.claim_token) is null,'new managed note has no preexisting ledger');
  perform obsidian_test.claim_lost(format('select public.get_obsidian_note_state(%L,%L,%L)',r.id,'00000000-0000-4000-8000-000000000002',r.claim_token),'cross-user ledger read rejected');
  perform obsidian_test.claim_lost(format('select public.prepare_obsidian_sync_job(%L,%L,%L,%L,%L,null)',r.id,'00000000-0000-4000-8000-000000000002',r.claim_token,v_path,v_hash_a),'cross-user preparation rejected');
  perform obsidian_test.assert(not public.complete_obsidian_sync_job(r.id,'00000000-0000-4000-8000-000000000002',r.claim_token,v_hash_a,1),'cross-user acknowledgement rejected');
  perform obsidian_test.assert(not public.renew_obsidian_sync_claim(r.id,'00000000-0000-4000-8000-000000000002',r.claim_token),'cross-user renewal rejected');
  perform obsidian_test.assert(not public.finish_obsidian_sync_job(r.id,'00000000-0000-4000-8000-000000000002',r.claim_token,'io_error',true),'cross-user failure transition rejected');
  perform obsidian_test.assert(not public.renew_obsidian_sync_claim(r.id,r.user_id,gen_random_uuid()),'unowned claim token cannot renew');
  perform obsidian_test.claim_lost(format('select public.prepare_obsidian_sync_job(%L,%L,%L,%L,%L,null)',r.id,r.user_id,gen_random_uuid(),v_path,v_hash_a),'unowned claim token cannot prepare');
  p:=public.prepare_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_path,v_hash_a,null);
  v_revision:=(p->>'revision')::bigint;
  perform obsidian_test.assert(p->>'conflict'='false' and p->>'pending_content_hash'=v_hash_a and v_revision=1,'prepare persists initial hash and revision before writing');
  perform obsidian_test.assert((select pending_content_hash=v_hash_a and pending_job_id=r.id and pending_claim_token=r.claim_token and applied_content_hash is null from public.obsidian_managed_notes where user_id=r.user_id and note_key=v_entity::text),'intent belongs to exact job and claim');
  perform obsidian_test.assert(public.renew_obsidian_sync_claim(r.id,r.user_id,r.claim_token),'owned live claim can extend its lease');
  perform obsidian_test.assert(not public.complete_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_hash_b,v_revision),'acknowledgement rejects a different content hash');
  perform obsidian_test.assert(not public.complete_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_hash_a,v_revision+1),'acknowledgement rejects a different revision');
  perform obsidian_test.assert(public.complete_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_hash_a,v_revision),'owned exact hash and revision complete successfully');
  perform obsidian_test.assert((select status='completed' and completed_at is not null from public.obsidian_sync_queue where id=r.id),'completion persists successful job history');
  perform obsidian_test.assert((select applied_content_hash=v_hash_a and applied_revision=v_revision from public.obsidian_managed_notes where user_id=r.user_id and note_key=v_entity::text),'completion advances applied hash and revision');
  perform obsidian_test.assert(not public.complete_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_hash_a,v_revision),'completed claim cannot acknowledge twice');
  perform obsidian_test.assert(not public.finish_obsidian_sync_job(r.id,r.user_id,r.claim_token,'io_error',true),'late failure cannot overwrite completed history');

  r:=obsidian_test.claim('idempotent',r.user_id,v_entity);
  p:=public.prepare_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_path,v_hash_a,v_hash_a);
  perform obsidian_test.assert(p->>'conflict'='false','same existing content may be prepared idempotently');
  perform obsidian_test.assert(public.complete_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_hash_a,(p->>'revision')::bigint),'same existing content can acknowledge');
  perform obsidian_test.assert((select count(*)=1 from public.obsidian_managed_notes where user_id=r.user_id and note_key=v_entity::text),'repeated synchronization retains one logical note');

  r:=obsidian_test.claim('new-revision',r.user_id,v_entity);
  p:=public.prepare_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_path,v_hash_b,v_hash_a);
  perform obsidian_test.assert(p->>'expected_content_hash'=v_hash_a and (p->>'revision')::bigint>v_revision,'managed update expects previous applied content and advances revision');
  perform obsidian_test.assert(public.complete_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_hash_b,(p->>'revision')::bigint),'managed update acknowledges the new content');

  r:=obsidian_test.claim('external-edit',r.user_id,v_entity);
  p:=public.prepare_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_path,repeat('c',64),repeat('d',64));
  perform obsidian_test.assert(p->>'conflict'='true' and p->>'error_code'='external_modification','unexpected external edit becomes explicit conflict');
  perform obsidian_test.assert(public.finish_obsidian_sync_job(r.id,r.user_id,r.claim_token,'external_modification',false,true),'owned worker persists a detected conflict');
  perform obsidian_test.assert((select status::text='conflict' from public.obsidian_sync_queue where id=r.id),'external edit is never scheduled for automatic overwrite');
  perform obsidian_test.assert((select applied_content_hash=v_hash_b from public.obsidian_managed_notes where user_id=r.user_id and note_key=v_entity::text),'external conflict preserves prior applied ledger');

  r:=obsidian_test.claim('missing-managed-file',r.user_id,v_entity);
  p:=public.prepare_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_path,repeat('c',64),null);
  perform obsidian_test.assert(p->>'conflict'='true','unexpected deletion of an applied note is a conflict');
  perform public.finish_obsidian_sync_job(r.id,r.user_id,r.claim_token,'external_modification',false,true);

  r:=obsidian_test.claim('same-path-different-owner','00000000-0000-4000-8000-000000000002');
  p:=public.prepare_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_path,v_hash_a,null);
  perform obsidian_test.assert(p->>'conflict'='false','different users may use the same relative path within separate vaults');
  perform obsidian_test.assert(public.complete_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_hash_a,(p->>'revision')::bigint),'second user acknowledges only its own ledger');
  perform obsidian_test.assert((select count(*)=2 from public.obsidian_managed_notes where relative_path=v_path),'same relative path keeps isolated per-user ledger records');
end;
$$;

do $$
declare r public.obsidian_sync_queue; p jsonb; v_entity uuid; v_old_token uuid; v_old_revision bigint; v_path text; v_id uuid; v_prepared text:=repeat('a',64); v_changed text:=repeat('b',64);
begin
  r:=obsidian_test.claim('rename-succeeded-ack-lost');
  v_id:=r.id; v_entity:=r.life_entity_id; v_old_token:=r.claim_token;
  v_path:='LifeOS/Captures/' || v_entity || '.md';
  p:=public.prepare_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_path,v_prepared,null);
  v_old_revision:=(p->>'revision')::bigint;
  update public.obsidian_sync_queue set lease_expires_at=clock_timestamp()-interval '1 second' where id=r.id;
  perform obsidian_test.assert(not public.complete_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_prepared,v_old_revision),'expired worker cannot acknowledge a successful rename');
  perform public.recover_obsidian_sync_jobs();
  perform obsidian_test.assert((select status::text='retry' and attempts=1 and available_at>clock_timestamp() from public.obsidian_sync_queue where id=v_id),'expired claim recovers with durable attempts and backoff');
  perform obsidian_test.assert((select pending_content_hash=v_prepared and revision=v_old_revision from public.obsidian_managed_notes where user_id=r.user_id and note_key=v_entity::text),'recovery retains unacknowledged filesystem intent');
  update public.obsidian_sync_queue set available_at=clock_timestamp()-interval '1 second' where id=v_id;
  select * into r from public.claim_obsidian_sync_jobs(1) where id=v_id;
  perform obsidian_test.assert(r.claim_token is not null and r.claim_token<>v_old_token and r.attempts=2,'restart gets a fresh claim without resetting attempt count');
  perform obsidian_test.claim_lost(format('select public.get_obsidian_note_state(%L,%L,%L)',r.id,r.user_id,v_old_token),'stale worker cannot inspect a newer claim');
  perform obsidian_test.assert(not public.renew_obsidian_sync_claim(r.id,r.user_id,v_old_token),'stale worker cannot extend a newer claim');
  perform obsidian_test.claim_lost(format('select public.prepare_obsidian_sync_job(%L,%L,%L,%L,%L,%L)',r.id,r.user_id,v_old_token,v_path,v_changed,v_prepared),'stale worker cannot replace newer intent');
  perform obsidian_test.assert(not public.finish_obsidian_sync_job(r.id,r.user_id,v_old_token,'io_error',true),'stale worker cannot fail a newer claim');
  p:=public.prepare_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_path,v_changed,v_prepared);
  perform obsidian_test.assert(p->>'conflict'='false' and (p->>'revision')::bigint>v_old_revision,'restart recognizes prior pending hash after lost acknowledgement');
  perform obsidian_test.assert(not public.complete_obsidian_sync_job(r.id,r.user_id,v_old_token,v_prepared,v_old_revision),'old acknowledgement cannot replace newer revision');
  perform obsidian_test.assert(public.complete_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_changed,(p->>'revision')::bigint),'restart safely acknowledges reconciled newer content');

  r:=obsidian_test.claim('crash-before-rename');
  v_id:=r.id; v_path:='LifeOS/Captures/' || r.life_entity_id || '.md';
  p:=public.prepare_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_path,v_prepared,null);
  update public.obsidian_sync_queue set lease_expires_at=clock_timestamp()-interval '1 second' where id=r.id;
  perform public.recover_obsidian_sync_jobs();
  update public.obsidian_sync_queue set available_at=clock_timestamp()-interval '1 second' where id=v_id;
  select * into r from public.claim_obsidian_sync_jobs(1) where id=v_id;
  p:=public.prepare_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_path,v_changed,null);
  perform obsidian_test.assert(p->>'conflict'='false','restart before rename accepts still-missing first destination');
  perform obsidian_test.assert(public.complete_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_changed,(p->>'revision')::bigint),'restart before rename can complete its new intent');
end;
$$;


do $$
declare r public.obsidian_sync_queue; v_id uuid; v_token uuid; v_attempt integer; v_seconds numeric; v_previous numeric:=0;
begin
  r:=obsidian_test.claim('bounded-retries');
  v_id:=r.id;
  for v_attempt in 1..5 loop
    v_token:=r.claim_token;
    perform obsidian_test.assert(r.attempts=v_attempt,'retry attempt ' || v_attempt || ' remains monotonic');
    perform obsidian_test.assert(public.finish_obsidian_sync_job(r.id,r.user_id,r.claim_token,'io_error',true),'retry attempt ' || v_attempt || ' persists its result');
    select extract(epoch from available_at-clock_timestamp()) into v_seconds from public.obsidian_sync_queue where id=v_id;
    if v_attempt<5 then
      perform obsidian_test.assert((select status::text='retry' from public.obsidian_sync_queue where id=v_id),'retry attempt ' || v_attempt || ' remains recoverable');
      perform obsidian_test.assert(v_seconds>=59 and v_seconds>v_previous,'retry attempt ' || v_attempt || ' uses increasing bounded backoff');
      perform obsidian_test.assert(not exists(select 1 from public.claim_obsidian_sync_jobs(1) where id=v_id),'retry attempt ' || v_attempt || ' cannot run before its backoff');
      v_previous:=v_seconds;
      update public.obsidian_sync_queue set available_at=clock_timestamp()-interval '1 second' where id=v_id;
      select * into r from public.claim_obsidian_sync_jobs(1) where id=v_id;
      perform obsidian_test.assert(r.claim_token is not null and r.claim_token<>v_token,'retry attempt ' || v_attempt || ' relinquishes previous token');
    end if;
  end loop;
  perform obsidian_test.assert((select status='failed' and attempts=5 from public.obsidian_sync_queue where id=v_id),'retry budget exhaustion becomes terminal failed');
  perform obsidian_test.assert(not exists(select 1 from public.claim_obsidian_sync_jobs(1) where id=v_id),'terminal retry exhaustion never automatically requeues');

  r:=obsidian_test.claim('repeated-worker-crash');
  v_id:=r.id;
  for v_attempt in 1..5 loop
    update public.obsidian_sync_queue set lease_expires_at=clock_timestamp()-interval '1 second' where id=v_id;
    perform public.recover_obsidian_sync_jobs();
    if v_attempt<5 then
      update public.obsidian_sync_queue set available_at=clock_timestamp()-interval '1 second' where id=v_id;
      select * into r from public.claim_obsidian_sync_jobs(1) where id=v_id;
    end if;
  end loop;
  perform obsidian_test.assert((select status='failed' and attempts=5 and last_error_code='attempts_exhausted' from public.obsidian_sync_queue where id=v_id),'repeated stale-lease recovery is also bounded');

  r:=obsidian_test.claim('permanent-error');
  perform obsidian_test.assert(public.finish_obsidian_sync_job(r.id,r.user_id,r.claim_token,'permission_denied',false),'permanent filesystem error can finish immediately');
  perform obsidian_test.assert((select status='failed' and attempts=1 from public.obsidian_sync_queue where id=r.id),'permanent error does not consume repeated retries');

  r:=obsidian_test.claim('cancelled');
  update public.obsidian_sync_queue set status='cancelled',claim_token=null,lease_expires_at=null where id=r.id;
  perform obsidian_test.assert(not public.renew_obsidian_sync_claim(r.id,r.user_id,r.claim_token),'cancelled work cannot renew');
  perform obsidian_test.assert(not public.finish_obsidian_sync_job(r.id,r.user_id,r.claim_token,'io_error',true),'cancelled work cannot requeue itself');
  perform public.recover_obsidian_sync_jobs();
  perform obsidian_test.assert((select status='cancelled' from public.obsidian_sync_queue where id=r.id),'stale recovery preserves cancellation');
end;
$$;

do $$
declare r public.obsidian_sync_queue; p jsonb; v_path text; v_collision_path text; v_first_note uuid; v_unsafe text; v_revision bigint;
begin
  foreach v_unsafe in array array['../escape.md','/outside.md','LifeOS/../escape.md','LifeOS//note.md',E'LifeOS\\note.md','.lifeos-hidden/note.md','LifeOS/note.txt'] loop
    r:=obsidian_test.claim('unsafe-path');
    p:=public.prepare_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_unsafe,repeat('a',64),null);
    perform obsidian_test.assert(p->>'conflict'='true' and p->>'error_code'='unsafe_path','unsafe relative path rejected: ' || v_unsafe);
    perform public.finish_obsidian_sync_job(r.id,r.user_id,r.claim_token,'unsafe_path',false,true);
    perform obsidian_test.assert(not exists(select 1 from public.obsidian_managed_notes where user_id=r.user_id and note_key=r.life_entity_id::text),'unsafe path creates no managed-note row: ' || v_unsafe);
  end loop;
  r:=obsidian_test.claim('invalid-input');
  v_path:='LifeOS/Captures/' || r.life_entity_id || '.md';
  perform obsidian_test.invalid(format('select public.prepare_obsidian_sync_job(%L,%L,%L,%L,%L,null)',r.id,r.user_id,r.claim_token,v_path,'invalid'),'malformed desired content hash rejected');
  perform obsidian_test.invalid(format('select public.prepare_obsidian_sync_job(%L,%L,%L,%L,%L,%L)',r.id,r.user_id,r.claim_token,v_path,repeat('a',64),'invalid'),'malformed observed content hash rejected');
  perform obsidian_test.invalid(format('select public.finish_obsidian_sync_job(%L,%L,%L,%L,true)',r.id,r.user_id,r.claim_token,'raw error body'),'unstructured error descriptions rejected');
  perform public.finish_obsidian_sync_job(r.id,r.user_id,r.claim_token,'invalid_input',false);

  r:=obsidian_test.claim('path-owner');
  v_first_note:=r.life_entity_id; v_collision_path:='LifeOS/Captures/' || v_first_note || '.md';
  p:=public.prepare_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_collision_path,repeat('a',64),null);
  perform public.complete_obsidian_sync_job(r.id,r.user_id,r.claim_token,repeat('a',64),(p->>'revision')::bigint);
  r:=obsidian_test.claim('path-collision');
  p:=public.prepare_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_collision_path,repeat('b',64),repeat('a',64));
  perform obsidian_test.assert(p->>'conflict'='true' and p->>'error_code'='path_collision','different logical notes cannot take the same path in one vault');
  perform obsidian_test.assert((select note_key=v_first_note::text and applied_content_hash=repeat('a',64) from public.obsidian_managed_notes where user_id=r.user_id and relative_path=v_collision_path),'path collision preserves original ownership and content state');
  perform public.finish_obsidian_sync_job(r.id,r.user_id,r.claim_token,'path_collision',false,true);
end;
$$;

do $$
declare r public.obsidian_sync_queue; p jsonb; v_id uuid; v_entity uuid; v_path text; v_revision bigint;
begin
  r:=obsidian_test.claim('block-before-ack');
  v_id:=r.id; v_entity:=r.life_entity_id; v_path:='LifeOS/Captures/' || v_entity || '.md';
  p:=public.prepare_obsidian_sync_job(r.id,r.user_id,r.claim_token,v_path,repeat('a',64),null);
  v_revision:=(p->>'revision')::bigint;
  update public.profiles set status='blocked' where user_id=r.user_id;
  perform obsidian_test.assert(not public.renew_obsidian_sync_claim(r.id,r.user_id,r.claim_token),'blocked profile cannot renew a claim');
  perform obsidian_test.claim_lost(format('select public.prepare_obsidian_sync_job(%L,%L,%L,%L,%L,null)',r.id,r.user_id,r.claim_token,v_path,repeat('b',64)),'blocked profile cannot prepare a note');
  perform obsidian_test.assert(not public.complete_obsidian_sync_job(r.id,r.user_id,r.claim_token,repeat('a',64),v_revision),'blocked profile cannot acknowledge a note');
  update public.obsidian_sync_queue set lease_expires_at=clock_timestamp()-interval '1 second' where id=r.id;
  perform public.recover_obsidian_sync_jobs();
  perform obsidian_test.assert((select status='cancelled' and attempts=1 from public.obsidian_sync_queue where id=v_id),'expired blocked claim is cancelled without losing attempts');
  perform obsidian_test.assert((select pending_content_hash=repeat('a',64) from public.obsidian_managed_notes where user_id=r.user_id and note_key=v_entity::text),'blocked recovery retains unacknowledged intent');
  update public.profiles set status='active' where user_id=r.user_id;
  perform obsidian_test.assert(not exists(select 1 from public.claim_obsidian_sync_jobs(1) where id=v_id),'reactivation does not resurrect cancelled work');

  r:=obsidian_test.claim('settings-disabled');
  update public.user_obsidian_settings set enabled=false,is_active=false,status='disconnected' where user_id=r.user_id;
  perform obsidian_test.assert(not public.renew_obsidian_sync_claim(r.id,r.user_id,r.claim_token),'disconnected vault cannot renew a claim');
  perform obsidian_test.assert(not public.complete_obsidian_sync_job(r.id,r.user_id,r.claim_token,repeat('a',64),1),'disconnected vault cannot acknowledge a note');
  perform obsidian_test.assert(public.finish_obsidian_sync_job(r.id,r.user_id,r.claim_token,'vault_disconnected',true),'owned worker can record failure after vault disconnect');
  perform obsidian_test.assert(not exists(select 1 from public.claim_obsidian_sync_jobs(1) where id=r.id),'disconnected vault cannot claim queued retries');
  update public.user_obsidian_settings set enabled=true,is_active=true,status='connected' where user_id=r.user_id;
  perform obsidian_test.cancel_jobs();

  insert into public.life_entities(user_id,entity_type,title) values('00000000-0000-4000-8000-000000000001','capture','synthetic owner entity') returning id into v_entity;
  insert into public.obsidian_sync_queue(user_id,life_entity_id,entity_type) values('00000000-0000-4000-8000-000000000002',v_entity,'capture') returning id into v_id;
  perform obsidian_test.assert(not exists(select 1 from public.claim_obsidian_sync_jobs(100) where id=v_id),'mismatched queue and entity owners cannot claim');
  perform public.recover_obsidian_sync_jobs();
  perform obsidian_test.assert((select status='failed' and last_error_code='entity_unavailable' from public.obsidian_sync_queue where id=v_id),'invalid entity ownership is terminal rather than silently reassigned');

  insert into public.obsidian_sync_queue(user_id,life_entity_id,operation,action) values('00000000-0000-4000-8000-000000000001',v_entity,'delete_note','delete') returning id into v_id;
  perform public.recover_obsidian_sync_jobs();
  perform obsidian_test.assert((select status='failed' and last_error_code='unsupported_operation' from public.obsidian_sync_queue where id=v_id),'legacy destructive operation is quarantined without execution');
end;
$$;

do $$
declare v_before text; v_after text; v_status jsonb;
begin
  select md5(string_agg(to_jsonb(q)::text,',' order by id)) into v_before from public.obsidian_sync_queue q;
  v_status:=public.obsidian_sync_status();
  select md5(string_agg(to_jsonb(q)::text,',' order by id)) into v_after from public.obsidian_sync_queue q;
  perform obsidian_test.assert(v_before=v_after,'status RPC is read-only and does not recover jobs');
  perform obsidian_test.assert(v_status ? 'counts' and v_status ? 'stale_claims' and v_status ? 'backlog' and v_status ? 'retry_attempts','status exposes aggregate operational counters');
  perform obsidian_test.assert(v_status::text not like '%synthetic%' and v_status::text not like '%LifeOS/%','status omits note bodies and relative paths');
end;
$$;

select obsidian_test.cancel_jobs();
-- Repeated jobs for exactly one logical note per user test the strict vault
-- lease under real concurrent claim statements; neither note may have 2 writers.
insert into public.life_entities(id,user_id,entity_type,title) values
  ('00000000-0000-4000-8000-000000005001','00000000-0000-4000-8000-000000000001','capture','synthetic contention A'),
  ('00000000-0000-4000-8000-000000005002','00000000-0000-4000-8000-000000000002','capture','synthetic contention B');
insert into public.obsidian_sync_queue(user_id,life_entity_id,entity_type,available_at)
select case when n<=8 then '00000000-0000-4000-8000-000000000001'::uuid else '00000000-0000-4000-8000-000000000002'::uuid end,
       case when n<=8 then '00000000-0000-4000-8000-000000005001'::uuid else '00000000-0000-4000-8000-000000005002'::uuid end,
       'capture',clock_timestamp()-interval '1 minute'
from generate_series(1,16) n;
reset role;
