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

---

## Closeout — 2026-05-20

**PR #66 merged**: commit `33e77a4f` on 2026-05-20T16:54Z. **UAT: 13/13 PASS** (T1-T13; T6 N/A — no sort UI in product). Architectural review (REQUEST-CHANGES verdict on PR HEAD `eb8bfe41`) closed: all 7 findings addressed in commit `21886472` before merge. Resolution comment posted at PR #66.

### UAT verification summary

| Test | Surface | Result |
|---|---|---|
| T1 | UI — testorg admin sees zombie | ✅ lars.tice+test3 visible with amber "No roles assigned" badge |
| T2 | UI — role-bearing users | ✅ Blue Shield badges for johnltice + lars.tice+test2 |
| T3 | Network — total_count | ✅ `total_count: 3` on every row (COUNT(*) OVER () validated) |
| T4 | UI — status chip filters | ✅ All 4 chips (All/Active/Pending/Inactive) correct; client-side filtering |
| T5 | UI — search filter | ✅ `test3` → 1, `nonexistent-xyz` → 0, Escape → 3; client-side |
| T6 | UI — sort | N/A — no sort affordance in product; default name-ASC implicit |
| T7 | Wire — cross-tenant API | ✅ dakaratekid → `api.list_users(testorg)` returns `[]` (zero PII) |
| T8 | UI — cross-tenant navigation | ✅ No testorg PII leaked; surfaced URL-bar-vs-data divergence observation |
| T9 | Wire — same-tenant API | ✅ dakaratekid → `api.list_users(liveforlife)` returns 3 liveforlife users |
| T10 | EXPLAIN | ✅ `Bitmap Index Scan on idx_users_accessible_orgs_gin` (with seqscan=off) |
| T11 | CI gate | ✅ `rpc-registry-sync.yml` SUCCESS on PR HEAD |
| T12 | Docs review | ✅ tables/users.md has both `idx_users_accessible_orgs_gin` and `idx_users_roles` sections |
| T13 | Repo hygiene | ✅ docs-validation-report.json untracked + gitignored; regenerates clean |

### Side observations (captured for future cards, NOT defects from this PR)

1. **Default login lands at `/clients` on a4c** rather than the user's tenant subdomain. Paper-cut UX.
2. **Status + search filtering is client-side** in UsersManagePage (RPC supports server-side but page narrows the already-fetched rowset). For org sizes where `total_count > p_page_size (20)`, chip counts could under-represent.
3. **No sort UI** in the product; the RPC supports `name`/`email`/`created_at` sort but no user-facing affordance exists.
4. **URL-bar-vs-data divergence**: a logged-in user navigating to a different tenant subdomain sees THEIR org's data (because JWT `org_id` drives scope, not subdomain), but the URL bar lies. T8 surfaced this — the platform's authorization model is JWT-claim-based by design, but the subdomain serves as branding/routing only.
5. **`investigate-auth-callback-priority-2-fallthrough` reproduced for a 5th time** during this UAT session (dakaratekid fresh-session OAuth fell through to a4c instead of liveforlife). Data point added to that card.

### Card archived

Migration `20260519233323_fix_list_users_include_roleless.sql` deployed via PR #66; CI `Deploy Database Migrations` SUCCESS on merge commit. Card closed.
