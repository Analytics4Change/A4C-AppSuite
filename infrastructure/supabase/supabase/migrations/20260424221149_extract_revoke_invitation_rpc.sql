-- Migration: extract `invite-user revoke` op from Edge Function into api.revoke_invitation
--
-- Part of the Edge Function → SQL RPC extraction backlog seeded by PR #33
-- (adr-edge-function-vs-sql-rpc.md). Inventory row #7 moves `candidate` →
-- `extracted`. `invite-user` Edge Function `DEPLOY_VERSION` bumps to
-- `v17-revoke-extracted` in the same PR (Edge Function `revoke` case deleted).
--
-- Why a DROP + CREATE (not CREATE OR REPLACE): the return type changes from
-- boolean → jsonb. PostgreSQL rejects CREATE OR REPLACE when the return type
-- changes, so the old signature is dropped and the new one is created. The
-- only existing caller was the Edge Function (`supabaseAdmin.rpc('revoke_invitation', ...)`)
-- which is removed in the same PR — no external breakage.
--
-- Changes vs prior `api.revoke_invitation` (baseline_v4:5337-5371):
--   1. Return type: boolean → jsonb envelope {success, error?} (D5).
--   2. Added `public.has_permission('user.create')` gate (D2) —
--      absorbs Edge Function's permission check, preserves current semantics.
--   3. Added `access_blocked` JWT-claim guard (D3) —
--      absorbs Edge Function's access-block guard (parity with invite-user/index.ts:481-487).
--   4. Caller identity via `public.get_current_user_id()` (PR #36 precedent)
--      instead of `auth.uid()` — preserves testing override.
--   5. Post-emit `processing_error` check on captured event_id (handler-failure
--      surfacing) — matches adr-rpc-readback-pattern.md guidance for the
--      outcome-only (no projection entity in response) variant.
--   6. GRANT EXECUTE to `authenticated` (new caller); the prior
--      `GRANT ALL TO service_role` is intentionally not re-granted (the service-role
--      caller — the Edge Function `revoke` case — is deleted in this PR).
--   7. Reuse `invitations_projection.correlation_id` on the emit (lookup-and-reuse
--      pattern per `infrastructure/CLAUDE.md` § Correlation ID Pattern; precedent:
--      `accept-invitation/index.ts:180-188`). Schema-level commitment at
--      baseline_v4:12954 names `revoke` as a reuse site explicitly.
--
-- Baseline-overload audit (Rule 15): confirmed single signature, no overloads.
--   grep -n 'FUNCTION "api"\."revoke_invitation"' 20260212010625_baseline_v4.sql
--   → one match (line 5337).

DROP FUNCTION IF EXISTS api.revoke_invitation(uuid, text);

CREATE FUNCTION api.revoke_invitation(
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
    v_exists boolean;
    v_correlation_id uuid;
    v_event_id uuid;
    v_processing_error text;
BEGIN
    -- Caller auth + tenant context required (parity with Edge Function's JWT
    -- decode + org_id presence check).
    IF v_caller_id IS NULL OR v_org_id IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;

    -- Access-blocked guard (parity with invite-user/index.ts:481-487).
    -- Pre-emit, so RAISE is appropriate (no audit row to preserve).
    IF v_access_blocked THEN
        RAISE EXCEPTION 'Access blocked: organization is deactivated' USING ERRCODE = '42501';
    END IF;

    -- Permission port: `user.create` matches Edge Function gate exactly
    -- (invite-user/index.ts:501-508). Unscoped presence check.
    IF NOT public.has_permission('user.create') THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;

    -- Existence + status guard (preserved from prior RPC body).
    SELECT EXISTS(
        SELECT 1 FROM invitations_projection
        WHERE id = p_invitation_id AND status = 'pending'
    ) INTO v_exists;

    IF NOT v_exists THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invitation not found or not revocable'
        );
    END IF;

    -- Lookup-and-reuse pattern (infrastructure/CLAUDE.md § Correlation ID Pattern;
    -- accept-invitation/index.ts:180-188 precedent). Schema commits to reuse at
    -- baseline_v4:12954 ("reused for resend/revoke/accept/expire events").
    SELECT correlation_id INTO v_correlation_id
      FROM invitations_projection WHERE id = p_invitation_id;

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
    -- No projection read-back needed — response envelope is outcome-only,
    -- no entity payload (see plan R1).
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

GRANT EXECUTE ON FUNCTION
    api.revoke_invitation(uuid, text)
    TO authenticated;

COMMENT ON FUNCTION api.revoke_invitation(uuid, text) IS
$$Revokes a pending invitation for the caller's JWT org context.

Preconditions:
  - JWT must supply `sub` (caller id) and `org_id` claim.
  - `access_blocked` claim must be absent or false.
  - Caller must hold `user.create` via public.has_permission() on the
    `effective_permissions` JWT claim (unscoped presence check).
  - p_invitation_id must reference an invitation with status = 'pending'.

Postconditions:
  - On success: exactly one `invitation.revoked` event is appended to
    `domain_events` with stream_id = p_invitation_id, stream_type = 'invitation',
    carrying {invitation_id, reason} in event_data and
    {user_id, organization_id, source, reason} in event_metadata.
  - On success: `invitations_projection.status` for p_invitation_id reflects
    'revoked' (handler `handle_invitation_revoked` UPDATE).
  - On handler failure: `domain_events` row is preserved with populated
    `processing_error` (audit trail intact); return envelope has
    `success: false, error: 'Event processing failed: ...'`.
  - Never `RAISE EXCEPTION` post-emit (would roll back the audit row — see
    adr-rpc-readback-pattern.md Decision 2).

Invariants:
  - `org_id` is ALWAYS sourced from the JWT; NEVER accepted as input. Breaking
    this invariant is a multi-tenancy bypass.
  - Pre-emit failures (auth, access_blocked, permission) use `RAISE EXCEPTION`
    with ERRCODE 42501 — PostgREST maps to HTTP 403.
  - Business-logic failures (not-pending, handler-error) use success:false
    envelope — preserves audit trail per adr-rpc-readback-pattern.md.
  - Response shape stable: `{success, eventId, invitationId}` on success;
    `{success: false, error}` on failure. Keys are contract.

Error envelope:
  42501 (RAISE) — caller auth missing, access_blocked, or permission denied (pre-emit).
  success:false envelope — invitation not pending OR handler-driven failure.

Notes:
  - Metadata parity trade-off vs. Edge Function: RPC cannot populate
    `ip_address`, `user_agent`, `request_id` in event_metadata (request
    headers not accessible in PL/pgSQL). Audit queries on this event type
    will see nulls for those fields post-cutover. Compliant with
    infrastructure/CLAUDE.md which scopes those fields to Edge Functions.
  - Improvement over prior Edge-service-role path: `event_metadata->>'user_id'`
    is now populated (was null under service-role), closing a latent audit gap.
  - Correlation reuse: `event_metadata->>'correlation_id'` is now sourced from
    `invitations_projection.correlation_id` (lookup-and-reuse pattern),
    closing a second latent audit gap. Lifecycle queries
    (`SELECT … FROM domain_events WHERE correlation_id = ?`) will now include
    `invitation.revoked` events alongside `user.invited`, `invitation.resent`,
    `invitation.accepted`. Schema commits to this at baseline_v4:12954.
  - Concurrent revoke calls may produce duplicate `invitation.revoked`
    events (classic TOCTOU between the EXISTS check and the emit). The
    handler `handle_invitation_revoked` (baseline_v4:11124-11131) issues
    an unconditional UPDATE, so duplicates are projection-idempotent
    (status flips to 'revoked' once; subsequent UPDATEs are no-ops aside
    from `updated_at`). Both events are intentionally preserved in
    `domain_events` for forensic visibility into the race.

Reference: adr-edge-function-vs-sql-rpc.md (LB0 extraction, inventory row #7);
           adr-rpc-readback-pattern.md (outcome-only variant rationale).
$$;
