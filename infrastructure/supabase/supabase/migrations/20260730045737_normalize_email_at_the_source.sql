-- ============================================================================
-- Normalize email at the source
-- ============================================================================
--
-- PR D of the email-lookup epic. PRs #103/#105/#106 fixed three lookup RPCs one
-- call site at a time; this establishes the PROPERTY those patches were
-- approximating: a stored email is always btrim(lower(email)).
--
-- WHY A TRIGGER AND NOT HANDLER-LEVEL NORMALIZATION
-- --------------------------------------------------
-- A CHECK violation inside an event handler does NOT fail loud. Verified chain:
--   1. handle_user_invited INSERT raises 23514
--   2. process_domain_event's EXCEPTION WHEN OTHERS catches it, sets
--      NEW.processing_error, does NOT re-raise, RETURN NEW
--   3. the handler's write rolls back; the domain_events INSERT proceeds
--   4. api.emit_domain_event returns the id with no error
--   5. invite-user/index.ts:1220 checks only eventError -> sends the email
-- Result: 200 OK, invitation email sent, no projection row, dead token.
--
-- A BEFORE-row trigger rewrites NEW.email before constraint evaluation, so no
-- writer can reach the CHECK. The CHECK is then not decorative: it is what makes
-- the invariant stateable, visible in a schema dump, and robust to the trigger
-- being dropped. Trigger makes the CHECK safe; CHECK makes the guarantee legible.
--
-- Replay stays correct: projection = f(stream) with f = trigger o handler, and
-- btrim(lower(x)) is deterministic, total and idempotent. The projection was
-- never a verbatim copy of event_data anyway -- handle_user_created synthesizes
-- `name` from a COALESCE(NULLIF(TRIM(CONCAT(...)))) chain.
--
-- Precedent for row triggers on projection tables, both in baseline_v4:
--   update_organizations_projection_timestamp (BEFORE UPDATE, :14876)
--   trg_sync_accessible_orgs                  (AFTER,        :14864)
--
-- WHY NOT citext
-- --------------
--   1. It does not trim. '  a@b.com  '::citext <> 'a@b.com'::citext, and the one
--      write path with no email regex at all (org bootstrap) is exactly the one
--      that can store whitespace.
--   2. It would SILENTLY GUT THIS CHECK. Under citext,
--      `email = btrim(lower(email))` is TRUE for a mixed-case value, because =
--      is case-insensitive. You would enforce only the trim half while the
--      constraint reads as if it enforced both.
--   3. It cannot reach the worst bug. accept-invitation:534 is a JavaScript ===
--      against the Auth admin API; no SQL operator touches it.
-- Also: ALTER COLUMN ... TYPE citext fails while public.event_history_by_entity
-- projects users.email, and `supabase gen types` emits `unknown` for extension
-- types (ltree precedent, database.types.ts:160,525).
--
-- SCOPE
-- -----
-- Uniqueness (UNIQUE on the normalized value) is deliberately NOT here. Unlike
-- the CHECK, a uniqueness violation cannot be made unreachable by a trigger --
-- a duplicate is a real condition, not a formatting slip. It ships in PR E,
-- after probe P3 confirms the Edge Function read-back added alongside this
-- migration is live in the deployed function.
--
-- KNOWN FUTURE INTERACTION (do not pre-solve)
-- -------------------------------------------
-- auth.users enforces email uniqueness only WHERE is_sso_user = false --
-- deliberately, because two SAML identities can legitimately share an address.
-- Today: 0 SSO users, 0 configured providers. SAML 2.0 is in the component map.
-- Whoever wires SSO must revisit PR E's uq_users_email_normalized.
--
-- Ground truth at authorship (live dev project tmrjlswbsxmbglmaclxu):
--   public.users            14 rows, 0 non-normalized
--   invitations_projection  18 rows, 0 non-normalized
--   auth.users              13 rows, 0 mixed-case
--   existing triggers on either table: NONE
-- The backfill below is expected to touch 0 rows. This is structural work, not
-- a response to observed corruption.
--
-- Cosmetic note, so a reviewer does not log it as a miss: handle_user_created
-- sets name = COALESCE(..., email), so the DISPLAY NAME fallback keeps whatever
-- casing arrived. Out of scope.
-- ============================================================================

-- organizations_projection.path is ltree (extension type). The A1 probe casts to
-- it, and function-attribute search_path does not apply to a DO block's parse.
SET search_path = public, extensions, pg_temp;


-- ============================================================================
-- Section 1: the normalizing trigger
-- ============================================================================
-- Named with an `a_` prefix on purpose. PostgreSQL fires BEFORE-row triggers in
-- NAME ORDER; the prefix guarantees no future trigger can sort ahead of this one
-- and observe a non-normalized NEW.email.
--
-- Plain BEFORE INSERT OR UPDATE, deliberately NOT `UPDATE OF email`: the column
-- list is an optimisation that opens a hole the moment a path writes the column
-- indirectly, and these tables are 14 and 18 rows.

CREATE OR REPLACE FUNCTION public.a_normalize_email_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.email IS NOT NULL THEN
    NEW.email := btrim(lower(NEW.email));
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.a_normalize_email_before_write() IS
$comment$Canonicalize NEW.email to btrim(lower(...)) before constraint evaluation.

Paired with chk_users_email_normalized / chk_invitations_email_normalized: this
trigger upholds the invariant, the CHECK states it. Dropping this trigger makes
the CHECK reachable, which -- because process_domain_event absorbs handler
exceptions into processing_error without re-raising -- degrades to a silent
no-projection-row failure rather than a visible error. Do not drop it without
also fixing every emit caller to read processing_error back.

The `a_` prefix is load-bearing: PG fires BEFORE-row triggers in name order.$comment$;

DROP TRIGGER IF EXISTS a_normalize_email_users ON public.users;
CREATE TRIGGER a_normalize_email_users
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.a_normalize_email_before_write();

DROP TRIGGER IF EXISTS a_normalize_email_invitations ON public.invitations_projection;
CREATE TRIGGER a_normalize_email_invitations
  BEFORE INSERT OR UPDATE ON public.invitations_projection
  FOR EACH ROW EXECUTE FUNCTION public.a_normalize_email_before_write();


-- ============================================================================
-- Section 2: backfill
-- ============================================================================
-- Expected to affect 0 rows on dev. Present so a fresh replay (CI container,
-- future environment) is correct by construction rather than by luck.

DO $$
DECLARE
  v_users       INTEGER;
  v_invitations INTEGER;
BEGIN
  UPDATE public.users
     SET email = btrim(lower(email))
   WHERE email <> btrim(lower(email));
  GET DIAGNOSTICS v_users = ROW_COUNT;

  UPDATE public.invitations_projection
     SET email = btrim(lower(email))
   WHERE email <> btrim(lower(email));
  GET DIAGNOSTICS v_invitations = ROW_COUNT;

  RAISE NOTICE 'email backfill: % users, % invitations normalized', v_users, v_invitations;
END $$;


-- ============================================================================
-- Section 3: the CHECK constraints
-- ============================================================================

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS chk_users_email_normalized;
ALTER TABLE public.users
  ADD CONSTRAINT chk_users_email_normalized
  CHECK (email = btrim(lower(email)));

ALTER TABLE public.invitations_projection
  DROP CONSTRAINT IF EXISTS chk_invitations_email_normalized;
ALTER TABLE public.invitations_projection
  ADD CONSTRAINT chk_invitations_email_normalized
  CHECK (email = btrim(lower(email)));

COMMENT ON CONSTRAINT chk_users_email_normalized ON public.users IS
'Stored email is always btrim(lower(email)). Upheld by trigger a_normalize_email_users; this states the invariant so a bare `=` comparison against stored state is safe to write.';

COMMENT ON CONSTRAINT chk_invitations_email_normalized ON public.invitations_projection IS
'Stored email is always btrim(lower(email)). Upheld by trigger a_normalize_email_invitations; this states the invariant so a bare `=` comparison against stored state is safe to write.';


-- ============================================================================
-- Section 4: api.get_event_processing_error
-- ============================================================================
-- Lets an Edge Function / Temporal activity complete the Pattern A v2 contract
-- after api.emit_domain_event returns. Without it, a handler failure is
-- invisible to the caller (see the header).
--
-- SECURITY DEFINER is MANDATORY, not stylistic: `authenticated` has no GRANT on
-- public.domain_events, so an INVOKER api.* function reading it raises 42501 ->
-- 403. Codified pitfall from PR #47/#48.
--
-- Returns processing_error (MESSAGE_TEXT only -- PII layer 1 per PR #43) and
-- NEVER processing_error_detail, which carries PG_EXCEPTION_DETAIL and is a
-- gated read.

CREATE OR REPLACE FUNCTION api.get_event_processing_error(p_event_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_processing_error TEXT;
BEGIN
  SELECT de.processing_error
    INTO v_processing_error
    FROM public.domain_events de
   WHERE de.id = p_event_id;

  RETURN v_processing_error;
END;
$function$;

REVOKE ALL ON FUNCTION api.get_event_processing_error(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.get_event_processing_error(uuid) TO service_role;

COMMENT ON FUNCTION api.get_event_processing_error(uuid) IS
$comment$Read processing_error for one domain event (Pattern A v2 read-back for wire-tier callers)

Returns NULL when the event processed cleanly or does not exist. Callers treat a
non-NULL result as "the projection write failed" and MUST fail the request
rather than reporting success.

Deliberately returns MESSAGE_TEXT only. processing_error_detail carries
PG_EXCEPTION_DETAIL (potential PHI) and is NOT exposed here -- use the gated
api.get_failed_events_with_detail for that.

SECURITY DEFINER is required: authenticated lacks GRANT on domain_events, so an
INVOKER function raises 42501 -> 403 (PR #47/#48).

@a4c-rpc-shape: read
@a4c-bucket: E
@a4c-consultant-callable: no
@a4c-phase-target: none$comment$;


-- ============================================================================
-- Section 5: consumer fixes
-- ============================================================================
-- The column side of each comparison is now redundant, but the INCOMING side is
-- not -- every one compares stored state against a value from outside the
-- CHECK's reach (an RPC argument, a JWT claim).
--
-- Uses the SYMMETRIC form btrim(lower(col)) = btrim(lower(arg)) to match the
-- three RPCs normalized in 20260730034703. PR #106's F1 finding was that
-- asymmetry is the bug; shipping `col = btrim(lower(arg))` here would add a
-- third idiom to the same codebase.

-- ---------------------------------------------------------------------------
-- 5a. api.get_invitation_by_org_and_email -- the org-bootstrap IDEMPOTENCY GUARD
-- ---------------------------------------------------------------------------
-- Two defects, both fixed here:
--   (1) bare `i.email = p_email`, while its sibling check_pending_invitation
--       became case-insensitive in #106 -- so the two disagreed, and a bootstrap
--       retry with different casing minted a DUPLICATE invitation.
--   (2) LIMIT 1 with NO ORDER BY, over a table that provably holds duplicate
--       (org, email) pairs (3 on dev). Case-insensitivity widens the candidate
--       set, so the pick becomes nondeterministic and a retry can reuse a
--       REVOKED invitation's token. Same class #106 fixed in
--       check_user_org_membership via ORDER BY is_active DESC, created_at.
--
-- Deliberately NOT filtering on status: `status = 'pending'` alone would make a
-- post-acceptance bootstrap retry mint a duplicate invitation for someone who is
-- already a member. That is a semantic decision, carded separately. The ORDER BY
-- makes existing behaviour deterministic without changing which rows are
-- eligible.
--
-- Signature unchanged -> CREATE OR REPLACE preserves the OID and therefore the
-- @a4c-rpc-shape / @a4c-bucket comment. Asserted in Section 7 (A5).

CREATE OR REPLACE FUNCTION api.get_invitation_by_org_and_email(p_org_id uuid, p_email text)
RETURNS TABLE(invitation_id uuid, email text, token text, expires_at timestamp with time zone)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT i.invitation_id, i.email, i.token, i.expires_at
  FROM invitations_projection i
  WHERE i.organization_id = p_org_id
    AND btrim(lower(i.email)) = btrim(lower(p_email))
  ORDER BY (i.status = 'pending') DESC, i.created_at DESC
  LIMIT 1;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5b. api.get_invitation_by_id -- email is an AUTHORIZATION predicate here
-- ---------------------------------------------------------------------------
-- This function is SECURITY DEFINER, so RLS does not apply to it. That makes the
-- `i.email = v_current_user_email` EXISTS the ONLY authorization path for the
-- invitee branch -- a casing mismatch does not degrade to a lookup miss, it
-- denies a legitimate invitee with 'Insufficient permissions'.
--
-- Do NOT COALESCE the claim to '': btrim(lower(NULL)) is NULL, the comparison
-- yields NULL, and a request with no email claim correctly stays unauthorized.
-- Coalescing to '' would create a matchable value.
--
-- Body otherwise verbatim from the deployed definition (fetched via
-- pg_get_functiondef per codified pitfall 6), including the three-way permission
-- check and the token-suppressing `NULL::TEXT AS token`.

CREATE OR REPLACE FUNCTION api.get_invitation_by_id(p_invitation_id uuid)
RETURNS TABLE(id uuid, email text, first_name text, last_name text, organization_id uuid, roles jsonb, token text, status text, expires_at timestamp with time zone, access_start_date date, access_expiration_date date, notification_preferences jsonb, accepted_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'api'
AS $function$
DECLARE
  v_invitation_org_id UUID;
  v_current_user_email TEXT;
  v_has_org_admin BOOLEAN;
  v_has_platform_privilege BOOLEAN;
BEGIN
  -- Get invitation's organization
  SELECT i.organization_id INTO v_invitation_org_id
  FROM public.invitations_projection i
  WHERE i.id = p_invitation_id;

  IF v_invitation_org_id IS NULL THEN
    -- Invitation not found, return empty
    RETURN;
  END IF;

  -- Get current user context
  v_current_user_email := (current_setting('request.jwt.claims', true)::json->>'email');
  v_has_org_admin := has_org_admin_permission();
  v_has_platform_privilege := has_platform_privilege();

  -- Permission check: must be org admin for this org, platform admin, or the invited user
  IF NOT (
    v_has_platform_privilege
    OR (v_has_org_admin AND v_invitation_org_id = get_current_org_id())
    OR EXISTS (
      SELECT 1 FROM public.invitations_projection i
      WHERE i.id = p_invitation_id
        AND btrim(lower(i.email)) = btrim(lower(v_current_user_email))
    )
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to view this invitation';
  END IF;

  -- Return the invitation
  RETURN QUERY
  SELECT
    i.id,
    i.email,
    i.first_name,
    i.last_name,
    i.organization_id,
    i.roles,
    NULL::TEXT AS token,  -- Never expose tokens via API
    i.status,
    i.expires_at,
    i.access_start_date,
    i.access_expiration_date,
    i.notification_preferences,
    i.accepted_at,
    i.created_at,
    i.updated_at
  FROM public.invitations_projection i
  WHERE i.id = p_invitation_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5c. RLS policy invitations_user_own_select
-- ---------------------------------------------------------------------------
-- The JWT email comes from auth.users and is Auth-lowercased; the stored email
-- was not normalized. So a mixed-case invitation was invisible to the person it
-- was issued to -- an authorization-visibility failure, not a lookup miss.
--
-- ALTER POLICY rather than DROP+CREATE: atomic, no window with the policy
-- absent, and it cannot lose a comment.
--
-- The ( SELECT ... ) wrapper is LOAD-BEARING -- it is the RLS initplan-hoisting
-- form introduced by 20260204235005 for per-row evaluation cost. Do not unwrap.

ALTER POLICY invitations_user_own_select ON public.invitations_projection
  USING (
    btrim(lower(email)) = btrim(lower(
      (SELECT ((current_setting('request.jwt.claims'::text, true))::json ->> 'email'::text))
    ))
  );


-- ============================================================================
-- Section 6: delete the dead WHEN 'user.invited' arm from process_invitation_event
-- ============================================================================
-- The arm has NEVER executed. All 26 user.invited events carry stream_type
-- 'user' and route via process_user_event -> handle_user_invited, and
-- contracts/asyncapi/domains/invitation.yaml pins UserInvitedEvent.stream_type
-- to `const: user` -- so this arm contradicts the published contract.
--
-- It is a SECOND writer to invitations_projection with a divergent conflict key
-- (id vs invitation_id), divergent field extraction (bare ->> vs
-- safe_jsonb_extract_text), and a notification-preference default that ALREADY
-- disagrees with the live handler (phone_id/in_app here vs phoneId/inApp in
-- handle_user_invited). Deleting it removes a raw-email writer by construction
-- rather than normalizing a code path that cannot run.
--
-- The ELSE arm's RAISE EXCEPTION ... P9001 is the correct behaviour for a
-- user.invited that arrives on the invitation stream.
--
-- Body otherwise verbatim from the deployed definition (pitfall 6). v_org_id is
-- dropped from DECLARE with the arm -- it had no other reader.

CREATE OR REPLACE FUNCTION public.process_invitation_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_invitation_id UUID;
BEGIN
  CASE p_event.event_type

    -- Handle invitation accepted
    WHEN 'invitation.accepted' THEN
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      UPDATE invitations_projection
      SET
        status = 'accepted',
        accepted_at = (p_event.event_data->>'accepted_at')::TIMESTAMPTZ,
        updated_at = p_event.created_at
      WHERE id = v_invitation_id;

    -- Handle invitation revoked
    WHEN 'invitation.revoked' THEN
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      UPDATE invitations_projection
      SET
        status = 'revoked',
        updated_at = p_event.created_at
      WHERE id = v_invitation_id;

    -- Handle invitation expired
    WHEN 'invitation.expired' THEN
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      UPDATE invitations_projection
      SET
        status = 'expired',
        updated_at = p_event.created_at
      WHERE id = v_invitation_id;

    -- Handle invitation resent (NEW: was only in process_organization_event)
    WHEN 'invitation.resent' THEN
      PERFORM handle_invitation_resent(p_event);

    -- Unhandled event type (fixed: EXCEPTION instead of WARNING)
    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_invitation_event', p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;

END;
$function$;


-- ============================================================================
-- Section 7: assertions
-- ============================================================================
-- Every assertion observes state this migration did NOT itself write.
--
-- Deliberately ABSENT: a pg_get_functiondef(...) ~ 'btrim' check against the
-- functions replaced above, and a pg_get_constraintdef check on the CHECKs just
-- added. Both are vacuous -- this migration wrote that exact text moments ago,
-- and a plain ADD CONSTRAINT either produces that definition or aborts. Pitfall
-- 11's indexdef assertion is load-bearing only because CREATE INDEX IF NOT
-- EXISTS matches on NAME and can silently no-op; ADD CONSTRAINT cannot.

-- ---------------------------------------------------------------------------
-- A1: behavioural probe -- does the trigger actually normalize?
-- ---------------------------------------------------------------------------
-- Runs inside a sub-transaction that creates its OWN scratch organization and
-- unwinds via a sentinel raise. This matters: baseline_v4 seeds ZERO
-- organizations, and invitations_projection.organization_id is NOT NULL with an
-- FK -- so on a fresh CI container (rpc-registry-sync.yml applies migrations to
-- a clean Supabase) a probe assuming an existing org would raise 23503 and take
-- the whole migration down. `supabase db push --dry-run` does not catch that;
-- only the container replay does.

DO $$
DECLARE
  v_org_id   UUID := gen_random_uuid();
  v_user_id  UUID := gen_random_uuid();
  v_inv_id   UUID := gen_random_uuid();
  v_suffix   TEXT := replace(gen_random_uuid()::text, '-', '');
  v_dirty    TEXT := '  MiXeD@Example.COM  ';
  v_expected TEXT := 'mixed@example.com';
  v_got_user TEXT;
  v_got_inv  TEXT;
BEGIN
  BEGIN
    -- type='platform_owner' deliberately: chk_subdomain_conditional requires a
    -- non-NULL subdomain_status whenever is_subdomain_required(type, partner_type)
    -- is true, which it is for 'provider'. platform_owner needs neither a
    -- subdomain nor a partner_type, so it is the cheapest constraint-satisfying
    -- scratch row. (chk_partner_type_required only bites 'provider_partner'.)
    INSERT INTO public.organizations_projection (id, name, slug, type, path, created_at)
    VALUES (v_org_id, 'a4c email probe', 'a4c-email-probe-' || v_suffix,
            'platform_owner', ('a4cemailprobe' || v_suffix)::ltree, now());

    INSERT INTO public.users (id, email)
    VALUES (v_user_id, v_dirty);
    SELECT u.email INTO v_got_user FROM public.users u WHERE u.id = v_user_id;

    INSERT INTO public.invitations_projection
      (id, invitation_id, organization_id, email, token, expires_at)
    VALUES (v_inv_id, v_inv_id, v_org_id, v_dirty,
            'a4c-email-probe-' || v_suffix, now() + interval '7 days');
    SELECT i.email INTO v_got_inv FROM public.invitations_projection i WHERE i.id = v_inv_id;

    IF v_got_user IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'A1 FAILED: users.email probe stored "%" (expected "%")', v_got_user, v_expected
        USING ERRCODE = 'P9098';
    END IF;
    IF v_got_inv IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'A1 FAILED: invitations_projection.email probe stored "%" (expected "%")', v_got_inv, v_expected
        USING ERRCODE = 'P9098';
    END IF;

    -- Unwind the scratch rows by aborting the sub-transaction.
    RAISE EXCEPTION 'A1_ROLLBACK_SENTINEL' USING ERRCODE = 'P9097';

  EXCEPTION
    WHEN SQLSTATE 'P9097' THEN
      RAISE NOTICE 'A1 PASSED: trigger normalizes both tables (scratch rows rolled back)';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- A2: cross-check against auth.users -- state this migration never touches
-- ---------------------------------------------------------------------------
-- LEFT JOIN for the orphan count, not INNER. An inner join structurally cannot
-- see rows in public.users with no auth identity, and there are 3 such rows on
-- dev (dev/active/stale-uat-fixture-users-without-auth-identity.md). Those are
-- the exact rows PR E's unique index has to reckon with, so surface them now.

DO $$
DECLARE
  v_mismatch INTEGER;
  v_orphans  INTEGER;
BEGIN
  SELECT count(*) INTO v_mismatch
    FROM public.users u
    JOIN auth.users a ON a.id = u.id
   WHERE u.email <> btrim(lower(a.email));

  SELECT count(*) INTO v_orphans
    FROM public.users u
    LEFT JOIN auth.users a ON a.id = u.id
   WHERE a.id IS NULL AND u.deleted_at IS NULL;

  IF v_mismatch > 0 THEN
    RAISE EXCEPTION 'A2 FAILED: % public.users row(s) disagree with their auth.users identity after backfill', v_mismatch
      USING ERRCODE = 'P9098';
  END IF;

  RAISE NOTICE 'A2 PASSED: 0 identity mismatches; % live orphan row(s) with no auth identity -- relevant to PR E uniqueness', v_orphans;
END $$;

-- ---------------------------------------------------------------------------
-- A3: raw-comparison tripwire
-- ---------------------------------------------------------------------------
-- Inverted on purpose. Enumerating the argument names I already know about
-- (p_email, v_current_user_email, ...) can only rediscover the sites just fixed;
-- it cannot find the next one. So: match `email=` NOT followed by a known-safe
-- right-hand side, across every plpgsql body in api + public -- ~1300 functions
-- this migration did not write.
--
-- The regexp_replace is REQUIRED, not cosmetic. With `\yemail\s*=\s*(?!...)` the
-- engine backtracks \s* to zero width and evaluates the lookahead at the space
-- immediately after `=`, where the forbidden token is trivially absent -- so
-- `email = EXCLUDED.email` matched and the tripwire fired on legitimate code.
-- Collapsing whitespace around `=` first removes the ambiguity. Verified live:
-- flags `email = lower(p_email)`, ignores `email = EXCLUDED.email` and the
-- symmetric btrim form.
--
-- \y not \b -- \b silently fails at end-of-input on hosted Supabase (pitfall 1).

DO $$
DECLARE
  v_offenders TEXT[];
BEGIN
  SELECT array_agg(n.nspname || '.' || p.proname ORDER BY 1)
    INTO v_offenders
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('api', 'public')
     AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
     -- out-of-scope domain: contact / client email addresses, not user identity
     AND p.proname NOT IN ('handle_client_email_updated', 'process_contact_event')
     AND regexp_replace(pg_get_functiondef(p.oid), '[ \t]*=[ \t]*', '=', 'g')
         ~ '\yemail=(?!btrim|EXCLUDED\.|NEW\.|OLD\.|COALESCE|ANY)';

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'A3 FAILED: un-normalized email comparison(s) remain: %', v_offenders
      USING ERRCODE = 'P9098';
  END IF;

  RAISE NOTICE 'A3 PASSED: no un-normalized email comparisons in api/public plpgsql bodies';
END $$;

-- ---------------------------------------------------------------------------
-- A4: policy twin of A3 -- scans every policy in the database
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_offenders TEXT[];
BEGIN
  SELECT array_agg(schemaname || '.' || tablename || '.' || policyname ORDER BY 1)
    INTO v_offenders
    FROM pg_policies
   WHERE coalesce(qual, '') ~ '\yemail\y'
     AND coalesce(qual, '') ~ 'jwt\.claims'
     AND coalesce(qual, '') !~ 'btrim';

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'A4 FAILED: RLS policy compares a raw email to a JWT claim: %', v_offenders
      USING ERRCODE = 'P9098';
  END IF;

  RAISE NOTICE 'A4 PASSED: no RLS policy compares a raw email to a JWT claim';
END $$;

-- ---------------------------------------------------------------------------
-- A5: M3 shape-tag survival across CREATE OR REPLACE
-- ---------------------------------------------------------------------------
-- COMMENT ON FUNCTION is keyed to the OID. CREATE OR REPLACE at an unchanged
-- signature preserves it; any accidental signature drift becomes DROP+CREATE and
-- silently loses both @a4c-rpc-shape and @a4c-bucket, turning
-- rpc-registry-sync.yml and rpc-reachability-matrix-sync.yml red on the next
-- run. obj_description is not written by this migration for the two altered
-- RPCs -- only for the new one.

DO $$
DECLARE
  v_missing TEXT[] := '{}';
  v_fn      TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'api.get_invitation_by_id(uuid)',
    'api.get_invitation_by_org_and_email(uuid,text)',
    'api.get_event_processing_error(uuid)'
  ] LOOP
    IF coalesce(obj_description(v_fn::regprocedure, 'pg_proc'), '') !~ '@a4c-rpc-shape:\s*(envelope|read)\y' THEN
      v_missing := array_append(v_missing, v_fn);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'A5 FAILED: missing/invalid @a4c-rpc-shape tag on: %', v_missing
      USING ERRCODE = 'P9098';
  END IF;

  RAISE NOTICE 'A5 PASSED: shape tags intact on all three RPCs';
END $$;
