# Tasks: list-users-sister-functions-membership-gating

## Phase 1: Pre-flight verification ⏸️ PENDING

- [ ] **1.1** Re-pull the three sister function bodies from live DB; confirm each still uses `WHERE u.current_organization_id = v_org_id` (no drift since 2026-05-19 audit)
- [ ] **1.2** Confirm `idx_users_accessible_orgs_gin` is still present on `public.users`
- [ ] **1.3** Re-grep frontend callers; confirm no consumer relies on the over-restrictive `current_organization_id` semantics:
  - `frontend/src/services/roles/SupabaseRoleService.ts` (uses `list_users_for_bulk_assignment` + `list_users_for_role_management`)
  - `frontend/src/services/schedule/SupabaseScheduleService.ts` (uses `list_users_for_schedule_management`)
  - `frontend/src/pages/roles/RolesManagePage.tsx:438` (UI invocation of `listUsersForRoleManagement` during role deletion)
- [ ] **1.4** Inventory liveforlife `schedule_templates_projection` rows; capture an `id` for the Phase 3.2 schedule-management smoke. If none exist, decide: create one inside the transactional harness, OR mark schedule smoke as N/A (the role + bulk-assignment smokes prove the pattern)
- [ ] **1.5** Capture `md5(pg_get_functiondef(...))` for each of the three RPCs as a body-drift anchor; if hashes differ at migration-write time, integrate the diff first

## Phase 2: Migration ⏸️ PENDING

- [ ] **2.1** `cd infrastructure/supabase && supabase migration new fix_list_users_sister_functions_membership_gating`
- [ ] **2.2** Rewrite the three function bodies with `accessible_organizations @> ARRAY[v_org_id]::uuid[]` predicate:
  - [ ] `api.list_users_for_role_management(p_role_id uuid, p_scope_path ltree, p_search_term text, p_limit int, p_offset int)`
  - [ ] `api.list_users_for_bulk_assignment(p_role_id uuid, p_scope_path ltree, p_search_term text, p_limit int, p_offset int)`
  - [ ] `api.list_users_for_schedule_management(p_template_id uuid, p_search_term text, p_limit int, p_offset int)`
- [ ] **2.3** Re-emit `@a4c-rpc-shape: read` `COMMENT ON FUNCTION` on each (defensive per Rule 17)
- [ ] **2.4a** Edit `api.list_users_for_bulk_assignment` COMMENT prose (existing prose) to mention `accessible_organizations` as the membership oracle
- [ ] **2.4b** Author new COMMENT prose for `api.list_users_for_role_management` (currently bare `@a4c-rpc-shape: read` only); template after `list_users` shape — purpose + membership oracle + permission gate + shape tag
- [ ] **2.4c** Author new COMMENT prose for `api.list_users_for_schedule_management` (currently bare `@a4c-rpc-shape: read` only); same template
- [ ] **2.5** `supabase db lint --level warning` clean
- [ ] **2.6** `supabase db push --linked --dry-run` confirms migration recognized
- [ ] **2.7** `supabase db push --linked` applies cleanly
- [ ] **2.8** If body iteration needed mid-PR: `supabase migration repair --linked --status reverted 2026...` + re-push (per `memory/pr-63-close-out.md`)

## Phase 3: SQL smoke verification ⏸️ PENDING

- [ ] **3.1** Build the transactional smoke harness (single Management API SQL request, `BEGIN; ... ROLLBACK;`):
  - [ ] INSERT `user_organizations_projection` row giving `lars.tice+test2@gmail.com` liveforlife membership
  - [ ] (Within same transaction) confirm `trg_sync_accessible_orgs` reconciled `accessible_organizations` to include liveforlife
  - [ ] (Within same transaction) confirm `current_organization_id` stayed at testorg
  - [ ] (Within same transaction) optionally CREATE a temporary `schedule_templates_projection` row for liveforlife if Phase 1.4 found none
- [ ] **3.2** Inside the same transaction, smoke each of the three RPCs:
  - [ ] `api.list_users_for_role_management('<liveforlife-role-id>', 'liveforlife'::ltree, NULL, 100, 0)` includes test subject
  - [ ] `api.list_users_for_bulk_assignment('<role-id>', 'liveforlife'::ltree, NULL, 100, 0)` includes test subject
  - [ ] `api.list_users_for_schedule_management('<template-id>', NULL, 100, 0)` includes test subject (skipped if Phase 1.4 found no template AND we chose not to create one in-tx)
- [ ] **3.3** Regression (also within the same transaction): existing liveforlife members (dakaratekid, rachel, troy) still appear correctly in each
- [ ] **3.4** ROLLBACK; confirm post-rollback state matches pre-flight (no projection drift; `accessible_organizations` for test subject is back to `[testorg]`; no temporary schedule template persists)

## Phase 4: Documentation ⏸️ PENDING

- [ ] **4.1** Review `documentation/architecture/authorization/rbac-architecture.md` for any claim about sister-RPC membership semantics that this PR invalidates; update + bump `last_updated`
- [ ] **4.2** (Optional) Append note to `documentation/infrastructure/reference/database/tables/users.md` `idx_users_accessible_orgs_gin` section that the index is now load-bearing for 4 RPCs (was 1)
- [ ] **4.3** Run combined docs-skill + AGENT-GUIDELINES Drift Checklist (last_updated, links, paths, code fences, AGENT-INDEX triggers — see `frontend/CLAUDE.md` and the docs-writing skill body)

## Phase 5: Frontend validation ⏸️ PENDING

No frontend code change expected (signatures unchanged).

- [ ] **5.1** `cd frontend && npm run typecheck` — green
- [ ] **5.2** `npm run lint` — green
- [ ] **5.3** `npm run docs:check` — green
- [ ] **5.4** `npm run build` — green

## Phase 6: PR + closeout ⏸️ PENDING

- [ ] **6.1** Create branch `feat/list-users-sister-functions-membership-gating` off main
- [ ] **6.2** Commit all changes; push
- [ ] **6.3** Open PR with title `fix(api): list_users sister RPCs gate membership by accessible_organizations not current_organization_id`
- [ ] **6.4** PR body cites PR #66 as convention origin; enumerates the three functions; calls out the super_admin invisibility concern as known-out-of-scope; explicitly notes PR #66's `COUNT(*) OVER ()` pattern is NOT applied here (these RPCs don't return `total_count`) to preempt a "you should be consistent" review comment
- [ ] **6.4a** UAT — UI walkthrough (post-merge, if multi-org subject can be reconstituted): johnltice (testorg admin) opens `RolesManagePage`; clicks **Delete role** on a role with assignments; verify the assigned-users dialog (driven by `RolesManagePage.tsx:438` → `listUsersForRoleManagement`) lists the synthesized multi-org subject
- [ ] **6.5** Self-review (architect-style); apply PR #66 checklist
- [ ] **6.6** On merge: monitor CI `Deploy Database Migrations` + `RPC Shape Registry Sync` for green
- [ ] **6.7** Post-merge UAT — at minimum, EXPLAIN sanity + CI gate verification + (optional) UI walkthrough of role-deletion dialog if multi-org test subject can be reconstituted
- [ ] **6.8** Archive card: `git mv dev/active/list-users-sister-functions-membership-gating/ dev/archived/`
- [ ] **6.9** Append closeout block to archived `tasks.md` (UAT results table)
- [ ] **6.10** Update `memory/MEMORY.md` last-groomed entry; demote previous entries one rung. The `pr-66-close-out.md` memory file already captures the `@>` convention — no new memory file needed unless surprises emerge.

## Success Validation Checkpoints

### Immediate Validation (post-Phase 3)
- [ ] All three function bodies in dev use `accessible_organizations @>` predicate (verified via `pg_get_functiondef`)
- [ ] Synthesized multi-org subject appears in all three sister RPCs against the secondary org
- [ ] Pre-existing single-org users still appear correctly (zero regression)
- [ ] `idx_users_accessible_orgs_gin` is the load-bearing index when seqscan is disabled (EXPLAIN sanity)

### Feature Complete Validation (post-Phase 6)
- [ ] PR merged; CI `Deploy Database Migrations` SUCCESS
- [ ] CI `RPC Shape Registry Sync` SUCCESS (signatures unchanged but defensive re-emission of `@a4c-rpc-shape: read` should land cleanly)
- [ ] Card archived; MEMORY.md groomed
- [ ] Super_admin invisibility concern explicitly NOT fixed (per scope decision) and documented as such in PR description

## Current Status

**Phase**: Phase 1 — Pre-flight verification
**Status**: ⏸️ PENDING (plan written 2026-05-21; architect-reviewed APPROVE WITH FINDINGS; punch list folded in; ready for execution)
**Last Updated**: 2026-05-21
**Next Step**: Run Phase 1.1–1.5 pre-flight checks (~22 min); then if all green, proceed to Phase 2 migration creation.

## Architect-review punch list (already folded into the phases above)

- ✅ **Finding #1** (Must-fix) — Phase 3.1 switched to transactional `BEGIN; ... ROLLBACK;` harness; no projection drift outside the in-tx window
- ✅ **Finding #3** (Should-consider) — Phase 2.4 split into 2.4a/b/c reflecting that only `list_users_for_bulk_assignment` has existing prose; the other two need new prose authored
- ✅ **Finding #4** (Should-consider) — Phase 1.4 added: inventory liveforlife schedule templates; if none, create in-tx or skip schedule smoke
- ✅ **Finding #5** (Should-consider) — Phase 6.4 PR body explicitly preempts the `COUNT(*) OVER ()`-consistency review comment
- ✅ **Finding #2** (Should-consider) — plan's risks section corrected to note super_admin `accessible_organizations IS NULL` (not `= []`); memory file note for next groom
- ✅ **Finding #6** (Nit) — Phase 1.5 added: capture body-hash as drift anchor
- ✅ **Finding #7** (Nit) — Phase 2.2 time estimate bumped to 40 min (15+25 split)
- ✅ **Finding #8** (Nit) — Phase 6.4a UI walkthrough explicit on click-path and verification target
- ⏸️ **Finding #9** (Nit) — `frontend/src/services/CLAUDE.md` + `infrastructure/supabase/CLAUDE.md` quick search-pass deferred to Phase 4 task 4.3 as part of the Drift Checklist
