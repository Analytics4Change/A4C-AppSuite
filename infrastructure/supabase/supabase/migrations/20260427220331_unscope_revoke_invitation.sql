-- =============================================================================
-- Migration: unscope_revoke_invitation
-- (revert R3 of architectural course correction)
--
-- Purpose:
--   Revert the scoped-permission retrofit applied in
--   20260427205549_scope_revoke_invitation.sql. Restore the PR #39
--   permission style: unscoped public.has_permission('user.create').
--
-- Rationale:
--   See adr-edge-function-vs-sql-rpc.md Rollout 2026-04-27 § course
--   correction. Briefly: invitations target a user identity within a
--   tenant; the resource doesn't have OU-level location finer than tenant,
--   so target_path = org root for all callers and the scoped check is
--   vacuous. Reverting to PR #39 precedent.
--
-- KEEPS the legitimate independent fix from M4:
--   - Tenancy guard: lookup invitation, return same envelope as not-found
--     if invitation.organization_id != caller's JWT org_id. Closes a
--     real cross-tenant UUID-existence leak that existed pre-M4.
--
-- KEEPS all other M4 behavior (which matches PR #39):
--   - access_blocked JWT-claim guard
--   - correlation_id reuse from invitations_projection
--   - existence + status check
--   - emit shape, processing_error check, response envelope
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

    -- Permission: unscoped user.create (PR #39 precedent restored).
    -- See adr-edge-function-vs-sql-rpc.md Rollout 2026-04-27 course
    -- correction for why scoped checks are not warranted here.
    IF NOT public.has_permission('user.create') THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;

    -- Existence + status + correlation lookup in one read.
    -- Tenancy filter is intentionally NOT inlined in WHERE: we want the
    -- post-fetch tenancy check to return the SAME envelope as not-found
    -- regardless of whether the row exists in another tenant (avoids
    -- UUID-existence leakage across tenants).
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

    -- Tenancy guard (KEPT from M4): cross-tenant lookup attempts return
    -- same envelope as not-found. Independent of scoped-permission concern.
    IF v_invitation_org_id IS DISTINCT FROM v_org_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invitation not found or not revocable'
        );
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
  - Caller must hold `user.create` (unscoped, presence-only via
    public.has_permission).
  - p_invitation_id must reference invitation with status = 'pending' AND
    invitation.organization_id = caller's JWT org_id (cross-tenant
    invitations are not visible — same envelope as not-found, no
    UUID-existence leak).

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
  42501 (RAISE)            - caller auth missing, access_blocked, or permission denied.
  success:false envelope   - invitation not pending OR cross-tenant lookup OR
                             handler-driven failure.

Notes:
  - Permission style: unscoped per PR #39 precedent (architecturally restored
    after the 2026-04-27 scoped-retrofit attempt was reverted; see
    adr-edge-function-vs-sql-rpc.md Rollout course correction).
  - Cross-tenant UUID-leak fix from M4 is preserved (legitimate
    independent improvement).
  - Correlation reuse: event_metadata->>'correlation_id' sourced from
    invitations_projection.correlation_id (lookup-and-reuse per
    infrastructure/CLAUDE.md § Correlation ID Pattern).
  - Concurrent revoke calls may produce duplicate invitation.revoked events
    (TOCTOU between status check and emit); handler UPDATE is idempotent.

References:
  - adr-edge-function-vs-sql-rpc.md - Rollout 2026-04-27 (course correction).
  - adr-rpc-readback-pattern.md - outcome-only variant (no projection read-back).
$$;
