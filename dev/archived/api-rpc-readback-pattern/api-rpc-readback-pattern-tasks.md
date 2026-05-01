# API RPC Read-back Pattern — Tasks

## Current Status

**Phase**: Blocker 3 (Scope F PR A) + PR #32 Review Remediation — ✅ MERGED
**Status**: ✅ MERGED (2026-04-24, squash commit `6b4a2fe5` on main)
**Last Updated**: 2026-04-24
**Branch**: `feat/phase4-user-domain-typing` — merged via PR #32 https://github.com/Analytics4Change/A4C-AppSuite/pull/32
**Post-merge actions** (for future work — dev-docs now archived):
1. ~~Monitor PR #32 for merge~~ ✅ Merged 2026-04-24T00:33:39Z
2. ~~Archive `dev/active/api-rpc-readback-pattern/` → `dev/archived/api-rpc-readback-pattern/`~~ ✅ Archived with this commit
3. **Next**: Open new `dev/active/edge-function-vs-sql-rpc-adr/` planning folder — Blocker-3-followup-6 (ADR on Edge Function vs SQL RPC selection criteria)
4. **After #3**: Reassess Blocker-3-followup-7 (break up `manage-user` Edge Function into per-operation SQL RPCs) — architect `a060ef3faaa5b630c` confirmed "strictly superior architecturally" but correctly deferred pending #6
5. **Parked**: PR B (Site 1 address backend implementation) — separate planning session

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

## Phase 1.6: Pattern A v2 — race-safe `processing_error` check via captured event_id ✅ COMPLETE (2026-04-23)

> **Trigger**: Architect (`software-architect-dbc`, agent ID `a26d286c3c12db3d5`) follow-up review on 2026-04-23 confirmed the field-level write-through gap originally documented as a "Known Limitation" in the ADR. Recommended landing the v2 enhancement on this same branch before opening the PR, retrofitting ALL pre-existing DONE RPCs in lockstep for pattern consistency.

**Migration**: `infrastructure/supabase/supabase/migrations/20260423065747_api_rpc_readback_v2_event_id_check.sql` (1820 lines, applied 2026-04-23). Required `supabase migration repair --status reverted` after the initial apply (an heredoc bug truncated 6 RPCs from the file; the repair allowed re-pushing the corrected complete file). Net result: all 20 function definitions retrofitted in one atomic apply.

**v2 changes per RPC** (mechanical):
1. Add `v_event_id uuid;` to DECLARE.
2. Capture: `v_event_id := api.emit_domain_event(...)` (was `PERFORM`). `api.emit_domain_event(...) RETURNS uuid` already.
3. After the existing IF NOT FOUND block: `SELECT processing_error INTO v_processing_error FROM domain_events WHERE id = v_event_id; IF v_processing_error IS NOT NULL THEN RETURN error envelope; END IF;`

**RPCs retrofitted** (20 function definitions across 19 RPCs):

Phase 1 RPCs (10 unique RPCs, 11 defs counting the 2 overloads of `update_organization_direct_care_settings`):
- [x] `api.update_client_address`
- [x] `api.update_client_email`
- [x] `api.update_client_funding_source`
- [x] `api.update_client_insurance`
- [x] `api.update_client_phone`
- [x] `api.update_organization_direct_care_settings` (3-arg overload)
- [x] `api.update_organization_direct_care_settings` (4-arg overload)
- [x] `api.update_user`
- [x] `api.update_user_phone`
- [x] `api.update_user_notification_preferences`
- [x] `api.update_schedule_template`

Pre-existing DONE RPCs (9 — predates this branch):
- [x] `api.update_client` (proof-of-pattern, migration `20260422052825`)
- [x] `api.change_client_placement` (migration `20260423032200`)
- [x] `api.update_organization_unit` (migration `20260221173821`)
- [x] `api.update_organization` (migration `20260226002002`)
- [x] `api.update_organization_address` (migration `20260226002002`)
- [x] `api.update_organization_contact` (migration `20260226002002`)
- [x] `api.update_organization_phone` (migration `20260226002002`)
- [x] `api.update_field_definition` (migration `20260408023403`)
- [x] `api.update_field_category` (migration `20260408023403`)

**Intentionally NOT retrofitted**:
- `api.update_role` — uses COMPLEX-CASE multi-event 5-second-window check appropriate for its multi-emit semantics (1 role.updated + N role.permission.granted + M role.permission.revoked). Its existing pattern stays as-is.

**Verification** (post-apply via re-dump):
- 20 `WHERE id = v_event_id` post-emit checks present across the 19 RPCs (per-RPC dump-walking confirmed)
- `update_role` body unchanged (5-second-window check intact, single grep match)
- All 20 RPCs preserve their existing IF NOT FOUND fallback (defense in depth)
- `api.emit_domain_event(...) RETURNS uuid` already — no signature change required

**Doc updates** (Phase 1.6c):
- `documentation/architecture/decisions/adr-rpc-readback-pattern.md`: "Known Limitation" section replaced with "Pattern A v1 → v2 (Resolved 2026-04-23)" — full v2 spec, defense-in-depth rationale, race-safety explanation, intentional-skip note for update_role; Decision 1 updated to show v2 standard form; Rollout history extended with this migration; Date + Status header bumped
- `infrastructure/supabase/CLAUDE.md`: existing rule "RPC functions that read back ... MUST check for NOT FOUND" upgraded to "MUST use Pattern A v2 (BOTH checks)" with full code template; explicit warning that NEVER RAISE EXCEPTION for handler-driven failures retained
- `documentation/infrastructure/patterns/event-handler-pattern.md`: "Required Pattern" section renamed to "Required Pattern (Pattern A v2)" with new dual-check code example + defense-in-depth rationale; cross-link to ADR's "Pattern A v1 → v2" section

---

## Phase 2: Frontend Service Updates ✅ COMPLETE (2026-04-23)

- [x] **`SupabaseDirectCareSettingsService.ts` — BREAKING change handled**: response shape changed from raw `{enable_*}` jsonb to `{success: true, settings: {enable_*}}` envelope. Updated `updateSettings()` to detect the new envelope (presence of `success` key), branch on `success === false` to throw with `error` message, and read `data.settings.*`. Backward-compat fallback preserved for the legacy raw-jsonb shape (in case the migration hasn't deployed to a particular environment yet) — branches in if `success` key is absent.
- [x] **`MockDirectCareSettingsService.ts`** — no change needed; mock implements `IDirectCareSettingsService` interface directly (returns `DirectCareSettings`), so the supabase service translates between RPC envelope and interface shape.
- [x] **`DirectCareSettingsViewModel.test.ts`** — no change needed; tests use the interface contract (which is unchanged). 29/29 passing.
- [x] **`ClientRpcResult` type** — added optional read-back entity fields (`phone`, `email`, `address`, `policy`, `funding_source`) so consumers can use the new RPC response shape opportunistically without re-fetching. Existing consumers continue to work (they just don't read the new fields).
- [x] **Other refactored RPC consumers** (`SupabaseClientService.ts` for 5 client sub-entity RPCs, `SupabaseRoleService.ts` for `update_role`, `SupabaseScheduleService.ts` for `update_schedule_template`) — audit confirmed all are non-breaking. Consumers parse the response envelope and check `success`; the new `<entity>` fields are additive and ignored. No behavioral changes required for Phase 2 acceptance — opportunistic refactors to consume the new fields can land in Phase 4 (ViewModel simplification).
- [x] Verification: `npm run typecheck` ✓, `npm run lint` ✓, `npm run test -- --run src/viewModels/settings/__tests__/DirectCareSettingsViewModel.test.ts` ✓ (29 passed).

## Phase 3: Documentation ✅ COMPLETE (2026-04-23)

> **Compliance source**: `documentation/AGENT-GUIDELINES.md` (full creation rules + quality checklist) and `.claude/skills/documentation-writing/SKILL.md` (guard rails). Every new/updated doc satisfies frontmatter + TL;DR + cross-link requirements.

**Artifacts**:
- New ADR `documentation/architecture/decisions/adr-rpc-readback-pattern.md` (~270 lines, 2400-token estimate, key topics: `adr`, `rpc-readback`, `processing-error`, `projection-guard`, `api-contract`)
- `documentation/infrastructure/patterns/event-handler-pattern.md`: TL;DR Key topics extended (`rpc-readback`, `projection-guard`); `last_updated` bumped to 2026-04-23; "Affected RPCs" list inverted from "only org-unit RPCs" to a full table organized by group with explicit exceptions; cross-link added at the top of "Projection Read-Back Guard" section + in "Related Documentation"
- `documentation/AGENT-INDEX.md`: 3 new keyword rows (`api-contract`, `processing-error`, `rpc-readback`) + 1 cross-ref update on `projection-guard`; new Document Catalog entry for the ADR
- `infrastructure/supabase/CLAUDE.md`: existing "RPC functions that read back ... MUST check for NOT FOUND" guard rail extended with explicit "NEVER `RAISE EXCEPTION` here" warning + audit-trail-preservation rationale; forward-link to new ADR added in TL;DR + at the bottom of the relevant rule
- `documentation/architecture/decisions/adr-client-ou-placement.md` Decision 2 Enforcement subsection: forward-link added to new ADR (proof-of-pattern → general pattern)

**Validation**:
- All 12 relative links in the new ADR resolve to existing files (manual walk via `grep -oE` + `[ -f $path ]`)
- Frontmatter renders cleanly (status, last_updated, TL;DR with all required sub-fields per AGENT-GUIDELINES)
- Bidirectional links wired: ADR ↔ event-handler-pattern.md, ADR ↔ adr-client-ou-placement.md, ADR ↔ infrastructure/supabase/CLAUDE.md
- AGENT-INDEX keyword entries match TL;DR Key topics on the ADR
- `npm run docs:check`: pre-existing broken-link in `frontend/src/components/ui/CLAUDE.md` (validator doesn't handle trailing-slash directory links) — NOT caused by Phase 3 work, unchanged from prior state. No new errors introduced.

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

## Phase 4: ViewModel Simplification + `ClientRpcResult` Type-Safety Refactor ⏸️ PARKED (separate PR)

> **Architect-reviewed plan** (software-architect-dbc agent `ad2e78383cd378c9f`, 2026-04-23) — produced in response to PR #30 review finding m4. Full report saved to `/tmp/toolu_01H1MrxcYMxxv6F7U9cyWHjS.json`. Recommended **Option C** (separate named types per RPC, shared `ClientRpcEnvelope` base) after weighing Option A (generic `<T>`), Option B (single discriminated union), Option C (one type per RPC).

### 4a: ViewModel redundant-fetch removal (original Phase 4 scope) — 🟡 PARTIAL (2026-04-23)

**Audit complete** (Explore agent, 2026-04-23): 29 ViewModels scanned; 8 sites flagged. Classifications below:

| # | ViewModel | Pattern | Final Classification |
|---|-----------|---------|----------------------|
| 1 | `DirectCareSettingsViewModel.ts:146` | `updateSettings()` → `loadSettings()` | **REDUNDANT ✅ Fixed** |
| 2 | `OrganizationDashboardViewModel.ts:284` | `updateOrganization()` → `loadOrganization()` | **LEGITIMATE (skip)** — service returns `Partial<OrganizationDetailRecord>` which has different field names (`timezone` vs `time_zone`) + types (string vs Date) from VM state `Organization`. Reload performs necessary shape normalization. |
| 3 | `OrganizationManageFormViewModel.ts:556` | `performEntityOperation()` shared reload | **LEGITIMATE (skip)** — shared helper used by CREATE/UPDATE AND DELETE. DELETE legitimately needs list refresh. Would require splitting helper to optimize just CREATE/UPDATE paths — not worth the churn. |
| 4 | `RolesViewModel.ts:414` | `updateRole()` → `loadRoles()` | **✅ Fixed (2026-04-23, Blocker 1)** — `RoleOperationResult` extended with optional `permission_ids?`; `role?` already present. `SupabaseRoleService.updateRole()` + `MockRoleService.updateRole()` now propagate the snake-case `roles_projection` row + permission_ids through the result. VM patches `rawRoles` in place, preserving the existing `userCount` (not returned by RPC — computed via LEFT JOIN in `list_roles`). Test updated to assert no follow-up `getRoles()` and list-patch result. |
| 5 | `ClientFieldSettingsViewModel.ts:578` | `updateFieldDefinition()` → `loadData()` | **✅ Fixed (2026-04-23, Blocker 2)** — Migration `20260423154534_client_field_rpc_return_entities.sql` extends `api.update_field_definition` to return the refreshed `field` JSON (list-shape with joined `category_name`/`category_slug`). `RpcResult` narrowed via Phase 4b pattern into `FieldRpcEnvelope` + 4 named types (`FieldDefinitionResult`, `FieldCategoryResult`, `DeleteFieldResult`, `DeleteCategoryResult`). Service + mock propagate the entity. VM patches `fieldDefinitions` in place. |
| 6 | `ClientFieldSettingsViewModel.ts:647` | `updateFieldCategory()` → `loadData()` | **✅ Fixed (2026-04-23, Blocker 2)** — Same migration extends `api.update_field_category` to return the refreshed `category` JSON with computed `is_system`. VM patches both `categories` AND any `fieldDefinitions` whose cached `category_name` just changed. |
| 7 | `UsersViewModel.ts:1407,1561,1717` (3 sites) | sub-entity updates → list reloads | **BLOCKED — service gap** — `SupabaseUserCommandService.updateUserAddress/Phone/NotificationPreferences` don't propagate read-back rows. Service returns `{success, phoneId, eventId}` without the full phone row. |

**Shipped in this work**: #1 only.

**Follow-up work** (separate PRs, in order):

**4a-follow-up-1** — Service result-type refactors. Apply Phase 4b's pattern (named `*Result` types per RPC) to:
- `RoleOperationResult` in `rbac.types.ts` → `UpdateRoleResult { role?, permission_ids? }` + narrower types per RPC
- `UserOperationResult` in user types → split into `UserPhoneResult`, `UserAddressResult`, etc.
- `RpcResult` in `client-field-settings.types.ts` → `FieldDefinitionResult`, `FieldCategoryResult`, etc.

**4a-follow-up-2** — Service propagation. For each refactored service (`SupabaseRoleService`, `SupabaseUserCommandService`, `SupabaseClientFieldService`), read the RPC's read-back entity from `data` and pass it through the narrowed result.

**4a-follow-up-3** — ViewModel simplification. Once services propagate, remove the redundant `loadX()` calls in #4, #5, #6, #7. This is the original "Phase 4a" scope; it was blocked by the upstream service-layer gaps.

**Why this split**: The original Phase 4a scope assumed services ALREADY returned entities. Phase 4b proved that's true at the RPC envelope layer for the client domain, but the service wrappers for role/user/field-settings discard the entity fields before handing back to the ViewModel. Fixing the VM alone is unsafe without service plumbing.

**DoD for this phase** (as completed 2026-04-23):
- [x] Audit all VMs for post-update fetches
- [x] Classify each hit as REDUNDANT / LEGITIMATE / BLOCKED
- [x] Fix the 1 unblocked case (DirectCareSettingsViewModel)
- [x] Update the test that asserted the obsolete refetch behavior
- [x] Document blocked cases with specific service-layer gaps for follow-up PRs

### 4b: `ClientRpcResult` type-safety refactor (m4 remediation — Option C)

**Why**: PR #30 review m4 flagged that `ClientRpcResult` in `frontend/src/types/client.types.ts:696-718` has 6 optional read-back entity fields (`client?`, `phone?`, `email?`, `address?`, `policy?`, `funding_source?`) + 7 optional `*_id` fields. Consumers must know by convention which RPC populates which field — not type-safe. Reviewer suggested discriminated union / generic; architect recommended **Option C** (separate named types) as the best fit for the project's flat-envelope wire format and existing `IClientService.ts` method-per-entity shape.

**Reasoning** (architect): The live RPC envelope is FLAT (not nested under `data`). Option A requires a service-layer adapter to re-wrap. Option B requires a `kind` discriminator the backend doesn't emit (so it becomes a frontend stamp anyway). Option C maps 1:1 to the wire format and matches the project's "one concrete type per concern" convention (`EffectivePermission`, `JWTPayload` in `_shared/types.ts`). Zero runtime cost; strictest compile-time narrowing.

**Contract spec** (drop into `frontend/src/types/client.types.ts`, replacing the legacy `ClientRpcResult`):

```typescript
export interface ClientRpcEnvelope {
  success: boolean;
  error?: string;  // Pattern A v2: 'Event processing failed: ...' on handler failure
}

export interface ClientUpdateResult    extends ClientRpcEnvelope { client_id?: string;         client?: ClientProjectionRow }
export interface ClientPhoneResult     extends ClientRpcEnvelope { phone_id?: string;          phone?: ClientPhone }
export interface ClientEmailResult     extends ClientRpcEnvelope { email_id?: string;          email?: ClientEmail }
export interface ClientAddressResult   extends ClientRpcEnvelope { address_id?: string;        address?: ClientAddress }
export interface ClientInsuranceResult extends ClientRpcEnvelope { policy_id?: string;         policy?: ClientInsurancePolicy }
export interface ClientFundingResult   extends ClientRpcEnvelope { funding_source_id?: string; funding_source?: ClientFundingSource }
export interface ClientPlacementResult extends ClientRpcEnvelope { placement_id?: string }
export interface ClientAssignmentResult extends ClientRpcEnvelope { assignment_id?: string }
export type     ClientVoidResult       = ClientRpcEnvelope;   // remove_* RPCs
/** @deprecated Use the specific Client*Result matching your RPC. */
export interface ClientRpcResult extends ClientRpcEnvelope { /* legacy union-of-all-fields */ }
```

**Call sites to migrate** (architect-verified via grep):

| File | Usage | Action |
|------|-------|--------|
| `frontend/src/types/client.types.ts` | 1 decl | Replace; mark legacy `@deprecated`; add 9 new types |
| `frontend/src/services/clients/IClientService.ts` | ~24 method sigs | Narrow each `Promise<ClientRpcResult>` to specific result |
| `frontend/src/services/clients/SupabaseClientService.ts` | ~47 refs | Narrow return types; object literals already compatible via shared base |
| `frontend/src/services/clients/MockClientService.ts` | ~24 refs | Same narrowing as Supabase service |
| `frontend/src/viewModels/client/ClientIntakeFormViewModel.ts` | ~2 refs | Narrow call-site variables |

Total ~5 files, ~98 references. Most bodies (`return { success: false, error }`) compile unchanged — the narrowing happens at field-access call sites.

**Definition of Done**:
- [ ] `ClientRpcEnvelope` base added to `frontend/src/types/client.types.ts`
- [ ] 9 specific result types added: `ClientUpdateResult`, `ClientPhoneResult`, `ClientEmailResult`, `ClientAddressResult`, `ClientInsuranceResult`, `ClientFundingResult`, `ClientPlacementResult`, `ClientAssignmentResult`, `ClientVoidResult`
- [ ] Legacy `ClientRpcResult` marked `@deprecated` pointing at the replacements
- [ ] `IClientService.ts` method signatures narrowed to specific result types
- [ ] `SupabaseClientService.ts` return types narrowed; PostgREST rpc() calls cast at the boundary
- [ ] `MockClientService.ts` return types narrowed; mock literals type-check cleanly
- [ ] `ClientIntakeFormViewModel.ts` (and any other consumer) uses narrowed types
- [ ] `npm run typecheck` passes
- [ ] `npm run docs:check` passes (update JSDoc on consumer APIs if needed)
- [ ] Grep-audit: 0 external references to legacy `ClientRpcResult`
- [ ] Delete legacy `ClientRpcResult` after audit confirms 0 external refs
- [ ] Consider parallel refactor for `RpcResult` in `client-field-settings.types.ts` (same anti-pattern, 6 optional fields) — separate task card or same PR; recommend separate
- [ ] ADR `adr-rpc-readback-pattern.md` gets a "Frontend Envelope Types" section referencing these new types
- [ ] `data-testid` attributes on any UI surfacing the new read-back data — verify existing IDs remain valid (likely no new ones needed since field names don't change)

**Pre-implementation gate**: The plan above was pre-reviewed by `software-architect-dbc` (agent `ad2e78383cd378c9f`) per PR #30 user instruction. Any substantive deviation (switching to Options A/B, bundling with Phase 4a, expanding to `client-field-settings.types.ts` in the same PR) MUST be re-reviewed by the same architect pattern before execution.

## PR #30 Review Remediation ✅ IN PROGRESS (2026-04-23)

All findings from PR #30 self-review (architect-reviewed, agent `ad2e78383cd378c9f`):

| Finding | Severity | Resolution | Status |
|---------|----------|------------|--------|
| **M1** — 6 RPCs use race-prone `ORDER BY created_at DESC LIMIT 1` inside IF NOT FOUND fallback despite `v_event_id` in scope | Major | Migration `20260423074238_api_rpc_readback_v2_m1_m2_fix.sql` rewrites the 6 RPCs with `WHERE id = v_event_id` | ✅ Applied 2026-04-23 |
| **M2** — `update_role` uses arbitrary 5-second wall-clock window for processing_error detection | Major | Same migration captures each emit's `v_event_id` into `uuid[]`; uses `WHERE id = ANY(v_event_ids)` | ✅ Applied 2026-04-23 |
| **m3** — `update_user` pre-existing race on manual `MAX(stream_version)+1` calc (not a regression) | minor | **Parked** to `dev/active/update-user-stream-version-race/` follow-up (0 current callers) | ⏸️ Parked |
| **m4** — `ClientRpcResult` type is increasingly polymorphic | minor | **Phase 4b** plan above (Option C, architect-reviewed) | ⏸️ Parked to Phase 4b |
| **m5** — Sensitive data in `processing_error` strings returned to callers | minor | **Parked** to `dev/active/rpc-error-pii-sanitization/` (Hybrid Option 6 — strip `PG_EXCEPTION_DETAIL` at trigger + display-layer masking) | ⏸️ Parked |
| **N1** — Boilerplate duplication across 20 RPC defs | nit | Accepted as-is; ADR Alternatives-Considered note added (plpgsql can't `RETURN` from helpers) | ✅ ADR updated |
| **N2** — Test plan checkbox open | nit | Spot-check procedure added to PR #30 body (injected CHECK constraint → envelope verification) | ✅ PR body updated |
| **N3** — Heredoc bug postmortem | nit | Added to `context.md` Implementation Lessons; travels with dev-docs on archive | ✅ context.md updated |

## PR #31 Review Remediation ✅ IN PROGRESS (2026-04-23)

Context: `lars-tice` self-review on PR #31 (`feat/phase4-client-rpc-result-typing`) — Approve with suggestions, nothing blocking. 10 observations catalogued.

| ID | Item | Type | Resolution | Status |
|----|------|------|------------|--------|
| **M1** | `SupabaseRoleService.updateRole` silent `{success: true}` fallback when `response.role` missing — VM can't patch list, UI shows stale data | minor | `log.warn` with rich context (`responseKeys`, `hasPermissionIds`) added at all 3 sites exhibiting the pattern: `SupabaseRoleService.updateRole`, `ClientFieldSettingsViewModel.updateCustomField`, `ClientFieldSettingsViewModel.updateCategory` | ✅ Fixed |
| **M2** | Correlation ID generation on UPDATE RPCs | minor | **Parked** — new follow-up: audit all `api.update_*`/`change_*` RPCs; replace `COALESCE(p_correlation_id, gen_random_uuid())` with `SELECT correlation_id FROM <projection> WHERE id = p_<id>` lookup; preserves entity-lifecycle query semantics per `infrastructure/CLAUDE.md` business-scoped pattern. See "4a-follow-up-4" below. | ⏸️ Parked |
| **M3** | 9 pre-existing failures in `SupabaseClientFieldService.test.ts` | verification | **Fixed** — git-log analysis traced to test-expectation drift from 3 prior commits (`4849122b` removed `p_changes` stringification, `5d479918` added `p_correlation_id`, `697068b8` removed `p_validation_rules` stringification). All 9 topical (test-side only); no production change. Restored green baseline: 26/26 passing. | ✅ Fixed |
| **N1** | `v_existing record` overkill in migration `20260423154534` | nit | **Parked** — migration style cleanup follow-up. See "4a-follow-up-5". | ⏸️ Parked |
| **N2** | `is_system` always `false` in `update_field_category` read-back (pre-emit filter excludes system categories) | nit | JSDoc `Invariant` section added to `FieldCategoryResult` — documents at consumer boundary; avoids edit-applied-migration hygiene issue | ✅ Fixed |
| **N3** | `MockRoleService.ts` prettier reformat inflated review surface | process note | No code change; future-PR process note to run prettier in separate commit | ⏸️ No action |
| **N4** | `IClientFieldService` JSDoc only annotates 2 of 10 methods | nit | Per-method JSDoc added to 6 create/deactivate/reactivate methods (4 field, 2 category — the 2 category deactivate/reactivate already had good enough docs; check count in commit) clarifying which methods populate entity vs return id only | ✅ Fixed |
| **R1** | `add_client_*` RPCs don't return entities; types admit it as optional | documentation | JSDoc expanded on 5 dual-RPC `Client*Result` types (Phone, Email, Address, Insurance, Funding) explicitly noting `<entity>` is populated by `update_client_*` only | ✅ Fixed |
| **R2** | Blocker 3 (UsersViewModel) remains deferred | known | Already parked; planning pass pending before implementation | ⏸️ Parked |
| **R3** | No automated smoke test for Pattern A v2 migrations | future | **Parked** — future CI check. See "4a-follow-up-6". | ⏸️ Parked |

### 4a-follow-up-4: Correlation ID preservation on UPDATE RPCs

**Scope**: Codebase-wide audit of all `api.update_*` / `api.change_*` RPCs (~19 definitions post Phase 1.6). Each currently uses `COALESCE(p_correlation_id, gen_random_uuid())` on UPDATE, minting a new correlation_id when the caller omits one. Per `infrastructure/CLAUDE.md` Correlation ID Pattern: UPDATE should **look up and reuse** the correlation_id stored at CREATE time so queries by `correlation_id` return the entity's full lifecycle.

**Acceptance criteria**:
- [ ] Audit which projections already store `correlation_id` (varies per entity); identify missing ones requiring schema additions.
- [ ] For each UPDATE RPC, replace `COALESCE(p_correlation_id, gen_random_uuid())` with `SELECT correlation_id FROM <projection> WHERE id = p_<id>` lookup — fallback only on first-update-ever or no-stored-id case.
- [ ] ADR note on the pattern (likely extension to `adr-rpc-readback-pattern.md` or a new correlation-id ADR).
- [ ] Spot-check: update an entity; query `domain_events WHERE correlation_id = <original>` — expect full lifecycle (CREATE + UPDATEs) in chronological order.

**Blocker on scope expansion**: may surface "correlation_id was never stored for domain X" cases requiring backfill plans.

### 4a-follow-up-5: Migration style cleanup — `v_existing record` → `PERFORM 1 ... IF NOT FOUND`

**Scope**: Audit applied migrations for the `DECLARE v_existing record; ... SELECT id INTO v_existing FROM ... IF NOT FOUND THEN ...` pattern. Replace with idiomatic `PERFORM 1 FROM <table> WHERE ... ; IF NOT FOUND THEN ...; END IF;` via `CREATE OR REPLACE FUNCTION`. Zero runtime impact.

**Why defer**: Pure hygiene; not a bug. Editing applied migration files risks local/DB drift. Cleanup must land as a fresh migration.

### 4a-follow-up-6: Pattern A v2 RPC smoke test

**Scope**: New `pg_tap` or RPC integration test file that, for every `api.update_*` / `api.change_*` RPC (19 defs):

- [ ] Inject a forced handler failure via a temporary CHECK constraint on the target projection.
- [ ] Call the RPC.
- [ ] Assert envelope shape: `{success: false, error: 'Event processing failed: ...'}`.
- [ ] Assert `domain_events` row persisted with `processing_error` populated.
- [ ] Cleanup constraint.
- [ ] Separately assert `success` path returns expected entity fields per list-shape contract (`field`, `category`, `client`, `phone`, etc.).

Wires into CI alongside existing `plpgsql_check` (which only catches static errors).

## Blocker 3 — User Domain Cleanup ✅ COMPLETE (2026-04-23; PR #32 remediation 2026-04-24 upgrades Edge Function to v11 real Pattern A v2 read-back)

**Branch**: `feat/phase4-user-domain-typing` — Scope F PR A.
**Architect review**: `software-architect-dbc` agent `a9dee2ed181895edb`.

| Site | Resolution |
|------|------------|
| Type anti-pattern (`UserOperationResult` flat union, 5 optional fields × 19 methods) | ✅ Narrowed to `UserRpcEnvelope` + 4 specific result types + `UserVoidResult` |
| Site 1 (`updateUserAddress` → `loadUserAddresses`) | ⏸️ Deferred to PR B — backend RPCs not yet implemented; Supabase service throws `"not yet implemented"` |
| Site 2 (`updateUserPhone` → `loadUserPhones`) | ✅ Misclassified in earlier audit — `api.update_user_phone` already returns `phone` entity. Wired type hint, map snake_case→camelCase, VM patches list in place by id with fallback + `log.warn`. Same wire-up for `addUserPhone` after new migration. |
| Site 3 (`updateNotificationPreferences` → `loadUserOrgAccess`) | ✅ Edge Function route (not SQL RPC). `manage-user` v10 adds `notificationPreferences` + `deployVersion` to response envelope. VM patches `userOrgAccess.notificationPreferences` in place with version-gated fallback. |

**New backend artifacts**:
- Migration `20260423232531_add_user_phone_pattern_a_v2_readback.sql` — extends `api.add_user_phone` with Pattern A v2 read-back; branches `p_org_id IS NULL` to read from correct projection (`user_phones` vs `user_org_phone_overrides`); returns camelCase `phone` via explicit `jsonb_build_object`.
- Edge Function `manage-user` v10 — `update_notification_preferences` operation returns `{success, userId, operation, deployVersion, notificationPreferences}`.

**New frontend artifacts**:
- `UserRpcEnvelope` base + `InviteUserResult`, `UpdateUserResult`, `UserPhoneResult`, `UpdateNotificationPreferencesResult`, `UserVoidResult` in `user.types.ts`
- Narrowed signatures across `IUserCommandService` + `SupabaseUserCommandService` + `MockUserCommandService` + 5 consumer VMs
- `log.warn` fallback telemetry at all 3 read-back consumer sites in VM
- NEW test file `MockUserCommandService.envelope.test.ts` (7/7 tests — envelope-contract coverage)
- NEW test file `UserRpcContract.test.ts` (11/11 tests — anti-drift structural assertions parsing migration SQL)

**New documentation artifacts**:
- NEW: `documentation/frontend/patterns/rpc-readback-vm-patch.md` — VM in-place patch pattern at the 3-domain threshold (Roles, ClientFields, Users)
- Updated: ADR rollout history + frontend envelope types mapping table
- Updated: AGENT-INDEX keyword + Document Catalog entries

### Blocker 3 — Follow-up tasks

| ID | Title | Status |
|----|-------|--------|
| Blocker-3-followup-1 | Primary-phone exclusivity invariant (partial unique index + handler logic) | ⏸️ Parked |
| Blocker-3-followup-2 | `manage-user` Edge Function fallback removal (acceptance: N days / zero fallback `log.warn` events) | 🔍 In Verification (pending query results) — [verification packet](../../../dev/active/api-rpc-readback-pattern/blocker-3-followup-2-verification-2026-05-01.md) · [draft PR #45](https://github.com/Analytics4Change/A4C-AppSuite/pull/45) |
| Blocker-3-followup-3 | Broader RPC-params contract tests (enumerate all `api.*` functions) | ⏸️ Parked |
| Blocker-3-followup-4 | `frontend/src/viewModels/users/CLAUDE.md` VM-level docs | ⏸️ Parked |
| Blocker-3-followup-5 | `updateUser` optional in-place patch in consumer VMs | ⏸️ Parked |
| Blocker-3-followup-6 | Document Edge-Function-vs-SQL-RPC selection as an ADR | ⏸️ Parked |
| Blocker-3-followup-7 | Evaluate breaking up `manage-user` Edge Function into individual SQL RPCs. **Motivation strengthened by PR #32 review item 1 (silent-failure gap in Edge Function Pattern A v2 consumer — resolved by v11 real read-back) and architect `a060ef3faaa5b630c` finding that a SQL RPC wrapper would be "strictly superior architecturally" (single-transaction PL/pgSQL read-back; no two-client-call round-trip).** Depends on Blocker-3-followup-6 (Edge-Function-vs-SQL-RPC ADR). | ⏸️ Parked (depends on #6) |
| PR-B | Site 1 address backend implementation (separate planning session) | ⏸️ Parked |

## PR #32 Review Remediation ✅ COMPLETE (2026-04-24)

Two commits on `feat/phase4-user-domain-typing`:
- **Commit A `e9a39a21`** — Edge Function `manage-user` v11: real Pattern A v2 read-back + `organization_id` audit metadata
- **Commit B `ffb00780`** — frontend remediation (items 3–6) + architect MUST-FIX Q4/Q7 + SHOULD-ADD Q5/Q8/Q9.1

**Architect review**: `software-architect-dbc` agent `a060ef3faaa5b630c`. Verdict: LGTM with 2 MUST-FIX + 6 SHOULD-ADD refinements — all integrated into this remediation chain. Architect validated: direct-table read via `supabaseAdmin` (service-role) is appropriate (not a CQRS violation — applies to frontend, not Edge Functions); race-safety of PK-lookup on `domain_events.id = v_event_id` is correct (BEFORE INSERT trigger runs inside INSERT txn → commits before second Edge Function round-trip); item 6 "phantom arm" rebuttal factually correct (verified at `UserFormViewModel.ts:961-969`); SQL RPC wrapper "strictly superior architecturally" but correctly deferred to Blocker-3-followup-7.

| ID | Item | Type | Resolution | Status |
|----|------|------|------------|--------|
| **Item 1** | Silent-failure gap in Edge Function Pattern A v2 consumer (v10 echoed submitted prefs — no `processing_error` check, no real read-back) | SHOULD-ADDRESS | Edge Function v11: two-step check — (1) `SELECT processing_error FROM domain_events WHERE id = v_event_id` → error envelope if set, (2) `SELECT ... FROM user_notification_preferences_projection WHERE user_id=? AND organization_id=?` → error envelope if NOT-FOUND (tagged `handlerInvariantViolated: true`). Transforms DB columns back to AsyncAPI snake_case shape. | ✅ Fixed |
| **Item 2** | Factually-incorrect comment in `manage-user` v10 citing `user_org_access` as target table (handler actually writes `user_notification_preferences_projection`) | SHOULD-ADDRESS | Replaced with real read-back (Item 1 fix) — comment now cites handler file + `adr-rpc-readback-pattern.md:93` + authoritative column list. Paired drift-guard comment added to handler SQL reference file. | ✅ Fixed |
| **Item 3** | No unit tests for `SupabaseUserCommandService` snake_case→camelCase mapping | SHOULD-ADDRESS | NEW `frontend/src/services/users/__tests__/SupabaseUserCommandService.mapping.test.ts` — 7 tests (`vi.hoisted()` pattern): updateUserPhone (snake→camel, error envelope, malformed date), addUserPhone (camelCase passthrough), updateUser (null + undefined lastLoginAt), updateNotificationPreferences (v11 error envelope contract). 7/7 passing. | ✅ Fixed |
| **Item 4** | Deprecated `UserOperationResult` should be deleted now per "same PR" intent | NIT | Deleted interface + `@deprecated` JSDoc from `user.types.ts`. Pre-verified zero external consumers via `grep -rn UserOperationResult src/ documentation/`. | ✅ Fixed |
| **Item 5** | Hardcoded "three domains" count in new pattern doc violates anti-staleness SKILL.md rule 8 | NIT | `rpc-readback-vm-patch.md`: replaced with date-stamped snapshot (2026-04-24) + grep recipe. Now 4 rows (Users split SQL-RPC vs Edge-Function paths). | ✅ Fixed |
| **Item 6** | `UserFormViewModel.submit` return union's `UserVoidResult` arm claimed phantom by reviewer | NIT | **Reviewer factually incorrect** — arm IS reachable via `result = roleResult` on `modifyRoles` failure (line 969). Kept union + added clarifying comment with line-969 citation (architect Q8 SHOULD-ADD makes rebuttal durable). | ✅ Kept-with-comment |
| **Q4** | Frontend fallback-detection ambiguity — misclassifying v11 error envelopes as "old Edge Function, refetch"? | MUST-FIX | Existing `!data?.success` short-circuit in `SupabaseUserCommandService.ts:1223` already handles v11 error envelope correctly — never reaches VM `if (result.notificationPreferences)` branch. Added belt-and-suspenders VM contract-violation log for hypothetical `success===true && !notificationPreferences` regression (tagged `contractViolation: true`) with refetch fallback. | ✅ Fixed |
| **Q7** | Doc obligations — anti-staleness SKILL.md rules 1, 3, 12, 13 | MUST-FIX | ADR `last_updated: 2026-04-24` + Rollout history entry for `manage-user` v11 as **first Edge Function Pattern A v2 adopter**; AGENT-INDEX `last_updated` bumped (user_org_access audit returned clean); `rpc-readback-vm-patch.md` pattern doc updated (date-stamp + grep recipe + 4-row table); `dev/active/api-rpc-readback-pattern-tasks.md` PR-32 section updated; Edge Function docs reference file updated (2 stale `UserOperationResult` refs → `UserVoidResult` / `UpdateNotificationPreferencesResult`). | ✅ Fixed |
| **Q1** | Cite `adr-rpc-readback-pattern.md:93` in Edge Function comment (Edge Functions as orchestration tier extension) | SHOULD-ADD | Inline comment block above read-back cites handler file path + ADR ref + column list. | ✅ Fixed |
| **Q3** | Paired drift-guard comment on handler SQL reference file | SHOULD-ADD | Added to `infrastructure/supabase/handlers/user/handle_user_notification_preferences_updated.sql` — cites Edge Function file + v11 version marker + authoritative column list. | ✅ Fixed |
| **Q5** | Additional mapper tests for `new Date(undefined)` NaN and malformed-date regression | SHOULD-ADD | Tests 5 + 6 in new mapping test suite (undefined → null, malformed → handled). | ✅ Fixed |
| **Q8** | Clarifying comment on `UserFormViewModel.submit` union with line citation | SHOULD-ADD | Added above `submit()` with explicit line-969 citation making rebuttal durable. | ✅ Fixed |
| **Q9.1** | Error-envelope contract test for Edge Function response | SHOULD-ADD | Test 7 in new mapping test suite: v11 error envelope shape → asserts error path, no `notificationPreferences`. | ✅ Fixed |
| **Q9.2** | NOT-FOUND log upgraded to tagged error for admin dashboard filtering | SHOULD-ADD | Edge Function v11 emits `console.error(..., { handlerInvariantViolated: true })` on NOT-FOUND branch. | ✅ Fixed |
| **Q9.3** | Audit `buildEventMetadata()` for `user_id` AND `organization_id` | SHOULD-ADD | **Latent bug found** — `organization_id` was missing from metadata call. Added opportunistically (pre-existed v11; now audit-compliant per `infrastructure/CLAUDE.md` Event Metadata Requirements). | ✅ Fixed (+ latent bug caught) |

**Pre-commit audit results**:
- `grep -rn 'UserOperationResult' frontend/src/ documentation/ .claude/skills/ *CLAUDE.md` → returned **empty** after Item 4 fix
- `grep -rn 'user_org_access' documentation/ | grep -i 'notification'` → returned **empty** (AGENT-INDEX keyword-table audit per Q7 clean)
- `npm run typecheck` ✓, `npm run lint` ✓, `npm run build` ✓
- `npm run test -- --run src/services/users/__tests__/` → 25/25 passing across 3 user-domain test files (envelope + contract + mapping)
- `npm run docs:check` ✓ (only pre-existing unrelated trailing-slash warning)

**PR comment posted**: https://github.com/Analytics4Change/A4C-AppSuite/pull/32#issuecomment-4309558250

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
