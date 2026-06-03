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

**Phase**: Phase 0 — Architecture design (0.1 + 0.2 + 0.3 + 0.4 + 0.5 SHIPPED; closing on merge of PR #68)
**Status**: All 5 sub-phase outcomes blocks complete (see sections below). 4 architect-review passes (one per sub-phase commit + one final cohesion pass on PR #68) with findings folded in. PR #68 open for external review.
**Last Updated**: 2026-05-26
**Next Step**: After PR #68 merges, seed `dev/active/cross-tenant-grant-phase-1-jwt-shape/` with plan.md tracking the 15-step migration manifest from ADR Consequences. Branch `feat/cross-tenant-grant-phase-1-jwt-shape` from main.

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

The canonical 15-step manifest lives in [adr-cross-tenant-access-grant-jwt-shape.md](../../../documentation/architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md) § Consequences → Phase 1 migration manifest. Single source of truth, post-PR-#68-cohesion-fix renumber. Do not duplicate the manifest here — that's exactly the F1/F6 drift class the PR #68 cohesion review eliminated.

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

---

## Phase 0.3 — Outcomes (RPC reachability matrix)

### Decisions locked

1. **Bucket A definition** → **strict**: only RPCs implementing the PR #66 early-return tenancy guard pattern (`IF NOT (has_platform_privilege() OR p_org_id = get_current_org_id()) THEN RETURN; END IF;`). Functions with `p_org_id` but RLS-only enforcement are Bucket D, not A.
2. **Deliverable shape** → **new reference doc + ADR addendum**. Matrix at `documentation/architecture/authorization/cross-tenant-access-grant-rpc-reachability-matrix.md`; ADR gains Phase 0.3 section with per-bucket decisions.
3. **Freshness mechanism** → **comment-driven codegen** (mirrors M3). New `@a4c-bucket` + `@a4c-consultant-callable` + `@a4c-consultant-callable-reason` tags in `COMMENT ON FUNCTION` per RPC. Phase 1 ships `frontend/scripts/gen-rpc-reachability-matrix.cjs` + `.github/workflows/rpc-reachability-matrix-sync.yml`. Matrix doc switches from hand-edited to generated.

### Verified counts (104 total `api.*` RPCs — post-architect-review correction)

| Bucket | R | W | Total | Phase target |
|---|---:|---:|---:|---|
| A (strict) | 1 | 0 | **1** | Phase 3 refactor (`api.list_users`) |
| A-variant | 1 | 0 | **1** | Phase 3 refactor (`api.list_invitations` — RAISE-not-RETURN variant) |
| B | 4 | 11 | **15** | Case-by-case in subsequent cards |
| C (strict) | 3 | 0 | **3** | No work needed — only PR #67's three sister RPCs |
| C-legacy | 3 | 7 | **10** | **Phase 1 must-pair normalization (expanded from 2 → 10): 2 role-mutation siblings + 5 OU mutators + 3 OU readers** |
| D | 31 | 3 | **34** | Phase 4 RLS audit + grant-aware EXISTS extension |
| D-variant | 1 | 0 | **1** | Phase 4 (with explicit permission-gate note) |
| E | 19 | 19 | **38** | Mostly no work |
| E-variant | 1 | 0 | **1** | `list_user_organizations` — sui generis |

### Phase 1 manifest expansion (12 → 15 steps; step 7 scope expanded 2 → 10 RPCs)

ADR Phase 1 manifest changes:

- **Step 7 expanded**: Normalize 10 C-legacy RPCs (was 2 — architect-review found OU mutators + OU readers also use legacy two-step). The operational tripwire applies to ALL 10.
- **13. (new)** Backfill `COMMENT ON FUNCTION` tags for all 104 `api.*` RPCs (`@a4c-bucket` + `@a4c-consultant-callable` + `@a4c-consultant-callable-reason` + `@a4c-phase-target`).
- **14. (new)** Ship codegen script `frontend/scripts/gen-rpc-reachability-matrix.cjs`.
- **15. (new)** Ship CI workflow `.github/workflows/rpc-reachability-matrix-sync.yml`.

### Phase 3 handoff (2-RPC scope after architect review)

| RPC | Bucket | Work |
|---|---|---|
| `api.list_users` | A (strict) | Replace early-return guard with PR #67 three-step skeleton |
| `api.list_invitations` | A-variant | Replace early-RAISE guard with three-step skeleton + permission check on `invitation.read` |

### Phase 4 handoff (Bucket D + D-variant RLS audit scope — 35 RPCs)

35 RPCs cluster by underlying RLS-protected table (OU readers moved OUT to C-legacy per Phase 1 normalization scope; `list_invitations` moved OUT to A-variant per Phase 3):

- `invitations_projection` → 6 RPCs (excluding `list_invitations` which moved to A-variant)
- `phones_projection` → 5 RPCs
- `roles_projection` / `role_permissions_projection` → 5 RPCs
- `users` / `user_roles_projection` / `user_organizations_projection` → 4 RPCs
- `organizations_projection` → 3 RPCs
- `contacts_projection` → 2 RPCs
- `user_addresses` → 2 RPCs (incl. `get_user_addresses_for_org` D-variant)
- `user_schedules_projection` → 2 RPCs
- `addresses_projection`, `emails`, `bootstrap_projections`, `user_client_assignments_projection` → 1 each
- Entity writes (RLS-enforced + explicit-org-param without strict-A guard) → 4 (`add_user_phone`, `revoke_invitation`, `update_user`, `update_user_notification_preferences`)

Phase 4 deliverable per table: extend each policy's `USING` clause with `OR public.has_cross_tenant_access(<table>.organization_id, ...)` (or equivalent EXISTS against `cross_tenant_access_grants_projection`). Phase 4 may sub-divide into per-table sub-cards.

**Sub-audit note**: `check_user_org_membership` (baseline_v4:593-606) is SECURITY DEFINER — DEFINER bypasses caller-RLS so it's effectively an unauthenticated org-membership probe. Forward-compatible with cross-tenant grants by accident; Phase 4 should decide whether to narrow the surface or document the open-by-design behavior explicitly.

### Phase 0.4 / 0.5 unblocks

- **0.4** (grant write-side) is unblocked — `grant_role_templates` separate-table decision is the starting input; emit RPC contract sketched in ADR addendum.
- **0.5** (phasing decision) — Phase 1 manifest (now 15 steps; step 7 covers 10 C-legacy RPCs not 2) is the Phase 1 commit; Phase 2 = grant write-side + `api.revoke_permission_across_grants` emitter; Phase 3 = `api.list_users` + `api.list_invitations` refactor (2 RPCs); Phase 4 = Bucket D + D-variant RLS audit (35 RPCs, may sub-divide).

### Architect-review provenance (Phase 0.3)

Independent architect review (software-architect-dbc) on 2026-05-26 — verdict REQUEST CHANGES. Findings folded into the shipped matrix + ADR addendum:

- **8 OU functions reclassified C → C-legacy** (5 mutators: create/update/delete/deactivate/reactivate_organization_unit; 3 readers: get_organization_unit_by_id/descendants, get_organization_units). Phase 1 must-pair scope expanded 2 → 10 RPCs — the operational tripwire would have mis-fired without this correction.
- **3 functions reclassified B ↔ D ↔ E**: `update_user` and `update_user_notification_preferences` moved B → D (take `p_org_id` explicitly, not JWT-derived). `list_user_org_access` moved B → E (self-context). `modify_user_roles` moved E → B (is JWT-bound write).
- **2 functions flagged as variants**: `list_invitations` is A-variant (RAISE-not-RETURN); `list_user_organizations` is E-variant (sui generis mixed predicate); `get_user_addresses_for_org` is D-variant (explicit permission-gate). The matrix uses root-bucket for the `@a4c-bucket` tag and captures variant nuance in `@a4c-consultant-callable-reason`.
- **Comment vocabulary refined**: replaced single `conditional` value with `pending-phase3-refactor` and `pending-phase4-rls` (operationally explicit). Added `@a4c-phase-target: 1|3|4|none` tag for single-grep work discovery.
- **Phase 1 manifest cleanup**: removed dual-residence between Phase 0.3 section and Consequences; full 15-step manifest now canonical in Consequences only.
- **Architect-flagged sub-audit**: `check_user_org_membership` is SECURITY DEFINER (bypasses caller-RLS) — Phase 4 should decide on narrowing or documenting the open-by-design behavior.

---

## Phase 0.4 — Outcomes (grant write-side)

### Decisions locked (14 total)

**User-confirmed via AskUserQuestion** (3):

1. **v1 scope** → VAR partnerships only. Court/agency/family deferred to Phase N or v1.1+.
2. **Schema gap (authorization_reference)** → add new column `authorization_reference uuid` to grant projection in Phase 1.
3. **Backing-table write flow** → event-sourced (`var_partnership.*` event family with own router branch).

**Architect-promoted at Phase 0.4 review** (11, analogous to 0.1+0.2's "4 promotions" pattern):

4. **Permission-gate direction** → `has_effective_permission('grant.create', <provider_org_path>)` (NOT consultant_org_path). HIPAA: provider owns the PHI.
5. **Stream_id resolution** → `v_grant_id := gen_random_uuid()` at top of `api.create_access_grant`; passed as `p_stream_id`; readback uses `WHERE id = v_grant_id`.
6. **Template identifier** → `p_grant_role_template_name text NOT NULL` (NOT `_id uuid`). Mirrors `api.get_role_permission_templates(p_role_name)`.
7. **`var_default` seed permission list** → `{partner.view_analytics, partner.view_support_tickets, partner.view_billing_reports, partner.export_reports}` with `default_terms: {phi_restricted: true}`.
8. **`default_terms jsonb` column on `grant_role_templates`** → HIPAA defaults snapshot at template level.
9. **Grant immutability** → NO `api.modify_access_grant`; modifications via revoke + reissue.
10. **`var_partnerships_projection.status` CHECK** → 4-value superset `('active', 'expired', 'terminated', 'suspended')`.
11. **`authorization_reference` CHECK** → `IS NOT NULL OR authorization_type = 'emergency_access'`.
12. **`permissions` key shape in event payload** → top-level `event_data->'permissions'` (matches deployed handler at baseline_v4:10446). Arch doc L325-365 had INCORRECT nested form; fixed in lockstep.
13. **`grant.create` + `grant.view` + `grant.revoke` permission seeding** → Phase 1 manifest step 10 emits `permission.defined` events (current registry has none of them). Post-PR-#68-cohesion-fix renumber: was step 12 at Phase 0.4 close.
14. **Phase 1 manifest cleanup** → step 12 expanded to include permission seeding; steps 16-17 added; total = **17 ordered steps** at Phase 0.4 close (not 18 — the original draft's step 18 was duplicate). *(Further reduced to **15 steps** post-PR-#68-cohesion-review per Step 9-into-8 absorption + Step 11 stub deletion; see PR #68 architect-review-provenance entry below.)*

### Decision summary (C.1-C.5)

| Decision | Summary |
|---|---|
| **C.1** | `api.create_access_grant` — single RPC with `p_authorization_type` discriminator; per-type validation via `public._validate_authorization_<type>` helpers; permission snapshot via `grant_role_templates` lookup + INTERSECT for narrowing; Pattern A v2 readback; HIPAA permission gate at provider path. |
| **C.2** | `grant_role_templates` schema — mirror `role_permission_templates` flat structure + UNIQUE constraint + `default_terms jsonb`. Seed `var_default` template. |
| **C.3** | `var_partnerships_projection` + `var_partnership.*` event family (6 event types: created/updated/terminated/suspended/reactivated/expired). New router `process_var_partnership_event`. RLS: org-admin read both sides, platform-admin global, NO consultant-direct access. Pattern transferable to court/agency/family. |
| **C.4** | Add `authorization_reference uuid` column to grant projection in Phase 1 with emergency_access CHECK exception and partial index. Handler extension to populate from `event_data->>'authorization_reference'`. |
| **C.5** | Single-grant revocation via `api.revoke_access_grant(p_grant_id, p_reason, p_revocation_details)`. Policy-override via Phase 2 `api.revoke_permission_across_grants` (Phase 1 handler-only). Immutability invariant. JWT staleness window documented; emergency revoke combined-flow flagged for Phase 2. |

### Phase 1 manifest (15 → 17 steps at Phase 0.4 close; → 15 final post-PR-#68-cohesion-fix)

- **Steps 1-11** unchanged from Phase 0.1+0.2 ADR.
- **Step 12 expanded** — `access_grant.policy_override_applied` handler + `permission.defined` event seeding for `grant.create/view/revoke` + 4 `partner.*` permissions.
- **Steps 13-15** unchanged from Phase 0.3 (comment backfill + codegen + CI workflow).
- **Step 16 (NEW)** — `authorization_reference` column + CHECK + partial index + handler extension.
- **Step 17 (NEW)** — `grant_role_templates` table + RLS + indexes + `var_default` seed.

### Phase 2 manifest (sketched)

- `CREATE TABLE var_partnerships_projection` + RLS + indexes
- `process_var_partnership_event` router + dispatcher CASE branch
- `api.create_access_grant` emit RPC (+ per-type private validation helpers)
- `api.revoke_access_grant(p_grant_id, p_reason, p_revocation_details)` single-grant revocation
- `api.create_var_partnership`, `api.update_var_partnership`, `api.terminate_var_partnership` (and suspend/reactivate if needed)
- `api.revoke_permission_across_grants(p_permission_name)` policy-override emitter (Decision B.3 completion)
- `api.get_grant_role_templates(p_authorization_type)` read RPC
- `api.expire_var_partnership` — emitter shape decided in Phase 0.5 (scheduled job vs RPC)
- AsyncAPI `contracts/asyncapi.yaml` updates: `var_partnership` channel + 6 message types
- **AsyncAPI `access_grant.yaml` — register `access_grant.policy_override_applied`** (PR #70 architect review N1, 2026-06-03): the event is handler-defined in Phase 1 but not emitted until Phase 2's `api.revoke_permission_across_grants` lands. The codebase convention is "register on emit, not on handler" — so the AsyncAPI entry pairs with the emit RPC. When Phase 2 drafts the emitter, add a message definition to `infrastructure/supabase/contracts/asyncapi/domains/access_grant.yaml` next to the existing `created/revoked/expired/suspended/reactivated` entries. Schema must capture: `permissions: array<{p: string, s: ltree}>` (the replacement set), `override_reason: string` (non-empty), `applied_by: uuid` (admin actor). The handler enforces `jsonb_typeof(permissions)='array'` + non-empty `override_reason` pre-conditions (Phase 1 migration `:3239-3249`, `:4118-4127`); emitter must mirror.
- Comment-tagging for all new RPCs (`@a4c-rpc-shape` + `@a4c-bucket` + `@a4c-consultant-callable` + `@a4c-phase-target`)

### Phase 0.5 unblocks

The 0.4 deliverables unblock 0.5 (phasing decision): Phase 1 manifest is 15 steps with hard ordering constraints (must-pair set: 1, 7, 8 atomic; 14 before 15 because grant_role_templates seeding requires the partner.* permissions to exist first; counts reflect post-PR-#68-cohesion-fix renumber). Phase 2 manifest enumerated above. Phase 3 (2 RPCs: `list_users` + `list_invitations` A-variant) + Phase 4 (35 RPCs by table cluster: 34 strict-D + 1 D-variant) handoffs locked at 0.3. Phase N: court/agency/family backing tables — sequenced post-VAR-GA per stakeholder availability.

### Architect-review provenance

Independent architect review (software-architect-dbc) on 2026-05-26 — verdict REQUEST CHANGES. Findings folded into the shipped Phase 0.4 deliverables:

- **2 blockers**: HIPAA permission-gate direction reversed (consultant → provider); `var_default` seed permission list locked explicitly.
- **4 important findings**: doc-vs-handler `permissions` key shape mismatch fixed (arch doc L325-365 updated to top-level form); `grant.create` permission seeding added to Phase 1 step 12; `var_partnerships_projection` schema deltas reconciled (contract_number + 4-value status + suspension/termination audit columns); Phase 1 step 12/18 collision resolved.
- **11 sub-decisions** promoted from "deferred to Phase 1" to "locked at 0.4".
- **Pattern improvements**: per-authorization-type validation extracted to `public._validate_authorization_<type>` helpers; INTERSECT for permission narrowing; index naming consistency; AsyncAPI YAML sketch in ADR addendum; forward-compat note on grant immutability.
- **PR #68 cohesion-pass review (2026-05-26)** — 4th architect-review pass on the assembled Phase 0 design body (post all 4 phase commits). Verdict REQUEST CHANGES. 2 blockers (Step 11/17 `grant_role_templates` CREATE collision regression of the 0.4 12/18 class; stale Authorization Type Patterns code blocks at provider-partners L376-433 contradicting the Phase 0.4 doc correction). 4 important findings (Step 8 placeholder broke "17 ordered steps" claim — manifest was actually 15 substantive once Step 9 absorbed into Step 8 + Step 11 stub deleted; provider-partners doc footer not bumped; AGENT-INDEX Phase 3/4 counts stale 1/34 → 2/35; tasks.md Current Status pre-0.4-shipping). 3 nits folded in (`permissions jsonb` shape contract invariant; `accessible_organizations` user-visibility consequence with `EXISTS`-against-grant-projection corrected predicate; JWT staleness window quantification via `access_token_expiry_seconds` + HIPAA operational SLA). All 9 findings + 3 plan-review architect-flagged plan corrections resolved in the 5th commit on this branch. **Final Phase 1 manifest = 15 substantive steps** (not 17 as previously claimed at Phase 0.4 close).

---

## Phase 0.5 — Outcomes (phasing decision; CLOSES PHASE 0)

### Decisions locked (5 total)

**User-confirmed via AskUserQuestion** (3):

1. **Card structure** → **Multi-card**. Each downstream phase (1, 2, 3, 4, N×3) is its own `dev/active/` card with its own plan.md, tasks.md, branch, architect-review cycle, and PR. Phase 0 closes on this card.
2. **Phase 4 partitioning** → **Omnibus Phase 4 card** with internal sub-sections per RLS-protected table cluster (~12). Architect reviews one cohesive RLS-extension strategy; extract sub-clusters later if any grows.
3. **Phase N partitioning** → **One card per authorization-type** (court orders, agency assignments, family consents). Independent stakeholder timelines (legal review for courts ≠ CPS coordination ≠ family-trust review).

**Derived from architecture** (2):

4. **Phase 1 ships first** (gates Phase 2/3/4 via `has_cross_tenant_access()` + `grant_role_templates` + `authorization_reference` column + permission seeding + JWT shape).
5. **Inter-phase parallelism**: Phase 2/3/4 are parallelable post-Phase-1 (no inter-dependencies). Phase N types are parallelable post-Phase-2. Phase 3 CAN technically ship before Phase 1 (code-only refactor) but no consultant benefit until Path B JWT shape lands.

### Card structure (locked naming convention)

| Phase | Card slug | Branch name | Status |
|---|---|---|---|
| 0 | `cross-tenant-access-grant-rollout/` (this card) | `feat/cross-tenant-access-grant-phase-0-design` (this branch) | **CLOSING** |
| 1 | `cross-tenant-grant-phase-1-jwt-shape/` | `feat/cross-tenant-grant-phase-1-jwt-shape` | next |
| 2 | `cross-tenant-grant-phase-2-write-side/` | `feat/cross-tenant-grant-phase-2-write-side` | follows P1 |
| 3 | `cross-tenant-grant-phase-3-list-users-refactor/` | `feat/cross-tenant-grant-phase-3-list-users-refactor` | parallel w/ P2 |
| 4 | `cross-tenant-grant-phase-4-rls-audit/` | `feat/cross-tenant-grant-phase-4-rls-audit` | parallel w/ P2/P3 |
| N — court | `cross-tenant-grant-court-orders/` | `feat/cross-tenant-grant-court-orders` | follows P2 |
| N — agency | `cross-tenant-grant-agency-assignments/` | `feat/cross-tenant-grant-agency-assignments` | follows P2 |
| N — family | `cross-tenant-grant-family-consents/` | `feat/cross-tenant-grant-family-consents` | follows P2 |

Seeding is on-demand per branch-on-decision rule. Only Phase 1's card seeds when work begins (post Phase 0 PR merge).

### Inter-phase dependency graph

```
Phase 0 (this) ──┬──> Phase 1 ──┬──> Phase 2 (VAR write-side) ──┬──> Phase N (court)
                 │              │                                 ├──> Phase N (agency)
                 │              ├──> Phase 3 (list_users refactor)└──> Phase N (family)
                 │              └──> Phase 4 (RLS audit, 35 RPCs)
                 └─ closing
```

Phase 2/3/4 parallelable post-Phase-1; Phase N types parallelable post-Phase-2. Full graph in ADR § Phase 0.5.

### Phase 0 closure

This card (`cross-tenant-access-grant-rollout/`) completes Phase 0 at this commit. The card will be archived (moved to `dev/archived/`) after the Phase 0 PR (this branch) merges. Phase 0's residual deliverables — Phase 1 manifest enumeration, ADR Phase 0.1+0.2+0.3+0.4+0.5 sections, RPC reachability matrix, provider-partners doc updates — become the foundational reference set for all downstream phases.

### Phase 1 next-step pointer

After Phase 0 PR merges to main:

1. Branch `feat/cross-tenant-grant-phase-1-jwt-shape` from main (per branch-on-decision rule).
2. Seed `dev/active/cross-tenant-grant-phase-1-jwt-shape/` with plan.md tracking the 15-step migration manifest from ADR Consequences.
3. Phase 1 plan-mode pass: identify any unresolved sub-decisions (e.g., `var_partnership.expired` emitter shape — scheduled job vs RPC, currently deferred).
4. Architect review of Phase 1 plan before any migration is written.
5. Phase 1 implementation: produce the migration file (transactional `.sql` covering all 15 steps), regenerate `database.types.ts` for both frontend + workflows, smoke-test against dev Supabase.
6. PR + UAT + merge.

## Phase 1 — Outcomes (SHIPPED 2026-06-03)

**PR #70** — merged commit `485955fb` 2026-06-03 (no-squash per PR #68 precedent; preserved 33-commit per-step + architect-fold-in progression). All 3 post-merge deploys green: `Deploy Database Migrations` (27s), `Deploy Frontend`, `Deploy Temporal Workers`. Production state verified: migration `20260601174841` recorded; `grant_role_templates` has 4 var_default rows; 7 new permissions seeded (3 `grant.*` + 4 `partner.*`).

**15-step manifest** — all delivered per ADR `adr-cross-tenant-access-grant-jwt-shape.md` § Phase 1 migration manifest. Single transactional migration `20260601174841_cross_tenant_grant_phase_1_jwt_shape.sql` (4,392 lines, 66 top-level statements). Six PR #68-locked ADR decisions verified end-to-end:

1. ✅ Path B (extend `compute_effective_permissions`) — asymmetric `DISTINCT ON (permission_name, scope_path)` + grant_derived_perms 4-arm UNION CTE.
2. ✅ Hybrid permission-snapshot — `cross_tenant_access_grants_projection.permissions jsonb` read directly; no template join at issuance.
3. ✅ Asymmetric DISTINCT ON tightening — multi-scope rows for same permission preserved (Stage E verified `client.create` survives at two distinct scope paths).
4. ✅ Separate `grant_role_templates` table — Step 15 ships with 4-row var_default seed (HIPAA `phi_restricted: true` on all 4).
5. ✅ `propagate_through_grants` default false (HIPAA least-authority) — Step 2 ALTER TABLE; Stage E verified both directions (false blocks grant-source implication-widening; true allows it).
6. ✅ Event-sourced policy-override — `access_grant.policy_override_applied` handler ships Phase 1; emit RPC `api.revoke_permission_across_grants` deferred to Phase 2.

**Operational tripwire from PR #67 — CLOSED**: 10 C-legacy RPCs (the 2 mutation siblings + 5 OU mutators + 3 OU readers per reachability matrix § Phase 1 must-pair normalization) normalized to canonical `has_effective_permission(perm, scope_path)`. Matrix doc now shows `C-legacy = 0`; the 10 RPCs migrated to `C` (post-fold-in: C went 21 → 31; D-variant 5 → 1; E 37 → 43; total still 170).

**Stage E smoke + UAT — 21/21 PASS** against dev (10 structural + 11 dynamic). Auth-hook latency p50 0.202ms / p95 0.228ms vs Stage B baseline p50 0.222 / p95 0.267 — BETTER on both (architect clearance criterion was ≤2× baseline ~0.5ms). HIPAA invariant verified both directions. EXISTS bugfix verified (empty/NULL accessible_organizations → 0 grant-derived rows). All cleanup verified.

**9 architect review passes** during Stage C drafting (plan + matrix-R-6 + Steps 1+2 + 3+4 + 5+6 + 7 + 8+9 + 10 + 11 + 12+13+14+15) + Stage E deploy-bugfix review + **final-PR review verdict APPROVE** (unconditional; no must-fix; 3 nits N1-N3 — N1 folded into Phase 2 manifest above; N2/N3 cosmetic). One REQUEST-CHANGES (Step 10 — 2 BLOCKING defects: `scope_type='resource'` violated CHECK + `EXCEPTION WHEN unique_violation` dead code; both folded same-day).

**Codified pitfalls** (carry forward):
- **PG ARE `\b` vs `\y`** (`infrastructure/supabase/CLAUDE.md` § PG ARE regex word-boundary): `\b` silently fails-no-match on hosted Supabase PG; use PG-specific `\y`. Discovered via Stage E deploy bugfix on Steps 8+11 assertions.
- **Step 12 codegen multi-line `pg_description.description` parser**: psql output must use `-R '<<<A4C_ROW>>>'` row separator when description bodies contain newlines (baseline_v4 docblocks like `Validation:`, `Used by:`, `Tenancy model:`). Discovered via "1329 untagged functions" CI failure on PR #70 first push. Codegen at `frontend/scripts/gen-rpc-reachability-matrix.cjs:99` is now hardened; M3 sibling `gen-rpc-registry.cjs` avoids the issue by SQL-side tag extraction.
- **`ANY((SELECT array_col FROM CTE))` is a scalar subquery**: PG interprets it as returning rows of arrays → `operator does not exist: uuid = uuid[]`. Use EXISTS form with column reference instead. Discovered via Step 1 deploy bugfix.
- **`EXCEPTION WHEN unique_violation` is dead code under `process_domain_event`**: the trigger's WHEN OTHERS catches violations upstream and persists stale failed events. Use `IF NOT EXISTS (SELECT 1 FROM proj WHERE ..) THEN INSERT...` precondition guard instead. Discovered via Step 10 BLOCKING architect finding.

**Carry-forwards into Phase 2**:
- N1 (above): register `access_grant.policy_override_applied` in `infrastructure/supabase/contracts/asyncapi/domains/access_grant.yaml` next to the emit RPC `api.revoke_permission_across_grants` (handler pre-conditions documented at migration `:3239-3249` / `:4118-4127`).
- `var_partnerships_projection` table + emit RPCs (Phase 2 manifest above).
- Single-grant revoke RPC `api.revoke_access_grant` (Phase 2 manifest above).
- Phase 3 (`list_users` + `list_invitations` A-variant refactor) + Phase 4 (35 strict-D + 1 D-variant RLS audit) handoffs already locked at Phase 0.3.
