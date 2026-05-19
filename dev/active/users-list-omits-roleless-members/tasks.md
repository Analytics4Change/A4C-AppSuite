# Tasks — users-list-omits-roleless-members

## Investigation

- [ ] Confirm scope: grep all `api.list_users*` / `api.list_users_for_*` functions for the role-EXISTS pattern
  ```bash
  grep -nE "list_users|list_users_for_role_management|list_users_for_bulk_assignment|list_users_for_schedule_management" \
    infrastructure/supabase/supabase/migrations/20260212010625_baseline_v4.sql
  ```
- [ ] Verify `accessible_organizations` is maintained correctly for the relevant use case (no orphan entries)
- [ ] Look at `domain_events` for lars.tice+test3 to see how he reached the zombie state — informs whether this is a one-off or a class

## Migration

- [ ] `supabase migration new fix_list_users_include_roleless`
- [ ] Rewrite `api.list_users` to use `p_org_id = ANY(u.accessible_organizations)` instead of `EXISTS(... user_roles_projection ...)`
- [ ] If sister functions (`list_users_for_role_management`, etc.) have the same pattern, fix them in the same migration
- [ ] Re-emit `@a4c-rpc-shape` COMMENT defensively per DROP+CREATE rule
- [ ] `supabase db lint --level warning` clean

## Test

- [ ] SQL-level: insert a test user with `accessible_organizations=[target_org]` and zero role rows → call `api.list_users(target_org)` → assert user appears in result
- [ ] SQL-level: confirm pagination/status-filter/search-filter still work
- [ ] Existing UI: verify the testorg `/users` page shows lars.tice+test3 (UAT)

## Frontend

- [ ] Inspect roles column rendering for `roles: []` (empty array case) — add UX affordance if needed (e.g., "No roles assigned" label, possibly with a CTA to assign one)
- [ ] Verify cross-aggregate buttons still gate correctly when row is selected

## UAT

- [ ] Re-run testorg `/users` page as johnltice — lars.tice+test3 visible in default (all) filter
- [ ] Roleless-user re-invite flow still works (already proven by PR #64 T2)

## Sequencing & commit shape

- [ ] One migration covering all list-* RPC changes (similar shape to PR #64 closeout)
- [ ] Regen `database.types.ts` + `rpc-registry.generated.ts` (no signature change expected, but rerun the discipline step)
- [ ] Branch: `fix/list-users-include-roleless-members`
- [ ] One commit; PR title: `fix(list_users): include role-less org members`
