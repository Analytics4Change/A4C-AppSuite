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

**Phase**: Phase 0 — Architecture design (0.1 + 0.2 SHIPPED; 0.3-0.5 pending)
**Status**: ADR landed 2026-05-26 (`documentation/architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md`); architect-reviewed pre-write; provider-partners-architecture.md updated to reference; AGENT-INDEX.md updated
**Last Updated**: 2026-05-26
**Next Step**: Re-enter plan mode for 0.3 (RPC reachability matrix) against the now-locked JWT shape. 0.4 (grant write-side) follows; the locked `grant_role_templates` separate-table decision is its starting input.

---

## Phase 0 — Outcomes (sections 0.1 + 0.2)

### Decisions locked

1. **JWT shape** → Path B (extend `compute_effective_permissions`). Path A (RLS-only) and Path C (separate `active_grants` claim) rejected — see ADR Alternatives.
2. **Grant permission source** → hybrid snapshot. Resolved permissions snapshotted into `cross_tenant_access_grants_projection.permissions` (jsonb) at grant-creation time; `compute_effective_permissions` reads jsonb directly with no template join at JWT issuance.
3. **DISTINCT ON formulation** → asymmetric `DISTINCT ON (permission_name, scope_path)` (NOT blanket drop). Role-source permissions widen by `nlevel ASC`; grant-source permissions do not widen (each grant gets its own entry).
4. **Template ownership** → separate `grant_role_templates` table (NOT `is_grant_role` flag on `role_permission_templates`). Schema details deferred to 0.4.
5. **Implication propagation for grants** → NO by default; opt-in via new `permission_implications.propagate_through_grants boolean DEFAULT false`. HIPAA-least-authority grounds.
6. **Snapshot policy-override mechanism** → event-sourced (`access_grant.policy_override_applied` event; admin RPC `api.revoke_permission_across_grants`). Phase 1 ships handler-only; emitter ships Phase 2.

### Threat-model paragraph (quotable; future RPC authors copy from here)

> A user can read or write data whose `organization_id` falls within the ltree subtree rooted at one of their *legitimate access points*. A user's legitimate access points are the UNION of: **(a)** every organization in `public.users.accessible_organizations` (direct role membership maintained by `sync_accessible_organizations` triggers off `user_organizations_projection` and — under this ADR — off `cross_tenant_access_grants_projection`); and **(b)** every `provider_org_id` referenced by an `active`, in-window row in `cross_tenant_access_grants_projection` where the user is the `consultant_user_id` (or `consultant_user_id IS NULL` AND the user's home org matches `consultant_org_id`), bounded by the grant's `scope` and `scope_id`. Cross-tenant access at the data tier is enforced by RLS policies consulting `public.has_cross_tenant_access(...)` (the canonical predicate; currently a stub returning FALSE, made real in Phase 1). Super_admin (`has_platform_privilege() = TRUE`) cross-tenant access is unrestricted by this rule; **impersonation sessions** (`impersonation_sessions_projection`) are a SEPARATE time-bound, justification-required, audited cross-tenant pathway used by super_admins to act-as a tenant-scoped user — they are NOT super_admin access. All other cross-tenant reads are denied at the RLS layer.

**One-sentence corollary** (RPC header reference):

> Cross-tenant data access requires an active, in-scope row in `cross_tenant_access_grants_projection` linking the caller's home org to the target org with the resolved permission snapshot at grant-creation time; mediation is enforced at the RLS layer (`public.has_cross_tenant_access(...)` is the canonical predicate).

### Two-flow distinction (for new contributors)

Consultants do NOT receive cross-tenant access via the normal invite-user / role-assignment mechanism:

- **Consultant's home-org identity** → normal `invite-user` → `user.invited` → `accept-invitation` → `user.created` + `user.role.assigned`. Creates `auth.users`, `public.users`, and a `user_roles_projection` row IN THE PARTNER ORG.
- **Grant write-side** (Phase 2) → emit-grant RPC (TBD; resolves `grant_role_templates` + admin overrides to permission snapshot) → `access_grant.created` event → `process_access_grant_event` handler. Creates a `cross_tenant_access_grants_projection` row with `permissions jsonb` populated. **NO `user_roles_projection` row at the provider org.**

The grant projection IS the source of truth for cross-tenant access.

### Phase 1 migration manifest (must-pair, single transactional file)

1. `CREATE OR REPLACE FUNCTION public.compute_effective_permissions(...)` — tightened DISTINCT ON; new `grant_derived_perms` CTE; opt-in implication propagation.
2. `ALTER TABLE public.permission_implications ADD COLUMN propagate_through_grants boolean NOT NULL DEFAULT false`.
3. `CREATE OR REPLACE FUNCTION public.custom_access_token_hook(...)` — rebase on `20260226002002_organization_manage_page_phase1.sql` body; preserve org-is-active gate, `access_blocked` branch, exception branch; bump `claims_version` to 5.
4. `CREATE OR REPLACE FUNCTION public.sync_accessible_organizations_from_grants() RETURNS trigger` + `CREATE TRIGGER trg_sync_accessible_orgs_from_grants AFTER INSERT OR UPDATE OR DELETE ON public.cross_tenant_access_grants_projection ...`.
5. **One-time backfill** of `public.users.accessible_organizations` from existing active grants (idempotent via `DISTINCT unnest`; sketch in ADR Consequences).
6. `CREATE INDEX idx_access_grants_consultant_user_status_partial ON public.cross_tenant_access_grants_projection (consultant_user_id, status) WHERE status='active';`
7. `CREATE OR REPLACE FUNCTION api.bulk_assign_role(...)` — normalize legacy two-step pattern.
8. `CREATE OR REPLACE FUNCTION api.sync_role_assignments(...)` — same.
9. `COMMENT ON FUNCTION ... '@a4c-rpc-shape: envelope'` re-tags for both (M3 RPC Shape Registry CI invariant).
10. `ALTER TABLE public.cross_tenant_access_grants_projection ADD CONSTRAINT ... CHECK (authorization_type IN (5 canonical values));`
11. `CREATE TABLE public.grant_role_templates (...)` — Phase 0.4 schema; Phase 1 stub acceptable.
12. Add `access_grant.policy_override_applied` handler branch to `process_access_grant_event()` (no emit RPC yet).

**Post-migration deliverables (same PR)**: regenerate `frontend/src/types/database.types.ts` AND `workflows/src/types/database.types.ts`; reconcile `provider-partners-architecture.md` `authorization_type` list to 5 values (DONE 2026-05-26); five-tier JWT consumer audit (PL/pgSQL / frontend / Edge Functions / workflows / RLS).

### Downstream decisions now unblocked

- **0.3** RPC reachability matrix — directly benefits from Path B being locked (Bucket C RPCs serve consultants natively; Bucket A needs Phase 3 refactor; Bucket D needs Phase 4 RLS audit).
- **0.4** grant write-side — directly benefits from `grant_role_templates` separate-table being locked.
- **0.5** phasing decision — Phase 1 manifest above is the Phase 1 commit; 0.5 sequences Phases 2-N.

### Explicit deferrals (not blocked, just not decided yet)

- `grant_role_templates` schema (column list, FKs, RLS policies) → 0.4.
- Grant revocation → session-invalidation signal (Supabase Auth refresh-token revocation? per-grant ban?) → Phase 2.
- Full `api.revoke_permission_across_grants` RPC body → Phase 2 (Phase 1 ships handler-only).

### Architect-review provenance

Plan at `/home/lars/.claude/plans/deep-snacking-globe.md` was independently architect-reviewed (software-architect-dbc) on 2026-05-22 — verdict APPROVE WITH IN-PR FIXES. Five factual claims were refuted (composite-index keying, PR #66 guard citation, `organizations_projection.type` CHECK line number, projection column count, `authorization_type` CHECK existence) and four sub-decisions were promoted from "deferred to 0.4 / Phase 1" to "locked at 0.2": asymmetric DISTINCT ON formulation, separate `grant_role_templates` table, opt-in implication propagation default (overrode initial YES → NO on HIPAA grounds), event-sourced policy-override mechanism. All architect findings are folded into the shipped ADR.
