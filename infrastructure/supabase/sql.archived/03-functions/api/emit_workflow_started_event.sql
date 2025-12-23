-- =====================================================
-- Function: Emit organization.bootstrap.workflow_started Event
-- =====================================================
-- Purpose: Records when event listener successfully starts a Temporal workflow
--
-- Called by: Event listener (workflow worker) after starting Temporal workflow
-- Event Type: organization.bootstrap.workflow_started
-- AsyncAPI Contract: infrastructure/supabase/contracts/organization-bootstrap-events.yaml
--
-- Architecture Pattern: Event Sourcing - Immutability
--   - Does NOT update existing domain_events (bootstrap.initiated)
--   - Creates NEW event to record workflow start
--   - Maintains complete audit trail
--
-- Author: A4C Infrastructure Team
-- Created: 2025-11-24
-- =====================================================

-- Drop existing function for idempotency
DROP FUNCTION IF EXISTS api.emit_workflow_started_event(UUID, UUID, TEXT, TEXT, TEXT);

-- Create function in api schema (accessible via Supabase RPC)
CREATE OR REPLACE FUNCTION api.emit_workflow_started_event(
  p_stream_id UUID,
  p_bootstrap_event_id UUID,
  p_workflow_id TEXT,
  p_workflow_run_id TEXT,
  p_workflow_type TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_event_id UUID;
  v_stream_version INT;
BEGIN
  -- Validate inputs
  IF p_stream_id IS NULL THEN
    RAISE EXCEPTION 'stream_id cannot be null';
  END IF;

  IF p_bootstrap_event_id IS NULL THEN
    RAISE EXCEPTION 'bootstrap_event_id cannot be null';
  END IF;

  IF p_workflow_id IS NULL OR p_workflow_id = '' THEN
    RAISE EXCEPTION 'workflow_id cannot be null or empty';
  END IF;

  IF p_workflow_run_id IS NULL OR p_workflow_run_id = '' THEN
    RAISE EXCEPTION 'workflow_run_id cannot be null or empty';
  END IF;

  -- Get next version for this organization stream
  SELECT COALESCE(MAX(stream_version), 0) + 1
  INTO v_stream_version
  FROM public.domain_events
  WHERE stream_id = p_stream_id
    AND stream_type = 'organization';

  -- Insert workflow started event into domain_events
  INSERT INTO public.domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata,
    created_at
  ) VALUES (
    p_stream_id,
    'organization',
    v_stream_version,
    'organization.bootstrap.workflow_started',
    jsonb_build_object(
      'bootstrap_event_id', p_bootstrap_event_id,
      'workflow_id', p_workflow_id,
      'workflow_run_id', p_workflow_run_id,
      'workflow_type', COALESCE(p_workflow_type, 'organizationBootstrapWorkflow')
    ),
    jsonb_build_object(
      'triggered_by', 'event_listener',
      'trigger_time', NOW()::TEXT
    ),
    NOW()
  )
  RETURNING id INTO v_event_id;

  -- Log success
  RAISE NOTICE 'Emitted organization.bootstrap.workflow_started event: % for workflow: %',
    v_event_id, p_workflow_id;

  RETURN v_event_id;

EXCEPTION
  WHEN OTHERS THEN
    -- Log error details
    RAISE WARNING 'Failed to emit workflow_started event: % - %', SQLERRM, SQLSTATE;
    -- Re-raise exception
    RAISE;
END;
$$;

-- =====================================================
-- Permissions
-- =====================================================
-- Grant execute permission to service_role (used by worker)
GRANT EXECUTE ON FUNCTION api.emit_workflow_started_event TO service_role;
GRANT EXECUTE ON FUNCTION api.emit_workflow_started_event TO postgres;

-- =====================================================
-- Documentation
-- =====================================================
COMMENT ON FUNCTION api.emit_workflow_started_event IS
  'Emits organization.bootstrap.workflow_started event after event listener starts Temporal workflow.

   Maintains event sourcing immutability by creating NEW event rather than updating existing event.

   Parameters:
     p_stream_id: Organization ID (stream_id from bootstrap.initiated event)
     p_bootstrap_event_id: ID of the organization.bootstrap.initiated event
     p_workflow_id: Temporal workflow ID (deterministic: org-bootstrap-{stream_id})
     p_workflow_run_id: Temporal workflow execution run ID
     p_workflow_type: Temporal workflow type name (default: organizationBootstrapWorkflow)

   Returns: UUID of the created workflow_started event

   Example Usage:
     SELECT api.emit_workflow_started_event(
       ''d8846196-8f69-46dc-af9a-87a57843c4e4'',
       ''b8309521-a46f-4d71-becb-1f138878425b'',
       ''org-bootstrap-d8846196-8f69-46dc-af9a-87a57843c4e4'',
       ''019ab7a4-a6bf-70a3-8394-7b09371e98ba'',
       ''organizationBootstrapWorkflow''
     );

   See: documentation/infrastructure/reference/events/organization-bootstrap-workflow-started.md';

-- =====================================================
-- Testing
-- =====================================================
-- Test 1: Verify function exists and has correct signature
-- SELECT routine_name, routine_type, data_type
-- FROM information_schema.routines
-- WHERE routine_schema = 'api'
--   AND routine_name = 'emit_workflow_started_event';

-- Test 2: Verify permissions
-- SELECT grantee, privilege_type
-- FROM information_schema.routine_privileges
-- WHERE routine_schema = 'api'
--   AND routine_name = 'emit_workflow_started_event';

-- Test 3: Test function with sample data
-- SELECT api.emit_workflow_started_event(
--   gen_random_uuid(),  -- stream_id
--   gen_random_uuid(),  -- bootstrap_event_id
--   'org-bootstrap-test',  -- workflow_id
--   'test-run-id',  -- workflow_run_id
--   'organizationBootstrapWorkflow'  -- workflow_type
-- );

-- Test 4: Verify event was created
-- SELECT id, event_type, event_data
-- FROM domain_events
-- WHERE event_type = 'organization.bootstrap.workflow_started'
-- ORDER BY created_at DESC
-- LIMIT 1;
