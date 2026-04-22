# Client OU Placement & Edit — Plan

## Scope

- **In scope**: OU column on placement history, OU picker at intake, full client editing at `/clients/:clientId`, placement/OU change history tracking, single-path OU mutation via `change_client_placement`, new `client.transfer` permission, backfill of existing placements
- **Out of scope**: Direct care staff role, OU-scoped login flow, notification routing, OU-filtered RLS on placement history

## Plan Revision History

- **2026-04-21**: Initial 6-phase plan
- **2026-04-22**: Expanded to 9 phases after `software-architect-dbc` review. Added Phase 0 (AsyncAPI contract-first), Phase 7 (testing), Phase 8 (documentation). Split Phase 5 into 5a/5b. Added architect decisions C3, C4, M1, M4, M8 to DB phase. PR structure revised to 1 / 2a / 2b.

## Phase Summary

| Phase | Description | Depends on | Effort | PR |
|-------|------------|-----------|--------|----|
| 0 | AsyncAPI contract update + type regeneration | — | Small | PR 1 |
| 1 | Database migration (ALTER, functions, handler-with-lock, dual-write removal, permission seed, backfill) | Phase 0 | Medium | PR 1 |
| 2 | Frontend types & service updates + OU path mapping utility | Phase 1 | Small | PR 1 |
| 3 | OU picker in intake form | Phase 2 | Small | PR 1 |
| 6 | Placement history OU display | Phase 1 | Small | PR 1 |
| 8a | Documentation updates (AGENT-INDEX, table docs, ADR) — PR 1 slice | Phase 1 | Small | PR 1 |
| 4 | Client edit ViewModel (dirty tracking, null normalization, save ordering, correlation ID) | Phase 2 | Medium | PR 2a |
| 5a | Edit foundation: ClientDetailLayout, EditableSection wrapper, Demographics + Admission sections | Phase 4 | Medium | PR 2a |
| 5b | Edit extended: Clinical, Medical, Legal, Education sections + sub-entity CRUD (Insurance, Funding, Contacts) | Phase 5a | Large | PR 2b |
| 7 | Testing — distributed across PRs (VM unit tests, Playwright E2E, permission gating) | Phases 3, 5a, 5b | Medium | PR 1 + PR 2a + PR 2b |
| 8b | Documentation updates — edit feature slice | Phase 5b | Small | PR 2b |
| 9 | **Follow-up handoff**: activate parked `api-rpc-readback-pattern` feature as new plan implementation | PR 1 merge | Small | Post-PR-1 |

**PR 1**: Phases 0, 1, 2, 3, 6, 8a, 7 (intake slice) — OU placement tracking (includes Phase 1g-pre: `api.update_client` read-back seed)
**PR 2a**: Phase 4, 5a, 7 (edit foundation tests) — Edit foundation + 2 sections
**PR 2b**: Phase 5b, 8b, 7 (extended edit tests) — Remaining sections + sub-entities
**Post-PR-1**: Phase 9 — activate `dev/parked/api-rpc-readback-pattern/` as new active feature

---

## Phase 0: AsyncAPI Contract Update (NEW — C2)

Contract-first: the AsyncAPI schema is the source of truth. Must be updated and types regenerated BEFORE writing the migration.

### 0a: Update `ClientPlacementChangeData` in `client.yaml`
`infrastructure/supabase/contracts/asyncapi/domains/client.yaml` line 1146 — add:
```yaml
organization_unit_id:
  type: string
  format: uuid
  nullable: true
  description: Organizational unit (facility/site) for this placement
```
NOT added to `required` list — field is optional on event.

### 0b: Regenerate types
```bash
cd infrastructure/supabase/contracts
npm run generate:types
```

### 0c: Verify bundle regenerated
`asyncapi-bundled.yaml` should include the new field under `ClientPlacementChangeData`.

### 0d: Sync generated types to frontend
`frontend/src/types/generated/` DOES exist (contra earlier context note). After `npm run generate:types` in contracts, run `cd frontend && npm run sync-schemas` (invokes `scripts/sync-schemas.cjs`). The frontend `ClientPlacementHistory` hand-written type in `client.types.ts` still governs projection row shape — the generated type covers the event payload only. Both are updated in this feature.

---

## Phase 1: Database Migration

Single migration: `supabase migration new client_ou_placement_and_edit_support`
(Note: timestamp will be assigned by CLI — the prior `20260422021549` placeholder is abandoned since no file was created.)

### 1a: ALTER TABLE `client_placement_history_projection`
```sql
ALTER TABLE client_placement_history_projection
  ADD COLUMN IF NOT EXISTS organization_unit_id uuid
  REFERENCES organization_units_projection(id);

CREATE INDEX IF NOT EXISTS idx_client_placement_history_ou
  ON client_placement_history_projection(organization_unit_id)
  WHERE is_current = true;
```

### 1b: Backfill existing placements (G6)
```sql
UPDATE client_placement_history_projection ph
SET organization_unit_id = c.organization_unit_id
FROM clients_projection c
WHERE ph.client_id = c.id
  AND ph.is_current = true
  AND c.organization_unit_id IS NOT NULL
  AND ph.organization_unit_id IS NULL;
```
Idempotent via `IS NULL` guard; re-running is a no-op.

### 1c: Update `api.change_client_placement()` (C3 enabler + M8)
- Add `p_organization_unit_id uuid DEFAULT NULL` parameter.
- Include in event_data via `jsonb_build_object`.
- Include in `p_event_metadata` (session correlation_id propagation — already supported).
- Validate OU belongs to caller's org (join check).
- RPC response includes `organization_unit_id` and `organization_unit_name` for UI consumption.

### 1d: Update `handle_client_placement_changed()` (C4 lock + OU extraction)
Key changes:
- Extract `organization_unit_id` from event_data (nullable).
- **FOR UPDATE lock** at start:
  ```sql
  SELECT id INTO v_current_placement_id
  FROM client_placement_history_projection
  WHERE client_id = v_client_id AND is_current = true
  FOR UPDATE;
  ```
- Include `organization_unit_id` in INSERT to history.
- Denormalize `organization_unit_id` to `clients_projection` (single source of truth for current OU on the client).

### 1e: Update `api.get_client()` — explicit `jsonb_build_object` refactor (M5)
Replace `row_to_json(ph)::jsonb` in placement history aggregation with explicit enumeration:
```sql
COALESCE(jsonb_agg(
  jsonb_build_object(
    'id', ph.id,
    'client_id', ph.client_id,
    'organization_id', ph.organization_id,
    'placement_arrangement', ph.placement_arrangement,
    'start_date', ph.start_date,
    'end_date', ph.end_date,
    'is_current', ph.is_current,
    'reason', ph.reason,
    'created_at', ph.created_at,
    'updated_at', ph.updated_at,
    'last_event_id', ph.last_event_id,
    'organization_unit_id', ph.organization_unit_id,
    'organization_unit_name', ou.display_name
  ) ORDER BY ph.start_date DESC
), '[]'::jsonb)
```
With `LEFT JOIN organization_units_projection ou ON ou.id = ph.organization_unit_id`.

### 1f: Remove dual-write of OU from other handlers (C3)
- `handle_client_information_updated` (line 405 region): remove the `organization_unit_id` CASE branch. Any OU edit must route through `change_client_placement`.
- `handle_client_admitted` (line 463 region): keep initial OU population (admission creates the first placement record which will set OU via `change_client_placement` chain in intake flow) — verify by inspection; remove direct OU write if redundant.
- Document this removal in the migration header as a breaking internal contract change.

### 1g-pre: Add read-back to `api.update_client` (proof-of-pattern for parked follow-up)

Adopt Pattern A from `dev/parked/api-rpc-readback-pattern/` for `api.update_client` as a narrow proof-of-pattern. Generalization to all other `api.update_*` RPCs is deferred to the parked follow-up feature.

CREATE OR REPLACE `api.update_client()`:
- After `INSERT INTO domain_events ... RETURNING id INTO v_event_id`:
  ```sql
  SELECT * INTO v_row FROM clients_projection WHERE id = p_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Update failed to apply' USING ERRCODE = 'P9003';
  END IF;

  SELECT processing_error INTO v_processing_error
  FROM domain_events WHERE id = v_event_id;
  IF v_processing_error IS NOT NULL THEN
    RAISE EXCEPTION 'Handler failure: %', v_processing_error USING ERRCODE = 'P9004';
  END IF;

  RETURN jsonb_build_object('success', true, 'client_id', p_client_id, 'client', row_to_json(v_row));
  ```
- Preserve existing param signature; response shape gains `client` field (backward-compatible — existing callers continue reading `success`/`client_id`)
- Document error codes in function-level comment for later ADR consolidation

### 1g: Seed `client.transfer` permission (M1)
```sql
INSERT INTO permissions (permission, description, category)
VALUES ('client.transfer', 'Change a client''s placement or organizational unit', 'client')
ON CONFLICT (permission) DO UPDATE
SET description = EXCLUDED.description, category = EXCLUDED.category;

-- Add to provider_admin role template
INSERT INTO role_template_permissions (role_template_id, permission)
SELECT id, 'client.transfer' FROM role_templates WHERE role_template_key = 'provider_admin'
ON CONFLICT DO NOTHING;
```
Do NOT add to `clinician` template by default — organizations can extend.

### 1h: Verification queries (G2)
Include in migration file trailing comment block:
```sql
-- VERIFY:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'client_placement_history_projection' AND column_name = 'organization_unit_id';
-- SELECT proname, pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'change_client_placement';
-- SELECT permission FROM permissions WHERE permission = 'client.transfer';
-- SELECT COUNT(*) FROM client_placement_history_projection WHERE is_current = true AND organization_unit_id IS NOT NULL;
```

### 1i: RLS (M7)
- `client_placement_history_projection` RLS policies (`client_placement_select`, `client_placement_platform_admin`) are UNCHANGED — org-level filtering continues to suffice.
- Document decision in migration header: OU-scoped filtering is NOT introduced; if needed later, add API-query-time filter, not RLS.

### 1j: Handler reference file updates (M6 — AFTER migration applies)
Per `infrastructure/CLAUDE.md` Rule 7b:
1. Apply migration.
2. Copy live function body via `pg_get_functiondef()` or run-check.
3. Update reference files:
   - `infrastructure/supabase/handlers/client/handle_client_placement_changed.sql`
   - `infrastructure/supabase/handlers/client/handle_client_information_updated.sql`
   - `infrastructure/supabase/handlers/client/handle_client_admitted.sql` (if modified)
4. Verify router `handlers/routers/process_client_event.sql` at line 63 already has `client.placement.changed` CASE — no change needed.

### 1k: Rollback plan (G4 — NOT committed as migration)
Document in plan only (forward-only migrations):
- `DROP INDEX idx_client_placement_history_ou`
- `ALTER TABLE client_placement_history_projection DROP COLUMN organization_unit_id`
- Revert functions via `CREATE OR REPLACE` to prior definitions (from git history)
- Backfill data loss: only `organization_unit_id` values; original data preserved

---

## Phase 2: Frontend Types & Service

- Add `organization_unit_id` to `ChangePlacementParams`
- Add `organization_unit_id: string | null` + `organization_unit_name?: string | null` to `ClientPlacementHistory`
- Pass `p_organization_unit_id` in Supabase/Mock service calls
- NEW: `frontend/src/utils/organizationUnitPath.ts` with `getOUPathById(units, id)` and `getOUIdByPath(units, path)` helpers
- Handle deleted/deactivated OU gracefully: display warning state in UI (m1)

---

## Phase 3: OU Picker in Intake

- Add `TreeSelectDropdown` to `AdmissionSection.tsx` with `data-testid="admission-ou-select"` (m2)
- Load OU tree via `getUnits()` + `buildOrganizationUnitTree()` (VM level, not component — follows intake VM pattern)
- Wire `organization_unit_id` to `vm.setField()`
- After `registerClient()`, if both `placement_arrangement` and `organization_unit_id` set → call `changeClientPlacement` with OU
- All keyboard navigation inherits from `TreeSelectDropdown` (already WCAG-compliant)

---

## Phase 4: Client Edit ViewModel

New file: `frontend/src/viewModels/client/ClientEditViewModel.ts`

### Dirty tracking (follows `ClientFieldSettingsViewModel`)
- `originalFormData` (load snapshot) vs `formData` (current edits)
- Computed `sectionDirty(section)` → boolean per section
- **Null normalization (M2)**: empty string → null BEFORE diff computation. Array fields (race, allergies, secondary_diagnoses) → atomic replace, not per-element.
- Only send changed fields on save

### Save flow (M3)
- `saveSection(section)` → build diff → call `api.update_client(p_changes)` → await response
- After ANY save (update_client OR change_client_placement): call `getClient(clientId)`
- On refresh, reset `originalFormData` to fresh server data
- Check `processing_error` on recent events (via last_event_id on projection) → show error if handler failed

### Admission section save ordering (M4)
```
if (admissionDirty) {
  if (placementOrOUChanged) {
    const arrangement = placementArrangementChanged
      ? formData.placement_arrangement
      : originalFormData.placement_arrangement;  // reuse current (M8)
    await changeClientPlacement({
      client_id, placement_arrangement: arrangement,
      organization_unit_id: formData.organization_unit_id,
      start_date: today, reason: editReason,
    });
  }
  if (otherAdmissionFieldsChanged) {
    await updateClient({ client_id, changes: admissionFieldsExceptPlacementAndOU });
  }
  await getClient(clientId);
}
```
Both emissions share the session correlation_id.

### Correlation ID
- Session-scoped: `crypto.randomUUID()` on VM construction
- Passed in `p_event_metadata.correlation_id` for all RPCs

### Sub-entity CRUD
- Individual RPC per op (add/update/remove phone, email, address, insurance, funding, contact)
- `Promise.allSettled()` for partial-success tolerance
- Reload client after ops

### Logger (m5)
- Use `Logger.getLogger('viewmodel')` per frontend guideline #13

### Permission pre-check (m6)
- Verify `hasPermission` sync vs async signature; adjust render guards accordingly
- Edit button: `canEdit = hasPermission('client.update') && client.status !== 'discharged'`
- Placement edit: `canTransfer = hasPermission('client.transfer')`

---

## Phase 5a: Edit Foundation (PR 2a)

### ClientDetailLayout changes
- Edit button in header: gated on `client.update` + not discharged, `data-testid="client-edit-button"`
- Create `ClientEditViewModel` instance when edit mode activates
- Pass VM + `loadClient` callback via Outlet context

### EditableSection wrapper (NEW — Phase 5d in old plan)
`frontend/src/pages/clients/edit/EditableSection.tsx`
- Props: `title`, `icon`, `isEditing`, `isDirty`, `isSaving`, `error`, `onEdit`, `onSave`, `onCancel`, `children`
- Header with edit/save/cancel buttons
- Focus management (m3):
  - `useRef` to first editable field + Edit button
  - `useEffect` on `isEditing`: if true, focus first field; if false, focus Edit button (if previously editing)
- `aria-live="polite"` success announcement region
- `role="alert"` error banner focused on save failure
- Loading spinner during save
- `data-testid` per button (`-edit-btn`, `-save-btn`, `-cancel-btn`)

### ClientOverviewPage edit mode
- Accept `ClientEditViewModel` from outlet context
- Each section wrapped in `EditableSection`
- Edit mode: swap `Field` for `IntakeFormField` (via `useFieldProps`)
- Save calls `vm.saveSection(sectionName)`

### Sections in PR 2a: Demographics + Admission
- **Demographics**: name, DOB, pronouns, race, ethnicity, language, etc. — simple fields only
- **Admission**: placement, OU, arrangement, level of care, risk, etc. — demonstrates `change_client_placement` + `update_client` coordination

---

## Phase 5b: Edit Extended (PR 2b)

### Additional sections
- **Clinical**: primary/secondary diagnoses, medications, allergies
- **Medical**: medical history, physician, pharmacy
- **Legal**: legal status, consents
- **Education**: school, grade, IEP status

### Sub-entity CRUD sections
- **Phones**: add/edit/remove — individual RPC calls
- **Emails**: add/edit/remove
- **Addresses**: add/edit/remove
- **Insurance**: add/edit/remove (coverage type, policy #, group #)
- **Funding**: add/edit/remove (source, amount, period)
- **Contacts**: add/edit/remove (relationship, role, phone, email)

Sub-entity rows use a nested `EditableSection`-like pattern with Add/Remove buttons.

---

## Phase 6: Placement History OU Display

- Update `PlacementCard` component in `ClientOverviewPage.tsx`
- Display `organization_unit_name` when present; show "—" for null
- Data comes from `api.get_client()` LEFT JOIN (Phase 1e)
- Handle missing OU gracefully (display placeholder, not "undefined")

---

## Phase 7: Testing (Distributed Across PRs)

### PR 1 tests
- **DB function tests** (SQL, run via migration verification):
  - Emit `client.placement.changed` with `organization_unit_id` → assert projection row has OU + is_current
  - Concurrent placement events → assert no constraint violation (lock works)
  - Backfill query → assert existing rows updated
- **Intake E2E (Playwright)**:
  - `admission-ou-select` dropdown renders, selects OU, placement history shows OU name
- **Permission gating**:
  - User without `client.transfer` cannot see OU picker (if restricted at intake too — decision TBD, default no restriction at intake)

### PR 2a tests
- **VM unit tests (Vitest)**: `ClientEditViewModel`
  - Dirty detection per section
  - Null normalization (empty string → null)
  - Array field atomic replace
  - Correlation ID persists across saves within session
  - Save ordering: placement before information when both dirty
  - Error path: handler failure reflected in VM state
- **E2E**:
  - Edit button gated on `client.update` (viewer without permission sees read-only)
  - Demographics section edit/save/cancel
  - Admission section: OU change records placement history row

### PR 2b tests
- **VM unit tests**: sub-entity CRUD, partial success handling
- **E2E**:
  - Each section save flow
  - Sub-entity add/edit/remove
  - Discharged client: edit button hidden

---

## Phase 8: Documentation

### PR 1 slice (Phase 8a)
- Update `documentation/AGENT-INDEX.md` — extend `client-placement` keyword entry with OU tracking
- Update `documentation/infrastructure/reference/database/tables/client_placement_history_projection.md` — add `organization_unit_id` column
- Update `documentation/infrastructure/reference/database/tables/clients_projection.md` — note single-path OU mutation via `change_client_placement`
- NEW ADR: `documentation/architecture/decisions/adr-client-ou-placement.md` — documents:
  - Single-path OU mutation (C3 decision)
  - `client.transfer` permission (M1 decision)
  - Row lock in handler (C4 decision)
  - OU-only change reuses arrangement (M8 decision)

### PR 2b slice (Phase 8b)
- Update frontend client management docs with edit-mode UX
- Add edit ViewModel pattern to VM architecture docs
- Update AGENT-INDEX `client-edit` keyword entry

---

## Success Criteria

- ✅ OU selectable at intake; persisted to `clients_projection.organization_unit_id` AND `client_placement_history_projection.organization_unit_id`
- ✅ Placement history shows OU name via api.get_client LEFT JOIN
- ✅ Inline edit mode on ClientOverviewPage with per-section save
- ✅ `client.transfer` permission seeded, enforced in UI for OU/placement edits
- ✅ No dual-write paths for OU (sole mutation: `change_client_placement`)
- ✅ Handler lock prevents concurrent placement violations
- ✅ Backfill populates existing clients' current placement OU
- ✅ Documentation complete: ADR, table docs, AGENT-INDEX
- ✅ Tests: VM unit (dirty tracking, normalization, save ordering), E2E (intake, edit, permission gating)
- ✅ All verification queries pass

---

## Phase 9: Follow-up Handoff — API RPC Read-back Pattern (NEW)

Immediately after PR 1 of this feature merges, activate the parked feature at `dev/parked/api-rpc-readback-pattern/` as a new plan implementation. That feature generalizes the read-back pattern (seeded here in Phase 1g-pre for `api.update_client`) to ALL `api.update_*` RPCs.

### 9a: Activation tasks (on `client-ou-edit` PR 1 merge)
- [ ] Move `dev/parked/api-rpc-readback-pattern/` → `dev/active/api-rpc-readback-pattern/`
- [ ] Update the parked feature's "Current Status" section to mark it ACTIVE
- [ ] Begin Phase 0 (RPC inventory) of that feature
- [ ] Cross-link: in `client-ou-edit`'s final archival summary (when it moves to `dev/archived/`), note that the parked follow-up was activated

### 9b: Prevent slip
- This handoff is a PHASE of this feature's plan, not a loose TODO. Its completion is part of the `client-ou-edit` definition of done.
- If PR 1 merges without Phase 9 being executed, `client-ou-edit` is not complete.
- The parked feature directory existing on disk is the durable signal that this work is tracked.

## Out-of-Band Fixes Bundled (pre-existing bugs discovered during review)

- **`api.update_client` lacks projection read-back** (architect M3) — narrow fix scoped into Phase 1g-pre of this feature (seed pattern); broad generalization parked at `dev/parked/api-rpc-readback-pattern/` and activated by Phase 9.
