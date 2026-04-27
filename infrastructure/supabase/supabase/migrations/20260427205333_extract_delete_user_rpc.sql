-- =============================================================================
-- Migration: extract_delete_user_rpc
-- Purpose:   Create api.delete_user(uuid, text) — extracts the `delete` operation
--            from the manage-user Edge Function into a SQL RPC with Pattern A v2
--            read-back and scoped permissions from inception.
--
-- Context:
--   Per adr-edge-function-vs-sql-rpc.md inventory row #10 (candidate-for-extraction).
--   The Edge Function path emitted user.deleted with no read-back or processing_error
--   check (silent-failure gap). This RPC closes that gap by construction and uses the
--   canonical scoped-permission pattern via public.get_user_target_path (M1).
--
-- Schema dependencies (verified 2026-04-27):
--   - public.get_user_target_path(uuid, uuid) — created in M1.
--   - public.has_effective_permission(text, ltree) — baseline_v4:9827-9842.
--   - public.handle_user_deleted(record) — handlers/user/handle_user_deleted.sql
--     (defined in PR #35, commit 8eae916f).
--   - permissions_projection.name 'user.delete' exists.
--   - users.deleted_at, users.is_active — soft-delete shape.
--
-- Baseline-overload audit (Rule 15):
--   - api.delete_user does not exist in baseline_v4 — clean creation, no DROP needed.
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
    v_target_path extensions.ltree;
    v_event_id uuid;
    v_processing_error text;
    v_existing_deleted_at timestamptz;
    v_readback_deleted_at timestamptz;
BEGIN
    -- =====================================================================
    -- PRE-EMIT GUARDS (RAISE EXCEPTION; pre-event, no audit row yet)
    -- =====================================================================

    -- Caller auth + tenant context
    IF v_caller_id IS NULL OR v_org_id IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;

    -- access_blocked JWT-claim guard (matches Edge Function precedent at
    -- manage-user/index.ts:192-198 and PR #39 invite-user/index.ts:484-491)
    IF v_access_blocked THEN
        RAISE EXCEPTION 'Access blocked: organization is deactivated'
            USING ERRCODE = '42501';
    END IF;

    -- Resolve target path (raises 42501 if user not in tenant,
    -- P0002 if not found, 22023 if null arg)
    v_target_path := public.get_user_target_path(p_user_id, v_org_id);

    -- Scoped permission check (canonical pattern post-2026-04-27)
    IF NOT public.has_effective_permission('user.delete', v_target_path) THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;

    -- =====================================================================
    -- IDEMPOTENCY GUARD (success:false envelope; not a hard error)
    -- =====================================================================

    SELECT deleted_at INTO v_existing_deleted_at
    FROM public.users WHERE id = p_user_id;

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
    -- PATTERN A v2 READ-BACK (BOTH checks required per Rule 13)
    -- =====================================================================

    -- Check 1: IF NOT FOUND on the projection read-back
    SELECT deleted_at INTO v_readback_deleted_at
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
  - p_user_id is non-null, refers to an existing user, in the caller's tenant.
  - Caller must hold `user.delete` scoped to the target's organizational location
    (resolved via public.get_user_target_path).

Postconditions:
  - On success: one user.deleted event in domain_events with
    {user_id, org_id, deleted_at, reason} in event_data.
  - On success: users.deleted_at IS NOT NULL, is_active = false.
  - On handler failure: domain_events row preserved with processing_error
    (audit-trail-preservation per adr-rpc-readback-pattern.md).
  - Never RAISE EXCEPTION post-emit (preserves audit row per Rule 13).

Error envelope:
  42501 (RAISE) - caller auth missing, access_blocked, target outside tenant,
                  or scoped permission denied (pre-emit).
  P0002 (RAISE) - target user does not exist (pre-emit, via helper).
  22023 (RAISE) - p_user_id null (pre-emit, via helper).
  raise_exception (RAISE) - org has no path; data integrity (pre-emit, via helper).
  success:false envelope - already-deleted target OR handler-driven failure.

Response shape:
  Success: {"success": true, "eventId": uuid, "userId": uuid}
  Failure: {"success": false, "error": text}

Soft-delete model:
  - handle_user_deleted (handlers/user/handle_user_deleted.sql) sets:
      users.deleted_at = COALESCE(deleted_at, event_data->>'deleted_at', created_at)
      users.is_active  = false
      users.updated_at = event.created_at
  - COALESCE order is replay-safe: existing tombstone wins.
  - No cascade to projections; orphan reads closed at read-side via api.* filters
    (PR #35, commit 8eae916f).
  - auth.users record is NOT modified (no auth.admin call) - confirmed Phase 0 O3.

Pattern A v2 read-back:
  - Predicate: WHERE id = p_user_id AND deleted_at IS NOT NULL
  - Both checks required: IF NOT FOUND + processing_error on captured event_id
    (per adr-rpc-readback-pattern.md, infrastructure/supabase/CLAUDE.md Rule 13).

Notes:
  - Idempotency: pre-emit guard returns success-false if user already deleted,
    avoiding noise events in the audit log.
  - Tenancy guard inside helper closes the JWT/current_organization_id
    inconsistency window during org-switch (latent today since switch_organization
    frontend is unimplemented).
  - Replaces the 'delete' branch of manage-user Edge Function (lines 456-468);
    Edge Function delete branch removed in same PR.

References:
  - adr-edge-function-vs-sql-rpc.md - Rollout 2026-04-27 (this PR).
  - adr-rpc-readback-pattern.md - Pattern A v2 contract.
  - handle_user_deleted.sql - target handler.
  - public.get_user_target_path - canonical user-targeted path resolution.
$$;
