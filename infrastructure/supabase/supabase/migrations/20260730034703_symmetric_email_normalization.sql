-- ============================================================================
-- Symmetric email normalization: btrim(lower(...)) on BOTH sides
-- ============================================================================
--
-- Forward fix for `20260730032132_case_insensitive_email_lookup.sql`, per
-- software-architect-dbc review of PR #106 (findings F1, F3, F4).
--
-- WHY A SECOND MIGRATION RATHER THAN AN EDIT
--
-- 20260730032132 is already recorded in dev's `schema_migrations`. Editing it in
-- place would never re-run there, while every other environment would receive the
-- corrected version — guaranteed divergence. Executable SQL is fixed forward.
-- (Comment-only corrections to that file's prose ARE made in place, since they
-- change nothing semantically in any environment and leaving a falsified premise
-- in the migration record is the durable harm.)
--
-- F1 — WHAT WAS WRONG
--
-- 20260730032132 normalized asymmetrically: `lower(btrim(p_email))` on the
-- parameter but `lower(email)` alone on the column. The stated reason — "the
-- column side is lower(email) alone so it matches the functional index expression
-- exactly" — is FALSE. A functional index on `btrim(lower(email))` is used
-- identically; the review proved it by EXPLAIN. The asymmetry bought nothing and
-- left a stored value with stray whitespace unmatchable.
--
-- That is not hypothetical. The org-bootstrap path has ZERO email validation or
-- trimming at any layer:
--
--   OrganizationFormViewModel.ts:423   no trim, no validation
--     -> TemporalWorkflowClient        passthrough
--     -> organization-bootstrap EF     no regex at all
--     -> generate-invitations.ts:114   no validation anywhere in workflows/src/
--     -> handle_user_invited           writes raw
--
-- so an unvalidated browser field reaches `invitations_projection.email` with
-- whitespace intact. `check_pending_invitation` would then miss it and return
-- empty — a false `not_found`, which the invite form renders as a confident
-- "New user - complete the form to send an invitation" for someone who already
-- has a pending invitation. Exactly the defect class this epic exists to remove.
--
-- (The `invite-user` path is NOT a vector: index.ts:956 applies
-- /^[^\s@]+@[^\s@]+\.[^\s@]+$/, which rejects surrounding whitespace with a 400.
-- It has no case protection, which 20260730032132 already fixed.)
--
-- F4 — WHY THE INDEXES ARE DROPPED, NOT `IF NOT EXISTS`
--
-- `CREATE INDEX IF NOT EXISTS` matches on NAME ONLY. Re-issuing it with a changed
-- expression under an existing name silently keeps the OLD definition and raises
-- nothing — verified by the review in exactly this forward-fix direction. Using it
-- here would leave both indexes on `lower(email)` while the functions query
-- `btrim(lower(email))`, and the assertions would pass green while every probe
-- seq-scanned. Hence DROP + CREATE, and assertions that check `indexdef` rather
-- than `indexname`.
--
-- F3 — WHAT IS DELIBERATELY *NOT* ASSERTED HERE
--
-- 20260730032132's assertions (b) and (c) `pg_get_functiondef` the functions that
-- same migration had just written and regex the result. `CREATE OR REPLACE` either
-- succeeded (so the strings are present) or aborted the transaction — they cannot
-- fail. Vacuous, not merely brittle. They are not reproduced below. The M3
-- shape-tag assertion IS kept, because `obj_description` is NOT written by this
-- migration and OID preservation is a real thing to verify.
--
-- PITFALL 6
--
-- This re-incurs the CREATE OR REPLACE hazard. The authoritative pre-image is
-- 20260730032132 itself (the review confirmed the three deployed bodies are
-- byte-identical to it). Preserved verbatim below: both `service_role`
-- detections, `has_platform_privilege()`, the `accessible_organizations @>`
-- EXISTS, the `caller` alias (42702), `RETURN`-empty Bucket A semantics, and
-- `check_user_exists`'s `deleted_at IS NULL` (PR #64 finding #3).
--
-- SCOPE — this does NOT close the problem space
--
-- Three of at least eight case-sensitive email comparisons are now normalized.
-- Still outstanding, each carded:
--   * an RLS policy on invitations_projection that makes a mixed-case invitation
--     invisible to its own invitee (authorization-visibility, not lookup)
--   * accept-invitation:534, which can 500 and permanently wedge an invitation
--   * api.get_invitation_by_org_and_email — bare `=`, and the idempotency guard
--     for org bootstrap, so it now DISAGREES with check_pending_invitation
-- See dev/active/normalize-email-at-the-source.md. Per-call-site patching is the
-- wrong altitude; citext or write-path normalization is the real target.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Indexes first — DROP + CREATE so the expression actually changes
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_users_email_lower;
CREATE INDEX idx_users_email_lower
  ON public.users (btrim(lower(email)));

DROP INDEX IF EXISTS public.idx_invitations_projection_org_email_lower;
CREATE INDEX idx_invitations_projection_org_email_lower
  ON public.invitations_projection (organization_id, btrim(lower(email)));

-- ----------------------------------------------------------------------------
-- 2. api.check_user_org_membership
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.check_user_org_membership(p_email text, p_org_id uuid)
RETURNS TABLE(user_id uuid, is_active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- Tenancy guard (20260729184125), verbatim. Alias the table: this function
  -- RETURNS TABLE(user_id uuid, ...), so an unqualified column reference inside
  -- the EXISTS risks ambiguity with an OUT parameter (SQLSTATE 42702).
  IF NOT (
    current_setting('role', true) = 'service_role'
    OR COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
         ->> 'role' = 'service_role'
    OR public.has_platform_privilege()
    OR EXISTS (
      SELECT 1
      FROM public.users caller
      WHERE caller.id = public.get_current_user_id()
        AND caller.accessible_organizations @> ARRAY[p_org_id]::uuid[]
    )
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT u.id as user_id, u.is_active
  FROM users u
  INNER JOIN user_roles_projection urp ON u.id = urp.user_id
  -- Symmetric: the column expression matches idx_users_email_lower exactly.
  WHERE btrim(lower(u.email)) = btrim(lower(p_email))
    AND urp.organization_id = p_org_id
  -- Deterministic pick. There is no unique index on email on this table, so a
  -- case-insensitive match can now span several rows (e.g. Bob@x inactive and
  -- bob@x active). Without ORDER BY, LIMIT 1 returns an arbitrary row's
  -- is_active and could render "deactivated" for an active member. Prefer the
  -- active row, then the oldest, so the answer is at least stable and
  -- fail-safe. Root fix is a uniqueness constraint — see the source card.
  ORDER BY u.is_active DESC, u.created_at
  LIMIT 1;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. api.check_pending_invitation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.check_pending_invitation(p_email text, p_org_id uuid)
RETURNS TABLE(id uuid, email text, expires_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- Tenancy guard (20260729184125), verbatim. The `caller` alias is REQUIRED
  -- here, not stylistic: this function's OUT parameters include `id`, so an
  -- unqualified `id` in the EXISTS resolves ambiguously (SQLSTATE 42702).
  IF NOT (
    current_setting('role', true) = 'service_role'
    OR COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
         ->> 'role' = 'service_role'
    OR public.has_platform_privilege()
    OR EXISTS (
      SELECT 1
      FROM public.users caller
      WHERE caller.id = public.get_current_user_id()
        AND caller.accessible_organizations @> ARRAY[p_org_id]::uuid[]
    )
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT ip.id, ip.email, ip.expires_at
  FROM invitations_projection ip
  -- organization_id leads, matching idx_invitations_projection_org_email_lower.
  WHERE ip.organization_id = p_org_id
    AND btrim(lower(ip.email)) = btrim(lower(p_email))
    AND ip.status = 'pending'
  ORDER BY ip.created_at DESC
  LIMIT 1;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. api.check_user_exists — Bucket E [pre-auth], stays unguarded
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.check_user_exists(p_email text)
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT u.id AS user_id, u.email
    FROM public.users u
   WHERE btrim(lower(u.email)) = btrim(lower(p_email))
     AND u.deleted_at IS NULL   -- PR #64 finding #3: align with audit query at
                                -- 20260513203931_reject_cross_provider_invitations.sql:185-187
                                -- and prevent false-positive cross-provider blocks for
                                -- formerly-deleted users.
   ORDER BY u.created_at
   LIMIT 1;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. Assertions — only things this migration does NOT itself write
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
  v_comment text;
  v_missing_tag text[] := '{}';
BEGIN
  -- (a) M3 shape tags must survive CREATE OR REPLACE via OID preservation. Worth
  --     asserting because this migration does not write obj_description — unlike
  --     the function bodies, which it does write and so cannot meaningfully check.
  --     NB: \y not \b — PG ARE's \b silently fails at end-of-input on hosted
  --     Supabase (codified pitfall 1). Verified live: \y -> true, \b -> false.
  FOREACH v_fn IN ARRAY ARRAY[
    'api.check_user_org_membership(text,uuid)',
    'api.check_pending_invitation(text,uuid)',
    'api.check_user_exists(text)'
  ] LOOP
    SELECT obj_description(v_fn::regprocedure, 'pg_proc') INTO v_comment;
    IF v_comment IS NULL OR v_comment !~ '@a4c-rpc-shape:\s*read\y' THEN
      v_missing_tag := array_append(v_missing_tag, v_fn);
    END IF;
  END LOOP;

  IF array_length(v_missing_tag, 1) > 0 THEN
    RAISE EXCEPTION 'M3 shape tag lost on CREATE OR REPLACE for: %', v_missing_tag
      USING ERRCODE = 'P9099';
  END IF;

  -- (b) Index DEFINITIONS, not names. `CREATE INDEX IF NOT EXISTS` matches on name
  --     only, so a name-based check passes green against a stale expression — the
  --     precise trap that makes the DROP above mandatory.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_users_email_lower'
      AND indexdef LIKE '%btree (btrim(lower(email)))%'
  ) THEN
    RAISE EXCEPTION 'idx_users_email_lower missing or has the wrong expression — probes would seq scan'
      USING ERRCODE = 'P9099';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_invitations_projection_org_email_lower'
      AND indexdef LIKE '%btree (organization_id, btrim(lower(email)))%'
  ) THEN
    RAISE EXCEPTION 'idx_invitations_projection_org_email_lower missing or has the wrong expression'
      USING ERRCODE = 'P9099';
  END IF;
END $$;
