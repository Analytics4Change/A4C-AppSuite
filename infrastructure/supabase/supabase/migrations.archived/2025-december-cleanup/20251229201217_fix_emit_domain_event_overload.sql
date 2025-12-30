-- Fix: Add emit_domain_event overload that auto-calculates stream_version
-- ===========================================================================
-- Problem: api.create_role calls api.emit_domain_event without p_stream_version
-- but the only existing overloads require either:
--   1. p_stream_version as 3rd parameter
--   2. Different parameter names (p_event_id, p_aggregate_type, etc.)
--
-- Solution: Create new overload that matches the call signature in api.create_role
-- and auto-calculates stream_version from existing events.

-- Create overload without p_stream_version parameter (auto-calculates it)
CREATE OR REPLACE FUNCTION api.emit_domain_event(
  p_stream_id UUID,
  p_stream_type TEXT,
  p_event_type TEXT,
  p_event_data JSONB,
  p_event_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id UUID;
  v_stream_version INT;
BEGIN
  -- Auto-calculate stream version
  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_stream_id
    AND stream_type = p_stream_type;

  -- Insert domain event
  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata,
    created_at
  )
  VALUES (
    p_stream_id,
    p_stream_type,
    v_stream_version,
    p_event_type,
    p_event_data,
    p_event_metadata,
    NOW()
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

COMMENT ON FUNCTION api.emit_domain_event(UUID, TEXT, TEXT, JSONB, JSONB) IS
'Emit domain event with auto-calculated stream_version. Used by RPC functions like api.create_role.
Parameters:
  - p_stream_id: UUID of the aggregate (role, user, etc.)
  - p_stream_type: Type of aggregate (role, user, organization)
  - p_event_type: Event type (role.created, role.updated, etc.)
  - p_event_data: Event payload
  - p_event_metadata: Audit context (user_id, reason, etc.)';

-- Grant permissions
GRANT EXECUTE ON FUNCTION api.emit_domain_event(UUID, TEXT, TEXT, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION api.emit_domain_event(UUID, TEXT, TEXT, JSONB, JSONB) TO service_role;

-- Verification: List all emit_domain_event overloads
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'emit_domain_event' AND n.nspname = 'api';

  RAISE NOTICE 'api.emit_domain_event overloads: % (expected: 3)', v_count;
END;
$$;
