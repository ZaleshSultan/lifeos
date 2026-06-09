-- ============================================================================
-- Atomic entity + Obsidian sync queue insertion
-- ============================================================================
-- This RPC wraps both the life_entities INSERT and the obsidian_sync_queue
-- INSERT into a single PostgreSQL transaction. If the queue insertion fails,
-- the entity INSERT is rolled back automatically.
--
-- STATUS: Migration template — NOT yet applied.
-- Apply when ready to call via supabase.rpc('create_life_entity_with_sync', {...})
-- and update the TypeScript store to use it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_life_entity_with_sync(
  p_user_id         UUID,
  p_entity_type     TEXT,
  p_title           TEXT,
  p_body            TEXT              DEFAULT NULL,
  p_domain          TEXT              DEFAULT 'personal',
  p_status          TEXT              DEFAULT 'inbox',
  p_source          TEXT              DEFAULT 'telegram',
  p_source_command  TEXT              DEFAULT NULL,
  p_telegram_chat_id   BIGINT        DEFAULT NULL,
  p_telegram_message_id BIGINT       DEFAULT NULL,
  p_due_at          TIMESTAMPTZ      DEFAULT NULL,
  p_linked_table    TEXT              DEFAULT NULL,
  p_linked_id       UUID             DEFAULT NULL,
  p_metadata        JSONB            DEFAULT '{}'::JSONB,
  p_raw_payload     JSONB            DEFAULT '{}'::JSONB,
  p_sync_payload    JSONB            DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entity_id UUID;
BEGIN
  -- 1. Create the life entity
  INSERT INTO public.life_entities (
    user_id,
    entity_type,
    title,
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
    p_metadata,
    p_raw_payload
  )
  RETURNING id INTO v_entity_id;

  -- 2. Enqueue Obsidian sync (same transaction — atomic)
  INSERT INTO public.obsidian_sync_queue (
    user_id,
    life_entity_id,
    status,
    payload
  )
  VALUES (
    p_user_id,
    v_entity_id,
    'pending',
    p_sync_payload || jsonb_build_object('entity_id', v_entity_id)
  );

  RETURN jsonb_build_object(
    'entity_id', v_entity_id,
    'sync_queued', TRUE
  );
END;
$$;

-- Grant access to the authenticated role used by PostgREST / Supabase
GRANT EXECUTE ON FUNCTION public.create_life_entity_with_sync TO authenticated;

COMMENT ON FUNCTION public.create_life_entity_with_sync IS
  'Atomically creates a life_entity row and enqueues an Obsidian sync job. '
  'If either INSERT fails, the entire transaction is rolled back.';
