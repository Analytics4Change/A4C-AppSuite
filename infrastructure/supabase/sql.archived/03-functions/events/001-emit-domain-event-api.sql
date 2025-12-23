-- API Schema Wrapper for Domain Events
-- ============================================================================
-- Purpose: Allow Edge Functions to emit domain events via PostgREST API
--
-- Background:
-- - Edge Functions use createClient().from('table') which goes through PostgREST
-- - PostgREST only exposes schemas configured in config.toml
-- - domain_events table exists in public schema but Edge Functions need api schema access
-- - Error without this wrapper: "The schema must be one of the following: api"
--
-- Solution:
-- - Create api schema with wrapper function
-- - Use SECURITY DEFINER to run with owner privileges (bypasses RLS)
-- - Edge Functions call via .rpc('emit_domain_event', {...})
-- ============================================================================

-- Create api schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS api;

-- API wrapper function for emitting domain events
CREATE OR REPLACE FUNCTION api.emit_domain_event(
  p_stream_id UUID,
  p_stream_type TEXT,
  p_stream_version INTEGER,
  p_event_type TEXT,
  p_event_data JSONB,
  p_event_metadata JSONB
)
RETURNS UUID
SECURITY DEFINER  -- Runs with function owner privileges, bypasses RLS
SET search_path = public, pg_temp  -- Explicit schema to prevent injection
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  -- Insert domain event into public.domain_events table
  -- SECURITY DEFINER allows this to bypass RLS policies
  INSERT INTO public.domain_events (
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
    p_stream_version,
    p_event_type,
    p_event_data,
    p_event_metadata,
    NOW()
  )
  RETURNING id INTO v_event_id;

  -- Return the generated event ID for correlation
  RETURN v_event_id;
END;
$$;

-- Grant execute permission to authenticated users and service role
GRANT EXECUTE ON FUNCTION api.emit_domain_event(UUID, TEXT, INTEGER, TEXT, JSONB, JSONB)
  TO authenticated, service_role;

-- Documentation
COMMENT ON SCHEMA api IS
  'API schema for PostgREST-accessible functions used by Edge Functions and external clients';

COMMENT ON FUNCTION api.emit_domain_event IS
  'Wrapper function for emitting domain events from Edge Functions via PostgREST API.
   Uses SECURITY DEFINER to bypass RLS policies on domain_events table.

   Usage from Edge Function:
   const { data: eventId, error } = await supabaseAdmin.rpc("emit_domain_event", {
     p_stream_id: organizationId,
     p_stream_type: "organization",
     p_stream_version: 1,
     p_event_type: "organization.bootstrap.initiated",
     p_event_data: {...},
     p_event_metadata: {...}
   });

   Returns: UUID of the created event
   Throws: PostgreSQL error if validation fails (event_type format, unique constraint, etc.)';
