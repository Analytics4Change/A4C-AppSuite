-- =====================================================================
-- Backfill `@a4c-rpc-shape:` metadata on every api.* RPC
-- =====================================================================
--
-- Establishes the M3 RPC-shape registry source-of-truth. Every api.* RPC
-- declares its return shape via a `COMMENT ON FUNCTION ... IS '...'`
-- containing the tag `@a4c-rpc-shape: envelope` or `@a4c-rpc-shape: read`.
--
-- The frontend codegen (`frontend/scripts/gen-rpc-registry.cjs`) reads this
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
-- Classification — body introspection (NOT name regex):
--   A function is `envelope` iff it returns jsonb/json AND its body contains
--   `'success', true` or `'success', false` literally — i.e., it builds the
--   Pattern A v2 envelope `RETURN jsonb_build_object('success', ...)` shape.
--   Anything else (TABLE / SETOF / scalar / text[] / non-success-envelope
--   jsonb) is `read`.
--
--   This is deterministic from the function definition. It catches:
--   - Writes that build {success: true, ...} on success and {success: false,
--     error: ...} on failure (most api.update_*, api.create_*, api.delete_*).
--   - "Read" RPCs whose name suggests a query verb but actually return the
--     envelope shape (e.g., api.get_client returns {success: true, data: ...},
--     so the frontend correctly uses apiRpcEnvelope<T>).
--   - "Write" RPCs whose name suggests a verb but return aggregate stats
--     without a top-level success field (e.g., api.bulk_assign_role returns
--     {successful, failed, totalRequested, ...} → read).
--   - Custom-shape jsonb returns like api.safety_net_deactivate_organization
--     ({found, ...}) and api.validate_role_assignment ({valid, violations})
--     → read.
--
--   Verified empirically: produces 89 envelope + 80 read = 169 total,
--   identical to the current correct state of the dev DB after the prior
--   manual fixup (which is now superseded by this self-consistent logic).
--
-- DROP + CREATE FUNCTION (signature change) drops the comment along with
-- the OID. Any migration doing DROP + CREATE MUST re-issue the
-- `COMMENT ON FUNCTION ... '@a4c-rpc-shape: ...'` in the same migration.
-- See infrastructure-guidelines/SKILL.md Rule 17.
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
BEGIN
  FOR v_rpc IN
    SELECT
      p.proname,
      pg_get_function_identity_arguments(p.oid)  AS args,
      pg_get_function_result(p.oid)              AS returns,
      p.prosrc                                    AS body,
      d.description                               AS existing_comment
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_description d ON d.objoid = p.oid AND d.objsubid = 0
    WHERE n.nspname = 'api'
      AND p.prokind = 'f'  -- functions only (not procs/aggregates)
    ORDER BY p.proname, args
  LOOP
    -- Body introspection: jsonb/json return + body builds {success: true|false, ...}
    -- The literal `'success', true` or `'success', false` appears exactly when the
    -- function is constructing the Pattern A v2 envelope. Anything else → read.
    IF v_rpc.returns IN ('jsonb', 'json')
       AND v_rpc.body ~ '''success'',\s*(true|false)'
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

    v_total := v_total + 1;
    IF v_shape = 'envelope' THEN v_envelope := v_envelope + 1; ELSE v_read := v_read + 1; END IF;
  END LOOP;

  RAISE NOTICE 'Tagged % api.* RPCs (% envelope, % read)', v_total, v_envelope, v_read;
END;
$$;
