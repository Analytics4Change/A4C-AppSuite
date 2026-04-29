-- =============================================================================
-- Migration: update_delete_user_comment_with_toctou_and_access_blocked_provenance
--
-- Purpose:
--   Per architect review of PR #40, augment the COMMENT on api.delete_user
--   to document two contract details that were missing from the original
--   migration (20260427220143_unscope_delete_user.sql):
--
--   1. Concurrent-delete TOCTOU window — the idempotency check at
--      `SELECT deleted_at FROM users WHERE id = p_user_id` happens before
--      `api.emit_domain_event`, so two concurrent calls can both pass the
--      idempotency guard and emit duplicate `user.deleted` events.
--      handle_user_deleted's COALESCE(deleted_at, event_data, created_at)
--      makes the second event benign (first tombstone wins) but the audit
--      log still shows two events. Mirrors the analogous note in
--      api.revoke_invitation's COMMENT (migration 20260427220331 lines
--      173-174).
--
--   2. `access_blocked` provenance — the COMMENT references the JWT
--      `access_blocked` claim without explaining where it comes from.
--      Document that the claim is set by `public.custom_access_token_hook`
--      (baseline_v4:7008-7202) at JWT-mint time, based on
--      organizations_projection.is_active and access_start_date /
--      access_expiration_date checks. The claim cannot be forged client-
--      side because the JWT is signed by Supabase Auth.
--
-- Function body unchanged. This migration only updates the documentation
-- attached via COMMENT ON FUNCTION.
-- =============================================================================

COMMENT ON FUNCTION api.delete_user(uuid, text) IS
$$Soft-deletes a user by emitting user.deleted; handle_user_deleted updates
users.deleted_at + is_active.

Preconditions:
  - JWT must supply `sub` and `org_id`.
  - `access_blocked` claim must be absent or false (see Notes for provenance).
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

Notes:
  - access_blocked provenance: the JWT `access_blocked` claim is set by
    public.custom_access_token_hook (baseline_v4:7008-7202) at JWT-mint
    time, based on organizations_projection.is_active and per-user
    user_organizations_projection access_start_date / access_expiration_date
    checks. The claim is signed by Supabase Auth and cannot be forged
    client-side; this RPC trusts it as authoritative.

  - Concurrent-delete TOCTOU: the idempotency check
    (SELECT deleted_at FROM users WHERE id = p_user_id) and the
    api.emit_domain_event call are not atomic; two concurrent callers
    can both observe deleted_at IS NULL and emit duplicate user.deleted
    events. handle_user_deleted uses COALESCE(deleted_at,
    event_data->>'deleted_at', created_at) so the first tombstone wins;
    the second event lands as a benign no-op in projection terms, but
    the audit log will show two user.deleted events for the same
    stream_id. Acceptable per existing precedent
    (api.revoke_invitation has the analogous documented behavior).

References:
  - adr-edge-function-vs-sql-rpc.md - Rollout 2026-04-27 (this PR + course correction).
  - adr-rpc-readback-pattern.md - Pattern A v2 contract.
  - handle_user_deleted.sql - target handler.
  - dev/active/sub-tenant-admin-design/ - deferred capability that would
    re-introduce scoped checks for user-targeted ops once user-model gains
    OU-bounded identity.
$$;
