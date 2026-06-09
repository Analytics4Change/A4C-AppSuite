# Investigate auth-hook latency regression (Phase 1 → Phase 2 timeframe)

**Status**: seed (not yet planned)
**Priority**: Medium (no production user-facing impact yet; dev-side measurement only; baseline drift is real but cause is unclear)
**Origin**: PR #71 (cross-tenant grant Phase 2) Stage E measurement (2026-06-09) + architect review direction (software-architect-dbc, 2026-06-09)

## Problem

Phase 2 Stage E auth-hook latency re-measurement against dev showed **p50=1.435ms, p95=1.496ms** (n=100, post-warmup, MATERIALIZED CTE via Mgmt API SQL endpoint). This exceeds the Phase 2 Stage E clearance criterion (≤2× Stage B baseline = 0.25ms p95).

Reference points:

| Measurement | When | p50 | p95 | Source |
|---|---|---|---|---|
| Phase 1 Stage B baseline | 2026-06-04 | 0.085 ms | 0.126 ms | `dev/active/cross-tenant-grant-phase-2-write-side/tasks.md` L22 |
| Phase 1 Stage E (post-deploy) | 2026-06-03 | 0.202 ms | 0.228 ms | `dev/active/cross-tenant-grant-phase-2-write-side/tasks.md` L356 |
| Phase 2 Stage E (post-deploy) | 2026-06-09 | 1.435 ms | 1.496 ms | This card / PR #71 body |

Direct EXPLAIN ANALYZE on `compute_effective_permissions(p_user_id, p_org_id)` yielded **Execution Time: 5.9 ms** (post-ANALYZE on every projection touched). The auth-hook wrapper itself is thin; nearly all the latency is in that function.

## Why this matters

- Auth-hook latency is on every authenticated request's critical path during JWT mint. A 12× regression at the database tier compounds into perceived login lag and noisy 429-from-pooler patterns under concurrent traffic.
- The Phase 2 PR architect-cleared this with **"investigate separately, don't block"** because Phase 2 makes zero changes to:
  - `compute_effective_permissions` body
  - `custom_access_token_hook` body
  - `users` / `user_roles_projection` / `cross_tenant_access_grants_projection` columns the hook reads
  - RLS policies on those tables
  - Indexes the hook query touches
  - There are zero `ANALYZE` / `VACUUM` / `REINDEX` statements in the migration
- Tiny cardinalities on dev (9 users / 51 perms / 10 user_roles / 0 grants / 0 partnerships) argue strongly against a planner cost regression — at this scale, the function should be sub-millisecond.

## Hypotheses (ordered by likelihood)

1. **Pre-existing project-side regression** between 2026-06-03 (Phase 1 close-out) and 2026-06-09 (Phase 2 PR open). Most likely cause:
   - Supabase platform-side query-planner version bump or executor change
   - Statistics drift on a different cardinality-driving table (the `seeds/*` reseeds during PR-71 migration didn't touch user / role tables, but other ambient activity could have)
   - Container resource contention on the shared dev compute pool
2. **Mgmt API SQL endpoint overhead** changed between the two measurements. Stage B baseline used the same endpoint; both used `clock_timestamp()` so endpoint overhead should not be included in the latency window — but worth verifying.
3. **Plan-cache invalidation** from the Phase 2 migration that hasn't fully resettled. Less likely since EXPLAIN ANALYZE shows steady-state 5.9ms across repeated calls.
4. **`SET search_path` overhead** changed somehow. Both `compute_effective_permissions` and `custom_access_token_hook` carry `SET search_path TO 'public', 'extensions', 'pg_temp'` per the migration-session search-path gotcha; the SET evaluation happens on every call. Less likely to suddenly cost 5ms.

## Investigation plan

### Phase 0 — Reproduce + characterize (1 hr)

1. Re-run the Stage E measurement methodology on dev with `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` to see which step in `compute_effective_permissions` is the bottleneck.
2. Re-run on staging (if available) to see if the regression is dev-specific or project-wide.
3. Compare the deployed `compute_effective_permissions` body against the Phase 1 deploy version via Mgmt API `pg_get_functiondef` — verify there's no silent drift.

### Phase 1 — Bisect (2-4 hr)

4. Reset dev statistics with `ANALYZE` on all projection tables. Re-measure.
5. Capture `pg_stat_user_functions` for `compute_effective_permissions` and `custom_access_token_hook`. Look at total_time / calls to confirm steady-state.
6. If platform-side suspected: open a support ticket with Supabase referencing the measurement methodology, the cardinality state, and the 12× regression.

### Phase 2 — Mitigate (only if Phase 1 finds a code-side root cause)

7. If a plan regression is the cause, force a generic plan via `plan_cache_mode = force_generic_plan` for the hook session, or prepared-statement the inner query.
8. If a code path is the cause, fix in a focused migration with a dedicated re-measure probe before merge.

## Acceptance criteria

The investigation is closed when:

- Root cause is identified (code-side or platform-side).
- Either (a) measurement is re-baselined and accepted as the new floor, OR (b) a fix lands and p95 returns to ≤0.5ms.
- Stage E clearance criterion in the Phase 2 card is updated with the resolved baseline + clearance window for any future Phase 3/4 measurements.

## Out of scope

- Phase 3/4/N rollout work (parent card `cross-tenant-access-grant-rollout/`).
- Production-side measurement (this card is dev-tier; if reproduced on production, escalate via the runbook).
- General DB performance audit unrelated to the auth-hook path.

## Files involved

- `infrastructure/supabase/handlers/...` — no direct handler files (the function is in baseline_v4)
- `infrastructure/supabase/supabase/migrations/20260212010625_baseline_v4.sql` — `compute_effective_permissions` source-of-truth body (lines ~6932-6985)
- `infrastructure/supabase/supabase/migrations/20260601174841_cross_tenant_grant_phase_1_jwt_shape.sql` — Phase 1 changes (Phase 1 didn't modify the hook either, but it added the grant-derived branch to `compute_effective_permissions` UNION; the cardinality of `cross_tenant_access_grants_projection` is 0 on dev so this branch should be empty)
- `dev/active/cross-tenant-grant-phase-2-write-side/tasks.md` — Stage E measurement evidence
- `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/pr-70-close-out.md` — Phase 1 close-out reference latency
