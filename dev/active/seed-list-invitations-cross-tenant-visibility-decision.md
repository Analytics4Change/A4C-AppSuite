# `api.list_invitations` cross-tenant visibility — exposure-policy decision (then maybe refactor)

**Status**: seed (not yet planned) — **decision-gated**
**Priority**: Low-Medium (no current consultant use case; forward-need split out of Phase 3)
**Origin**: Cross-tenant grant Phase 3 (PR #80, SHIPPED 2026-06-22, merge `b56a796c`, migration `20260622183824`). Architect (`software-architect-dbc`, 2026-06-22) split `list_invitations` out of Phase 3 because, unlike `list_users`, it is NOT a clean guard swap — it pulls in a permission seed + a HIPAA exposure-policy decision.

## Problem / why this is its own card

Phase 3 made `api.list_users` grant-aware (Model M membership-oracle guard) so cross-tenant consultants can list a provider org's **users**. The 2026-05-26 handoff wanted the same treatment for `api.list_invitations` "+ a permission check on `invitation.read`." Re-adjudication found that path is **not implementable as written**:

1. **`invitation.read` does not exist.** There is NO `invitation.*` permission family in `permissions_projection` at all (only `user.create/update/delete/view/role_assign/role_revoke/client_assign/schedule_manage`). Gating on it requires first seeding it via the `permission.defined` event flow — with implication wiring + a decision about which role templates receive it.

2. **It is a HIPAA exposure-policy decision, not guard mechanics.** Invitations carry **invitee email + name + role intentions** — a pre-onboarding admin surface. "Should a cross-tenant consultant see a provider org's *pending invitations*?" is a policy question. A `var_contract` analytics consultant almost certainly should NOT; an `emergency_access` clinician (whose template confers `client.view`/`medication.view`, not user-admin visibility) almost certainly should NOT. **Likely answer: no consultant lists invitations → leave `api.list_invitations` unchanged (org-admin-only).**

## Current deployed state (for reference)

`api.list_invitations(p_org_id uuid, p_status text[], p_search_term text)`:
- Guard: `IF NOT (has_platform_privilege() OR (has_org_admin_permission() AND p_org_id = get_current_org_id())) THEN RAISE EXCEPTION 'Insufficient permissions...'; END IF;`
- `has_org_admin_permission()` is JWT-GLOBAL / scope-blind (checks `effective_permissions` for `user.manage`/`role.*`/`organization.manage` anywhere).
- Query: `WHERE i.organization_id = p_org_id` (FK column, not a membership predicate).
- **RAISE on reject** (reveals org existence to a probing cross-tenant caller — see D3 below).

## Decisions (gating — do not build until locked)

1. **Exposure policy FIRST**: do consultants ever list a provider org's invitations? Default recommendation: **NO** → close this card as "won't do; org-admin-only is correct," leaving `list_invitations` unchanged.
2. **If YES for some grant type**: seed `invitation.read` via `permission.defined` (+ implication from which existing admin perm? + which templates carry it). Then gate with a membership conjunct (`accessible_organizations @> [p_org_id]`) AND the permission — together, not either-or.
3. **Info-leak (D3)**: if reworked, switch the reject path from `RAISE EXCEPTION` to `RETURN` (empty) so a denied caller and a non-existent org are byte-indistinguishable (matching `list_users` Bucket A). Do this **together** with the rework — swallowing the RAISE while it's still org-admin-only would silently change existing admin-tooling error UX.

## Implementation sketch (only if decision #1 = YES)

1. `permission.defined` migration seeding `invitation.read` (+ implication wiring + template assignment).
2. `CREATE OR REPLACE api.list_invitations` (pitfall #6: fetch deployed body first) — guard becomes `has_platform_privilege() OR (has_effective_permission('invitation.read', <org_path>) AND accessible_organizations @> [p_org_id])`; reject path RAISE→RETURN-empty; re-issue COMMENT (consultant-callable tag) + regenerate reachability matrix.
3. Verify via the transactional simulate-JWT pattern (Phase 3 close-out has the exact recipe: in-txn grant insert → trigger → simulate consultant JWT → call → ROLLBACK).

## Relationships

- **Sibling of** (shipped): `list_users` Model M refactor (Phase 3, migration `20260622183824`).
- **Under**: parent `cross-tenant-access-grant-rollout/` (Phase 3 follow-up).
- The UI second-axis "direct member vs grant-bearer" segregation filter is a **Phase N** concern (ADR § user-visibility-consequence), not this card.

## Out of scope

- Any change to `list_users` (done).
- Phase 4 Bucket D RLS audit.
