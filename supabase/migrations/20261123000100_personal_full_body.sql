-- Keep the personal template separate from the editable multi-day program.
alter table public.user_settings add column if not exists personal_workout jsonb;
create or replace function public.personal_workout_template(p_user uuid, p_exercises jsonb, p_revision integer default null)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare doc jsonb;
begin
  insert into public.user_settings(user_id,personal_workout)
  values(p_user,jsonb_build_object('revision',0,'exercises',p_exercises))
  on conflict(user_id) do nothing;
  select personal_workout into doc from public.user_settings where user_id=p_user for update;
  if doc is null then
    doc := jsonb_build_object('revision',0,'exercises',p_exercises);
  end if;
  if p_revision is not null then
    if (doc->>'revision')::int <> p_revision then
      if doc->'exercises'=p_exercises then return doc; end if;
      raise exception 'workout_conflict';
    end if;
    doc := jsonb_build_object('revision',p_revision+1,'exercises',p_exercises);
  end if;
  update public.user_settings set personal_workout=doc where user_id=p_user and personal_workout is distinct from doc;
  return doc;
end $$;

create index if not exists workout_sets_personal_progress on public.workout_sets(user_id,(metadata->>'liftKey'),workout_id)
where completed and metadata ? 'liftKey';

create or replace function public.start_personal_workout(p_user uuid, p_id uuid)
returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare tpl jsonb; ex jsonb; planned jsonb; snapshots jsonb := '[]'; catalog jsonb := '{}'; prior jsonb; last_set jsonb;
  ex_id uuid; active uuid; pos integer; ex_pos integer:=0;
begin
  select personal_workout into tpl from public.user_settings where user_id=p_user for update;
  if tpl is null then raise exception 'workout_template_missing'; end if;
  if exists(select 1 from public.workouts where user_id=p_user and id=p_id) then return p_id; end if;
  select id into active from public.workouts where user_id=p_user and ended_at is null order by started_at desc limit 1;
  if active is not null then return active; end if;
  insert into public.workouts(id,user_id,title,workout_type,metadata)
    values(p_id,p_user,'Мой Full Body','strength',jsonb_build_object('source','tma','personalRevision',0));
  for ex in select value from jsonb_array_elements(tpl->'exercises') loop
    -- Preserve exercise identity separately from the historical name and equipment snapshot.
    select id into ex_id from public.fitness_exercises where user_id=p_user and name=ex->>'name'
      order by created_at,id limit 1;
    if ex_id is null then
      insert into public.fitness_exercises(user_id,name,category,equipment) values(p_user,ex->>'name','strength',ex->>'mode') returning id into ex_id;
    end if;
    -- A partial session can leave a slot empty. Keep the latest confirmed
    -- result for each stable slot and warm-up status on comparable equipment.
    select coalesce(jsonb_agg(to_jsonb(last_set_row) order by last_set_row.index),'[]')
      into prior from (
        select distinct on (s.metadata->>'slot',s.metadata->'warmup')
          s.metadata->>'slot' as slot, s.set_index as index, s.metadata->'warmup' as warmup,
          s.weight_kg as "weightKg", s.reps, w.ended_at as "performedAt"
        from public.workout_sets s
        join public.workouts w on w.user_id=s.user_id and w.id=s.workout_id
        cross join lateral jsonb_array_elements(w.metadata->'personalLifts') h
        where s.user_id=p_user and s.completed and s.metadata ? 'liftKey'
          and s.metadata->>'liftKey'=ex->>'key' and w.ended_at is not null
          and (h - array['order','previous','step']) = (ex - array['sets','step'])
        order by s.metadata->>'slot', s.metadata->'warmup', w.ended_at desc, w.id, s.id
      ) last_set_row;
    catalog := catalog || jsonb_build_object(ex->>'key',ex_id);
    snapshots := snapshots || jsonb_build_array((ex-'sets') || jsonb_build_object('previous',prior,'order',ex_pos));
    ex_pos := ex_pos + 1;
    pos := 0;
    for planned in select value from jsonb_array_elements(ex->'sets') loop
      pos := pos+1;
      select value into last_set from jsonb_array_elements(prior)
        where value->>'slot'=planned->>'slot' and value->'warmup'=planned->'warmup' limit 1;
      insert into public.workout_sets(user_id,workout_id,exercise_id,set_index,reps,weight_kg,completed,rest_seconds,metadata)
        values(p_user,p_id,ex_id,pos,coalesce(last_set->>'reps',planned->>'reps')::int,
          coalesce(last_set->>'weightKg',planned->>'weightKg')::numeric,false,90,
          jsonb_build_object('liftKey',ex->>'key','slot',planned->>'slot','warmup',planned->'warmup'));
    end loop;
  end loop;
  update public.workouts set metadata=metadata || jsonb_build_object('personalLifts',snapshots,'personalCatalog',catalog) where user_id=p_user and id=p_id;
  return p_id;
end $$;

-- A workout lock serializes updates with finish. A retry either replays the last
-- response or encounters a newer revision without applying an old change.
create or replace function public.change_personal_workout(p_user uuid,p_id uuid,p_revision integer,p_request uuid,p_change jsonb)
returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare w public.workouts%rowtype; k text:=p_change->>'kind'; sid uuid:=(p_change->>'id')::uuid;
  next_pos integer; exercise_id_value uuid; lift_key text; set_count integer; finish_at timestamptz;
  load_index text; template_index text; template_doc jsonb; snapshot jsonb;
begin
  select * into w from public.workouts where user_id=p_user and id=p_id and metadata ? 'personalRevision' for update;
  if not found then raise exception 'workout_not_found'; end if;
  if w.metadata->>'lastRequest'=p_request::text then return p_id; end if;
  if w.ended_at is not null or (w.metadata->>'personalRevision')::int<>p_revision then raise exception 'workout_conflict'; end if;
  case k
    when 'set' then
      update public.workout_sets set reps=(p_change->>'reps')::int,weight_kg=(p_change->>'weightKg')::numeric,
        completed=(p_change->>'completed')::boolean,
        completed_at=case when (p_change->>'completed')::boolean then coalesce(completed_at,clock_timestamp()) end,
        metadata=metadata || jsonb_build_object('warmup',p_change->'warmup')
      where id=sid and user_id=p_user and workout_id=p_id;
      if not found then raise exception 'workout_not_found'; end if;
    when 'add' then
      lift_key:=p_change->>'exercise';
      select count(*),coalesce(max(set_index),0)+1 into set_count,next_pos
        from public.workout_sets where user_id=p_user and workout_id=p_id and metadata->>'liftKey'=lift_key;
      exercise_id_value:=(w.metadata->'personalCatalog'->>lift_key)::uuid;
      if exercise_id_value is null or set_count>=30 then raise exception 'workout_set_limit'; end if;
      insert into public.workout_sets(id,user_id,workout_id,exercise_id,set_index,reps,weight_kg,completed,rest_seconds,metadata)
      values(sid,p_user,p_id,exercise_id_value,next_pos,(p_change->>'reps')::int,(p_change->>'weightKg')::numeric,false,90,
        jsonb_build_object('liftKey',lift_key,'slot','extra-'||next_pos,'warmup',p_change->'warmup'));
    when 'remove' then
      select metadata->>'liftKey' into lift_key from public.workout_sets where user_id=p_user and workout_id=p_id and id=sid;
      if lift_key is null then raise exception 'workout_not_found'; end if;
      delete from public.workout_sets where user_id=p_user and workout_id=p_id and id=sid;
    when 'step' then
      select (ordinality-1)::text,value into load_index,snapshot
        from jsonb_array_elements(w.metadata->'personalLifts') with ordinality where value->>'key'=p_change->>'exercise';
      if load_index is null then raise exception 'workout_not_found'; end if;
      update public.workouts set metadata=jsonb_set(metadata,array['personalLifts',load_index,'step'],p_change->'step')
        where user_id=p_user and id=p_id;
      select personal_workout into template_doc from public.user_settings where user_id=p_user for update;
      select (ordinality-1)::text into template_index from jsonb_array_elements(template_doc->'exercises') with ordinality
        where (value-array['sets','step'])=(snapshot-array['order','previous','step']);
      if template_index is not null then
        update public.user_settings set personal_workout=jsonb_set(template_doc,array['exercises',template_index,'step'],p_change->'step')
          || jsonb_build_object('revision',(template_doc->>'revision')::int+1) where user_id=p_user;
      end if;
    when 'note' then
      update public.workouts set notes=p_change->>'text' where user_id=p_user and id=p_id;
    when 'finish' then
      if not exists(select 1 from public.workout_sets where user_id=p_user and workout_id=p_id and completed) then
        raise exception 'workout_empty'; end if;
      finish_at:=greatest(clock_timestamp(),w.started_at + interval '1 millisecond');
      update public.workouts set ended_at=finish_at,duration_minutes=greatest(1,ceil(extract(epoch from finish_at-w.started_at)/60)::int)
        where user_id=p_user and id=p_id;
      perform public.create_life_entity_with_sync(p_user_id=>p_user,p_entity_type=>'workout',p_title=>w.title,
        p_body=>concat_ws(E'\n',nullif(w.notes,''),(select string_agg(
          format('%s · %s кг × %s%s',e->>'name',s.weight_kg,s.reps,case when e->>'mode'='dumbbells' then ' · 2 гантели' else '' end),
          E'\n' order by (e->>'order')::int,s.set_index)
          from public.workout_sets s join lateral jsonb_array_elements(w.metadata->'personalLifts') e
            on e->>'key'=s.metadata->>'liftKey' where s.user_id=p_user and s.workout_id=p_id and s.completed)),
        p_status=>'completed',p_source=>'tma',p_linked_table=>'workouts',p_linked_id=>p_id,
        p_metadata=>jsonb_build_object('workoutId',p_id,'completedAt',finish_at),
        p_sync_payload=>jsonb_build_object('workoutId',p_id,'completedAt',finish_at,'entityType','workout'));
    else raise exception 'invalid_workout_input';
  end case;
  update public.workouts set metadata=metadata || jsonb_build_object('personalRevision',p_revision+1,'lastRequest',p_request)
    where user_id=p_user and id=p_id;
  return p_id;
end $$;
revoke all on function public.personal_workout_template(uuid,jsonb,integer),public.start_personal_workout(uuid,uuid),public.change_personal_workout(uuid,uuid,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.personal_workout_template(uuid,jsonb,integer),public.start_personal_workout(uuid,uuid),public.change_personal_workout(uuid,uuid,integer,uuid,jsonb) to service_role;
