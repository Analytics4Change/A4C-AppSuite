-- =============================================================================
-- Migration: reject_cross_provider_invitations
-- Card:      dev/active/reject-cross-provider-invitations/
-- Architect: reviewed 2026-05-13 (see plan.md § ARCHITECT VERDICT)
-- =============================================================================
-- Purpose:
--   1. Introduce api.check_invitation_acceptance_eligibility(uuid, uuid) — a
--      read-shape SQL RPC that closes the architectural drift identified in
--      PR #63 UAT Test 5. Provider→provider Sally invitations currently emit
--      user.role.assigned with no eligibility check, creating native multi-
--      tenant role rows. Per provider-partners-architecture.md, cross-tenant
--      access between provider orgs is reserved for users whose home org is
--      type='provider_partner', mediated by cross_tenant_access_grants_projection.
--
--   2. Run a NOTICE-only pre-deploy audit listing pending invitations the new
--      gate WOULD reject. Operators triage these case-by-case before the
--      gate is deployed; the migration itself does NOT auto-revoke them.
--
--   3. Run a NOTICE-only diagnostic listing other users currently in a
--      cross-provider native-role state (multi-row user_roles_projection
--      across multiple type='provider' orgs). No auto-cleanup beyond
--      dakaratekid; operators triage these case-by-case.
--
--   4. One-off cleanup: emit user.role.revoked for dakaratekid@gmail.com's
--      Cypress Admin @ testorg-20260329 role (the known victim of the drift).
--      handle_user_role_revoked drops the user_roles_projection row and
--      removes 'Cypress Admin' from users.roles[]. Restores her to single-
--      org liveforlife state.
--
-- Contract (Design-by-Contract):
--   See `dev/active/reject-cross-provider-invitations/plan.md` for the full
--   pre/post/invariant spec on api.check_invitation_acceptance_eligibility.
--
-- Architect must-fix items addressed:
--   C1: NO auth.uid() runtime guard — accept-invitation calls via service_role
--       admin client; auth.uid() legitimately returns NULL. GRANT to BOTH
--       authenticated AND service_role for authn.
--   C4a: WHERE urp.organization_id IS NOT NULL — skip global super_admin rows.
--   C4b: AND (role_valid_from IS NULL OR <= CURRENT_DATE) — exclude future-dated.
--   C4c: AND op.is_active = true — exclude stale roles at deactivated orgs.
--   C5: Cleanup DO block idempotency invariant documented (depends on
--       handle_user_role_revoked deleting the projection row).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- api.check_invitation_acceptance_eligibility — read-shape eligibility check
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
    v_target_is_active boolean;
    v_existing_org_id uuid;
BEGIN
    -- Authn enforced via GRANT (authenticated + service_role).
    -- accept-invitation invokes via service_role admin client where auth.uid()
    -- legitimately returns NULL; a runtime auth.uid() IS NULL guard would
    -- break that path. Mirrors api.check_user_invitation_existence precedent.
    --
    -- Threat model: read-only org-type check. Worst case if reachable by an
    -- unauthorized caller — they learn whether a known user_id has an active
    -- provider role and (on block) one provider org_id. No PII (no names,
    -- emails, role names, role ids) is returned.

    SELECT type, is_active
      INTO v_target_org_type, v_target_is_active
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
    -- Filters (C4a/b/c per architect review):
    --   * organization_id IS NOT NULL  -> skip global super_admin rows.
    --   * role_valid_from <= today      -> exclude pre-provisioned future roles.
    --   * role_valid_until IS NULL OR >= today -> exclude expired roles.
    --   * op.is_active = true           -> stale role at deactivated org
    --                                      should not block fresh invite.
    SELECT urp.organization_id
      INTO v_existing_org_id
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

    IF FOUND AND v_target_org_type = 'provider' THEN
        RETURN jsonb_build_object(
            'eligible', false,
            'error', 'cross_provider_invitation_blocked',
            'message', 'This user is already a member of another provider organization. '
                    || 'Cross-tenant access between providers requires a cross-tenant access '
                    || 'grant via a partner organization, not a direct invitation.',
            'details', jsonb_build_object(
                'existing_provider_org_id', v_existing_org_id,
                'target_provider_org_id', p_target_org_id
            )
        );
    END IF;

    RETURN jsonb_build_object('eligible', true);
END;
$$;

-- authenticated: callable from invite-user (user-initiated, has JWT subject).
-- service_role: REQUIRED -- accept-invitation invokes via admin client
--               (no JWT subject during OAuth/SSO accept flow).
GRANT EXECUTE ON FUNCTION api.check_invitation_acceptance_eligibility(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api.check_invitation_acceptance_eligibility(uuid, uuid) TO service_role;

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
  {"eligible": false, "error": "cross_provider_invitation_blocked",
                      "details": {...}}                           -- HTTP 403/422

Called from:
- accept-invitation Edge Function (Sally path, after isExistingUser=true)
- invite-user Edge Function (pre-issuance, defense in depth)

@a4c-rpc-shape: read$comment$;

-- -----------------------------------------------------------------------------
-- Pre-deploy audit: pending invitations the new gate WOULD reject
-- -----------------------------------------------------------------------------
-- NOTICE-only. Operators capture this output and decide per-row whether to
-- revoke the pending invitation, contact the inviter, etc. The migration
-- itself does NOT auto-revoke (heavier surgery deferred per ARCHITECT NOTE
-- on in-flight token risk).
-- -----------------------------------------------------------------------------

DO $$
DECLARE
    v_rec record;
    v_count int := 0;
BEGIN
    RAISE NOTICE '--- Pre-deploy audit: pending invitations the new gate WOULD reject ---';
    FOR v_rec IN
        SELECT
            i.id              AS invitation_id,
            i.email           AS invitee_email,
            i.organization_id AS target_org_id,
            ot.name           AS target_org_name,
            u.id              AS invitee_user_id,
            uo.id             AS existing_provider_org_id,
            uo.name           AS existing_provider_org_name
          FROM public.invitations_projection i
          JOIN public.organizations_projection ot
            ON ot.id = i.organization_id
           AND ot.type = 'provider'
          JOIN public.users u
            ON LOWER(u.email) = LOWER(i.email)
           AND u.deleted_at IS NULL
          JOIN public.user_roles_projection urp
            ON urp.user_id = u.id
           AND urp.organization_id IS NOT NULL
           AND urp.organization_id != i.organization_id
           AND (urp.role_valid_from IS NULL OR urp.role_valid_from <= CURRENT_DATE)
           AND (urp.role_valid_until IS NULL OR urp.role_valid_until >= CURRENT_DATE)
          JOIN public.organizations_projection uo
            ON uo.id = urp.organization_id
           AND uo.type = 'provider'
           AND uo.is_active = true
         WHERE i.status = 'pending'
           AND i.expires_at > NOW()
    LOOP
        v_count := v_count + 1;
        RAISE NOTICE '  invitation=% email=% target=%(%) blocked_by_existing=%(%)',
            v_rec.invitation_id,
            v_rec.invitee_email,
            v_rec.target_org_name, v_rec.target_org_id,
            v_rec.existing_provider_org_name, v_rec.existing_provider_org_id;
    END LOOP;
    RAISE NOTICE 'Pre-deploy audit complete: % pending invitation(s) would now be rejected.', v_count;
END $$;

-- -----------------------------------------------------------------------------
-- Diagnostic audit: other users in cross-provider drift state
-- -----------------------------------------------------------------------------
-- NOTICE-only. Lists users with active roles in 2+ distinct type='provider'
-- orgs (the dakaratekid pattern). No auto-cleanup; operators triage.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
    v_rec record;
    v_count int := 0;
BEGIN
    RAISE NOTICE '--- Diagnostic audit: users with native roles across multiple type=''provider'' orgs ---';
    FOR v_rec IN
        SELECT
            u.id    AS user_id,
            u.email AS user_email,
            COUNT(DISTINCT urp.organization_id) AS provider_org_count,
            array_agg(DISTINCT op.name)         AS provider_org_names
          FROM public.users u
          JOIN public.user_roles_projection urp
            ON urp.user_id = u.id
           AND urp.organization_id IS NOT NULL
           AND (urp.role_valid_from IS NULL OR urp.role_valid_from <= CURRENT_DATE)
           AND (urp.role_valid_until IS NULL OR urp.role_valid_until >= CURRENT_DATE)
          JOIN public.organizations_projection op
            ON op.id = urp.organization_id
           AND op.type = 'provider'
           AND op.is_active = true
         WHERE u.deleted_at IS NULL
         GROUP BY u.id, u.email
        HAVING COUNT(DISTINCT urp.organization_id) > 1
    LOOP
        v_count := v_count + 1;
        RAISE NOTICE '  user=% email=% provider_org_count=% orgs=%',
            v_rec.user_id,
            v_rec.user_email,
            v_rec.provider_org_count,
            v_rec.provider_org_names;
    END LOOP;
    RAISE NOTICE 'Diagnostic audit complete: % user(s) with cross-provider native-role state.', v_count;
END $$;

-- -----------------------------------------------------------------------------
-- One-off cleanup: dakaratekid revoke
-- -----------------------------------------------------------------------------
-- Idempotency invariant (ARCHITECT NOTE C5):
--   IF FOUND on user_roles_projection works because handle_user_role_revoked
--   DELETES the projection row on successful emit. Rerun: row already absent
--   -> NOT FOUND -> no-op. If handle_user_role_revoked semantics ever change
--   to soft-revoke (mark revoked_at without delete), THIS BLOCK MUST BE
--   REWRITTEN to check a revoked-marker column instead of NOT FOUND.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
    v_user_id uuid := 'bab8077f-6a76-46f4-a0cd-9363bbf313fb';  -- dakaratekid@gmail.com
    v_org_id  uuid := '2d0829ae-224b-4a79-ac3a-726b00d6c172';  -- testorg-20260329
    v_role_id uuid;
BEGIN
    SELECT role_id
      INTO v_role_id
      FROM public.user_roles_projection
     WHERE user_id = v_user_id
       AND organization_id = v_org_id;

    IF FOUND THEN
        PERFORM api.emit_domain_event(
            p_stream_id      := v_user_id,
            p_stream_type    := 'user',
            p_event_type     := 'user.role.revoked',
            p_event_data     := jsonb_build_object(
                'role_id', v_role_id,
                'org_id',  v_org_id
            ),
            p_event_metadata := jsonb_build_object(
                'reason',    'One-off cleanup: dakaratekid was accidentally cross-invited to '
                          || 'testorg-20260329 (both type=provider). Per '
                          || 'provider-partners-architecture.md, cross-provider invitations '
                          || 'are forbidden. See card reject-cross-provider-invitations.',
                'source',    'migration_reject_cross_provider_invitations',
                'automated', true
            )
        );
        RAISE NOTICE 'Revoked accidental cross-provider role: user=% org=% role=%',
            v_user_id, v_org_id, v_role_id;
    ELSE
        RAISE NOTICE 'No cleanup needed: dakaratekid has no role in testorg-20260329 (already cleaned up or never landed).';
    END IF;
END $$;
