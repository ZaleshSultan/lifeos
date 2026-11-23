-- Disposable migrated Postgres. All fixture data is rolled back.
begin;
do $$
declare
  owner_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
  session_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid(); req uuid:=gen_random_uuid();
  set_id uuid; old_row public.workout_sets; doc jsonb; edited jsonb;
  seed jsonb:='[{"key":"press","name":"Fixture incline press","mode":"dumbbells","variant":"","baseKg":null,"step":1,"sets":[{"slot":"s1","weightKg":9,"reps":12,"warmup":false}]}]';
  command jsonb;
begin
  if has_function_privilege('authenticated','public.change_personal_workout(uuid,uuid,integer,uuid,jsonb)','execute')
    or has_function_privilege('anon','public.personal_workout_template(uuid,jsonb,integer)','execute')
    or has_function_privilege('authenticated','public.start_personal_workout(uuid,uuid)','execute')
    then raise exception 'unexpected browser RPC access'; end if;
  insert into auth.users(id) values(owner_id),(other_id);
  perform set_config('request.jwt.claim.role','service_role',true);
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  doc:=public.personal_workout_template(owner_id,seed);
  if doc<>public.personal_workout_template(owner_id,seed) or exists(select from workouts where user_id=owner_id)
    then raise exception 'initialization changed records'; end if;
  perform public.start_personal_workout(owner_id,session_id);
  perform public.start_personal_workout(owner_id,gen_random_uuid());
  if (select count(*) from workouts where user_id=owner_id)<>1 or exists(select from workout_sets where user_id=owner_id and completed)
    then raise exception 'start duplicated session or counted plan'; end if;
  select id into strict set_id from workout_sets where workout_id=session_id;
  command:=jsonb_build_object('kind','set','id',set_id,'reps',12,'weightKg',9,'warmup',false,'completed',true);
  begin
    perform public.change_personal_workout(other_id,session_id,0,req,command);
    raise exception 'foreign write accepted';
  exception when raise_exception then if sqlerrm<>'workout_not_found' then raise; end if; end;
  perform public.change_personal_workout(owner_id,session_id,0,req,command);
  perform public.change_personal_workout(owner_id,session_id,0,req,command);
  begin
    perform public.change_personal_workout(owner_id,session_id,0,gen_random_uuid(),command);
    raise exception 'stale write accepted';
  exception when raise_exception then if sqlerrm<>'workout_conflict' then raise; end if; end;
  req:=gen_random_uuid();
  perform public.change_personal_workout(owner_id,session_id,1,req,'{"kind":"finish"}');
  perform public.change_personal_workout(owner_id,session_id,1,req,'{"kind":"finish"}');
  if (select count(*) from life_entities where user_id=owner_id and linked_id=session_id)<>1 or
     (select count(*) from obsidian_sync_queue where user_id=owner_id)<>1 then raise exception 'completion projection duplicated'; end if;
  select * into strict old_row from workout_sets where workout_id=session_id;
  edited:=jsonb_set(seed,'{0,step}','0.25');
  edited:=jsonb_set(edited,'{0,sets,0,weightKg}','15');
  doc:=public.personal_workout_template(owner_id,edited,0);
  if public.personal_workout_template(owner_id,seed)<>doc then raise exception 'reseed overwrote edits'; end if;
  perform public.start_personal_workout(owner_id,second_id);
  if (select weight_kg from workout_sets where workout_id=second_id)<>9 then raise exception 'previous result missing'; end if;
  if (select to_jsonb(s) from workout_sets s where workout_id=session_id)<>to_jsonb(old_row)
     then raise exception 'history changed'; end if;
end $$;
rollback;
