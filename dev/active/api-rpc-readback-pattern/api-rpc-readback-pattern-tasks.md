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

## Phase 1: Migration ✅ COMPLETE (2026-04-23 — branch `feat/api-rpc-readback-pattern`)

**Migration**: `infrastructure/supabase/supabase/migrations/20260423060052_api_rpc_readback_pattern.sql` (1164 lines, applied to linked project 2026-04-23). All 11 RPCs refactored using Pattern A (return-error envelope) per software-architect-dbc 2026-04-23 review.

**Pattern A correction**: The parked plan envisioned Pattern B (`RAISE EXCEPTION ... USING ERRCODE = 'P9003'/'P9004'`). Architect review showed Pattern B would roll back the `domain_events` audit row that the trigger just persisted, destroying diagnostic evidence. Pattern A (`RETURN jsonb_build_object('success', false, 'error', '...')`) is the load-bearing alternative; this is what the proof-of-pattern (`api.update_client`) and 7 already-DONE RPCs use, and what shipped in this migration.

- [x] Create migration: `supabase migration new api_rpc_readback_pattern` → `20260423060052`
- [x] Migration header: documents Pattern A rationale (audit-trail preservation), lists all 11 RPCs touched + their projection tables + classification, references the architect report and the proof-of-pattern migrations
- [x] For each NEEDS-PATTERN RPC (10 RPCs):
  - [x] `CREATE OR REPLACE FUNCTION` with `SELECT * INTO v_row FROM <projection> WHERE id = <key>` + `IF NOT FOUND ... fetch processing_error from domain_events ... RETURN error envelope` + `RETURN {success: true, <entity_id>, <entity>: row_to_json(v_row)::jsonb}` on success
  - [x] Existing param signatures preserved (no breaking changes for callers)
  - [x] Caller-driven failures (permission, entity-not-found pre-emit) keep their existing pattern (RETURN error or RAISE — preserved per RPC)
  - [x] `update_organization_direct_care_settings`: BOTH overloads (3-arg + 4-arg) refactored; response shape changed from raw `v_new_settings` jsonb to `{success: true, settings: <jsonb>}` envelope (BREAKING for the one frontend consumer — fixed in companion commit during Phase 2)
  - [x] `update_user_notification_preferences`: read-back uses `organization_id = p_org_id` (projection column is `organization_id`, RPC param is `p_org_id` — handler translates between them)
  - [x] `update_user_phone`: read-back mirrors the pre-emit `IF p_org_id IS NULL` branch between `user_phones` and `user_org_phone_overrides`
  - [x] `update_user`: reads back from base `users` table (predates the `_projection` naming convention); preserves manual stream_version calc + raw `INSERT INTO domain_events` pattern (no `api.emit_domain_event`)
- [x] For COMPLEX-CASE RPC (`update_role`):
  - [x] Composes role row + `array_agg(permission_id)` from `role_permissions_projection` (joined response)
  - [x] Detects partial-success: emitted N events (1 role.updated + N grant + M revoke); the read-back surfaces processing_error from any event in the last 5 seconds so caller knows about partial failures
- [x] Apply migration: `supabase db push --linked --dry-run` clean → `supabase db push --linked` applied
- [x] Verification: post-apply dump confirms all 11 RPCs (12 entries counting both org_direct_care overloads) contain `processing_error` fetch + read-back guard
- [x] Handler reference files: NOT applicable — `api.*` RPCs are not tracked under `infrastructure/supabase/handlers/` per project convention (which scopes to handler/router/trigger functions only)
- [ ] Manual spot-check (deferred to next session): call each refactored RPC via mock data; verify response shape includes `<entity>` field on success and `error: 'Event processing failed: ...'` on handler failure

**Known limitation** (documented in Phase 3 ADR draft): `IF NOT FOUND` only catches the case where the projection row is COMPLETELY MISSING. For UPDATE-only handlers (most refactored RPCs target rows created by separate `add_*` RPCs), a handler that raises mid-update sets `processing_error` but the row remains visible (just stale). Matches the existing 7 DONE-RPC pattern for consistency; a future enhancement could add an explicit `processing_error` check on the just-emitted event after the IF NOT FOUND check across ALL refactored RPCs in lockstep.

**Surfaced during implementation — RESOLVED 2026-04-23 in this PR**: `handle_user_profile_updated` was referenced in `process_user_event()` router (added in `20260217211231` schedule template refactor) but had NEVER been created — 0 migrations defined it, 0 callers of `api.update_user` exist across the codebase, and the live DB confirmed function absence. Every speculative call would set `processing_error` silently in the dispatcher's `WHEN OTHERS` catch.

**Fix shipped** in migration `20260423062426_add_user_profile_updated_handler.sql` (applied 2026-04-23): creates `public.handle_user_profile_updated(p_event record)` which UPDATEs `public.users.first_name`/`last_name` via COALESCE for partial-update semantics. Handler reference file added at `infrastructure/supabase/handlers/user/handle_user_profile_updated.sql` per Rule 7b. With the handler in place + the Pattern A read-back from migration `20260423060052`, `api.update_user` is now end-to-end correct: emits event → handler updates row → read-back returns fresh row → `{success: true, user: <updated row>}`.

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
  - [ ] **Contract** — response shape (`{success: true, <entity>, ...}` on success; `{success: false, error: 'Event processing failed: <processing_error text>'}` on handler failure). HTTP status: always 200 OK (PostgREST shape preserved). NO RAISE EXCEPTION + ERRCODE for handler failures — see "Audit-trail preservation" below.
  - [ ] **Audit-trail preservation** (load-bearing constraint, per software-architect-dbc 2026-04-23) — explicitly forbid `RAISE EXCEPTION` for handler-driven failures (post-emit read-back NOT FOUND). The dispatcher trigger `process_domain_event()` (BEFORE INSERT/UPDATE on `domain_events`) catches handler exceptions and stores them in the NEW row's `processing_error` column without re-raising. The `domain_events` row INSERTs successfully with the failure trace preserved. If an RPC then `RAISE EXCEPTION`s to surface the failure, the entire transaction rolls back including that just-inserted audit row, destroying the diagnostic evidence (admin dashboard at `/admin/events` would see zero failed events; `api.retry_failed_event()` would have nothing to retry). Reference: `infrastructure/supabase/handlers/trigger/process_domain_event.sql:9-58` for the catch-and-persist mechanic; migration `20260220185837_fix_event_routing.sql` (fix F) for a real recovery that depended on the preserved events.
  - [ ] **Telemetry convention** (revised per architect 2026-04-23 — supersedes PR #29 review n2's `code` field assumption): frontend telemetry distinguishes silent-handler-failure responses by parsing `result.error` for the prefix `"Event processing failed: "`. ViewModels surface this via a dedicated `processingError` state (vs. generic `error`) so admin-facing UIs can offer a "View event in audit log" link querying `domain_events WHERE processing_error IS NOT NULL`. The PostgREST `code` field convention from the original n2 note is NOT applicable under Pattern A — RAISE EXCEPTION is forbidden, so PostgREST always returns 200 OK with `{success, error?}`.
  - [ ] **Caller-driven vs handler-driven failures** — caller-driven failures (permission denial, entity-not-found pre-emit, validation errors) happen BEFORE event emission, so no audit trail to preserve. They may use either `RETURN jsonb_build_object('success', false, ...)` or `RAISE EXCEPTION` (each refactored RPC preserves its existing pre-emit pattern). Only post-emit handler failures must use the return-error envelope.
  - [ ] **Rollout history** — link to the migrations shipping the change: `20260422052825` (`api.update_client` proof-of-pattern), `20260423032200` (`api.change_client_placement` PR #27 remediation), `20260423060052` (this generalization across 11 RPCs)
  - [ ] **Alternatives considered** — Pattern B (`RAISE EXCEPTION ... USING ERRCODE = 'P9003'/'P9004'`): rejected because it rolls back the audit row that the trigger pattern just persisted (see "Audit-trail preservation"). Client-side polling: rejected because it required every ViewModel to re-implement the same recheck pattern.
  - [ ] **Known limitation** — `IF NOT FOUND` only catches the case where the projection row is COMPLETELY MISSING. For UPDATE-only handlers (which is the majority — most rows pre-exist from a separate `add_*` RPC), a handler that raises mid-update sets `processing_error` but the row remains visible (just stale). This migration matches the existing 7 DONE-RPC pattern (IF NOT FOUND only) for consistency. A follow-up enhancement could add an explicit `processing_error` check on the just-emitted event after the IF NOT FOUND check; that enhancement should land across ALL refactored RPCs in lockstep.
  - [ ] **Consequences** — projection writes always synchronous (already true via BEFORE INSERT trigger); RPC perf impact (one indexed PK lookup per update; negligible); HTTP status always 200 OK (consistent with existing envelope contract).
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
