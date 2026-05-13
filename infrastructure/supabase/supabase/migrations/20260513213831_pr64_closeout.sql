-- =============================================================================
-- Migration: pr64_closeout
-- Card:      dev/active/reject-cross-provider-invitations/ (PR #64)
-- Architect: closeout for review findings #1, #2, #3, #5 (P2/P3, in-PR fixes)
-- =============================================================================
-- Purpose: address architect review findings on PR #64 with a single migration:
--
--   #1 [P2] Drop `details` from api.check_invitation_acceptance_eligibility's
--           cross-provider block. Internal-org-id disclosure was load-bearing
--           on no UI consumer; server-side log (caller-side) preserves the
--           operator correlation path.
--   #2 [P3] Remove `v_target_is_active` dead variable from
--           api.check_invitation_acceptance_eligibility.
--   #3 [P3] Add `AND u.deleted_at IS NULL` to api.check_user_exists; brings
--           audit + runtime into alignment and tags the function with
--           `@a4c-rpc-shape: read` defensively.
--   #5 [P3] Add inline docblock comment at api.check_invitation_acceptance_eligibility
--           capturing the deliberate provider→provider-only scope and the
--           open policy question for provider→provider_partner.
--
-- Findings #4 (wiring tests) and #6 (doc footer dates + version bump) are
-- non-SQL and ship in the second commit of the closeout.
--
-- All changes are CREATE OR REPLACE (idempotent in shape; both functions
-- already exist in 20260212010625_baseline_v4.sql and
-- 20260513203931_reject_cross_provider_invitations.sql respectively).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- api.check_invitation_acceptance_eligibility — closeout re-emit
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.check_invitation_acceptance_eligibility(
    p_invitee_user_id uuid,
    p_target_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_target_org_type text;
    -- (Finding #2 closeout) Removed `v_target_is_active boolean` — dead code.
    -- Target-org activeness validation is handled by callers (invite-user
    -- via api.get_organization_by_id later in the flow). If a target-org
    -- active check belongs here, that's a deliberate scope expansion.
    --
    -- (Finding #1 closeout downstream) Removed `v_existing_org_id uuid` —
    -- it was the SELECT target for an org_id that was only ever surfaced
    -- in `details.existing_provider_org_id`. With `details` dropped, the
    -- query just needs an existence check (PERFORM ... LIMIT 1; IF FOUND).
BEGIN
    -- Authn enforced via GRANT (authenticated + service_role).
    -- accept-invitation invokes via service_role admin client where auth.uid()
    -- legitimately returns NULL; a runtime auth.uid() IS NULL guard would
    -- break that path. Mirrors api.check_user_invitation_existence precedent.
    --
    -- Threat model (Finding #1 closeout): read-only org-type check. Worst
    -- case if reachable by an unauthorized caller — they learn whether a
    -- known user_id has an active provider role. No org_ids, names, emails,
    -- role names, or role ids are returned. (Prior shape returned
    -- existing_provider_org_id in `details`; removed in PR #64 closeout to
    -- eliminate the lateral-disclosure surface — operator correlation
    -- continues via the server-side log in _shared/check-invitation-eligibility.ts.)

    SELECT type
      INTO v_target_org_type
      FROM public.organizations_projection
     WHERE id = p_target_org_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'eligible', false,
            'error', 'target_org_not_found',
            'message', 'Target organization does not exist.'
        );
    END IF;

    -- Find any ACTIVE native role in a DIFFERENT type='provider' org.
    -- Filters (C4a/b/c per PR #64 pre-merge architect review):
    --   * organization_id IS NOT NULL  -> skip global super_admin rows.
    --   * role_valid_from <= today      -> exclude pre-provisioned future roles.
    --   * role_valid_until IS NULL OR >= today -> exclude expired roles.
    --   * op.is_active = true           -> stale role at deactivated org
    --                                      should not block fresh invite.
    PERFORM 1
      FROM public.user_roles_projection urp
      JOIN public.organizations_projection op ON op.id = urp.organization_id
     WHERE urp.user_id = p_invitee_user_id
       AND urp.organization_id IS NOT NULL
       AND urp.organization_id != p_target_org_id
       AND op.type = 'provider'
       AND op.is_active = true
       AND (urp.role_valid_from IS NULL OR urp.role_valid_from <= CURRENT_DATE)
       AND (urp.role_valid_until IS NULL OR urp.role_valid_until >= CURRENT_DATE)
     LIMIT 1;

    -- Gate scope (Finding #5 closeout): this check covers provider→provider
    -- only. provider→provider_partner direction is silently allowed pending
    -- an explicit policy decision. Per provider-partners-architecture.md,
    -- the cross-tenant model is partner-USER → provider-DATA, mediated by
    -- cross_tenant_access_grants_projection. Whether a user with a primary
    -- type='provider' role may also hold a type='provider_partner' role is
    -- unspecified. If the answer becomes "no", extend this branch to also
    -- fire when v_target_org_type = 'provider_partner' AND the invitee has
    -- any active type='provider' role. No card yet — seed if a stakeholder
    -- request emerges.
    IF FOUND AND v_target_org_type = 'provider' THEN
        RETURN jsonb_build_object(
            'eligible', false,
            'error', 'cross_provider_invitation_blocked',
            'message', 'This user is already a member of another provider organization. '
                    || 'Cross-tenant access between providers requires a cross-tenant access '
                    || 'grant via a partner organization, not a direct invitation.'
            -- (Finding #1 closeout) Removed `details` object that previously
            -- carried existing_provider_org_id + target_provider_org_id.
            -- Operator correlation continues via the server-side log in
            -- _shared/check-invitation-eligibility.ts at the warn path,
            -- which still includes `details: eligibility.details` from the
            -- helper-internal RPC response object.
        );
    END IF;

    RETURN jsonb_build_object('eligible', true);
END;
$$;

-- Defensive re-issue of the shape tag per the DROP+CREATE rule in
-- infrastructure/supabase/CLAUDE.md § RPC Shape Registry. CREATE OR REPLACE
-- preserves the comment on a same-signature function (OID retained), but
-- re-emitting documents the contract change inline and makes the migration
-- self-describing.
COMMENT ON FUNCTION api.check_invitation_acceptance_eligibility(uuid, uuid) IS
$comment$Check whether an invitee may accept (or be issued) an invitation to a target org.

Rejects when the invitee already has an active native role in a different
provider-type org AND the target org is also provider-type. Aligns with
provider-partners-architecture.md: cross-tenant access between providers is
reserved for provider_partner-org users via cross_tenant_access_grants_projection.

Active-role filter:
  organization_id IS NOT NULL  (skip global super_admin)
  role_valid_from IS NULL OR <= today
  role_valid_until IS NULL OR >= today
  existing-role org is_active = true

Response shape (read-shape, no envelope):
  {"eligible": true}                                            -- proceed
  {"eligible": false, "error": "target_org_not_found", ...}     -- HTTP 422
  {"eligible": false, "error": "cross_provider_invitation_blocked"} -- HTTP 403/422

PR #64 closeout: removed `details` object from cross_provider_invitation_blocked
response (Finding #1 — lateral-disclosure of one other-tenant org id with no
UI consumer). Internal correlation continues via server-side log in
_shared/check-invitation-eligibility.ts.

Called from:
- accept-invitation Edge Function (Sally path, after isExistingUser=true)
- invite-user Edge Function (pre-issuance, defense in depth)

@a4c-rpc-shape: read$comment$;

-- -----------------------------------------------------------------------------
-- api.check_user_exists — closeout re-emit with deleted_at filter
-- -----------------------------------------------------------------------------
-- Finding #3: original baseline (20260212010625_baseline_v4.sql:572-583) did
-- NOT filter `deleted_at IS NULL`. The runtime check via this function in
-- invite-user (and the frontend smart-email-lookup) implicitly relied on
-- handle_user_deleted nuking user_roles_projection rows. Tightening the
-- function aligns it with the pre-deploy audit at
-- 20260513203931_reject_cross_provider_invitations.sql:185-187, which
-- correctly filters `deleted_at IS NULL`. Single source of truth.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.check_user_exists(p_email text)
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id AS user_id, u.email
    FROM public.users u
   WHERE u.email = p_email
     AND u.deleted_at IS NULL   -- PR #64 finding #3: align with audit query at
                                -- 20260513203931_reject_cross_provider_invitations.sql:185-187
                                -- and prevent false-positive cross-provider blocks for
                                -- formerly-deleted users.
   LIMIT 1;
END;
$$;

COMMENT ON FUNCTION api.check_user_exists(text) IS
$comment$Check if a user with the given email exists anywhere in the system.

Filters out soft-deleted users (deleted_at IS NOT NULL) so callers do not
treat tombstoned rows as live identities. See PR #64 finding #3.

Consumers:
- invite-user Edge Function (checkEmailStatus smart-email-lookup)
- frontend SupabaseUserQueryService.checkUserExists (UI smart-email-lookup)

@a4c-rpc-shape: read$comment$;
