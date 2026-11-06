set role service_role;
do $$declare u uuid:='f6000000-0000-4000-8000-000000000050';rid uuid;claim uuid;begin
 select reminder_id,token into rid,claim from intelligence_blocker_test.source_race_claim;
 perform intelligence_blocker_test.assert((select count(*)=1 and bool_and(recipient is null)from intelligence_blocker_test.source_race_results),'source update winning row lock fences concurrent old assignment begin');
 perform intelligence_blocker_test.assert((select status='cancelled'and delivery_attempts=0 and delivery_started_at is null from public.reminders where id=rid and user_id=u),'source versus begin race has no deadlock no attempt and no ambiguous receipt reset');
 perform intelligence_blocker_test.assert(public.begin_notification_delivery('reminder',u,rid,claim)is null,'stale worker after committed submission remains fenced');
end;$$;
reset role;
