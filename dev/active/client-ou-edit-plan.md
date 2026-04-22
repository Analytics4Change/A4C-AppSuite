# Client OU Placement & Edit — Plan

## Scope

- **In scope**: OU column on placement history, OU picker at intake, full client editing at `/clients/:clientId`, placement/OU change history tracking
- **Out of scope**: Direct care staff role, OU-scoped login flow, notification routing

## Phase Summary

| Phase | Description | Depends on | Effort | PR Strategy |
|-------|------------|-----------|--------|-------------|
| 1 | Database migration (ALTER + function updates) | — | Small | PR 1 |
| 2 | Frontend types & service updates | Phase 1 | Small | PR 1 |
| 3 | OU picker in intake form | Phase 2 | Small | PR 1 |
| 6 | Placement history OU display | Phase 1 | Small | PR 1 |
| 4 | Client edit ViewModel | Phase 2 | Medium | PR 2 |
| 5 | Client edit UI | Phase 4 | Large | PR 2 |

**PR 1**: Phases 1-3 + 6 (OU placement tracking)
**PR 2**: Phases 4-5 (full client editing)

## Phase 1: Database Migration

Single migration: `client_ou_placement_and_edit_support`

### 1a: Add organization_unit_id to placement history
```sql
ALTER TABLE client_placement_history_projection
  ADD COLUMN IF NOT EXISTS organization_unit_id uuid
  REFERENCES organization_units_projection(id);

CREATE INDEX IF NOT EXISTS idx_client_placement_history_ou
  ON client_placement_history_projection(organization_unit_id)
  WHERE is_current = true;
```

### 1b: Update api.change_client_placement() — add OU param
Add `p_organization_unit_id uuid DEFAULT NULL`. Include in event_data jsonb_build_object.

### 1c: Update handle_client_placement_changed() — store OU
Extract `organization_unit_id` from event_data. Include in INSERT to history. Also UPDATE `clients_projection.organization_unit_id`.

### 1d: Update api.get_client() — join for OU name
LEFT JOIN `organization_units_projection` in placement history query to include `display_name` as `organization_unit_name`.

## Phase 2: Frontend Types & Service

- Add `organization_unit_id` to `ChangePlacementParams` and `ClientPlacementHistory`
- Add `organization_unit_name` to `ClientPlacementHistory` (display field from join)
- Pass `p_organization_unit_id` in Supabase/Mock service calls

## Phase 3: OU Picker in Intake

- Add `TreeSelectDropdown` to `AdmissionSection.tsx`
- Load OU tree via `getUnits()` + `buildOrganizationUnitTree()`
- After registerClient, if both placement_arrangement and organization_unit_id set → call changeClientPlacement with OU

## Phase 4: Client Edit ViewModel

MobX ViewModel following `ClientFieldSettingsViewModel` dirty tracking pattern:
- originalFormData vs formData comparison
- Section-scoped save (only changed fields)
- Sub-entity CRUD via individual RPCs
- Session-scoped correlation ID

## Phase 5: Client Edit UI

Inline edit mode on ClientOverviewPage (no separate route):
- Per-section Edit/Save/Cancel toggle
- EditableSection wrapper component
- Reuse IntakeFormField for edit-mode rendering
- Placement changes go through changeClientPlacement RPC (not updateClient)
- Permission-gated: `client.update` + not discharged

## Phase 6: Placement History Display

- Show OU name in PlacementCard when present
- Data comes from api.get_client() LEFT JOIN
