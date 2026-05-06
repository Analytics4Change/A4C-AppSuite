-- =====================================================================
-- Fix: api.update_role must run as SECURITY DEFINER
-- =====================================================================
--
-- Bug: as of baseline_v4 (and through 2026-05-06), `api.update_role` is
-- the ONLY api.* function that reads from `public.domain_events` while
-- running as `SECURITY INVOKER`. The Pattern A v2 read-back at the end
-- of the function body executes:
--
--   SELECT processing_error FROM domain_events
--   WHERE id = ANY(v_event_ids) AND processing_error IS NOT NULL
--   ORDER BY created_at DESC LIMIT 1;
--
-- The `authenticated` Postgres role has zero table-level grants on
-- `public.domain_events` (only `postgres` does). Because `api.update_role`
-- runs as the caller, the SELECT raises SQLSTATE 42501 ("permission
-- denied for table domain_events"), which PostgREST surfaces as HTTP 403
-- to the frontend. The user sees "Failed to update role / permission
-- denied for table domain_events" and the entire edit-role flow is
-- broken — no `role.updated`, `role.permission.granted`, or
-- `role.permission.revoked` events fire.
--
-- This has been broken since at least 2026-04-08 (last successful
-- `role.updated` event before the user's 2026-05-05/06 reproduction),
-- but went unnoticed because role-edit is a low-frequency flow.
--
-- Discovery: surfaced 2026-05-06 by `johnltice@yahoo.com` (provider_admin
-- at testorg-20260329) attempting to add permissions to the existing
-- "South Valley Admin" role as setup for UAT scenario 4 of the
-- modify_user_roles plan.
--
-- Convention check (run 2026-05-06):
--   60 of 61 api.* functions that read from domain_events are
--   SECURITY DEFINER. api.update_role is the lone INVOKER outlier.
--
-- Fix: change `api.update_role` to `SECURITY DEFINER`. Function body
-- unchanged. The DEFINER (postgres role) has all table-level grants on
-- domain_events and `rolbypassrls=true`, so the read-back's SELECT
-- succeeds. The function still calls `auth.uid()` and reads
-- `request.jwt.claims` for caller identity — those use session settings
-- not the function's executing role, so SECURITY DEFINER does NOT defeat
-- the per-caller permission/scope checks.
--
-- Idempotency: `CREATE OR REPLACE FUNCTION` preserves the function's
-- OID. The existing `COMMENT ON FUNCTION` (carrying the
-- `@a4c-rpc-shape: envelope` tag from PR #44's M3 backfill) is keyed to
-- OID and therefore preserved automatically. Per Rule 17 of
-- `.claude/skills/infrastructure-guidelines/SKILL.md`, the DROP+CREATE
-- re-tag rule does NOT apply here because we are NOT changing the
-- function signature — only the SECURITY mode. No COMMENT re-issue
-- required.
--
-- See:
--   - documentation/architecture/decisions/adr-rpc-readback-pattern.md
--     §"Pattern A v2 — capture event_id + race-safe post-emit check"
--   - infrastructure/supabase/CLAUDE.md § Critical Rules (Pattern A v2)
-- =====================================================================

CREATE OR REPLACE FUNCTION api.update_role(
    p_role_id        uuid,
    p_name           text DEFAULT NULL::text,
    p_description    text DEFAULT NULL::text,
    p_permission_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_user_id uuid;
    v_org_id uuid;
    v_existing record;
    v_current_perms uuid[];
    v_new_perms uuid[];
    v_to_grant uuid[];
    v_to_revoke uuid[];
    v_perm_id uuid;
    v_user_perms uuid[];
    v_perm_name text;
    v_row record;
    v_perm_ids_after uuid[];
    v_processing_error text;
    v_event_ids uuid[] := '{}';  -- M2: capture every emit's id for race-safe PK check
BEGIN
    v_user_id := public.get_current_user_id();
    v_org_id := public.get_current_org_id();

    -- Caller-driven validation (pre-emit) — unchanged
    SELECT * INTO v_existing FROM roles_projection
    WHERE id = p_role_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Role not found',
            'errorDetails', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Role not found or access denied')
        );
    END IF;

    IF NOT v_existing.is_active THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Cannot update inactive role',
            'errorDetails', jsonb_build_object('code', 'INACTIVE_ROLE', 'message', 'Reactivate the role before making changes')
        );
    END IF;

    -- Emit role.updated event if name or description changed
    IF p_name IS NOT NULL OR p_description IS NOT NULL THEN
        v_event_ids := array_append(v_event_ids, api.emit_domain_event(
            p_stream_id := p_role_id,
            p_stream_type := 'role',
            p_event_type := 'role.updated',
            p_event_data := jsonb_build_object(
                'name', COALESCE(p_name, v_existing.name),
                'description', COALESCE(p_description, v_existing.description)
            ),
            p_event_metadata := jsonb_build_object(
                'user_id', v_user_id,
                'organization_id', v_org_id,
                'reason', 'Role metadata update via Role Management UI'
            )
        ));
    END IF;

    -- Handle permission changes
    IF p_permission_ids IS NOT NULL THEN
        SELECT array_agg(permission_id) INTO v_current_perms
        FROM role_permissions_projection WHERE role_id = p_role_id;
        v_current_perms := COALESCE(v_current_perms, '{}');
        v_new_perms := p_permission_ids;

        v_user_perms := public.get_user_aggregated_permissions(v_user_id);

        v_to_grant := ARRAY(SELECT unnest(v_new_perms) EXCEPT SELECT unnest(v_current_perms));

        IF NOT public.check_permissions_subset(v_to_grant, v_user_perms) THEN
            FOREACH v_perm_id IN ARRAY v_to_grant
            LOOP
                IF NOT (v_perm_id = ANY(v_user_perms)) THEN
                    SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
                    RETURN jsonb_build_object(
                        'success', false,
                        'error', 'Cannot grant permission you do not possess',
                        'errorDetails', jsonb_build_object(
                            'code', 'SUBSET_ONLY_VIOLATION',
                            'message', format('Permission %s is not in your granted set', COALESCE(v_perm_name, v_perm_id::text))
                        )
                    );
                END IF;
            END LOOP;
        END IF;

        v_to_revoke := ARRAY(SELECT unnest(v_current_perms) EXCEPT SELECT unnest(v_new_perms));

        FOREACH v_perm_id IN ARRAY v_to_grant
        LOOP
            SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
            v_event_ids := array_append(v_event_ids, api.emit_domain_event(
                p_stream_id := p_role_id,
                p_stream_type := 'role',
                p_event_type := 'role.permission.granted',
                p_event_data := jsonb_build_object(
                    'permission_id', v_perm_id,
                    'permission_name', v_perm_name
                ),
                p_event_metadata := jsonb_build_object(
                    'user_id', v_user_id,
                    'organization_id', v_org_id,
                    'reason', 'Permission added via Role Management UI'
                )
            ));
        END LOOP;

        FOREACH v_perm_id IN ARRAY v_to_revoke
        LOOP
            SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
            v_event_ids := array_append(v_event_ids, api.emit_domain_event(
                p_stream_id := p_role_id,
                p_stream_type := 'role',
                p_event_type := 'role.permission.revoked',
                p_event_data := jsonb_build_object(
                    'permission_id', v_perm_id,
                    'permission_name', v_perm_name,
                    'revocation_reason', 'Permission removed via Role Management UI'
                ),
                p_event_metadata := jsonb_build_object(
                    'user_id', v_user_id,
                    'organization_id', v_org_id,
                    'reason', 'Permission removed via Role Management UI'
                )
            ));
        END LOOP;
    END IF;

    -- Pattern A COMPLEX-CASE read-back: compose role row + permission_ids array
    SELECT * INTO v_row FROM roles_projection WHERE id = p_role_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        -- M2 fix: race-safe — lookup failure among THIS RPC's emitted events only
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE id = ANY(v_event_ids) AND processing_error IS NOT NULL
        ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    SELECT array_agg(permission_id ORDER BY permission_id) INTO v_perm_ids_after
    FROM role_permissions_projection WHERE role_id = p_role_id;
    v_perm_ids_after := COALESCE(v_perm_ids_after, '{}');

    -- M2 fix: replaces 5-second-window with captured-ID PK scan.
    -- Empty v_event_ids (no-op update) → no rows → v_processing_error IS NULL → success.
    SELECT processing_error INTO v_processing_error
    FROM domain_events
    WHERE id = ANY(v_event_ids) AND processing_error IS NOT NULL
    ORDER BY created_at DESC LIMIT 1;

    RETURN jsonb_build_object(
        'success', v_processing_error IS NULL,
        'role', row_to_json(v_row)::jsonb,
        'permission_ids', to_jsonb(v_perm_ids_after),
        'error', CASE WHEN v_processing_error IS NOT NULL
                      THEN 'Event processing failed: ' || v_processing_error
                      ELSE NULL END
    );
END;
$function$;
