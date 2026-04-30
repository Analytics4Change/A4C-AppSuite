-- =====================================================================
-- (Historical) Fix RPC shape classifications — now redundant
-- =====================================================================
--
-- ORIGINAL PURPOSE: the backfill migration (20260430172625) initially used
-- a name-prefix regex heuristic that misclassified 13 RPCs:
--   - 4 envelope→read: bulk_assign_role, sync_role_assignments,
--     sync_schedule_assignments, validate_role_assignment (names suggested
--     write verbs but bodies return flat aggregate-stats objects, not the
--     Pattern A v2 envelope).
--   - 9 read→envelope: get_category_field_count, get_client,
--     get_failed_events_with_detail, get_field_usage_count,
--     get_organization_details, get_schedule_template, list_clients,
--     list_schedule_templates, list_user_client_assignments (names suggest
--     read verbs but bodies build {success: true|false, ...} envelopes,
--     typically with a permission-check branch).
--
-- CURRENT STATE: the backfill migration was rewritten to use deterministic
-- body introspection (`prosrc ~ '''success'',\s*(true|false)'`), which
-- classifies all 13 of these correctly without any override list. This
-- migration is therefore an IDEMPOTENT NO-OP on a clean database — its
-- "skip if already correctly tagged" guard fires for every entry in the
-- targets dictionary.
--
-- It remains in the migration history because:
--   1. Removing it would leave dev's `supabase_migrations.schema_migrations`
--      with a row that has no corresponding file (operationally annoying).
--   2. Defense in depth — if a future migration retags any of these 13
--      back to the wrong shape (intentionally or accidentally), this
--      migration would correct them on the next deploy.
--
-- A future Day 0 baseline reset will fold the corrected state back into
-- the consolidated baseline, retiring this migration entirely.
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
