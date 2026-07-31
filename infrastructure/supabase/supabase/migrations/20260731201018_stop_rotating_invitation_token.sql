-- ============================================================================
-- PR A commit 2 — the invitation token becomes WRITE-ONCE
-- ============================================================================
--
-- `handle_invitation_resent` overwrote `invitations_projection.token` on every
-- resend. One column, no history, no grace window — so every previously emailed
-- link died the instant an admin resent, and the accept page reported it as
-- "Invitation not found", indistinguishable from never-existed / revoked /
-- expired. That is what sent this whole investigation down the wrong path
-- during the email-lookup UAT.
--
-- ----------------------------------------------------------------------------
-- Why stop rotating, rather than track superseded tokens
-- ----------------------------------------------------------------------------
--
-- The originating card treated rotation as a security property we would be
-- giving up. **It is an accident, not a design.** The designed token-killer is
-- `revoke_invitation`. Rotation only invalidates a leaked token if an admin
-- happens to resend, for unrelated reasons, before expiry — a probabilistic
-- partial mitigation of a threat that has a deterministic complete one.
--
-- Trading it for correct behaviour is right, but ONLY once revocation actually
-- works — because until `20260731195015` (the previous commit) rotation was
-- literally the only thing that ever invalidated a live token. That ordering is
-- load-bearing: this migration must not land before that one.
--
-- Making the token write-once also delivers, for free, what a
-- `superseded_tokens` table was going to buy: every historical link resolves to
-- its row forever, and `status` says exactly why it is not usable. "Superseded"
-- stops being a category at all — expire-A-then-invite-B now reports A as
-- *expired*, which is both truer and more actionable than "superseded".
--
-- Rejected: retaining prior tokens. It reverses a decision already recorded in
-- the emit site (`// previous_token intentionally omitted for security`), and
-- stores N secrets where this stores one.
--
-- ----------------------------------------------------------------------------
-- Pitfall-12 compliance — the constraint is made UNREACHABLE, not caught
-- ----------------------------------------------------------------------------
--
-- A constraint violation inside an event handler FAILS SILENT:
-- `process_domain_event` catches `WHEN OTHERS`, records `processing_error`, and
-- does not re-raise, so the caller sees success. The status and supersede
-- predicates therefore live in the `WHERE` clause rather than being caught —
-- `uq_invitations_pending_org_email` becomes structurally unreachable from this
-- handler. That is remedy (a), applied at the HANDLER tier so it covers every
-- emitter at once, including replay paths (`api.retry_failed_event`, Temporal
-- activity retry) that have no wire tier to guard.
--
-- Deliberate consequence: a refused resend is a silent no-op with no
-- `processing_error`, so a wire-tier read-back reports success. Accepted,
-- because the wire callers already refuse those cases with a clear message
-- BEFORE emitting (`invite-user`'s `checkResendSupersede`); the handler guard
-- exists for replay, which is not a user request.
--
-- Deployed body fetched via Mgmt-API `pg_get_functiondef` and diffed against
-- `handlers/invitation/handle_invitation_resent.sql` before editing (codified
-- pitfall). They matched apart from whitespace.
-- ============================================================================

SET search_path = public, extensions, pg_temp;

-- ----------------------------------------------------------------------------
-- 1. handle_invitation_resent — never writes `token` again
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_invitation_resent(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- `token` is DELIBERATELY ABSENT from the SET list. It is written exactly once,
  -- by handle_user_invited's INSERT arm, and never modified thereafter. A resend
  -- extends the expiry and re-opens the status; it does not mint a new secret.
  --
  -- The WHERE predicates make uq_invitations_pending_org_email unreachable:
  --   * status IN ('pending','expired') — a replay cannot resurrect an accepted,
  --     revoked or deleted invitation.
  --   * NOT EXISTS(...) — a replay cannot create a second pending row for an
  --     address that already has one.
  -- Both are filters, not exception handlers, precisely because an exception
  -- here would be swallowed by process_domain_event and reported as success.
  UPDATE invitations_projection ip
  SET
    expires_at = safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
    status = 'pending',
    updated_at = p_event.created_at
  WHERE ip.invitation_id = safe_jsonb_extract_uuid(p_event.event_data, 'invitation_id')
    AND ip.status IN ('pending', 'expired')
    AND NOT EXISTS (
      SELECT 1
        FROM invitations_projection other
       WHERE other.organization_id = ip.organization_id
         AND btrim(lower(other.email)) = btrim(lower(ip.email))
         AND other.status = 'pending'
         AND other.id <> ip.id
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2. api.get_invitation_token_for_resend — service-role-only token reader
-- ----------------------------------------------------------------------------
--
-- Under a write-once token, `invite-user` must put the EXISTING token in the
-- resend email; it can no longer mint one. Rule 19 forbids a wire-tier
-- `.from()`, so it needs an `api.*` entry point.
--
-- ⚠️ Deliberately NOT adding `token` to the existing `api.get_invitation_for_resend`.
-- That function is GRANTed to `authenticated`, so adding the token there would
-- let any authenticated org admin read invitation tokens over the wire — a
-- strictly worse outcome than the bug being fixed. A separate, narrowly granted
-- function is both safer and cheaper (no signature change on a tagged RPC).
--
-- `p_org_id` is the tenancy guard. A cross-tenant request returns NULL, the same
-- as not-found, so the function never discloses whether an invitation id exists
-- in another org.

CREATE OR REPLACE FUNCTION api.get_invitation_token_for_resend(
  p_invitation_id uuid,
  p_org_id uuid
) RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_token text;
BEGIN
  SELECT i.token INTO v_token
    FROM public.invitations_projection i
   WHERE i.id = p_invitation_id
     AND i.organization_id = p_org_id;

  -- NULL for both not-found and cross-tenant: no existence leak.
  RETURN v_token;
END;
$function$;

REVOKE ALL ON FUNCTION api.get_invitation_token_for_resend(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.get_invitation_token_for_resend(uuid, uuid) TO service_role;

COMMENT ON FUNCTION api.get_invitation_token_for_resend(uuid, uuid) IS
$comment$Return the EXISTING invitation token so invite-user can resend the original link. Required because the token became write-once (20260731201018) and the Edge Function can no longer mint one.

service_role ONLY — deliberately not added to api.get_invitation_for_resend, which is granted to authenticated and would therefore expose tokens to every org admin. p_org_id is the tenancy guard; cross-tenant and not-found both return NULL.

@a4c-rpc-shape: read

@a4c-bucket: E
@a4c-consultant-callable: no
@a4c-consultant-callable-reason: service_role-only orchestration helper; never reachable by a consultant or any authenticated caller.
@a4c-phase-target: none$comment$;

-- ----------------------------------------------------------------------------
-- 3. BEHAVIOURAL probe — drive a real invitation.resent event end to end
-- ----------------------------------------------------------------------------
--
-- This emits an actual domain event, so it exercises the whole trigger → router
-- → handler chain against the deployed schema rather than grepping the body
-- this migration just wrote (which could not fail, and so would not be an
-- assertion at all).
--
-- Everything is rolled back via a sentinel exception; PL/pgSQL variables are
-- in-memory and survive the subtransaction.
DO $$
DECLARE
  v_org            uuid := gen_random_uuid();
  v_inv_a          uuid := gen_random_uuid();  -- business key of invitation A
  v_inv_b          uuid := gen_random_uuid();
  v_email          text := 'pr-a-rotation-probe@example.invalid';
  v_token_before   text;
  v_token_after    text;
  v_status_after   text;
  v_expires_after  timestamptz;
  v_expires_target timestamptz := now() + interval '30 days';
  v_terminal_status_after text;
BEGIN
  BEGIN
    INSERT INTO organizations_projection (id, name, slug, type, path, created_at)
    VALUES (v_org, 'PR A rotation probe org', 'pr-a-rotation-probe-org',
            'platform_owner', 'pr_a_rotation_probe_org'::ltree, now());

    -- Invitation A: pending, its own token.
    INSERT INTO invitations_projection
      (invitation_id, organization_id, email, token, expires_at, status, created_at, updated_at)
    VALUES (v_inv_a, v_org, v_email, 'pr-a-probe-token-ORIGINAL',
            now() + interval '7 days', 'pending', now(), now());

    SELECT token INTO v_token_before
      FROM invitations_projection WHERE invitation_id = v_inv_a;

    -- (a) Resend A. The event carries a DIFFERENT token, exactly as a
    --     pre-write-once emitter would. The handler must ignore it.
    PERFORM api.emit_domain_event(
      p_stream_id   := v_inv_a,
      p_stream_type := 'invitation',
      p_event_type  := 'invitation.resent',
      p_event_data  := jsonb_build_object(
        'invitation_id', v_inv_a,
        'token',         'pr-a-probe-token-ROTATED',
        'expires_at',    v_expires_target
      ),
      p_event_metadata := jsonb_build_object('user_id', NULL)
    );

    SELECT token, status, expires_at
      INTO v_token_after, v_status_after, v_expires_after
      FROM invitations_projection WHERE invitation_id = v_inv_a;

    -- (b) A terminal invitation must not be resurrected by a replay.
    INSERT INTO invitations_projection
      (invitation_id, organization_id, email, token, expires_at, status, created_at, updated_at)
    VALUES (v_inv_b, v_org, 'pr-a-rotation-probe-terminal@example.invalid',
            'pr-a-probe-token-TERMINAL', now() + interval '7 days', 'accepted', now(), now());

    PERFORM api.emit_domain_event(
      p_stream_id   := v_inv_b,
      p_stream_type := 'invitation',
      p_event_type  := 'invitation.resent',
      p_event_data  := jsonb_build_object(
        'invitation_id', v_inv_b,
        'token',         'pr-a-probe-token-REPLAY',
        'expires_at',    v_expires_target
      ),
      p_event_metadata := jsonb_build_object('user_id', NULL)
    );

    SELECT status INTO v_terminal_status_after
      FROM invitations_projection WHERE invitation_id = v_inv_b;

    RAISE EXCEPTION 'PR_A_ROTATION_PROBE_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'PR_A_ROTATION_PROBE_ROLLBACK' THEN
        RAISE;
      END IF;
  END;

  -- The headline invariant.
  IF v_token_after IS DISTINCT FROM v_token_before THEN
    RAISE EXCEPTION 'PROBE FAILED: resend changed the token (% -> %). It must be write-once.', v_token_before, v_token_after
      USING ERRCODE = 'P9099';
  END IF;

  -- ...and the resend must still do its actual job.
  IF v_status_after IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'PROBE FAILED: resend left status at % instead of pending', COALESCE(v_status_after, '<null>')
      USING ERRCODE = 'P9099';
  END IF;
  IF v_expires_after IS NULL OR v_expires_after < now() + interval '29 days' THEN
    RAISE EXCEPTION 'PROBE FAILED: resend did not extend expires_at (got %)', COALESCE(v_expires_after::text, '<null>')
      USING ERRCODE = 'P9099';
  END IF;

  IF v_terminal_status_after IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'PROBE FAILED: replaying invitation.resent resurrected a terminal invitation to %', COALESCE(v_terminal_status_after, '<null>')
      USING ERRCODE = 'P9099';
  END IF;

  RAISE WARNING 'PR A rotation probe passed: token unchanged, expiry extended, status reopened, terminal invitation untouched';
END $$;

-- 3.1 Grant assertion from the catalog — the token reader must NOT be reachable
-- by anon or authenticated. This is the whole reason it is a separate function.
DO $$
DECLARE
  v_leaked text[];
BEGIN
  SELECT array_agg(grantee) INTO v_leaked
    FROM information_schema.role_routine_grants
   WHERE routine_schema = 'api'
     AND routine_name = 'get_invitation_token_for_resend'
     AND grantee IN ('PUBLIC', 'anon', 'authenticated');

  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY: api.get_invitation_token_for_resend is reachable by %', v_leaked
      USING ERRCODE = 'P9099';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
     WHERE routine_schema = 'api'
       AND routine_name = 'get_invitation_token_for_resend'
       AND grantee = 'service_role'
       AND privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'api.get_invitation_token_for_resend is missing EXECUTE for service_role'
      USING ERRCODE = 'P9099';
  END IF;
END $$;
