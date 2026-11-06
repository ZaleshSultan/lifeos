-- Semantic time predicates mirror the pure formatter and never hash refresh time.
set role service_role;
do $$declare f jsonb;changed jsonb;at_time timestamptz;base_key jsonb;bad text;begin
 select input->'candidate'->'forecast',(input->>'now')::timestamptz into f,at_time from intelligence_blocker_test.render_inputs where label='before';
 base_key:=public.academic_intelligence_forecast_key(f,at_time);
 perform intelligence_blocker_test.assert(public.academic_intelligence_timestamp_current(to_char(at_time at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),at_time,interval'48 hours'),'current finite observation is temporally eligible');
 foreach bad in array array['not-a-time','infinity','-infinity','2026-02-30T00:00:00Z']loop
  perform intelligence_blocker_test.assert(not public.academic_intelligence_timestamp_current(bad,at_time,interval'48 hours'),'invalid or nonfinite observation is ineligible '||bad);
 end loop;
 changed:=jsonb_set(f,'{records,0,updatedAt}',to_jsonb(at_time-interval'1 second'));
 changed:=jsonb_set(changed,'{records,1,updatedAt}',to_jsonb(at_time-interval'2 seconds'));
 perform intelligence_blocker_test.assert(public.academic_intelligence_forecast_key(changed,at_time)=base_key,'harmless fresh record timestamps keep the same semantic forecast key');
 changed:=jsonb_set(f,'{lms,lastSuccessfulSyncAt}',to_jsonb(at_time-interval'1 second'));
 perform intelligence_blocker_test.assert(public.academic_intelligence_forecast_key(changed,at_time)=base_key,'harmless fresh source timestamp keeps the same semantic forecast key');
 foreach bad in array array['future','stale','invalid']loop
  changed:=jsonb_set(f,'{records,0,updatedAt}',case bad when'future'then to_jsonb(at_time+interval'1 second')when'stale'then to_jsonb(at_time-interval'48 hours 1 second')else'"infinity"'::jsonb end);
  perform intelligence_blocker_test.assert(public.academic_intelligence_forecast_key(changed,at_time)<>base_key,'record temporal eligibility changes fingerprint '||bad);
  changed:=jsonb_set(f,'{lms,lastSuccessfulSyncAt}',case bad when'future'then to_jsonb(at_time+interval'1 second')when'stale'then to_jsonb(at_time-interval'6 hours 1 second')else'"not-a-time"'::jsonb end);
  perform intelligence_blocker_test.assert(public.academic_intelligence_forecast_key(changed,at_time)<>base_key,'source temporal eligibility changes fingerprint '||bad);
  changed:=jsonb_set(f,'{review,reviewedAt}',case bad when'future'then to_jsonb(at_time+interval'1 second')when'stale'then to_jsonb(at_time-interval'90 days 1 second')else'"infinity"'::jsonb end);
  perform intelligence_blocker_test.assert(public.academic_intelligence_forecast_key(changed,at_time)<>base_key,'review temporal eligibility changes fingerprint '||bad);
 end loop;
 changed:=jsonb_set(f,'{courseEndsOn}',to_jsonb(((at_time at time zone'Asia/Almaty')::date-1)::text));
 perform intelligence_blocker_test.assert(public.academic_intelligence_forecast_key(changed,at_time)<>base_key,'past known enrollment bound changes forecast authorization');
 changed:=jsonb_set(f,'{courseStartsOn}',to_jsonb(((at_time at time zone'Asia/Almaty')::date+1)::text));
 perform intelligence_blocker_test.assert(public.academic_intelligence_forecast_key(changed,at_time)<>base_key,'future known enrollment bound changes forecast authorization');
 changed:=jsonb_set(f,'{calculator,definition,attestationThreshold}','26'::jsonb);
 perform intelligence_blocker_test.assert(public.academic_intelligence_forecast_key(changed,at_time)<>base_key,'exact source policy definition remains part of authorization');
 changed:=jsonb_set(f,'{bindings,a,entries,0,weight}','99'::jsonb);
 perform intelligence_blocker_test.assert(public.academic_intelligence_forecast_key(changed,at_time)<>base_key,'exact stable assessment bindings remain part of authorization');
 changed:=jsonb_set(f,'{review,definitionKey}','"different reviewed definition"'::jsonb);
 perform intelligence_blocker_test.assert(public.academic_intelligence_forecast_key(changed,at_time)<>base_key,'exact reviewed definition identity remains part of authorization');
 changed:=jsonb_set(f,'{review,bindingsKey}','"different reviewed bindings"'::jsonb);
 perform intelligence_blocker_test.assert(public.academic_intelligence_forecast_key(changed,at_time)<>base_key,'exact reviewed binding identity remains part of authorization');
end;$$;
reset role;
