# API RPC Read-back Pattern — Tasks

## Current Status

**Phase**: Phase 0 (RPC Inventory) — IN PROGRESS
**Status**: 🟢 ACTIVE
**Last Updated**: 2026-04-23 (activated from `dev/parked/` per `client-ou-edit` Phase 9; PR 1 merged as commit `e80de9bd` on 2026-04-23)
**Activated**: 2026-04-23 (branch `chore/activate-api-rpc-readback-pattern`)
**Next Step (concrete)**:
1. Phase 0 inventory tracking table populated in `api-rpc-readback-pattern-plan.md` Phase 0 section (this branch)
2. Open new branch `feat/api-rpc-readback-pattern` from main after this activation PR merges
3. Begin Phase 1 (migration: apply read-back pattern to all standard-pattern RPCs)

---

## Activation Trigger

Activated 2026-04-23. Trigger conditions met:
- ✅ `client-ou-edit` PR 1 merged to main (commit `e80de9bd`)
- ✅ `api.update_client` proof-of-pattern available as reference in migration `20260422052825`
- ✅ `api.change_client_placement` enforcement pattern shipped in migration `20260423032200` (PR #27 review remediation)

## Phase 0: RPC Inventory 🟡 IN PROGRESS (this branch)

- [ ] Run `pg_proc` query to list all `api.update_*` and `api.change_*` RPCs
- [ ] For each, inspect function body via `pg_get_functiondef(oid)` — does it already read back?
- [ ] Classify into: already-done / standard-pattern-apply / complex-case-by-case
- [ ] Produce tracking table in `api-rpc-readback-pattern-plan.md` Phase 0 section
- [ ] Confirm exclusions: `api.update_client`, `api.change_client_placement` (owned by client-ou-edit)

## Phase 1: Migration ⏸️ PARKED

- [ ] Create migration: `supabase migration new api_rpc_readback_pattern`
- [ ] Migration header: document pattern, list all RPCs touched, reference ADR
- [ ] For each standard-pattern RPC (from Phase 0 inventory):
  - [ ] `CREATE OR REPLACE FUNCTION` with read-back + processing_error check
  - [ ] Error codes P9003 (NOT FOUND) + P9004 (handler failure)
  - [ ] Preserve existing param signatures
  - [ ] Add `row_to_json(v_row)` (or explicit `jsonb_build_object` if join needed) to response
- [ ] For each complex RPC (from Phase 0 inventory):
  - [ ] Case-by-case implementation
  - [ ] Document edge cases in migration header comment
- [ ] Apply migration: `supabase db push --linked`
- [ ] Refresh handler reference files for any affected handlers
- [ ] Manual spot-check: call each RPC, verify response shape

## Phase 2: Frontend Service Updates ⏸️ PARKED

- [ ] For each in-scope service (organization, roles, users, schedules, etc.):
  - [ ] Update response type in service interface
  - [ ] Add backward-compat fallback: `response.row || response.entity || ...`
  - [ ] Update unit tests
  - [ ] Update mock service responses

## Phase 3: Documentation ⏸️ PARKED

> **Compliance source**: `documentation/AGENT-GUIDELINES.md` (full creation rules + quality checklist) and `.claude/skills/documentation-writing/SKILL.md` (guard rails). Every new/updated doc must satisfy frontmatter + TL;DR + cross-link requirements.

### 3a: NEW ADR — `documentation/architecture/decisions/adr-rpc-readback-pattern.md`

- [ ] YAML frontmatter:
  - [ ] `status: current`
  - [ ] `last_updated: <YYYY-MM-DD on commit day>`
- [ ] TL;DR block (between `<!-- TL;DR-START -->` / `<!-- TL;DR-END -->`):
  - [ ] **Summary**: 1–2 sentences max — what the ADR decides
  - [ ] **When to read**: 2–4 SPECIFIC scenarios (e.g. "Adding a new `api.update_*` RPC", "Debugging a `processing_error` reaching the frontend"), NOT generic ("when working with RPCs")
  - [ ] **Prerequisites** (optional per `documentation/AGENT-GUIDELINES.md:94` — "Only if doc assumes prior knowledge"; recommended here): link `event-handler-pattern.md`, `event-sourcing-overview.md`
  - [ ] **Key topics** (3–6 backticked keywords): `adr`, `rpc-readback`, `processing-error`, `projection-guard`, `api-contract` — must match AGENT-INDEX entries (3c)
  - [ ] **Estimated read time** (round to nearest 5 min)
- [ ] Body sections:
  - [ ] **Context** — silent-failure problem; reference `client-ou-edit` M3 finding + the proof-of-pattern in `api.update_client`
  - [ ] **Decision** — read-back is mandatory for all `api.update_*` and `api.change_*` RPCs (with exceptions list: creation/deletion/workflow-tier)
  - [ ] **Contract** — response shape (`{success, <entity>, ...}`), error codes (P9003 NOT FOUND / P9004 handler failure), HTTP-level mapping
  - [ ] **Telemetry convention** (added per PR #29 review n2): one short paragraph stating that frontend telemetry MUST distinguish `P9003` from `P9004` by reading the `code` field on the PostgREST error response, NOT by parsing the message text. PostgREST surfaces the PostgreSQL `ERRCODE` as the `code` field in its error JSON body — a stable contract on these codes lets observability dashboards and alerting rules pivot off the code rather than the (changeable) message string. Cite the PostgREST error-response shape as the integration point.
  - [ ] **Rollout history** — link to the migration shipping the change
  - [ ] **Alternatives considered** — Pattern B (client-side polling), why rejected
  - [ ] **Consequences** — projection writes always synchronous (already true via BEFORE INSERT trigger); RPC perf impact (one indexed PK lookup per update; negligible)
- [ ] **Related Documentation** section linking to:
  - [ ] `documentation/infrastructure/patterns/event-handler-pattern.md` (Projection Read-Back Guard section)
  - [ ] `documentation/architecture/decisions/adr-client-ou-placement.md` (Decision 2 enforcement applies the same pattern)
  - [ ] `documentation/architecture/data/event-sourcing-overview.md`
  - [ ] `documentation/infrastructure/guides/event-observability.md` (failed-event monitoring)
- [ ] All internal links use relative paths from the ADR's location
- [ ] Verify frontmatter renders cleanly (preview the markdown)

### 3b: Update existing pattern doc — `documentation/infrastructure/patterns/event-handler-pattern.md`

- [ ] Bump `last_updated` in frontmatter to commit day
- [ ] Update TL;DR `Key topics` if `rpc-readback` is added there
- [ ] **Replace the "Affected RPCs" list (~line 584)** — currently reads "Currently, only the organization unit RPCs follow this pattern". Change to: "All `api.update_*` and `api.change_*` RPCs MUST follow this pattern. Exceptions: <list>", linking to the new ADR for the rollout
- [ ] Add a one-line cross-reference to `adr-rpc-readback-pattern.md` at the top of the "Projection Read-Back Guard" section
- [ ] Add the ADR to the "Related Documentation" list at the end

### 3c: Update navigation — `documentation/AGENT-INDEX.md`

- [ ] **Keyword table** — add row: `rpc-readback | adr-rpc-readback-pattern.md | event-handler-pattern.md, adr-client-ou-placement.md`
- [ ] Verify other relevant keyword entries cross-link to the new ADR (`event-handler`, `projection-guard`, `processing-error` if present)
- [ ] **Document Catalog** section — add the ADR with: path | summary (matches TL;DR Summary) | keywords (matches TL;DR Key topics) | token estimate (use line count × 10; see AGENT-GUIDELINES "Token Estimation Guide")
- [ ] Sanity-check: TL;DR Key topics in 3a == AGENT-INDEX keywords in 3c (else navigation breaks)

### 3d: Update infrastructure guard rail — `infrastructure/supabase/CLAUDE.md`

- [ ] The existing rule (~line 229) "RPC functions that read back from projections MUST check for NOT FOUND" pre-dates this ADR. Add a one-line link: "See [adr-rpc-readback-pattern.md](../../documentation/architecture/decisions/adr-rpc-readback-pattern.md) for the full contract and error-code spec."
- [ ] Bump `last_updated` in `infrastructure/CLAUDE.md` and `infrastructure/supabase/CLAUDE.md` if their TL;DRs are touched

### 3e: Cross-reference in `adr-client-ou-placement.md`

- [ ] In Decision 2's Enforcement subsection, add a forward-link: "This is the first instance of the pattern formalized in [adr-rpc-readback-pattern.md](./adr-rpc-readback-pattern.md)."
- [ ] Bump `last_updated` if the ADR is touched

### 3f: Validation

- [ ] **Manual frontmatter check**: cat the new ADR; confirm `status`, `last_updated`, TL;DR sub-fields all present (no automated CI gate after `Validate Documentation` workflow was removed in commit `430e1c7d`).
- [ ] **Manual link check**: walk every relative link in the new ADR + every updated doc; verify target exists and matches anchor (if any)
- [ ] **Frontend `npm run docs:check`** — passes (this only validates `frontend/src/**` JSDoc alignment, NOT `documentation/` markdown — but must still be green for the PR)
- [ ] **Anti-pattern audit**: re-read AGENT-GUIDELINES "Anti-Patterns to Avoid" section; confirm none present in new/updated docs (no overlong Summary, no generic "When to read", no absolute paths, no orphaned doc)

## Phase 4: ViewModel Simplification ⏸️ PARKED (OPTIONAL — may be separate PR)

For ViewModels that workaround the old pattern by calling `getX()` after every update:
- [ ] Audit frontend ViewModels for post-update `getX()` calls that exist only as workaround
- [ ] Remove redundant fetches where safe
- [ ] Consume `row` from update response directly
- [ ] Update tests
- [ ] Exclude ViewModels that call `getX()` for OTHER reasons (e.g., refreshing joined data)

## Verification ⏸️ PARKED

### PR 1 pre-merge
- [ ] `npm run build` / `npm run lint` — pass
- [ ] `supabase db push --linked --dry-run` — no drift
- [ ] Manual RPC test: update with valid data → response contains row
- [ ] Manual RPC test: force handler failure (e.g., RLS denial) → RPC raises exception
- [ ] Failed events query: `SELECT COUNT(*) FROM domain_events WHERE processing_error IS NOT NULL AND created_at > now() - interval '1 day'` — spot new failures surface correctly
- [ ] `client-ou-edit`'s `api.update_client` read-back consistent with new pattern

### PR 2 (if shipped) pre-merge
- [ ] VM tests still pass after workaround removal
- [ ] No regression in save UX
