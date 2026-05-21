# Implementation Plan: list-users-sister-functions-membership-gating

**Status**: planned (ready for execution; pure replay of the PR #66 playbook)
**Priority**: Medium-High
**Date**: 2026-05-21
**Origin**: 2026-05-19 PR #66 investigation; sister-card seeded 2026-05-20

## Executive Summary

PR #66 fixed `api.list_users` so org membership is gated by the canonical oracle `users.accessible_organizations @> ARRAY[p_org_id]::uuid[]` instead of an unreliable role-EXISTS proxy. Three sister RPCs (`list_users_for_role_management`, `list_users_for_bulk_assignment`, `list_users_for_schedule_management`) carry a different but related smell: they gate by `u.current_organization_id = v_org_id` — the user's active-session pointer, NOT a membership oracle. Pre-fix consequence: multi-org users (and users whose session pointer drifts away from their target org) are invisible in role-management, bulk-assignment, and schedule-assignment admin UIs. Today the defect is dormant on dev (all users are single-org), but it will become routine the moment the cross-tenant grant pipeline ships per `dev/active/sub-tenant-admin-design/`.

The fix is symmetric to PR #66 and reuses the same GIN index (`idx_users_accessible_orgs_gin`). One migration touches three function bodies. The card is scoped as a pure replay — no design re-litigation, no architectural reframing of `current_organization_id`, no super_admin visibility changes.

## Phase 1: Pre-flight verification

### 1.1 Confirm sister function bodies unchanged since 2026-05-19 audit
- Re-pull live function definitions for the three RPCs via Management API SQL
- Confirm each still uses `WHERE u.current_organization_id = v_org_id`
- Confirm no other consumer has refactored them in the interim
- **Time estimate**: 5 minutes

### 1.2 Confirm GIN index still present on `public.users`
- Single SQL check: `SELECT indexname FROM pg_indexes WHERE indexname = 'idx_users_accessible_orgs_gin'`
- **Time estimate**: 2 minutes

### 1.3 Verify no UI consumer relies on current_organization_id semantics
- Re-grep frontend callers (already mapped at PR #66 prep time: `SupabaseRoleService.ts`, `SupabaseScheduleService.ts`, `pages/roles/RolesManagePage.tsx:438`)
- Confirm none of them depends on the over-restrictive behavior (e.g., would break if more users appeared)
- **Time estimate**: 10 minutes

### 1.4 Inventory liveforlife `schedule_templates_projection` rows
- `SELECT id, schedule_name FROM public.schedule_templates_projection WHERE organization_id = '43ede501-…' AND deleted_at IS NULL` (or similar)
- If at least one exists, capture its `id` for Phase 3.2's schedule-management smoke
- If none exist, decide between (a) creating one inside the transactional smoke harness, or (b) deferring the schedule smoke as N/A (the role + bulk-assignment smokes prove the pattern)
- **Time estimate**: 5 minutes

### 1.5 Pin a content hash of the three live function bodies as the audit anchor
- Capture `md5(pg_get_functiondef(...))` for each of the three RPCs as of plan-execution date
- If at execution time the hash differs from this anchor, integrate the diff before writing the migration (prevents silent body-drift between plan-write and plan-execute)
- **Time estimate**: 2 minutes

## Phase 2: Migration

### 2.1 Create migration via Supabase CLI
- `cd infrastructure/supabase && supabase migration new fix_list_users_sister_functions_membership_gating`
- **Time estimate**: 1 minute

### 2.2 Rewrite the three function bodies
Replace the predicate in all three function bodies (full bodies copied from live DB; only the WHERE clause + RPC shape comment change):

```sql
-- BEFORE
WHERE u.current_organization_id = v_org_id

-- AFTER
WHERE u.accessible_organizations @> ARRAY[v_org_id]::uuid[]
```

Single migration covering all three. Each function uses `CREATE OR REPLACE FUNCTION` (signature unchanged → OID preserved → existing COMMENT preserved). Re-emit `@a4c-rpc-shape: read` COMMENT defensively on each per Rule 17.

**COMMENT prose differs by function** (verified live 2026-05-21):
- `api.list_users_for_bulk_assignment` carries full descriptive prose today — **edit** to mention `accessible_organizations` as the membership oracle
- `api.list_users_for_role_management` carries only the bare `@a4c-rpc-shape: read` tag — **author new prose** following the `list_users` shape (purpose + membership oracle + permission gate + shape tag)
- `api.list_users_for_schedule_management` carries only the bare `@a4c-rpc-shape: read` tag — **author new prose** likewise

- **Time estimate**: 40 minutes (15 min rewrite predicates + 25 min author/edit prose for all three)

### 2.3 Local lint + dry-run
- `supabase db lint --level warning` clean
- `supabase db push --linked --dry-run` to confirm migration is recognized
- **Time estimate**: 5 minutes

### 2.4 Deploy to dev
- `supabase db push --linked`
- If body iteration mid-PR is needed (as with PR #66): `supabase migration repair --linked --status reverted <timestamp>` + re-push (safe on feature branch per `memory/pr-63-close-out.md`)
- **Time estimate**: 5 minutes

## Phase 3: SQL smoke verification

### 3.1 Construct or identify a multi-org test subject
On dev today, **no multi-org users exist** (PR #66 pre-flight survey confirmed all 9 active users have `org_count ≤ 1`). Synthesize one for the smoke test using a **transactional harness** — INSERT, run all three RPCs, ROLLBACK in a single Management API SQL request so the projection-as-read-model invariant is never violated outside the transaction window:

```sql
BEGIN;
  -- Synthesize multi-org membership for lars.tice+test2 (currently testorg-only)
  INSERT INTO public.user_organizations_projection (user_id, org_id, ...)
    VALUES (
      (SELECT id FROM public.users WHERE email = 'lars.tice+test2@gmail.com'),
      '43ede501-5d88-44b5-a84b-53edeec0781f'  -- liveforlife
    );
  -- trg_sync_accessible_orgs reconciles users.accessible_organizations within-tx
  -- Run the three RPC smoke calls here (Phase 3.2) — they observe the in-tx INSERT
  SELECT email FROM api.list_users_for_role_management(...);
  SELECT email FROM api.list_users_for_bulk_assignment(...);
  SELECT email FROM api.list_users_for_schedule_management(...);
ROLLBACK;
-- Post-rollback: no projection drift, no event-stream divergence, no audit-trail noise
```

**Why transactional**: a direct INSERT without an event row violates the "projections derive from `domain_events`" invariant. ROLLBACK collapses the window to zero externally-observable state. If you must persist for any reason (e.g., UI walkthrough later), document the precise INSERT/DELETE SQL keyed on `(user_id, org_id)` and run a post-cleanup verification query (`SELECT accessible_organizations FROM users WHERE email = 'lars.tice+test2@gmail.com'`) to confirm the trigger reconciled back to the original.

- **Time estimate**: 20 minutes (incl. building the transactional harness)

### 3.2 Smoke each of the three RPCs
For each sister function, call against `liveforlife` scope/template and assert the multi-org subject appears. **Schedule-management smoke prerequisite**: a liveforlife `schedule_templates_projection` row must exist. Add a Phase 1.4 inventory check; if absent, either (a) include template creation inside the transactional smoke harness (CREATE template → run RPC → ROLLBACK collapses both), or (b) skip the schedule-management smoke and accept the role+bulk-assignment smokes as sufficient evidence the pattern works (the schedule function uses the same predicate shape).

```sql
-- list_users_for_role_management
SELECT email, current_roles, is_assigned
  FROM api.list_users_for_role_management('<liveforlife-role-id>', 'liveforlife'::ltree, NULL, 100, 0);
-- expected: synthesized multi-org subject is in the result set

-- list_users_for_bulk_assignment
SELECT email FROM api.list_users_for_bulk_assignment('<role-id>', 'liveforlife'::ltree, NULL, 100, 0);

-- list_users_for_schedule_management
SELECT email FROM api.list_users_for_schedule_management('<template-id>', NULL, 100, 0);
```

- **Time estimate**: 20 minutes

### 3.3 Regression — pre-existing role-bearing users still appear
For each of the three RPCs, confirm that liveforlife's known users (dakaratekid, rachel, troy) still appear with their correct roles/state flags. No over-restriction.

- **Time estimate**: 10 minutes

### 3.4 Cleanup
- Revert the synthesized multi-org row (delete the `user_organizations_projection` row for the test subject; trigger reconciles `accessible_organizations`)
- Confirm test subject returns to single-org state
- **Time estimate**: 5 minutes

## Phase 4: Documentation

### 4.1 Update `documentation/architecture/authorization/rbac-architecture.md`
- Section currently mentions `list_users_for_role_management` — verify its description doesn't make a claim about `current_organization_id`-based membership semantics that this PR invalidates
- If yes: update to cite `accessible_organizations` and link to the new migration
- Bump `last_updated` to ship date
- **Time estimate**: 15 minutes

### 4.2 Optional: note the GIN index is now load-bearing for 4 RPCs in `tables/users.md`
- The `idx_users_accessible_orgs_gin` section already calls out the predicate-shape requirement and lists `api.list_users` as the consumer
- Add a one-line note that the three sister RPCs also use it post-PR
- Bump `last_updated`
- **Time estimate**: 5 minutes

### 4.3 Run docs Drift Checklist
- Combined docs-writing skill + AGENT-GUIDELINES checks per the discipline established in PR #66
- **Time estimate**: 5 minutes

## Phase 5: Frontend validation (no code change expected)

The frontend types (`database.types.ts`, `rpc-registry.generated.ts`) should be byte-identical to current state because:
- No signature change (params, returns unchanged)
- No new functions added or dropped
- COMMENT body changes don't affect generated TS types

Confirm via:
- `cd frontend && npm run typecheck && npm run lint && npm run docs:check && npm run build`
- All four checks must be green

- **Time estimate**: 5 minutes

## Phase 6: PR + closeout

### 6.1 Open PR
- Branch: `feat/list-users-sister-functions-membership-gating` (off main)
- Title: `fix(api): list_users sister RPCs gate membership by accessible_organizations not current_organization_id`
- Body: enumerate the three functions changed, cite PR #66 as the convention origin, call out super_admin invisibility as known-out-of-scope, note explicitly that PR #66's `COUNT(*) OVER ()` pattern is intentionally NOT applied here (these three RPCs don't return `total_count` — pagination total is consumer-side). Include before/after EXPLAIN if interesting (won't be — all three are tiny dev queries; index engagement is the same as PR #66)
- **Time estimate**: 15 minutes

### 6.2 Self-review (architect-style)
- Apply the same review checklist used on PR #66
- Verify: predicate shape correct, no over-restriction regression, no tenancy guard needed (the three RPCs already have permission gates — `has_effective_permission('user.role_assign', ...)` for two; `get_current_org_id()` for schedule)
- **Time estimate**: 15 minutes

### 6.3 UAT post-merge
- Mechanical: re-deploy via CI; EXPLAIN sanity; CI gate for rpc-registry passes
- UI (if a test subject can be synthesized in dev easily): johnltice (testorg admin) opens RolesManagePage → delete a role with assignments → verify the assigned-users dialog includes the synthetic multi-org user
- **Time estimate**: 30 minutes

### 6.4 Archive + memory closeout
- `git mv dev/active/list-users-sister-functions-membership-gating/ dev/archived/`
- Append closeout block to tasks.md
- Update MEMORY.md last-groomed entry; demote previous entries one rung
- The `pr-66-close-out.md` memory file already captures the `@>` convention — no new memory file needed unless surprises emerge
- **Time estimate**: 20 minutes

## Success Metrics

### Immediate
- [ ] All three function bodies in dev use `accessible_organizations @>` predicate (verified via `pg_get_functiondef`)
- [ ] Synthesized multi-org subject appears in all three sister RPCs against the secondary org
- [ ] Regression-free: pre-existing single-org users still appear correctly

### Medium-Term
- [ ] PR merges with re-review verdict (or zero new findings)
- [ ] No CI gate regressions (`rpc-registry-sync.yml`, frontend gates all green)
- [ ] Card archived to `dev/archived/`

### Long-Term
- [ ] When the cross-tenant grant pipeline ships (per `sub-tenant-admin-design/`), multi-org users are visible in role/schedule admin UIs by default — no separate fix needed
- [ ] Future contributors writing user-listing RPCs follow the unified `accessible_organizations` membership pattern

## Implementation Schedule

| Phase | Duration | Cumulative |
|---|---|---|
| Phase 1 — Pre-flight | 15 min | 15 min |
| Phase 2 — Migration | 40 min | 55 min |
| Phase 3 — SQL smoke | 50 min | 1h 45m |
| Phase 4 — Documentation | 25 min | 2h 10m |
| Phase 5 — Frontend validation | 5 min | 2h 15m |
| Phase 6 — PR + closeout | 80 min | 3h 35m |

**Realistic estimate**: half a day end-to-end including PR review wait time.

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Synthesizing a multi-org test subject requires triggering full invitation lifecycle (slow + state-mutating on dev) | Use direct SQL insert into `user_organizations_projection` (the trigger reconciles `accessible_organizations` mechanically); cleanup via DELETE |
| One of the three RPC bodies has drifted since 2026-05-19 (someone else touched it) | Phase 1.1 re-confirms; if drift exists, integrate the new shape and update the migration accordingly |
| Migration body iteration mid-PR (as in PR #66) | Use `supabase migration repair --status reverted` + re-push pattern from `memory/pr-63-close-out.md` (safe on feature branches) |
| Tenancy guard accidentally needed | The three RPCs already have permission gates (`user.role_assign` for two, `user.schedule_manage` for schedule). The membership predicate change doesn't broaden the attack surface beyond what those gates already allow. Confirm in self-review. |
| docs:check or rpc-registry CI gate fails | Both already proven on PR #66; signature is unchanged so neither should trip. If they do, treat as a normal CI failure and fix in-PR. |
| Super_admins still invisible (the known concern) | Acknowledged out-of-scope; document in the PR description so reviewers don't flag as a new issue. |

## Risks NOT Mitigated (acknowledged out of scope)

- **Super_admin invisibility in narrow-scope UIs**: super_admins (`current_organization_id = NULL`, `accessible_organizations IS NULL` per live dev — note: `memory/pr-66-close-out.md` mis-states this as `= []`; correct on next groom) remain invisible in all three sister UIs after this fix. PostgreSQL: `NULL::uuid[] @> ARRAY[v_org_id]::uuid[]` returns `NULL`, which WHERE clauses treat as not-matching → excluded. Super_admins have global permissions and rarely have specific `role_id` assignments at narrow ltree paths, so this is probably correct behavior — but if UX feedback says otherwise, file a separate card.
- **Reframing `current_organization_id` semantics**: stays as the active-session pointer for direct-care use.
- **Routing-quirk symptoms** in `dev/active/investigate-auth-callback-priority-2-fallthrough.md`: different bug class.
- **Trigger-into-handler refactor** for `sync_accessible_organizations`: decided "needlessly heavy" during PR #66.

## Next Steps After Completion

After this card archives, the unified-visibility model is property of the system: all four `list_users*` RPCs share one membership oracle. Natural follow-ups (not blocking):

1. If super_admin invisibility becomes a real UX issue, file a card to special-case `has_platform_privilege()` in the sister functions
2. If the broader "URL-bar-vs-data divergence" observation from PR #66 T8 becomes painful, that's a separate cross-cutting card
3. When `sub-tenant-admin-design/` work picks up, the membership predicate stays correct for the new multi-org grant flow — no rework needed

## Related

- **Origin / convention source**: `dev/archived/users-list-omits-roleless-members/` (PR #66, merged 2026-05-20). Memory: `memory/pr-66-close-out.md`.
- **Architectural reference**: `documentation/architecture/data/provider-partners-architecture.md` — explains why multi-org users will become more common as cross-tenant grants land.
- **Trigger maintaining the membership oracle**: `public.sync_accessible_organizations()` (AFTER INSERT/UPDATE/DELETE on `user_organizations_projection`).
- **Docs requiring review during Phase 4**: `documentation/architecture/authorization/rbac-architecture.md`, `documentation/infrastructure/reference/database/tables/users.md`.
- **Pattern memory**: `memory/pr-66-close-out.md` — GIN `@>`-vs-`= ANY` predicate trap, read-RPC tenancy-guard pattern (not used here but documented), `COUNT(*) OVER ()` dedup precedent (not used here — these three RPCs don't paginate count separately).
