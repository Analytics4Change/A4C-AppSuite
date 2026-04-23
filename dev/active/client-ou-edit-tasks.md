# Client OU Placement & Edit — Tasks

## Current Status

**Phase**: Phase 0 ✅ + Phase 1 ✅ + Phase 2 ✅ → Phase 3 — OU Picker in Intake Form
**Status**: 🟢 READY TO CONTINUE
**Last Updated**: 2026-04-22
**Branch**: `feat/client-ou-placement` (local-only; commit `cd374c12` + uncommitted Phase 2 work). Run `git branch --show-current` to verify before continuing. Do NOT switch to `main`; it tracks `origin/main` and shouldn't carry this work.

**Next Step (concrete)** — Phase 3, OU picker at intake:
1. Open `frontend/src/viewModels/client/ClientIntakeFormViewModel.ts`.
   - Add an observable `units: OrganizationUnit[]` (empty array default) + loading flag.
   - On construction / init, load `units` via `ouService.getUnits({ status: 'active' })` (inject via factory — follow existing service-injection pattern; see `RoleFormViewModel` for reference). Expose `rootPath` from JWT scope claim for tree building.
   - Add a computed `ouTree = buildOrganizationUnitTree(this.units, this.rootPath)` for the dropdown.
   - Add a computed `selectedOUPath` using `getOUPathById(this.units, this.formData.organization_unit_id as string | null)`.
   - In `submit()` (~lines 505-631): AFTER `registerClient()` succeeds, if BOTH `formData.placement_arrangement` AND `formData.organization_unit_id` are set, call `changeClientPlacement({ placement_arrangement, start_date: admission_date, organization_unit_id, correlation_id })`.
2. Open `frontend/src/pages/clients/intake/AdmissionSection.tsx`. Add `<TreeSelectDropdown>` for OU selection:
   - `id="admission-ou-select"`, `data-testid="admission-ou-select"`
   - `nodes={vm.ouTree}`, `selectedPath={vm.selectedOUPath}`
   - `onSelect={(path) => vm.setField('organization_unit_id', getOUIdByPath(vm.units, path))}`
   - Place it after the existing placement_arrangement field; gate visibility / render behavior on `vm.units.length > 0`.
3. Confirm the intake form's OU field is OPTIONAL (matches migration — `organization_unit_id uuid DEFAULT NULL`). Permissions: intake gated on `client.create`; no additional `client.transfer` gate at intake.

**Verification**: `cd frontend && npm run typecheck && npm run lint && npm run test -- --run src/viewModels/client src/pages/clients/intake` and manual smoke test the intake flow in dev mode (mock auth).

**Files already touched (do not re-edit)**: The AsyncAPI contract, generated types, handler reference files, migration, Phase 2 types/services/utility are all in sync.

**Phase 2 artifacts** (completed 2026-04-22, uncommitted):
- `frontend/src/types/client.types.ts` — `ClientPlacementHistory.organization_unit_id` + `organization_unit_name?` added; `ChangePlacementParams.organization_unit_id?` added; `ClientRpcResult.client` widened to `Partial<Client>` with doc comment on sub-entity caveat.
- `frontend/src/services/clients/SupabaseClientService.ts` — `changeClientPlacement()` passes `p_organization_unit_id`; `updateClient()` opts-in to `response.client` with `getClient()` fallback.
- `frontend/src/services/clients/MockClientService.ts` — `changeClientPlacement()` writes `organization_unit_id` to synthesized placement row and denormalizes to the client.
- `frontend/src/utils/organizationUnitPath.ts` + `frontend/src/utils/__tests__/organizationUnitPath.test.ts` — `getOUPathById` / `getOUIdByPath` helpers with 11 passing unit tests covering id↔path round-trip, null/empty/prefix edge cases.
- Verification: typecheck ✓, lint ✓, targeted tests ✓ (67 passed in `src/utils` + `src/viewModels/client`). Pre-existing test failures in organization VMs / `SupabaseClientFieldService` / logger are unrelated and exist on main (confirmed via stash-and-rerun).

**End-of-feature reminder**: Phase 9 (activate parked `api-rpc-readback-pattern` follow-up) is part of this feature's definition of done. Do NOT archive this feature without executing Phase 9.

---

## Architect Review Integration (2026-04-22)

All work is pending. Integrating architect recommendations:
- **Critical (C1-C4)**: False "done" claims reset; AsyncAPI-first; single-path OU; row lock in handler
- **Major (M1-M8)**: `client.transfer` permission; null normalization; loadClient+processing_error; save ordering; explicit `jsonb_build_object`; handler ref file sequencing; RLS documentation; `placement_arrangement` fallback
- **Minor (m1-m7)**: OU id↔path utility; `data-testid`; focus management; naming; Logger; `hasPermission` signature verify; tasks verification section
- **Missing (G1-G9)**: Test plan; verification queries; RLS decision; rollback plan; router verification; backfill; doc updates; PR split; idempotency audit

### M3 Disposition (API read-back pattern)
- **Narrow scope (this PR)**: Phase 1g-pre adds read-back + processing_error check to `api.update_client` as proof-of-pattern
- **Broad scope (follow-up)**: Parked at `dev/parked/api-rpc-readback-pattern/` with full context/plan/tasks
- **Slip prevention**: Phase 9 of this feature activates the parked feature immediately after PR 1 merges. `client-ou-edit` is not complete without Phase 9 executed.

---

## Phase 0: AsyncAPI Contract Update ✅ COMPLETE (2026-04-22)

- [x] 0a: Edited `infrastructure/supabase/contracts/asyncapi/domains/client.yaml:1146` — added `organization_unit_id` property (type: string, format: uuid, nullable: true, description) to `ClientPlacementChangeData` schema
- [x] 0b: `cd infrastructure/supabase/contracts && npm run generate:types` — produced 38 enums + 281 interfaces; `ClientPlacementChangeData` now includes `'organization_unit_id'?: string`
- [x] 0c: Verified `asyncapi-bundled.yaml` regenerated with new field (line 16642 under `ClientPlacementChangeData`)
- [x] 0d: **Note: plan assumption was WRONG** — `frontend/src/types/generated/` DOES exist. Ran `cd frontend && npm run sync-schemas` to mirror the regenerated types. Frontend `generated-events.ts` now exposes `organization_unit_id?: string` on `ClientPlacementChangeData`. Hand-written `ClientPlacementHistory` type in `client.types.ts` is still the consumer for projection rows (separate schema — addressed in Phase 2).

## Phase 1: Database Migration ✅ COMPLETE (2026-04-22 — applied to linked project)

**Migration file**: `infrastructure/supabase/supabase/migrations/20260422052825_client_ou_placement_and_edit_support.sql` (applied; reference files synced)

### Setup
- [x] Created migration file: `supabase migration new client_ou_placement_and_edit_support` → `20260422052825_client_ou_placement_and_edit_support.sql`
- [x] Added migration header comment explaining all architectural decisions (C3, C4, M1, M5, M7, M8, G6, G2, 1g-pre)

### 1a: ALTER TABLE + Index ✅
- [x] `ALTER TABLE ... ADD COLUMN IF NOT EXISTS organization_unit_id uuid` + FK (via DO block idempotent guard)
- [x] `CREATE INDEX IF NOT EXISTS idx_client_placement_history_ou ... WHERE is_current = true`
- [x] Column COMMENT documenting single-source-of-truth

### 1b: Backfill (G6) ✅
- [x] UPDATE guarded by `ph.organization_unit_id IS NULL` — idempotent

### 1c: CREATE OR REPLACE `api.change_client_placement()` (C3 + M8) ✅
- [x] `DROP FUNCTION IF EXISTS` old 7-arg signature FIRST (Postgres treats added DEFAULT param as new overload otherwise)
- [x] Added `p_organization_unit_id uuid DEFAULT NULL` param
- [x] Included `organization_unit_id` in `event_data`
- [x] OU validation: must belong to caller's org (SELECT on organization_units_projection)
- [x] Returns `organization_unit_id` + `organization_unit_name` in RPC response
- [x] Preserves `p_event_metadata` + correlation_id propagation
- [x] `GRANT EXECUTE` re-granted on the new 8-arg signature

### 1d: CREATE OR REPLACE `handle_client_placement_changed()` (C4 + OU extraction) ✅
- [x] Extracts `organization_unit_id` via `NULLIF(... , '')::uuid` (nullable-safe)
- [x] **FOR UPDATE lock** on existing `is_current=true` row before close-then-insert
- [x] Closes previous placement conditionally (only if one existed)
- [x] INSERT new row includes `organization_unit_id`; `ON CONFLICT ... DO UPDATE` also sets it
- [x] Denormalizes `organization_unit_id` + `placement_arrangement` to `clients_projection`

### 1e: CREATE OR REPLACE `api.get_client()` (M5 — explicit enumeration) ✅
- [x] Placement history aggregation uses explicit `jsonb_build_object(...)` — 13 fields enumerated
- [x] `LEFT JOIN organization_units_projection ou ON ou.id = ph.organization_unit_id`
- [x] `organization_unit_name` = `COALESCE(ou.display_name, ou.name)` (display_name is nullable)
- [x] ORDER BY ph.start_date DESC preserved
- [x] COALESCE to '[]'::jsonb preserved

### 1f: CREATE OR REPLACE `handle_client_information_updated()` — remove OU CASE (C3) ✅
- [x] Removed `organization_unit_id = CASE ...` line from UPDATE
- [x] Added inline comment at Admission section: "C3: organization_unit_id intentionally omitted"
- [x] Function-level COMMENT documents the decision

### 1g: CREATE OR REPLACE `handle_client_admitted()` — remove OU CASE (C3) ✅
- [x] Removed `organization_unit_id = CASE ...` line from UPDATE
- [x] Inline comment + function-level COMMENT document the decision
- [x] `handle_client_registered` unchanged (initial create path is NOT a mutation per C3)

### 1g-pre: Add read-back to `api.update_client` (proof-of-pattern, seeds parked follow-up) ✅ (partial — frontend update deferred to Phase 2)
- [x] CREATE OR REPLACE `api.update_client()` with:
  - [x] Event emission preserved
  - [x] Read back: `SELECT * INTO v_row FROM clients_projection WHERE id = p_client_id`
  - [x] `IF NOT FOUND` → return error with `processing_error` from latest event
  - [x] Return shape adds `client: row_to_json(v_row)::jsonb` (backward-compat: existing `success`/`client_id` preserved)
- [x] Existing param signature preserved
- [x] Error codes P9003/P9004 documented in migration header comment (actual ERRCODE uses not enforced here — existing pattern returns jsonb error instead of RAISE; ERRCODE docs retained for parked follow-up consolidation)
- [ ] Frontend `SupabaseClientService.updateClient()` opt-in to `response.client` — **Phase 2 task**

### 1h: Seed `client.transfer` permission (M1) ✅
- [x] `permission.defined` event (applet=client, action=transfer) — uses existing seed pattern
- [x] `role_permission_templates` row added for `provider_admin` (not clinician)
- [x] `permission_implications`: client.transfer → client.view; client.transfer → client.update
- [x] Backfill: existing active `provider_admin` roles get `client.transfer` via `role_permissions_projection` INSERT

### 1i: Verification queries (G2) — as trailing comment in migration ✅
- [x] Commented SELECTs for: column existence, FK existence, RPC signature, permission seed, template, backfill count, handler OU-removal assertions, get_client sample

### 1j: RLS documentation (M7) ✅
- [x] Migration header block 4th bullet: "RLS UNCHANGED — org-level filter continues to suffice"

### Post-apply steps ✅
- [x] `supabase db push --linked --dry-run` — 2026-04-22: OK
- [x] `supabase db push --linked` — applied to linked project 2026-04-22 (user confirmed)
- [x] Verification queries run via MCP execute_sql — all 10 assertions pass:
  - `column:organization_unit_id:uuid` ✓
  - `fk:client_placement_history_projection_organization_unit_id_fkey` ✓
  - `idx:idx_client_placement_history_ou` ✓
  - `rpc_args:` includes `p_organization_unit_id uuid DEFAULT NULL` ✓
  - `perm:client.transfer` ✓
  - `template:provider_admin` ✓
  - `info_updated_mutates_ou:false` ✓ (OU CASE branch removed)
  - `admitted_mutates_ou:false` ✓ (OU CASE branch removed)
  - `placement_handler_has_for_update:true` ✓
  - `backfill_is_current_with_ou:0` (expected — this dev DB has 0 clients/0 placements)
- [x] Handler reference files updated from live DB via `pg_get_functiondef` (M6 / Rule 7b):
  - [x] `infrastructure/supabase/handlers/client/handle_client_placement_changed.sql` — now includes OU extraction + FOR UPDATE lock + denormalization
  - [x] `infrastructure/supabase/handlers/client/handle_client_information_updated.sql` — OU CASE branch removed
  - [x] `infrastructure/supabase/handlers/client/handle_client_admitted.sql` — OU CASE branch removed
- [x] Router `handlers/routers/process_client_event.sql` verified unchanged — `WHEN 'client.placement.changed' THEN PERFORM handle_client_placement_changed(p_event);` already in place, ELSE raises EXCEPTION. No router update needed.

## Phase 2: Frontend Types & Service Updates ✅ COMPLETE (2026-04-22)

- [x] Add `organization_unit_id?: string | null` to `ChangePlacementParams` at `client.types.ts:631`
- [x] Add `organization_unit_id: string | null` to `ClientPlacementHistory` at `client.types.ts:343`
- [x] Add `organization_unit_name?: string | null` to `ClientPlacementHistory` (display join field)
- [x] Update `SupabaseClientService.changeClientPlacement()` at line 394 — pass `p_organization_unit_id`
- [x] Update `MockClientService.changeClientPlacement()` at line 723 — add `organization_unit_id` to mock placement AND denormalize to `clients_projection` row (mirrors `handle_client_placement_changed`)
- [x] **1g-pre consumer**: Update `SupabaseClientService.updateClient()` to opportunistically use `response.client` (now returned by the enriched `api.update_client`). Keep the `getClient()` refresh as fallback for providers that don't return `client` (Mock, older API deployments). **Also**: widened `ClientRpcResult.client` from the 4-field subset to `Partial<Client>` with an inline doc comment clarifying that sub-entity arrays (phones/emails/placement_history) are NOT populated by a projection read-back — full aggregate still requires `getClient()`.
- [x] NEW: `frontend/src/utils/organizationUnitPath.ts`
  - [x] `getOUPathById(units: readonly OrganizationUnit[], id: string | null | undefined): string | null`
  - [x] `getOUIdByPath(units: readonly OrganizationUnit[], path: string | null | undefined): string | null`
  - [x] Unit tests for both helpers — 11 passing tests (round-trip, null/undefined/empty, missing id/path, prefix non-match, empty units list)
- [x] Verification: `cd frontend && npm run typecheck` ✓, `npm run lint` ✓, `npm run test -- --run src/utils src/viewModels/client` ✓ (67 passed). Pre-existing failures in `SupabaseClientFieldService`, organization VMs, scripts logger, etc. are unrelated (confirmed by stash-and-rerun).

## Phase 3: OU Picker in Intake Form ⏸️ PENDING

- [ ] Add OU state to `ClientIntakeFormViewModel`: load `units` via `getUnits({status: 'active'})` on mount
- [ ] Add `TreeSelectDropdown` to `AdmissionSection.tsx` with `data-testid="admission-ou-select"`
- [ ] Use `buildOrganizationUnitTree(units, rootPath)` for nodes prop
- [ ] Map `vm.formData.organization_unit_id` → path via `getOUPathById`
- [ ] `onSelect` callback: map path → id via `getOUIdByPath`, call `vm.setField('organization_unit_id', id)`
- [ ] In `ClientIntakeFormViewModel.submit()` (line 505-631): after `registerClient()`, if both `placement_arrangement` AND `organization_unit_id` set → call `changeClientPlacement()` with OU
- [ ] Handle deactivated OU case: show "(inactive)" suffix in display

## Phase 4: Client Edit ViewModel ⏸️ PENDING

### File: `frontend/src/viewModels/client/ClientEditViewModel.ts`

- [ ] State:
  - [ ] `client: Client | null`
  - [ ] `originalFormData: Record<string, unknown>`
  - [ ] `formData: Record<string, unknown>`
  - [ ] `fieldDefinitions: ClientFieldDefinition[]`
  - [ ] Sub-entity arrays (phones, emails, addresses, insurance, funding, contacts)
  - [ ] `pendingSubEntityChanges: SubEntityChange[]`
  - [ ] `editingSection: string | null`
  - [ ] `savingSection: string | null`
  - [ ] `saveErrors: Record<string, string>`
- [ ] Computed:
  - [ ] `sectionDirty(section: string): boolean`
  - [ ] `visibleFieldKeys(section: string): string[]`
  - [ ] `requiredFieldKeys(section: string): string[]`
  - [ ] `validationErrors(section: string): Record<string, string>`
- [ ] Actions:
  - [ ] `loadClient(clientId: string)` — fetches, sets both `originalFormData` and `formData`
  - [ ] `setField(key, value)` — **null-normalizes** empty string → null
  - [ ] `saveSection(section)` — builds diff, handles Admission ordering, calls appropriate RPC
  - [ ] `cancelSection(section)` — reverts formData[section fields] to original
  - [ ] `changePlacement(params)` — wraps `change_client_placement` RPC with arrangement fallback (M8)
- [ ] **Null normalization** (M2): `setField` and diff compute both treat `''` as `null`
- [ ] **Array fields atomic replace**: `race`, `allergies`, `secondary_diagnoses` always sent in full on change
- [ ] **Session-scoped correlation ID**: `crypto.randomUUID()` on construction, passed in all `p_event_metadata`
- [ ] **Post-save reload** (M3): every save calls `getClient(clientId)`, resets `originalFormData` to fresh server state
- [ ] **Processing error check** (M3): query `domain_events` by `last_event_id` for `processing_error`, surface in `saveErrors`
- [ ] **Admission save ordering** (M4): if placement fields AND info fields both dirty, call `changePlacement` FIRST, then `updateClient` (without OU/placement in changes)
- [ ] **Arrangement fallback** (M8): if OU changed but arrangement not, use `originalFormData.placement_arrangement` in RPC call
- [ ] Sub-entity CRUD methods: `addPhone`, `updatePhone`, `removePhone`, etc. — individual RPCs, `Promise.allSettled` for batch
- [ ] Section → field key mapping (static map)
- [ ] Use `Logger.getLogger('viewmodel')` (m5)
- [ ] Verify `hasPermission` signature sync vs async (m6); adjust guards

## Phase 5a: Client Edit UI Foundation ⏸️ PENDING (PR 2a)

### 5a-1: ClientDetailLayout changes
- [ ] Import `ClientEditViewModel`, add instance state
- [ ] Add "Edit" button in header with `data-testid="client-edit-button"`, gated on `hasPermission('client.update') && client.status !== 'discharged'`
- [ ] Toggle `isEditing` state; on activate, call `editVm.loadClient(clientId)`
- [ ] Pass `editVm` + `loadClient` callback via Outlet context alongside existing `client` data

### 5a-2: EditableSection wrapper component
**NEW**: `frontend/src/pages/clients/edit/EditableSection.tsx`
- [ ] Props: `title, icon, isEditing, isDirty, isSaving, error, onEdit, onSave, onCancel, children, sectionId`
- [ ] Render edit/save/cancel buttons with `data-testid` per button
- [ ] Loading spinner during save
- [ ] Success announcement: `aria-live="polite"` region (m3)
- [ ] Error banner: `role="alert"` focused when error set (m3)
- [ ] Focus management (m3):
  - [ ] `useRef` on first editable field container
  - [ ] `useRef` on Edit button
  - [ ] `useEffect` on `isEditing`: true → focus first field; false (was true) → focus Edit button
  - [ ] On Save success: keep focus on section, announce via aria-live
  - [ ] On Save error: focus error banner
  - [ ] NO `setTimeout` — refs + effects only

### 5a-3: ClientOverviewPage edit mode — Demographics + Admission
- [ ] Accept `ClientEditViewModel` from outlet context
- [ ] Wrap Demographics section in `EditableSection`
- [ ] Wrap Admission section in `EditableSection`
- [ ] Edit mode: swap `Field` components for `IntakeFormField` via `useFieldProps(vm, section)`
- [ ] Save: call `vm.saveSection(sectionName)`; on success, await `loadClient` to refresh page
- [ ] Cancel: call `vm.cancelSection(sectionName)`

### 5a-4: Admission section — OU + placement editing
- [ ] OU field: `TreeSelectDropdown` with `data-testid="admission-edit-ou-select"`
- [ ] Placement arrangement: enum dropdown (same source as intake)
- [ ] Save flow calls `vm.saveSection('admission')` which handles ordering internally
- [ ] Gate OU/placement sub-section on `hasPermission('client.transfer')`; demographics sub-fields on `client.update`
- [ ] Show notice when OU changes: "This will create a placement history record"
- [ ] After save: placement history auto-refreshes via `loadClient`

### 5a-5: Verify reusable component integration
- [ ] `IntakeFormField` renders correctly in edit context (same `useFieldProps`)
- [ ] Enum option arrays accessible from section components (field_definitions loaded)
- [ ] `TreeSelectDropdown` works for OU selection in edit context

## Phase 5b: Client Edit UI Extended ⏸️ PENDING (PR 2b)

### 5b-1: Remaining simple sections
- [ ] Clinical section: primary_diagnosis, secondary_diagnoses (array), medications (array), allergies (array)
- [ ] Medical section: medical_history, physician, pharmacy
- [ ] Legal section: legal_status, consents
- [ ] Education section: school, grade, IEP_status

### 5b-2: Sub-entity CRUD UI
- [ ] Phones: Add/Edit/Remove with form + list
- [ ] Emails: same pattern
- [ ] Addresses: same pattern + type dropdown (home/work/mailing)
- [ ] Insurance: Add/Edit/Remove with coverage type, policy #, group #, member ID
- [ ] Funding: Add/Edit/Remove with source, amount, period
- [ ] Contacts: Add/Edit/Remove with relationship, role, phone, email

### 5b-3: Sub-entity save flow
- [ ] Add button → in-line or modal form → on save, call `vm.addX(params)`
- [ ] Edit button → in-line form → on save, call `vm.updateX(id, params)`
- [ ] Remove button → confirm → call `vm.removeX(id)`
- [ ] All calls use individual RPCs with shared correlation_id
- [ ] `Promise.allSettled` for batch operations
- [ ] Reload client after all ops settled

## Phase 6: Placement History OU Display ⏸️ PENDING

- [ ] Update `PlacementCard` in `ClientOverviewPage.tsx` to show `organization_unit_name` when present
- [ ] Show "—" or "Not specified" for null OU
- [ ] Handle deactivated OU: display name + "(inactive)" suffix
- [ ] Verify `api.get_client()` returns `organization_unit_name` in placement_history items

## Phase 7: Testing ⏸️ PENDING (Distributed Across PRs)

### PR 1 tests
- [ ] SQL/DB tests in migration verification:
  - [ ] Emit `client.placement.changed` event with `organization_unit_id` → assert projection has OU + is_current=true
  - [ ] Simulate concurrent placement events (two inserts in separate transactions) → assert no constraint violation (lock works) or controlled failure
  - [ ] Backfill query → assert existing is_current rows have OU populated
  - [ ] Permission seed: `SELECT * FROM permissions WHERE permission='client.transfer'` returns row
- [ ] Playwright E2E: `client-intake-ou.spec.ts`
  - [ ] Enter intake, select OU, complete admission → verify placement history shows OU name
- [ ] Permission gating: user without `client.transfer` sees read-only OU picker at intake? (Decision: intake is gated on `client.create`, OU picker visible to any creator. Document decision.)

### PR 2a tests
- [ ] Vitest: `ClientEditViewModel.test.ts`
  - [ ] Dirty detection: changing field flips sectionDirty
  - [ ] Null normalization: `setField('middle_name', '')` → diff contains `{middle_name: null}`
  - [ ] Array atomic replace: changing one element sends full array
  - [ ] Correlation ID persists across saves in one session
  - [ ] Save ordering: admission with both placement and info dirty → change_client_placement called before update_client
  - [ ] Arrangement fallback: OU-only change uses original placement_arrangement
  - [ ] Error path: processing_error surfaces in saveErrors
- [ ] Playwright E2E: `client-edit-demographics.spec.ts`, `client-edit-admission.spec.ts`
  - [ ] Viewer without `client.update`: Edit button hidden
  - [ ] Admin with `client.update` but not `client.transfer`: Demographics editable, OU read-only
  - [ ] Full permissions: Demographics + Admission save flows work
  - [ ] Focus management: Edit → first field focused; Cancel → Edit button focused
  - [ ] Discharged client: Edit button hidden

### PR 2b tests
- [ ] Vitest: sub-entity CRUD methods, partial success handling
- [ ] Playwright E2E: each section save flow; sub-entity add/edit/remove flows
- [ ] Keyboard navigation: all interactive elements reachable via Tab, edit/save/cancel via Enter

## Phase 8: Documentation ⏸️ PENDING

### PR 1 slice (8a)
- [ ] Update `documentation/AGENT-INDEX.md` — extend `client-placement` keyword with OU tracking, link to new ADR
- [ ] Update `documentation/infrastructure/reference/database/tables/client_placement_history_projection.md` — add `organization_unit_id` row to column table
- [ ] Update `documentation/infrastructure/reference/database/tables/clients_projection.md` — note single-path OU mutation
- [ ] NEW ADR: `documentation/architecture/decisions/adr-client-ou-placement.md`
  - [ ] YAML frontmatter with status, last_updated
  - [ ] TL;DR section
  - [ ] Decision 1: Single-path OU mutation via change_client_placement (C3)
  - [ ] Decision 2: `client.transfer` permission (M1)
  - [ ] Decision 3: Row lock in handler (C4)
  - [ ] Decision 4: OU-only change reuses arrangement (M8)
  - [ ] Related docs links

### PR 2b slice (8b)
- [ ] Update frontend client management user-facing docs with edit-mode UX
- [ ] Add edit ViewModel pattern description to VM architecture docs
- [ ] Update AGENT-INDEX `client-edit` keyword entry

## Verification ⏸️ PENDING

### PR 1 pre-merge
- [ ] `npm run build` (frontend) — zero errors
- [ ] `npm run lint` (frontend) — zero warnings
- [ ] `npm run docs:check` (frontend) — docs compliance
- [ ] `supabase db push --linked --dry-run` — no drift
- [ ] Migration verification queries pass
- [ ] Failed events check: `SELECT COUNT(*) FROM domain_events WHERE event_type = 'client.placement.changed' AND processing_error IS NOT NULL` returns 0 after test flow
- [ ] Backfill sanity: `SELECT COUNT(*) FROM client_placement_history_projection WHERE is_current=true AND organization_unit_id IS NULL` — acceptable (some orgs may have clients without OU set)
- [ ] AGENT-INDEX.md link check passes
- [ ] Handler reference files match live DB function definitions

### PR 2a pre-merge
- [ ] `npm run build` / `npm run lint` / `npm run test` — all pass
- [ ] Vitest coverage on `ClientEditViewModel` > 80%
- [ ] Playwright E2E specs pass
- [ ] Manual: keyboard navigation through Edit → section → Save → Cancel works with no mouse
- [ ] Manual: screen reader announces edit mode entry, save success/failure
- [ ] Permission gating verified in mock mode with 3 user profiles (viewer, updater, transferrer)

### PR 2b pre-merge
- [ ] All section edit flows work
- [ ] Sub-entity CRUD works (add/edit/remove for all 6 sub-entity types)
- [ ] Discharged client: edit button hidden
- [ ] `data-testid` present on all new interactive elements (audit via grep)

## Phase 9: Follow-up Handoff — Activate API RPC Read-back Pattern ⏸️ PENDING

**Trigger**: Immediately after `client-ou-edit` PR 1 merges.

This is a required phase, not a loose TODO. `client-ou-edit` is not complete until Phase 9 is executed.

### 9a: Activate parked feature
- [ ] Verify `client-ou-edit` PR 1 has merged to main
- [ ] `git mv dev/parked/api-rpc-readback-pattern/ dev/active/api-rpc-readback-pattern/`
- [ ] Edit `dev/active/api-rpc-readback-pattern/api-rpc-readback-pattern-tasks.md` — change "Current Status" from PARKED to ACTIVE; update "Last Updated" date; replace "Next Step (on activation)" with concrete Phase 0 next action
- [ ] Edit `dev/active/api-rpc-readback-pattern/api-rpc-readback-pattern-context.md` — update status from PARKED to ACTIVE; add activation date
- [ ] Commit the move + status updates: `git commit -m "chore(dev): activate api-rpc-readback-pattern follow-up from client-ou-edit"`

### 9b: Kick off Phase 0 of the activated feature
- [ ] Run the `pg_proc` inventory query (from parked plan Phase 0)
- [ ] Populate the Phase 0 tracking table in `api-rpc-readback-pattern-plan.md`
- [ ] Create branch for that feature's PR 1

### 9c: Cross-link on `client-ou-edit` archival
- [ ] When `client-ou-edit` moves from `dev/active/` to `dev/archived/` after PR 2b merge, add a note to its final archive README that the `api-rpc-readback-pattern` follow-up was activated as Phase 9
- [ ] If Phase 9 activation is skipped or deferred, `client-ou-edit` stays in `dev/active/` — do NOT archive it without Phase 9 complete

### Durable safeguards against slip
- `dev/parked/api-rpc-readback-pattern/` exists as a physical directory — visible in `ls dev/parked/` team triage
- Phase 9 is a checklist item in this feature's definition-of-done
- The `api.update_client` read-back (Phase 1g-pre) is the only instance in this PR; the rest of the codebase still has silent-failure surface area until the parked feature ships
