-- ============================================================================
-- PR E — uniqueness on the normalized email
-- ============================================================================
--
-- PR D (`20260730045737`) normalized email at the source: a BEFORE-row trigger
-- rewrites `NEW.email := btrim(lower(email))`, and a CHECK documents the
-- invariant. That made the CHECK *unreachable*, which is what allowed it to ship
-- safely — see the codified pitfall "A constraint violation inside an event
-- handler FAILS SILENT".
--
-- Uniqueness cannot be made unreachable the same way. A duplicate is a real
-- condition, not a formatting slip, so these indexes CAN fire inside a handler —
-- where `process_domain_event` catches `WHEN OTHERS`, records
-- `processing_error`, and does NOT re-raise. Historically that produced 200 OK +
-- an invitation email + no row: an undiagnosable dead invitation.
--
-- **Gate**: PR D added read-backs at all three `invite-user` emit sites and in the
-- Temporal `emitEvent` funnel, and probe P3 confirmed `get_event_processing_error`
-- is live in the DEPLOYED function (invite-user v110, verified 2026-07-30). That
-- read-back is what turns a 23505 here into a visible error rather than a silent
-- dead invitation. These indexes depend on it.
--
-- ----------------------------------------------------------------------------
-- Why each partial predicate is load-bearing
-- ----------------------------------------------------------------------------
--
-- `WHERE deleted_at IS NULL` on users — `handle_user_deleted` soft-deletes and
-- RETAINS the email. `public.users.id = auth.users.id`, and org cleanup deletes
-- auth users, so "user deleted, signs up again at the same address" legitimately
-- produces a second row. A FULL unique index would turn that into a
-- `unique_violation` inside `handle_user_created`, on the accept path — breaking
-- a supported flow. It is also the filter `api.check_user_exists` already applies,
-- so the index matches the question the code actually asks.
--
-- `WHERE status = 'pending'` on invitations — re-inviting after a revoke or an
-- accept must stay legal. This is not new policy: `invite-user` already calls
-- `check_pending_invitation` and branches to resend. The index converts a
-- TOCTOU-prone service-tier check into an actual constraint. It is also what lets
-- the index land clean; the duplicate pairs on dev are all `accepted` + `revoked`.
--
-- ----------------------------------------------------------------------------
-- Expression form, not plain (email)
-- ----------------------------------------------------------------------------
--
-- Indexed on `btrim(lower(email))` rather than `(email)` so the constraint holds
-- on its own terms and survives PR D's CHECK or trigger being dropped. Matches the
-- existing non-unique `idx_users_email_lower` / `idx_invitations_projection_org_email_lower`
-- (`20260730032132`), so the planner sees consistent expressions.
--
-- `idx_users_email_lower` stays UNPARTITIONED on purpose:
-- `api.check_user_org_membership` does not filter `deleted_at`, so a
-- `WHERE deleted_at IS NULL` index could not serve it.
--
-- ----------------------------------------------------------------------------
-- Pre-flight, run against dev before writing this
-- ----------------------------------------------------------------------------
--
--   duplicate (btrim(lower(email))) among users WHERE deleted_at IS NULL   -> 0 rows
--   duplicate (org, btrim(lower(email))) among pending invitations          -> 0 rows
--   users with no auth.users identity AND deleted_at IS NULL                -> 3
--
-- The 3 orphans participate in the unique index (they are not deleted). They do
-- not block it — their addresses are distinct — but they are stale UAT fixtures;
-- see `stale-uat-fixture-users-without-auth-identity.md`. The count is asserted
-- below so a future run notices if it grows.
--
-- ----------------------------------------------------------------------------
-- ⚠️ Known future interaction — SSO
-- ----------------------------------------------------------------------------
--
-- `auth.users` enforces email uniqueness only `WHERE is_sso_user = false`,
-- deliberately: two SAML identities can legitimately share an address. Today
-- there are 0 SSO users and 0 configured providers, but SAML 2.0 is in the
-- component map. Whoever wires SSO MUST revisit `uq_users_email_normalized` —
-- it is stricter than `auth.users` and would reject a legitimate second identity.
-- ============================================================================

-- `organizations_projection.path` is `ltree`, which lives in the `extensions`
-- schema. The behavioural probe below inserts a throwaway org, so the session
-- search_path has to resolve that type (codified pitfall: a function-attribute
-- SET does not apply at CREATE-time parameter parsing, so set it session-level).
SET search_path = public, extensions, pg_temp;

-- ----------------------------------------------------------------------------
-- 1. The two partial unique indexes
-- ----------------------------------------------------------------------------
--
-- DROP + CREATE, not `CREATE INDEX IF NOT EXISTS`.
--
-- The codified pitfall is that `IF NOT EXISTS` matches on NAME only: it would
-- mask a pre-existing index carrying a DIFFERENT expression, and the migration
-- would report success while the stale definition survived. The remedy the
-- pitfall prescribes is DROP + CREATE followed by an assertion on the
-- DEFINITION — not dropping the guard, which merely trades a silent wrong
-- result for a non-idempotent migration that cannot be re-run.
--
-- Section 2 below supplies the definition assertions, so both properties hold:
-- re-running is safe, and a divergent definition still fails loudly. Both tables
-- are small (14 and 18 rows at pre-flight), so the exclusive lock is negligible;
-- were either large, this would be split out to `CREATE INDEX CONCURRENTLY`
-- outside a transaction — with the same indexdef assertion afterwards.
DROP INDEX IF EXISTS public.uq_users_email_normalized;
CREATE UNIQUE INDEX uq_users_email_normalized
  ON public.users (btrim(lower(email)))
  WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS public.uq_invitations_pending_org_email;
CREATE UNIQUE INDEX uq_invitations_pending_org_email
  ON public.invitations_projection (organization_id, btrim(lower(email)))
  WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- 2. Assertions on the DEFINITION, not on existence
-- ----------------------------------------------------------------------------
--
-- `pg_indexes.indexdef` is the planner's rendering, not the DDL text this
-- migration just wrote — so unlike a body-grep it can actually disagree with us.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT indexdef INTO v_def FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'uq_users_email_normalized';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'uq_users_email_normalized was not created' USING ERRCODE = 'P9099';
  END IF;
  IF v_def NOT LIKE '%UNIQUE%' THEN
    RAISE EXCEPTION 'uq_users_email_normalized is not UNIQUE: %', v_def USING ERRCODE = 'P9099';
  END IF;
  IF v_def NOT LIKE '%btrim(lower(email))%' THEN
    RAISE EXCEPTION 'uq_users_email_normalized is not on the normalized expression: %', v_def
      USING ERRCODE = 'P9099';
  END IF;
  IF v_def NOT LIKE '%WHERE (deleted_at IS NULL)%' THEN
    RAISE EXCEPTION 'uq_users_email_normalized lost its partial predicate: %', v_def
      USING ERRCODE = 'P9099';
  END IF;

  SELECT indexdef INTO v_def FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'uq_invitations_pending_org_email';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'uq_invitations_pending_org_email was not created' USING ERRCODE = 'P9099';
  END IF;
  IF v_def NOT LIKE '%UNIQUE%' THEN
    RAISE EXCEPTION 'uq_invitations_pending_org_email is not UNIQUE: %', v_def USING ERRCODE = 'P9099';
  END IF;
  IF v_def NOT LIKE '%organization_id, btrim(lower(email))%' THEN
    RAISE EXCEPTION 'uq_invitations_pending_org_email has the wrong key: %', v_def
      USING ERRCODE = 'P9099';
  END IF;
  IF v_def NOT LIKE '%WHERE (status = ''pending''::text)%' THEN
    RAISE EXCEPTION 'uq_invitations_pending_org_email lost its partial predicate: %', v_def
      USING ERRCODE = 'P9099';
  END IF;

  -- `idx_users_email_lower` must stay UNPARTITIONED — check_user_org_membership
  -- does not filter deleted_at and could not use a partial index.
  SELECT indexdef INTO v_def FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_users_email_lower';
  IF v_def IS NULL OR v_def LIKE '%WHERE%' THEN
    RAISE EXCEPTION 'idx_users_email_lower must remain unpartitioned: %', COALESCE(v_def, '(missing)')
      USING ERRCODE = 'P9099';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. BEHAVIOURAL probes — the partial predicate is the part most likely to be
--    wrong, and no `indexdef` check can reach it
-- ----------------------------------------------------------------------------
--
-- Every row written here is rolled back: the probe body ends by deliberately
-- raising a sentinel, which the enclosing block catches. PL/pgSQL variables are
-- in-memory and survive the subtransaction rollback, so the verdicts do too.
DO $$
DECLARE
  v_org           uuid := gen_random_uuid();
  v_email         text := 'pr-e-probe@example.invalid';
  v_dup_blocked   boolean := false;
  v_revoked_ok    boolean := false;
  v_case_blocked  boolean := false;
  -- users-side verdicts (uq_users_email_normalized)
  v_u1            uuid := gen_random_uuid();
  v_u2            uuid := gen_random_uuid();
  v_user_email    text := 'pr-e-probe-user@example.invalid';
  v_user_dup_blocked  boolean := false;
  v_user_resignup_ok  boolean := false;
BEGIN
  BEGIN
    -- The probe creates its OWN org rather than borrowing a real one.
    -- `invitations_projection.organization_id` is FK-constrained to
    -- `organizations_projection(id)`, so a synthetic uuid raises
    -- `foreign_key_violation` — which is not `unique_violation`, so the inner
    -- handlers below would not catch it and the migration would abort. Creating
    -- the org also keeps the probe meaningful on a FRESH database (CI's local
    -- container has no organizations at all); a probe that borrowed an existing
    -- row would silently skip exactly where verification matters most.
    -- `slug` and `path` are both UNIQUE, hence the probe-specific values.
    -- Type is `platform_owner` deliberately: `chk_subdomain_conditional` requires
    -- `subdomain_status IS NOT NULL` for any type where
    -- `is_subdomain_required(type, partner_type)` is true, and `platform_owner`
    -- is the one type where it is false. That keeps this fixture to the six
    -- NOT NULL columns and avoids coupling the probe to the `subdomain_status`
    -- enum. The org's type is irrelevant to what is under test — an index.
    INSERT INTO organizations_projection (id, name, slug, type, path, created_at)
    VALUES (v_org, 'PR E probe org', 'pr-e-probe-org', 'platform_owner',
            'pr_e_probe_org'::ltree, now());

    -- (a) two PENDING rows, same (org, normalized email) -> must be rejected
    INSERT INTO invitations_projection
      (invitation_id, organization_id, email, token, expires_at, status)
    VALUES (gen_random_uuid(), v_org, v_email, 'probe-token-1', now() + interval '7 days', 'pending');

    BEGIN
      INSERT INTO invitations_projection
        (invitation_id, organization_id, email, token, expires_at, status)
      VALUES (gen_random_uuid(), v_org, v_email, 'probe-token-2', now() + interval '7 days', 'pending');
    EXCEPTION WHEN unique_violation THEN
      v_dup_blocked := true;
    END;

    -- (b) same address in a DIFFERENT CASE must also collide.
    --
    --     Be precise about what this does and does not prove. PR D installed
    --     `a_normalize_email_invitations`, a BEFORE INSERT OR UPDATE FOR EACH ROW
    --     trigger that rewrites NEW.email := btrim(lower(email)). BEFORE-row
    --     triggers fire ahead of index evaluation, so by the time ANY index sees
    --     this row the value is already lowercase — a plain unique index on
    --     (organization_id, email) would block it identically. This probe
    --     therefore CANNOT distinguish the expression index from a column index,
    --     and it cannot be made to: dropping the trigger to force the point would
    --     hit `chk_invitations_email_normalized` (23514) instead, which the
    --     `WHEN unique_violation` handler would not catch.
    --
    --     What it proves is worth having on its own terms: the trigger and the
    --     index AGREE end to end, so no mixed-case write slips past the
    --     constraint in practice. The claim that the index is on the normalized
    --     EXPRESSION is carried by the indexdef assertion in Section 2, which is
    --     where it belongs.
    BEGIN
      INSERT INTO invitations_projection
        (invitation_id, organization_id, email, token, expires_at, status)
      VALUES (gen_random_uuid(), v_org, upper(v_email), 'probe-token-3', now() + interval '7 days', 'pending');
    EXCEPTION WHEN unique_violation THEN
      v_case_blocked := true;
    END;

    -- (c) the SAME pair must be allowed once the first row is no longer pending —
    --     this is the partial predicate doing its job, and the reason re-inviting
    --     after a revoke stays legal.
    UPDATE invitations_projection SET status = 'revoked'
     WHERE organization_id = v_org AND btrim(lower(email)) = btrim(lower(v_email));

    BEGIN
      INSERT INTO invitations_projection
        (invitation_id, organization_id, email, token, expires_at, status)
      VALUES (gen_random_uuid(), v_org, v_email, 'probe-token-4', now() + interval '7 days', 'pending');
      v_revoked_ok := true;
    EXCEPTION WHEN unique_violation THEN
      v_revoked_ok := false;
    END;

    -- ------------------------------------------------------------------------
    -- (d)+(e) uq_users_email_normalized. Probed here for the same reason as the
    -- invitations index — and with more at stake, because THIS partial predicate
    -- guards a supported user-facing flow (delete -> re-signup at the same
    -- address). Without (e), nothing in this migration demonstrates that flow
    -- still works; the indexdef string match cannot reach it.
    --
    -- `public.users` needs no org FK for this (PR D's A1 probe established that
    -- id + email is a sufficient fixture), so no extra scaffolding.
    -- ------------------------------------------------------------------------

    -- (d) two LIVE rows sharing a normalized address -> must be rejected
    INSERT INTO public.users (id, email) VALUES (v_u1, v_user_email);

    BEGIN
      INSERT INTO public.users (id, email) VALUES (v_u2, upper(v_user_email));
    EXCEPTION WHEN unique_violation THEN
      v_user_dup_blocked := true;
    END;

    -- (e) ...and the SAME address must be ALLOWED once the first row is
    --     soft-deleted. This is the `WHERE deleted_at IS NULL` predicate doing
    --     its job: `handle_user_deleted` soft-deletes and RETAINS the email, so a
    --     FULL unique index here would permanently bar the person from signing
    --     up again — the concrete regression this predicate exists to prevent.
    UPDATE public.users SET deleted_at = now() WHERE id = v_u1;

    BEGIN
      INSERT INTO public.users (id, email) VALUES (v_u2, v_user_email);
      v_user_resignup_ok := true;
    EXCEPTION WHEN unique_violation THEN
      v_user_resignup_ok := false;
    END;

    -- Roll the probe rows back. Nothing above is meant to persist.
    RAISE EXCEPTION 'PR_E_PROBE_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'PR_E_PROBE_ROLLBACK' THEN
        RAISE;
      END IF;
  END;

  IF NOT v_dup_blocked THEN
    RAISE EXCEPTION 'PROBE FAILED: two pending invitations for the same (org, email) were accepted'
      USING ERRCODE = 'P9099';
  END IF;
  IF NOT v_case_blocked THEN
    RAISE EXCEPTION 'PROBE FAILED: a case-variant duplicate was accepted — index is not on the normalized expression'
      USING ERRCODE = 'P9099';
  END IF;
  IF NOT v_revoked_ok THEN
    RAISE EXCEPTION 'PROBE FAILED: re-invite after revoke was rejected — the partial predicate is wrong'
      USING ERRCODE = 'P9099';
  END IF;
  IF NOT v_user_dup_blocked THEN
    RAISE EXCEPTION 'PROBE FAILED: two live users with the same normalized email were accepted'
      USING ERRCODE = 'P9099';
  END IF;
  IF NOT v_user_resignup_ok THEN
    RAISE EXCEPTION 'PROBE FAILED: re-signup after soft-delete was rejected — uq_users_email_normalized is not partial on deleted_at, and every deleted user is now permanently locked out of their own address'
      USING ERRCODE = 'P9099';
  END IF;

  RAISE WARNING 'PR E probes passed: invitations duplicate+case-variant blocked, re-invite-after-revoke allowed; users duplicate blocked, re-signup-after-soft-delete allowed';
END $$;

-- ----------------------------------------------------------------------------
-- 4. Orphan census — reports, does not block
-- ----------------------------------------------------------------------------
--
-- `public.users` rows with no `auth.users` identity and `deleted_at IS NULL`
-- participate in `uq_users_email_normalized`. 3 exist on dev (stale UAT fixtures).
-- They do not collide today.
--
-- This population IS the collision surface for the accept path: an orphan holding
-- an address that someone is later invited at, and who accepts, gets a fresh
-- auth id, takes the `isExistingUser = false` branch (that check keys on user_id,
-- not email), and drives `handle_user_created` into a 23505 that `ON CONFLICT
-- (id)` cannot absorb. `accept-invitation` reads that back and fails the request
-- rather than minting a login with no user row — but the orphan is what makes it
-- reachable at all, so its growth is a real signal.
--
-- Ceiling asserted, not merely reported. An earlier draft raised NOTICE here and
-- the header above claimed the count was "asserted" — it was not, and NOTICE from
-- `supabase db push` is not surfaced in CI output, so nobody would ever have read
-- it. WARNING survives the default client_min_messages; the EXCEPTION is what
-- actually stops a silent expansion of the surface.
DO $$
DECLARE
  v_orphans integer;
  v_known   constant integer := 3;
BEGIN
  SELECT count(*) INTO v_orphans
    FROM public.users u
    LEFT JOIN auth.users au ON au.id = u.id
   WHERE au.id IS NULL AND u.deleted_at IS NULL;

  IF v_orphans > v_known THEN
    RAISE EXCEPTION 'PR E: orphan public.users rows grew to % (known good: %). Each is a live collision surface for uq_users_email_normalized on the accept path — triage before extending it. See stale-uat-fixture-users-without-auth-identity.md', v_orphans, v_known
      USING ERRCODE = 'P9099';
  ELSIF v_orphans > 0 THEN
    RAISE WARNING 'PR E: % public.users row(s) have no auth.users identity and participate in uq_users_email_normalized (see stale-uat-fixture-users-without-auth-identity.md)', v_orphans;
  END IF;
END $$;
