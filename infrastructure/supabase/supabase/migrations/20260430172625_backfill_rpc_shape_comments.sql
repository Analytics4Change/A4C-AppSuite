-- =====================================================================
-- Backfill `@a4c-rpc-shape:` metadata on every api.* RPC
-- =====================================================================
--
-- Establishes the M3 RPC-shape registry source-of-truth. Every api.* RPC
-- declares its return shape via a `COMMENT ON FUNCTION ... IS '...'`
-- containing the tag `@a4c-rpc-shape: envelope` or `@a4c-rpc-shape: read`.
--
-- The frontend codegen (`frontend/scripts/gen-rpc-registry.ts`) reads this
-- metadata via pg_description and emits string-literal unions consumed by
-- the helpers `apiRpc<T>` (read shape) and `apiRpcEnvelope<T>` (envelope
-- shape). Wrong-helper-for-shape becomes a compile-time error.
--
-- See:
--   - documentation/architecture/decisions/adr-rpc-readback-pattern.md
--     §"Type-level enforcement (M3)"
--   - .claude/skills/infrastructure-guidelines/SKILL.md (RPC shape rule)
--   - .claude/skills/frontend-dev-guidelines/SKILL.md Rule 11
--
-- Classification rules (encoded in the DO block below):
--   1. Manual override list (e.g., safety_net_deactivate_organization
--      returns {found, ...} not {success, ...}, so it's read-shape).
--   2. Returns jsonb + name matches write-verb regex → envelope.
--   3. Otherwise (TABLE / SETOF / scalar / text[] / read-verb jsonb) → read.
--
-- DROP + CREATE FUNCTION (signature change) drops the comment along with
-- the OID. Any migration doing DROP + CREATE MUST re-issue the
-- `COMMENT ON FUNCTION ... '@a4c-rpc-shape: ...'` in the same migration.
-- See infrastructure-guidelines/SKILL.md.
-- =====================================================================

DO $$
DECLARE
  v_rpc          record;
  v_shape        text;
  v_existing     text;
  v_new_comment  text;
  v_total        int := 0;
  v_envelope     int := 0;
  v_read         int := 0;
  v_overrides    jsonb := jsonb_build_object(
    -- Returns {found, ...} (compensation status), not Pattern A v2 envelope
    'safety_net_deactivate_organization', 'read'
  );
BEGIN
  FOR v_rpc IN
    SELECT
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args,
      pg_get_function_result(p.oid)             AS returns,
      d.description                              AS existing_comment
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_description d ON d.objoid = p.oid AND d.objsubid = 0
    WHERE n.nspname = 'api'
      AND p.prokind = 'f'  -- functions only (not procs/aggregates)
    ORDER BY p.proname, args
  LOOP
    -- Determine shape
    IF v_overrides ? v_rpc.proname THEN
      v_shape := v_overrides ->> v_rpc.proname;
    ELSIF v_rpc.returns = 'jsonb'
       AND v_rpc.proname ~ '^(create|update|delete|revoke|assign|modify|deactivate|reactivate|approve|reject|cancel|set|add|remove|change|grant|emit|switch|sync|bulk_|admit|discharge|register|resend|unassign|end_|batch_update|retry_|dismiss|undismiss|validate|safety_net_)'
    THEN
      v_shape := 'envelope';
    ELSE
      v_shape := 'read';
    END IF;

    -- Skip if already correctly tagged (idempotency on re-run)
    v_existing := COALESCE(v_rpc.existing_comment, '');
    IF v_existing ~ ('@a4c-rpc-shape:\s*' || v_shape || '\b') THEN
      v_total := v_total + 1;
      IF v_shape = 'envelope' THEN v_envelope := v_envelope + 1; ELSE v_read := v_read + 1; END IF;
      CONTINUE;
    END IF;

    -- Compose new comment: preserve existing prose, append/replace tag.
    -- If an existing tag is present (regardless of value), strip it first.
    v_new_comment := regexp_replace(
      v_existing,
      '\n*@a4c-rpc-shape:\s*\w+',
      '',
      'g'
    );
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

    v_total := v_total + 1;
    IF v_shape = 'envelope' THEN v_envelope := v_envelope + 1; ELSE v_read := v_read + 1; END IF;
  END LOOP;

  RAISE NOTICE 'Tagged % api.* RPCs (% envelope, % read)', v_total, v_envelope, v_read;
END;
$$;
