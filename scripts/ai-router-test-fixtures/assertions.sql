select public.ai_test_assert((select relrowsecurity from pg_class where oid='public.ai_router_settings'::regclass),'router settings RLS enabled');
select public.ai_test_assert(not has_table_privilege('anon','public.ai_router_settings','SELECT,INSERT,UPDATE,DELETE'),'anonymous settings access revoked');
select public.ai_test_assert(not has_table_privilege('authenticated','public.ai_router_settings','SELECT,INSERT,UPDATE,DELETE'),'browser settings access revoked');
select public.ai_test_assert(not has_function_privilege('authenticated','public.save_ai_router_settings(uuid,jsonb,integer)','EXECUTE'),'browser settings RPC revoked');
select public.ai_test_assert(not has_function_privilege('anon','public.reserve_ai_router_execution(uuid,text,text,text,integer,bigint,jsonb,jsonb)','EXECUTE'),'anonymous router execution revoked');
select public.ai_test_assert(not has_function_privilege('authenticated','public.finish_ai_router_execution(uuid,text,text,integer,jsonb)','EXECUTE'),'browser router receipt revoked');
select public.ai_test_assert(not has_table_privilege('service_role','public.ai_router_settings','DELETE'),'preferences have no destructive rollback shortcut');

-- The validators must reject SQL-null predicates, unknown credential keys and
-- falsely labelled plan/API costs before they create any budget reservation.
do $$
declare metadata jsonb; bad jsonb; key text;
begin
 metadata:=public.router_test_metadata();
 perform public.ai_test_assert(public.valid_ai_routing_metadata(metadata),'valid metadata');
 perform public.ai_test_assert(not public.valid_ai_routing_metadata(null),'SQL null metadata rejected');
 perform public.ai_test_assert(not public.valid_ai_routing_metadata('null'::jsonb),'JSON null metadata rejected');
 perform public.ai_test_assert(not public.valid_ai_routing_metadata('[]'::jsonb),'metadata arrays rejected');
 perform public.ai_test_assert(not public.valid_ai_routing_metadata('{}'::jsonb),'missing metadata rejected');
 foreach key in array array['provider','billing','costSource','model','selectedModelId','credentialLabel','attempts','fallback','version'] loop
  bad:=jsonb_set(metadata,array[key],'null'::jsonb);
  perform public.ai_test_assert(not public.valid_ai_routing_metadata(bad),'null required routing field '||key);
  begin
   perform public.reserve_ai_router_execution('00000000-0000-4000-8000-000000000001','chat','bad-routing','bad-routing',1,0,public.ai_test_limits(),bad);
   raise exception 'Invalid routing metadata accepted';
  exception when invalid_parameter_value then null;end;
 end loop;
 foreach key in array array['apiKey','authorization','accessToken','baseUrl'] loop
  perform public.ai_test_assert(not public.valid_ai_routing_metadata(metadata||jsonb_build_object(key,'never-store-this')),'unknown secret routing field');
 end loop;
 perform public.ai_test_assert(not public.valid_ai_routing_metadata(jsonb_set(metadata,'{provider}','"attacker"'::jsonb)),'unknown provider');
 perform public.ai_test_assert(not public.valid_ai_routing_metadata(jsonb_set(metadata,'{model}','"https://example.invalid/model"'::jsonb)),'URLs are not model IDs');
 perform public.ai_test_assert(not public.valid_ai_routing_metadata(public.router_test_metadata(1,'chatgpt_plan','chatgpt_plan')),'plan allowance is not API cost');
 perform public.ai_test_assert(not public.valid_ai_routing_metadata(public.router_test_metadata(1,'openrouter','free')),'free route cannot report a charge');
 perform public.ai_test_assert((select count(*)=0 from public.ai_execution_reservations),'invalid routing reserves nothing');
end;$$;

begin;set local role service_role;
select public.ai_test_assert(public.save_ai_router_settings('00000000-0000-4000-8000-000000000001',public.router_test_settings(),0)->>'revision'='1','first settings write');
select public.ai_test_assert(public.save_ai_router_settings('00000000-0000-4000-8000-000000000001',public.router_test_settings(),0)->>'revision'='1','repeated save returns same revision');
select public.ai_test_assert(public.save_ai_router_settings('00000000-0000-4000-8000-000000000002',jsonb_set(public.router_test_settings(),'{mode}','"manual"'::jsonb),0)->>'revision'='1','separate owner settings');
select public.ai_test_assert((select settings->>'mode'='auto' from public.ai_router_settings where user_id='00000000-0000-4000-8000-000000000001'),'other owner untouched');
do $$ begin
 perform public.save_ai_router_settings('00000000-0000-4000-8000-000000000001',jsonb_set(public.router_test_settings(),'{mode}','"manual"'::jsonb),0);
 raise exception 'Stale settings overwrite accepted';
exception when raise_exception then if sqlerrm<>'ai_router_settings_conflict' then raise;end if;end $$;
do $$ begin
 perform public.save_ai_router_settings('00000000-0000-4000-8000-000000000001',public.router_test_settings()||'{"apiKey":"never-store"}'::jsonb,1);
 raise exception 'Secret settings field accepted';
exception when invalid_parameter_value then null;end $$;
do $$ begin
 perform public.save_ai_router_settings('00000000-0000-4000-8000-000000000001',jsonb_set(public.router_test_settings(),'{privacy,health}','["attacker"]'::jsonb),1);
 raise exception 'Unknown data recipient accepted';
exception when invalid_parameter_value then null;end $$;
rollback;

begin;
update public.profiles set status='blocked' where user_id='00000000-0000-4000-8000-000000000001';
set local role service_role;
do $$ begin
 perform public.save_ai_router_settings('00000000-0000-4000-8000-000000000001',public.router_test_settings(),0);
 raise exception 'Blocked owner settings accepted';
exception when insufficient_privilege then null;end $$;
rollback;

-- A bounded request reserves once. Duplicate IDs cannot create extra billing
-- records, and identical IDs belonging to different canonical owners are isolated.
begin;set local role service_role;
select public.ai_test_assert(public.reserve_ai_router_execution('00000000-0000-4000-8000-000000000001','chat','router-one','router-task',100,10,public.ai_test_limits(),public.router_test_metadata())='reserved','router reservation');
select public.ai_test_assert(public.reserve_ai_router_execution('00000000-0000-4000-8000-000000000001','chat','router-one','router-task',100,10,public.ai_test_limits(),public.router_test_metadata())='duplicate','router replay not executed');
select public.ai_test_assert(public.reserve_ai_router_execution('00000000-0000-4000-8000-000000000002','chat','router-one','router-task',100,10,public.ai_test_limits(),public.router_test_metadata())='reserved','same request ID different owner');
select public.ai_test_assert(not public.finish_ai_router_execution('00000000-0000-4000-8000-000000000003','router-one','completed',20,public.router_test_metadata(20)),'foreign completion denied');
select public.ai_test_assert(public.finish_ai_router_execution('00000000-0000-4000-8000-000000000001','router-one','completed',20,public.router_test_metadata(20)),'actual cost receipt');
select public.ai_test_assert(public.finish_ai_router_execution('00000000-0000-4000-8000-000000000001','router-one','completed',20,public.router_test_metadata(20)),'identical terminal receipt replay');
select public.ai_test_assert(not public.finish_ai_router_execution('00000000-0000-4000-8000-000000000001','router-one','completed',21,public.router_test_metadata(20)),'terminal token count cannot change');
select public.ai_test_assert(not public.finish_ai_router_execution('00000000-0000-4000-8000-000000000001','router-one','completed',20,public.router_test_metadata(21)),'terminal cost cannot change');
do $$ begin
 perform public.finish_ai_router_execution('00000000-0000-4000-8000-000000000002','router-one','completed',20,public.router_test_metadata(0,'openrouter','free'));
 raise exception 'API billing switched to free';
exception when invalid_parameter_value then null;end $$;
select public.ai_test_assert((select reported_cost_micros=20 and reported_tokens=20 from public.ai_execution_reservations where user_id='00000000-0000-4000-8000-000000000001' and request_id='router-one'),'receipt remains immutable');
select public.ai_test_assert(public.reserve_ai_router_execution('00000000-0000-4000-8000-000000000001','chat','after-cost','after-cost-task',1,1,public.ai_test_limits(1000,1000,10000,20),public.router_test_metadata())='cost_budget_exceeded','actual observed cost tightens next owner cap');
select public.ai_test_assert(public.reserve_ai_router_execution('00000000-0000-4000-8000-000000000001','chat','after-feature-cost','after-feature-cost-task',1,1,public.ai_test_limits()||'{"featureCostMicros":20}'::jsonb,public.router_test_metadata())='cost_budget_exceeded','observed cost tightens feature cap');
select public.ai_test_assert(public.reserve_ai_router_execution('00000000-0000-4000-8000-000000000003','finance','after-global-cost','after-global-cost-task',1,6,public.ai_test_limits()||'{"globalCostMicros":35}'::jsonb,public.router_test_metadata())='cost_budget_exceeded','observed cost tightens global cap across owners');
select public.ai_test_assert((select state='reserved' and reported_cost_micros is null from public.ai_execution_reservations where user_id='00000000-0000-4000-8000-000000000002' and request_id='router-one'),'other owner receipt unchanged');
rollback;

begin;set local role service_role;
select public.ai_test_assert(public.reserve_ai_router_execution('00000000-0000-4000-8000-000000000001','chat','zero-free','zero-free-task',10,0,public.ai_test_limits(1000,1000,10000,0),public.router_test_metadata(null,'openrouter','free'))='reserved','zero money ceiling permits known free requests');
do $$ begin
 perform public.finish_ai_router_execution('00000000-0000-4000-8000-000000000001','zero-free','completed',10,public.router_test_metadata(1));
 raise exception 'Free billing switched to API';
exception when invalid_parameter_value then null;end $$;
select public.ai_test_assert(public.reserve_ai_router_execution('00000000-0000-4000-8000-000000000001','chat','positive-price','positive-task',10,1,public.ai_test_limits(1000,1000,10000,0),public.router_test_metadata())='cost_budget_exceeded','zero money ceiling denies paid requests');
select public.ai_test_assert(public.reserve_ai_router_execution('00000000-0000-4000-8000-000000000001','chat','unknown-price','unknown-task',10,null,public.ai_test_limits(1000,1000,10000,0),public.router_test_metadata())='cost_budget_exceeded','zero money ceiling denies unknown price');
rollback;

begin;set local role service_role;
select public.ai_test_assert(public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','chat','legacy-reservation','legacy-task',10,0,public.ai_test_limits())='reserved','legacy reservation still works');
select public.ai_test_assert(not public.finish_ai_router_execution('00000000-0000-4000-8000-000000000001','legacy-reservation','completed',10,public.router_test_metadata(0)),'router finish cannot adopt a legacy reservation');
select public.ai_test_assert((select routing is null and state='reserved' from public.ai_execution_reservations where user_id='00000000-0000-4000-8000-000000000001' and request_id='legacy-reservation'),'legacy reservation unchanged');
select public.ai_test_assert(public.finish_ai_execution('00000000-0000-4000-8000-000000000001','legacy-reservation','completed',10),'legacy receipt API remains compatible');
rollback;

begin;set local role service_role;
do $$ begin
 perform public.reserve_ai_router_execution('00000000-0000-4000-8000-000000000001','chat','plan-fake-price','plan-fake-task',10,0,public.ai_test_limits(),public.router_test_metadata(null,'chatgpt_plan','chatgpt_plan'));
 raise exception 'Plan misrepresented as zero API credits';
exception when invalid_parameter_value then null;end $$;
select public.ai_test_assert(public.reserve_ai_router_execution('00000000-0000-4000-8000-000000000001','chat','plan-unknown','plan-unknown-task',10,null,public.ai_test_limits(1000,1000,10000,0),public.router_test_metadata(null,'chatgpt_plan','chatgpt_plan'))='cost_budget_exceeded','unknown plan value does not bypass a monetary cap');
select public.ai_test_assert(public.reserve_ai_router_execution('00000000-0000-4000-8000-000000000001','chat','plan-no-api-budget','plan-no-api-budget-task',10,null,public.ai_test_limits(),public.router_test_metadata(null,'chatgpt_plan','chatgpt_plan'))='reserved','plan ledger retains unknown API price');
select public.ai_test_assert(public.finish_ai_router_execution('00000000-0000-4000-8000-000000000001','plan-no-api-budget','failed',null,public.router_test_metadata(null,'chatgpt_plan','chatgpt_plan')),'plan failure records no API cost');
select public.ai_test_assert(public.reserve_ai_router_execution('00000000-0000-4000-8000-000000000002','chat','api-not-plan','api-not-plan-task',10,0,public.ai_test_limits(),public.router_test_metadata())='reserved','separate API billing path');
do $$ begin
 perform public.finish_ai_router_execution('00000000-0000-4000-8000-000000000002','api-not-plan','failed',null,public.router_test_metadata(null,'chatgpt_plan','chatgpt_plan'));
 raise exception 'API billing relabelled as plan allowance';
exception when invalid_parameter_value then null;end $$;
do $$ begin
 perform public.finish_ai_router_execution('00000000-0000-4000-8000-000000000001','plan-no-api-budget','failed',null,public.router_test_metadata());
 raise exception 'Plan billing silently changed to API';
exception when invalid_parameter_value then null;end $$;
rollback;

-- Browser identities cannot invoke privileged writes even if they know UUIDs.
set role authenticated;
do $$ begin
 perform public.save_ai_router_settings('00000000-0000-4000-8000-000000000001',public.router_test_settings(),0);
 raise exception 'Browser settings RPC permitted';
exception when insufficient_privilege then null;end $$;
reset role;
set role anon;
do $$ begin
 perform public.reserve_ai_router_execution('00000000-0000-4000-8000-000000000001','chat','browser-route','browser-task',1,0,public.ai_test_limits(),public.router_test_metadata());
 raise exception 'Anonymous router execution permitted';
exception when insufficient_privilege then null;end $$;
reset role;
select public.ai_test_assert((select count(*)=0 from public.ai_router_settings),'assertion settings transactions rolled back');
select public.ai_test_assert((select count(*)=0 from public.ai_execution_reservations),'assertion execution transactions rolled back');
