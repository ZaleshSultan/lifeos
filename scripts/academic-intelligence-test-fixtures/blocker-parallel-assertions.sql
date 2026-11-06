set role service_role;
do $$declare u uuid:='f6000000-0000-4000-8000-000000000044';rid uuid;claim_token uuid;c jsonb;expected text[];actual text[];page integer;begin
 select reminder_id,token into rid,claim_token from intelligence_blocker_test.parallel_begin;
 perform intelligence_blocker_test.assert((select status='sending'and delivery_attempts=1 from public.reminders where user_id=u and id=rid),'eight concurrent begin calls authorize the bound key exactly once outside planning page and quota');
 perform public.finish_notification_delivery('reminder',u,rid,claim_token,'unknown','synthetic_no_send',null,null);
 perform intelligence_blocker_test.assert(not public.prepare_academic_intelligence_notification(u,(select key from intelligence_blocker_test.parallel_begin),public.academic_intelligence_candidate(u,(select key from intelligence_blocker_test.parallel_begin),clock_timestamp())->>'fingerprint','Synthetic attempted replay','[]'),'restart cannot reopen an ambiguous receipt');
 -- Advance only synthetic preparation timestamps to model the next hourly
 -- window. Preserve prior sent/unknown receipts and make no external send.
 update public.reminders r set created_at=clock_timestamp()-interval'2 hours',status=case when status='pending'or status='processing'then'sent'else status end,
 delivery_attempts=greatest(delivery_attempts,1),claim_token=null,lease_expires_at=null,claimed_at=null
 from public.academic_intelligence_jobs j where j.user_id=u and r.user_id=u and r.id=j.reminder_id;
 for page in 1..2 loop
  select array_agg(job_key order by due_at,job_key)into expected from(select k.*from public.academic_intelligence_candidate_keys(u,clock_timestamp())k
  where not exists(select from public.academic_intelligence_jobs j where j.user_id=u and j.job_key=k.job_key)order by k.due_at,k.job_key limit 5)x;
  select array_agg(v->>'key'order by ordinal)into actual from public.academic_intelligence_planning_candidates(u,clock_timestamp())with ordinality t(v,ordinal);
  perform intelligence_blocker_test.assert(actual=expected and cardinality(actual)=case when page=1 then 5 else 2 end,'durable receipt pagination returns deterministic remaining groups page '||page);
  for c in select v from public.academic_intelligence_planning_candidates(u,clock_timestamp())v loop
   perform public.prepare_academic_intelligence_notification(u,c->>'key',c->>'fingerprint','Synthetic next-window group','[]');
  end loop;
  update public.reminders r set created_at=clock_timestamp()-interval'2 hours',status=case when status='pending'then'sent'else status end,delivery_attempts=greatest(delivery_attempts,1)
  from public.academic_intelligence_jobs j where j.user_id=u and r.user_id=u and r.id=j.reminder_id;
 end loop;
 perform intelligence_blocker_test.assert((select count(*)=12 and count(distinct reminder_id)=12 from public.academic_intelligence_jobs where user_id=u)and not exists(select from public.academic_intelligence_planning_candidates(u,clock_timestamp())),'all twelve eligible groups eventually process without duplicates or permanent cursor starvation');
 perform intelligence_blocker_test.assert((select status='unknown'and delivery_attempts=1 from public.reminders where user_id=u and id=rid),'pagination and new hourly windows never reset the closed ambiguous receipt');
end;$$;
reset role;
