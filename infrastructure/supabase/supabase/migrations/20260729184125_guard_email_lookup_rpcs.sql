-- ============================================================================
-- Tenancy-guard the two org-scoped email-lookup RPCs
-- ============================================================================
--
-- WHY NOW
--
-- api.check_user_org_membership and api.check_pending_invitation are
-- SECURITY DEFINER with no permission check and no tenancy guard: they take
-- p_email and p_org_id at face value and answer for ANY pair. The baseline
-- grants USAGE ON SCHEMA api to authenticated (baseline_v4:16091-16093) and
-- never REVOKEs EXECUTE from PUBLIC on these three (it emits exactly one such
-- REVOKE in the whole file, :16611, for custom_access_token_hook), so PUBLIC
-- retains EXECUTE and any authenticated user can call them.
--
-- This is already catalogued as a pending Phase 4 item —
-- documentation/architecture/authorization/cross-tenant-access-grant-rpc-reachability-matrix.md
-- §"Phase 4 sub-audit note: definer-bypasses-RLS cluster" names
-- check_user_org_membership an "unauthenticated org-membership probe; any
-- caller can check any user/org pair".
--
-- The hole is latent today because only the invite-user Edge Function (service
-- role) calls them. The frontend email-status lookup is about to call them from
-- the browser, which would turn it into a live, discoverable membership- and
-- invitation-enumeration oracle — three parameterized probes per blur, no rate
-- limit, on a behavioural-health platform. Guarding first, wiring after.
--
-- VERIFIED AGAINST THE DEPLOYED DEV DATABASE (2026-07-29), not merely inferred:
--
--   proname                    | authenticated_exec | anon_exec | has_read_tag
--   ---------------------------+--------------------+-----------+-------------
--   check_user_org_membership  | t                  | t         | t
--   check_pending_invitation   | t                  | t         | t
--   check_user_exists          | t                  | t         | t
--
-- Note `anon_exec` — the probes are reachable WITHOUT AUTHENTICATION AT ALL,
-- which is broader than the matrix note implies. That single fact settles the
-- guard's shape: it must deny-unless-allowed (fail closed).
--
-- Specifically, it rules out the tempting inversion "only deny a positively
-- identified user who is not a member". public.get_current_user_id() returns
-- NULL whenever there is no JWT `sub` — which is true for anon AND for
-- service_role alike — so that form would exempt the very caller we are
-- guarding against. Deny-by-default plus an explicit service_role carve-out is
-- the only shape that closes anon while keeping the Edge Function working.
--
-- SCOPE
--
--   * check_user_org_membership  — guarded (org-scoped)
--   * check_pending_invitation   — guarded (org-scoped)
--   * check_user_exists          — DELIBERATELY UNTOUCHED. It is Bucket E
--     [pre-auth] by design (matrix :90, :117): the signup / accept-invitation
--     flow calls it before a session exists. It takes no p_org_id, so there is
--     no tenancy predicate to apply. Narrowing it is a separate decision with a
--     separate blast radius.
--
-- GUARD SHAPE
--
-- Model M, copied from the canonical exemplar at
-- 20260622183824_phase_3_list_users_membership_guard.sql:62-71 (api.list_users).
-- Note what it is NOT: `p_org_id = get_current_org_id()`. That form was
-- explicitly REPLACED by the exemplar because it rejects grant-bearers, whose
-- JWT org_id stays at their home org while the granted org appears only in
-- users.accessible_organizations. Using the session-org form here would
-- silently break cross-tenant consultants.
--
-- RETURN-empty rather than RAISE: Bucket A semantics. A denied caller is
-- indistinguishable from "no such membership / no such invitation", so the
-- guard itself leaks no existence information.
--
-- THE service_role EXEMPTION IS LOAD-BEARING — DO NOT REMOVE
--
-- invite-user/index.ts:1002 calls these via the service-role client
-- (checkEmailStatus(supabaseAdmin, ...)). Under service_role there is no
-- effective_permissions claim, so has_platform_privilege() is false, and
-- get_current_user_id() is NULL, so the membership EXISTS is false. Without the
-- exemption both probes would return empty for the Edge Function, it would
-- classify every address as `not_found`, and it would mint fresh invitations
-- for existing active members — a materially worse regression than the
-- enumeration hole this migration closes.
--
-- Two independent detections are OR'd because a false negative here is a
-- production outage: the `role` GUC (precedent: baseline_v4:15914) and the
-- PostgREST-injected JWT claim.
--
-- The JWT-claims read is deliberately written defensively —
-- COALESCE(NULLIF(..., ''), '{}')::jsonb rather than a bare ::jsonb cast. A
-- bare cast raises invalid_text_representation if the GUC is ever the empty
-- string, and these two functions sit on the invite path: a throw here would
-- surface as a 503 from invite-user rather than a denial. (has_platform_privilege
-- at baseline_v4:9957 uses the bare cast and has not blown up, so '' does not
-- occur in practice — but this guard is not the place to depend on that.)
--
-- NOT VERIFIABLE FROM HERE: the service_role branch itself. The Management API
-- executes as `postgres` with role GUC 'none' and no request.jwt.claims, so it
-- cannot exercise the PostgREST service-role path, and no service-role key is
-- available in this environment. Both detections are standard Supabase
-- behaviour with in-repo precedent, but the first real post-apply check should
-- be an invite-user call — see the probe list in the PR description.
--
-- BODIES
--
-- Reproduced verbatim from baseline_v4.sql:548-565 and :593-608 with ONLY the
-- guard block inserted. No later migration redefines either function (grep for
-- `FUNCTION api.check_user_org_membership` / `check_pending_invitation` across
-- migrations/ returns baseline only; check_user_exists was re-emitted once, by
-- 20260513213831_pr64_closeout.sql:177, and is not touched here).
--
-- PRE-PUSH REQUIREMENT (codified pitfall 6): before applying, fetch each
-- deployed body via the Management API and diff against the below, to confirm
-- no out-of-band drift has added semantics this file would silently drop:
--
--   SELECT pg_get_functiondef('api.check_user_org_membership(text,uuid)'::regprocedure);
--   SELECT pg_get_functiondef('api.check_pending_invitation(text,uuid)'::regprocedure);
--
-- COMMENTS / M3 SHAPE REGISTRY
--
-- Deliberately NOT re-issuing COMMENT ON. The `@a4c-rpc-shape: read` tags were
-- applied by the runtime backfill DO-block in 20260430172625, which APPENDS to
-- whatever comment is deployed — so the live comment text is not fully knowable
-- from this repo. CREATE OR REPLACE with an unchanged signature preserves the
-- OID and therefore the comment, so the tags survive. The assertion at the
-- bottom fails loud if that assumption is ever wrong.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. api.check_user_org_membership
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.check_user_org_membership(p_email text, p_org_id uuid)
RETURNS TABLE(user_id uuid, is_active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  -- Tenancy guard (see header). Alias the table: this function RETURNS
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
  WHERE u.email = p_email
    AND urp.organization_id = p_org_id
  LIMIT 1;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. api.check_pending_invitation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.check_pending_invitation(p_email text, p_org_id uuid)
RETURNS TABLE(id uuid, email text, expires_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  -- Tenancy guard (see header). The `caller` alias is REQUIRED here, not
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
  WHERE ip.email = p_email
    AND ip.organization_id = p_org_id
    AND ip.status = 'pending'
  ORDER BY ip.created_at DESC
  LIMIT 1;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Assertions
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
  v_comment text;
  v_missing text[] := '{}';
BEGIN
  -- (a) The M3 shape tags must have survived CREATE OR REPLACE. If this fires,
  --     the OID-preservation assumption in the header is wrong and the
  --     rpc-registry-sync CI check would fail on the next run.
  --     NB: \y, not \b — PG ARE's \b silently fails at end-of-input on hosted
  --     Supabase (codified pitfall 1).
  FOREACH v_fn IN ARRAY ARRAY[
    'api.check_user_org_membership(text,uuid)',
    'api.check_pending_invitation(text,uuid)'
  ] LOOP
    SELECT obj_description(v_fn::regprocedure, 'pg_proc') INTO v_comment;
    IF v_comment IS NULL OR v_comment !~ '@a4c-rpc-shape:\s*read\y' THEN
      v_missing := array_append(v_missing, v_fn);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'M3 shape tag lost on CREATE OR REPLACE for: % — re-issue COMMENT ON FUNCTION ... ''@a4c-rpc-shape: read''', v_missing
      USING ERRCODE = 'P9099';
  END IF;

  -- (b) The guard references public.users.accessible_organizations, the
  --     canonical membership oracle. Fail loud if that column ever moves,
  --     rather than letting the guard silently deny every caller.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'accessible_organizations'
  ) THEN
    RAISE EXCEPTION 'public.users.accessible_organizations missing — tenancy guard would deny all callers'
      USING ERRCODE = 'P9099';
  END IF;
END $$;
