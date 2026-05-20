# `list_users_for_*` sister RPCs gate by `current_organization_id`, not `accessible_organizations`

**Status**: seed (not yet planned)
**Priority**: Medium-High — same admin-blind-spot class as `users-list-omits-roleless-members` (now shipped in PR #66) but on a different surface. A multi-org user whose `current_organization_id` differs from the role/schedule admin's org is invisible in role-management, bulk-assignment, and schedule-assignment UIs.
**Origin**: Discovered while auditing for the `users-list-omits-roleless-members` fix (2026-05-19). The four `list_users*` functions in `api` schema use three different membership-gating predicates:

| Function | Membership predicate | Bug class |
|---|---|---|
| `api.list_users` | `p_org_id = ANY(u.accessible_organizations)` | ✅ Correct (fixed in PR #66) |
| `api.list_users_for_role_management` | `u.current_organization_id = v_org_id` | ⚠️ Smell — this card |
| `api.list_users_for_bulk_assignment` | `u.current_organization_id = v_org_id` | ⚠️ Smell — this card |
| `api.list_users_for_schedule_management` | `u.current_organization_id = v_org_id` | ⚠️ Smell — this card |

## Problem statement

The three sister functions use `u.current_organization_id = v_org_id` as the membership gate. `current_organization_id` is the user's *currently selected* org (their "active session" org), NOT a membership oracle. This means:

1. **Multi-org users**: a user with home org `liveforlife` who also has a role assignment in `testorg` is invisible to testorg's role-management UI because their `current_organization_id` is liveforlife.
2. **Future cross-tenant grants**: when `provider_partner`-org users get cross-tenant grants per `documentation/architecture/data/provider-partners-architecture.md`, they will be invisible to host-org role admins.
3. **Inconsistency with `api.list_users`**: an admin sees a user in the main `/users` page (now membership-gated correctly via `accessible_organizations`) but can't see the same user in role-management or schedule-assignment. Two different visibility models on the same surface.

## Where the defect lives

`infrastructure/supabase/supabase/migrations/20260212010625_baseline_v4.sql` — three function bodies, each with a `WHERE u.current_organization_id = v_org_id AND u.deleted_at IS NULL AND (search_term…)` block.

Live function signatures (verified 2026-05-19):
- `api.list_users_for_role_management(p_role_id uuid, p_scope_path ltree, p_search_term text DEFAULT NULL, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)`
- `api.list_users_for_bulk_assignment(p_role_id uuid, p_scope_path ltree, p_search_term text DEFAULT NULL, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)`
- `api.list_users_for_schedule_management(p_template_id uuid, p_search_term text DEFAULT NULL, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)`

The `v_org_id` derivation differs by function:
- `for_role_management` + `for_bulk_assignment`: derive `v_org_id` from `subpath(p_scope_path, 0, 1)` against `organizations_projection.path` (correct — derives target org from the scope path).
- `for_schedule_management`: derives `v_org_id` from `public.get_current_org_id()` (the caller's JWT `org_id` claim).

In all three, the eventual membership filter is `u.current_organization_id = v_org_id` — which is wrong regardless of how `v_org_id` was obtained.

## Fix sketch

Replace each `WHERE u.current_organization_id = v_org_id` with:

```sql
WHERE u.accessible_organizations @> ARRAY[v_org_id]::uuid[]
```

Use the **`@>` containment form, NOT `= ANY(...)`** — PostgreSQL's GIN `array_ops` opclass indexes `@>`, `<@`, `&&`, `=` but does **not** support `scalar = ANY(column)`. PR #66 established this convention after a reviewer caught the `= ANY` form leaving the GIN index unused (see PR #66 architectural review, Finding 1). The same backing index (`idx_users_accessible_orgs_gin`, created in PR #66) covers all three sister functions; no new index needed.

Single migration covering all three functions. Each function should also consider whether the sister-specific tenancy guard (already present via `has_effective_permission('user.role_assign', ...)` for two of them; `public.get_current_org_id()` for `schedule_management`) needs adjustment after broadening the visible rowset — review case-by-case.

## Test subjects (synthesize if absent)

A multi-org user is needed:
- Has a `user_organizations_projection` row in two distinct orgs (so `accessible_organizations` contains both)
- Has `current_organization_id` set to one of them
- Has a role at the *other* org

Pre-fix: invisible in the other org's role-management UI.
Post-fix: visible with their other-org role label.

On 2026-05-19 dev: this is the dakaratekid-style scenario described in PR #64 — but dakaratekid had her cross-provider native role revoked in the same migration. May need to construct a new synthetic test subject.

## Out of scope

- Reframing what `current_organization_id` means architecturally — it's the active-session pointer, not a membership oracle, and changing that is a much larger card.
- Fixing the routing-quirk symptom in `dev/active/investigate-auth-callback-priority-2-fallthrough.md` — different bug class, different cause.
- The trigger-into-handler refactor proposed and declined for `trg_sync_accessible_orgs` (decided "needlessly heavy" 2026-05-19).

## Related

- **Origin context**: `dev/archived/users-list-omits-roleless-members/` (PR #66) — surfaced this finding during the audit phase
- **Architectural reference**: `documentation/architecture/data/provider-partners-architecture.md` — explains why multi-org users will become more common as cross-tenant grants land
- **Trigger maintaining the membership oracle**: `public.sync_accessible_organizations()` (AFTER INSERT/UPDATE/DELETE on `user_organizations_projection`)
- **Documentation that will need a similar review**: `documentation/architecture/authorization/rbac-architecture.md` (mentions `list_users_for_role_management`)
