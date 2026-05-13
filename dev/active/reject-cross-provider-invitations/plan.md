# Plan: Reject cross-provider invitations in accept-invitation

**Status**: planned (architect-reviewed 2026-05-13, see ARCHITECT NOTES inline)
**Priority**: Medium-High
**Origin**: PR #63 UAT Test 5 follow-up; investigation 2026-05-13
**Supersedes**: `dev/active/fix-handle-user-role-assigned-update-accessible-organizations-seed.md`

## ARCHITECT VERDICT 2026-05-13

**Direction is sound.** The card correctly identifies that the missing boundary check at `accept-invitation` is the architectural defect to close, and that the symptomatic-fix path (denormalization rebuild on `handle_user_role_assigned`) treats a leaf, not a root. Decision to scope to Class 1 boundary repair only (no grant pipeline build) is the right tradeoff for the risk/reward of this PR.

**Five contract gaps must be addressed before any code is written.** Each is flagged inline in the relevant section with `**ARCHITECT NOTE 2026-05-13**:` markers. Summary of the must-fix list:

1. **(C1) `auth.uid() IS NULL` precondition is wrong** — accept-invitation calls Edge Function helpers with the **service_role** client (no JWT subject). `auth.uid()` returns NULL in that context, which is *not* an authn failure. Mirror the existing `api.check_user_invitation_existence` precedent (PR #63 baseline at `infrastructure/supabase/supabase/migrations/20260512194836_deactivate_user_rpc_and_check_user_invitation_existence.sql:228-277`): GRANT to BOTH `authenticated` and `service_role`, drop the auth.uid() guard, and document the threat model (this is a read-only eligibility check; SECURITY DEFINER caller is always service_role from EF or the calling user's own session — no PII leak risk).
2. **(C2) Wrong Edge Function name for the second gate** — the invite-creation operation lives in **`invite-user/`** (`infrastructure/supabase/supabase/functions/invite-user/index.ts`), NOT `manage-user/`. `manage-user` handles update/deactivate/role-modify; it does not emit `user.invited`. The plan's gate placement description has the wrong target. Verified via `grep "user.invited" supabase/functions/`. Update tasks.md accordingly.
3. **(C3) Organization type enum mismatch with the cited doc** — `documentation/architecture/data/provider-partners-architecture.md` uses `type='partner'` (legacy/incorrect) but the live CHECK constraint at `baseline_v4.sql:13111` allows `('platform_owner', 'provider', 'provider_partner')`. The plan's RPC correctly filters on `type = 'provider'`, but the doc fix scope must expand: not just enum-value renames for `authorization_type`, but also `type='partner'` → `type='provider_partner'` throughout the doc. The plan's doc-fix bullet is too narrow.
4. **(C4) Eligibility check has three semantic blind spots**:
   - **(C4a) Global super_admin rows** with `organization_id IS NULL` (per `handle_user_role_assigned`:9544 — sets `v_org_id := NULL` when event_data.org_id is `*` or platform_org). The plan's INNER JOIN `op ON op.id = urp.organization_id` silently drops them. Fix: explicit handling of NULL — either `WHERE urp.organization_id IS NOT NULL AND ...` (correct because super_admin shouldn't gate cross-tenant invites) or document the semantics in the function comment.
   - **(C4b) `role_valid_from`** is not filtered. A future-dated role assignment (admin pre-provisioning a role starting next month) currently counts as "active in another provider". Add: `AND (urp.role_valid_from IS NULL OR urp.role_valid_from <= CURRENT_DATE)`.
   - **(C4c) `op.is_active`** is not checked. The existing `validate_cross_tenant_access` function (baseline_v4.sql:12092) joins on `is_active = true`. A deactivated provider org should not block an invite. Add: `AND op.is_active = true`.
5. **(C5) Idempotency framing on the cleanup DO block is implicit** — `IF FOUND` after a `SELECT … LIMIT 1` is effectively idempotent (rerun: row already revoked → not found → no-op), but the architecturally correct phrasing is "the cleanup is convergent under re-run because `handle_user_role_revoked` deletes the projection row". Add an explicit precondition assertion: `SELECT … FROM user_roles_projection WHERE … AND <not-already-revoked-marker>`. Since revoke deletes the row, this collapses to the existing query — but the docblock should state the invariant.

**Two non-blocking improvements** (apply if cheap, defer otherwise — flagged as `**ARCHITECT NOTE (optional)**:`):

- Read-shape return contract is **fine as `{eligible, error?, message?, details?}`** but slightly less consistent with PR #63's `{isExistingUser, isDeleted}` boolean-pair precedent. Consider whether the Edge Function caller actually needs the `details.existing_provider_org_id` UUID in the response — if it just logs and surfaces a generic 422 message, the UUID adds PII surface for no caller benefit. Keep the details object only if the UI actually displays the existing-org name (which requires a follow-up query anyway).
- Doc home for the boundary-repair note: prefer the **Edge Function docblock** at top of `accept-invitation/index.ts` and `invite-user/index.ts` (wire-tier concern, lives with the code). Add a short cross-reference in `infrastructure/supabase/CLAUDE.md` rather than a full subsection — the canonical statement should be next to the code that enforces it.

**Proceed with the plan as edited below.** No fundamental redesign needed.

## TL;DR

Provider→provider Sally invitations silently emit `user.role.assigned` and create native multi-tenant role rows. This violates the original architectural intent (`documentation/architecture/data/provider-partners-architecture.md`): cross-tenant access between provider orgs is reserved for users whose home org is `type='provider_partner'`, and is mediated by `cross_tenant_access_grants_projection` — NOT by native role assignment.

This card adds a boundary gate in `accept-invitation` (and `manage-user` invite-creation, defense-in-depth) that rejects provider→provider Sally invitations and cleans up the one known accidental cross-tenant native role (dakaratekid@gmail.com in testorg-20260329).

This card does **NOT**:
- Build the cross-tenant grant producer pipeline → `dev/active/sub-tenant-admin-design/`
- Fix the `accessible_organizations` denormalization → symptomatic; if the gate ships, the bad case stops happening
- Root-cause the routing-to-a4c symptom → seeded as a separate follow-up card

## Investigation findings (verified 2026-05-13 via Management API SQL)

| Item | Result |
|---|---|
| Live for Life | `type='provider'`, `partner_type=NULL`, subdomain `liveforlife` (verified) |
| TestOrg-20260329 | `type='provider'`, `partner_type=NULL`, subdomain `testorg-20260329` (verified) |
| dakaratekid `current_organization_id` | liveforlife UUID |
| dakaratekid `accessible_organizations` | `[liveforlife]` only |
| dakaratekid `user_roles_projection` rows | 2: `Aspen Program Manager @ liveforlife`, `Cypress Admin @ testorg-20260329` |
| dakaratekid `user_organizations_projection` rows | 1: liveforlife only |

**Both orgs are `provider` type. Neither is `provider_partner`.** Per original intent, this invitation should have been rejected at the boundary.

**Drift**: `accept-invitation`'s Sally path (existing user) emits `user.role.assigned` for any cross-org invitation, with no check on invitee's home-org type or whether the cross-org direction is provider→provider. The grant infrastructure (`cross_tenant_access_grants_projection` + `process_access_grant_event` router) exists in baseline_v4 but no producer flow fires the events and no RLS policy on provider data consults the projection, so the grant pathway is architecturally aspirational today.

**Routing symptom is a separate bug**: dakaratekid's JWT will carry `org_id=liveforlife` (her `current_organization_id`), and liveforlife's subdomain is verified. The `AuthCallback.tsx` Priority-2 redirect should have sent her to `liveforlife.firstovertheline.com/dashboard`. The fact that she landed on `a4c.firstovertheline.com/clients` (Priority-3 default on the platform host) means Priority-2 silently fell through — likely an RPC denial or thrown exception in `getOrganizationSubdomainInfo`. `accessible_organizations` is NOT on the routing read path. Seed a follow-up card to investigate.

## Architecture

### New SQL RPC: `api.check_invitation_acceptance_eligibility`

**Contract (Design-by-Contract)**:

- **Preconditions**:
  - `p_invitee_user_id` is non-NULL (caller guarantees from invitation row).
  - `p_target_org_id` is non-NULL (caller guarantees from invitation row).
  - Caller is `authenticated` OR `service_role` (GRANT-enforced; **no** `auth.uid()` runtime guard — see ARCHITECT NOTE C1 below).
  - Function is invoked AFTER existence check (`api.check_user_invitation_existence`) confirms `isExistingUser = true`. Brand-new invitees skip the eligibility call entirely.
- **Postconditions**:
  - Returns a jsonb object. Two-shape contract:
    - On eligible: `{"eligible": true}` (no other keys).
    - On blocked: `{"eligible": false, "error": "<machine_code>", "message": "<human_text>", "details"?: {...}}`.
  - Function is pure read; no events emitted, no projections modified, no auth.* mutation.
- **Invariants**:
  - Does NOT consult `invitations_projection` — the caller has already validated invitation state (not accepted, not revoked, not expired). This function is org-level, not invitation-level.
  - Does NOT consult `cross_tenant_access_grants_projection` — the existence of a grant does NOT make a direct role assignment eligible; grants are a separate access pathway.
  - Filtering on the existing-role side considers `role_valid_from <= today`, `role_valid_until IS NULL OR >= today`, AND `op.is_active = true` (so a stale role at a deactivated org doesn't block a legitimate fresh invite). See C4 below.
- **Error conditions**:
  - `target_org_not_found` — target org row missing (likely race with org deletion).
  - `cross_provider_invitation_blocked` — invitee has an active role in a different `type='provider'` org AND target is `type='provider'`.
- **Performance**: Two indexed reads (`user_roles_projection.user_id` + PK lookup on `organizations_projection.id`). p95 < 10ms expected.
- **Security**: SECURITY DEFINER. The function only reads org type + existing-role org IDs. Caller cannot pass arbitrary `p_invitee_user_id` to enumerate users in other orgs because the function returns at most ONE `existing_provider_org_id` (and only when the result is "blocked"); it does NOT reveal which role/name/user-detail. See C1 NOTE below for threat-model rationale.

```sql
CREATE OR REPLACE FUNCTION api.check_invitation_acceptance_eligibility(
  p_invitee_user_id uuid,
  p_target_org_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_target_org_type text;
  v_target_is_active boolean;
  v_existing_org_id uuid;
BEGIN
  -- **ARCHITECT NOTE C1 2026-05-13 (must-fix)**: Original draft had
  --   IF auth.uid() IS NULL THEN RAISE EXCEPTION '42501' END IF;
  -- This is WRONG. accept-invitation calls this RPC via the service-role
  -- admin client (the Edge Function runs unauthenticated until the user has
  -- accepted), where auth.uid() legitimately returns NULL. Mirror the existing
  -- api.check_user_invitation_existence precedent (PR #63):
  --   - GRANT EXECUTE TO authenticated  ← invite-user path (user-initiated)
  --   - GRANT EXECUTE TO service_role   ← accept-invitation path (EF admin client)
  -- and rely on GRANT for authn. Threat model: this is a read-only org-type
  -- check. Worst case if leaked to an unauthorized caller: they learn whether
  -- a known user_id has a role in some provider org (booleanish info already
  -- knowable via the org's user-list APIs). No PII leak — function never
  -- returns names/emails/role-ids, only org_ids.

  SELECT type, is_active INTO v_target_org_type, v_target_is_active
  FROM public.organizations_projection
  WHERE id = p_target_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'error', 'target_org_not_found',
      'message', 'Target organization does not exist.'
    );
  END IF;

  -- Defensive: deactivated target org should not be invitable to anyway,
  -- but the existing invite-creation flow allows it and a separate concern
  -- handles deactivation. Don't expand scope here.
  -- (Surface for follow-up if UAT shows this is an issue.)

  -- **ARCHITECT NOTE C4 2026-05-13 (must-fix)**: original filter missed three things:
  --   (C4a) `organization_id IS NULL` rows (global super_admin) — silently dropped
  --         by INNER JOIN. Made explicit: WHERE urp.organization_id IS NOT NULL.
  --         Semantics: a super_admin has cross-org reach by design; that should
  --         NOT block a fresh provider invite (they can already see the org).
  --   (C4b) `role_valid_from` not filtered — future-dated assignments leaked
  --         through as "active". Added: role_valid_from IS NULL OR <= CURRENT_DATE.
  --   (C4c) Existing role's org might be deactivated — that role is effectively
  --         dead and should not block a fresh invite. Added: op.is_active = true.
  SELECT urp.organization_id INTO v_existing_org_id
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
      'message', 'This user is already a member of another provider organization. Cross-tenant access between providers requires a cross-tenant access grant via a partner organization, not a direct invitation.',
      'details', jsonb_build_object(
        'existing_provider_org_id', v_existing_org_id,
        'target_provider_org_id', p_target_org_id
      )
    );
  END IF;

  RETURN jsonb_build_object('eligible', true);
END;
$$;

COMMENT ON FUNCTION api.check_invitation_acceptance_eligibility(uuid, uuid) IS
$comment$Check whether an invitee may accept (or be issued) an invitation to a target org.

Rejects when the invitee already has an active native role in a different
provider-type org AND the target org is also provider-type. Aligns with
provider-partners-architecture.md: cross-tenant access between providers is
reserved for provider_partner-org users via cross_tenant_access_grants_projection.

Active-role filter: organization_id IS NOT NULL (skip global super_admin),
role_valid_from <= today, role_valid_until IS NULL OR >= today,
target org is_active = true.

Returns:
  {eligible: true}                                          -- proceed
  {eligible: false, error: 'target_org_not_found', ...}     -- 422
  {eligible: false, error: 'cross_provider_invitation_blocked', ...} -- 403/422

Called from:
- accept-invitation Edge Function (Sally path, after isExistingUser=true)
- invite-user Edge Function (pre-issuance, defense in depth)

@a4c-rpc-shape: read$comment$;

-- **ARCHITECT NOTE C1 2026-05-13**: GRANT to BOTH roles — service_role REQUIRED
-- for accept-invitation (admin client, no JWT subject), authenticated REQUIRED
-- for invite-user (user-initiated session). Matches api.check_user_invitation_existence.
GRANT EXECUTE ON FUNCTION api.check_invitation_acceptance_eligibility(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api.check_invitation_acceptance_eligibility(uuid, uuid) TO service_role;
```

**Shape: `read`** (not envelope) — this is a check function, not a write RPC. The Edge Function inspects `eligible: boolean` and translates to HTTP status.

**ARCHITECT NOTE (optional, on response shape)**: Consider dropping the `details.existing_provider_org_id` field if the UI does NOT display the existing org's name. The blocked path is rare and the EF logs the full context anyway; returning the UUID adds an exfiltration surface for callers who learn the function exists. Keep ONLY if the invite-user UI plans a "this user is in org X" affordance (which requires a separate org-lookup permission). For v1, **recommend removing `details`** and adding it back when UI need is concrete.

**ARCHITECT NOTE (org type values verified 2026-05-13)**: Live CHECK constraint at `baseline_v4.sql:13111` allows `('platform_owner', 'provider', 'provider_partner')` — **not** the legacy `'partner'` shown in `provider-partners-architecture.md`. The RPC's `op.type = 'provider'` filter is correct. `platform_owner` callers/targets are correctly ignored by this check (cross-platform_owner invitations don't exist in practice).

### Edge Function gate: `accept-invitation` Sally path

In the existing-user branch (around `accept-invitation/index.ts:580-660`, after `checkExistingUserPath` confirms userExists), call `api.check_invitation_acceptance_eligibility` BEFORE emitting any `user.role.assigned` events. On `eligible=false`, return 403 with the RPC's error code/message + correlation_id. Do not emit any role events; do not emit `invitation.accepted` (invitation stays pending; admin can revoke).

**Race condition (TOCTOU) consideration**: between the eligibility check and the role-event emission, the invitee could in principle gain a new role in another provider org (e.g., concurrent invite acceptance in a different tab). The window is small (single Edge Function execution) and the failure mode is benign — the second event lands in `domain_events` and the handler creates the row anyway. **No mitigation required for v1**; if this becomes observable, the correct fix is to push the check into a SQL RPC that emits the role event in the same transaction (Pattern A v2). For now, document the window in the EF docblock and move on.

### Edge Function gate: `invite-user` (defense in depth)

**ARCHITECT NOTE C2 2026-05-13 (must-fix)**: The plan originally said "manage-user invite-creation flow". **`manage-user` does NOT emit `user.invited`.** Verified via grep across `supabase/functions/`: the only Edge Function that emits `user.invited` is **`invite-user/index.ts:836`**. `manage-user` handles update/deactivate/role-modify operations. Renamed throughout.

In `invite-user/index.ts`, before the `CREATE INVITATION` block (around line 786, after the existing 409-duplicate check), look up whether any existing user matches `requestData.email` (case-insensitive). If found, call `api.check_invitation_acceptance_eligibility(p_invitee_user_id, p_target_org_id)`. On block, return **422** (so invite-create UI shows a clear "cannot invite" error instead of letting the invitee follow a token and hit a 403 mid-OAuth).

**Email→user lookup safety (ARCHITECT NOTE)**: `public.users.email` has NO UNIQUE constraint at the projection layer (verified at `baseline_v4.sql:12702-12717`). Uniqueness is enforced at the Supabase Auth layer (`auth.users.email`), but the projection could theoretically lag or hold duplicates during edge-case event ordering. **Required mitigation**: query with `WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL ORDER BY created_at LIMIT 1`. If zero rows: greenfield invitee, skip eligibility, continue. If 1+ rows: take the first row's id, run eligibility. The very-rare-multi-row case still gets a deterministic answer (first-created user wins the gate).

**Alternative considered**: use `supabaseAdmin.auth.admin.listUsers({ filter: \`email.eq.\${email}\` })`. Rejected — `auth.admin.listUsers` is paginated, more network round-trips, and not part of the cached projection. The projection lookup is sufficient because the only Sally-relevant case is "user has a role in another org" which by definition requires the projection row to exist.

### One-off cleanup: dakaratekid revoke

Emit `user.role.revoked` for her testorg-20260329 Cypress Admin role inside the migration's DO block, idempotent (skip if row already absent). `handle_user_role_revoked` drops the `user_roles_projection` row and removes the role name from `users.roles[]`. Restores her to single-org liveforlife state.

**ARCHITECT NOTE C5 2026-05-13 (must-fix, low-risk)**: The plan's `IF FOUND` idempotency is correct in effect (rerun finds no row → no-op), but the invariant should be stated explicitly. Re-run convergence relies on `handle_user_role_revoked` deleting the projection row on the first emit; therefore "row exists" ↔ "not yet revoked". If the handler's semantics ever change to soft-revoke (mark `revoked_at` instead of delete), this DO block must be revisited. Add a docblock above the migration documenting this dependency.

**ARCHITECT NOTE on Pattern A v2**: Should this cleanup use Pattern A v2 readback? **No.** Pattern A v2 applies to user-facing `api.*` RPCs that need to surface handler failures via envelope. This is a one-time migration cleanup with no caller to surface to. If the emit fails (handler raises), the `BEFORE INSERT` trigger persists `processing_error` in `domain_events` and the migration itself fails — surfacing the error through the deploy log, which is the right channel here. PR #63's `api.deactivate_user` uses Pattern A v2 because it has a frontend caller; this DO block does not.

**ARCHITECT NOTE on metadata.user_id**: Per `event-metadata-schema.md:247-251`, `metadata.user_id` is OPTIONAL and auto-injects from `auth.uid()` when omitted (NULL inside a DDL migration). The audit trail records this as a system event with no human operator — acceptable. Add `automated: true` to mark non-human source explicitly (consistent with the `automated: true` flag used in `accept-invitation/index.ts:616` for OAuth-driven `user.created`).

```sql
-- See ARCHITECT NOTE C5: idempotency depends on handle_user_role_revoked
-- deleting the projection row. If that handler ever switches to soft-revoke,
-- this block must be rewritten to check a revoked-marker instead of NOT FOUND.
DO $$
DECLARE
  v_user_id uuid := 'bab8077f-6a76-46f4-a0cd-9363bbf313fb';
  v_org_id uuid := '2d0829ae-224b-4a79-ac3a-726b00d6c172';
  v_role_id uuid;
BEGIN
  SELECT role_id INTO v_role_id
  FROM public.user_roles_projection
  WHERE user_id = v_user_id AND organization_id = v_org_id;

  IF FOUND THEN
    PERFORM api.emit_domain_event(
      p_stream_type := 'user',
      p_stream_id := v_user_id,
      p_event_type := 'user.role.revoked',
      p_event_data := jsonb_build_object(
        'role_id', v_role_id,
        'org_id', v_org_id
      ),
      p_event_metadata := jsonb_build_object(
        'reason', 'One-off cleanup: dakaratekid was accidentally cross-invited to testorg-20260329 (both type=provider). Per provider-partners-architecture.md, cross-provider invitations are forbidden. See card reject-cross-provider-invitations.',
        'source', 'migration_reject_cross_provider_invitations',
        'automated', true
      )
    );
    RAISE NOTICE 'Revoked accidental cross-provider role: user=% org=% role=%', v_user_id, v_org_id, v_role_id;
  ELSE
    RAISE NOTICE 'No cleanup needed: dakaratekid has no role in testorg-20260329';
  END IF;
END $$;
```

Plus a diagnostic NOTICE-only audit query in the same migration that reports any OTHER users in the same situation (multi-row `user_roles_projection` across multiple `type='provider'` orgs) — so the team can decide case-by-case whether to revoke (no auto-cleanup beyond dakaratekid).

**ARCHITECT NOTE (additional pre-deploy audit)**: The card lacks a query that enumerates **pending invitations** (`invitations_projection WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`) joined against `public.users.email` to surface invitations that WOULD now be blocked at acceptance. Add this to the migration as a NOTICE-only audit. Users who have an in-flight token that the new gate will reject deserve an admin heads-up. Suggested:

```sql
DO $$
DECLARE
  v_rec record;
  v_count int := 0;
BEGIN
  RAISE NOTICE 'Pre-deploy audit: pending invitations that the new gate WOULD reject:';
  FOR v_rec IN
    SELECT i.id AS invitation_id, i.email, i.org_id AS target_org_id,
           u.id AS invitee_user_id
    FROM public.invitations_projection i
    JOIN public.users u ON LOWER(u.email) = LOWER(i.email) AND u.deleted_at IS NULL
    JOIN public.organizations_projection ot ON ot.id = i.org_id AND ot.type = 'provider'
    WHERE i.accepted_at IS NULL
      AND i.revoked_at IS NULL
      AND i.expires_at > NOW()
      AND EXISTS (
        SELECT 1 FROM public.user_roles_projection urp
        JOIN public.organizations_projection oo ON oo.id = urp.organization_id
        WHERE urp.user_id = u.id
          AND urp.organization_id IS NOT NULL
          AND urp.organization_id != i.org_id
          AND oo.type = 'provider'
          AND oo.is_active = true
          AND (urp.role_valid_from IS NULL OR urp.role_valid_from <= CURRENT_DATE)
          AND (urp.role_valid_until IS NULL OR urp.role_valid_until >= CURRENT_DATE)
      )
  LOOP
    v_count := v_count + 1;
    RAISE NOTICE '  invitation=% email=% target_org=% existing_user=%',
      v_rec.invitation_id, v_rec.email, v_rec.target_org_id, v_rec.invitee_user_id;
  END LOOP;
  RAISE NOTICE 'Pre-deploy audit complete: % invitation(s) would now be rejected.', v_count;
END $$;
```

Use the projection column names actually present in `invitations_projection` (verify in baseline_v4 before writing the migration — schema may differ).

## Out of scope

- Building the cross-tenant grant producer pipeline (`api.create_access_grant` / revoke / suspend RPCs, RLS on provider tables, partner-UI for grants) — `dev/active/sub-tenant-admin-design/`
- Fixing `accessible_organizations` denormalization — symptomatic; if the gate ships, no future drift
- AuthCallback Priority-2 fall-through routing investigation — separate follow-up card

## Tasks (high level — `tasks.md` has the working checklist)

1. Migration: `supabase migration new reject_cross_provider_invitations`
2. Handler reference file
3. `accept-invitation` Edge Function: Sally-path gate
4. `manage-user` Edge Function: pre-issuance gate
5. Deno tests (both Edge Functions)
6. Regenerate RPC registry + database.types.ts (frontend + workflows)
7. Pre-deploy smoke against dev (per 2026-05-12 pre-deploy ritual)
8. UAT: Sally scenario rejected at invite-create + at accept; dakaratekid restored to single-org
9. Doc updates: enum naming fix in provider-partners-architecture.md; boundary-repair note in supabase/CLAUDE.md
10. Memory updates: close old seed in `MEMORY.md`; add `cross-provider-invitation-rejected.md`
11. Seed follow-up: `dev/active/investigate-auth-callback-priority-2-fallthrough.md`

## Risks

- **Other accidental cross-provider users may exist** beyond dakaratekid. The migration runs a diagnostic NOTICE query but does NOT auto-cleanup. Triage in a follow-up if any are found.
- **Eligibility check must NOT block legitimate provider_partner→provider invitations** (when grant pipeline ships) — explicit Deno tests for `type='provider_partner'` home → `type='provider'` target should pass eligibility (because the check only blocks when invitee's existing role org is `type='provider'`). **ARCHITECT NOTE**: the legacy doc uses `type='partner'`; the LIVE enum value is `provider_partner`. Test fixtures must use the live value.
- **Edge Function deployment is manual** until CI preview deploy lands. Smoke artifact required before opening PR per the 2026-05-12 ritual.
- **ARCHITECT NOTE — in-flight token risk**: invitations issued before the gate ships with a token that would NOW be rejected at acceptance create a poor admin UX (silent 403, admin sees pending invitation that won't accept). The diagnostic pre-deploy audit (NOTICE query above) surfaces these. Risk-mitigation options, in order of preference: (a) admin manually revokes the in-flight invitation pre-deploy; (b) auto-revoke them in the migration with an explicit per-row `invitation.revoked` emit (heavier surgery, not recommended for v1); (c) accept the UX bump and let the 403 land — the message tells the admin what to do.
- **ARCHITECT NOTE — latent bug in `validate_cross_tenant_access`**: While auditing, I noticed `baseline_v4.sql:12120` references `org_id` column in `user_roles_projection` (which is actually `organization_id`). The function would error on any non-NULL `p_user_id` parameter. **NOT this card's concern** (no current caller traffic — verify before declaring); seed a separate follow-up only if a caller exists.
- **ARCHITECT NOTE — TOCTOU window in accept-invitation**: documented inline above. No-mitigation-needed call; revisit if observed.

## Files

- New migration: `infrastructure/supabase/supabase/migrations/<TIMESTAMP>_reject_cross_provider_invitations.sql`
- New handler reference: `infrastructure/supabase/handlers/api/check_invitation_acceptance_eligibility.sql`
- Modify: `infrastructure/supabase/supabase/functions/accept-invitation/index.ts`
- **ARCHITECT NOTE C2 — corrected file**: Modify: `infrastructure/supabase/supabase/functions/invite-user/index.ts` (NOT manage-user — verified via grep, `user.invited` is emitted only at `invite-user/index.ts:836`)
- New tests:
  - `infrastructure/supabase/supabase/functions/accept-invitation/__tests__/eligibility.test.ts`
  - `infrastructure/supabase/supabase/functions/invite-user/__tests__/invite-eligibility.test.ts` (NOT manage-user)
- Regenerated: `frontend/src/services/api/rpc-registry.generated.ts`, `frontend/src/types/database.types.ts`, `workflows/src/types/database.types.ts`
- Doc edits:
  - `documentation/architecture/data/provider-partners-architecture.md` — **scope expanded per ARCHITECT NOTE C3**: (a) enum naming (`family_consent`→`family_participation`, `agency_assignment`→`social_services_assignment`); (b) all `type='partner'` → `type='provider_partner'` references; (c) add a "Boundary Repair" note pointing to accept-invitation/invite-user Edge Function docblocks. Bump frontmatter `last_updated`.
  - `infrastructure/supabase/CLAUDE.md` — short cross-reference (NOT a full subsection per ARCHITECT NOTE optional improvement); canonical statement lives in Edge Function docblocks.
  - **NEW** docblock at top of `accept-invitation/index.ts` documenting the eligibility gate + TOCTOU window.
  - **NEW** docblock at top of `invite-user/index.ts` documenting the defense-in-depth gate.
- New seed: `dev/active/investigate-auth-callback-priority-2-fallthrough.md`
- Memory: `MEMORY.md` index entry + new `cross-provider-invitation-rejected.md`
- Old seed close-out note: `dev/active/fix-handle-user-role-assigned-update-accessible-organizations-seed.md`

## Architecture Review Checklist

**Filled in as part of the architect review 2026-05-13.** Re-evaluate at PR-open time; items marked NEEDS ATTENTION must be closed in-PR before merge.

- [x] **CQRS Standards** — PASS. New `api.check_invitation_acceptance_eligibility` is a query (read-shape). It reads `organizations_projection` + `user_roles_projection`; no mutation. The cleanup DO block emits a domain event via `api.emit_domain_event` (command), routed to `handle_user_role_revoked` (projection write). Command/query boundary respected.
- [x] **Naming Conventions** — PASS after C2 + C3 fixes. RPC name follows `api.check_*` precedent (`check_user_invitation_existence`, `check_field_definitions_exist`). Migration file follows `<TIMESTAMP>_<verb>_<noun>.sql` pattern.
- [x] **Design Patterns** — PASS. Gateway/Boundary pattern at the Edge Function tier; defense-in-depth (two-tier check); event-sourced cleanup via existing handler reuse. No over-engineering.
- [N/A] **data-testid Attributes** — N/A. No UI changes (only EF + SQL). Followup card for invite-user UI may add a `data-testid` on the rejection-message banner if it introduces a new element; that's out of scope.
- [ ] **AsyncAPI Event Registration** — PASS-WITH-VERIFY. No NEW event types are introduced. `user.role.revoked` (cleanup emit) already exists in AsyncAPI; verify by checking `infrastructure/supabase/supabase/asyncapi.yaml`. The eligibility RPC is a function, not an event — not in scope for AsyncAPI.
- [x] **Type Generation — No Anonymous Types** — PASS. The new RPC's response shape (`{eligible, error?, message?, details?}`) flows through `database.types.ts` regeneration. Frontend callers (if any in v1; currently only Edge Functions call it) must use the generated type, not inline `{eligible: boolean}` shorthand. **Action**: after running `gen types`, verify the generated type name lands in `ReadRpcs` and is consumable without per-call shape assertion.
- [x] **Observability, Tracing & Monitoring** — PASS. EF gate calls go through `supabase.rpc(...)` which propagates correlation_id via the pre-request hook. Eligibility decision MUST be logged at INFO level on both branches with `correlationId`, `inviteeUserId`, `targetOrgId`, `decision` (eligible|blocked|error). On block, also log `existingOrgId` for audit. **Action**: confirm `console.log` calls present in both EFs in the task list.
- [x] **Error Surfacing to UI** — PASS. invite-user returns 422 with the RPC's `message` text; the existing invite-user UI surfaces 4xx error bodies (verify in `UsersManagePage.tsx` invite flow). accept-invitation returns 403 with `correlationId`; the AuthCallback / acceptance UI must surface it (verify the existing 403-handling path).
