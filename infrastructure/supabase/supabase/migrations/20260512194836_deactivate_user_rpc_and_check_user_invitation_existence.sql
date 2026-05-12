-- =============================================================================
-- Migration: deactivate_user_rpc_and_check_user_invitation_existence
--
-- Purpose:
--   Pivot the manage-user.deactivate Pattern A v2 retrofit from Edge Function
--   tier (PR #60 / PR #61) to SQL tier. Pre-pivot, the Edge Function used
--   `client.from('users')` for the read-back, which fails against the deployed
--   PostgREST (configured to expose only the `api` schema). Two error shapes
--   surfaced on consecutive deploys:
--
--     PR #60: "Could not find the table 'api.users' in the schema cache"
--     PR #61: "The schema must be one of the following: api"
--
--   The architectural fix is to mirror `api.delete_user` (PR #40, post-revert):
--   do the emit + Pattern A v2 read-back in pure SQL inside the RPC body.
--   PostgREST exposes only the RPC entry point; the RPC body has full SQL
--   access to public.users + public.domain_events.
--
--   Same pivot for the accept-invitation existing-user check: pre-pivot it
--   did `client.from('users')` / `.from('user_roles_projection')` directly,
--   silently failing pre-PR-#61 and loudly failing post-PR-#61.
--
-- Two RPCs created:
--
--   1. api.deactivate_user(p_user_id uuid, p_reason text DEFAULT NULL)
--      → envelope shape, mirrors api.delete_user contract.
--
--   2. api.check_user_invitation_existence(p_user_id uuid)
--      → read shape, returns {isExistingUser, isDeleted} for the Sally scenario.
--
-- Permission model: unscoped per A4C user-model rule (users-as-identities have
-- no organizational location finer than tenant; see
-- adr-edge-function-vs-sql-rpc.md Rollout 2026-04-27 § course correction).
-- Tenancy guard via JWT org_id + users.current_organization_id lookup.
--
-- Schema dependencies:
--   - public.users (id, current_organization_id, is_active, deleted_at, updated_at)
--   - public.domain_events (id, processing_error)
--   - public.user_roles_projection (user_id)
--   - public.has_permission(text), public.get_current_user_id()
--   - api.emit_domain_event(...)
--   - public.handle_user_deactivated handler (handlers/user/handle_user_deactivated.sql)
--
-- Baseline-overload audit (Rule 15): neither RPC exists in baseline_v4.
-- Clean creation, no DROP needed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- api.deactivate_user — Pattern A v2 envelope write
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.deactivate_user(
    p_user_id uuid,
    p_reason text DEFAULT NULL
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
    v_existing_is_active boolean;
    v_existing_deleted_at timestamptz;
    v_event_id uuid;
    v_processing_error text;
    v_now timestamptz := now();
BEGIN
    -- =====================================================================
    -- PRE-EMIT GUARDS (RAISE EXCEPTION; no audit row yet)
    -- =====================================================================

    IF v_caller_id IS NULL OR v_org_id IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;

    IF v_access_blocked THEN
        RAISE EXCEPTION 'Access blocked: organization is deactivated'
            USING ERRCODE = '42501';
    END IF;

    -- Permission: unscoped user.update (per PR #36/#39/#40 pattern;
    -- adr-edge-function-vs-sql-rpc.md Rollout 2026-04-27 course correction).
    -- The deactivate operation requires `user.update` per the Edge Function's
    -- pre-pivot permission check.
    --
    -- INTENTIONAL DUPLICATION: this guard is also enforced at the Deno tier
    -- (manage-user/index.ts:218 `hasPermission(effectivePermissions, 'user.update')`).
    -- The SQL guard is AUTHORITATIVE (it cannot be bypassed by a misconfigured
    -- Edge Function). The Deno guard is a belt-and-suspenders early-rejection
    -- that saves a database round-trip on permission failures and produces a
    -- clearer 403 error path. Do NOT strip the Deno check as "duplicate" —
    -- both are load-bearing.
    IF NOT public.has_permission('user.update') THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;

    -- =====================================================================
    -- TENANCY + IDEMPOTENCY (envelope, not RAISE)
    -- =====================================================================

    SELECT current_organization_id, is_active, deleted_at
    INTO v_target_org_id, v_existing_is_active, v_existing_deleted_at
    FROM public.users
    WHERE id = p_user_id;

    -- Tenancy guard: target must be in caller's tenant. Same envelope shape
    -- as not-found to avoid leaking user-existence across tenants.
    IF NOT FOUND OR v_target_org_id IS DISTINCT FROM v_org_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'User not found in this organization'
        );
    END IF;

    -- Idempotency: already-inactive target returns success-false envelope.
    IF v_existing_is_active = false THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'User is already deactivated'
        );
    END IF;

    -- Idempotency: deleted target can't be deactivated.
    IF v_existing_deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'User is deleted'
        );
    END IF;

    -- =====================================================================
    -- EMIT user.deactivated EVENT
    -- =====================================================================

    v_event_id := api.emit_domain_event(
        p_stream_id := p_user_id,
        p_stream_type := 'user',
        p_event_type := 'user.deactivated',
        p_event_data := jsonb_build_object(
            'user_id', p_user_id,
            'org_id', v_org_id,
            'deactivated_at', v_now,
            'reason', p_reason
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', v_caller_id,
            'organization_id', v_org_id,
            'source', 'api.deactivate_user',
            'reason', COALESCE(p_reason, 'Manual deactivate')
        )
    );

    -- =====================================================================
    -- PATTERN A v2 READ-BACK (BOTH checks per Rule 13)
    -- =====================================================================

    -- Check 1: IF NOT FOUND on the projection read-back (predicate
    -- requires is_active = false, so absence means handler didn't update)
    PERFORM 1
    FROM public.users
    WHERE id = p_user_id AND is_active = false;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM public.domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' ||
                COALESCE(v_processing_error, 'projection read-back returned no row'),
            'eventId', v_event_id
        );
    END IF;

    -- Check 2: processing_error on captured event_id (race-safe)
    SELECT processing_error INTO v_processing_error
    FROM public.domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || v_processing_error,
            'eventId', v_event_id
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'eventId', v_event_id,
        'userId', p_user_id
    );
END;
$$;

-- authenticated only: called from manage-user Edge Function which forwards
-- the caller's JWT (RPC needs request.jwt.claims.org_id + auth.uid()).
GRANT EXECUTE ON FUNCTION api.deactivate_user(uuid, text) TO authenticated;

COMMENT ON FUNCTION api.deactivate_user(uuid, text) IS
$$Deactivates a user by emitting user.deactivated; handle_user_deactivated sets
users.is_active = false. Does NOT modify auth.users; the Edge Function still
calls auth.admin.updateUserById to install the ban after this RPC succeeds.

Envelope contract (Pattern A v2):
  success=true  → {success: true, eventId: <uuid>, userId: <uuid>}
  success=false → {success: false, error: <text>, eventId?: <uuid>}

The eventId field is INCLUDED on success-false envelopes returned by the two
read-back-miss paths (projection IF NOT FOUND, processing_error captured).
The Edge Function surfaces env.eventId on failure for audit-log deep-linking
into the admin /admin/events view. Do NOT normalize this away to match
api.delete_user's success-false shape — the eventId on failure is a load-bearing
field, not vestigial. (Tenancy + idempotency success-false envelopes pre-emit
do NOT carry eventId; no event was written.)

Pivoted from Edge Function tier (PR #60 / PR #61) after the deployed PostgREST's
api-only schema exposure made wire-tier .from('public.users') queries fail.

@a4c-rpc-shape: envelope$$;

-- -----------------------------------------------------------------------------
-- api.check_user_invitation_existence — read-shape existing-user check
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.check_user_invitation_existence(
    p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_deleted_at timestamptz;
    v_has_roles boolean;
BEGIN
    SELECT deleted_at INTO v_deleted_at
    FROM public.users WHERE id = p_user_id;

    -- User doesn't exist in projection → brand-new user (full onboarding)
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'isExistingUser', false,
            'isDeleted', false
        );
    END IF;

    -- Soft-deleted user → treat as NEW (re-invitation flow; orphan role rows
    -- should not short-circuit onboarding for a tombstoned user).
    IF v_deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'isExistingUser', false,
            'isDeleted', true
        );
    END IF;

    -- Active user — check for any role assignments (Sally scenario detector)
    SELECT EXISTS(
        SELECT 1 FROM public.user_roles_projection
        WHERE user_id = p_user_id
    ) INTO v_has_roles;

    RETURN jsonb_build_object(
        'isExistingUser', v_has_roles,
        'isDeleted', false
    );
END;
$$;

-- authenticated: callable from any user-facing flow that may need the check.
-- service_role: REQUIRED — accept-invitation Edge Function runs unauthenticated
-- and uses an admin client (service_role JWT) to invoke this RPC for the
-- Sally-scenario detection during OAuth/SSO accept.
GRANT EXECUTE ON FUNCTION api.check_user_invitation_existence(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api.check_user_invitation_existence(uuid) TO service_role;

COMMENT ON FUNCTION api.check_user_invitation_existence(uuid) IS
$$Check whether a user is "existing" (has >=1 role in any org) versus new for
the OAuth/SSO invitation accept flow (Sally scenario detector). Soft-deleted
users are treated as NEW so re-invitation runs the full onboarding.

Response shape (read-shape, no envelope):
  {
    "isExistingUser": boolean,  // true if user has >=1 role and is not deleted
    "isDeleted": boolean         // true if users.deleted_at IS NOT NULL
  }

Pivoted from inline .from() reads in accept-invitation Edge Function (PR #60 /
PR #61) after the deployed PostgREST's api-only schema exposure made wire-tier
.from('public.users') queries fail.

@a4c-rpc-shape: read$$;
