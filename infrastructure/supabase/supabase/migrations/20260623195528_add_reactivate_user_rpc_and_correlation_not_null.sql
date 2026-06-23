-- =============================================================================
-- api.reactivate_user (Pattern A v2) + correlation_id constraint-hardening.
-- =============================================================================
--
-- Card: dev/active/invite-user-route-existing-users-to-role-assign/ (epic PR 2);
-- closes parked dev/archived/manage-user-reactivate-pattern-a-v2-retrofit/.
-- Architect-reviewed (software-architect-dbc, 2026-06-23, epic plan + PR #83
-- Finding 4 deferral).
--
-- (A) Adds api.reactivate_user — a verbatim mirror of the deployed
-- api.deactivate_user (post-PR1, incl. the correlation chain), with the
-- idempotency guards inverted (already-ACTIVE / deleted -> success-false
-- envelope), event_type user.reactivated, and the read-back predicate
-- is_active = true. handle_user_reactivated + router arm + AsyncAPI already
-- exist. The manage-user Edge Function reactivate path is retrofitted (separate
-- commit) to call this RPC then auth-unban (ban_duration:'none', LB1).
--
-- (B) PR #83 Finding 4: harden users.correlation_id from convention to
-- constraint. DEFAULT gen_random_uuid() makes any insert non-NULL by
-- construction (safe even for an un-anchored path); SET NOT NULL enforces the
-- "never NULL / one chain per user" invariant. Safe now: both insert handlers
-- (handle_user_created, handle_user_synced_from_auth) anchor it, backfill filled
-- the rest, and 0 NULLs remain. The DEFAULT is a non-chaining safety net only —
-- correct chaining still comes from the anchor handlers writing the event's id.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Section A — api.reactivate_user (Pattern A v2 mirror of api.deactivate_user).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.reactivate_user(p_user_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_claims jsonb := current_setting('request.jwt.claims', true)::jsonb;
    v_caller_id uuid := public.get_current_user_id();
    v_org_id uuid := NULLIF(v_claims ->> 'org_id', '')::uuid;
    v_access_blocked boolean := COALESCE((v_claims ->> 'access_blocked')::boolean, false);
    v_target_org_id uuid;
    v_existing_is_active boolean;
    v_existing_deleted_at timestamptz;
    v_corr uuid;  -- correlation
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

    -- Permission: unscoped user.update (mirrors api.deactivate_user — the
    -- reactivate operation is the inverse and shares its permission per the
    -- deployed Edge Function check).
    IF NOT public.has_permission('user.update') THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;

    -- =====================================================================
    -- TENANCY + IDEMPOTENCY (envelope, not RAISE)
    -- =====================================================================

    SELECT current_organization_id, is_active, deleted_at, correlation_id  -- correlation
    INTO v_target_org_id, v_existing_is_active, v_existing_deleted_at, v_corr
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

    -- Idempotency: already-active target returns success-false envelope.
    IF v_existing_is_active = true THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'User is already active'
        );
    END IF;

    -- Idempotency: deleted target can't be reactivated.
    IF v_existing_deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'User is deleted'
        );
    END IF;

    -- correlation: chain this op's events to the user's lifecycle id.
    IF v_corr IS NOT NULL THEN
        PERFORM set_config('app.correlation_id', v_corr::text, true);
    END IF;

    -- =====================================================================
    -- EMIT user.reactivated EVENT
    -- =====================================================================

    v_event_id := api.emit_domain_event(
        p_stream_id := p_user_id,
        p_stream_type := 'user',
        p_event_type := 'user.reactivated',
        p_event_data := jsonb_build_object(
            'user_id', p_user_id,
            'org_id', v_org_id,
            'reactivated_at', v_now,
            'reason', p_reason
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', v_caller_id,
            'organization_id', v_org_id,
            'source', 'api.reactivate_user',
            'reason', COALESCE(p_reason, 'Manual reactivate')
        )
    );

    -- =====================================================================
    -- PATTERN A v2 READ-BACK (BOTH checks per Rule 13)
    -- =====================================================================

    -- Check 1: IF NOT FOUND on the projection read-back (predicate
    -- requires is_active = true, so absence means handler didn't update)
    PERFORM 1
    FROM public.users
    WHERE id = p_user_id AND is_active = true;

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
$function$;

GRANT EXECUTE ON FUNCTION api.reactivate_user(uuid, text) TO authenticated;

COMMENT ON FUNCTION api.reactivate_user(uuid, text) IS
$comment$Reactivates a deactivated user by emitting user.reactivated; handle_user_reactivated sets users.is_active = true. Inverse of api.deactivate_user. Does NOT modify auth.users; the Edge Function calls auth.admin.updateUserById({ban_duration:'none'}) to clear the ban after this RPC succeeds.

@a4c-rpc-shape: envelope

@a4c-bucket: E
@a4c-consultant-callable: yes
@a4c-consultant-callable-reason: No tenancy context; grant-irrelevant by default. Mirror of api.deactivate_user.
@a4c-phase-target: none$comment$;


-- -----------------------------------------------------------------------------
-- Section B — constraint-hardening (PR #83 Finding 4). Pre: 0 NULL correlation_id
-- (both insert handlers anchor it; backfill filled the rest). DEFAULT makes any
-- future insert non-NULL by construction; SET NOT NULL enforces the invariant.
-- -----------------------------------------------------------------------------
ALTER TABLE public.users ALTER COLUMN correlation_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.users ALTER COLUMN correlation_id SET NOT NULL;
