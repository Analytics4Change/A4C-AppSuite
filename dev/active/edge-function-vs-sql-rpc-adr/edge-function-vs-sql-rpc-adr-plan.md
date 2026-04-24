# Edge Function vs SQL RPC Selection ADR — Plan

## Executive Summary

Ship an ADR that establishes selection criteria between Edge Functions and SQL RPCs, classifies every current Edge Function **operation** (per-op, not per-function) against those criteria, and lands a **four-layer** enforcement mechanism: (1) ADR as authoritative criteria, (2) SKILL.md + CLAUDE.md guard rail on new work, (3) ADR inventory table as migration backlog, (4) CI grep ensuring new Edge Functions cite the ADR.

**Why now**: PR #32 architect `a060ef3faaa5b630c` flagged `manage-user update_notification_preferences` as "strictly superior architecturally" as a SQL RPC and deferred the refactor to this ADR pass. Without written criteria, the team can't start the refactor, can't predict what the next Edge Function should be, and can't answer "should I extract this op?" consistently.

**Pre-review**: `software-architect-dbc` agent `afc812e89a6fbed46` reviewed this plan 2026-04-24. Verdict: **LGTM-with-remediation**. All 3 MUST-FIX + 6 SHOULD-ADD items have been folded in (see "Architect-driven revisions" section below). Phase 0 inventory promoted from execution phase to plan completion per architect SA4/Q6.

## Scope

See `edge-function-vs-sql-rpc-adr-context.md` for full scope. Summary:

- **In scope**: ADR file + 2 guard-rail edits + 1 CI workflow + N new follow-up cards seeded from inventory
- **Out of scope**: Actual extractions (each becomes its own PR per its own card); Pattern A v2 retrofit of `manage-user` non-notification-pref ops; Temporal activities in `workflows/`; new-Edge-Function dev guide
- **Exclusions**: Don't touch `adr-rpc-readback-pattern.md` except for the single cross-link; don't change Pattern A v2 semantics

## Architect-driven revisions (folded from pre-review 2026-04-24)

### MUST-FIX resolutions

- **MF1 — Criteria inconsistency resolved**. Original "service-role reads of non-`api.` tables" was a false-positive load-bearing indicator. Removed from positive list; added explicit "Explicit non-criterion" note in ADR body citing that `SECURITY DEFINER` SQL RPCs can read any table. Final positive indicator list is 5 items (LB1–LB5 in context.md Layer 1).
- **MF2 — Phase 0 framing corrected**. Plan now treats the inventory as **plan completion** data (below), not a first-step-of-execution. The `manage-user update_notification_preferences` classification is framed explicitly as the **motivating worked example** that calibrates the heuristic; Phase 0 tests the heuristic against the other 6 functions.
- **MF3 — Pattern A v2 reference-impl scope tightened**. ADR cites `manage-user update_notification_preferences` (v11) ONLY as the Pattern A v2 reference implementation. Other `manage-user` ops (`deactivate`, `reactivate`, `delete`, `modify_roles`) still have the pre-v11 silent-failure shape; ADR flags them as "Pattern A v2 retrofit TBD" rows in the inventory notes column. Retrofit is a separate follow-up card, NOT part of this ADR.

### SHOULD-ADD integrations

- **SA1 — Fifth positive indicator added**: "Emits to a stream the caller's JWT cannot be RLS-authorized" (e.g., `accept-invitation` creates user + emits `user.created` before the user exists in `auth.users`). Captured as LB6 in Phase 0 inventory.
- **SA2 — CI check as Layer 4**: New `.github/workflows/supabase-edge-functions-lint.yml` ensures new `supabase/functions/*/index.ts` files cite the ADR. NEW-file-only (zero retrofit for existing 7). See context.md Layer 4.
- **SA3 — ADR versioning**: `**ADR version**: v1` added to frontmatter. Future revisions must append Rollout history + `MEMORY.md` note.
- **SA4 — Phase 0 moved to plan completion**: DONE (this revision).
- **SA5 — Read-orchestration sub-category**: LB5 positive indicator covers `workflow-status` shape ("Read orchestration of cross-tier state"). Explicitly named in context.md Layer 1 criteria list.
- **SA6 — Hybrid-case walkthrough**: ADR body includes a worked example of `organization-delete` (permission check in Edge Function + forward to Backend API + calls `api.` RPC for soft-delete) as the canonical "hybrid load-bearing" case. Prevents future classifiers from forcing hybrid functions into a single bucket.

### Blind-spot coverage

- **BS1 — Temporal activities out-of-scope boundary**: Declared explicitly in context.md Scope section + ADR body.
- **BS2 — Load-bearing Edge Function write shape**: ADR codifies `{success, <entity>}` response format per `adr-rpc-readback-pattern.md` Decision 4.
- **BS3 — AsyncAPI invariance during extraction**: One-line note in Consequences section.
- **BS4 — LB4 (unauthenticated token validation)**: Integrated as positive indicator #4 in LB criteria.
- **BS5 — auth-user minting sub-case**: Called out under LB1.
- **BS6 — Deploy-surface consolidation**: Noted in Consequences section.

## Phase 0 — Edge Function Inventory ✅ COMPLETE (2026-04-24, plan completion data)

**Method**: Per-operation classification across all 7 deployed Edge Functions (3,390 total LOC). Each operation assessed against LB1–LB6:
- **LB1** — Mints auth tokens / creates `auth.users` rows
- **LB2** — Calls external APIs (non-Postgres, non-Supabase-internal)
- **LB3** — Forwards to workflow-orchestration layer (Backend API → Temporal)
- **LB4** — Unauthenticated entry point with bespoke token validation
- **LB5** — Read orchestration of cross-tier state (Temporal status, external queues)
- **LB6** — Emits to a stream whose caller's JWT cannot be RLS-authorized (pre-user events)

**Classification rule**: ≥1 ✅ across LB1–LB6 = `load-bearing`; 0 ✅ = `candidate-for-extraction`. Function-level mixing yields `partial-candidate`.

### Inventory Table (as of 2026-04-24, files totaling 3,390 LOC)

| # | Function | Operation | LB1 | LB2 | LB3 | LB4 | LB5 | LB6 | Classification | Notes |
|---|----------|-----------|-----|-----|-----|-----|-----|-----|----------------|-------|
| 1 | `accept-invitation` | email/password + oauth user creation | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ | **load-bearing** | Mints auth user; LB4 invitation-token auth; LB6 pre-user events |
| 2 | `accept-invitation` | emit `user.role.assigned` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | **load-bearing** | LB4 + LB6 |
| 3 | `accept-invitation` | emit `user.phone.added` + `user.notification_preferences.updated` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | **load-bearing** | LB4 + LB6 |
| 4 | `accept-invitation` | query organization for redirect | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | **load-bearing** | LB4 — unauthenticated via invitation token |
| 5 | `invite-user` | `create` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | **load-bearing** | LB1 (ensures auth.users) + LB2 (Resend API email) |
| 6 | `invite-user` | `resend` | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | **load-bearing** | LB2 (Resend API) |
| 7 | `invite-user` | `revoke` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **candidate-for-extraction** | Pure RPC + event emission on existing invitation |
| 8 | `manage-user` | `deactivate` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | **load-bearing** | LB1 — `auth.admin.updateUserById` ban-state sync. **Pattern A v2 retrofit TBD** — still pre-v11 emit-and-return shape |
| 9 | `manage-user` | `reactivate` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | **load-bearing** | LB1 — ban-state unban. **Pattern A v2 retrofit TBD** |
| 10 | `manage-user` | `delete` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **candidate-for-extraction** | Pure RPC + event; no auth API calls. **Pattern A v2 retrofit TBD** (currently emit-and-return; extraction inherits the fix) |
| 11 | `manage-user` | `modify_roles` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **candidate-for-extraction** | Pure RPC + 1+N+M events. **Pattern A v2 retrofit TBD** |
| 12 | `manage-user` | `update_notification_preferences` (v11) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **candidate-for-extraction** | **Pattern A v2 reference implementation** (two-step read-back); architect-validated as first extraction target |
| 13 | `organization-bootstrap` | initiate workflow | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | **load-bearing** | LB3 (Backend API forward) + LB5 (workflow status response) |
| 14 | `organization-delete` | trigger deletion | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | **load-bearing** | LB3 + LB5. **Hybrid case** — permission check + `api.` RPC + workflow forward. ADR uses this as the canonical hybrid walkthrough (SA6) |
| 15 | `validate-invitation` | lookup + validate | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | **load-bearing** | LB4 — unauthenticated bespoke token validation. Token validation + correlation-id business-scope lookup is easier in TypeScript than `anon`-callable SQL |
| 16 | `workflow-status` | query status | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | **load-bearing** | LB5 — orchestration-tier read of Temporal state |

**Totals** (anti-staleness note: this is a point-in-time snapshot. Regenerate via `find infrastructure/supabase/supabase/functions -name 'index.ts' -not -path '*/_shared/*' | xargs wc -l` + per-op inspection):

- **16 total operations** across 7 functions
- **12 load-bearing**: 4 in `accept-invitation`, 2 in `invite-user`, 2 in `manage-user`, 1 each in `organization-bootstrap`, `organization-delete`, `validate-invitation`, `workflow-status`
- **4 candidate-for-extraction**: `invite-user revoke`, `manage-user delete`, `manage-user modify_roles`, `manage-user update_notification_preferences` (also sole Pattern A v2 reference implementation per Decision 5 — architect-validated first target)

### Function-level composition

| Function | Composition | Next action |
|----------|------------|-------------|
| `accept-invitation` | All 4 ops load-bearing | None |
| `invite-user` | **partial-candidate** (2 load-bearing + 1 candidate `revoke`) | Seed card for `revoke` |
| `manage-user` | **partial-candidate** (2 load-bearing + 3 candidates) | Seed cards for `update_notification_preferences` (first), `delete`, `modify_roles` |
| `organization-bootstrap` | 1 op load-bearing | None |
| `organization-delete` | 1 op load-bearing (hybrid) | None |
| `validate-invitation` | 1 op load-bearing | None |
| `workflow-status` | 1 op load-bearing | None |

### Ambiguous cases requiring explicit ADR guidance

1. **`manage-user update_notification_preferences`** — architect-validated candidate; Pattern A v2 already present in TypeScript. Extraction economics: the two-step read-back is already complex enough to motivate moving to SQL (single-transaction in-PL/pgSQL is simpler). Resolution: candidate, first extraction target.
2. **`validate-invitation`** — LB4 pure-read with no external API. Could theoretically be an `anon`-callable `api.*` RPC, but rate limiting + correlation-id lookup is awkward in SQL. ADR explicitly treats LB4-alone as load-bearing; resolution: keep as Edge Function.
3. **`organization-bootstrap` / `organization-delete`** — "gateway" functions that forward to Backend API. ADR walks `organization-delete` as the canonical hybrid example (SA6). Resolution: load-bearing via LB3.

**DoD for Phase 0**: ✅ Complete — user confirms this inventory before Phase 1 starts.

## Phase Summary (remaining phases)

| Phase | Description | Effort | Deliverable |
|-------|------------|--------|-------------|
| 1 | Draft ADR: context / decision / criteria / inventory / rollout / consequences | Medium | `documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md` |
| 2 | Guard rail updates: `infrastructure/CLAUDE.md` + `.claude/skills/infrastructure-guidelines/SKILL.md` | Small | 2 edits, both forward-linking the ADR |
| 3 | Navigation + cross-links: `documentation/AGENT-INDEX.md` + cross-link from `adr-rpc-readback-pattern.md` | Small | 2 edits |
| 4 | **CI check** (new workflow file enforcing ADR citation in new Edge Function files) | Small | `.github/workflows/supabase-edge-functions-lint.yml` |
| 5 | Seed 4 follow-up cards under `dev/active/` for the 4 `candidate` ops | Small | 4 dev-doc folders (template: this one) |
| 6 | Verification + PR | Small | PR opened against `main` |

All phases ship together in one PR.

## Phase 1 — Draft ADR

**Path**: `documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md`

**Required structure** (per `documentation/AGENT-GUIDELINES.md`):

- YAML frontmatter: `status: current`, `last_updated: <commit day>`, `adr_version: v1` (per SA3)
- TL;DR block (between `<!-- TL;DR-START -->` / `<!-- TL;DR-END -->`):
  - **Summary**: 1–2 sentences
  - **When to read**: 2–4 SPECIFIC scenarios (e.g. "Creating a new Edge Function or write RPC", "Reviewing a PR that adds operation X to `manage-user`", "Classifying a `candidate` op in the inventory")
  - **Prerequisites**: link `adr-rpc-readback-pattern.md`, `event-handler-pattern.md`
  - **Key topics** (3–6 backticked): `adr`, `edge-function`, `sql-rpc`, `orchestration-tier`, `cqrs`
  - **Estimated read time** (round to 5 min)
- Body sections:
  - **Context** — silent-friction-to-choose problem; cite PR #32 architect report (`a060ef3faaa5b630c`) + pre-review (`afc812e89a6fbed46`)
  - **Decision** — SQL RPC is the default; Edge Function requires meeting ≥1 load-bearing criterion (LB1–LB6)
  - **Selection criteria** — 6 LB indicators (LB1 auth mint, LB2 external API, LB3 workflow fwd, LB4 noauth token, LB5 read-orch, LB6 pre-user-emit); 1 negative indicator (pure DB + auth + perm + read-back); explicit non-criterion (service-role reads ≠ load-bearing); ambiguous-middle rubric with 3 worked cases from Phase 0
  - **Edge Functions as orchestration tier** (elevated to its own section per architect N1) — frontend CQRS Rule 4 does NOT apply; Edge Functions may use service-role reads of any table. Cite `invite-user` + `manage-user` v11 as precedent.
  - **Pattern A v2 compatibility** — Edge Functions that remain load-bearing AND do DB writes MUST implement two-step read-back; `manage-user update_notification_preferences` (v11) is the SOLE reference implementation (per MF3). Other v11 ops have the pre-v11 gap; flagged in inventory notes.
  - **Hybrid case walkthrough** (per SA6) — `organization-delete` pattern: permission check in Edge Function + `api.` RPC call for soft-delete + workflow-layer forward. Classified load-bearing via LB3.
  - **Out-of-scope boundary** (per BS1) — Temporal activities under `workflows/` are NOT governed by this ADR; saga compensation has different failure semantics.
  - **Inventory (as of 2026-04-24)** — Phase 0's table, date-stamped, with grep-recipe footnote per anti-staleness Rule 8
  - **Rollout history** — initial publication (this PR). Future `candidate` extractions append rows.
  - **Consequences** — predictability for new authors; easier review; migration burden on `candidate` functions; frontend-call-site churn during migrations; **deploy-surface consolidation (BS6)** — extraction turns two deploy surfaces into one; **AsyncAPI invariance (BS3)** — extraction does not change event contracts.
  - **Alternatives considered** — status quo (rejected: evidence is `manage-user update_notification_preferences`); all-Edge-Functions (rejected: violates Pattern A v2 atomicity); all-SQL-RPCs (rejected: LB1/LB2/LB3/LB4/LB5 force Edge Functions)
- **Related Documentation** section: `adr-rpc-readback-pattern.md`, `infrastructure/CLAUDE.md` (Rules 4, 9, 13), `event-handler-pattern.md`, `documentation/architecture/data/event-sourcing-overview.md`

**DoD**: Frontmatter + TL;DR + all body sections present; 5+ keyword tags; all relative links resolve.

## Phase 2 — Guard Rail Updates

### 2a — `infrastructure/CLAUDE.md`

- Add new rule (likely in the "Edge Function Deployment" block): *"Before creating a new Edge Function, consult [adr-edge-function-vs-sql-rpc.md]. SQL RPC is the default; Edge Function requires meeting one of the load-bearing criteria there (LB1–LB6)."*
- Add companion opportunistic-migration nudge: *"When touching an Edge Function operation classified `candidate-for-extraction` in the ADR's inventory, prefer extracting that operation to an SQL RPC in the same PR."*
- Bump `last_updated` if the file has frontmatter.

### 2b — `.claude/skills/infrastructure-guidelines/SKILL.md`

- Mirror both rules from 2a
- Place adjacent to existing Rule 4 (Frontend Queries via `api.` Schema RPC ONLY) — shared "which tool for which operation" theme
- No version bump unless explicit version field exists

**DoD**: `grep -rn 'adr-edge-function-vs-sql-rpc' infrastructure/CLAUDE.md .claude/skills/infrastructure-guidelines/SKILL.md` returns ≥1 match per file.

## Phase 3 — Navigation + Cross-links

### 3a — `documentation/AGENT-INDEX.md`

- Add keyword rows: `edge-function`, `sql-rpc`, `orchestration-tier`
- Document Catalog entry (path | summary | keywords | token estimate = line count × 10)
- Cross-ref updates on existing `api-contract` / `rpc-readback` / `cqrs` rows

### 3b — Cross-link from `adr-rpc-readback-pattern.md`

- One-line Related-Documentation entry pointing at new ADR
- Bump `last_updated`

**DoD**: all cross-links resolve (manual grep walk); AGENT-INDEX keyword rows match ADR's TL;DR `Key topics` exactly.

## Phase 4 — CI Check (SA2)

**Path**: `.github/workflows/supabase-edge-functions-lint.yml` (new file)

**Shape** (approx. 20 lines):

```yaml
name: Edge Function ADR Citation Check
on:
  pull_request:
    paths:
      - 'infrastructure/supabase/supabase/functions/**'
jobs:
  check-adr-citation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Identify new Edge Function files
        run: |
          git fetch origin main
          NEW_FILES=$(git diff --name-only --diff-filter=A origin/main...HEAD \
            | grep -E 'infrastructure/supabase/supabase/functions/[^/]+/index\.ts$' || true)
          for f in $NEW_FILES; do
            if ! grep -q 'adr-edge-function-vs-sql-rpc' "$f"; then
              echo "::error file=$f::New Edge Function must cite the ADR in a top-of-file comment. See documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md"
              exit 1
            fi
          done
```

**Scope**:
- **NEW files only** (`--diff-filter=A`) — zero retrofit for the 7 existing functions. Per architect: retrofitting would manufacture churn.
- Grep is case-sensitive and anchored on the ADR filename fragment, so casual references in other doc files don't accidentally pass it.
- CI failure message points directly at the ADR path.

**DoD**: Workflow file lands; triggered on `supabase/functions/**` PR changes; a dry-run branch confirms it would catch a hypothetical new function file missing the citation.

## Phase 5 — Seed Follow-up Cards (4 candidates)

For each `candidate-for-extraction` row in Phase 0:

| # | Card folder | Source op | Priority | Notes |
|---|-------------|-----------|----------|-------|
| 1 | `dev/active/manage-user-to-sql-rpc/` | `update_notification_preferences` | **High** | Architect-validated first target. Supersedes Blocker-3-followup-7. Card scope = this one op only (per architect Q4 — start narrow). |
| 2 | `dev/active/invite-user-revoke-to-sql-rpc/` | `invite-user revoke` | Medium | Pure RPC wrapper; no rollout complexity. |
| 3 | `dev/active/manage-user-delete-to-sql-rpc/` | `manage-user delete` | Medium | Couples with Pattern A v2 retrofit opportunity. |
| 4 | `dev/active/manage-user-modify-roles-to-sql-rpc/` | `manage-user modify_roles` | Low | 1+N+M event emission; more rollout complexity. Revisit after (1) ships. |

**Template** (minimum content per card):
- `context.md` — motivation (cite this ADR + Phase 0 classification), related work, constraints
- `plan.md` — migration-recipe outline (dual-deploy? direct cutover? backward-compat shim?), rollout gate (e.g., N days of zero Edge Function calls)
- `tasks.md` — checkbox breakdown

**DoD**: 4 folders exist under `dev/active/`; each has valid 3-file structure; `manage-user-to-sql-rpc/` explicitly supersedes Blocker-3-followup-7 and references this ADR as activation trigger.

## Phase 6 — Verification + PR

- Manual link walk: every `[text](path)` in new ADR resolves (`grep -oE '\]\([^)]+\)' <file>` + `[ -f $path ]`)
- AGENT-INDEX keyword rows match ADR's TL;DR `Key topics` exactly (AGENT-GUIDELINES Rule 3)
- `npm run docs:check` (frontend validator) remains green — only pre-existing trailing-slash warning acceptable
- No anti-staleness violations (hardcoded counts, stale dates, dangling forward-links)
- Commit on `docs/edge-function-vs-sql-rpc-adr` branch; push; open PR against `main`
- PR body: summary + link to PR #32 architect report + link to this plan

**Post-merge**:
- Archive `dev/active/edge-function-vs-sql-rpc-adr/` → `dev/archived/edge-function-vs-sql-rpc-adr/`
- 4 new `dev/active/<function>-to-sql-rpc/` folders remain in-flight per their priorities
- Update `MEMORY.md` with ADR ship note (per SA3 versioning protocol)

## Risks & Open Questions

- **R1 — Classification disagreement in practice**: The LB6 pre-user-emit criterion is narrow but real (`accept-invitation` only). If future features introduce more pre-user event emission, the criterion may need expansion. Noted but not mitigated in v1.
- **R2 — 4-card backlog load**: 4 `candidate` cards is manageable — no splitting/parking needed. If priorities shift, the low-priority cards can sit in `dev/active/` without causing attention drain (user confirmed 2026-04-24).
- **R3 — Criteria drift**: Durable criteria vs. aging inventory. Inventory has explicit date stamp + grep recipe; criteria section is durable-by-design. Inventory-refresh cadence noted in ADR body ("Walk the inventory every 6 months or when adding a new Edge Function").
- **O1 — `accept-invitation` / `validate-invitation` unification**: Tangent; not this ADR's problem. Noted as "not in scope" in ADR body to preempt future confusion.
- **O2 — Edge Function deploy automation**: Still uses `supabase functions deploy` CLI manually. Noted in Consequences but not mitigated (orthogonal to selection criteria).

## Pre-implementation Gates (all resolved)

- [x] **D1** — Pre-review with `software-architect-dbc` (agent `afc812e89a6fbed46`, 2026-04-24) → LGTM-with-remediation; all items folded
- [x] **D2** — Folder naming `<function>-to-sql-rpc/` (user, 2026-04-24)
- [x] **D3** — All candidate cards seed under `dev/active/` regardless of priority (user, 2026-04-24)

**Ready-to-execute signal**: After user reviews this revised plan and confirms, begin Phase 1 (ADR drafting).
