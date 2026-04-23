---
status: current
last_updated: 2026-04-23
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: ADR documenting six architectural decisions for associating clients with organizational units via placement history. Establishes the placement history row as the single source of truth for OU assignment, defines the `client.transfer` permission (enforced via inferred check in `api.change_client_placement`), mandates a row lock in the placement handler, enriches the read model with current OU state without corrupting audit history, and updates same-day placement events in place to honour the `(client_id, start_date)` UNIQUE constraint.

**When to read**:
- Before modifying the client admission or placement code paths
- Adding new fields to `client_placement_history_projection`
- Reviewing how OU changes affect a client over time
- Planning client transfer UX (Phase 5a edit mode)
- Understanding why `clients_projection.organization_unit_id` is denormalized but not directly mutable

**Prerequisites**: [event-sourcing-overview](../data/event-sourcing-overview.md), [event-handler-pattern](../../infrastructure/patterns/event-handler-pattern.md)

**Key topics**: `adr`, `client-placement`, `organization-unit`, `client-transfer`, `placement-history`, `row-lock`, `cqrs-read-model`

**Estimated read time**: 8 minutes
<!-- TL;DR-END -->

# ADR: Client OU Placement

**Date**: 2026-04-22 (Phase 1 schema + handlers) / 2026-04-23 (Phase 6 read-model enrichment + PR #27 review remediation)
**Status**: Implemented (PR 1 — Phases 0, 1, 2, 3, 6 + Decisions 2-enforcement and 6 added)
**Deciders**: Lars (architect), Claude (implementation), software-architect-dbc (review)

## Context

Clients need a tracked association with an organizational unit (campus, wing, department) for operational and reporting purposes. Before this feature, `clients_projection` carried a nullable `organization_unit_id` column mutated by multiple event handlers, and `client_placement_history_projection` had no OU column at all — meaning the client's current OU and their placement history could diverge, and a "transfer" had no first-class record.

This ADR consolidates the architectural decisions made across the `client-ou-edit` feature's PR 1 (Phases 0–3, 6).

## Decisions

### Decision 1 — Single-path OU mutation via `change_client_placement` (C3)

**Decision**: `organization_unit_id` is only mutable through the `client.placement.changed` event, emitted by `api.change_client_placement()`. Prior handlers (`handle_client_information_updated`, `handle_client_admitted`) previously wrote `organization_unit_id` as a CASE-branch side effect of unrelated update events; those writes are removed.

**Rationale**:
- **Audit-first**: Every OU transition must produce a placement history row (start_date, end_date, reason) — the single event type `client.placement.changed` is the only one that does this. Side-effect writes from information updates bypass audit.
- **No divergence**: Previously, an info update could set `clients_projection.organization_unit_id` without inserting a placement row, leaving the denormalized column and the history out of sync.
- **Denormalization is one-way**: The placement handler updates `clients_projection.organization_unit_id` (and `placement_arrangement`) as a denormalization of the newly-inserted `is_current = true` placement row. Those denormalized fields are read-only convenience for queries; the canonical source is `client_placement_history_projection`.

**Validation**: Verification queries in migration `20260422052825` assert `info_updated_mutates_ou = false` and `admitted_mutates_ou = false`.

### Decision 2 — `client.transfer` permission (M1)

**Decision**: Introduce a dedicated `client.transfer` permission, distinct from `client.update`, and seed it for the `provider_admin` role template with implication edges `client.transfer → client.view` and `client.transfer → client.update`.

**Rationale**:
- **Semantic separation**: Moving a client between OUs is an operationally significant action with different audit and approval requirements than editing demographics or clinical fields. Conflating it with `client.update` would leak transfer rights to any clinician who can edit charts.
- **Role granularity**: Clinicians generally should not transfer clients between campuses; provider admins should. Keeping the permissions separate makes the role template grant honest.
- **Backfill**: All active `provider_admin` role assignments received `client.transfer` via an idempotent INSERT into `role_permissions_projection` in migration `20260422052825`.

**Note**: `clinician` role does NOT receive `client.transfer`. If a clinician creates a client via intake and selects an OU at the same time, the OU picker is gated by `client.create` (the intake permission), not `client.transfer`. This is intentional — initial placement at intake is part of client creation, not a transfer.

**Enforcement** (added 2026-04-23 post-PR-#27 review): `api.change_client_placement` now performs an **inferred permission check**:

```sql
SELECT EXISTS (
    SELECT 1 FROM client_placement_history_projection
    WHERE client_id = p_client_id AND is_current = true
) INTO v_has_existing_placement;

v_required_perm := CASE
    WHEN v_has_existing_placement THEN 'client.transfer'
    ELSE 'client.create'
END;

IF NOT public.has_effective_permission(v_required_perm, v_org_path) THEN
    RETURN jsonb_build_object('success', false,
        'error', 'Missing permission: ' || v_required_perm);
END IF;
```

The DB infers transfer-vs-create from state (presence of an `is_current = true` placement row). A malicious caller cannot bypass by claiming an intake context. Migration `20260423032200_client_transfer_enforcement_and_same_day_placement.sql` ships this enforcement; the prior `client.update` check it replaces was a temporary stand-in identified during PR #27 review. The intake flow (which calls `change_client_placement` *after* `register_client`, when no `is_current` row exists) resolves to `client.create`; the edit flow (Phase 5a, future PR 2a) resolves to `client.transfer`. Decision 2's claim that transfers are gated on `client.transfer` is now load-bearing at the enforcement layer, not just the role-template seed.

### Decision 3 — Row lock in `handle_client_placement_changed` (C4)

**Decision**: The placement handler acquires a `FOR UPDATE` lock on the existing `is_current = true` placement row before the close-then-insert cycle.

**Rationale**:
- **Concurrency safety**: Two concurrent placement change events (from the same or different sessions) could race: both would read `is_current = true`, both would close it, both would insert a new current row — potentially creating two `is_current = true` rows for the same client. The handler runs inside the synchronous BEFORE INSERT trigger, so PostgreSQL's row-level lock serializes concurrent transactions on the same client's placement.
- **Controlled failure**: When two transactions arrive simultaneously, the second waits for the first to commit, then re-reads the row (now closed) and sees no matching `is_current = true` row — it proceeds with only the insert (or, more likely, the `ON CONFLICT` branch handles it). No constraint violation surfaces to the caller.
- **Cost**: Negligible — the lock is released on transaction commit, and placements change infrequently.

**Validation**: Verification query asserts `placement_handler_has_for_update = true` against `pg_get_functiondef`.

### Decision 4 — OU-only change reuses current placement_arrangement (M8)

**Decision**: When the edit UI dispatches a `change_client_placement` for an OU-only change (user changes OU but does not touch placement arrangement), the ViewModel passes the *current* `placement_arrangement` as the RPC's `p_placement_arrangement` argument. The RPC signature does not allow null arrangement — that would indicate ending placement, which has a separate `end_client_placement` path.

**Rationale**:
- **Contract clarity**: The RPC treats `placement_arrangement` as required because a placement history row must have one. Making it optional on OU-only changes would force the handler to special-case null (either inherit or refuse) — and "inherit from previous row" is exactly what the frontend can do cleanly by passing the current value.
- **Fallback source**: The edit ViewModel's `originalFormData.placement_arrangement` is the single source for this fallback. If the user never loaded the client (unlikely during an edit), the fallback is a programming bug caught by a runtime assertion.
- **Per-row immutability**: Each placement history row records the *state at that moment*. Reusing the arrangement on an OU-only change produces a new row with the same arrangement but a different OU — semantically correct for "client was moved to a different unit while keeping their level of care".

### Decision 5 — OU current state enriched at read time, not on the history row (Phase 6)

**Decision**: `api.get_client()` enriches each placement_history item with `organization_unit_name`, `organization_unit_is_active`, and `organization_unit_deleted_at` via a `LEFT JOIN` to `organization_units_projection` at read time. These fields are NOT stored on `client_placement_history_projection`.

**Rationale**: Considered two other options and rejected both:

| Option | Problem |
|---|---|
| Denormalize `organization_unit_is_active` onto `client_placement_history_projection` | Would require a cascade handler on OU deactivation to flip the flag on every historical placement. The history row would then mutate based on a later event — violating event-sourced audit semantics. A row that describes "client was in OU X from D1 to D2" must not change when OU X is later deactivated. |
| Filter the `LEFT JOIN` by `ou.is_active AND ou.deleted_at IS NULL` | Would erase the fact that the client was ever placed in the now-deactivated OU. "History" must preserve what was true at the time, even if the referenced OU no longer exists as an active unit. |

**Architect-reviewed** (software-architect-dbc): "Deriving at read time via LEFT JOIN is the only option consistent with CQRS and event-sourced audit semantics." See migration `20260423013804` header for full context.

**Forward-compatibility**: The same three fields will be consumed by the Phase 5a edit-mode OU picker to display the "(inactive)" annotation on a client's current OU when it has been deactivated since assignment. No additional backend work required.

### Decision 6 — Same-day placement corrections update in place (PR #27 review)

**Decision**: `handle_client_placement_changed` branches on `start_date` inside the `FOR UPDATE` lock. If the locked `is_current = true` row's `start_date` matches the incoming event's `start_date`, the handler updates that row in place (correction). Otherwise it follows the existing close-then-insert path. This avoids violating the `UNIQUE (client_id, start_date)` constraint added by migration `20260408000351`.

**Rationale**:
- **Semantic match**: An admin re-selecting an OU within minutes of intake is correcting a placement, not stacking a new one. Two history rows for the same start date would mislead audit consumers ("the client was in two OUs simultaneously on 2026-04-22").
- **Avoids processing_error noise**: Without this branch, same-day double-saves would surface as `processing_error` on the second event with a unique-violation message. Operators would see legitimate corrections as failures.
- **Lock-protected**: The `FOR UPDATE` lock from Decision 3 already serializes concurrent placement events; the same-day branch operates inside that lock, so two same-day events from racing sessions still serialize and both end up updating the same surviving row.

**RPC read-back broadened**: `api.change_client_placement` previously read back the new row by `id = v_placement_id` (the freshly-generated UUID from the RPC). On the same-day path the handler does NOT insert a new row, so that read-back would return null. Migration `20260423032200` broadens the read-back to `WHERE client_id = p_client_id AND start_date = p_start_date AND is_current = true`, which resolves both new-row and same-day-correction paths cleanly.

**Validation**: Migration `20260423032200` verification queries assert the handler body contains the same-day branch and the RPC body contains the broadened read-back.

## Consequences

### Schema & Functions

- `client_placement_history_projection.organization_unit_id` (nullable uuid, FK to `organization_units_projection.id`, partial index on `WHERE is_current = true`)
- `api.change_client_placement(..., p_organization_unit_id uuid DEFAULT NULL)` — 8-arg signature; emits `client.placement.changed` with the OU in `event_data`
- `handle_client_placement_changed()` — extracts OU, locks prior is_current row, closes it, inserts new row with OU, denormalizes to `clients_projection`
- `api.get_client()` placement_history items include `organization_unit_name`, `organization_unit_is_active`, `organization_unit_deleted_at`
- `permissions_projection`: new row for `client.transfer`
- `role_permission_templates`: new row `(provider_admin, client.transfer, true)`
- `permission_implications`: two new edges (`client.transfer → client.view`, `client.transfer → client.update`)

### Frontend

- `ClientPlacementHistory` type extended with `organization_unit_id`, optional `organization_unit_name`, `organization_unit_is_active`, `organization_unit_deleted_at`
- `ChangePlacementParams` accepts `organization_unit_id?: string | null`
- `ClientIntakeFormViewModel` loads `OrganizationUnit[]` via `IOrganizationUnitService.getUnits({ status: 'active' })` and presents them in a `TreeSelectDropdown` on the Admission section
- `PlacementCard` on `ClientOverviewPage` renders a three-state OU label (name, `name (inactive)`, `—`) via `formatPlacementOuLabel()` helper, wrapped in `data-testid="placement-ou-label"`
- `organizationUnitPath.ts` utility: `getOUPathById` / `getOUIdByPath` for bridging TreeSelectDropdown's ltree-path selection model with the VM's uuid-keyed formData

### RLS (Unchanged)

Organization-level filter on `client_placement_history_projection` continues to suffice — a user with access to a client necessarily has access to their placement history, and OU scoping is enforced at the application level via `client.transfer` permission gating.

### Risks Accepted

- **Historical placements without OU**: Placements created before migration `20260422052825` have `organization_unit_id = NULL`. The backfill copies the denormalized `clients_projection.organization_unit_id` onto the current `is_current = true` row only — closed historical rows remain nullable by design (we don't know what OU they were in at close time).
- **Intake permission gating**: The OU picker at intake is visible to any user with `client.create` (not `client.transfer`). Rationale: the initial placement is part of client creation, not a transfer. Edit-mode OU changes (Phase 5a) will be gated on `client.transfer`.

## Related Documents

- [Client Management Schema ADR](./adr-client-management-schema.md) — Original client schema design
- [CQRS Dual-Write Remediation ADR](./adr-cqrs-dual-write-remediation.md) — Why API functions never write projections directly
- [Event Handler Pattern](../../infrastructure/patterns/event-handler-pattern.md) — Handler architecture, naming, and router conventions
- [client_placement_history_projection](../../infrastructure/reference/database/tables/client_placement_history_projection.md) — Table reference
- [clients_projection](../../infrastructure/reference/database/tables/clients_projection.md) — Client aggregate reference
- Migrations: `20260422052825_client_ou_placement_and_edit_support.sql`, `20260423013804_client_get_client_ou_state_fields.sql`
- Feature dev-docs: `dev/active/client-ou-edit-{plan,context,tasks}.md`
