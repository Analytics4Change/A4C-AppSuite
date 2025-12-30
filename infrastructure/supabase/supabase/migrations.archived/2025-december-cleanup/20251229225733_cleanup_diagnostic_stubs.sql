-- =============================================================================
-- Migration: Clean up diagnostic stub functions from Phase 8 debugging
-- Purpose: Remove temporary diagnostic stubs that were used to identify
--          function overload resolution issues. Root cause was RLS recursion.
-- =============================================================================
--
-- BACKGROUND:
-- During Phase 8 (RLS recursion debugging), migration 20251229220540 created
-- diagnostic stubs that RAISE EXCEPTION to identify which function overloads
-- PostgreSQL was selecting. The comment explicitly stated "TEMPORARY".
--
-- ROOT CAUSE FOUND: RLS circular recursion (fixed in 20251229221456), NOT
-- function overload ambiguity. These stubs are now dead code.
--
-- CANONICAL FUNCTIONS REMAINING:
-- - api.create_role(text, text, text, uuid[], uuid) - 5-param with p_cloned_from_role_id
-- - api.emit_domain_event(uuid, text, text, jsonb, jsonb) - 5-param auto-version
-- =============================================================================

-- DROP the 4-param api.create_role stub
-- Signature: (p_name text, p_description text, p_org_hierarchy_scope text, p_permission_ids uuid[])
DROP FUNCTION IF EXISTS api.create_role(text, text, text, uuid[]);

-- DROP the 6-param legacy api.emit_domain_event stub
-- Signature: (p_event_id uuid, p_event_type text, p_aggregate_type text, p_aggregate_id uuid, p_event_data jsonb, p_event_metadata jsonb)
DROP FUNCTION IF EXISTS api.emit_domain_event(uuid, text, text, uuid, jsonb, jsonb);

-- DROP the 6-param explicit api.emit_domain_event stub
-- Signature: (p_stream_id uuid, p_stream_type text, p_stream_version integer, p_event_type text, p_event_data jsonb, p_event_metadata jsonb)
DROP FUNCTION IF EXISTS api.emit_domain_event(uuid, text, integer, text, jsonb, jsonb);

-- =============================================================================
-- Verification: Show remaining overloads
-- =============================================================================
DO $$
DECLARE
  r RECORD;
  v_create_role_count INT := 0;
  v_emit_event_count INT := 0;
BEGIN
  RAISE NOTICE '=== Remaining api.create_role overloads ===';
  FOR r IN
    SELECT pg_get_function_identity_arguments(p.oid) as args
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'api' AND p.proname = 'create_role'
  LOOP
    v_create_role_count := v_create_role_count + 1;
    RAISE NOTICE '  [%] %', v_create_role_count, r.args;
  END LOOP;

  RAISE NOTICE '=== Remaining api.emit_domain_event overloads ===';
  FOR r IN
    SELECT pg_get_function_identity_arguments(p.oid) as args
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'api' AND p.proname = 'emit_domain_event'
  LOOP
    v_emit_event_count := v_emit_event_count + 1;
    RAISE NOTICE '  [%] %', v_emit_event_count, r.args;
  END LOOP;

  -- Validate expected counts
  IF v_create_role_count != 1 THEN
    RAISE WARNING 'Expected 1 api.create_role overload, found %', v_create_role_count;
  ELSE
    RAISE NOTICE 'api.create_role: OK (1 canonical overload)';
  END IF;

  IF v_emit_event_count != 1 THEN
    RAISE WARNING 'Expected 1 api.emit_domain_event overload, found %', v_emit_event_count;
  ELSE
    RAISE NOTICE 'api.emit_domain_event: OK (1 canonical overload)';
  END IF;

  RAISE NOTICE 'Diagnostic stubs cleanup complete.';
END;
$$;
