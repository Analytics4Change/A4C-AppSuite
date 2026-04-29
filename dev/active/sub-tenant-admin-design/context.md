# Sub-tenant Admin Design — Context

**Feature**: Delegated sub-tenant administration via OU hierarchy
**Status**: 🌱 SEEDED — design-stage; awaiting business-need trigger before any work begins
**Priority**: Deferred (no current business need surfaced)
**Origin**: Surfaced 2026-04-27 during `manage-user-delete-to-sql-rpc/` Phase 1; see § Course Correction in that card's `plan.md`.

## Capability target

Grant an administrator authority over a *slice* of a tenant — bounded by an organizational hierarchy (OUs) — without that authority leaking to the rest of the tenant.

**Concrete scenario**: Acme Health Provider with three OUs: `acme.pediatrics`, `acme.cardiology`, `acme.emergency`.
- A `unit_manager` role scoped to `acme.pediatrics` can manage users *within* pediatrics.
- They cannot delete, update, or modify roles for users in `acme.cardiology` (boundary enforced).
- A `regional_manager` scoped to `acme.east_region` (parent OU) automatically reaches all child OUs.

This is the bounded delegated-administration model that A4C does not currently support. Today every admin role with `user.*` perms has tenant-wide reach because users have no organizational location finer than tenant.

## Why this is deferred

A scoped-permission retrofit attempted in `manage-user-delete-to-sql-rpc/` (M1–M4 migrations on 2026-04-27) was reverted same-day after the user-model authority clarified that delivering this capability requires more than just adding scope-aware permission checks. Specifically:

1. **Users live at the org level.** `users` rows have no per-user organizational path. Adding scoped checks against a non-existent path is vacuous.
2. **`users.current_org_unit_id` is shift-session state**, not user-identity. Set per-shift by `api.switch_org_unit` for direct-care staff. NULL for non-direct-care users. Changes per shift.
3. **Available-OUs-at-login is dynamic** from `effective_permissions[].s` for `organization.view_ou` — not a stored mapping.

To deliver the capability, a multi-layer change is required, not just a helper function or a doc rule. See `plan.md` for the design space.

## Trigger condition

Sub-tenant admin becomes architecturally meaningful exactly when **users acquire OU-bounded identity** — i.e., a stable per-identity relationship between a user and the OU(s) they "belong to" for administrative purposes (distinct from direct-care shift-OU and from role-assignment scope).

Until that user-model evolution is on the roadmap, this card stays SEEDED and no work should start. **Before any future implementation begins, re-read `infrastructure/supabase/CLAUDE.md` § Critical Rules — specifically the "Choosing between `has_permission()` and `has_effective_permission()`" rule and the worked `organization.update_ou → organization.view_ou` example.** That rule was codified after the 2026-04-27 scoped-retrofit attempt was reverted; future work must satisfy both its conditions (resource has organizational location AND permission can be derived via implication at narrow scopes) before introducing scoped checks for user-targeted operations.

## Origin trail

- 2026-04-27: `software-architect-dbc` review of `manage-user-delete-to-sql-rpc/` proposed scoped-permission retrofit citing canonical pattern in `bulk_assign_role` and OU mutators.
- User-model authority clarified the gap. Scoped retrofit reverted same-day. Capability target captured here for future re-engagement.
- See `documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md` Rollout 2026-04-27 § course correction for the empirical evidence and the rule for choosing scoped vs unscoped permission checks today.
