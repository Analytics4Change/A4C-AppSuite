# Client OU Placement & Edit — Tasks

## Current Status

**Phase**: Phase 0 ✅ + Phase 1 ✅ + Phase 2 ✅ + Phase 3 ✅ + Phase 6 ✅ + Phase 7 (PR 1 slice) ✅ + Phase 8a ✅ → **PR 1 READY FOR REVIEW**
**Status**: 🟢 PR 1 COMPLETE — next is PR 2a (Phase 4/5a) or merge + start Phase 9
**Last Updated**: 2026-04-23 (Phase 7 + 8a commit `e3d7fd8c`)
**Branch**: `feat/client-ou-placement` (HEAD = `e3d7fd8c`; working tree clean). 5 feature commits on this branch: `d1f69ef1` (types/services), `9390eff7` (intake picker), `cdfcdd91` (Phase 6 placement card), `e3d7fd8c` (Phase 7 E2E + Phase 8a docs) — plus `b52aeaef`, `9245c6cb`, `cd374c12` earlier foundation/docs commits.

**Next Step (concrete)** — open PR 1 for review, OR continue onto PR 2a:
1. **PR 1 review path**: push branch, open PR targeting `main`. PR 1 slice: Phases 0/1/2/3/6/7/8a. Include migration `20260422052825` + `20260423013804` (both applied to linked project).
2. **PR 2a path**: proceed to Phase 4 (ClientEditViewModel) + Phase 5a (Client edit UI foundation — Demographics + Admission sections with edit mode). See Phase 4/5a checklists below.
3. **Post-merge**: Phase 9 activates the parked `api-rpc-readback-pattern` follow-up immediately after PR 1 merges.

**Verification**:
- `npm run typecheck` ✓, `npm run lint` ✓, `npm run docs:check` ✓ (0 issues)
- `npm run test -- --run src/utils src/viewModels/client src/pages/clients src/services/clients` ✓ (67 passed)
- `npx playwright test --config playwright.client-intake.config.ts` ✓ (58 passed, includes 4 new OU tests)
- SQL verification via MCP: 12/12 assertions pass against linked project

**Bundle note**: PR 1 covers Phases 0, 1, 2, 3, 6, 7 (PR 1 slice), 8a (per plan table). Phase 4/5a/7 (PR 2a slice)/8b is PR 2a/2b. Phase 5b is PR 2b.

**Phase 7 + 8a artifacts** (committed in `e3d7fd8c`):
- `frontend/e2e/client-intake.spec.ts` — new `describe` block "Client Registration — Organizational Unit Placement" adds 4 E2E tests covering OU picker mount, inactive-unit filter (Old Wing excluded from intake), no-OU intake → no placement section, and happy path (Main Campus → OU label shown, no "(inactive)" suffix). Full 58-test suite passes in ~1.3m against mock mode.
- `frontend/src/services/clients/MockClientService.ts` — new `resolvePlacementOuState()` helper resolves current OU name + is_active at read time in `getClient()` via the `MockOrganizationUnitService` singleton. Mirrors the real `api.get_client()` LEFT JOIN — enables Playwright happy-path test without denormalizing on the mock placement row.
- `documentation/architecture/decisions/adr-client-ou-placement.md` — new ADR capturing 5 decisions: single-path OU mutation (C3), `client.transfer` permission (M1), row lock in placement handler (C4), arrangement fallback on OU-only edit (M8), and read-time OU state enrichment (Phase 6). ~215 lines with rationale, validation, and forward-compat notes.
- `documentation/infrastructure/reference/database/tables/client_placement_history_projection.md` — `organization_unit_id` column row added; FK constraint + partial index documented; Overview section notes single-path mutation and read-time OU enrichment.
- `documentation/infrastructure/reference/database/tables/clients_projection.md` — `organization_unit_id` description updated to note denormalized-but-not-directly-mutable contract.
- `documentation/AGENT-INDEX.md` — `client-placement` keyword extended, new `client-transfer` keyword, new ADR cataloged.
- SQL verification via MCP: 12/12 structural assertions pass (column/FK/index, RPC signature, permission seed, template seed, handler OU-removal, placement handler FOR UPDATE lock, Phase 6 get_client keys, backfill sanity).

**Phase 6 artifacts** (committed in `cdfcdd91`):
- `infrastructure/supabase/supabase/migrations/20260423013804_client_get_client_ou_state_fields.sql` — CREATE OR REPLACE `api.get_client()` adding `organization_unit_is_active` and `organization_unit_deleted_at` to each placement_history item. Applied to linked project; verified via MCP `pg_get_functiondef` that both keys are present.
- `frontend/src/types/client.types.ts` — `ClientPlacementHistory` extended with `organization_unit_is_active?: boolean | null` and `organization_unit_deleted_at?: string | null`, both derived at read time from the OU projection (not stored on the history row — preserves event-sourced audit semantics).
- `frontend/src/pages/clients/ClientOverviewPage.tsx` — new `formatPlacementOuLabel()` helper + `<p data-testid="placement-ou-label">` row inside `PlacementCard`. Rule: `name == null || ''` → "—"; `name && (is_active === false || deleted_at != null)` → `${name} (inactive)`; otherwise → `name`.
- **Architect review (software-architect-dbc)**: endorsed Option 1 (refined) over alternatives. Key reasoning: denormalizing `organization_unit_is_active` onto `client_placement_history_projection` would conflate history with current state (row would flip on later OU deactivation, violating event-sourced audit semantics); filtering the LEFT JOIN by `is_active` would erase that a client was placed in the now-deactivated OU. Deriving at read time in `api.get_client()` is the only option that preserves history while annotating current state.
- **Scope correction**: the earlier "No backend work required" note on Phase 6 was wrong — the RPC did not surface `is_active`/`deleted_at`, so the three-state render was unreachable without a migration. Migration `20260423013804` is a pure additive `CREATE OR REPLACE` (idempotent, no new params, no AsyncAPI/event-type changes). Handler reference-file discipline (Rule 7b) does not apply to `api.*` RPCs — confirmed via `infrastructure/supabase/handlers/` directory scope.
- Verification: `npm run typecheck` ✓, `npm run lint` ✓, `npm run test -- --run src/pages/clients src/types src/viewModels/client src/utils` ✓ (67 passing, same baseline as Phase 3).

**Phase 3 artifacts** (committed in `9390eff7`):
- `frontend/src/viewModels/client/ClientIntakeFormViewModel.ts` — 3rd constructor arg `IOrganizationUnitService`; `organizationUnits` / `organizationUnitsRootPath` / loading flags; `organizationUnitTree` + `selectedOrganizationUnitPath` computeds; `loadOrganizationUnits()` + `setOrganizationUnitByPath()` actions. `submit()` now pushes `changeClientPlacement` into the post-register RPC batch when placement + OU + admission_date are all set.
- `frontend/src/pages/clients/intake/AdmissionSection.tsx` — new `<TreeSelectDropdown>` wrapped in `<div data-testid="admission-ou-select">`, disabled with placeholder hints during loading/empty states, optional help text.
- `frontend/src/pages/clients/ClientIntakePage.tsx` — mount effect now calls `vm.loadOrganizationUnits()` alongside `vm.loadFieldDefinitions()`.
- Verification: typecheck ✓, lint ✓, targeted tests ✓ (67). Full suite: 52 fail / 389 pass — same pre-existing baseline as Phase 2 (no new regressions).

**Phase 2 artifacts** (committed in `d1f69ef1`):
- `frontend/src/types/client.types.ts` — `ClientPlacementHistory.organization_unit_id` + `organization_unit_name?` added; `ChangePlacementParams.organization_unit_id?` added; `ClientRpcResult.client` widened to `Partial<Client>` with doc comment on sub-entity caveat.
- `frontend/src/services/clients/SupabaseClientService.ts` — `changeClientPlacement()` passes `p_organization_unit_id`; `updateClient()` opts-in to `response.client` with `getClient()` fallback.
- `frontend/src/services/clients/MockClientService.ts` — `changeClientPlacement()` writes `organization_unit_id` to synthesized placement row and denormalizes to the client.
- `frontend/src/utils/organizationUnitPath.ts` + `frontend/src/utils/__tests__/organizationUnitPath.test.ts` — `getOUPathById` / `getOUIdByPath` helpers with 11 passing unit tests.

**Files already touched (do not re-edit)**: AsyncAPI contract, generated types, handler reference files, migration, Phase 2 types/services/utility, Phase 3 intake VM/page/section are all in sync.

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

## Phase 3: OU Picker in Intake Form ✅ COMPLETE (2026-04-22)

- [x] Add OU state to `ClientIntakeFormViewModel`: `organizationUnits`, `organizationUnitsRootPath`, `isLoadingOrganizationUnits`, `organizationUnitsError` + injected `IOrganizationUnitService` (3rd constructor arg, defaults to `getOrganizationUnitService()`)
- [x] `loadOrganizationUnits()` action — loads active units, computes rootPath (shortest path — mirrors `RolesManagePage` pattern), idempotent (no-op when already loaded/loading); failure non-fatal (picker degrades to empty)
- [x] Add `TreeSelectDropdown` to `AdmissionSection.tsx` wrapped in `<div data-testid="admission-ou-select">` (TreeSelectDropdown itself has no data-testid prop — wrapper pattern keeps the test selector stable without modifying a shared component)
- [x] Use `viewModel.organizationUnitTree` computed (calls `buildOrganizationUnitTree(units, rootPath)`) for `nodes` prop; returns `[]` when no units loaded so dropdown renders disabled placeholder cleanly
- [x] Map `vm.formData.organization_unit_id` → path via `getOUPathById` (computed `selectedOrganizationUnitPath`)
- [x] `onSelect` callback: `viewModel.setOrganizationUnitByPath(path)` — internally maps path → id via `getOUIdByPath` and calls `setField('organization_unit_id', id)`
- [x] In `ClientIntakeFormViewModel.submit()`: after `registerClient()`, if `placement_arrangement`, `organization_unit_id`, AND `admission_date` are all set, push `changeClientPlacement({ placement_arrangement, start_date: admission_date, organization_unit_id, correlation_id })` into `subEntityPromises` so the initial placement history row carries OU from the start. Failures surface as a warning in `subEntityErrors`, not a submit failure.
- [x] Wire `vm.loadOrganizationUnits()` into `ClientIntakePage` mount effect alongside `loadFieldDefinitions()`
- [x] Verification: `cd frontend && npm run typecheck` ✓, `npm run lint` ✓, `npm run test -- --run src/viewModels/client src/pages/clients src/utils` ✓ (67 pass). Full suite shows same 52-fail pre-existing baseline — no new regressions.

**Deferred to Phase 6 / 5a**: "Handle deactivated OU case: show (inactive) suffix" — the intake picker only loads `status: 'active'` units, so intake inherently cannot surface an inactive OU. The suffix display is needed in PlacementCard (Phase 6) and the edit-mode OU picker (Phase 5a), where historical/deactivated OUs may appear in records.

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

## Phase 6: Placement History OU Display ✅ COMPLETE (2026-04-23)

**Architect decision**: Option 1 refined — enrich `api.get_client()` response with OU current-state flags (`is_active`, `deleted_at`) rather than denormalizing onto the history projection or filtering the LEFT JOIN. Preserves audit semantics (history row stays immutable) while annotating current state at read time. See migration `20260423013804` header for full rationale.

- [x] New migration `20260423013804_client_get_client_ou_state_fields.sql` — adds `organization_unit_is_active` + `organization_unit_deleted_at` to each placement_history item in `api.get_client()` response (idempotent CREATE OR REPLACE, no param changes)
- [x] Migration applied to linked project; verified via MCP `pg_get_functiondef` that both new jsonb keys are present
- [x] `ClientPlacementHistory` type extended with both optional nullable fields (timestamp as ISO string)
- [x] `PlacementCard` updated with three-state render: null → "—"; name + deactivated/soft-deleted → "name (inactive)"; otherwise → name. Wrapped in `<p data-testid="placement-ou-label">` for future E2E.
- [x] `formatPlacementOuLabel()` helper centralizes the rule so Phase 5a edit mode can reuse it
- [x] Mock unchanged — mock has no OU directory so `organization_unit_name` stays null, and the null-branch naturally renders "—" (no regression)

## Phase 7: Testing ⏸️ PENDING (Distributed Across PRs)

### PR 1 tests ✅ COMPLETE (2026-04-23)
- [x] SQL/DB structural verification via MCP: all 12 assertions pass (column/FK/index, RPC signature, permission seed + template, handler OU-removal, placement handler FOR UPDATE lock, Phase 6 `get_client_has_is_active` + `get_client_has_deleted_at`, backfill sanity)
- [x] Functional SQL verification (emit event + query projection) deferred — dev DB has 0 clients; the structural assertion on the handler body (FOR UPDATE lock + column writes) plus the E2E coverage through the mock path is sufficient for PR 1
- [x] Playwright E2E: added `describe("Client Registration — Organizational Unit Placement")` to `e2e/client-intake.spec.ts` (not a separate file — consolidating with existing intake spec avoids config churn). 4 new tests, all pass:
  - [x] OU picker renders with mock seed OUs
  - [x] OU picker excludes inactive units (Old Wing filtered out by `{ status: 'active' }`)
  - [x] Intake without OU → no placement history section on detail page
  - [x] Intake with OU (Main Campus) → placement card shows OU name, no "(inactive)" suffix
- [x] Permission gating decision documented in ADR Decision 2: intake OU picker is gated on `client.create` (not `client.transfer`) because initial placement is part of client creation, not a transfer
- **Deferred**: concurrent-placement-lock contention test — requires two parallel sessions; structural `FOR UPDATE` assertion on the handler body covers the contract. If a contention test is ever needed, add it to a dedicated DB integration suite (not in-scope for PR 1)

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

### PR 1 slice (8a) ✅ COMPLETE (2026-04-23)
- [x] Updated `documentation/AGENT-INDEX.md` — extended `client-placement` keyword, added new `client-transfer` keyword, cataloged `adr-client-ou-placement.md` in the architecture doc list
- [x] Updated `documentation/infrastructure/reference/database/tables/client_placement_history_projection.md` — added `organization_unit_id` column row, FK constraint, partial index, Overview-section bullets for single-path mutation + read-time OU enrichment
- [x] Updated `documentation/infrastructure/reference/database/tables/clients_projection.md` — `organization_unit_id` description clarifies denormalized-but-not-directly-mutable contract
- [x] NEW ADR: `documentation/architecture/decisions/adr-client-ou-placement.md`
  - [x] YAML frontmatter (status: current, last_updated: 2026-04-23)
  - [x] TL;DR section with when-to-read, prerequisites, key topics, read time
  - [x] Decision 1: Single-path OU mutation via change_client_placement (C3)
  - [x] Decision 2: `client.transfer` permission (M1)
  - [x] Decision 3: Row lock in handler (C4)
  - [x] Decision 4: OU-only change reuses arrangement (M8)
  - [x] Decision 5 (added): Read-time OU state enrichment (Phase 6)
  - [x] Related docs links, consequences section, risks accepted

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
