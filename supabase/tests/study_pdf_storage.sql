-- Disposable cluster only; no PDF bytes or production credentials are required.
\set ON_ERROR_STOP on
-- Deliberately unsafe unrelated policies cannot make the new private bucket public/writable.
create policy fixture_broad_storage_read on storage.objects for select to anon,authenticated using(true);
create policy fixture_broad_storage_insert on storage.objects for insert to authenticated with check(true);
grant usage on schema storage to anon;
grant select on storage.objects to anon;
grant insert on storage.objects to authenticated;
insert into storage.objects(bucket_id,name) values
 ('lifeos-study-syllabi','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/aaaaaaaa-0000-4000-8000-000000000001/'||repeat('c',64)||'.pdf'),
 ('lifeos-study-syllabi','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/bbbbbbbb-0000-4000-8000-000000000001/'||repeat('c',64)||'.pdf'),
 ('lifeos-study-syllabi','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-0000-4000-8000-000000000001/'||repeat('c',64)||'.pdf');

do $$ begin
 if (select public from storage.buckets where id='lifeos-study-syllabi') then raise exception 'Syllabus bucket is public'; end if;
 if (select file_size_limit from storage.buckets where id='lifeos-study-syllabi')<>62914560 then raise exception 'Incorrect PDF limit'; end if;
 if not (select has_content from public.syllabus_documents where id='aaaaaaaa-0000-4000-8000-000000000003') then raise exception 'Legacy PDF availability lost'; end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
do $$ begin
 if (select count(*) from storage.objects)<>1 then raise exception 'Private Storage owner/course RLS leak'; end if;
 begin
   perform public.register_study_storage_document(auth.uid(),'aaaaaaaa-0000-4000-8000-000000000001','unverified.pdf',repeat('e',64),100);
   raise exception 'Direct authenticated registration accepted';
 exception when insufficient_privilege then null; end;
 begin
   perform public.ensure_study_verified_document_scheme(auth.uid(),'aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000003',
     (select definition from public.study_scheme_templates where key='dbms-2026-2027'));
   raise exception 'Direct authenticated verification accepted';
 exception when insufficient_privilege then null; end;
 begin
   insert into storage.objects(bucket_id,name) values('lifeos-study-syllabi','unauthorized');
   raise exception 'Direct user Storage upload accepted';
 exception when insufficient_privilege then null; end;
end $$;
set role service_role;
do $$ declare doc uuid; repeated uuid; scheme uuid; repeated_scheme uuid; before_grades integer; begin
 insert into public.syllabus_documents(id,user_id,study_course_id,version,file_name,sha256,source_pages,notes,extraction_status)
 values('aaaaaaaa-0000-4000-8000-000000000099',auth.uid(),'aaaaaaaa-0000-4000-8000-000000000001',99,'Original Russian metadata.pdf',repeat('c',64),'[7,8]','["Original provenance"]','verified');
 insert into public.grading_schemes(user_id,study_course_id,document_id,version,definition,verification,is_active)
 select auth.uid(),'aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000099',99,definition,'verified',false
 from public.study_scheme_templates where key='dbms-2026-2027' returning id into scheme;
 select count(*) into before_grades from public.grading_schemes;
 doc:=public.register_study_storage_document(auth.uid(),'aaaaaaaa-0000-4000-8000-000000000001','Do not replace original filename.pdf',repeat('c',64),42000000);
 repeated:=public.register_study_storage_document(auth.uid(),'aaaaaaaa-0000-4000-8000-000000000001','another.pdf',repeat('c',64),42000000);
 if doc is distinct from 'aaaaaaaa-0000-4000-8000-000000000099'::uuid or repeated is distinct from doc then raise exception 'Hydration created another document'; end if;
 if not exists(select 1 from public.syllabus_documents where id=doc and has_content and version=99 and content_bytes=42000000
    and file_name='Original Russian metadata.pdf' and source_pages='[7,8]' and notes='["Original provenance"]'
    and storage_bucket='lifeos-study-syllabi' and storage_object_path=auth.uid()::text||'/aaaaaaaa-0000-4000-8000-000000000001/'||repeat('c',64)||'.pdf') then
    raise exception 'Hydration replaced original metadata or unavailable'; end if;
 repeated_scheme:=public.ensure_study_verified_document_scheme(auth.uid(),'aaaaaaaa-0000-4000-8000-000000000001',doc,
   (select definition from public.study_scheme_templates where key='dbms-2026-2027'));
 if repeated_scheme is distinct from scheme or (select count(*) from public.grading_schemes)<>before_grades then raise exception 'Existing scheme duplicated'; end if;
 -- New metadata is allocated once and the scheme operation is atomic/idempotent too.
 doc:=public.register_study_storage_document(auth.uid(),'aaaaaaaa-0000-4000-8000-000000000001','new.pdf',repeat('d',64),100);
 repeated:=public.register_study_storage_document(auth.uid(),'aaaaaaaa-0000-4000-8000-000000000001','new.pdf',repeat('d',64),100);
 if repeated is distinct from doc then raise exception 'Document retry not idempotent'; end if;
 scheme:=public.ensure_study_verified_document_scheme(auth.uid(),'aaaaaaaa-0000-4000-8000-000000000001',doc,
   (select definition from public.study_scheme_templates where key='dbms-2026-2027'));
 repeated_scheme:=public.ensure_study_verified_document_scheme(auth.uid(),'aaaaaaaa-0000-4000-8000-000000000001',doc,
   (select definition from public.study_scheme_templates where key='dbms-2026-2027'));
 if repeated_scheme is distinct from scheme then raise exception 'New scheme retry not idempotent'; end if;
 if (select actual_score from public.assessment_items where id='aaaaaaaa-0000-4000-8000-000000000002')<>18
   or (select earned from public.assessment_grade_overrides where assessment_id='aaaaaaaa-0000-4000-8000-000000000002')<>27 then raise exception 'Storage import changed grades/override'; end if;
 if not exists(select 1 from public.grading_schemes where id='aaaaaaaa-0000-4000-8000-000000000004' and is_active) then raise exception 'Import replaced user scheme'; end if;
 begin
   update public.syllabus_documents set storage_object_path='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/bbbbbbbb-0000-4000-8000-000000000001/'||repeat('d',64)||'.pdf' where id=doc;
   raise exception 'Forged pointer accepted';
 exception when check_violation then null; end;
 begin
   perform public.register_study_storage_document(auth.uid(),'bbbbbbbb-0000-4000-8000-000000000001','foreign.pdf',repeat('e',64),100);
   raise exception 'Cross-course RPC accepted';
 exception when raise_exception then if sqlerrm<>'study_course_not_found' then raise; end if; end;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
do $$ begin
 if (select count(*) from storage.objects)<>1 then raise exception 'B reads A Storage'; end if;
 if exists(select 1 from public.syllabus_documents where storage_object_path like 'aaaaaaaa%') then raise exception 'B reads A PDF metadata'; end if;
end $$;
reset role;
set role anon;
do $$ begin
 begin
   if exists(select 1 from storage.objects) then raise exception 'Anonymous reads private PDFs'; end if;
 exception when insufficient_privilege then null; end;
 begin
   perform public.register_study_storage_document('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','anonymous.pdf',repeat('e',64),100);
   raise exception 'Anonymous import accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'OK: private Storage A/B/anon, immutable owned pointers, resumable hydration, legacy preservation and idempotent document/scheme registration' result;
