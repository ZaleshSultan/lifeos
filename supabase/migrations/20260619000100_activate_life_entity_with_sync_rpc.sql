-- ============================================================================
-- Activate atomic entity + Obsidian sync queue RPC
-- ============================================================================
-- Safe for databases where the older JSONB-returning template was applied:
-- it removes that overload and creates the typed row-returning RPC used by the
-- TypeScript store.
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_life_entity_with_sync(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  BIGINT,
  BIGINT,
  TIMESTAMPTZ,
  TEXT,
  UUID,
  JSONB,
  JSONB,
  JSONB
);


CREATE OR REPLACE FUNCTION public.create_life_entity_with_sync(
  p_user_id              UUID,
  p_entity_type          public.life_entity_type,
  p_title                TEXT,
  p_description          TEXT                         DEFAULT NULL,
  p_body                 TEXT                         DEFAULT NULL,
  p_domain               TEXT                         DEFAULT 'personal',
  p_status               TEXT                         DEFAULT 'inbox',
  p_source               TEXT                         DEFAULT 'telegram',
  p_source_command       TEXT                         DEFAULT NULL,
  p_telegram_chat_id     BIGINT                       DEFAULT NULL,
  p_telegram_message_id  BIGINT                       DEFAULT NULL,
  p_due_at               TIMESTAMPTZ                  DEFAULT NULL,
  p_linked_table         TEXT                         DEFAULT NULL,
  p_linked_id            UUID                         DEFAULT NULL,
  p_metadata             JSONB                        DEFAULT '{}'::JSONB,
  p_raw_payload          JSONB                        DEFAULT '{}'::JSONB,
  p_sync_operation       TEXT                         DEFAULT 'upsert_note',
  p_sync_entity_type     public.life_entity_type      DEFAULT NULL,
  p_sync_action          TEXT                         DEFAULT 'upsert',
  p_sync_target_path     TEXT                         DEFAULT NULL,
  p_sync_payload         JSONB                        DEFAULT '{}'::JSONB
)
RETURNS public.life_entities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity public.life_entities;
  v_sync_payload JSONB;
BEGIN
  INSERT INTO public.life_entities (
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
  VALUES (
    p_user_id,
    p_entity_type,
    p_title,
    p_description,
    p_body,
    p_domain,
    p_status,
    p_source,
    p_source_command,
    p_telegram_chat_id,
    p_telegram_message_id,
    p_due_at,
    p_linked_table,
    p_linked_id,
    COALESCE(p_metadata, '{}'::JSONB),
    COALESCE(p_raw_payload, '{}'::JSONB)
  )
  RETURNING * INTO v_entity;

  v_sync_payload := COALESCE(p_sync_payload, '{}'::JSONB)
    || jsonb_build_object('entity_id', v_entity.id);

  INSERT INTO public.obsidian_sync_queue (
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
  VALUES (
    p_user_id,
    v_entity.id,
    COALESCE(NULLIF(BTRIM(p_sync_operation), ''), 'upsert_note'),
    COALESCE(p_sync_entity_type, p_entity_type),
    COALESCE(NULLIF(BTRIM(p_sync_action), ''), 'upsert'),
    p_sync_target_path,
    'pending',
    v_sync_payload,
    v_sync_payload
  );

  RETURN v_entity;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_life_entity_with_sync TO authenticated;

COMMENT ON FUNCTION public.create_life_entity_with_sync IS
  'Atomically creates a life_entities row and enqueues an Obsidian sync job. '
  'If either INSERT fails, the entire transaction is rolled back.';
