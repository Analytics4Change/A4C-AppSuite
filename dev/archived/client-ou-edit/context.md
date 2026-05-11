# Client OU Placement & Edit — Context

**Feature**: Client OU Placement Tracking + Full Client Record Editing
**Branch**: `feat/client-ou-placement`
**Started**: 2026-04-21
**Last Updated**: 2026-04-22 (post-Phase-3 commit `9390eff7` — Phases 0-3 complete; PR 1 needs Phase 6 + 8a + PR 1 tests)

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

### Phases 0-1 (DB + contracts)
- **`frontend/src/types/generated/` is gitignored** (`frontend/.gitignore:99`). Sync-schemas regenerates the mirror from `infrastructure/supabase/contracts/types/generated-events.ts`. Don't commit files there; they will appear unchanged in `git status` even after a successful sync.
- **Postgres function overload on DEFAULT param added**: When a function gains a new parameter with DEFAULT — even via `CREATE OR REPLACE` — Postgres creates a NEW overload instead of replacing the old signature. This left a stale 7-arg `api.change_client_placement` callable by name resolution. Fix: `DROP FUNCTION IF EXISTS api.fn(<old-types>)` BEFORE the new `CREATE OR REPLACE`. The migration's 1c block does this explicitly.
- **`organization_units_projection.display_name` is nullable; `.name` is NOT NULL**. `api.get_client`'s LEFT JOIN uses `COALESCE(ou.display_name, ou.name)` to always produce a string. `api.change_client_placement` similarly COALESCEs in its response.
- **Live dev DB has zero clients/placements** — backfill verification reports 0 rows. That's expected for this environment, not a bug. Re-run the backfill count after staging/prod apply to confirm.
- **Permission seed pattern is event-sourced, not direct INSERT**. The migration emits `permission.defined` via `domain_events` and relies on the existing handler to populate `permissions_projection`. Then `role_permission_templates`, `permission_implications`, and `role_permissions_projection` are directly INSERTed (these are seed tables, not event-sourced projections). This matches the pattern in `20260406221739_client_permissions_seed.sql`.
- **Tasks doc originally had wrong table names** (`permissions` + `role_templates`). The actual tables are `permissions_projection`, `role_permission_templates`, `role_permissions_projection`. The migration uses correct names; the task descriptions have been implicitly superseded by the completed SQL.
- **RPC argument order matters for overload resolution**. Added `p_organization_unit_id` at the END of the arg list so existing callers (which pass positional args) keep working. Frontend callers currently invoke `changeClientPlacement` with named parameters via Supabase's `.rpc()`, so ordering is flexible there.

### Phase 2 (frontend types + services)
- **`ClientRpcResult.client` was typed as a 4-field subset** (`{id, first_name, last_name, status}`) that no consumer actually reads. Widened to `Partial<Client>` with an inline doc note clarifying that sub-entity arrays (phones/emails/placement_history/...) are NOT populated by a projection read-back — those still require `getClient()`. — Decided 2026-04-22
- **`api.update_client` read-back returns clients_projection row only** — not the full `Client` aggregate. Consumers that need sub-entities after an update still call `getClient()`. The service-level fallback in `SupabaseClientService.updateClient` does `getClient()` automatically when the RPC response omits `client` (Mock or pre-1g-pre API).
- **No existing consumers for `SupabaseClientService.updateClient`** at Phase 2 time — grep across `src/**` shows only the interface + Mock. Phase 4 ViewModel will be the first. Means the widened `ClientRpcResult.client` type is safe to land without touching call sites.
- **Pre-existing test failures baseline** (confirmed via stash-and-rerun on main): 52 fail / 389 pass (40 fail / 10 pass files) — in `SupabaseClientFieldService`, organization ViewModels, `InvitationAcceptanceViewModel`, scripts/logger. Don't attribute these to Phase 2/3 work. Baseline to compare against after Phase 4+ additions.

### PR #27 review remediation (2026-04-23)

- **`client.transfer` was seeded but unenforced**: Migration `20260422052825` seeded the permission, added it to `provider_admin`, and backfilled active roles — but `api.change_client_placement` still gated on `client.update`. Reviewer (lars-tice) flagged this as Major. Fix in `20260423032200`: the RPC now performs an **inferred** permission check (`client.create` when no `is_current=true` placement exists, otherwise `client.transfer`). DB-side inference means a malicious caller cannot bypass by spoofing an intake context. Intake naturally resolves to `client.create` (it calls `change_client_placement` *after* `register_client`, when no current placement exists).
- **Same-day placement violates `UNIQUE(client_id, start_date)`**: The constraint was added by `20260408000351` (decision 83 from the original `client-management-applet` work) but `handle_client_placement_changed`'s `ON CONFLICT` only targeted the pkey. An admin correcting an OU pick within minutes of intake would surface as `processing_error`. Fix: same-day branch under the FOR UPDATE lock — if the locked row's `start_date` matches the incoming event's, UPDATE in place; else fall through to close-then-insert.
- **Same-day broke RPC read-back**: The RPC previously read back by `id = v_placement_id` (the freshly-generated UUID). On the same-day path no new row is inserted, so the read-back returned null → RPC returned a misleading "Event processing failed" error even though the in-place update succeeded. Fix: broaden read-back to `WHERE client_id = p_client_id AND start_date = p_start_date AND is_current = true`.
- **`pg_get_functiondef` reformats CASE expressions onto multiple lines**: My initial verification SQL used `LIKE '%v_required_perm := CASE WHEN v_has_existing_placement%'` and got `false`. The actual stored body has a newline between `CASE` and `WHEN`. Re-verified with regex `~ 'v_required_perm := CASE\s+WHEN v_has_existing_placement THEN ''client\.transfer''\s+ELSE ''client\.create'''` which passed. Lesson: use regex with `\s+` (or split into multi-step LIKE checks for distinct phrases) when asserting against `pg_get_functiondef` output.
- **`ClientRpcResult.client: Partial<Client>` widened type safety**: Reviewer flagged that consumers got no compile-time hint about which fields are populated by a projection read-back vs. require `getClient()`. Fix: defined `ClientProjectionRow = Omit<Client, sub-entity-fields>` and narrowed `client?: ClientProjectionRow`. The `Omit<>` indirection means future column additions to `Client` flow through automatically — no risk of `ClientProjectionRow` drifting from the canonical type.
- **MockClientService stub broke after narrowing**: Mock `registerClient()` returned a hand-curated 4-field stub for `client` which no longer satisfied `ClientProjectionRow`. Fix: return the full constructed `client` (which structurally satisfies the projection-row shape; sub-entity arrays are tolerated under TS structural typing as extra properties).
- **Test scope drift on `'registering a client without selecting an OU'`**: The original test left `placement_arrangement` empty so it was actually testing the multi-field guard, not OU-specifically. Fix: rename to "intake without all three required placement fields emits no placement event" + add a second test that fills the other two but skips OU. New OU-skip test is now coverage isolation for the OU-required path.

### Phase 3 (intake OU picker)
- **`TreeSelectDropdown` has NO `data-testid` prop**. Its props are `id`, `label`, `nodes`, `selectedPath`, `onSelect`, `placeholder`, `disabled`, `error`, `helpText`, `className`. To attach a stable test selector, wrap it in a `<div data-testid="...">` — this avoids modifying a shared component used by the roles page.
- **`TreeSelectDropdown` is shared with `/roles/*` via `RoleFormFields.tsx`** — two importers total after Phase 3 (`AdmissionSection.tsx` + `RoleFormFields.tsx`). Previously the "Reference Materials" section claimed RoleFormFields was the "only existing consumer" — that's no longer true. Any change to TreeSelectDropdown affects both routes.
- **Intake loads `status: 'active'` units only** (`ouService.getUnits({ status: 'active' })`) — so the picker inherently cannot surface an inactive OU. The "(inactive)" suffix rendering is only needed in PlacementCard (Phase 6) and edit-mode picker (Phase 5a), where historical OU references may be inactive.
- **`rootPath` derived from shortest path**: Mirrors `RolesManagePage` pattern — `units.reduce((shortest, u) => u.path.length < shortest.length ? u.path : shortest, units[0].path)`. No JWT scope_path claim read is required; the OU service already scopes results to the user's hierarchy.
- **Intake does NOT eagerly call `changeClientPlacement`**. Before Phase 3 the intake flow only emitted `client.registered`; the first placement history row was never created at intake. Phase 3 adds the call conditionally (only when arrangement + OU + admission_date are all set) — arrangement-only intakes still do not emit a placement event. This matches C3 (placement history lifecycle owned by `change_client_placement`) without introducing a new auto-write path.
- **Placement failure is a warning, not a submit failure**. `changeClientPlacement` rides in the same `Promise.allSettled` batch as sub-entity RPCs, so if it fails the client is still registered and the user sees the failure in the `subEntityErrors` warning banner. This keeps intake resilient (client data is the primary artifact) while surfacing the problem.

## Files Created/Modified This Session

### New Files
- `infrastructure/supabase/supabase/migrations/20260422052825_client_ou_placement_and_edit_support.sql` — APPLIED to linked project 2026-04-22 (Phase 1, commit `cd374c12`). All 10 verification assertions pass.
- `frontend/src/utils/organizationUnitPath.ts` — `getOUPathById` + `getOUIdByPath` helpers bridging TreeSelectDropdown's ltree paths to UUID form stored in `clients_projection.organization_unit_id` (Phase 2, commit `d1f69ef1`).
- `frontend/src/utils/__tests__/organizationUnitPath.test.ts` — 11 Vitest unit tests (round-trip, null/undefined/empty, prefix non-match, empty list) (Phase 2, commit `d1f69ef1`).

### Modified Files (Phase 0 — 2026-04-22, commit `cd374c12`)
- `infrastructure/supabase/contracts/asyncapi/domains/client.yaml` — added `organization_unit_id` (nullable uuid) to `ClientPlacementChangeData` schema
- `infrastructure/supabase/contracts/asyncapi-bundled.yaml` — regenerated by `npm run generate:types`
- `infrastructure/supabase/contracts/types/generated-events.ts` — regenerated by `npm run generate:types` (ClientPlacementChangeData now has `organization_unit_id?: string`)
- `frontend/src/types/generated/*` — regenerated by `npm run sync-schemas` (mirror of `infrastructure/.../contracts/types/`). **Gitignored** (see `frontend/.gitignore:99`) — rebuilt automatically by `npm run build` and `npm run sync-schemas`. A fresh clone after PR 1 merges will regenerate these from the committed AsyncAPI source. No git-tracked frontend change from Phase 0.

### Modified Files (Phase 1 post-apply — 2026-04-22, commit `cd374c12`)
- `infrastructure/supabase/handlers/client/handle_client_placement_changed.sql` — re-extracted via `pg_get_functiondef`: OU column + FOR UPDATE lock + denormalization
- `infrastructure/supabase/handlers/client/handle_client_information_updated.sql` — OU CASE branch removed
- `infrastructure/supabase/handlers/client/handle_client_admitted.sql` — OU CASE branch removed

### Modified Files (Phase 2 — 2026-04-22, commit `d1f69ef1`)
- `frontend/src/types/client.types.ts`:
  - `ClientPlacementHistory` gained `organization_unit_id: string | null` + `organization_unit_name?: string | null`
  - `ChangePlacementParams` gained `organization_unit_id?: string | null`
  - `ClientRpcResult.client` widened from the 4-field subset to `Partial<Client>` with a doc comment on sub-entity array caveats
- `frontend/src/services/clients/SupabaseClientService.ts`:
  - `changeClientPlacement()` now passes `p_organization_unit_id: params.organization_unit_id ?? null`
  - `updateClient()` opts in to `response.client` when present; falls back to `await this.getClient(clientId)` when absent (Mock or pre-1g-pre API). This is the 1g-pre proof-of-pattern seed for the parked follow-up feature.
- `frontend/src/services/clients/MockClientService.ts`:
  - `changeClientPlacement()` writes `organization_unit_id` to the synthesized placement history row AND denormalizes it onto the client row — mirrors `handle_client_placement_changed` on the DB side.

### Modified Files (Phase 3 — 2026-04-22, commit `9390eff7`)
- `frontend/src/viewModels/client/ClientIntakeFormViewModel.ts`:
  - 3rd constructor arg: `organizationUnitService: IOrganizationUnitService = getOrganizationUnitService()`
  - New observables: `organizationUnits`, `organizationUnitsRootPath`, `isLoadingOrganizationUnits`, `organizationUnitsError`
  - New computeds: `organizationUnitTree` (calls `buildOrganizationUnitTree`), `selectedOrganizationUnitPath` (via `getOUPathById`)
  - New actions: `loadOrganizationUnits()` (idempotent, non-fatal on error), `setOrganizationUnitByPath(path)` (calls `getOUIdByPath` + `setField`)
  - `submit()` pushes `changeClientPlacement` into the post-register `Promise.allSettled` batch when `placement_arrangement`, `organization_unit_id`, AND `admission_date` are all set. Shares the session `correlation_id` with the register event.
- `frontend/src/pages/clients/intake/AdmissionSection.tsx`:
  - Imports `TreeSelectDropdown`
  - Renders OU picker wrapped in `<div data-testid="admission-ou-select">` with dynamic placeholder/disabled states + optional help text
- `frontend/src/pages/clients/ClientIntakePage.tsx`:
  - Mount effect calls `vm.loadOrganizationUnits()` alongside `vm.loadFieldDefinitions()`

### Doc Updates (all phases)
- `dev/active/client-ou-edit-tasks.md` — phase checkboxes, current status, concrete next-step block (updated through each phase; committed as part of feat commits `cd374c12`, `d1f69ef1`, `9390eff7`)
- `dev/active/client-ou-edit-plan.md` — corrected stale 0d note during Phase 0 work; not substantively changed since architect review integration
- `dev/active/client-ou-edit-context.md` — this file, updated after each phase

**Architect review caveat (2026-04-22)**: Prior "completed" claims for the migration, AsyncAPI yaml, and handler reference files were reset because disk inspection showed none had been done. Claims from Phase 0 onward reflect verified on-disk state.

## Architect Review (2026-04-22)

Full architecture review completed via `software-architect-dbc` agent. Verdict: **APPROVE WITH CHANGES**. Core CQRS/event-sourcing approach sound; 16 specific changes required before implementation. Findings captured as phases/tasks in `client-ou-edit-plan.md` and `client-ou-edit-tasks.md`. Key integrations:
- Critical: C1 (reset false claims), C2 (AsyncAPI first), C3 (single-path OU mutation), C4 (row lock)
- Major: M1 (`client.transfer` permission), M2 (null normalization), M3 (loadClient + processing_error), M4 (save ordering), M5 (explicit jsonb_build_object refactor), M7 (RLS documentation), M8 (placement_arrangement fallback)
- Missing: G1 (test plan), G2 (verification queries), G6 (backfill), G7 (docs updates), G8 (PR split)
- Minor: m1–m7 incorporated into relevant phases

## Reference Materials

- `frontend/src/components/roles/RoleFormFields.tsx` — TreeSelectDropdown consumer on `/roles/*`. Stores OU selection as a **path string** (no UUID mapping needed — differs from the intake flow).
- `frontend/src/pages/clients/intake/AdmissionSection.tsx` — second TreeSelectDropdown consumer (new in Phase 3). Stores OU as a **UUID** in `formData.organization_unit_id` with path↔id mapping via `frontend/src/utils/organizationUnitPath.ts`.
- `frontend/src/pages/roles/RolesManagePage.tsx` — reference implementation for the "shortest-path reduce" rootPath pattern that `ClientIntakeFormViewModel.loadOrganizationUnits()` mirrors.
- `frontend/src/viewModels/settings/ClientFieldSettingsViewModel.ts` — dirty tracking pattern to follow for Phase 4 `ClientEditViewModel`.
- `documentation/infrastructure/patterns/event-handler-pattern.md` — handler creation rules.
- `infrastructure/supabase/handlers/` — reference handler files (update AFTER migration applied).
- `documentation/architecture/decisions/adr-client-management-schema.md` — establishes placement history as first-class projection.
