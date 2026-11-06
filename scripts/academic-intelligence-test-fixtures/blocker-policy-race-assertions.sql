set role service_role;
do $$declare u uuid:='f6000000-0000-4000-8000-000000000046';rid uuid;claim uuid;begin
 select reminder_id,token into rid,claim from intelligence_blocker_test.policy_claim;
 perform intelligence_blocker_test.assert((select count(*)=2 from intelligence_blocker_test.policy_results)and exists(select from intelligence_blocker_test.policy_results where worker='delivery'and recipient=760046),'concurrent policy-only review and legacy begin both retain valid delivery rights');
 perform intelligence_blocker_test.assert((select revision=1 and course_reviews?'f6460000-0000-4000-8000-000000000046'from public.academic_intelligence_preferences where user_id=u)and(select status='sending'and delivery_attempts=1 from public.reminders where id=rid and user_id=u),'policy update and legacy authorization serialize without stale cancellation or duplicate attempt');
 perform public.finish_notification_delivery('reminder',u,rid,claim,'unknown','synthetic_no_send',null,null);
 update intelligence_blocker_test.policy_claim set args=jsonb_set(args,'{expectedRevision}','1');
end;$$;
reset role;
