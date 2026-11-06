set role service_role;
do $$declare u uuid:='f6000000-0000-4000-8000-000000000044';rid uuid;claimed_token uuid;begin
 perform intelligence_blocker_test.assert((select count(*)=5 from public.academic_intelligence_jobs where user_id=u),'eight concurrent workers cannot exceed five owner jobs per hour');
 perform intelligence_blocker_test.assert((select count(*)=5 and count(distinct reminder_id)=5 from public.academic_intelligence_jobs where user_id=u),'concurrent preparation preserves one durable binding per group');
 perform intelligence_blocker_test.assert(not exists(select from public.academic_intelligence_planning_candidates(u,clock_timestamp())),'quota exhaustion returns no new planning work despite remaining source groups');
 select reminder_id into rid from intelligence_blocker_test.parallel_begin;
 select claim_token into claimed_token from public.claim_due_reminders(clock_timestamp(),100)where user_id=u and id=rid;
 update intelligence_blocker_test.parallel_begin set token=claimed_token;
 perform intelligence_blocker_test.assert(claimed_token is not null,'keyed final delivery has a real current claim');
 perform intelligence_blocker_test.assert(not exists(select from public.academic_intelligence_grade_candidates(u,clock_timestamp())v where v->>'key'=(select key from intelligence_blocker_test.parallel_begin)),'bound tenth group is outside the oldest-five display page');
end;$$;
reset role;
