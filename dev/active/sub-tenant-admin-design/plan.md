# Sub-tenant Admin Design — Design-Space Plan

> **This is a design-space plan, not an implementation plan.** No code or migrations should ship from this card without business prioritization and a follow-up implementation card. The purpose here is to map the problem space so future work doesn't re-derive it.

## Capability

A `unit_manager` role scoped to OU `acme.pediatrics` can manage users within pediatrics; cannot reach users in `acme.cardiology`. A `regional_manager` at `acme.east_region` reaches all child OUs automatically. The scope hierarchy is `effective_permissions[].s` ltree containment.

| Role example | Scope `s` | Reach today (unscoped) | Reach under sub-tenant model |
|---|---|---|---|
| `provider_admin` | `acme` | All Acme users | All Acme users (unchanged) |
| `unit_manager` | `acme.pediatrics` | All Acme users (BUG — no boundary) | Only pediatrics users |

## Trigger

Sub-tenant admin is architecturally meaningful exactly when `has_effective_permission('user.*', target_user_path)` stops being vacuous — i.e., when users acquire OU-bounded identity. The implication chains already exist at the permission tier (`user.delete → user.view`, `user.update → user.view`, `user.create → user.view`, `user.role_assign → user.view`); they just don't bite today because targets have no path.

Verified empirical state (2026-04-27, against `tmrjlswbsxmbglmaclxu`):
- All `user.*` permission scopes are at org root.
- All role assignments at depth 1 (no sub-tenant OU assignments exist).
- 0 of 6 users have `current_org_unit_id` populated.

## Phase 0 Discovery — narrower alternative vs. full sub-tenant admin

> **Decide before §1.** Sub-tenant admin (this card's full scope) is potentially over-scoped for the immediate need. There is a narrower alternative that solves role-management gating without any user-model evolution.

### Two architectural alternatives

1. **Sub-tenant admin (this card's full scope)** — assign roles like "South Valley Admin" at scope `testorg-20260329.south_valley`, not at tenant root. Reuses `effective_permissions[].s` ltree containment via `has_effective_permission(perm, target_path)`. **Requires user-identity to acquire OU-bounded location** (per "Trigger" above). Heavy: user-model evolution, multi-role aggregation, identity-vs-shift-OU distinction, helper redesign, RPC retrofit across `delete_user` / `deactivate_user` / `update_user_profile` etc.

2. **Role-scope containment check** — distinct from actor's `effective_permissions[].s` paths: `actor's role's org_hierarchy_scope @> target role's org_hierarchy_scope`. Reads as "South Valley Admin can only manage role assignments whose scope is at-or-below `south_valley`." **No user-model change required.** The check sits at the role-management RPC layer (`modify_user_roles`, `assign_role`, `revoke_role`). Targets a `user_roles_projection` row — which already has `scope_path` — not a user identity.

### Which alternative is actually needed?

Matrix the two against the operation taxonomy in §3 below:

| Operation class | Examples | Option 2 sufficient? | Why |
|---|---|---|---|
| **Role-scoped** | `modify_user_roles`, `assign_role`, `revoke_role`, `bulk_assign_role` | ✅ Yes | Target has scope (`user_roles_projection.scope_path`); the canonical pattern is already implemented in `baseline_v4 bulk_assign_role`. Actor's role scope @> target row's scope is the natural check. |
| **Identity-scoped** | `delete_user`, `deactivate_user`, `update_user_profile`, `update_notification_preferences` | ❌ No | Target has no scope today; needs user-identity OU evolution (Option 1). Option 2 cannot answer "is this user under my administrative authority?" because user identity has no path. |

### Phase 0 finding

**Option 2 is the smaller hammer for role-management gating; Option 1 (this card's full scope) is the broader capability for identity-scoped delegation.** They are not substitutes — they apply to different operation classes.

- If the immediate business driver is **role-management only** (e.g., "South Valley Admin shouldn't be able to assign roles outside south_valley"): ship Option 2 as a focused implementation card and defer this one.
- If the driver **also includes identity-scoped delegation** (e.g., "South Valley Admin should be able to delete users at south_valley"): this card's full design space applies, and Option 2 is one tactical sub-component of it.

### Discovery action

Phase 0 must:
1. Enumerate the operations that today need a scope-gating boundary the platform doesn't enforce.
2. Classify each as **role-scoped** or **identity-scoped** per the table above.
3. **If only role-scoped operations surface**: write a separate small implementation card for Option 2 (target the role-management RPCs only) and keep this card SEEDED.
4. **If identity-scoped operations also surface**: this card's full design space applies; proceed to §1.

The 2026-05-06 surfacing case (PR #49 — South Valley Admin clicking into 42501 on `api.list_users_for_role_management`) is purely role-management-adjacent (a list-users-for-role-assignment query). It does NOT, by itself, require sub-tenant admin. It requires either (a) the existing tenancy guard already in place, or (b) Option 2 if we want to constrain South Valley Admin's role-management reach further.

## Design space

### 1. Data-model changes

The most important question. Several non-equivalent options:

a. **`users.identity_org_unit_id` (single-valued)**: similar to `current_org_unit_id` but for identity rather than shift-session. A user has one "home OU" for administrative purposes. Simple but rigid — doesn't model users belonging to multiple sub-tenants.

b. **`user_org_unit_memberships` (many-to-many projection)**: rows of `(user_id, org_unit_id, kind)` where `kind` distinguishes "direct-care assignment" from "administrative-identity membership". Models multi-OU users honestly. More schema work, more events.

c. **Derive from role assignments**: a user's "sub-tenant identity" is the union of `user_roles_projection.scope_path` paths. No new column or projection — but coupling identity to role state makes role changes ripple into administrative authority unpredictably.

The choice depends on: (i) how A4C wants to model users belonging to multiple sub-tenants, (ii) whether direct-care OU assignment (`current_org_unit_id`) and administrative-OU identity should share a mechanism or be deliberately separated.

### 2. Multi-role-scope aggregation

If a user holds `unit_manager` at BOTH `acme.pediatrics` AND `acme.emergency`, what's their administrative reach?

- **Union semantics**: caller can manage users in EITHER pediatrics OR emergency.
- **Intersection semantics**: caller can manage users in pediatrics AND emergency (impossible if scopes are disjoint).
- **Per-action union**: `user.view` is union; `user.delete` is more restrictive.

`compute_effective_permissions` already collapses to widest-scope per permission (single tuple per perm name in JWT). For sub-tenant admin, do we need to preserve all assignment scopes? Or is the widest-scope-collapse sufficient for the operations in question?

### 3. Operation taxonomy: identity-scoped vs role-scoped

| Operation type | Example | Target | Scope check should use |
|---|---|---|---|
| Identity-scoped | `delete_user`, `update_user_profile`, `update_notification_preferences`, `deactivate_user`, `reactivate_user` | The user as a person (entire identity) | `target_user_path` (requires user-model gain) |
| Role-scoped | `revoke_role`, `modify_role_assignment`, `assign_role` | A specific `user_roles_projection` row | The role's own `scope_path` (already works in baseline_v4 `bulk_assign_role`) |

For identity-scoped operations on a user who holds roles across multiple OUs, the scope semantic must decide:
- Caller scope ⊇ ALL of target's role-assignment scopes (strict — `unit_manager` at `acme.pediatrics` cannot delete a user who also has a role in `acme.cardiology`)
- Caller scope ⊇ ANY of target's role-assignment scopes (permissive)
- Caller scope ⊇ target's identity OU (independent of role assignments)

The strict ALL-of semantic respects the principle of least authority but creates user-experience cliffs (admins can't delete users who happen to have a role outside their sub-tenant). Worth surfacing this trade-off to product.

### 4. Permission shape

Two flavors:
- **Reuse `user.delete`** with mandatory scope on assignment. Sub-tenant deployments enforce role assignments at OU scopes. Tenant-wide deployments assign at org root. Same permission name; scope-distribution does the work.
- **Separate `user.delete.in_scope`** vs `user.delete.tenant_wide`. More explicit but multiplies permission surface area.

Lean toward reuse-with-scope-discipline.

### 5. Migration story

Existing data is org-flat: every user has `current_organization_id` set; zero have `current_org_unit_id`. Migration to a sub-tenant model:

- **Default identity assignment**: all existing users get implicit "identity at org root" (i.e., `target_user_path = organizations_projection.path`). Scoped checks behave identically to today's unscoped + tenancy guard for these users — i.e., zero behavior change.
- **New users created with explicit OU assignment** start participating in sub-tenant boundaries.
- Backfill projection / column is required if option 1b (many-to-many membership) is chosen.

### 6. Available-OUs-at-shift filter (related but distinct)

For direct-care staff clocking in: shift assignment must occur at OUs where client placement happens (typically leaves, sometimes specific intermediate nodes). The dynamic mechanism today (`api.switch_org_unit` + `has_effective_permission('organization.view_ou', target_path)`) is sufficient for the **authorization** filter but **not for the placement-eligibility filter**. The latter would benefit from a derived view: `(view-scope ∩ placement-eligible-OUs)`.

Question: is this filter a distinct projection, or a derived query, or part of the same data structure that backs administrative-OU identity?

## Open questions

- Is there a difference between "OUs I am administratively-assigned to" (sub-tenant admin scope) and "OUs I provide direct care to" (shift selection scope)? The two could share a table or be deliberately separate. Mixing them complicates both.
- Does the future "available OUs for shift" filter need a projection (placement-eligible × view-scope), and is that the same projection that would back administrative scoping?
- Does sub-tenant admin need cross-tenant federation (e.g., a parent tenant administering a child tenant)? Or is it strictly intra-tenant OU containment?

## What this card is NOT

- An implementation plan. No migrations, no code. Re-engage with a follow-up implementation card after design is settled.
- A reversal of the 2026-04-27 course correction. The retrofit was correctly reverted because it tried to deliver this capability without first changing the data model.

## References

- `documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md` Rollout 2026-04-27 § course correction — empirical evidence and the architectural-pivot story.
- `infrastructure/supabase/CLAUDE.md` § Critical Rules — current rule for choosing scoped vs unscoped permission checks (depends on whether resource has organizational location).
- `dev/active/manage-user-delete-to-sql-rpc/plan.md` § Phase 1.5 Course Correction — the trigger-event for this card.
- `documentation/architecture/authorization/rbac-architecture.md` — current RBAC model.
