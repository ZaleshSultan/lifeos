create function public.quota_test_limits(rpm integer default 20,rpd integer default 50,tpm bigint default 100000,tpd bigint default 1000000)
returns jsonb language sql as $$ select jsonb_build_object('requestsPerMinute',rpm,'requestsPerDay',rpd,'tokensPerMinute',tpm,'tokensPerDay',tpd); $$;
create function public.quota_test_execution(owner_id uuid,req text,tokens integer default 1000)
returns void language plpgsql as $$ begin
 perform public.ai_test_assert(public.reserve_ai_router_execution(owner_id,'classification',req,req,tokens,0,public.ai_test_limits(1000000,1000000,1000000,0,20),public.router_test_metadata(null,'openrouter','free'))='reserved','outer execution reserved');
end; $$;
grant execute on function public.quota_test_limits(integer,integer,bigint,bigint),public.quota_test_execution(uuid,text,integer) to service_role;
set role service_role;
select public.ai_test_assert(public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000001','missing','classification',1,'openrouter','pool','fixture/free:free',10,public.quota_test_limits())->>'outcome'='execution_inactive','no quota without existing execution');
select public.quota_test_execution('00000000-0000-4000-8000-000000000001','one',600);
select public.ai_test_assert(public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000002','one','classification',1,'openrouter','pool','fixture/free:free',200,public.quota_test_limits())->>'outcome'='execution_inactive','foreign execution cannot claim');
select public.ai_test_assert(public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000001','one','classification',1,'openrouter','pool','fixture/free:free',200,public.quota_test_limits())->>'outcome'='reserved','owned quota reserved');
select public.ai_test_assert(public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000001','one','classification',1,'openrouter','pool','fixture/free:free',200,public.quota_test_limits())->>'outcome'='duplicate','attempt replay is not dispatch');
do $$ begin
 perform public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000001','one','classification',1,'openrouter','changed-domain','fixture/free:free',200,public.quota_test_limits());
 raise exception 'changed attempt accepted';
exception when invalid_parameter_value then null;end; $$;
select public.ai_test_assert(public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000001','one','classification',3,'openrouter','pool','fixture/free:free',200,public.quota_test_limits())->>'outcome'='attempt_limit','ordinals cannot skip');
select public.ai_test_assert(public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000001','one','classification',2,'openrouter','pool','fixture/free:free',450,public.quota_test_limits())->>'outcome'='attempt_limit','quota cannot exceed governor token reservation');
select public.ai_test_assert(public.read_ai_provider_quota('00000000-0000-4000-8000-000000000002','openrouter','pool') is null,'foreign quota metadata is opaque');
select public.ai_test_assert(public.read_ai_provider_quota('00000000-0000-4000-8000-000000000001','openrouter','pool')->>'requestsInDay'='1','owned quota count known');

select public.quota_test_execution('00000000-0000-4000-8000-000000000001','daily-a');
select public.quota_test_execution('00000000-0000-4000-8000-000000000002','daily-b');
select public.ai_test_assert(public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000001','daily-a','classification',1,'openrouter','shared-account','fixture/free:free',10,public.quota_test_limits(20,1))->>'outcome'='reserved','first shared account call');
select public.ai_test_assert(public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000002','daily-b','classification',1,'openrouter','shared-account','fixture/different:free',10,public.quota_test_limits(20,100))->>'outcome'='day_limit','another key model owner cannot reset shared daily cap');
select public.ai_test_assert((public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000002','daily-b','classification',1,'openrouter','shared-account','fixture/different:free',10,public.quota_test_limits(20,1))->>'retryAt')::timestamptz=(date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC')+interval '1 day','OR day retry is UTC midnight');

select public.quota_test_execution('00000000-0000-4000-8000-000000000003','minute-a');
select public.quota_test_execution('00000000-0000-4000-8000-000000000003','minute-b');
select public.ai_test_assert(public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000003','minute-a','classification',1,'gemini','shared-project','gemini-free',16,public.quota_test_limits(20,50,20,100))->>'outcome'='reserved','first project token claim');
select public.ai_test_assert(public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000003','minute-b','classification',1,'gemini','shared-project','gemini-second',16,public.quota_test_limits(20,50,20,100))->>'outcome'='minute_limit','project token minute cap shared by models');
select public.ai_test_assert(public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000003','minute-b','classification',1,'gemini','token-day','gemini-free',16,public.quota_test_limits(20,50,100,20))->>'outcome'='reserved','first token day claim');
select public.ai_test_assert(public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000003','minute-b','classification',2,'gemini','token-day','gemini-second',16,public.quota_test_limits(20,50,100,20))->>'outcome'='day_limit','daily tokens independent of requests');

select public.ai_test_assert(not public.cooldown_ai_provider_quota('00000000-0000-4000-8000-000000000002','one','openrouter','pool',clock_timestamp()+interval '2 minutes',false),'foreign cooldown cannot mutate');
select public.ai_test_assert(public.cooldown_ai_provider_quota('00000000-0000-4000-8000-000000000001','one','openrouter','pool',clock_timestamp()+interval '2 minutes',false),'persist provider wait');
select public.ai_test_assert(public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000001','one','classification',2,'openrouter','pool','fixture/different:free',100,public.quota_test_limits())->>'outcome'='cooldown','cooldown shared across model and key');
select public.ai_test_assert(public.cooldown_ai_provider_quota('00000000-0000-4000-8000-000000000001','one','openrouter','pool',null,true),'ambiguous long wait requires review');
select public.ai_test_assert(public.read_ai_provider_quota('00000000-0000-4000-8000-000000000001','openrouter','pool')->>'reviewRequired'='true','review flag durable');
select public.ai_test_assert(public.finish_ai_router_execution('00000000-0000-4000-8000-000000000001','one','failed',null,public.router_test_metadata(null,'openrouter','free')),'finish failed governor execution');
select public.ai_test_assert(public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000001','one','classification',2,'openrouter','pool','fixture/different:free',100,public.quota_test_limits())->>'outcome'='execution_inactive','failed execution cannot dispatch again');
select public.ai_test_assert(public.read_ai_provider_quota('00000000-0000-4000-8000-000000000001','openrouter','pool')->>'requestsInDay'='1','failed attempt not refunded');
reset role;

do $$ begin
 perform public.ai_test_assert(not has_table_privilege('anon','public.ai_provider_attempts','select'),'anon attempts denied');
 perform public.ai_test_assert(not has_table_privilege('authenticated','public.ai_provider_quota_buckets','select'),'authenticated quota denied');
 perform public.ai_test_assert(not has_function_privilege('authenticated','public.reserve_ai_provider_attempt(uuid,text,text,integer,text,text,text,integer,jsonb)','execute'),'authenticated RPC denied');
 perform public.ai_test_assert((select relrowsecurity from pg_class where oid='public.ai_provider_attempts'::regclass),'attempt RLS');
 perform public.ai_test_assert((select relrowsecurity from pg_class where oid='public.ai_provider_quota_buckets'::regclass),'quota RLS');
 perform public.ai_test_assert(('2026-11-02 00:00'::timestamp at time zone 'America/Los_Angeles')-('2026-11-01 00:00'::timestamp at time zone 'America/Los_Angeles')=interval '25 hours','Pacific fall day is25h');
 perform public.ai_test_assert(('2026-03-09 00:00'::timestamp at time zone 'America/Los_Angeles')-('2026-03-08 00:00'::timestamp at time zone 'America/Los_Angeles')=interval '23 hours','Pacific spring day is23h');
end; $$;

-- Same instant belongs to different provider days; exercise actual quota queries.
do $$ declare
 g timestamptz:=((clock_timestamp() at time zone 'America/Los_Angeles')::date)::timestamp at time zone 'America/Los_Angeles';
 u timestamptz:=((clock_timestamp() at time zone 'UTC')::date)::timestamp at time zone 'UTC';
 historical timestamptz; g_expected text; u_expected text;
begin
 historical:=least(g,u)+(greatest(g,u)-least(g,u))/2;
 g_expected:=case when historical>=g then 'day_limit' else 'reserved' end;
 u_expected:=case when historical>=u then 'day_limit' else 'reserved' end;
 perform public.quota_test_execution('00000000-0000-4000-8000-000000000004','tz-g-old');
 perform public.quota_test_execution('00000000-0000-4000-8000-000000000004','tz-g-now');
 perform public.quota_test_execution('00000000-0000-4000-8000-000000000004','tz-u-old');
 perform public.quota_test_execution('00000000-0000-4000-8000-000000000004','tz-u-now');
 perform public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000004','tz-g-old','classification',1,'gemini','tz-project','gemini-free',10,public.quota_test_limits(20,1));
 perform public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000004','tz-u-old','classification',1,'openrouter','tz-account','fixture/free:free',10,public.quota_test_limits(20,1));
 update public.ai_provider_attempts set created_at=historical where request_id in ('tz-g-old','tz-u-old');
 perform public.ai_test_assert(public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000004','tz-g-now','classification',1,'gemini','tz-project','gemini-free',10,public.quota_test_limits(20,1))->>'outcome'=g_expected,'actual Gemini Pacific day');
 perform public.ai_test_assert(public.reserve_ai_provider_attempt('00000000-0000-4000-8000-000000000004','tz-u-now','classification',1,'openrouter','tz-account','fixture/free:free',10,public.quota_test_limits(20,1))->>'outcome'=u_expected,'actual OpenRouter UTC day');
end; $$;

-- Prepare outer reservations for two real eight-connection concurrency groups.
set role service_role;
do $$ declare uid uuid; i integer; begin
 for i in 1..8 loop
   uid:=('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
   perform public.quota_test_execution(uid,'parallel-'||i);
 end loop;
 perform public.quota_test_execution('00000000-0000-4000-8000-000000000008','same-attempt');
end; $$;
reset role;
