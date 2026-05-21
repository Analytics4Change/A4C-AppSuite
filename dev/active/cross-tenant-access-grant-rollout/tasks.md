# Tasks — cross-tenant-access-grant-rollout

## Phase 0: Architecture design (NO code; design discussion only)

### 0.0 Pre-reads (do first)

- [ ] Read `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/pr-66-close-out.md` § "Key architectural learnings" — `accessible_organizations @>` membership-oracle convention + early-return tenancy-guard pattern
- [ ] Read `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/pr-67-close-out.md` (pre-merge stub) — full file, especially "Deferred: cross-tenant-grant audit" and "Operational tripwire — before modifying `compute_effective_permissions`"
- [ ] Read `documentation/architecture/data/provider-partners-architecture.md` in full
- [ ] Read `dev/active/sub-tenant-admin-design/` in full to understand intersection
- [ ] Read `infrastructure/supabase/CLAUDE.md` § "`list_users*` family pattern — three-step skeleton" (added by PR #67) to understand the convention future grant-callable RPCs should fit into

### 0.1 Threat-model statement

- [ ] Write the canonical threat-model statement (one paragraph; what's prevented, what's preserved, where the boundary lives)
- [ ] Identify the single sentence future RPC authors should be able to copy as tenancy-doctrine reference
- [ ] Decide doc home: extend `provider-partners-architecture.md` OR new ADR at `documentation/architecture/decisions/adr-cross-tenant-access-grant-model.md`

### 0.2 JWT claim shape for multi-org consultants

- [ ] Decide `org_id` claim semantics for consultants: stays at home / switches / new field
- [ ] Decide `accessible_organizations` semantics: includes grant-target orgs (likely yes, matches PR #67's predicate assumption)
- [ ] Decide `effective_permissions` semantics: grant-derived entries added; how (via `compute_effective_permissions` extension vs. separate emit path)?
- [ ] Decide whether `compute_effective_permissions`'s `DISTINCT ON (permission_name)` is relaxed
- [ ] **If yes to DISTINCT ON relaxation**: confirm Phase 1 coordination requirement — the legacy-two-step audit (Section 0.5 below) MUST ship in the same migration or strictly prior
- [ ] Identify any new claim needed (`active_grants` array? `partner_role`?)
- [ ] Decide JWT issuance flow for consultant login: where do grant-derived permissions come from?

### 0.3 RPC reachability matrix

For each of the 5 buckets identified in PR #67's audit, decide consultant-callability and audit consequences:

- [ ] **Bucket A** (explicit-org-param: `api.list_users`): consultants callable? If yes, refactor PR #66's tenancy guard (see plan.md concern #3)
- [ ] **Bucket B** (~17 JWT-bound: e.g., `api.list_users_for_schedule_management`, `api.assign_client_to_user`): inventory which should be consultant-callable
- [ ] **Bucket C** (~5 scope-path-bound: e.g., the two role-functions PR #67 normalized): confirm grant-compatibility is architectural (not just accidental)
- [ ] **Bucket D** (~88 entity-lookup + RLS): decide whether RLS policies need updates to consult `cross_tenant_access_grants_projection`. This may be the largest single piece of work in this card.
- [ ] **Bucket E** (~14 global): typically grant-irrelevant; confirm

### 0.4 Grant creation / revocation / authorization-type backing

- [ ] Decide RPC shape(s) for grant creation: `api.create_access_grant(...)`? Edge Function orchestration if external API needed?
- [ ] Decide authorization-type backing tables for v1: which ones (VAR partnerships, court orders, agency assignments, family consents) need to ship in Phase 1+ vs. defer
- [ ] Decide revocation event-type + cascade behavior; document JWT-claim staleness window (revocation can't invalidate in-session JWT; how is this handled?)

### 0.5 Phasing decision + Phase 1 sequencing

- [ ] Decide which Phase 1 slice ships first
- [ ] **HARD COORDINATION CONFIRMATION**: if Phase 1 includes the `compute_effective_permissions` relaxation, it MUST also include the audit + fix of `api.bulk_assign_role` (baseline_v4:L362) and `api.sync_role_assignments` (baseline_v4:L5571) — the two remaining `get_permission_scope + manual @>` two-step-pattern callers per `pr-67-close-out.md` tripwire. Same migration or strictly prior.
- [ ] Plan downstream cards for subsequent phases (or commit to keeping them in this card's sub-phases)

### 0.6 Phase 0 deliverable

- [ ] Write the design doc (location decided in 0.1) — captures 0.1–0.5 outcomes
- [ ] Update this card's plan.md "Phase 1+" section with the committed phasing decision
- [ ] Append "Phase 0 — Outcomes" summary to this tasks.md (1-page summary of decisions made)
- [ ] Architect review of the design doc before any Phase 1 work begins (mirror PR #67's plan-review architect pass)

## Phase 1+: To be defined by Phase 0 outcomes

Pending. Likely shape (NOT committed):

- Phase 1: JWT-shape migration + DISTINCT ON relaxation + legacy-two-step audit + fix `api.bulk_assign_role` + `api.sync_role_assignments` (coordinated single migration)
- Phase 2: grant creation / revocation RPCs + authorization-type backing tables
- Phase 3: PR #66's `api.list_users` audit/refactor (if consultants need to call it per 0.3)
- Phase 4: Bucket D RLS-layer audit + policy updates (largest scope)
- Phase 5: UI flows
- Phase N: testing harness for multi-scope-user scenarios; partner-consultant UX walkthroughs

## Operational reminders (apply to ALL implementation phases)

- [ ] **Branch-on-decision** (`memory/feedback-branch-on-decision.md`): branch immediately when starting any implementation phase, before any working-tree edit.
- [ ] **Transactional smoke harness** for multi-scope user UAT: reuse PR #67's `BEGIN; ... ROLLBACK;` pattern with JWT-claim simulation via `set_config('request.jwt.claims', ...)` (see `memory/simulate-jwt-claims-for-rpc-test.md`).
- [ ] **Migration-session `SET search_path`** for any migration that uses extension-typed parameters (`ltree`, `vector`, etc.) — see `infrastructure/supabase/CLAUDE.md` § "Migration-session `SET search_path` gotcha" (added by PR #67).
- [ ] **In-PR fixes over follow-up cards** (`memory/feedback-no-deferral-to-cards.md`): when reviewer findings are small and in-scope, fix in the open PR; cards are for genuinely separate bodies of work.

## Current Status

**Phase**: Phase 0 — Architecture design
**Status**: SEEDED 2026-05-21; awaiting design discussion to begin
**Last Updated**: 2026-05-21
**Next Step**: Complete the Phase 0 pre-reads (Section 0.0), then begin the threat-model statement (Section 0.1) — that's the gate that unlocks the rest of Phase 0.
