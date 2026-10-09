-- Additive study workspace. Existing assessments, Moodle results and metadata stay intact.
begin;

create unique index if not exists study_courses_user_id_id_uidx on public.study_courses(user_id, id);
create unique index if not exists assessment_items_course_id_id_uidx on public.assessment_items(study_course_id, id);

create or replace function public.study_definition_valid(value jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare field jsonb; requirement jsonb; sums jsonb := '{"att1":0,"att2":0,"exam":0}'; ids text[] := '{}'; requirement_ids text[] := '{}'; period text; weight numeric;
begin
  if jsonb_typeof(value) is distinct from 'object' or value->>'version' is distinct from '1' or jsonb_typeof(value->'fields') is distinct from 'array'
    or jsonb_array_length(value->'fields') not between 3 and 100
    or jsonb_typeof(value->'sourceName') is distinct from 'string' or coalesce(length(btrim(value->>'sourceName')),0) not between 1 and 200
    or jsonb_typeof(value->'attestationThreshold') is distinct from 'number'
    or (value->>'attestationThreshold')::numeric not between 0 and 100 then return false; end if;
  if value ? 'verification' and value->>'verification' not in ('verified','needs_review') then return false; end if;
  for field in select * from jsonb_array_elements(value->'fields') loop
    period := field->>'period'; weight := (field->>'weightPercent')::numeric;
    if period is null or period not in ('att1','att2','exam') or jsonb_typeof(field->'weightPercent') is distinct from 'number' or weight is null or weight <= 0 or weight > 100
      or jsonb_typeof(field->'id') is distinct from 'string' or field->>'id' is null or field->>'id' !~ '^[a-z0-9][a-z0-9_-]{0,79}$' or field->>'id' in ('constructor','prototype')
      or field->>'id' = any(ids) or jsonb_typeof(field->'label') is distinct from 'string' or coalesce(length(btrim(field->>'label')),0) not between 1 and 300
      or (field ? 'maxScore' and (jsonb_typeof(field->'maxScore') is distinct from 'number' or (field->>'maxScore')::numeric <= 0))
      or (field ? 'pointStep' and (jsonb_typeof(field->'pointStep') is distinct from 'number' or (field->>'pointStep')::numeric <= 0 or (field->>'pointStep')::numeric > coalesce((field->>'maxScore')::numeric,100)))
      or (field ? 'sourcePage' and (jsonb_typeof(field->'sourcePage') is distinct from 'number' or (field->>'sourcePage')::numeric < 1 or (field->>'sourcePage')::numeric <> trunc((field->>'sourcePage')::numeric)))
      or (field ? 'maxScoreSourcePage' and (jsonb_typeof(field->'maxScoreSourcePage') is distinct from 'number' or (field->>'maxScoreSourcePage')::numeric < 1 or (field->>'maxScoreSourcePage')::numeric <> trunc((field->>'maxScoreSourcePage')::numeric)))
      or (field ? 'sourceDocument' and (jsonb_typeof(field->'sourceDocument') is distinct from 'string' or length(field->>'sourceDocument') > 300))
      or (field ? 'type' and (jsonb_typeof(field->'type') is distinct from 'string' or length(field->>'type') > 80))
      or (field ? 'verification' and coalesce(field->>'verification','') not in ('verified','needs_review')) then return false; end if;
    ids := array_append(ids, field->>'id');
    sums := jsonb_set(sums, array[period], to_jsonb((sums->>period)::numeric + weight));
  end loop;
  if value ? 'topLevelWeights' then
    if jsonb_typeof(value->'topLevelWeights') is distinct from 'object'
      or jsonb_typeof(value->'topLevelWeights'->'att1') is distinct from 'number'
      or jsonb_typeof(value->'topLevelWeights'->'att2') is distinct from 'number'
      or jsonb_typeof(value->'topLevelWeights'->'exam') is distinct from 'number'
      or (value->'topLevelWeights'->>'att1')::numeric not between 0 and 100
      or (value->'topLevelWeights'->>'att2')::numeric not between 0 and 100
      or (value->'topLevelWeights'->>'exam')::numeric not between 0 and 100
      or abs((value->'topLevelWeights'->>'att1')::numeric+(value->'topLevelWeights'->>'att2')::numeric+(value->'topLevelWeights'->>'exam')::numeric-100)>0.0000001 then return false; end if;
  end if;
  if value ? 'requirements' then
    if jsonb_typeof(value->'requirements') is distinct from 'array' or jsonb_array_length(value->'requirements')>100 then return false; end if;
    for requirement in select * from jsonb_array_elements(value->'requirements') loop
      if jsonb_typeof(requirement->'id') is distinct from 'string' or coalesce(length(btrim(requirement->>'id')),0) not between 1 and 80 or requirement->>'id'=any(requirement_ids)
        or jsonb_typeof(requirement->'label') is distinct from 'string' or coalesce(length(btrim(requirement->>'label')),0) not between 1 and 500
        or jsonb_typeof(requirement->'minimumPercent') is distinct from 'number' or (requirement->>'minimumPercent')::numeric not between 0 and 100
        or coalesce(requirement->>'verification','') not in ('verified','needs_review')
        or coalesce(requirement->>'kind','') not in ('period_minimum','component_minimum','attendance_minimum')
        or (requirement->>'kind'='period_minimum' and coalesce(requirement->>'period','') not in ('att1','att2','exam'))
        or (requirement->>'kind'='component_minimum' and not coalesce(requirement->>'fieldId'=any(ids),false)) then return false; end if;
      requirement_ids:=array_append(requirement_ids,requirement->>'id');
    end loop;
  end if;
  return coalesce(abs((sums->>'att1')::numeric-100)<0.0000001 and abs((sums->>'att2')::numeric-100)<0.0000001 and abs((sums->>'exam')::numeric-100)<0.0000001,false);
exception when others then return false;
end $$;

create table if not exists public.syllabus_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  study_course_id uuid not null,
  version integer not null default 1 check (version > 0),
  file_name text not null check (length(file_name) between 1 and 240),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  pdf_base64 text,
  has_content boolean generated always as (pdf_base64 is not null) stored,
  extraction_status text not null default 'needs_review' check (extraction_status in ('needs_review','verified')),
  source_pages jsonb not null default '[]',
  notes jsonb not null default '[]',
  uploaded_at timestamptz not null default now(),
  foreign key(user_id, study_course_id) references public.study_courses(user_id,id),
  unique(user_id, study_course_id, sha256), unique(user_id, study_course_id, version),
  unique(user_id, study_course_id, id),
  check (pdf_base64 is null or length(pdf_base64) <= 83886080)
);

create table if not exists public.grading_schemes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  study_course_id uuid not null,
  document_id uuid,
  version integer not null default 1 check(version > 0),
  definition jsonb not null check(public.study_definition_valid(definition)),
  verification text not null default 'needs_review' check(verification in ('needs_review','verified','user_confirmed')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key(user_id, study_course_id) references public.study_courses(user_id,id),
  foreign key(user_id, study_course_id, document_id) references public.syllabus_documents(user_id,study_course_id,id),
  unique(user_id, study_course_id, version),
  unique(user_id, study_course_id, id),
  check (not is_active or verification <> 'needs_review')
);
create unique index if not exists grading_schemes_active_uidx on public.grading_schemes(user_id,study_course_id) where is_active;

create table if not exists public.assessment_grade_overrides (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  study_course_id uuid not null, assessment_id uuid not null,
  earned numeric not null, max_score numeric not null check(max_score > 0),
  note text check(length(note) <= 2000), updated_at timestamptz not null default now(),
  foreign key(user_id,study_course_id) references public.study_courses(user_id,id),
  foreign key(study_course_id,assessment_id) references public.assessment_items(study_course_id,id),
  unique(user_id,assessment_id), check(earned >= 0 and earned <= max_score)
);
create table if not exists public.assessment_component_mappings (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  study_course_id uuid not null, assessment_id uuid not null,
  component_id text not null check(component_id ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  scheme_id uuid not null,
  updated_at timestamptz not null default now(),
  foreign key(user_id,study_course_id) references public.study_courses(user_id,id),
  foreign key(study_course_id,assessment_id) references public.assessment_items(study_course_id,id),
  foreign key(user_id,study_course_id,scheme_id) references public.grading_schemes(user_id,study_course_id,id),
  unique(user_id,assessment_id), unique(user_id,study_course_id,scheme_id,component_id)
);

create or replace function public.check_study_component_mapping() returns trigger language plpgsql set search_path=public as $$
begin
  if not exists(select 1 from public.grading_schemes s, jsonb_array_elements(s.definition->'fields') f
    where s.id=new.scheme_id and s.user_id=new.user_id and s.study_course_id=new.study_course_id and f->>'id'=new.component_id)
    then raise exception 'invalid_study_component'; end if;
  return new;
end $$;
drop trigger if exists check_study_component_mapping on public.assessment_component_mappings;
create trigger check_study_component_mapping before insert or update on public.assessment_component_mappings
  for each row execute function public.check_study_component_mapping();

do $$ declare table_name text; begin
  foreach table_name in array array['syllabus_documents','grading_schemes','assessment_grade_overrides','assessment_component_mappings'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=table_name and policyname=table_name||'_owner_access') then
      execute format('create policy %I on public.%I for all to authenticated using(public.lifeos_is_owner(user_id)) with check(public.lifeos_is_owner(user_id))', table_name||'_owner_access', table_name);
    end if;
    execute format('revoke all on public.%I from anon', table_name);
    execute format('grant select,insert,update,delete on public.%I to authenticated, service_role', table_name);
  end loop;
end $$;

-- Lock the owned parent and switch versions atomically; retain original calculator verbatim.
create or replace function public.activate_study_grading_scheme(p_user_id uuid,p_course_id uuid,p_scheme_id uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare current_metadata jsonb; selected_definition jsonb;
begin
  select metadata into current_metadata from public.study_courses
    where user_id=p_user_id and id=p_course_id for update;
  if not found then raise exception 'study_course_not_found'; end if;
  select definition into selected_definition from public.grading_schemes
    where user_id=p_user_id and study_course_id=p_course_id and id=p_scheme_id and verification <> 'needs_review';
  if not found then raise exception 'study_scheme_needs_review'; end if;
  update public.grading_schemes set is_active=false where user_id=p_user_id and study_course_id=p_course_id and is_active;
  update public.grading_schemes set is_active=true where user_id=p_user_id and study_course_id=p_course_id and id=p_scheme_id;
  if current_metadata ? 'study_calculator_v1' and not current_metadata ? 'study_calculator_original_v1' then
    update public.study_courses set metadata=current_metadata || jsonb_build_object('study_calculator_original_v1', current_metadata->'study_calculator_v1')
      where user_id=p_user_id and id=p_course_id;
  end if;
end $$;
revoke all on function public.activate_study_grading_scheme(uuid,uuid,uuid) from public, anon;
grant execute on function public.activate_study_grading_scheme(uuid,uuid,uuid) to authenticated,service_role;
commit;
