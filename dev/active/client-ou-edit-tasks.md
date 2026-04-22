# Client OU Placement & Edit — Tasks

## Current Status

**Phase**: Phase 2 — Frontend Types & Service Updates
**Status**: ✅ IN PROGRESS
**Last Updated**: 2026-04-22
**Next Step**: Edit `frontend/src/types/client.types.ts` — add `organization_unit_id` and `organization_unit_name` to `ClientPlacementHistory` (line 343) and `organization_unit_id` to `ChangePlacementParams` (line 631). Then update SupabaseClientService and MockClientService.

---

## Phase 1: Database Migration ✅ COMPLETE

- [x] Create migration file via `supabase migration new client_ou_placement_and_edit_support`
  - File: `20260422021549_client_ou_placement_and_edit_support.sql`
- [x] 1a: ALTER TABLE `client_placement_history_projection` ADD COLUMN `organization_unit_id` uuid + index
- [x] 1b: CREATE OR REPLACE `api.change_client_placement()` — add `p_organization_unit_id uuid DEFAULT NULL`, include in event_data
- [x] 1c: CREATE OR REPLACE `handle_client_placement_changed()` — extract `organization_unit_id` from event_data, include in INSERT, denormalize to `clients_projection`
- [x] 1d: CREATE OR REPLACE `api.get_client()` — LEFT JOIN placement history to `organization_units_projection` for `organization_unit_name`
- [x] Update handler reference file: `infrastructure/supabase/handlers/client/handle_client_placement_changed.sql`
- [x] Update AsyncAPI contract: `ClientPlacementChangeData` now includes `organization_unit_id`
- [x] Regenerate TypeScript types from AsyncAPI schemas

## Phase 2: Frontend Types & Service Updates ⏸️ PENDING

- [ ] Add `organization_unit_id?: string` to `ChangePlacementParams` (client.types.ts:631)
- [ ] Add `organization_unit_id: string | null` to `ClientPlacementHistory` (client.types.ts:343)
- [ ] Add `organization_unit_name?: string | null` to `ClientPlacementHistory` (for display join)
- [ ] Update `SupabaseClientService.changeClientPlacement()` — pass `p_organization_unit_id` (line 394)
- [ ] Update `MockClientService.changeClientPlacement()` — add `organization_unit_id` to mock placement (line 723)

## Phase 3: OU Picker in Intake Form ⏸️ PENDING

- [ ] Add OU picker to `AdmissionSection.tsx` using `TreeSelectDropdown`
- [ ] Load OU tree in intake form (need to determine where — VM or component level)
- [ ] Wire `organization_unit_id` to `vm.setField()`
- [ ] After `registerClient()`, call `changeClientPlacement()` with OU if both placement_arrangement and organization_unit_id are set (in `ClientIntakeFormViewModel.submit()`)

## Phase 4: Client Edit ViewModel ⏸️ PENDING

- [ ] Create `frontend/src/viewModels/client/ClientEditViewModel.ts`
  - [ ] State: client, originalFormData, formData, fieldDefinitions, sub-entity arrays, pendingSubEntityChanges, editingSection, savingSection
  - [ ] Computed: sectionDirty(section), visibleFieldKeys, requiredFieldKeys, validationErrors
  - [ ] Actions: loadClient, setField, saveSection, cancelSection, changePlacement
  - [ ] Sub-entity CRUD: add/update/remove phone, email, address, insurance, funding, contact
  - [ ] Session-scoped correlation ID (crypto.randomUUID())
  - [ ] Section → field key mapping (static map)

## Phase 5: Client Edit UI ⏸️ PENDING

### 5a: ClientDetailLayout changes
- [ ] Add "Edit" button in header (permission-gated: `client.update`, not discharged)
- [ ] Create `ClientEditViewModel` instance when edit mode activated
- [ ] Pass VM via Outlet context alongside existing `client` data
- [ ] Add `isEditing` state toggle + `loadClient` refresh callback

### 5b: ClientOverviewPage edit mode
- [ ] Accept `ClientEditViewModel` from outlet context
- [ ] Each section: Edit/Save/Cancel button group
- [ ] Edit mode: swap `Field` components for `IntakeFormField` components
- [ ] Save: call `vm.saveSection(sectionName)` → `api.update_client()` with diff only
- [ ] Cancel: revert to original values
- [ ] Sub-entity sections: Add/Edit/Remove buttons, individual RPC calls

### 5c: Admission section — OU + placement editing
- [ ] OU field: TreeSelectDropdown (same as intake)
- [ ] Placement arrangement: enum dropdown
- [ ] On save: call `api.change_client_placement()` (not update_client) to preserve history
- [ ] Show notice about placement history record creation
- [ ] After save: reload client to reflect updated placement_history

### 5d: EditableSection wrapper component
- [ ] Create `frontend/src/pages/clients/edit/EditableSection.tsx`
- [ ] Props: title, icon, isEditing, isDirty, isSaving, error, onEdit, onSave, onCancel
- [ ] Header with edit/save/cancel buttons
- [ ] Loading spinner during save
- [ ] Success/error feedback

### 5e: Verify reusable component integration
- [ ] IntakeFormField renders correctly in edit context
- [ ] Enum option arrays accessible from section components
- [ ] TreeSelectDropdown works for OU selection

## Phase 6: Placement History OU Display ⏸️ PENDING

- [ ] Update `PlacementCard` component in `ClientOverviewPage.tsx` to show OU name when present
- [ ] Verify `api.get_client()` returns `organization_unit_name` in placement_history items

## Verification ⏸️ PENDING

- [ ] `npm run build` — zero errors
- [ ] `npm run lint` — zero warnings
- [ ] Manual testing: intake OU picker, edit mode toggle, section save, placement history
- [ ] Permission gating: viewer cannot see edit button
