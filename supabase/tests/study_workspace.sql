-- Run only against the disposable cluster created by scripts/test-study-postgres.sh.
\set ON_ERROR_STOP on
insert into auth.users(id,email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a@example.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b@example.invalid');
insert into public.study_courses(id,user_id,code,title,metadata) values
  ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','DMS52-EN','Existing DBMS','{"untouched":"keep","study_calculator_v1":{"values":{"dms-a1":90},"target":75}}'),
  ('bbbbbbbb-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','OS 2207','Operating Systems','{}');
insert into public.assessment_items(id,study_course_id,title,source,external_id,max_score,actual_score) values
  ('aaaaaaaa-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001','Assignment 1','moodle','academic:moodle:42:9',30,15),
  ('bbbbbbbb-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000001','Private Assignment','moodle','academic:moodle:43:8',100,90);
grant select,insert,update,delete on public.study_courses,public.assessment_items to authenticated;
insert into public.syllabus_documents(id,user_id,study_course_id,file_name,sha256,pdf_base64,extraction_status) values
  ('aaaaaaaa-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','a.pdf',repeat('a',64),'JVBERi0xLjQK','verified'),
  ('bbbbbbbb-0000-4000-8000-000000000003','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-0000-4000-8000-000000000001','b.pdf',repeat('b',64),'JVBERi0xLjQK','verified');
insert into public.grading_schemes(id,user_id,study_course_id,document_id,definition,verification,is_active)
select 'aaaaaaaa-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000003',definition||'{"sourceName":"Existing user scheme"}','user_confirmed',true
from public.study_scheme_templates where key='dbms-2026-2027';
insert into public.assessment_grade_overrides(user_id,study_course_id,assessment_id,earned,max_score,note) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002',27,30,'Manual override survives sync');
insert into public.assessment_component_mappings(user_id,study_course_id,assessment_id,scheme_id,component_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000004','dms-a1');

set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
do $$ declare table_name text; foreign_count integer; begin
  foreach table_name in array array['syllabus_documents','grading_schemes','assessment_grade_overrides','assessment_component_mappings'] loop
    execute format('select count(*) from public.%I where user_id <> auth.uid()',table_name) into foreign_count;
    if foreign_count<>0 then raise exception 'RLS leak in %',table_name; end if;
  end loop;
  if (select count(*) from public.assessment_items)<>1 then raise exception 'Assessment RLS leak'; end if;
  begin
    insert into public.syllabus_documents(user_id,study_course_id,file_name,sha256) values(auth.uid(),'bbbbbbbb-0000-4000-8000-000000000001','forged.pdf',repeat('c',64));
    raise exception 'Cross course write accepted';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.grading_schemes(user_id,study_course_id,document_id,version,definition)
      select auth.uid(),'aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000003',2,definition from public.study_scheme_templates where key='dbms-2026-2027';
    raise exception 'Cross document write accepted';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.assessment_grade_overrides(user_id,study_course_id,assessment_id,earned,max_score) values(auth.uid(),'aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000002',20,30);
    raise exception 'Cross assessment write accepted';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.assessment_grade_overrides(user_id,study_course_id,assessment_id,earned,max_score) values(auth.uid(),'aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002',31,30);
    raise exception 'Invalid score accepted';
  exception when check_violation then null; end;
  begin
    update public.assessment_component_mappings set component_id='invented' where user_id=auth.uid();
    raise exception 'Unknown component accepted';
  exception when raise_exception then if sqlerrm<>'invalid_study_component' then raise; end if; end;
  begin
    perform public.activate_study_grading_scheme('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000004');
    raise exception 'Foreign activation accepted';
  exception when raise_exception then if sqlerrm<>'study_course_not_found' then raise; end if; end;
  if public.study_definition_valid('{}') or public.study_definition_valid('null') or public.study_definition_valid('{"version":1,"fields":[]}') then raise exception 'Malformed scheme accepted'; end if;
end $$;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
do $$ begin
  if (select count(*) from public.assessment_items)<>1 or exists(select 1 from public.assessment_grade_overrides) or exists(select 1 from public.grading_schemes) then raise exception 'B sees A data'; end if;
  update public.syllabus_documents set file_name='stolen.pdf' where id='aaaaaaaa-0000-4000-8000-000000000003';
  if found then raise exception 'B updated A document'; end if;
end $$;
reset role;
update public.assessment_items set actual_score=18 where id='aaaaaaaa-0000-4000-8000-000000000002';

-- Rerun the data migration after real courses exist: preserve custom active definition/grades.
\ir ../migrations/20261008000200_study_syllabus_seeds.sql
\ir ../migrations/20261008000200_study_syllabus_seeds.sql
do $$ begin
  if (select actual_score from public.assessment_items where id='aaaaaaaa-0000-4000-8000-000000000002')<>18 then raise exception 'Seed overwrote LMS grade'; end if;
  if (select earned from public.assessment_grade_overrides where assessment_id='aaaaaaaa-0000-4000-8000-000000000002')<>27 then raise exception 'Sync overwrote manual override'; end if;
  if (select metadata->>'untouched' from public.study_courses where id='aaaaaaaa-0000-4000-8000-000000000001')<>'keep' then raise exception 'Seed overwrote metadata'; end if;
  if (select count(*) from public.grading_schemes where study_course_id='aaaaaaaa-0000-4000-8000-000000000001')<>2 then raise exception 'Seed not idempotent'; end if;
  if not exists(select 1 from public.grading_schemes where id='aaaaaaaa-0000-4000-8000-000000000004' and is_active) then raise exception 'Seed replaced custom calculator'; end if;
  if not exists(select 1 from public.grading_schemes where study_course_id='bbbbbbbb-0000-4000-8000-000000000001' and is_active and verification='verified') then raise exception 'Fresh course missing verified active scheme'; end if;
  if (select count(*) from public.study_scheme_templates)<>5 then raise exception 'Expected five verified templates'; end if;
end $$;
select 'OK: A/B RLS, relational ownership, component validation, override persistence, safe idempotent seeds' result;
