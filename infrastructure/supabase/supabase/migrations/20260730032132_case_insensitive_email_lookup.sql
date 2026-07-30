-- ============================================================================
-- Case-insensitive email comparison in the three lookup RPCs
-- ============================================================================
--
-- WHY
--
-- All three lookup RPCs compare with bare equality — `WHERE u.email = p_email`.
-- Nothing in this codebase normalizes email case on write, so if `users.email`
-- holds `Bob@Org.com` and an admin types `bob@org.com`, every probe returns empty
-- and the invite form renders the confident blue panel:
--
--     "New user - complete the form to send an invitation."
--
-- ...for someone who is already an active member. That is precisely what the
-- service contract forbids (SupabaseUserQueryService.checkEmailStatus JSDoc:
-- "It must NOT return not_found, which the UI renders as a confident 'new user,
-- go ahead and invite'"). PR A honoured it for infrastructure failures; this
-- closes the same hole on the input path.
--
-- PR B (#105) fixed the WHITESPACE half client-side (`UserFormViewModel.lookupKey`
-- trims). It deliberately did NOT lowercase, because with bare `=` a client-side
-- `toLowerCase()` would CREATE the mirror-image bug for any mixed-case stored
-- address. Case has to be fixed here, where it holds regardless of what is stored.
--
-- INVESTIGATED BEFORE WRITING THIS (dev project, 2026-07-30)
--
--   public.users               14 rows, 0 mixed-case
--   invitations_projection     18 rows, 0 mixed-case
--
-- All-lowercase today — but **nothing enforces it**: no `lower(email)` CHECK on
-- either table, and only 11 of 14 `public.users` rows match `auth.users.email`
-- exactly, so Supabase Auth's own normalization is not reliably propagating into
-- the projection. The property is incidental, which is exactly why this belongs in
-- SQL rather than in a client-side `toLowerCase()`.
--
-- INDEXES — THE PART THAT IS NOT FREE
--
-- `lower(email)` does NOT use a plain btree index on `email`. Both existing
-- indexes are exactly that:
--
--   users                    idx_users_email                      btree (email)
--   invitations_projection   idx_invitations_projection_org_email btree (organization_id, email)
--
-- and these probes now run on EVERY blur of the invite form's email field. Without
-- matching functional indexes this migration would trade a correctness bug for a
-- seq-scan-per-keystroke-pause. Both are added below, mirroring the existing shapes
-- (including the leading `organization_id` on the invitations one).
--
-- The existing btree indexes are RETAINED — other call sites still do exact-match
-- lookups on these columns, and dropping them is a separate decision.
--
-- Plain `CREATE INDEX` (not CONCURRENTLY): the Supabase CLI runs each migration in
-- a transaction, and CONCURRENTLY cannot run inside one. Both tables are small
-- (14/18 rows), so the lock is momentary. On a grown table this would want a
-- separate out-of-transaction step.
--
-- PARAMETER SIDE
--
-- `lower(btrim(p_email))` — trims as well as lowercases, so non-frontend callers
-- get the same protection. The invite-user Edge Function passes whatever it
-- received; only the frontend trims client-side. The column side is `lower(email)`
-- alone so it matches the functional index expression exactly.
--
-- PITFALL 6 — deployed bodies were fetched and diffed before writing this
--
-- Every load-bearing semantic below is preserved verbatim from
-- `pg_get_functiondef` output taken 2026-07-30:
--
--   * check_user_org_membership / check_pending_invitation — the FULL tenancy guard
--     from 20260729184125, including BOTH service_role detections (the `role` GUC
--     and the defensively-cast JWT claim), has_platform_privilege(), the
--     accessible_organizations membership EXISTS, the `caller` alias (42702), and
--     RETURN-empty Bucket A semantics.
--     ⚠️ The service_role exemption is load-bearing: invite-user calls these with
--     the service client, which has no effective_permissions and no JWT sub. Drop
--     it and the Edge Function classifies every address not_found and mints
--     invitations for active members.
--   * check_user_exists — `AND u.deleted_at IS NULL` (PR #64 finding #3), which
--     prevents false-positive cross-provider blocks for formerly-deleted users.
--     This function is deliberately UNGUARDED (Bucket E [pre-auth]) and stays so.
--
-- No signature changes, so `COMMENT ON FUNCTION` (and the `@a4c-rpc-shape: read`
-- tags applied by the 20260430172625 backfill) survive via OID preservation. The
-- assertion block at the bottom verifies that rather than assuming it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Functional indexes FIRST — so the replaced functions never run unindexed
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_email_lower
  ON public.users (lower(email));

CREATE INDEX IF NOT EXISTS idx_invitations_projection_org_email_lower
  ON public.invitations_projection (organization_id, lower(email));

-- ----------------------------------------------------------------------------
-- 2. api.check_user_org_membership — guard verbatim, comparison case-insensitive
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.check_user_org_membership(p_email text, p_org_id uuid)
RETURNS TABLE(user_id uuid, is_active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- Tenancy guard (20260729184125). Alias the table: this function RETURNS
  -- TABLE(user_id uuid, ...), so an unqualified column reference inside the
  -- EXISTS risks ambiguity with an OUT parameter (SQLSTATE 42702).
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
  -- lower() on both sides; the column side matches idx_users_email_lower exactly.
  WHERE lower(u.email) = lower(btrim(p_email))
    AND urp.organization_id = p_org_id
  LIMIT 1;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. api.check_pending_invitation — same treatment
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.check_pending_invitation(p_email text, p_org_id uuid)
RETURNS TABLE(id uuid, email text, expires_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- Tenancy guard (20260729184125). The `caller` alias is REQUIRED here, not
  -- stylistic: this function's OUT parameters include `id`, so an unqualified
  -- `id` in the EXISTS resolves ambiguously (SQLSTATE 42702).
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
  -- Column side is lower(ip.email) with organization_id leading, matching
  -- idx_invitations_projection_org_email_lower.
  WHERE ip.organization_id = p_org_id
    AND lower(ip.email) = lower(btrim(p_email))
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
   WHERE lower(u.email) = lower(btrim(p_email))
     AND u.deleted_at IS NULL   -- PR #64 finding #3: align with audit query at
                                -- 20260513203931_reject_cross_provider_invitations.sql:185-187
                                -- and prevent false-positive cross-provider blocks for
                                -- formerly-deleted users.
   LIMIT 1;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. Assertions
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
  v_comment text;
  v_def text;
  v_missing_tag text[] := '{}';
  v_missing_guard text[] := '{}';
BEGIN
  -- (a) M3 shape tags must survive CREATE OR REPLACE (OID preserved). If this
  --     fires, rpc-registry-sync CI would fail on the next run.
  --     NB: \y not \b — PG ARE's \b silently fails at end-of-input on hosted
  --     Supabase (codified pitfall 1).
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

  -- (b) The tenancy guard must still be present on the two org-scoped functions.
  --     This is the highest-consequence thing a careless CREATE OR REPLACE could
  --     drop: without it they revert to anon-callable membership probes.
  FOREACH v_fn IN ARRAY ARRAY[
    'api.check_user_org_membership(text,uuid)',
    'api.check_pending_invitation(text,uuid)'
  ] LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF v_def !~ 'accessible_organizations' OR v_def !~ 'service_role' THEN
      v_missing_guard := array_append(v_missing_guard, v_fn);
    END IF;
  END LOOP;

  IF array_length(v_missing_guard, 1) > 0 THEN
    RAISE EXCEPTION 'Tenancy guard or service_role exemption missing after replace: %', v_missing_guard
      USING ERRCODE = 'P9099';
  END IF;

  -- (c) check_user_exists must NOT have gained a guard — it is Bucket E [pre-auth]
  --     and the signup / accept-invitation flow depends on it being open.
  v_def := pg_get_functiondef('api.check_user_exists(text)'::regprocedure);
  IF v_def ~ 'accessible_organizations' THEN
    RAISE EXCEPTION 'check_user_exists must remain unguarded (Bucket E [pre-auth])'
      USING ERRCODE = 'P9099';
  END IF;
  IF v_def !~ 'deleted_at IS NULL' THEN
    RAISE EXCEPTION 'check_user_exists lost its deleted_at filter (PR #64 finding #3)'
      USING ERRCODE = 'P9099';
  END IF;

  -- (d) The functional indexes the new comparisons depend on must exist, or every
  --     probe becomes a seq scan on a per-blur code path.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_users_email_lower') THEN
    RAISE EXCEPTION 'idx_users_email_lower missing — lower(email) probes would seq scan'
      USING ERRCODE = 'P9099';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_invitations_projection_org_email_lower') THEN
    RAISE EXCEPTION 'idx_invitations_projection_org_email_lower missing — lower(email) probes would seq scan'
      USING ERRCODE = 'P9099';
  END IF;
END $$;
