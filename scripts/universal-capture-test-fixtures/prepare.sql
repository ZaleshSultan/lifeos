alter table public.profiles add column status text not null default 'active';
insert into auth.users values('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000003');
insert into public.profiles(user_id,timezone)select id,'Asia/Almaty'from auth.users;
insert into public.life_captures(user_id,text,source,chat_id,message_id,metadata)values
 ('00000000-0000-4000-8000-000000000001','Existing original capture','old-import',101,202,'{"kept":true}'),
 ('00000000-0000-4000-8000-000000000001','Existing duplicate transport reference','telegram',101,202,'{}');
create table public.capture_test_legacy as select id,to_jsonb(c)as original from public.life_captures c;
create table public.capture_test_facts(key text primary key,payload jsonb not null);
create function public.capture_test_assert(ok boolean,message text)returns void language plpgsql as $$begin if ok is distinct from true then raise exception'Capture assertion failed: %',message;end if;end;$$;
create function public.capture_test_error(statement text,expected_message text)returns void language plpgsql as $$
begin
 begin execute statement;exception when others then
  if sqlerrm=expected_message then return;end if;
  raise exception'Expected error %, got %',expected_message,sqlerrm;
 end;
 raise exception'Expected error % but operation succeeded',expected_message;
end;$$;
create function public.capture_test_input(key text,content text default 'Remember a useful note')returns jsonb language sql as $$
 select jsonb_build_object('requestId',key,'inputType','text','text',content,'retentionDays',null,'source','web');
$$;
