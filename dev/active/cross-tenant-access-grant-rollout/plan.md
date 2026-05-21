# Cross-tenant access grant — architecture, rollout, and existing-RPC audit

**Status**: seed (Phase 0 — design discussion needed before any implementation)
**Priority**: Medium-High (blocks: any UI/workflow work that needs `provider_partner` users to administer at `provider` orgs; latent correctness bug in 2 mutation RPCs that will activate the moment `compute_effective_permissions` is changed to support multi-scope grants)
**Origin**: PR #67 (`feat/list-users-sister-functions-membership-gating`) review-response phase, 2026-05-21. Threat-model audit during that PR (three parallel Explore agents) surfaced cross-tenant-grant forward-compatibility as the load-bearing future concern. PR #67's scope was deliberately narrowed to normalize the three sister RPCs only; this card picks up the broader work.

## Why this card exists

Two distinct but coupled concerns surfaced in PR #67 and were deliberately deferred:

1. **No end-to-end "how do cross-tenant grants actually work?" architecture exists yet.** Foundation tables (`cross_tenant_access_grants_projection`) and a stub `public.has_cross_tenant_access(...)` helper exist in `baseline_v4.sql` — both date to 2025-12-02. But there's no shipped grant-creation flow, no JWT-claim shape decision for multi-org consultants, no RLS-policy precedent that consults the grant table, and no clear answer to "does a consultant call `api.list_users(<providerA>)` or a different RPC?" Without that architecture, any audit of existing RPCs (concern #2) lacks a target to audit against.

2. **At least 2 existing RPCs carry a latent correctness bug** that will activate the moment `compute_effective_permissions` is modified to support multi-entry-per-permission JWTs (necessary for grants). The bug class is documented in `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/pr-67-close-out.md` under "Operational tripwire — before modifying `compute_effective_permissions`": `api.bulk_assign_role` (baseline_v4:L362) and `api.sync_role_assignments` (baseline_v4:L5571) still use the `get_permission_scope + manual ltree @>` two-step pattern. When DISTINCT ON is relaxed, `get_permission_scope`'s `LIMIT 1` semantics start picking arbitrarily from the multi-entry JWT array, producing intermittent permission failures for multi-scope users.

Plus a third concern that needs the architecture too:

3. **PR #66's `api.list_users` tenancy guard is potentially grant-incompatible.** The guard `IF NOT (has_platform_privilege() OR p_org_id = get_current_org_id()) THEN RETURN; END IF;` blocks a consultant with `accessible_organizations @> [home, providerA]` from calling `api.list_users(<providerA>)` because their JWT `org_id` stays at home org. Whether to refactor this depends on the Phase 0 answer to "are consultants ever supposed to call `api.list_users`?"

The cleanest sequencing is: **Phase 0 first** (design the grant architecture), then audit/refactor existing RPCs against the chosen design.

## Reference material (READ BEFORE Phase 0)

### Memory files

These memory files (in `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/`) capture the architectural context that produced this card. Read all three before starting Phase 0:

- **`pr-66-close-out.md`** — PR #66 close-out. Establishes the `accessible_organizations @>` membership-oracle convention and the early-return tenancy-guard pattern used by `api.list_users`. **Key sections to read**:
  - "Key architectural learnings → Read-RPC tenancy-guard pattern (early return for TABLE-returning)" — the guard shape this card may need to revisit
  - "All 7 review findings + resolutions" — for the predicate-shape convention
- **`pr-67-close-out.md`** (pre-merge stub) — captures the THREAT-MODEL audit + operational tripwire that produced this card. **Key sections to read**:
  - "Deferred: cross-tenant-grant audit" — the central forward-incompatibility finding for PR #66's guard, plus the Bucket D (~88 entity-lookup + RLS) audit reminder
  - "Operational tripwire — before modifying `compute_effective_permissions`" — the mandatory pre-flight checklist when the `DISTINCT ON` invariant changes, including the 4-site distribution of the legacy two-step pattern
- **`feedback-branch-on-decision.md`** — when implementation phases begin, the branch-on-decision rule applies (branch immediately at "let's work on Phase N", before any working-tree edit).

### Repository documents

- **`documentation/architecture/data/provider-partners-architecture.md`** — the existing canonical statement of how `provider_partner` orgs relate to `provider` orgs. Read fully. Notable: grant flow, authorization-type-specific backing tables (VAR partnership, court order, agency assignment, family consent), and the planned RLS policy pattern at L305-411. **Status of that doc**: the architecture is largely described but the implementation is staged ("⏳ Planned" markers).
- **`dev/active/sub-tenant-admin-design/`** — related but distinct card covering intra-tenant OU-bounded user identity. Phase 0 should explicitly resolve how (or whether) this card's work intersects with the sub-tenant card's work.
- **`infrastructure/supabase/CLAUDE.md`** § "`list_users*` family pattern — three-step skeleton" (added by PR #67) — the convention that future grant-callable RPCs should fit into.
- **Baseline RPC definitions**: `cross_tenant_access_grants_projection` table (`baseline_v4.sql:7265`), `public.has_cross_tenant_access(...)` stub (L9807-9823 — currently returns FALSE; awaiting this card's design).

## Phase 0 — Architecture design (the core of this card)

**No code; no migrations; no PR.** Phase 0 produces a written design document that subsequent phases implement.

Required outputs of Phase 0:

### 0.1 Threat model statement

A short canonical statement (paragraph or bullet list) that defines:

- What cross-tenant PII access the platform PREVENTS (and how each control enforces it: RLS, JWT claims, RPC gates, grant-table checks).
- What cross-tenant PII access the platform PRESERVES (which user populations can see what, when, why).
- Where the "tenancy boundary" actually lives (which storage layer enforces it; what the invariants are).
- The single sentence that future RPC authors should be able to copy into their function header as a tenancy-doctrine reference.

### 0.2 JWT claim shape for multi-org consultants

Decide and document:

- For a consultant with active grants to two `provider` orgs (plus their home `provider_partner` org), what does the JWT actually carry?
  - `org_id`: stays at home, or switches per-session, or new field for grant-active orgs?
  - `accessible_organizations`: includes all grant-target orgs? (this is what PR #67's predicate assumes)
  - `effective_permissions`: includes grant-derived permissions at the grant's scope? If yes, does this require relaxing `compute_effective_permissions`'s `DISTINCT ON (permission_name)`?
  - Any new claim needed (e.g., `active_grants` array; `partner_role`; etc.)?
- Decide the JWT issuance flow: when a consultant logs in, where do grant-derived permissions come from? Is `compute_effective_permissions` extended, or is there a separate emit path for grant permissions?
- Confirm the operational tripwire from `pr-67-close-out.md` — if the answer is "yes, relax DISTINCT ON," the implementation phase MUST include the legacy-two-step audit (concern #2 above) IN COORDINATION with the JWT-shape migration.

### 0.3 RPC reachability matrix

For each existing RPC class (use the 5 buckets from PR #67's audit: A explicit-org-param, B JWT-bound, C scope-path-bound, D entity-lookup+RLS, E global), decide:

- Is this class **callable by consultants** under the grant model? (Yes / No / Sometimes-conditional-on-grant-type)
- If callable: does the existing guard pattern correctly identify a consultant with a valid grant? Specific function-level decisions:
  - `api.list_users` (PR #66 — Bucket A): is the org-internal-admin-only assumption correct, or do consultants need to enumerate the host-org user list? If they do, this is concern #3 — refactor the guard.
  - `api.list_users_for_*` (PR #67 — Bucket C / B): already grant-compatible per PR #67. Phase 0 should confirm this is the right architectural choice (not just a fortunate accident).
  - Bucket D (~88 entity-lookup + RLS RPCs): does the RLS policy layer need updates to consult `cross_tenant_access_grants_projection`? This is potentially the largest line-count change. The architecture doc at `documentation/architecture/data/provider-partners-architecture.md:305-411` sketches the RLS-with-grants pattern; Phase 0 confirms or revises.

### 0.4 Grant creation / revocation / authorization-type backing

Define the WRITE side that's currently stub-only:

- Which RPC(s) create a grant? Which Edge Functions? Which UI?
- Authorization-type-specific backing tables (`var_partnerships_projection`, court orders, agency assignments, family consents) — which are needed for v1 of this rollout vs. deferred?
- Revocation: explicit event-type? When does revocation cascade to invalidate active JWT claims (which can't be revoked mid-session)?

### 0.5 Phasing decision

Given the design in 0.1–0.4, decide and document:

- Phase 1: which slice of the design ships first? (Likely: JWT-shape migration + `compute_effective_permissions` relaxation + the legacy-two-step audit/fix in lockstep, because that's the operational tripwire that can't be split.)
- Phase 2+: grant creation/revocation RPCs, UI, authorization-type backing tables, RLS policy updates.
- Each phase becomes a downstream card (or sub-phase of this card if scope stays manageable).

Phase 0 deliverable: a written ADR or design doc (TBD: own file under `documentation/architecture/decisions/` or extension of `provider-partners-architecture.md`) plus a 1-pager summary in this card's `tasks.md` recording the Phase 0 outcomes.

## Phase 1+ — TBD pending Phase 0

To be defined by Phase 0's phasing decision. Likely shape (not committed):

- Phase 1: JWT-shape migration + DISTINCT ON relaxation + audit/fix the 2 remaining two-step-pattern callers (`bulk_assign_role`, `sync_role_assignments`) per the `pr-67-close-out.md` tripwire procedure. This phase has a HARD COORDINATION REQUIREMENT: the legacy-pattern fixes must ship in the SAME migration (or strictly prior) as the `compute_effective_permissions` change, or multi-scope users hit intermittent permission failures.
- Phase 2: grant-creation RPCs + Edge Functions (if needed; per provider-partners-architecture.md the orchestration may be all-SQL).
- Phase 3: PR #66's `api.list_users` audit + refactor (if Phase 0 decides consultants should be able to call it).
- Phase 4: Bucket D RPC audit at the RLS layer — extend RLS policies to consult `cross_tenant_access_grants_projection`. Per the architecture doc this is the canonical mechanism for grant-derived data access.
- Phase 5: Authorization-type backing tables and their CRUD (VAR partnerships, court orders, etc.) — these may be partially staged depending on which authorization type is needed first.
- Phase N: UI flows for grant creation/revocation/visibility.

## Out of scope (acknowledged; separate cards exist or will)

- **Sub-tenant admin / OU-bounded intra-tenant identity**: `dev/active/sub-tenant-admin-design/`. Related but distinct mechanism (within-org granularity, not across-org grants).
- **`investigate-auth-callback-priority-2-fallthrough.md`**: routing-tier intermittent fall-through. Different bug class.
- **`superadmin-no-org-context-on-tenant-subdomain/`**: super_admin session quirk. Different concern.

## Branch-on-decision reminder

This card is currently in design-discussion-only mode. Phase 0 produces a written doc + design decisions — NO code, no migrations, no PR. The first commit related to this card's implementation begins Phase 1, at which point:

1. **Branch immediately** (`git checkout -b feat/cross-tenant-access-grant-phase-1-jwt-shape` or similar) — per the rule in `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/feedback-branch-on-decision.md`, before any working-tree edit.
2. **Migration coordination**: per `pr-67-close-out.md` tripwire, the legacy-pattern audit/fix MUST ship in the same migration as the `compute_effective_permissions` change. Sequence the migration plan accordingly.
3. **Test harness**: the transactional-smoke pattern from PR #67 Phase 3 (`BEGIN; ... ROLLBACK;` with JWT-claim simulation) is the right shape for synthesizing multi-scope users during Phase 1 UAT. Reuse.

## Related cards / files

- **`dev/active/sub-tenant-admin-design/`** — sibling design-space card; Phase 0 must resolve intersection
- **PR #66** (merged 2026-05-20, commit `33e77a4f`) — origin of `accessible_organizations @>` convention; tenancy-guard pattern to potentially revisit
- **PR #67** (open as of 2026-05-21) — origin of this card's deferral; the three sister RPCs already use grant-compatible scope-bound permission checks
- **Memory file**: `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/pr-66-close-out.md` — predicate/guard convention origin
- **Memory file**: `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/pr-67-close-out.md` — deferred-concern + operational-tripwire detail
- **Architecture doc**: `documentation/architecture/data/provider-partners-architecture.md` — existing canonical grant-flow sketch; status mostly "⏳ Planned"
- **Baseline stub**: `public.has_cross_tenant_access(...)` (baseline_v4:9807-9823) — currently returns FALSE; Phase 0 decides whether to extend, replace, or deprecate
- **Baseline table**: `cross_tenant_access_grants_projection` (baseline_v4:7265) — the canonical grants table; Phase 0 confirms or revises the schema
