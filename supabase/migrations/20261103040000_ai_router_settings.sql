begin;

-- These are routing preferences, not credentials. Provider keys stay in server
-- environment configuration; plan credentials have their separate protected store.
create function public.ai_router_settings_valid(p_settings jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare
 v_key text; v_value jsonb; v_array jsonb; v_item jsonb;
 v_providers text[]:=array['gemini','openrouter','openai','anthropic','chatgpt_plan'];
 v_tiers text[]:=array['deterministic','fast','balanced','advanced','vision','voice'];
 v_categories text[]:=array['general','health','finance','university'];
begin
 if p_settings is null or jsonb_typeof(p_settings)<>'object' or octet_length(p_settings::text)>32768 then return false;end if;
 if not(p_settings?&array['version','mode','allowedTiers','allowedProviders','manualModelId','tierModels','privacy','spending','fallback'])
 or exists(select from jsonb_object_keys(p_settings) k where k not in ('version','mode','allowedTiers','allowedProviders','manualModelId','tierModels','privacy','spending','fallback')) then return false;end if;
 if p_settings->'version'<>'1'::jsonb or jsonb_typeof(p_settings->'mode') is distinct from 'string' or p_settings->>'mode' not in ('auto','manual') then return false;end if;
 foreach v_key in array array['allowedTiers','allowedProviders'] loop
  v_array:=p_settings->v_key;
  if jsonb_typeof(v_array) is distinct from 'array' then return false;end if;
  if jsonb_array_length(v_array)>(case when v_key='allowedTiers' then 6 else 5 end) then return false;end if;
  if exists(select from jsonb_array_elements(v_array) e group by e having count(*)>1) then return false;end if;
  for v_item in select value from jsonb_array_elements(v_array) loop
   if jsonb_typeof(v_item)<>'string' or not((v_item#>>'{}')=any(case when v_key='allowedTiers' then v_tiers else v_providers end)) then return false;end if;
  end loop;
 end loop;
 v_value:=p_settings->'manualModelId';
 if jsonb_typeof(v_value) not in ('null','string') then return false;end if;
 if jsonb_typeof(v_value)='string' and ((v_value#>>'{}')!~'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$' or position('://' in (v_value#>>'{}'))>0) then return false;end if;
 v_value:=p_settings->'tierModels';
 if jsonb_typeof(v_value) is distinct from 'object' then return false;end if;
 if not(v_value?&array['fast','balanced','advanced','vision','voice']) or exists(select from jsonb_object_keys(v_value) k where k not in ('fast','balanced','advanced','vision','voice')) then return false;end if;
 foreach v_key in array array['fast','balanced','advanced','vision','voice'] loop
  v_array:=v_value->v_key;
  if jsonb_typeof(v_array) is distinct from 'array' then return false;end if;
  if jsonb_array_length(v_array)>12 or exists(select from jsonb_array_elements(v_array) e group by e having count(*)>1) then return false;end if;
  for v_item in select value from jsonb_array_elements(v_array) loop
   if jsonb_typeof(v_item)<>'string' or (v_item#>>'{}')!~'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$' or position('://' in (v_item#>>'{}'))>0 then return false;end if;
  end loop;
 end loop;
 v_value:=p_settings->'privacy';
 if jsonb_typeof(v_value) is distinct from 'object' then return false;end if;
 if not(v_value?&v_categories) or exists(select from jsonb_object_keys(v_value) k where not(k=any(v_categories))) then return false;end if;
 foreach v_key in array v_categories loop
  v_array:=v_value->v_key;
  if jsonb_typeof(v_array) is distinct from 'array' then return false;end if;
  if jsonb_array_length(v_array)>5 or exists(select from jsonb_array_elements(v_array) e group by e having count(*)>1) then return false;end if;
  for v_item in select value from jsonb_array_elements(v_array) loop
   if jsonb_typeof(v_item)<>'string' or not((v_item#>>'{}')=any(v_providers)) then return false;end if;
  end loop;
 end loop;
 v_value:=p_settings->'spending';
 if jsonb_typeof(v_value) is distinct from 'object' then return false;end if;
 if not(v_value?&array['paidCallsAuthorized','maxRequestCostMicros','maxDailyCostMicros']) or exists(select from jsonb_object_keys(v_value) k where k not in ('paidCallsAuthorized','maxRequestCostMicros','maxDailyCostMicros')) then return false;end if;
 if jsonb_typeof(v_value->'paidCallsAuthorized') is distinct from 'boolean' then return false;end if;
 foreach v_key in array array['maxRequestCostMicros','maxDailyCostMicros'] loop
  if jsonb_typeof(v_value->v_key) is distinct from 'number' then return false;end if;
  if (v_value->>v_key)!~'^[0-9]+$' or (v_value->>v_key)::numeric>1000000000000 then return false;end if;
 end loop;
 v_value:=p_settings->'fallback';
 if jsonb_typeof(v_value) is distinct from 'object' then return false;end if;
 if not(v_value?&array['enabled','maxAttempts','allowProviderChange']) or exists(select from jsonb_object_keys(v_value) k where k not in ('enabled','maxAttempts','allowProviderChange')) then return false;end if;
 if jsonb_typeof(v_value->'enabled') is distinct from 'boolean' or jsonb_typeof(v_value->'allowProviderChange') is distinct from 'boolean' or jsonb_typeof(v_value->'maxAttempts') is distinct from 'number' then return false;end if;
 if (v_value->>'maxAttempts')!~'^[1-3]$' then return false;end if;
 return true;
end;$$;
revoke all on function public.ai_router_settings_valid(jsonb) from public,anon,authenticated;
grant execute on function public.ai_router_settings_valid(jsonb) to service_role;

create table public.ai_router_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 settings jsonb not null check(public.ai_router_settings_valid(settings)),
 revision integer not null default 1 check(revision>0),
 updated_at timestamptz not null default clock_timestamp()
);
alter table public.ai_router_settings enable row level security;
revoke all on public.ai_router_settings from public,anon,authenticated,service_role;
grant select,insert,update on public.ai_router_settings to service_role;

create function public.save_ai_router_settings(p_user_id uuid,p_settings jsonb,p_expected_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_row public.ai_router_settings%rowtype;
begin
 if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=2147483647 or not public.ai_router_settings_valid(p_settings) then raise exception using errcode='22023',message='invalid_ai_router_settings';end if;
 -- Serialize first writes, updates and profile blocking against the canonical owner.
 perform 1 from public.profiles where user_id=p_user_id and status='active' for update;
 if not found then raise exception using errcode='42501',message='profile_inactive';end if;
 select * into v_row from public.ai_router_settings where user_id=p_user_id for update;
 if found then
  if v_row.settings=p_settings and p_expected_revision<=v_row.revision then return jsonb_build_object('settings',v_row.settings,'revision',v_row.revision);end if;
  if v_row.revision<>p_expected_revision then raise exception using errcode='P0001',message='ai_router_settings_conflict';end if;
  update public.ai_router_settings set settings=p_settings,revision=revision+1,updated_at=clock_timestamp() where user_id=p_user_id returning * into v_row;
 else
  if p_expected_revision<>0 then raise exception using errcode='P0001',message='ai_router_settings_conflict';end if;
  insert into public.ai_router_settings(user_id,settings)values(p_user_id,p_settings)returning * into v_row;
 end if;
 return jsonb_build_object('settings',v_row.settings,'revision',v_row.revision);
end;$$;
revoke all on function public.save_ai_router_settings(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.save_ai_router_settings(uuid,jsonb,integer) to service_role;
commit;
