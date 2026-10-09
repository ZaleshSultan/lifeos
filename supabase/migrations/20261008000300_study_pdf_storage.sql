-- New migration only: preserve legacy PDFs, versions, schemes and all grades.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('lifeos-study-syllabi','lifeos-study-syllabi',false,62914560,array['application/pdf'])
on conflict(id) do update set public=false, file_size_limit=62914560,
  allowed_mime_types=array['application/pdf'];

alter table public.syllabus_documents
  add column if not exists storage_bucket text,
  add column if not exists storage_object_path text,
  add column if not exists content_bytes bigint,
  add column if not exists storage_verified_at timestamptz;

-- Keep the existing values/column; a trigger now accounts for both storage formats.
alter table public.syllabus_documents alter column has_content drop expression if exists;
create or replace function public.study_document_has_content()
returns trigger language plpgsql set search_path=public as $$
begin
  new.has_content := new.pdf_base64 is not null or
    (new.storage_bucket is not null and new.storage_object_path is not null
     and new.content_bytes is not null and new.storage_verified_at is not null);
  return new;
end $$;
drop trigger if exists study_document_content on public.syllabus_documents;
create trigger study_document_content before insert or update on public.syllabus_documents
for each row execute function public.study_document_has_content();

do $$ begin
  if not exists(select 1 from pg_constraint where conname='study_document_storage_location') then
    alter table public.syllabus_documents add constraint study_document_storage_location check (
      (storage_bucket is null and storage_object_path is null and content_bytes is null and storage_verified_at is null)
      or (storage_bucket is not null and storage_bucket='lifeos-study-syllabi'
          and storage_object_path is not null
          and storage_object_path=user_id::text||'/'||study_course_id::text||'/'||sha256||'.pdf'
          and content_bytes is not null and content_bytes between 5 and 62914560
          and storage_verified_at is not null));
  end if;
end $$;

-- Only the backend writes objects. Read access requires both the owner and owned course.
drop policy if exists study_syllabus_objects_owner_read on storage.objects;
create policy study_syllabus_objects_owner_read on storage.objects for select to authenticated
using (bucket_id='lifeos-study-syllabi'
  and split_part(name,'/',1)=auth.uid()::text
  and exists(select 1 from public.study_courses c where c.user_id=auth.uid()
    and c.id::text=split_part(name,'/',2)));

-- Restrictive guards also protect this new bucket if an older project policy is overly broad.
-- Other buckets keep their existing permissions; the service role continues to bypass RLS.
drop policy if exists study_syllabus_objects_read_guard on storage.objects;
create policy study_syllabus_objects_read_guard on storage.objects as restrictive for select to anon,authenticated
using (bucket_id<>'lifeos-study-syllabi' or
  (split_part(name,'/',1)=(select auth.uid())::text
    and exists(select 1 from public.study_courses c where c.user_id=(select auth.uid())
      and c.id::text=split_part(name,'/',2))));
drop policy if exists study_syllabus_objects_insert_guard on storage.objects;
create policy study_syllabus_objects_insert_guard on storage.objects as restrictive for insert to anon,authenticated
with check(bucket_id<>'lifeos-study-syllabi');
drop policy if exists study_syllabus_objects_update_guard on storage.objects;
create policy study_syllabus_objects_update_guard on storage.objects as restrictive for update to anon,authenticated
using(bucket_id<>'lifeos-study-syllabi') with check(bucket_id<>'lifeos-study-syllabi');
drop policy if exists study_syllabus_objects_delete_guard on storage.objects;
create policy study_syllabus_objects_delete_guard on storage.objects as restrictive for delete to anon,authenticated
using(bucket_id<>'lifeos-study-syllabi');

-- Serialize version allocation and hydrate an existing metadata-only seed in place.
create or replace function public.register_study_storage_document(
  p_user_id uuid,p_course_id uuid,p_file_name text,p_sha256 text,p_content_bytes bigint,
  p_source_pages jsonb default '[]',p_notes jsonb default '[]',p_extraction_status text default 'needs_review')
returns uuid language plpgsql security invoker set search_path=public as $$
declare document_id uuid; next_version integer;
begin
  if current_user<>'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'study_course_not_found';
  end if;
  perform 1 from public.study_courses where user_id=p_user_id and id=p_course_id for update;
  if not found then raise exception 'study_course_not_found'; end if;
  select id into document_id from public.syllabus_documents
    where user_id=p_user_id and study_course_id=p_course_id and sha256=p_sha256;
  if document_id is not null then
    update public.syllabus_documents set storage_bucket='lifeos-study-syllabi',
      storage_object_path=p_user_id::text||'/'||p_course_id::text||'/'||p_sha256||'.pdf',
      content_bytes=p_content_bytes,storage_verified_at=now()
      where id=document_id and user_id=p_user_id and not has_content;
    return document_id;
  end if;
  select coalesce(max(version),0)+1 into next_version from public.syllabus_documents
    where user_id=p_user_id and study_course_id=p_course_id;
  insert into public.syllabus_documents(user_id,study_course_id,file_name,sha256,version,
    storage_bucket,storage_object_path,content_bytes,storage_verified_at,source_pages,notes,extraction_status)
  values(p_user_id,p_course_id,p_file_name,p_sha256,next_version,'lifeos-study-syllabi',
    p_user_id::text||'/'||p_course_id::text||'/'||p_sha256||'.pdf',p_content_bytes,now(),
    p_source_pages,p_notes,p_extraction_status) returning id into document_id;
  return document_id;
end $$;
revoke all on function public.register_study_storage_document(uuid,uuid,text,text,bigint,jsonb,jsonb,text) from public,anon;
revoke all on function public.register_study_storage_document(uuid,uuid,text,text,bigint,jsonb,jsonb,text) from authenticated;
grant execute on function public.register_study_storage_document(uuid,uuid,text,text,bigint,jsonb,jsonb,text) to service_role;

create or replace function public.ensure_study_verified_document_scheme(
  p_user_id uuid,p_course_id uuid,p_document_id uuid,p_definition jsonb)
returns uuid language plpgsql security invoker set search_path=public as $$
declare scheme_id uuid; next_version integer; should_activate boolean;
begin
  if current_user<>'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'study_course_not_found';
  end if;
  perform 1 from public.study_courses where user_id=p_user_id and id=p_course_id for update;
  if not found then raise exception 'study_course_not_found'; end if;
  perform 1 from public.syllabus_documents where user_id=p_user_id and study_course_id=p_course_id and id=p_document_id;
  if not found then raise exception 'study_document_not_found'; end if;
  select id into scheme_id from public.grading_schemes
    where user_id=p_user_id and study_course_id=p_course_id and document_id=p_document_id order by version limit 1;
  if scheme_id is not null then return scheme_id; end if;
  select coalesce(max(version),0)+1,not coalesce(bool_or(is_active),false) into next_version,should_activate
    from public.grading_schemes where user_id=p_user_id and study_course_id=p_course_id;
  should_activate := should_activate and not exists(select 1 from public.study_courses
    where user_id=p_user_id and id=p_course_id and metadata ? 'study_calculator_v1');
  insert into public.grading_schemes(user_id,study_course_id,document_id,version,definition,verification,is_active)
  values(p_user_id,p_course_id,p_document_id,next_version,p_definition,'verified',should_activate)
  returning id into scheme_id;
  return scheme_id;
end $$;
revoke all on function public.ensure_study_verified_document_scheme(uuid,uuid,uuid,jsonb) from public,anon;
revoke all on function public.ensure_study_verified_document_scheme(uuid,uuid,uuid,jsonb) from authenticated;
grant execute on function public.ensure_study_verified_document_scheme(uuid,uuid,uuid,jsonb) to service_role;

commit;
