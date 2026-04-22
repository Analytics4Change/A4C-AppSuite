# Client OU Placement & Edit — Context

**Feature**: Client OU Placement Tracking + Full Client Record Editing
**Branch**: main (not yet branched)
**Started**: 2026-04-21

## Overview

Clients in A4C-AppSuite are scoped to an organization but not to a specific organizational unit (facility/site). The `clients_projection.organization_unit_id` column exists but is never populated. There's no UI to set it at intake, and no way to edit it post-intake since the client detail page is entirely read-only.

Additionally, `client_placement_history_projection` doesn't track which OU a placement is at, so there's no audit trail of client movements between facilities.

This work adds:
1. OU-aware placement tracking (backend migration + intake UI)
2. Full client record editing (all sections, permission-gated)

## Key Decisions

1. **Single migration for all DB changes**: One migration covers the ALTER TABLE, function updates, and handler updates. Created via `supabase migration new` — file: `20260422021549_client_ou_placement_and_edit_support.sql`.
2. **Inline edit mode, not separate route**: Edit toggle on `ClientOverviewPage` per-section, no `/edit` route. Keeps URL stable.
3. **Placement changes go through RPC, not updateClient**: Changing OU/placement calls `api.change_client_placement()` to preserve history audit trail. Regular field edits use `api.update_client()`.
4. **TreeSelectDropdown reuse**: Same OU picker component used in role management, reused for both intake and edit.
5. **Backward-compatible RPC**: `p_organization_unit_id` added as `DEFAULT NULL` param — existing callers unaffected.

## Critical File Map

### Database (Phase 1)

| File | Purpose | Key Lines |
|------|---------|-----------|
| `infrastructure/supabase/supabase/migrations/20260406222857_client_api_functions.sql` | `api.change_client_placement()` RPC | 789-810 |
| `infrastructure/supabase/supabase/migrations/20260406222642_client_sub_entity_event_handlers.sql` | `handle_client_placement_changed()` handler | 398-455 |
| `infrastructure/supabase/supabase/migrations/20260406222857_client_api_functions.sql` | `api.get_client()` with placement lateral join | 369-450 |
| `infrastructure/supabase/supabase/migrations/20260406222201_client_lifecycle_event_handlers.sql` | `handle_client_registered` stores `organization_unit_id` | line 204 |
| `infrastructure/supabase/supabase/migrations/20260327205738_clients_projection.sql` | `clients_projection` table with `organization_unit_id` column | line 15 |
| `infrastructure/supabase/supabase/migrations/20260406221738_client_insurance_placement_tables.sql` | `client_placement_history_projection` table | 80-160 |
| `infrastructure/supabase/handlers/client/handle_client_placement_changed.sql` | Reference handler file (must update after migration) |  |

### Frontend Types/Services (Phase 2)

| File | What to change |
|------|---------------|
| `frontend/src/types/client.types.ts:343-355` | Add `organization_unit_id` + `organization_unit_name` to `ClientPlacementHistory` |
| `frontend/src/types/client.types.ts:631-636` | Add `organization_unit_id` to `ChangePlacementParams` |
| `frontend/src/services/clients/SupabaseClientService.ts:390-404` | Pass `p_organization_unit_id` in RPC call |
| `frontend/src/services/clients/MockClientService.ts:710-746` | Add `organization_unit_id` to mock placement |

### Frontend Intake (Phase 3)

| File | What to change |
|------|---------------|
| `frontend/src/pages/clients/intake/AdmissionSection.tsx` | Add TreeSelectDropdown for OU picker |
| `frontend/src/viewModels/client/ClientIntakeFormViewModel.ts:505-631` | After registerClient, call changeClientPlacement with OU if both set |

### Frontend Edit (Phases 4-5)

| File | What to change |
|------|---------------|
| `frontend/src/pages/clients/ClientDetailLayout.tsx` | Add Edit button, create ClientEditViewModel, pass via outlet context |
| `frontend/src/pages/clients/ClientOverviewPage.tsx` | Accept edit VM, add per-section edit/save/cancel |
| NEW: `frontend/src/viewModels/client/ClientEditViewModel.ts` | MobX VM with dirty tracking, section save, sub-entity CRUD |
| NEW: `frontend/src/pages/clients/edit/EditableSection.tsx` | Section wrapper with edit/save/cancel buttons |

### Reusable Components (no changes needed)

| File | Role |
|------|------|
| `frontend/src/components/ui/TreeSelectDropdown.tsx` | OU picker dropdown (props: nodes, selectedPath, onSelect) |
| `frontend/src/pages/clients/intake/IntakeFormField.tsx` | Field renderer for all types (text, date, enum, boolean, etc.) |
| `frontend/src/pages/clients/intake/useFieldProps.ts` | Derives field props from ViewModel + FieldDefinitions |
| `frontend/src/services/organization/IOrganizationUnitService.ts` | `getUnits()` to load flat OU list |
| `frontend/src/types/organization-unit.types.ts` | `buildOrganizationUnitTree()` to convert flat → tree for TreeSelectDropdown |

## Architecture Patterns Discovered

### Event-Driven Placement Flow
```
api.change_client_placement() → emit 'client.placement.changed' event
  → handle_client_placement_changed() handler:
    1. Close previous placement (is_current=false, end_date=start_date)
    2. INSERT new placement row (is_current=true)
    3. Denormalize to clients_projection.placement_arrangement
```

### Dirty Tracking Pattern (from ClientFieldSettingsViewModel)
- Maintain `originalFormData` (snapshot at load) and `formData` (current edits)
- Computed getter compares field-by-field
- Only send changed fields on save
- Session-scoped correlation ID shared across all saves

### Permission Check Pattern
- `hasPermission('client.update')` — async, returns Promise<boolean>
- From `useAuth()` context
- Checks against JWT `effective_permissions` claim
- Edit button gated by this + `client.status !== 'discharged'`

### TreeSelectDropdown Usage Pattern (from RoleFormFields)
```tsx
import { TreeSelectDropdown } from '@/components/ui/TreeSelectDropdown';
import { buildOrganizationUnitTree } from '@/types/organization-unit.types';

// Load flat units, build tree, pass to dropdown
const units = await ouService.getUnits({ status: 'active' });
const tree = buildOrganizationUnitTree(units, rootPath);

<TreeSelectDropdown
  id="ou-select"
  label="Organizational Unit"
  nodes={tree}
  selectedPath={selectedPath}
  onSelect={handleSelect}
  placeholder="Select..."
/>
```

### Sub-entity CRUD Pattern (from intake)
- Individual RPC calls per operation (not batched)
- `Promise.allSettled()` for partial success tolerance
- Correlation ID passed through all RPCs
- Reload client data after operations

## Important Constraints

- **Supabase CLI installed**: `supabase migration new` works. Migration file created: `20260422021549_client_ou_placement_and_edit_support.sql`.
- **`api.get_client()` placement query updated**: Now uses LEFT JOIN to `organization_units_projection` and explicit `jsonb_build_object()` (not `row_to_json`) to include `organization_unit_name` from the join.
- **TreeSelectDropdown uses `selectedPath` (ltree string)**, not `selectedId` (uuid). Need to map between OU id and path.
- **handle_client_registered already stores organization_unit_id**: Confirmed at line 204 of lifecycle handlers migration. No change needed for registration.
- **Placement history partial unique index**: Only one row per client can have `is_current = true` (`idx_client_placement_current`).
- **AsyncAPI contract must stay in sync**: When adding fields to event_data in RPC functions, also update the AsyncAPI schema in `infrastructure/supabase/contracts/asyncapi/domains/client.yaml` and regenerate types (`cd contracts && npm run generate:types`). Done for `organization_unit_id` in `ClientPlacementChangeData`. — Discovered 2026-04-22
- **Frontend `generated/` directory doesn't exist yet**: The generated events types are not yet consumed by the frontend. The copy step (`cp types/generated-events.ts frontend/src/types/generated/`) will fail until that directory is created. Not blocking for this feature since we're editing hand-written projection types, not event types. — Discovered 2026-04-22
- **`ClientPlacementHistory` is a hand-written projection type**: It lives in `client.types.ts` and maps to the RPC response shape from `api.get_client()`. It is NOT generated from AsyncAPI (those are event_data schemas). Safe to edit directly. — Confirmed 2026-04-22

## Files Created/Modified This Session

### New Files
- `infrastructure/supabase/supabase/migrations/20260422021549_client_ou_placement_and_edit_support.sql` — Full Phase 1 migration (ALTER TABLE, 3 CREATE OR REPLACE FUNCTION) — Created 2026-04-22

### Modified Files
- `infrastructure/supabase/handlers/client/handle_client_placement_changed.sql` — Updated reference handler to include `organization_unit_id` — Updated 2026-04-22
- `infrastructure/supabase/contracts/asyncapi/domains/client.yaml` — Added `organization_unit_id` to `ClientPlacementChangeData` schema — Updated 2026-04-22
- `infrastructure/supabase/contracts/types/generated-events.ts` — Regenerated (includes new field) — Updated 2026-04-22
- `infrastructure/supabase/contracts/asyncapi-bundled.yaml` — Regenerated bundle — Updated 2026-04-22

## Reference Materials

- `frontend/src/components/roles/RoleFormFields.tsx` — only existing consumer of TreeSelectDropdown
- `frontend/src/viewModels/settings/ClientFieldSettingsViewModel.ts` — dirty tracking pattern to follow
- `documentation/infrastructure/patterns/event-handler-pattern.md` — handler creation rules
- `infrastructure/supabase/handlers/` — reference handler files (must update after migration)
