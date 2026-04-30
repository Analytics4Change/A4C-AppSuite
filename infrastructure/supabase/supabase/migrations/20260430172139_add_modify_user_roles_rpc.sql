-- =====================================================================
-- api.modify_user_roles — multi-event Pattern A v2 RPC
-- =====================================================================
--
-- Extracts the manage-user `modify_roles` operation from the Edge Function
-- into a SQL RPC. Last `candidate-for-extraction` from the PR #33 ADR.
-- Closes the `validate_role_assignment` revoke-side gap by validating the
-- UNION of adds and removes (Edge Function only validated adds).
--
-- Authorization model:
--   1. Caller authenticated + tenant context present
--   2. access_blocked JWT-claim guard
--   3. Top-level permission: has_permission('user.role_assign') (unscoped)
--   4. Tenancy guard: target user in caller's tenant (envelope, not RAISE,
--      to avoid leaking cross-tenant existence)
--   5. Target preconditions: not deleted, not deactivated
--   6. Delegation + scope: validate_role_assignment(union of adds+removes)
--      — uses role template scope (org_hierarchy_scope), not user identity
--
-- Multi-event COMPLEX-CASE Pattern A v2:
--   - Captures emitted event IDs in v_added_ids / v_removed_ids uuid[]
--   - Read-back asserts every roleIdsToRemove row absent + every
--     roleIdsToAdd row present in user_roles_projection for current org
--   - On read-back miss, surfaces aggregated processing_error from
--     domain_events WHERE id = ANY(v_event_ids)
--
-- Partial-failure contract (CR-2 from architect review):
--   - RPC is best-effort multi-event, NOT atomic
--   - If a mid-loop emit raises, returns
--     {success: false, partial: true, error: 'PARTIAL_FAILURE', ...}
--   - Re-running with the same input arrays converges to desired state
--     (handlers are idempotent: ON CONFLICT for assigned, DELETE no-op
--     for revoked). NO transactional rollback — would destroy audit rows.
--
-- See:
--   - documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md
--   - documentation/architecture/decisions/adr-rpc-readback-pattern.md
--   - infrastructure/supabase/CLAUDE.md § Pattern A v2
-- =====================================================================

CREATE OR REPLACE FUNCTION api.modify_user_roles(
    p_user_id            uuid,
    p_role_ids_to_add    uuid[] DEFAULT '{}'::uuid[],
    p_role_ids_to_remove uuid[] DEFAULT '{}'::uuid[],
    p_reason             text   DEFAULT 'Roles modified via User Management'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_claims          jsonb := current_setting('request.jwt.claims', true)::jsonb;
    v_caller_id       uuid  := public.get_current_user_id();
    v_org_id          uuid  := NULLIF(v_claims ->> 'org_id', '')::uuid;
    v_access_blocked  boolean := COALESCE((v_claims ->> 'access_blocked')::boolean, false);
    v_target_org_id   uuid;
    v_target_deleted  timestamptz;
    v_target_active   boolean;
    v_validation      jsonb;
    v_role_id         uuid;
    v_event_id        uuid;
    v_added_ids       uuid[] := '{}'::uuid[];
    v_removed_ids     uuid[] := '{}'::uuid[];
    v_processing_error text;
    v_loop_index      int;
    v_failure_section text;
    v_present_count   int;
    v_absent_count    int;
BEGIN
    -- =====================================================================
    -- PRE-EMIT GUARDS (RAISE EXCEPTION; no audit row yet)
    -- =====================================================================

    -- Caller auth + tenant context
    IF v_caller_id IS NULL OR v_org_id IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;

    -- access_blocked JWT-claim guard
    IF v_access_blocked THEN
        RAISE EXCEPTION 'Access blocked: organization is deactivated'
            USING ERRCODE = '42501';
    END IF;

    -- Permission: unscoped user.role_assign
    -- Per the post-2026-04-27 codified rule (infrastructure/supabase/CLAUDE.md
    -- § Critical Rules): A4C user-identities have no organizational location
    -- finer than tenant. Per-role delegation + scope handled by
    -- validate_role_assignment below.
    IF NOT public.has_permission('user.role_assign') THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;

    -- =====================================================================
    -- INPUT VALIDATION (envelope; not RAISE)
    -- =====================================================================

    p_role_ids_to_add    := COALESCE(p_role_ids_to_add,    '{}'::uuid[]);
    p_role_ids_to_remove := COALESCE(p_role_ids_to_remove, '{}'::uuid[]);

    IF array_length(p_role_ids_to_add, 1) IS NULL
       AND array_length(p_role_ids_to_remove, 1) IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'INVALID_INPUT',
            'errorDetails', jsonb_build_object(
                'code',    'INVALID_INPUT',
                'message', 'At least one of roleIdsToAdd or roleIdsToRemove must be non-empty'
            )
        );
    END IF;

    -- =====================================================================
    -- TENANCY + TARGET PRECONDITIONS (envelope, not RAISE)
    -- =====================================================================

    SELECT current_organization_id, deleted_at, is_active
    INTO   v_target_org_id, v_target_deleted, v_target_active
    FROM   public.users
    WHERE  id = p_user_id;

    -- Tenancy guard: same envelope as not-found to avoid leaking existence
    IF NOT FOUND OR v_target_org_id IS DISTINCT FROM v_org_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'NOT_FOUND',
            'errorDetails', jsonb_build_object(
                'code',    'NOT_FOUND',
                'message', 'User not found in this organization'
            )
        );
    END IF;

    -- Already-deleted
    IF v_target_deleted IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'NOT_FOUND',
            'errorDetails', jsonb_build_object(
                'code',    'NOT_FOUND',
                'message', 'User has been deleted'
            )
        );
    END IF;

    -- Deactivated
    IF v_target_active IS NOT TRUE THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'TARGET_DEACTIVATED',
            'errorDetails', jsonb_build_object(
                'code',    'TARGET_DEACTIVATED',
                'message', 'Cannot modify roles on a deactivated user'
            )
        );
    END IF;

    -- =====================================================================
    -- DELEGATION + SCOPE (validate_role_assignment on UNION of adds+removes)
    -- =====================================================================

    v_validation := api.validate_role_assignment(
        p_role_ids := array_cat(p_role_ids_to_add, p_role_ids_to_remove)
    );

    IF NOT (v_validation ->> 'valid')::boolean THEN
        RETURN jsonb_build_object(
            'success',    false,
            'error',      'VALIDATION_FAILED',
            'violations', v_validation -> 'violations'
        );
    END IF;

    -- =====================================================================
    -- EMIT REVOKES (loop-with-failure-capture)
    -- =====================================================================

    v_failure_section := 'remove';
    v_loop_index := 0;
    FOREACH v_role_id IN ARRAY p_role_ids_to_remove
    LOOP
        BEGIN
            v_event_id := api.emit_domain_event(
                p_stream_id   := p_user_id,
                p_stream_type := 'user',
                p_event_type  := 'user.role.revoked',
                p_event_data  := jsonb_build_object(
                    'user_id',     p_user_id,
                    'role_id',     v_role_id,
                    'org_id',      v_org_id,
                    'revoked_at',  now()
                ),
                p_event_metadata := jsonb_build_object(
                    'user_id',         v_caller_id,
                    'organization_id', v_org_id,
                    'reason',          p_reason,
                    'source',          'api.modify_user_roles',
                    'idempotency_key', concat('revoke:', p_user_id::text, ':', v_role_id::text)
                )
            );
            v_removed_ids := v_removed_ids || v_event_id;
        EXCEPTION WHEN OTHERS THEN
            -- Mid-loop failure: short-circuit and surface partial state.
            -- NO RAISE — would roll back audit rows already persisted with
            -- processing_error. Re-running with same inputs converges
            -- (handlers are idempotent on the projection unique key).
            RETURN jsonb_build_object(
                'success',             false,
                'partial',             true,
                'error',               'PARTIAL_FAILURE',
                'userId',              p_user_id,
                'addedRoleEventIds',   to_jsonb(v_added_ids),
                'removedRoleEventIds', to_jsonb(v_removed_ids),
                'failureIndex',        v_loop_index,
                'failureSection',      v_failure_section,
                'processingError',     SQLERRM
            );
        END;
        v_loop_index := v_loop_index + 1;
    END LOOP;

    -- =====================================================================
    -- EMIT ADDS (loop-with-failure-capture)
    -- =====================================================================

    v_failure_section := 'add';
    v_loop_index := 0;
    FOREACH v_role_id IN ARRAY p_role_ids_to_add
    LOOP
        BEGIN
            v_event_id := api.emit_domain_event(
                p_stream_id   := p_user_id,
                p_stream_type := 'user',
                p_event_type  := 'user.role.assigned',
                p_event_data  := jsonb_build_object(
                    'user_id',     p_user_id,
                    'role_id',     v_role_id,
                    'org_id',      v_org_id,
                    'assigned_at', now()
                ),
                p_event_metadata := jsonb_build_object(
                    'user_id',         v_caller_id,
                    'organization_id', v_org_id,
                    'reason',          p_reason,
                    'source',          'api.modify_user_roles',
                    'idempotency_key', concat('assign:', p_user_id::text, ':', v_role_id::text)
                )
            );
            v_added_ids := v_added_ids || v_event_id;
        EXCEPTION WHEN OTHERS THEN
            RETURN jsonb_build_object(
                'success',             false,
                'partial',             true,
                'error',               'PARTIAL_FAILURE',
                'userId',              p_user_id,
                'addedRoleEventIds',   to_jsonb(v_added_ids),
                'removedRoleEventIds', to_jsonb(v_removed_ids),
                'failureIndex',        v_loop_index,
                'failureSection',      v_failure_section,
                'processingError',     SQLERRM
            );
        END;
        v_loop_index := v_loop_index + 1;
    END LOOP;

    -- =====================================================================
    -- PATTERN A v2 READ-BACK (multi-event aggregate)
    -- =====================================================================

    -- Removes must be absent in current tenant
    IF array_length(p_role_ids_to_remove, 1) IS NOT NULL THEN
        SELECT COUNT(*) INTO v_present_count
        FROM   public.user_roles_projection
        WHERE  user_id = p_user_id
          AND  role_id = ANY(p_role_ids_to_remove)
          AND  organization_id = v_org_id;

        IF v_present_count > 0 THEN
            SELECT string_agg(processing_error, ' | ')
            INTO   v_processing_error
            FROM   public.domain_events
            WHERE  id = ANY(v_removed_ids)
              AND  processing_error IS NOT NULL;

            RETURN jsonb_build_object(
                'success',             false,
                'error',               'PROCESSING_ERROR',
                'userId',              p_user_id,
                'addedRoleEventIds',   to_jsonb(v_added_ids),
                'removedRoleEventIds', to_jsonb(v_removed_ids),
                'errorDetails', jsonb_build_object(
                    'code',    'PROCESSING_ERROR',
                    'message', COALESCE(
                        v_processing_error,
                        'Revoke read-back failed: ' || v_present_count::text || ' role(s) still present'
                    )
                )
            );
        END IF;
    END IF;

    -- Adds must be present in current tenant
    IF array_length(p_role_ids_to_add, 1) IS NOT NULL THEN
        SELECT COUNT(*) INTO v_absent_count
        FROM   unnest(p_role_ids_to_add) AS expected(role_id)
        WHERE  NOT EXISTS (
            SELECT 1 FROM public.user_roles_projection
            WHERE  user_id = p_user_id
              AND  role_id = expected.role_id
              AND  organization_id = v_org_id
        );

        IF v_absent_count > 0 THEN
            SELECT string_agg(processing_error, ' | ')
            INTO   v_processing_error
            FROM   public.domain_events
            WHERE  id = ANY(v_added_ids)
              AND  processing_error IS NOT NULL;

            RETURN jsonb_build_object(
                'success',             false,
                'error',               'PROCESSING_ERROR',
                'userId',              p_user_id,
                'addedRoleEventIds',   to_jsonb(v_added_ids),
                'removedRoleEventIds', to_jsonb(v_removed_ids),
                'errorDetails', jsonb_build_object(
                    'code',    'PROCESSING_ERROR',
                    'message', COALESCE(
                        v_processing_error,
                        'Assign read-back failed: ' || v_absent_count::text || ' role(s) not present'
                    )
                )
            );
        END IF;
    END IF;

    -- =====================================================================
    -- SUCCESS
    -- =====================================================================
    RETURN jsonb_build_object(
        'success',             true,
        'userId',              p_user_id,
        'addedRoleEventIds',   to_jsonb(v_added_ids),
        'removedRoleEventIds', to_jsonb(v_removed_ids)
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION api.modify_user_roles(uuid, uuid[], uuid[], text) TO authenticated;

COMMENT ON FUNCTION api.modify_user_roles(uuid, uuid[], uuid[], text) IS
$comment$Modify a user's role assignments by emitting user.role.revoked then user.role.assigned events.

Operates within get_current_org_id() for both adds and revokes — removes the
(p_user_id, role_id, current_org_id) triple only, does NOT affect assignments
at other tenants. Authorization gate uses validate_role_assignment on the
UNION of adds+removes (closes the revoke-side gap that existed in the legacy
manage-user Edge Function modify_roles operation).

Multi-event COMPLEX-CASE Pattern A v2: emits N revokes then M adds, captures
event_ids in arrays, reads back projection state, surfaces aggregated
processing_error from domain_events on miss. RPC is best-effort multi-event;
on mid-loop emit failure returns {success: false, partial: true, ...} with
failureIndex / failureSection. Re-running with the same input arrays
converges to the desired state (handlers are idempotent).

Authorization:
  - access_blocked JWT-claim guard
  - has_permission('user.role_assign') unscoped
  - tenancy guard: target.current_organization_id = current org (envelope NOT_FOUND)
  - validate_role_assignment(adds || removes) for delegation + template-scope containment

Response envelopes:
  Success:           {success: true, userId, addedRoleEventIds[], removedRoleEventIds[]}
  Validation:        {success: false, error: VALIDATION_FAILED, violations[]}
  Partial:           {success: false, partial: true, error: PARTIAL_FAILURE, userId, addedRoleEventIds, removedRoleEventIds, failureIndex, failureSection, processingError}
  NOT_FOUND:         {success: false, error: NOT_FOUND, errorDetails: {code, message}}
  TARGET_DEACTIVATED:{success: false, error: TARGET_DEACTIVATED, errorDetails: {code, message}}
  PROCESSING_ERROR:  {success: false, error: PROCESSING_ERROR, userId, addedRoleEventIds, removedRoleEventIds, errorDetails: {code, message}}

@a4c-rpc-shape: envelope$comment$;
