set role service_role;
do $$declare u uuid:='f6000000-0000-4000-8000-000000000045';rid uuid;old_token uuid;claim uuid;c jsonb;begin
 select reminder_id,token into rid,old_token from intelligence_blocker_test.expiry_claim;
 perform intelligence_blocker_test.assert((select count(*)=8 and bool_and(recipient is null)from intelligence_blocker_test.expiry_results),'all eight concurrent begins reject expired evidence');
 perform intelligence_blocker_test.assert((select status='cancelled'and delivery_attempts=0 and delivery_started_at is null from public.reminders where user_id=u and id=rid)and not exists(select from public.reminders where user_id=u and status='sending'),'concurrent expiry leaves zero attempts and no sending state');
 perform intelligence_blocker_test.assert(public.begin_notification_delivery('reminder',u,rid,old_token)is null,'restarted stale worker cannot reuse the expired-render claim');
 c:=public.academic_intelligence_candidate(u,(select key from intelligence_blocker_test.expiry_claim),clock_timestamp());
 perform intelligence_blocker_test.assert(public.prepare_academic_intelligence_notification(u,c->>'key',c->>'fingerprint','Synthetic honest uncertainty fallback after concurrent expiry','[]'),'only never-attempted expired job can be safely downgraded');
 select claim_token into claim from public.claim_due_reminders(clock_timestamp(),100)where user_id=u and id=rid;
 perform intelligence_blocker_test.assert(claim<>old_token and public.begin_notification_delivery('reminder',u,rid,old_token)is null,'old worker token cannot steal the restarted fallback claim');
 perform intelligence_blocker_test.assert(public.begin_notification_delivery('reminder',u,rid,claim)=760045,'new current fallback retains the established fenced delivery right');
 perform public.finish_notification_delivery('reminder',u,rid,claim,'unknown','synthetic_no_send',null,null);
 perform intelligence_blocker_test.assert((select status='unknown'and delivery_attempts=1 from public.reminders where user_id=u and id=rid),'concurrent expiry fallback closes one immutable synthetic receipt');
end;$$;
do $$declare u uuid:='f6000000-0000-4000-8000-000000000046';rid uuid;claim uuid;begin
 select reminder_id,token into rid,claim from intelligence_blocker_test.policy_claim;
 perform intelligence_blocker_test.assert((select count(*)=1 from intelligence_blocker_test.policy_results where worker like'cas%'and status='accepted')and(select count(*)=1 from intelligence_blocker_test.policy_results where worker like'cas%'and status='conflict'),'two concurrent policy writes at one CAS revision yield exactly one acceptance and one conflict');
 perform intelligence_blocker_test.assert((select revision=2 from public.academic_intelligence_preferences where user_id=u)and(select revision=1 from public.academic_notification_preferences where user_id=u),'competing policy CAS does not revise unrelated assignment preferences');
 perform intelligence_blocker_test.assert((select status='unknown'and delivery_attempts=1 from public.reminders where id=rid and user_id=u)and public.begin_notification_delivery('reminder',u,rid,claim)is null,'policy races preserve closed legacy receipt and cannot duplicate authorization');
end;$$;
reset role;
