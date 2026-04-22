# Client OU Placement & Edit — Context

**Feature**: Client OU Placement Tracking + Full Client Record Editing
**Branch**: main (not yet branched)
**Started**: 2026-04-21
**Last Updated**: 2026-04-22 (post-architect-review — all "completed" claims reset; plan expanded to 8 phases)

## Overview

Clients in A4C-AppSuite are scoped to an organization but not to a specific organizational unit (facility/site). The `clients_projection.organization_unit_id` column exists but is never populated on placement history. There's no UI to set it at intake, and no way to edit it post-intake since the client detail page is entirely read-only.

Additionally, `client_placement_history_projection` doesn't track which OU a placement is at, so there's no audit trail of client movements between facilities.

This work adds:
1. OU-aware placement tracking (backend migration + intake UI)
2. Full client record editing (all sections, permission-gated)

## Key Decisions

1. **Single migration for all DB changes**: One migration covers the ALTER TABLE, function updates, handler updates, backfill, and permission seed. Created via `supabase migration new`.
2. **Inline edit mode, not separate route**: Edit toggle on `ClientOverviewPage` per-section, no `/edit` route. Keeps URL stable.
3. **Placement changes go through RPC, not updateClient**: Changing OU/placement calls `api.change_client_placement()` to preserve history audit trail. Regular field edits use `api.update_client()`.
4. **TreeSelectDropdown reuse**: Same OU picker component used in role management, reused for both intake and edit.
5. **Backward-compatible RPC**: `p_organization_unit_id` added as `DEFAULT NULL` param — existing callers unaffected.
6. **[C3] OU mutation is SINGLE-PATH** — Added 2026-04-22 post-architect-review.
   - **Decision**: `organization_unit_id` is mutable ONLY via `api.change_client_placement()`, never via `api.update_client()` or `api.admit_client()`.
   - **Rationale**: Every OU change must create a placement history row for audit. Dual paths let writes diverge (update_client writes projection without history row).
   - **Action**: Remove `organization_unit_id` CASE branch from `handle_client_information_updated`. On admission, `handle_client_admitted` still populates initial OU (first placement record is created by `change_client_placement` call chained after `registerClient`).
7. **[C4] Handler uses `FOR UPDATE` row lock** — Added 2026-04-22.
   - **Decision**: `handle_client_placement_changed` acquires `SELECT ... FOR UPDATE` on the existing `is_current=true` row before the close-then-insert sequence.
   - **Rationale**: Partial unique index `idx_client_placement_current` would reject concurrent INSERTs if two events race. Lock serializes the transition.
8. **[M1] Separate `client.transfer` permission** — Added 2026-04-22.
   - **Decision**: Introduce `client.transfer` permission distinct from `client.update`. Gate OU/placement edits on `client.transfer`; gate demographic/other edits on `client.update`.
   - **Rationale**: Placement changes affect OU-scoped access and carry clinical/administrative weight beyond a field edit. Matches the existing pattern of `client.discharge` as a separate action.
   - **Action**: Seed `client.transfer` in migration; add to `provider_admin` role template; do NOT add to `clinician` by default.
9. **[M8] OU-only changes reuse current `placement_arrangement`** — Added 2026-04-22.
   - **Decision**: When a user edits the Admission section and changes OU but NOT arrangement, the RPC call supplies the existing `placement_arrangement` from `clients_projection`.
   - **Rationale**: `client_placement_history_projection.placement_arrangement` is NOT NULL. The frontend looks up current arrangement before emitting the event.
10. **[M4] Admission-section save order: placement first, then information** — Added 2026-04-22.
    - **Decision**: If both OU/placement fields and regular Admission fields change in one save, emit `client.placement.changed` BEFORE `client.information_updated`. Both events share the session correlation_id.
    - **Rationale**: Deterministic audit trace; if the info update fails, placement history is already consistent.
11. **[G8] PR split: 1 / 2a / 2b** — Revised 2026-04-22.
    - **PR 1**: Phases 0–3, 6 (OU placement tracking + intake)
    - **PR 2a**: Phase 4, Phase 5a (VM + EditableSection + 2 sections: Demographics, Admission)
    - **PR 2b**: Phase 5b (remaining sections + sub-entity CRUD)

## Critical File Map

### Database (Phase 1)

| File | Purpose | Key Lines |
|------|---------|-----------|
| `infrastructure/supabase/supabase/migrations/20260406222857_client_api_functions.sql` | `api.change_client_placement()` RPC | 789-810 |
| `infrastructure/supabase/supabase/migrations/20260406222857_client_api_functions.sql` | `api.update_client()` RPC | 157-205 |
| `infrastructure/supabase/supabase/migrations/20260406222857_client_api_functions.sql` | `api.get_client()` with placement lateral join | 369-450 |
| `infrastructure/supabase/supabase/migrations/20260406222201_client_lifecycle_event_handlers.sql` | `handle_client_registered` | line 204 |
| `infrastructure/supabase/supabase/migrations/20260406222201_client_lifecycle_event_handlers.sql` | `handle_client_information_updated` (writes OU — to be removed per C3) | 380-456 |
| `infrastructure/supabase/supabase/migrations/20260406222201_client_lifecycle_event_handlers.sql` | `handle_client_admitted` (writes OU — to be removed per C3) | 463-490 |
| `infrastructure/supabase/supabase/migrations/20260406222642_client_sub_entity_event_handlers.sql` | `handle_client_placement_changed()` handler | 398-455 |
| `infrastructure/supabase/supabase/migrations/20260327205738_clients_projection.sql` | `clients_projection` table with `organization_unit_id` column | line 15 |
| `infrastructure/supabase/supabase/migrations/20260406221738_client_insurance_placement_tables.sql` | `client_placement_history_projection` table + partial unique index | 80-160 |
| `infrastructure/supabase/supabase/migrations/20260406221739_client_permissions_seed.sql` | `client.update`, `client.discharge` permission definitions (add `client.transfer` here pattern) | — |
| `infrastructure/supabase/handlers/routers/process_client_event.sql` | Router (has `client.placement.changed` CASE at line 63) | 63 |
| `infrastructure/supabase/handlers/client/handle_client_placement_changed.sql` | Reference handler file (update AFTER migration applied per infra rule 7b) | 1-58 |
| `infrastructure/supabase/handlers/client/handle_client_information_updated.sql` | Reference file (update after removing OU write per C3) | — |
| `infrastructure/supabase/handlers/client/handle_client_admitted.sql` | Reference file (update after removing OU write per C3) | — |

### Contracts (Phase 0)

| File | What to change |
|------|---------------|
| `infrastructure/supabase/contracts/asyncapi/domains/client.yaml:1146-1170` | Add `organization_unit_id` to `ClientPlacementChangeData` schema |
| `infrastructure/supabase/contracts/types/generated-events.ts` | Regenerate via `npm run generate:types` |
| `infrastructure/supabase/contracts/asyncapi-bundled.yaml` | Regenerate bundle |

### Frontend Types/Services (Phase 2)

| File | What to change |
|------|---------------|
| `frontend/src/types/client.types.ts:343-355` | Add `organization_unit_id` + `organization_unit_name` to `ClientPlacementHistory` |
| `frontend/src/types/client.types.ts:631-636` | Add `organization_unit_id` to `ChangePlacementParams` |
| `frontend/src/services/clients/SupabaseClientService.ts:390-404` | Pass `p_organization_unit_id` in RPC call |
| `frontend/src/services/clients/MockClientService.ts:710-746` | Add `organization_unit_id` to mock placement |
| NEW: `frontend/src/utils/organizationUnitPath.ts` | Helpers `getOUPathById(units, id)` and `getOUIdByPath(units, path)` for TreeSelectDropdown |

### Frontend Intake (Phase 3)

| File | What to change |
|------|---------------|
| `frontend/src/pages/clients/intake/AdmissionSection.tsx` | Add TreeSelectDropdown for OU picker (with `data-testid`) |
| `frontend/src/viewModels/client/ClientIntakeFormViewModel.ts:505-631` | After registerClient, call changeClientPlacement with OU if both set |

### Frontend Edit (Phases 4-5)

| File | What to change |
|------|---------------|
| `frontend/src/pages/clients/ClientDetailLayout.tsx` | Add Edit button, create ClientEditViewModel, pass via outlet context |
| `frontend/src/pages/clients/ClientOverviewPage.tsx` | Accept edit VM, add per-section edit/save/cancel |
| NEW: `frontend/src/viewModels/client/ClientEditViewModel.ts` | MobX VM with dirty tracking, section save, sub-entity CRUD, null normalization, correlation ID |
| NEW: `frontend/src/pages/clients/edit/EditableSection.tsx` | Section wrapper with edit/save/cancel buttons + focus management + `aria-live` |

### Documentation (Phase 8)

| File | What to change |
|------|---------------|
| `documentation/AGENT-INDEX.md` | Update `client-placement` keyword entry with OU tracking |
| `documentation/infrastructure/reference/database/tables/client_placement_history_projection.md` | Add `organization_unit_id` column row |
| `documentation/infrastructure/reference/database/tables/clients_projection.md` | Note OU mutation is via `change_client_placement` only |
| NEW: `documentation/architecture/decisions/adr-client-ou-placement.md` | ADR documenting single-path OU mutation + `client.transfer` permission |

### Reusable Components (no changes needed)

| File | Role |
|------|------|
| `frontend/src/components/ui/TreeSelectDropdown.tsx` | OU picker dropdown (props: nodes, selectedPath, onSelect) |
| `frontend/src/pages/clients/intake/IntakeFormField.tsx` | Field renderer for all types (text, date, enum, boolean, etc.) |
| `frontend/src/pages/clients/intake/useFieldProps.ts` | Derives field props from ViewModel + FieldDefinitions |
| `frontend/src/services/organization/IOrganizationUnitService.ts` | `getUnits()` to load flat OU list |
| `frontend/src/types/organization-unit.types.ts` | `buildOrganizationUnitTree()` to convert flat → tree for TreeSelectDropdown |

## Architecture Patterns Discovered

### Event-Driven Placement Flow (with lock)
```
api.change_client_placement() → emit 'client.placement.changed' event
  → handle_client_placement_changed() handler:
    1. SELECT id FROM client_placement_history_projection
         WHERE client_id = v_client_id AND is_current = true FOR UPDATE
    2. Close previous placement (is_current=false, end_date=start_date)
    3. INSERT new placement row (is_current=true, organization_unit_id)
    4. Denormalize to clients_projection (placement_arrangement, organization_unit_id)
```

### Dirty Tracking + Diff Payload (from ClientFieldSettingsViewModel)
- Maintain `originalFormData` (snapshot at load) and `formData` (current edits)
- Computed getter compares field-by-field
- **Null normalization**: empty string → null BEFORE diff comparison (so `{middle_name: ''}` becomes `{middle_name: null}`)
- **Array fields** (race, allergies, secondary_diagnoses): atomic replace, not per-element diff
- Only send changed fields on save via `api.update_client(p_changes)`
- Session-scoped correlation ID (crypto.randomUUID()) shared across all saves in the session
- **After save**: ALWAYS call `getClient(clientId)` to refresh, reset `originalFormData` to fresh server state; check for `processing_error` (handler failure is silent in RPC response)

### Admission Section Save Ordering
If both placement fields AND other Admission fields changed:
1. Call `api.change_client_placement(...)` first → emits `client.placement.changed`
2. Call `api.update_client(...)` second → emits `client.information_updated` (WITHOUT `organization_unit_id` in changes)
3. Call `getClient()` to refresh, check both events succeeded

### Permission Check Pattern
- `hasPermission('client.update')` and `hasPermission('client.transfer')` — TODO: verify sync vs async in useAuth; architect flagged async but may be sync
- From `useAuth()` context, checks against JWT `effective_permissions` claim
- Edit button gated by `client.update` + `client.status !== 'discharged'`
- Placement/OU edit sub-section gated by `client.transfer`

### TreeSelectDropdown Usage Pattern (from RoleFormFields)
```tsx
import { TreeSelectDropdown } from '@/components/ui/TreeSelectDropdown';
import { buildOrganizationUnitTree } from '@/types/organization-unit.types';
import { getOUPathById, getOUIdByPath } from '@/utils/organizationUnitPath';

// Load flat units, build tree, map id ↔ path for selection
const units = await ouService.getUnits({ status: 'active' });
const tree = buildOrganizationUnitTree(units, rootPath);
const selectedPath = currentOUId ? getOUPathById(units, currentOUId) : null;

<TreeSelectDropdown
  id="ou-select"
  data-testid="admission-ou-select"
  label="Organizational Unit"
  nodes={tree}
  selectedPath={selectedPath}
  onSelect={(path) => {
    const id = getOUIdByPath(units, path);
    vm.setField('organization_unit_id', id);
  }}
  placeholder="Select..."
/>
```

### Sub-entity CRUD Pattern (from intake)
- Individual RPC calls per operation (not batched)
- `Promise.allSettled()` for partial success tolerance
- Correlation ID passed through all RPCs (session-scoped in edit VM)
- Reload client data after operations

### Focus Management Pattern (EditableSection)
- On Edit click: focus moves to first editable field (`useRef` on first field + `useEffect` on `isEditing`)
- On Cancel click: focus returns to Edit button
- On Save success: focus stays on section, announce via `aria-live="polite"` region
- On Save error: focus moves to error banner with `role="alert"`
- NEVER use `setTimeout` — use refs and effects (per frontend guideline #7)

## Important Constraints

- **Supabase CLI installed**: `supabase migration new` works.
- **AsyncAPI contract FIRST**: Must update `client.yaml` + regenerate types BEFORE writing the migration — the contract is the source of truth (infrastructure/CLAUDE.md "AsyncAPI Type Generation"). — Reconfirmed 2026-04-22
- **TreeSelectDropdown uses `selectedPath` (ltree string)**, not `selectedId` (uuid). Need to map between OU id and path via helper utilities.
- **handle_client_registered already stores organization_unit_id**: Confirmed at line 204 of lifecycle handlers migration. No change needed for registration.
- **Placement history partial unique index**: Only one row per client can have `is_current = true` (`idx_client_placement_current`). Handler MUST lock the existing current row before the close-then-insert sequence.
- **`client_placement_history_projection.placement_arrangement` is NOT NULL**: OU-only changes must reuse the current arrangement value looked up from `clients_projection`.
- **`api.get_client` rewrite scope**: The existing placement history aggregation uses `row_to_json(ph)::jsonb`. Adding the OU join requires a full rewrite to explicit `jsonb_build_object(...)` enumerating every field. Must enumerate: id, client_id, organization_id, placement_arrangement, start_date, end_date, is_current, reason, created_at, updated_at, last_event_id, organization_unit_id (new), organization_unit_name (from join). Missing a field silently breaks `ClientPlacementHistory`.
- **`api.update_client` does NOT read back the projection**: Returns `{success: true, client_id}` immediately after event emission. Frontend MUST `getClient()` after save and check `processing_error` on recent events (or observe projection timestamp change) to detect handler failures.
- **`api.change_client_placement` response**: Returns placement metadata; frontend still calls `getClient()` after save for consistency.
- **RLS on `client_placement_history_projection` is org-level**: Adding the `organization_unit_id` column does NOT require new RLS policies. Decision documented: OU-scope filtering is handled at API query time if needed, not RLS. — Decided 2026-04-22
- **FK cross-tenant safety**: `organization_unit_id → organization_units_projection(id)` FK must preserve tenant isolation. The frontend-supplied OU is scoped to the user's org at the UI layer; RPC validates by joining on `organization_id`. Add CHECK or validation in the RPC body.
- **AGENT-INDEX and table docs must be updated**: Per `documentation-writing` standards — add `organization_unit_id` row to `client_placement_history_projection.md`, add ADR for single-path OU mutation.
- **Migration idempotency**: ALTER TABLE uses `ADD COLUMN IF NOT EXISTS`; CREATE INDEX uses `IF NOT EXISTS`; functions use `CREATE OR REPLACE`; backfill UPDATE uses `IS NULL` guard.
- **Rollback plan documented**: Migrations are forward-only; document reverse SQL (drop column, revert functions) in plan for emergency use — not committed as a migration.
- **`hasPermission` signature verification TODO**: Context prior version claimed async; architect flagged that useAuth may return sync from decoded JWT. Verify during Phase 4 implementation — if async, render permission-gated elements behind a pending state; if sync, no special handling needed.

## Gotchas Discovered This Session (2026-04-22)

- **`frontend/src/types/generated/` is gitignored** (`frontend/.gitignore:99`). Sync-schemas regenerates the mirror from `infrastructure/supabase/contracts/types/generated-events.ts`. Don't commit files there; they will appear unchanged in `git status` even after a successful sync.
- **Postgres function overload on DEFAULT param added**: When a function gains a new parameter with DEFAULT — even via `CREATE OR REPLACE` — Postgres creates a NEW overload instead of replacing the old signature. This left a stale 7-arg `api.change_client_placement` callable by name resolution. Fix: `DROP FUNCTION IF EXISTS api.fn(<old-types>)` BEFORE the new `CREATE OR REPLACE`. The migration's 1c block does this explicitly.
- **`organization_units_projection.display_name` is nullable; `.name` is NOT NULL**. `api.get_client`'s LEFT JOIN uses `COALESCE(ou.display_name, ou.name)` to always produce a string. `api.change_client_placement` similarly COALESCEs in its response.
- **Live dev DB has zero clients/placements** — backfill verification reports 0 rows. That's expected for this environment, not a bug. Re-run the backfill count after staging/prod apply to confirm.
- **Permission seed pattern is event-sourced, not direct INSERT**. The migration emits `permission.defined` via `domain_events` and relies on the existing handler to populate `permissions_projection`. Then `role_permission_templates`, `permission_implications`, and `role_permissions_projection` are directly INSERTed (these are seed tables, not event-sourced projections). This matches the pattern in `20260406221739_client_permissions_seed.sql`.
- **Tasks doc originally had wrong table names** (`permissions` + `role_templates`). The actual tables are `permissions_projection`, `role_permission_templates`, `role_permissions_projection`. The migration uses correct names; the task descriptions have been implicitly superseded by the completed SQL.
- **RPC argument order matters for overload resolution**. Added `p_organization_unit_id` at the END of the arg list so existing callers (which pass positional args) keep working. Frontend callers currently invoke `changeClientPlacement` with named parameters via Supabase's `.rpc()`, so ordering is flexible there.

## Files Created/Modified This Session

### New Files
- (none yet)

### Modified Files (Phase 0 — 2026-04-22)
- `infrastructure/supabase/contracts/asyncapi/domains/client.yaml` — added `organization_unit_id` (nullable uuid) to `ClientPlacementChangeData` schema
- `infrastructure/supabase/contracts/asyncapi-bundled.yaml` — regenerated by `npm run generate:types`
- `infrastructure/supabase/contracts/types/generated-events.ts` — regenerated by `npm run generate:types` (ClientPlacementChangeData now has `organization_unit_id?: string`)
- `frontend/src/types/generated/*` — regenerated by `npm run sync-schemas` (mirror of `infrastructure/.../contracts/types/`). **Gitignored** (see `frontend/.gitignore:99`) — rebuilt automatically by `npm run build` and `npm run sync-schemas`. A fresh clone after PR 1 merges will regenerate these from the committed AsyncAPI source. No git-tracked frontend change from Phase 0.

### New Files (Phase 1 — 2026-04-22)
- `infrastructure/supabase/supabase/migrations/20260422052825_client_ou_placement_and_edit_support.sql` — APPLIED to linked project 2026-04-22. All 10 verification assertions pass.

### Modified Files (Phase 1 post-apply — 2026-04-22)
- `infrastructure/supabase/handlers/client/handle_client_placement_changed.sql` — re-extracted via `pg_get_functiondef`: OU column + FOR UPDATE lock + denormalization
- `infrastructure/supabase/handlers/client/handle_client_information_updated.sql` — OU CASE branch removed
- `infrastructure/supabase/handlers/client/handle_client_admitted.sql` — OU CASE branch removed

### Doc Updates (both phases)
- `dev/active/client-ou-edit-tasks.md` — Phase 0 ✅ / Phase 1 in-progress; each 1a–1j task checked off with the concrete SQL element
- `dev/active/client-ou-edit-plan.md` — corrected stale 0d note to reflect frontend sync step
- `dev/active/client-ou-edit-context.md` — (this file)

**Architect review caveat (2026-04-22)**: Prior "completed" claims for the migration, AsyncAPI yaml, and handler reference files were reset because disk inspection showed none had been done. Claims from this session onward reflect verified on-disk state.

## Architect Review (2026-04-22)

Full architecture review completed via `software-architect-dbc` agent. Verdict: **APPROVE WITH CHANGES**. Core CQRS/event-sourcing approach sound; 16 specific changes required before implementation. Findings captured as phases/tasks in `client-ou-edit-plan.md` and `client-ou-edit-tasks.md`. Key integrations:
- Critical: C1 (reset false claims), C2 (AsyncAPI first), C3 (single-path OU mutation), C4 (row lock)
- Major: M1 (`client.transfer` permission), M2 (null normalization), M3 (loadClient + processing_error), M4 (save ordering), M5 (explicit jsonb_build_object refactor), M7 (RLS documentation), M8 (placement_arrangement fallback)
- Missing: G1 (test plan), G2 (verification queries), G6 (backfill), G7 (docs updates), G8 (PR split)
- Minor: m1–m7 incorporated into relevant phases

## Reference Materials

- `frontend/src/components/roles/RoleFormFields.tsx` — only existing consumer of TreeSelectDropdown
- `frontend/src/viewModels/settings/ClientFieldSettingsViewModel.ts` — dirty tracking pattern to follow
- `documentation/infrastructure/patterns/event-handler-pattern.md` — handler creation rules
- `infrastructure/supabase/handlers/` — reference handler files (update AFTER migration applied)
- `documentation/architecture/decisions/adr-client-management-schema.md` — establishes placement history as first-class projection
