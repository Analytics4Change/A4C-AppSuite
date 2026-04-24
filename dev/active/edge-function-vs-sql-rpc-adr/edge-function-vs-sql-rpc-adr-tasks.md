# Edge Function vs SQL RPC Selection ADR — Tasks

## Current Status

**Phase**: Plan revised per architect pre-review — awaiting user LGTM before Phase 1 drafting
**Status**: 🟢 ACTIVE (branch `docs/edge-function-vs-sql-rpc-adr`; Phase 0 inventory folded in)
**Last Updated**: 2026-04-24
**Branch**: `docs/edge-function-vs-sql-rpc-adr` (no PR yet; no commits yet)
**Next step**: User reviews revised `context.md` + `plan.md` + this file; confirms → Phase 1 ADR drafting begins.

---

## Activation Trigger

Activated 2026-04-24. Conditions met:
- ✅ PR #32 merged (commit `6b4a2fe5`) — `manage-user` v11 Pattern A v2 surfaced the "strictly superior architecturally" finding
- ✅ `api-rpc-readback-pattern` archived — the SQL-RPC-side contract this ADR cites is stable
- ✅ Four-layered approach confirmed (user + architect, 2026-04-24)
- ✅ Architect pre-review complete (agent `afc812e89a6fbed46`, verdict LGTM-with-remediation; 3 MUST-FIX + 6 SHOULD-ADD folded into this revision)

## Pre-implementation Gates (all resolved)

- [x] **D1** — Pre-review plan with `software-architect-dbc` (agent `afc812e89a6fbed46`, 2026-04-24) — LGTM-with-remediation
- [x] **D2** — Follow-up card folder naming: `<function>-to-sql-rpc/` (user, 2026-04-24)
- [x] **D3** — New seed cards land under `dev/active/` regardless of priority (user, 2026-04-24)

## Architect Remediation Tracking

### MUST-FIX items (all folded before Phase 1)

- [x] **MF1** — Remove "service-role reads of non-`api.` tables" as positive indicator; add explicit non-criterion note
- [x] **MF2** — Reframe Phase 0 as plan-completion motivating-example calibration (not conclusion-first execution)
- [x] **MF3** — Scope Pattern A v2 reference-impl citation to `manage-user update_notification_preferences` only; flag other manage-user ops as "Pattern A v2 retrofit TBD"

### SHOULD-ADD items (all folded before Phase 1)

- [x] **SA1** — 5th positive indicator added (LB6 — pre-user-emit)
- [x] **SA2** — CI check added as Layer 4 (new workflow `supabase-edge-functions-lint.yml`)
- [x] **SA3** — ADR version field (`adr_version: v1`) added to frontmatter spec
- [x] **SA4** — Phase 0 moved to plan-completion data (done)
- [x] **SA5** — LB5 (read-orchestration of cross-tier state) added to criteria list
- [x] **SA6** — `organization-delete` hybrid case walkthrough added to Phase 1 ADR body spec

### Blind-spot coverage (all folded)

- [x] **BS1** — Temporal activities declared out-of-scope in context.md + ADR body
- [x] **BS2** — `{success, <entity>}` conformance requirement for load-bearing Edge Function writes
- [x] **BS3** — AsyncAPI invariance during extraction noted in Consequences
- [x] **BS4** — LB4 (unauthenticated token validation) integrated as positive indicator
- [x] **BS5** — auth-user minting sub-case called out under LB1
- [x] **BS6** — Deploy-surface consolidation noted in Consequences

## Phase 0 — Edge Function Inventory ✅ COMPLETE (2026-04-24, plan-completion data)

- [x] Inventoried all 7 Edge Functions (3,390 LOC total)
- [x] Enumerated 16 distinct operations
- [x] Classified each against LB1–LB6 rubric
- [x] Populated inventory table in `plan.md` (moved from "Phase 0 execution" to "plan-completion data")
- [x] Identified 3 ambiguous cases (`update_notification_preferences`, `validate-invitation`, `organization-bootstrap`/`organization-delete`) with explicit rationale
- [x] Corrected sub-agent rule-violation: `validate-invitation` and `accept-invitation.query-org-for-redirect` reclassified as load-bearing per LB4

**Totals**: 13 load-bearing, 3 candidate + 1 reference-impl candidate = **4 candidate ops** for Phase 5 seed cards.

## Phase 1 — Draft ADR 🟡 NOT STARTED

**Path**: `documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md`

### 1a — Frontmatter + TL;DR

- [ ] YAML frontmatter: `status: current`, `last_updated: <commit day>`, `adr_version: v1` (per SA3)
- [ ] TL;DR block:
  - [ ] **Summary**: 1–2 sentences
  - [ ] **When to read**: 3+ SPECIFIC scenarios
  - [ ] **Prerequisites**: link `adr-rpc-readback-pattern.md`, `event-handler-pattern.md`
  - [ ] **Key topics** (3–6 backticked): `adr`, `edge-function`, `sql-rpc`, `orchestration-tier`, `cqrs`
  - [ ] **Estimated read time**

### 1b — Body

- [ ] **Context** — silent-friction-to-choose; cite PR #32 reviews (both architect agents)
- [ ] **Decision** — SQL RPC default; Edge Function requires ≥1 LB criterion
- [ ] **Selection criteria**:
  - [ ] 5 positive indicators LB1–LB5 (auth-mint, external-API, workflow-fwd, noauth-token, read-orch) + LB6 (pre-user-emit)
  - [ ] 1 negative indicator (pure DB + auth + perm + read-back → SQL RPC)
  - [ ] Explicit **non-criterion**: service-role reads of non-`api.` tables are NOT load-bearing (per MF1)
  - [ ] Ambiguous-middle rubric with 3 worked cases from Phase 0
- [ ] **Edge Functions as orchestration tier** (elevated section per N1) — CQRS Rule 4 exemption
- [ ] **Pattern A v2 compatibility** — `manage-user update_notification_preferences` (v11) as SOLE reference impl (per MF3)
- [ ] **Hybrid case walkthrough** (per SA6) — `organization-delete`
- [ ] **Out-of-scope boundary** (per BS1) — Temporal activities
- [ ] **Inventory (as of 2026-04-24)** — date-stamped, grep-recipe footnote, 16-row table
- [ ] **Rollout history** — initial publication row
- [ ] **Consequences** — predictability, review speed, migration burden, call-site churn, deploy-surface consolidation (BS6), AsyncAPI invariance (BS3)
- [ ] **Alternatives considered** — status quo, all-EF, all-SQL-RPC

### 1c — Related Documentation section

- [ ] Link `adr-rpc-readback-pattern.md`
- [ ] Link `infrastructure/CLAUDE.md` (Rules 4, 9, 13)
- [ ] Link `event-handler-pattern.md`
- [ ] Link `event-sourcing-overview.md`

**DoD**: All sections present; frontmatter renders; manual link-walk confirms resolution.

## Phase 2 — Guard Rail Updates 🟡 NOT STARTED

### 2a — `infrastructure/CLAUDE.md`

- [ ] Add new rule with forward-link to ADR
- [ ] Add companion opportunistic-migration nudge
- [ ] Bump `last_updated` if frontmatter exists

### 2b — `.claude/skills/infrastructure-guidelines/SKILL.md`

- [ ] Mirror both rules from 2a
- [ ] Place adjacent to existing Rule 4
- [ ] Verify forward-link resolves from skill base dir

**DoD**: `grep -rn 'adr-edge-function-vs-sql-rpc' infrastructure/CLAUDE.md .claude/skills/infrastructure-guidelines/SKILL.md` returns ≥1 hit per file.

## Phase 3 — Navigation + Cross-links 🟡 NOT STARTED

### 3a — `documentation/AGENT-INDEX.md`

- [ ] Add keyword rows: `edge-function`, `sql-rpc`, `orchestration-tier`
- [ ] Document Catalog entry for new ADR
- [ ] Cross-ref updates on `api-contract` / `rpc-readback` / `cqrs` rows

### 3b — Cross-link from `adr-rpc-readback-pattern.md`

- [ ] One-line Related-Documentation entry pointing at new ADR
- [ ] Bump `last_updated`

**DoD**: all cross-links resolve; keyword rows match ADR's TL;DR.

## Phase 4 — CI Check 🟡 NOT STARTED (per SA2)

**Path**: `.github/workflows/supabase-edge-functions-lint.yml` (new file)

- [ ] Create workflow file with grep-based ADR-citation check
- [ ] Scope: NEW files only (`git diff --diff-filter=A`)
- [ ] Triggered on `infrastructure/supabase/supabase/functions/**` PR changes
- [ ] Test on a throwaway branch: create a dummy new Edge Function without the citation → CI fails with clear error message pointing at ADR path

**DoD**: Workflow file lands; dry-run validates catch behavior; does NOT block existing-file modifications.

## Phase 5 — Seed 4 Follow-up Cards 🟡 NOT STARTED

For each `candidate-for-extraction` row in Phase 0:

- [ ] **Card 1** — `dev/active/manage-user-to-sql-rpc/` (scope: `update_notification_preferences` only; supersedes Blocker-3-followup-7)
  - [ ] `context.md`
  - [ ] `plan.md`
  - [ ] `tasks.md`
- [ ] **Card 2** — `dev/active/invite-user-revoke-to-sql-rpc/`
- [ ] **Card 3** — `dev/active/manage-user-delete-to-sql-rpc/`
- [ ] **Card 4** — `dev/active/manage-user-modify-roles-to-sql-rpc/`

Each card's minimum content:
- Motivation (cite this ADR + Phase 0 classification)
- Operation(s) to extract
- Backward-compat plan (dual-deploy during rollout? direct cutover?)
- Rollout gate (N days of zero Edge Function calls? feature-flag controlled?)

**DoD**: 4 folders exist under `dev/active/`; `manage-user-to-sql-rpc/` explicitly references this ADR as activation trigger.

## Phase 6 — Verification + PR 🟡 NOT STARTED

### 6a — Pre-PR checks

- [ ] Manual link walk: every `[text](path)` in new ADR resolves
- [ ] AGENT-INDEX keyword rows match ADR TL;DR `Key topics` exactly
- [ ] No anti-staleness violations
- [ ] `npm run docs:check` green (only pre-existing trailing-slash warning acceptable)
- [ ] Dry-run CI workflow on throwaway branch confirms catch behavior

### 6b — Commit + PR

- [ ] Commit on `docs/edge-function-vs-sql-rpc-adr` branch
- [ ] Push; open PR against `main`
- [ ] PR body: summary + links to PR #32 architect reports + this dev-doc

### 6c — Post-merge

- [ ] Archive `dev/active/edge-function-vs-sql-rpc-adr/` → `dev/archived/edge-function-vs-sql-rpc-adr/`
- [ ] Verify 4 seeded `<function>-to-sql-rpc/` folders remain in `dev/active/`
- [ ] Update `MEMORY.md` with ADR v1 ship note (per SA3 versioning protocol)

**Full DoD for this feature**: ADR published + guard rails in place + CI check live + 4 candidate cards seeded + Blocker-3-followup-7 explicitly unblocked.

## Parked / Out-of-scope

- Actual Edge Function → SQL RPC extractions (each is its own PR per its own card)
- Pattern A v2 retrofit of `manage-user` non-notification-pref ops (separate cards, potentially coupled with Card 3 for `delete`)
- Temporal activities under `workflows/` (BS1 boundary)
- New Edge Function development guide (stays in `infrastructure/CLAUDE.md` + existing docs)
- `accept-invitation` / `validate-invitation` unification (O1; noted as non-goal in ADR)
- Inventory-refresh automation (noted cadence in ADR body; no CI check)
- Edge Function deploy automation (O2; orthogonal)
