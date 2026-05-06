-- =====================================================================
-- Add in-body tenancy guard to api.update_role
-- =====================================================================
--
-- Follow-up to migration 20260506010451 (SECURITY INVOKER → DEFINER).
-- Architectural review (software-architect-dbc, 2026-05-06) identified
-- a residual cross-tenant exposure that the DEFINER flip introduced:
--
--   Pre-fix (INVOKER), the initial `SELECT * FROM roles_projection WHERE
--   id = p_role_id` was constrained by RLS:
--     - roles_global_select: organization_id IS NULL AND auth user
--     - roles_org_admin_select: organization_id IS NOT NULL AND
--         has_org_admin_permission() AND organization_id = current_org
--   A caller passing a foreign-tenant role id received zero rows and
--   the function returned 'Role not found'.
--
--   Post-fix (DEFINER, BYPASSRLS=true on postgres owner), that SELECT
--   returns rows from any tenant. The subset-only delegation guard
--   (`check_permissions_subset`) prevents a malicious caller from
--   GRANTING permissions cross-tenant, but does NOT prevent revoking
--   permissions from a foreign-tenant role (revocation isn't
--   subset-checked). It also lets cross-tenant updates emit events
--   carrying the caller's `organization_id` in metadata while the
--   stream_id belongs to a different tenant — provenance/audit
--   poisoning.
--
-- This migration restores the prior security envelope by adding an
-- in-body tenancy guard that mirrors the RLS policies it replaced.
-- The guard returns the same `'Role not found'` envelope as the
-- existing not-found branch, so the not-found-vs-cross-tenant
-- distinction remains opaque to callers (matches the canonical pattern
-- used by other tenancy-guarded RPCs — see PR #40 precedent and
-- `infrastructure/supabase/CLAUDE.md` § Critical Rules).
--
-- Function body is otherwise UNCHANGED from migration 20260506010451.
-- The CREATE OR REPLACE preserves the OID and therefore preserves
-- the `@a4c-rpc-shape: envelope` COMMENT (Rule 17 of SKILL.md).
--
-- Tenancy semantics:
--   - Platform admin (`has_platform_privilege()`): unrestricted (matches
--     `roles_projection.platform_admin_all` policy).
--   - Org-scoped role (organization_id IS NOT NULL): caller must be
--     same-tenant AND have org-admin permission.
--   - Global role (organization_id IS NULL): not gated here. Pre-fix
--     RLS allowed any authenticated user to SELECT global role
--     templates; the subset-only delegation guard further constrains
--     what permissions can be granted on them.
--
-- See:
--   - Architect review: PR #47 software-architect-dbc, 2026-05-06
--   - documentation/architecture/decisions/adr-rpc-readback-pattern.md
--     §"Pattern A v2 — capture event_id + race-safe post-emit check"
--   - infrastructure/supabase/CLAUDE.md § Critical Rules (tenancy guard)
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

    -- Tenancy guard (compensates for RLS bypass under SECURITY DEFINER).
    -- Mirrors roles_projection RLS: platform_admin_all OR
    --   (organization_id IS NULL AND auth) OR
    --   (organization_id IS NOT NULL AND has_org_admin_permission() AND
    --    organization_id = get_current_org_id()).
    -- Returns the same 'Role not found' envelope to keep
    -- not-found-vs-cross-tenant indistinguishable.
    IF NOT public.has_platform_privilege() THEN
        IF v_existing.organization_id IS NOT NULL THEN
            IF v_existing.organization_id IS DISTINCT FROM v_org_id
               OR NOT public.has_org_admin_permission() THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'Role not found',
                    'errorDetails', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Role not found or access denied')
                );
            END IF;
        END IF;
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
