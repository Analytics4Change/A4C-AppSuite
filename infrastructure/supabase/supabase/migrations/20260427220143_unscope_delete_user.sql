-- =============================================================================
-- Migration: unscope_delete_user (revert R1 of architectural course correction)
--
-- Purpose:
--   Revert the scoped-permission retrofit applied in
--   20260427205333_extract_delete_user_rpc.sql. That migration used
--   public.has_effective_permission('user.delete', get_user_target_path(...))
--   based on a misunderstanding of A4C's user model: it assumed users have
--   OU-bounded organizational location ("home OU") that could be the target
--   of scope-aware permission checks. The user-model authority clarified:
--   users live at the org level. There is no per-user organizational path.
--   The scoped check was vacuous (helper always returned org root) and
--   installed a misleading mental model.
--
-- Decision: revert to public.has_permission('user.delete') paired with an
-- explicit JWT-org_id-based tenancy guard. PR #36 / PR #39 precedent.
--
-- See:
--   - documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md
--     (Rollout 2026-04-27 § course correction) for the architectural-pivot
--     story and the empirical scope-distribution evidence.
--   - dev/active/sub-tenant-admin-design/ for the deferred capability that
--     would re-introduce scoped checks for user-targeted ops, gated on a
--     user-model redesign.
--
-- Surviving improvements from M2 (NOT reverted):
--   - Pattern A v2 read-back against users.deleted_at + processing_error
--   - Pre-emit idempotency guard (already-deleted users return success-false)
--   - access_blocked JWT-claim guard
--
-- Tenancy enforcement:
--   The previous version inherited the tenancy check via the helper's
--   "User not in tenant" 42501 raise. With the helper gone, this migration
--   adds an explicit inline lookup: SELECT current_organization_id from users;
--   if it doesn't match v_org_id, return same envelope as not-found (avoids
--   leaking user-existence across tenants).
-- =============================================================================

CREATE OR REPLACE FUNCTION api.delete_user(
    p_user_id uuid,
    p_reason text DEFAULT 'Manual delete'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_claims jsonb := current_setting('request.jwt.claims', true)::jsonb;
    v_caller_id uuid := public.get_current_user_id();
    v_org_id uuid := NULLIF(v_claims ->> 'org_id', '')::uuid;
    v_access_blocked boolean := COALESCE((v_claims ->> 'access_blocked')::boolean, false);
    v_target_org_id uuid;
    v_existing_deleted_at timestamptz;
    v_event_id uuid;
    v_processing_error text;
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

    -- Permission: unscoped user.delete (per PR #36/#39 pattern; see
    -- adr-edge-function-vs-sql-rpc.md Rollout course correction for why
    -- scoped checks are not warranted for user-identity targets in A4C).
    IF NOT public.has_permission('user.delete') THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;

    -- =====================================================================
    -- TENANCY + IDEMPOTENCY (envelope, not RAISE)
    -- =====================================================================

    -- Look up target user's tenant + delete state in one read.
    SELECT current_organization_id, deleted_at
    INTO v_target_org_id, v_existing_deleted_at
    FROM public.users
    WHERE id = p_user_id;

    -- Tenancy guard: target must be in caller's tenant. Same envelope as
    -- not-found to avoid leaking user-existence across tenants.
    IF NOT FOUND OR v_target_org_id IS DISTINCT FROM v_org_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'User not found in this organization'
        );
    END IF;

    -- Idempotency: already-deleted target returns success-false envelope
    -- (avoids audit-log noise from no-op events).
    IF v_existing_deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'User is already deleted'
        );
    END IF;

    -- =====================================================================
    -- EMIT user.deleted EVENT
    -- =====================================================================

    v_event_id := api.emit_domain_event(
        p_stream_id := p_user_id,
        p_stream_type := 'user',
        p_event_type := 'user.deleted',
        p_event_data := jsonb_build_object(
            'user_id', p_user_id,
            'org_id', v_org_id,
            'deleted_at', now(),
            'reason', p_reason
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', v_caller_id,
            'organization_id', v_org_id,
            'source', 'api.delete_user',
            'reason', p_reason
        )
    );

    -- =====================================================================
    -- PATTERN A v2 READ-BACK (BOTH checks per Rule 13)
    -- =====================================================================

    -- Check 1: IF NOT FOUND on the projection read-back (predicate
    -- requires deleted_at IS NOT NULL, so absence means handler didn't update)
    PERFORM 1
    FROM public.users
    WHERE id = p_user_id AND deleted_at IS NOT NULL;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM public.domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' ||
                COALESCE(v_processing_error, 'projection read-back returned no row')
        );
    END IF;

    -- Check 2: processing_error on captured event_id
    SELECT processing_error INTO v_processing_error
    FROM public.domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || v_processing_error
        );
    END IF;

    -- =====================================================================
    -- SUCCESS
    -- =====================================================================
    RETURN jsonb_build_object(
        'success', true,
        'eventId', v_event_id,
        'userId', p_user_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION api.delete_user(uuid, text) TO authenticated;

COMMENT ON FUNCTION api.delete_user(uuid, text) IS
$$Soft-deletes a user by emitting user.deleted; handle_user_deleted updates
users.deleted_at + is_active.

Preconditions:
  - JWT must supply `sub` and `org_id`.
  - `access_blocked` claim must be absent or false.
  - Caller must hold `user.delete` (any role grants suffice; check is unscoped
    because users-as-identities have no organizational location to scope
    against in A4C's current model).
  - Target user must exist in the caller's tenant
    (users.current_organization_id = caller's JWT org_id).

Postconditions:
  - On success: one user.deleted event in domain_events with
    {user_id, org_id, deleted_at, reason} in event_data.
  - On success: users.deleted_at IS NOT NULL, is_active = false.
  - On handler failure: domain_events row preserved with processing_error
    (audit-trail-preservation per adr-rpc-readback-pattern.md).
  - Never RAISE EXCEPTION post-emit (preserves audit row per Rule 13).

Error envelope:
  42501 (RAISE)            - caller auth missing, access_blocked, or
                             permission denied (pre-emit).
  success:false envelope   - target not found / wrong tenant (envelope
                             matches not-found to avoid cross-tenant leak),
                             OR already-deleted target,
                             OR handler-driven failure.

Response shape:
  Success: {"success": true, "eventId": uuid, "userId": uuid}
  Failure: {"success": false, "error": text}

Tenancy model:
  Cross-tenant lookup attempts return the same envelope as not-found to
  avoid leakage of user-existence across tenants. The function does NOT
  use scope-aware permission checks because A4C users have no
  organizational location finer than tenant; see
  adr-edge-function-vs-sql-rpc.md Rollout 2026-04-27 § course correction.

References:
  - adr-edge-function-vs-sql-rpc.md - Rollout 2026-04-27 (this PR + course correction).
  - adr-rpc-readback-pattern.md - Pattern A v2 contract.
  - handle_user_deleted.sql - target handler.
  - dev/active/sub-tenant-admin-design/ - deferred capability that would
    re-introduce scoped checks for user-targeted ops once user-model gains
    OU-bounded identity.
$$;
