select public.ai_test_assert((select relrowsecurity from pg_class where oid='public.ai_execution_reservations'::regclass),'RLS enabled');
select public.ai_test_assert(not has_table_privilege('anon','public.ai_execution_reservations','SELECT,INSERT,UPDATE,DELETE'),'anon blocked');
select public.ai_test_assert(not has_table_privilege('authenticated','public.ai_execution_reservations','SELECT,INSERT,UPDATE,DELETE'),'browser blocked');
select public.ai_test_assert(not has_function_privilege('authenticated','public.reserve_ai_execution(uuid,text,text,text,integer,bigint,jsonb)','EXECUTE'),'browser RPC blocked');
select public.ai_test_assert(not has_function_privilege('anon','public.finish_ai_execution(uuid,text,text,integer)','EXECUTE'),'anon receipt blocked');
select public.ai_test_assert(not has_table_privilege('service_role','public.ai_execution_reservations','DELETE'),'no automatic destructive refund');

begin;set local role service_role;
select public.ai_test_assert(public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','chat','req1','task1',100,null,public.ai_test_limits())='reserved','first reservation');
select public.ai_test_assert(public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','chat','req1','task1',100,null,public.ai_test_limits())='duplicate','replay across processes');
select public.ai_test_assert(public.reserve_ai_execution('00000000-0000-4000-8000-000000000002','chat','req1','task1',100,null,public.ai_test_limits())='reserved','owner isolation');
select public.ai_test_assert(not public.finish_ai_execution('00000000-0000-4000-8000-000000000003','req1','completed',50),'cannot finish foreign reservation');
select public.ai_test_assert(public.finish_ai_execution('00000000-0000-4000-8000-000000000001','req1','failed',null),'failure receipt');
select public.ai_test_assert(public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','chat','req2','task2',1,null,public.ai_test_limits(100,100,10000))='token_budget_exceeded','failure does not refund');
rollback;

begin;set local role service_role;
select public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','chat','req1','task1',100,null,public.ai_test_limits());
select public.ai_test_assert(public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','chat','req2','task2',1,null,public.ai_test_limits(1000,100,10000))='token_budget_exceeded','feature cap');
select public.ai_test_assert(public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','finance','req3','task3',100,null,public.ai_test_limits(200,100,10000))='reserved','different feature below owner cap');
select public.ai_test_assert(public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','finance','req4','task4',1,null,public.ai_test_limits(200,1000,10000))='token_budget_exceeded','owner cap across features');
rollback;

begin;set local role service_role;
select public.ai_test_assert(public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','chat','unknown-price','task1',10,null,public.ai_test_limits(1000,1000,10000,100))='cost_budget_exceeded','unknown price fails closed with money cap');
select public.ai_test_assert(public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','chat','cost1','task1',10,80,public.ai_test_limits(1000,1000,10000,100))='reserved','priced reserve');
select public.ai_test_assert(public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','chat','cost2','task2',10,30,public.ai_test_limits(1000,1000,10000,100))='cost_budget_exceeded','money cap');
rollback;

begin;set local role service_role;
select public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','chat','step1','same-task',10,null,public.ai_test_limits(1000,1000,10000,null,2));
select public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','finance','step2','same-task',10,null,public.ai_test_limits(1000,1000,10000,null,2));
select public.ai_test_assert(public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','chat','step3','same-task',10,null,public.ai_test_limits(1000,1000,10000,null,2))='iteration_limit','loop halted across features');
rollback;

begin;set local role service_role;
select public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','chat','large-response','task1',10,null,public.ai_test_limits());
select public.finish_ai_execution('00000000-0000-4000-8000-000000000001','large-response','failed',200);
select public.ai_test_assert(public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','chat','next-request','task2',1,null,public.ai_test_limits(200,1000,10000))='token_budget_exceeded','reported overage constrains next call');
rollback;

begin;
update public.profiles set status='blocked' where user_id='00000000-0000-4000-8000-000000000001';
set local role service_role;
select public.ai_test_assert(public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','chat','blocked','task1',10,null,public.ai_test_limits())='profile_inactive','blocked profile');
rollback;

do $$ begin
 perform public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','chat','invalid','task1',10,null,public.ai_test_limits(0));
 raise exception 'Invalid limits accepted';
exception when invalid_parameter_value then null;end $$;
set role authenticated;
do $$ begin
 perform public.reserve_ai_execution('00000000-0000-4000-8000-000000000001','chat','browser','task1',10,null,public.ai_test_limits());
 raise exception 'Browser execution allowed';
exception when insufficient_privilege then null;end $$;
reset role;
select public.ai_test_assert((select count(*)=0 from public.ai_execution_reservations),'all fixture writes rolled back');
