-- =====================================================================
-- Fix RPC shape classifications missed by the verb-regex heuristic
-- =====================================================================
--
-- The backfill migration (20260430172625) classified by name-prefix regex,
-- which misclassified two groups:
--
-- 1. envelope→read (4 RPCs): name matches a write verb but the success-path
--    return is flat data, NOT a Pattern A v2 envelope. These functions
--    return aggregate batch results without a top-level `success` boolean.
--
-- 2. read→envelope (9 RPCs): name matches a read verb but the function
--    returns the {success: true|false, ...} envelope (typically because
--    it has a permission-check branch returning {success: false, error}).
--
-- This migration retags both groups idempotently. It DOES NOT alter
-- function bodies — only `COMMENT ON FUNCTION ... IS '...'`. Comment is
-- keyed to OID, so signature-stable retag is safe.
-- =====================================================================

DO $$
DECLARE
  v_rpc          record;
  v_shape        text;
  v_existing     text;
  v_new_comment  text;
  v_targets      jsonb := jsonb_build_object(
    -- envelope → read (success path returns flat data, no `success` field)
    'bulk_assign_role',          'read',
    'sync_role_assignments',     'read',
    'sync_schedule_assignments', 'read',
    'validate_role_assignment',  'read',
    -- read → envelope (returns {success: true|false, ...})
    'get_category_field_count',     'envelope',
    'get_client',                   'envelope',
    'get_failed_events_with_detail','envelope',
    'get_field_usage_count',        'envelope',
    'get_organization_details',     'envelope',
    'get_schedule_template',        'envelope',
    'list_clients',                 'envelope',
    'list_schedule_templates',      'envelope',
    'list_user_client_assignments', 'envelope'
  );
  v_count int := 0;
BEGIN
  FOR v_rpc IN
    SELECT
      p.oid,
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args,
      d.description                              AS existing_comment
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_description d ON d.objoid = p.oid AND d.objsubid = 0
    WHERE n.nspname = 'api'
      AND p.prokind = 'f'
      AND v_targets ? p.proname
  LOOP
    v_shape := v_targets ->> v_rpc.proname;
    v_existing := COALESCE(v_rpc.existing_comment, '');

    -- Skip if already correctly tagged
    IF v_existing ~ ('@a4c-rpc-shape:\s*' || v_shape || '\b') THEN
      CONTINUE;
    END IF;

    -- Strip any existing tag and append the corrected one
    v_new_comment := regexp_replace(v_existing, '\n*@a4c-rpc-shape:\s*\w+', '', 'g');
    v_new_comment := rtrim(v_new_comment);
    IF v_new_comment <> '' THEN
      v_new_comment := v_new_comment || E'\n\n@a4c-rpc-shape: ' || v_shape;
    ELSE
      v_new_comment := '@a4c-rpc-shape: ' || v_shape;
    END IF;

    EXECUTE format(
      'COMMENT ON FUNCTION api.%I(%s) IS %L',
      v_rpc.proname, v_rpc.args, v_new_comment
    );
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Retagged % RPC(s) with corrected shape', v_count;
END;
$$;
