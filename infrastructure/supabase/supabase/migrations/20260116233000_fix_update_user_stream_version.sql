-- Fix: Add stream_version to api.update_user() INSERT statement
--
-- The previous migration was missing stream_version, causing:
-- "null value in column stream_version violates not-null constraint"
--
-- This also adds complete event_metadata per event-metadata-schema.md

CREATE OR REPLACE FUNCTION api.update_user(
  p_user_id UUID,
  p_org_id UUID,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, api
AS $$
DECLARE
  v_event_id UUID;
  v_current_user_id UUID;
  v_stream_version INT;
BEGIN
  v_current_user_id := auth.uid();

  -- Verify caller is authenticated
  IF v_current_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Verify user exists and belongs to org
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles_projection
    WHERE user_id = p_user_id AND organization_id = p_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found in organization');
  END IF;

  -- Calculate next stream version for this user
  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM public.domain_events
  WHERE stream_id = p_user_id AND stream_type = 'user';

  -- Emit domain event with stream_version and complete metadata
  INSERT INTO public.domain_events (
    stream_type,
    stream_id,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    'user',
    p_user_id,
    v_stream_version,
    'user.profile.updated',
    jsonb_build_object(
      'user_id', p_user_id,
      'organization_id', p_org_id,
      'first_name', p_first_name,
      'last_name', p_last_name
    ),
    jsonb_build_object(
      -- Required (per event-metadata-schema.md)
      'timestamp', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      -- Recommended
      'source', 'api',
      'user_id', v_current_user_id,
      'reason', 'User profile updated via UI',
      'service_name', 'api-rpc',
      'operation_name', 'update_user'
    )
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object('success', true, 'event_id', v_event_id);
END;
$$;

COMMENT ON FUNCTION api.update_user(UUID, UUID, TEXT, TEXT) IS 'Update user profile (first_name, last_name) via domain event';

NOTIFY pgrst, 'reload schema';
