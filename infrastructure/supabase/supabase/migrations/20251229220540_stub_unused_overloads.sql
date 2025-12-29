-- Migration: stub_unused_overloads
-- PURPOSE: Replace unused function overloads with diagnostic stubs that raise exceptions
-- This will reveal which overload PostgREST is calling when role creation fails
-- TEMPORARY: Remove after root cause identified

-- ============================================================================
-- STUB: 4-param api.create_role - should NOT be called
-- The frontend passes 5 params (including p_cloned_from_role_id: null)
-- If this stub fires, PostgREST is incorrectly choosing this overload
-- NOTE: Must keep DEFAULT values to match existing function signature
-- ============================================================================
CREATE OR REPLACE FUNCTION api.create_role(
  p_name TEXT,
  p_description TEXT,
  p_org_hierarchy_scope TEXT DEFAULT NULL,
  p_permission_ids UUID[] DEFAULT '{}'::UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  -- DIAGNOSTIC STUB: This overload should not be called
  RAISE EXCEPTION 'DIAGNOSTIC: 4-param api.create_role overload was called. PostgREST is using the wrong function signature. Params: name=%, desc=%, scope=%, perms=%',
    p_name, p_description, p_org_hierarchy_scope, array_length(p_permission_ids, 1);
END;
$$;

-- ============================================================================
-- STUB: 6-param legacy emit_domain_event - should NOT be called
-- This is the old signature with (event_id, event_type, aggregate_type, ...)
-- NOTE: Must keep DEFAULT on p_event_metadata to match existing signature
-- ============================================================================
CREATE OR REPLACE FUNCTION api.emit_domain_event(
  p_event_id UUID,
  p_event_type TEXT,
  p_aggregate_type TEXT,
  p_aggregate_id UUID,
  p_event_data JSONB,
  p_event_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'DIAGNOSTIC: 6-param LEGACY emit_domain_event overload was called. event_type=%, aggregate_type=%, aggregate_id=%',
    p_event_type, p_aggregate_type, p_aggregate_id;
END;
$$;

-- ============================================================================
-- STUB: 6-param explicit emit_domain_event - should NOT be called
-- This has explicit stream_version parameter instead of auto-calculating
-- NOTE: This one has NO defaults
-- ============================================================================
CREATE OR REPLACE FUNCTION api.emit_domain_event(
  p_stream_id UUID,
  p_stream_type TEXT,
  p_stream_version INT,
  p_event_type TEXT,
  p_event_data JSONB,
  p_event_metadata JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'DIAGNOSTIC: 6-param EXPLICIT emit_domain_event overload was called. stream_id=%, stream_type=%, version=%, event_type=%',
    p_stream_id, p_stream_type, p_stream_version, p_event_type;
END;
$$;

-- ============================================================================
-- VERIFICATION: List all overloads after this migration
-- ============================================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  RAISE NOTICE '=== api.create_role overloads ===';
  FOR r IN
    SELECT p.oid, pg_get_function_arguments(p.oid) as args
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'api' AND p.proname = 'create_role'
  LOOP
    RAISE NOTICE 'OID %: %', r.oid, r.args;
  END LOOP;

  RAISE NOTICE '=== api.emit_domain_event overloads ===';
  FOR r IN
    SELECT p.oid, pg_get_function_arguments(p.oid) as args
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'api' AND p.proname = 'emit_domain_event'
  LOOP
    RAISE NOTICE 'OID %: %', r.oid, r.args;
  END LOOP;

  RAISE NOTICE 'Diagnostic stubs deployed. Test role creation to see which overload is called.';
END;
$$;
