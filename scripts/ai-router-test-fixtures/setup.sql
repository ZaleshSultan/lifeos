create function public.router_test_settings() returns jsonb language sql immutable as $$
 select '{"version":1,"mode":"auto","allowedTiers":["deterministic"],"allowedProviders":[],"manualModelId":null,"tierModels":{"fast":[],"balanced":[],"advanced":[],"vision":[],"voice":[]},"privacy":{"general":[],"health":[],"finance":[],"university":[]},"spending":{"paidCallsAuthorized":false,"maxRequestCostMicros":0,"maxDailyCostMicros":0},"fallback":{"enabled":false,"maxAttempts":1,"allowProviderChange":false}}'::jsonb;
$$;
create function public.router_test_metadata(p_cost bigint default null,p_provider text default 'openrouter',p_billing text default 'api') returns jsonb language sql immutable as $$
 select jsonb_build_object('version',1,'provider',p_provider,'model','synthetic/model','selectedModelId','synthetic-model','credentialLabel','fixture-project','billing',p_billing,'attempts',1,'fallback',false,'inputTokens',null,'outputTokens',null,'reportedCostMicros',p_cost,'costSource',case when p_cost is null then 'unknown' else 'provider_reported' end);
$$;
