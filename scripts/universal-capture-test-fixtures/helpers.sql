create function public.capture_test_ready(key text,payloads jsonb,owner_id uuid default '00000000-0000-4000-8000-000000000001')returns jsonb language plpgsql as $$
declare captured jsonb;job jsonb;proposals jsonb;begin
 captured:=public.capture_service(owner_id,'ingest',null,null,public.capture_test_input(key))->'capture';
 job:=public.capture_service(owner_id,'claim',(captured->>'id')::uuid,null,jsonb_build_object('leaseToken','test-lease-'||key));
 select coalesce(jsonb_agg(value||jsonb_build_object('id','action-'||ord,'origin','deterministic','summary','Synthetic reviewed action','missingFields','[]'::jsonb)order by ord),'[]'::jsonb)into proposals from jsonb_array_elements(payloads)with ordinality x(value,ord);
 return public.capture_service(owner_id,'finish',(captured->>'id')::uuid,null,jsonb_build_object('leaseToken',job->'leaseToken','proposals',proposals));
end;$$;
create function public.capture_test_confirm(captured jsonb,selection jsonb,request_key text default 'test-approval-1',extra jsonb default '{}')returns jsonb language sql as $$
 select public.capture_service('00000000-0000-4000-8000-000000000001','confirm',(captured->>'id')::uuid,(captured->>'revision')::integer,jsonb_build_object('requestId',request_key,'expectedRevision',captured->'revision','actionIds',selection,'confirmed',true,'allowMemoryDelete',false)||extra);
$$;
