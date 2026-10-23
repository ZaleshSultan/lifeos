begin;

-- Ownership RLS limits rows, not columns. Browser identities may only edit these
-- presentation fields; registration, identity linkage and approval are service-owned.
revoke all on public.profiles from public, anon, authenticated;
-- Table REVOKE does not remove pre-existing column ACLs.
do $$ declare c record; begin
  for c in select attname from pg_attribute where attrelid='public.profiles'::regclass and attnum>0 and not attisdropped loop
    execute format('revoke all (%I) on public.profiles from public, anon, authenticated', c.attname);
  end loop;
end $$;
grant select on public.profiles to authenticated;
grant update (display_name, timezone, locale) on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- TRUNCATE is not subject to RLS and has no place in browser roles.
revoke truncate, references, trigger on all tables in schema public from public, anon, authenticated;
revoke all on public.google_oauth_state_nonces from public, anon, authenticated;
revoke all on function public.purge_expired_google_oauth_state_nonces() from public, anon, authenticated;
grant execute on function public.purge_expired_google_oauth_state_nonces() to service_role;
alter function public.purge_expired_google_oauth_state_nonces() set search_path = public, pg_temp;
revoke all on function public.set_user_obsidian_syncthing_defaults() from public, anon, authenticated;
grant execute on function public.set_user_obsidian_syncthing_defaults() to service_role;
alter function public.set_user_obsidian_syncthing_defaults() set search_path = public, pg_temp;
alter function public.claim_due_reminders(timestamptz, integer) set search_path = public, pg_temp;

-- Preserve the existing authenticated RPC, but reject missing claims too and
-- put pg_temp last so temporary objects cannot shadow definer-owned tables.
create or replace function public.create_life_entity_with_sync(
  p_user_id              uuid,
  p_entity_type          public.life_entity_type,
  p_title                text,
  p_description          text                         default null,
  p_body                 text                         default null,
  p_domain               text                         default 'personal',
  p_status               text                         default 'inbox',
  p_source               text                         default 'telegram',
  p_source_command       text                         default null,
  p_telegram_chat_id     bigint                       default null,
  p_telegram_message_id  bigint                       default null,
  p_due_at               timestamptz                  default null,
  p_linked_table         text                         default null,
  p_linked_id            uuid                         default null,
  p_metadata             jsonb                        default '{}'::jsonb,
  p_raw_payload          jsonb                        default '{}'::jsonb,
  p_sync_operation       text                         default 'upsert_note',
  p_sync_entity_type     public.life_entity_type      default null,
  p_sync_action          text                         default 'upsert',
  p_sync_target_path     text                         default null,
  p_sync_payload         jsonb                        default '{}'::jsonb
)
returns public.life_entities
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entity public.life_entities;
  v_sync_payload jsonb;
begin
  if auth.role() is distinct from 'service_role'
     and (auth.uid() is null or auth.uid() <> p_user_id) then
    raise exception 'Forbidden: p_user_id does not match auth.uid()'
      using errcode = '42501';
  end if;

  insert into public.life_entities (
    user_id,
    entity_type,
    title,
    description,
    body,
    domain,
    status,
    source,
    source_command,
    telegram_chat_id,
    telegram_message_id,
    due_at,
    linked_table,
    linked_id,
    metadata,
    raw_payload_json
  )
  values (
    p_user_id,
    p_entity_type,
    p_title,
    p_description,
    p_body,
    coalesce(nullif(btrim(p_domain), ''), 'personal'),
    coalesce(nullif(btrim(p_status), ''), 'inbox'),
    coalesce(nullif(btrim(p_source), ''), 'telegram'),
    p_source_command,
    p_telegram_chat_id,
    p_telegram_message_id,
    p_due_at,
    p_linked_table,
    p_linked_id,
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_raw_payload, '{}'::jsonb)
  )
  returning * into v_entity;

  v_sync_payload :=
    coalesce(p_sync_payload, '{}'::jsonb)
    || jsonb_build_object('entity_id', v_entity.id);

  insert into public.obsidian_sync_queue (
    user_id,
    life_entity_id,
    operation,
    entity_type,
    action,
    target_path,
    status,
    payload,
    payload_json
  )
  values (
    p_user_id,
    v_entity.id,
    coalesce(nullif(btrim(p_sync_operation), ''), 'upsert_note'),
    coalesce(p_sync_entity_type, p_entity_type),
    coalesce(nullif(btrim(p_sync_action), ''), 'upsert'),
    p_sync_target_path,
    'pending',
    v_sync_payload,
    v_sync_payload
  );

  return v_entity;
end;
$$;

revoke all on function public.create_life_entity_with_sync from public, anon;
grant execute on function public.create_life_entity_with_sync to authenticated, service_role;

commit;
