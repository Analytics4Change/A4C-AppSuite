-- ============================================================================
-- PR A commit 3 — retire api.resend_invitation
-- ============================================================================
--
-- The RPC is a **guaranteed no-op that reports success**.
--
--   * it selects `WHERE id = p_invitation_id`
--   * it emits `event_data.invitation_id := p_invitation_id`
--   * `handle_invitation_resent` matches `WHERE invitation_id = <that value>`
--
-- Those are two DIFFERENT columns. Measured on dev at retirement time:
-- **0 of 20 rows have `id = invitation_id`**, so the handler's UPDATE matches
-- zero rows on every invocation. The projection never changes and the caller is
-- told `true`.
--
-- PR #110 "hardened" this function three days ago with a Pattern A v2 read-back
-- and did not catch it, because **a 0-row UPDATE raises nothing** — so
-- `processing_error` is null and the read-back reports success. Worth carrying
-- forward as a rule: *a `processing_error` check proves the handler did not
-- throw, not that it did anything.* Canonical Pattern A v2 has two halves — the
-- read-back AND an `IF NOT FOUND` projection check. This RPC only ever had one.
--
-- ----------------------------------------------------------------------------
-- Why DROP rather than fix the key
-- ----------------------------------------------------------------------------
--
-- Its signature has the CALLER mint `p_new_token` and `p_new_expires_at`. That
-- belongs to the pre-Edge-Function design; `invite-user` owns token generation
-- now, and as of `20260731201018` the token is write-once — so a caller-supplied
-- token is not merely redundant, it contradicts the current model. Fixing the
-- id/invitation_id key would produce *working* dead code built on a superseded
-- contract, and a second, divergent resend policy for someone to find later.
--
-- Verified unused before dropping: no caller in `frontend/`, `workflows/`, or any
-- Edge Function. It was reachable only via `service_role`.
--
-- Consequences handled in this commit (all four generated artifacts):
--   * `frontend/src/services/api/rpc-registry.generated.ts` — regenerated
--   * `frontend/src/types/database.types.ts`                 — regenerated
--   * `workflows/src/types/database.types.ts`                — regenerated (must
--     stay byte-identical to the frontend copy)
--   * the RPC reachability matrix doc                        — regenerated
-- ============================================================================

SET search_path = public, extensions, pg_temp;

DROP FUNCTION IF EXISTS api.resend_invitation(uuid, text, timestamptz);

-- ----------------------------------------------------------------------------
-- Assertion — the function is actually gone
-- ----------------------------------------------------------------------------
--
-- Observes catalog state rather than re-reading the DDL text above, and is
-- re-runnable: DROP IF EXISTS plus a catalog check is idempotent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'api'
       AND p.proname = 'resend_invitation'
  ) THEN
    RAISE EXCEPTION 'api.resend_invitation still exists after the DROP — check for an overload with a different signature'
      USING ERRCODE = 'P9099';
  END IF;
END $$;
