# Tasks — list-users-sister-functions-membership-gating

## Investigation (do before planning)

- [ ] Re-confirm the three sister function bodies haven't changed since 2026-05-19 (run `SELECT pg_get_functiondef(...)` for each via Management API SQL).
- [ ] Read each sister function's frontend caller to understand the UX implications of broadening the user list (any sort, pagination, or "already assigned" indicator that might surprise users).
- [ ] Construct or identify a multi-org test subject (or document why one needs to be synthesized for UAT).

## Planning (after investigation)

- [ ] Confirm the membership predicate replacement is `v_org_id = ANY(u.accessible_organizations)` and not a different shape (e.g., `EXISTS (SELECT 1 FROM user_organizations_projection ...)`).
- [ ] Decide whether all three functions ship in one migration or three separate ones (one migration is simpler; per-function may be safer for review).

## Migration

- [ ] `supabase migration new fix_list_users_sister_functions_membership_gating`
- [ ] Replace the predicate in each of the three function bodies.
- [ ] Re-emit `@a4c-rpc-shape: read` `COMMENT ON FUNCTION` per Rule 17 (defensive).
- [ ] `supabase db lint --level warning` clean.
- [ ] `supabase db push --linked` clean on dev.

## Verification

- [ ] SQL-level: call each of the three functions on dev with the multi-org test subject; assert the user now appears.
- [ ] SQL-level: regression — pre-existing role-bearing users still appear.
- [ ] UI walkthrough: open the Roles management page, Bulk Assignment dialog, and Schedule Management page; verify the multi-org user shows up and can be acted on.

## Documentation

- [ ] `documentation/infrastructure/reference/database/tables/users.md` — add a note in the indexes section if the GIN index is now load-bearing for three more RPCs.
- [ ] `documentation/architecture/authorization/rbac-architecture.md` — review the `list_users_for_role_management` section; if the doc body describes membership semantics, update to match.

## Closeout

- [ ] Open PR; reference this card and PR #66 as the origin.
- [ ] On merge: archive card; update memory.
