/**
 * Emit Domain Event RPC Function
 *
 * Purpose:
 * - Provide RPC function for Temporal workflow activities to emit domain events
 * - Function created in 'api' schema (exposed by PostgREST in Supabase)
 * - Inserts events into public.domain_events table
 *
 * Schema Architecture:
 * - Function lives in 'api' schema (PostgREST exposed schema for RPC calls)
 * - Function inserts into 'public' schema via SECURITY DEFINER + search_path
 * - This is required because PostgREST only exposes the 'api' schema by default
 *
 * Security:
 * - SECURITY DEFINER: Function runs with creator privileges to access domain_events
 * - SET search_path = public: Prevents schema injection attacks while accessing public tables
 * - GRANT EXECUTE: Only authenticated and service_role can call this function
 *
 * Usage (from Temporal workflow activities):
 * ```typescript
 * const { data, error } = await supabase
 *   .schema('api')
 *   .rpc('emit_domain_event', {
 *     p_event_id: '123e4567-e89b-12d3-a456-426614174000',
 *     p_event_type: 'organization.created',
 *     p_aggregate_type: 'organization',
 *     p_aggregate_id: 'org-uuid',
 *     p_event_data: { name: 'Acme Corp' },
 *     p_event_metadata: { workflow_id: 'workflow-123' }
 *   });
 * ```
 *
 * Migration: 002-emit-domain-event.sql
 * Created: 2025-11-21
 * Phase: 4.1 - Workflow Testing
 */

-- Function: Emit domain event (insert into public.domain_events)
CREATE OR REPLACE FUNCTION api.emit_domain_event(
  p_event_id UUID,
  p_event_type TEXT,
  p_aggregate_type TEXT,
  p_aggregate_id UUID,
  p_event_data JSONB,
  p_event_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Insert event into domain_events table
  -- Map parameters to actual column names:
  --   event_id -> id
  --   aggregate_id -> stream_id
  --   aggregate_type -> stream_type
  INSERT INTO domain_events (
    id,
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    p_event_id,
    p_aggregate_id,
    p_aggregate_type,
    (
      SELECT COALESCE(MAX(stream_version), 0) + 1
      FROM domain_events
      WHERE stream_id = p_aggregate_id
        AND stream_type = p_aggregate_type
    ),
    p_event_type,
    p_event_data,
    p_event_metadata
  )
  ON CONFLICT (id) DO NOTHING;  -- Idempotent

  RETURN p_event_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION api.emit_domain_event(UUID, TEXT, TEXT, UUID, JSONB, JSONB) TO authenticated, service_role;

-- Add comment
COMMENT ON FUNCTION api.emit_domain_event(UUID, TEXT, TEXT, UUID, JSONB, JSONB) IS
'Emit domain event into domain_events table. Used by Temporal workflow activities. Function in api schema for PostgREST RPC access.';
