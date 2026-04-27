-- =============================================================================
-- Migration: scope_revoke_invitation
-- Purpose:   Retrofit api.revoke_invitation to use the canonical scoped-permission
--            pattern (has_effective_permission + tenancy guard) closing both the
--            cross-OU privilege escalation gap AND a latent cross-tenant UUID-leak.
--
-- Context:
--   Per architect review (2026-04-27), PR #39's unscoped public.has_permission
--   permits intra-tenant cross-OU privilege escalation. Additionally, the
--   pre-retrofit existence check (`WHERE id = p_invitation_id AND status =
--   'pending'`) had no tenancy filter — an admin in tenant A who knew an
--   invitation UUID belonging to tenant B could revoke it. This retrofit
--   closes both gaps.
--
-- Behavioral delta (vs PR #39, migration 20260424221149):
--   - Tenancy guard added: invitation's organization_id must match caller's JWT
--     org_id; mismatch returns the same not-found envelope (no UUID leak).
--   - Permission check changed from public.has_permission('user.create')
--     [unscoped] to public.has_effective_permission('user.create', org_root_path)
--     where org_root_path is the invitation's organization path from
--     organizations_projection.
--   - All other behavior identical (access_blocked guard, correlation reuse,
--     emit shape, processing_error check, response envelope).
--
-- Scope choice:
--   - invitations_projection has only organization_id (no OU column at this
--     baseline); the invitation's natural scope is the organization root path.
--   - When invitation OU denormalization arrives in a future migration, lift
--     this lookup into a get_invitation_target_path helper.
--
-- Pre-deploy regression check (2026-04-27):
--   - invitation.revoked: 0 events in last 30 days. No behavioral changes for
--     existing flows.
--
-- Baseline-overload audit (Rule 15):
--   - api.revoke_invitation(uuid, text) — single signature, CREATE OR REPLACE
--     is safe. Baseline (pre-PR #39) had no api.revoke_invitation; PR #39 added
--     this single signature.
-- =============================================================================

CREATE OR REPLACE FUNCTION api.revoke_invitation(
    p_invitation_id uuid,
    p_reason text DEFAULT 'manual_revocation'
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
    v_invitation_org_id uuid;
    v_correlation_id uuid;
    v_target_path extensions.ltree;
    v_event_id uuid;
    v_processing_error text;
BEGIN
    -- Caller auth + tenant context required.
    IF v_caller_id IS NULL OR v_org_id IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;

    -- Access-blocked guard (parity with invite-user/index.ts:481-487).
    IF v_access_blocked THEN
        RAISE EXCEPTION 'Access blocked: organization is deactivated'
            USING ERRCODE = '42501';
    END IF;

    -- Existence + status + correlation lookup in one read.
    -- Tenancy filter is intentionally NOT inlined here: we want to distinguish
    -- "not found" from "wrong tenant" internally for logging, but return the
    -- same envelope for both to avoid UUID-existence leaks across tenants.
    SELECT organization_id, correlation_id
    INTO v_invitation_org_id, v_correlation_id
    FROM public.invitations_projection
    WHERE id = p_invitation_id AND status = 'pending';

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invitation not found or not revocable'
        );
    END IF;

    -- Tenancy guard: invitation must belong to caller's tenant.
    -- Same envelope as not-found to avoid UUID leak across tenants.
    IF v_invitation_org_id IS DISTINCT FROM v_org_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invitation not found or not revocable'
        );
    END IF;

    -- Resolve target path = invitation's organization root path.
    -- (Invitation has no OU denormalization at this baseline; org root is the
    -- correct natural scope.)
    SELECT op.path INTO v_target_path
    FROM public.organizations_projection op
    WHERE op.id = v_org_id;

    IF v_target_path IS NULL THEN
        RAISE EXCEPTION 'Organization has no path (data integrity)'
            USING ERRCODE = 'raise_exception';
    END IF;

    -- Scoped permission check (canonical pattern post-2026-04-27).
    IF NOT public.has_effective_permission('user.create', v_target_path) THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;

    -- Emit domain event; handler (process_invitation_event → handle_invitation_revoked)
    -- flips invitations_projection.status to 'revoked' synchronously in-trigger.
    v_event_id := api.emit_domain_event(
        p_stream_id := p_invitation_id,
        p_stream_type := 'invitation',
        p_event_type := 'invitation.revoked',
        p_event_data := jsonb_build_object(
            'invitation_id', p_invitation_id,
            'reason', p_reason
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', v_caller_id,
            'organization_id', v_org_id,
            'source', 'api.revoke_invitation',
            'reason', p_reason,
            'correlation_id', v_correlation_id
        )
    );

    -- Handler-failure surfacing: captured-event_id processing_error check.
    -- No projection read-back needed — response envelope is outcome-only.
    SELECT processing_error INTO v_processing_error
    FROM public.domain_events WHERE id = v_event_id;

    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || v_processing_error
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'eventId', v_event_id,
        'invitationId', p_invitation_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION api.revoke_invitation(uuid, text) TO authenticated;

COMMENT ON FUNCTION api.revoke_invitation(uuid, text) IS
$$Revokes a pending invitation for the caller's JWT org context.

Preconditions:
  - JWT must supply `sub` and `org_id`.
  - `access_blocked` claim must be absent or false.
  - p_invitation_id must reference an invitation with status = 'pending' AND
    organization_id = caller's JWT org_id (cross-tenant invitations are not
    visible — same envelope as not-found, no UUID-existence leak).
  - Caller must hold `user.create` scoped to the invitation's organization
    root path (organizations_projection.path), via
    public.has_effective_permission.

Postconditions:
  - On success: one `invitation.revoked` event in domain_events with
    {invitation_id, reason} in event_data.
  - On success: invitations_projection.status for p_invitation_id is 'revoked'.
  - On handler failure: domain_events row preserved with processing_error.
  - Never RAISE EXCEPTION post-emit.

Invariants:
  - org_id ALWAYS from JWT; NEVER accepted as input.
  - Pre-emit failures use RAISE EXCEPTION with ERRCODE 42501.
  - Business-logic failures use success:false envelope.
  - Cross-tenant lookup attempts return the same envelope as not-found
    (no leakage of invitation UUID existence).

Error envelope:
  42501 (RAISE)   - caller auth missing, access_blocked, or scoped permission denied.
  raise_exception (RAISE) - org has no path; data integrity.
  success:false envelope - invitation not pending OR cross-tenant lookup OR
                           handler-driven failure.

Notes:
  - Metadata parity trade-off: RPC cannot populate ip_address, user_agent,
    request_id (not available in JWT/RPC context).
  - Improvement: event_metadata->>'user_id' populated correctly (was null under
    service-role pre-PR #39).
  - Correlation reuse: event_metadata->>'correlation_id' sourced from
    invitations_projection.correlation_id (lookup-and-reuse per
    infrastructure/CLAUDE.md § Correlation ID Pattern).
  - Concurrent revoke calls may produce duplicate invitation.revoked events
    (TOCTOU between status check and emit); handler UPDATE is idempotent.
  - Scoped-permission retrofit (2026-04-27): replaces unscoped has_permission,
    adds tenancy guard.

References:
  - adr-edge-function-vs-sql-rpc.md - Rollout 2026-04-27 (this PR).
  - adr-rpc-readback-pattern.md - outcome-only variant (no projection read-back).
$$;
