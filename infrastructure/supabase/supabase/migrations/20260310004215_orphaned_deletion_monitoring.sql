-- =============================================================================
-- Migration: Orphaned Deletion Monitoring
-- Purpose: RPC functions for platform admins to monitor orgs that were
--          soft-deleted but whose cleanup workflow never completed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- api.get_orphaned_deletions(p_hours_threshold integer)
--
-- Returns organizations that:
--   1. Have deleted_at IS NOT NULL (soft-deleted)
--   2. Have NO organization.deletion.completed event
--   3. Were deleted more than p_hours_threshold hours ago
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.get_orphaned_deletions(
  p_hours_threshold integer DEFAULT 24
) RETURNS TABLE(
  id uuid,
  name text,
  slug text,
  deleted_at timestamptz,
  deletion_reason text,
  hours_since_deletion numeric,
  has_initiated_event boolean,
  has_completed_event boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
#variable_conflict use_column
BEGIN
  IF NOT has_platform_privilege() THEN
    RAISE EXCEPTION 'Platform privilege required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.slug,
    o.deleted_at,
    o.deletion_reason,
    ROUND(EXTRACT(EPOCH FROM (now() - o.deleted_at)) / 3600, 1) AS hours_since_deletion,
    EXISTS(
      SELECT 1 FROM domain_events de
      WHERE de.stream_id = o.id
        AND de.event_type = 'organization.deletion.initiated'
    ) AS has_initiated_event,
    EXISTS(
      SELECT 1 FROM domain_events de
      WHERE de.stream_id = o.id
        AND de.event_type = 'organization.deletion.completed'
    ) AS has_completed_event
  FROM organizations_projection o
  WHERE o.deleted_at IS NOT NULL
    AND NOT EXISTS(
      SELECT 1 FROM domain_events de
      WHERE de.stream_id = o.id
        AND de.event_type = 'organization.deletion.completed'
    )
    AND EXTRACT(EPOCH FROM (now() - o.deleted_at)) / 3600 >= p_hours_threshold
  ORDER BY o.deleted_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION api.get_orphaned_deletions(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION api.get_orphaned_deletions(integer) TO service_role;

-- -----------------------------------------------------------------------------
-- api.retry_deletion_workflow(p_org_id uuid)
--
-- Emits a new organization.deleted event to re-trigger the deletion workflow.
-- Guards: has_platform_privilege(), org must have deleted_at IS NOT NULL.
-- Returns JSON with success status.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.retry_deletion_workflow(
  p_org_id uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_org RECORD;
  v_event_id uuid;
BEGIN
  IF NOT has_platform_privilege() THEN
    RAISE EXCEPTION 'Platform privilege required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Verify org exists and is soft-deleted
  SELECT o.id, o.name, o.slug, o.deleted_at, o.deletion_reason
  INTO v_org
  FROM organizations_projection o
  WHERE o.id = p_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization not found');
  END IF;

  IF v_org.deleted_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization is not deleted');
  END IF;

  -- Emit a new organization.deleted event to re-trigger the workflow
  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    p_org_id,
    'organization',
    COALESCE(
      (SELECT MAX(de.stream_version) + 1 FROM domain_events de WHERE de.stream_id = p_org_id),
      1
    ),
    'organization.deleted',
    jsonb_build_object(
      'name', v_org.name,
      'slug', v_org.slug,
      'reason', COALESCE(v_org.deletion_reason, 'Administrative retry')
    ),
    jsonb_build_object(
      'user_id', auth.uid()::text,
      'reason', 'Manual retry via orphaned deletion monitor',
      'retry', true
    )
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'message', 'Deletion event re-emitted'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION api.retry_deletion_workflow(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api.retry_deletion_workflow(uuid) TO service_role;
