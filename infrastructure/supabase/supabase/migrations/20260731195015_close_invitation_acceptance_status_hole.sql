-- ============================================================================
-- PR A commit 1 — close the invitation-acceptance status hole (SECURITY)
-- ============================================================================
--
-- **Revocation does not revoke.** A holder of a revoked invitation's token can
-- still accept it and get a working account. Four links in the chain, none of
-- which consults `status`:
--
--   1. `api.get_invitation_by_token` — `WHERE i.token = p_token`. `status` is in
--      the RETURNS TABLE but never in the WHERE.
--   2. `validate-invitation/index.ts` — `valid: !expired && !alreadyAccepted`.
--      The string `invitation.status` does not appear in that file.
--   3. `accept-invitation/index.ts` — checks `expires_at` and `accepted_at`,
--      then calls `auth.admin.createUser`. Service-role client, so RLS is not a
--      backstop either.
--   4. The revoke write itself: there is NO `handle_invitation_revoked`. Revoke
--      is inline in the router (`process_invitation_event`, the
--      `WHEN 'invitation.revoked'` arm) and writes `status` + `updated_at` only.
--      **The token survives. `expires_at` survives.**
--
-- Verified on dev at the time of writing: 3 rows satisfied
--   status='revoked' AND token IS NOT NULL AND expires_at > now() AND accepted_at IS NULL
--
-- `expired` is safe today only by COINCIDENCE — `emitExpirationEvent` fires
-- solely when `expires_at < now`, so the clock guard happens to cover it. That
-- is not an invariant and must not be leaned on.
--
-- ----------------------------------------------------------------------------
-- The fix, and why it is at THIS tier
-- ----------------------------------------------------------------------------
--
-- `api.get_invitation_by_token` is the sole token→invitation resolver on every
-- acceptance-authoritative path. Filtering there makes a non-pending invitation
-- structurally unresolvable, so every present AND future consumer fails closed
-- by construction. That is the structural answer to the codified pitfall
-- "a safety argument holds for the writers you enumerated, not for the
-- constraint" — here applied to readers rather than writers.
--
-- The Edge Functions additionally get their own `status` guard (same commit,
-- separate file) as belt-and-braces: the guard must not depend on a filter
-- inside a function someone may later relax for an unrelated reason.
--
-- ----------------------------------------------------------------------------
-- What this migration deliberately does NOT do
-- ----------------------------------------------------------------------------
--
-- **It does not check clock expiry.** `status='pending'` with `expires_at < now()`
-- is a real and common state — expiration is LAZY (nothing sweeps it; the row
-- flips only when `invite-user` notices). The `expires_at` guards in both Edge
-- Functions therefore MUST stay. Removing them because "the RPC filters now"
-- would reopen acceptance of clock-expired invitations.
--
-- **It does not null the token on revoke.** `invitations_projection.token` is
-- NOT NULL, and more importantly a null token makes a revoked invitation
-- indistinguishable from a bogus one — destroying the honest message the rest of
-- PR A exists to produce. Keeping the token is not a vulnerability once no path
-- accepts it.
--
-- After this migration a revoked/accepted link still reports the unhelpful
-- "Invitation not found". That is the pre-existing copy defect and is fixed
-- later in PR A. **This commit is the security fix and is revertible alone.**
--
-- Deployed bodies were fetched via Mgmt-API `pg_get_functiondef` and diffed
-- before writing (codified pitfall). Note the deployed body is NOT baseline_v4's
-- — `20260508170054_drop_invitations_deprecated_role_column.sql` dropped the
-- `role` column and COALESCEd `roles`. Copying from baseline would have
-- resurrected a dropped column.
-- ============================================================================

SET search_path = public, extensions, pg_temp;

-- ----------------------------------------------------------------------------
-- 1. api.get_invitation_by_token — resolve ONLY pending invitations
-- ----------------------------------------------------------------------------
--
-- Body copied verbatim from the deployed definition; exactly one line added:
--   AND i.status = 'pending'
-- Signature is unchanged, so CREATE OR REPLACE preserves the OID and with it the
-- `@a4c-rpc-shape` / `@a4c-bucket` COMMENT tags — no registry or types regen.
-- The COMMENT is re-issued below anyway as cheap insurance.

CREATE OR REPLACE FUNCTION api.get_invitation_by_token(p_token text)
 RETURNS TABLE(id uuid, token text, email text, organization_id uuid, organization_name text, roles jsonb, first_name text, last_name text, status text, expires_at timestamp with time zone, accepted_at timestamp with time zone, correlation_id uuid, contact_id uuid, phones jsonb, notification_preferences jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    i.token,
    i.email,
    i.organization_id,
    o.name AS organization_name,
    COALESCE(i.roles, '[]'::jsonb) AS roles,
    i.first_name,
    i.last_name,
    i.status,
    i.expires_at,
    i.accepted_at,
    i.correlation_id,
    i.contact_id,
    COALESCE(i.phones, '[]'::jsonb) AS phones,
    COALESCE(i.notification_preferences, '{"email": true, "sms": {"enabled": false, "phoneId": null}, "inApp": false}'::jsonb) AS notification_preferences
  FROM public.invitations_projection i
  LEFT JOIN public.organizations_projection o ON o.id = i.organization_id
  -- SECURITY (20260731195015): resolve ONLY pending invitations. Without this a
  -- revoked invitation whose token the recipient still holds remains acceptable
  -- — revocation writes `status` and nothing else, so the token stays live.
  -- Deliberately NOT checking expires_at: expiration is lazy, so `pending` +
  -- past-expiry is a real state that the Edge Functions' clock guards handle.
  WHERE i.token = p_token
    AND i.status = 'pending';
END;
$function$;

COMMENT ON FUNCTION api.get_invitation_by_token(text) IS
$comment$Get invitation details by token for validation. Returns correlation_id for lifecycle tracing, contact_id for contact-user linking, first_name/last_name/roles for user creation, and phones/notification_preferences for Phase 6 invitation flow.

Resolves ONLY status='pending' invitations (20260731195015) — a revoked/accepted/expired invitation is unresolvable through this function, which is what makes every acceptance path fail closed. Does NOT check expires_at; expiration is lazy and the clock guard lives in the Edge Functions.

@a4c-rpc-shape: read

@a4c-bucket: D
@a4c-consultant-callable: pending-phase4-rls
@a4c-consultant-callable-reason: Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4.
@a4c-phase-target: 4$comment$;

-- ----------------------------------------------------------------------------
-- 2. api.get_invitation_token_state — the narrow, enum-only classifier
-- ----------------------------------------------------------------------------
--
-- Exists so the accept page can say WHY a link is unusable without the rich row
-- leaking. Returns one enum value and nothing else: no email, no org name, no
-- roles, no id, no timestamps.
--
-- Enumeration decision, made deliberately rather than assumed: the disclosure
-- surface does not grow. `get_invitation_by_token` is ALREADY granted to `anon`
-- and already returns email/org/roles for any matching token. This function adds
-- no grant and no stored secret — it discloses strictly LESS than what `anon`
-- can already obtain, and only to a caller who already possesses a real 256-bit
-- token. A caller without one gets `unknown` and learns nothing.
--
-- SECURITY DEFINER is mandatory: `anon` has no GRANT on
-- `public.invitations_projection`, and an INVOKER function would raise 42501 →
-- 403 (the codified PR #47/#48 pitfall).
--
-- `unknown` is a CATCH-ALL, not a deny-list. `chk_invitation_status` permits
-- 'deleted' today with no writer, and any status added later must degrade to
-- `unknown` rather than leak or error.

CREATE OR REPLACE FUNCTION api.get_invitation_token_state(p_token text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_status     text;
  v_expires_at timestamptz;
BEGIN
  SELECT i.status, i.expires_at
    INTO v_status, v_expires_at
    FROM public.invitations_projection i
   WHERE i.token = p_token;

  IF NOT FOUND THEN
    RETURN 'unknown';
  END IF;

  IF v_status = 'accepted' THEN
    RETURN 'accepted';
  ELSIF v_status = 'revoked' THEN
    RETURN 'revoked';
  ELSIF v_status = 'expired' THEN
    RETURN 'expired';
  ELSIF v_status = 'pending' THEN
    -- Lazy expiry: a pending row past its expires_at is expired in substance.
    IF v_expires_at < now() THEN
      RETURN 'expired';
    END IF;
    RETURN 'valid';
  END IF;

  -- Catch-all for any status outside the enumerated set.
  RETURN 'unknown';
END;
$function$;

REVOKE ALL ON FUNCTION api.get_invitation_token_state(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_invitation_token_state(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION api.get_invitation_token_state(text) IS
$comment$Classify an invitation token as valid|expired|accepted|revoked|unknown. Returns ONLY the enum — no email, org, roles, id or timestamps — so an unusable invitation discloses strictly less than api.get_invitation_by_token already does for a pending one. Callable by anon: the accept page is pre-auth, and the enum sits behind possession of a 256-bit token.

@a4c-rpc-shape: read

@a4c-bucket: D
@a4c-consultant-callable: pending-phase4-rls
@a4c-consultant-callable-reason: Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4.
@a4c-phase-target: 4$comment$;

-- ----------------------------------------------------------------------------
-- 3. BEHAVIOURAL assertions
-- ----------------------------------------------------------------------------
--
-- These call the functions against PRE-EXISTING rows, so they observe state this
-- migration did not write. Section 3.1 WOULD HAVE FAILED before this migration
-- (three revoked-with-live-token rows existed on dev) — it is a real assertion,
-- not a body-grep of something we just installed.

-- 3.1 NEGATIVE: no non-pending invitation is resolvable through the RPC.
DO $$
DECLARE
  v_leaked integer;
BEGIN
  SELECT count(*) INTO v_leaked
    FROM public.invitations_projection ip
   WHERE ip.status <> 'pending'
     AND EXISTS (SELECT 1 FROM api.get_invitation_by_token(ip.token));

  IF v_leaked > 0 THEN
    RAISE EXCEPTION 'SECURITY: % non-pending invitation(s) still resolvable through api.get_invitation_by_token — the status filter is not effective', v_leaked
      USING ERRCODE = 'P9099';
  END IF;
END $$;

-- 3.2 POSITIVE CONTROL: a pending invitation MUST still resolve. Without this,
-- an over-tight filter (or a body that returns nothing at all) would sail
-- through 3.1 by being vacuously true.
DO $$
DECLARE
  v_pending_total    integer;
  v_pending_resolved integer;
BEGIN
  SELECT count(*) INTO v_pending_total
    FROM public.invitations_projection WHERE status = 'pending';

  IF v_pending_total = 0 THEN
    -- A fresh database (CI's local container) seeds no invitations. Nothing to
    -- control against; skip rather than fail.
    RAISE WARNING 'No pending invitations present — positive control skipped';
    RETURN;
  END IF;

  SELECT count(*) INTO v_pending_resolved
    FROM public.invitations_projection ip
   WHERE ip.status = 'pending'
     AND EXISTS (SELECT 1 FROM api.get_invitation_by_token(ip.token));

  IF v_pending_resolved <> v_pending_total THEN
    RAISE EXCEPTION 'Positive control failed: % of % pending invitations resolve through api.get_invitation_by_token — the filter is too tight', v_pending_resolved, v_pending_total
      USING ERRCODE = 'P9099';
  END IF;
END $$;

-- 3.3 The classifier agrees with the projection, over real rows.
DO $$
DECLARE
  v_row       record;
  v_state     text;
  v_expected  text;
  v_mismatch  integer := 0;
BEGIN
  FOR v_row IN
    SELECT token, status, expires_at FROM public.invitations_projection
  LOOP
    v_state := api.get_invitation_token_state(v_row.token);
    v_expected := CASE
      WHEN v_row.status = 'accepted' THEN 'accepted'
      WHEN v_row.status = 'revoked'  THEN 'revoked'
      WHEN v_row.status = 'expired'  THEN 'expired'
      WHEN v_row.status = 'pending'  THEN CASE WHEN v_row.expires_at < now() THEN 'expired' ELSE 'valid' END
      ELSE 'unknown'
    END;
    IF v_state IS DISTINCT FROM v_expected THEN
      v_mismatch := v_mismatch + 1;
    END IF;
  END LOOP;

  IF v_mismatch > 0 THEN
    RAISE EXCEPTION 'api.get_invitation_token_state disagreed with the projection on % row(s)', v_mismatch
      USING ERRCODE = 'P9099';
  END IF;

  -- A token that does not exist must classify as unknown, never error.
  IF api.get_invitation_token_state('pr-a-definitely-not-a-real-token') <> 'unknown' THEN
    RAISE EXCEPTION 'api.get_invitation_token_state must return unknown for an unmatched token'
      USING ERRCODE = 'P9099';
  END IF;
END $$;

-- 3.4 GRANTS asserted from the catalog, not from the DDL text above.
DO $$
DECLARE
  v_missing text[] := '{}';
  v_role    text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.role_routine_grants
       WHERE routine_schema = 'api'
         AND routine_name = 'get_invitation_token_state'
         AND grantee = v_role
         AND privilege_type = 'EXECUTE'
    ) THEN
      v_missing := array_append(v_missing, v_role);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'api.get_invitation_token_state is missing EXECUTE for: %', v_missing
      USING ERRCODE = 'P9099';
  END IF;
END $$;
