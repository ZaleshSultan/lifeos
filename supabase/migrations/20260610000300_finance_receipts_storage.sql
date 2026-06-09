-- Receipt storage bucket and extended receipt statuses.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'receipts_owner_read'
  ) then
    create policy receipts_owner_read
      on storage.objects
      for select
      to authenticated
      using (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'receipts_owner_insert'
  ) then
    create policy receipts_owner_insert
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'receipts_owner_update'
  ) then
    create policy receipts_owner_update
      on storage.objects
      for update
      to authenticated
      using (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'receipts_owner_delete'
  ) then
    create policy receipts_owner_delete
      on storage.objects
      for delete
      to authenticated
      using (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end;
$$;

alter table public.finance_receipts
  drop constraint if exists finance_receipts_status_valid;

alter table public.finance_receipts
  add constraint finance_receipts_status_valid check (
    status in (
      'uploaded',
      'processing',
      'parsed',
      'linked',
      'partial',
      'needs_review',
      'failed'
    )
  );
