---
status: current
last_updated: 2026-04-15
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Danger zone pattern for destructive operations — DangerZone collapsible panel for manage pages, inline ConfirmDialog for tab-level list items. Covers deactivation, reactivation, deletion with dependency checking, cascade behavior, and accessibility.

**When to read**:
- Adding deactivation/deletion to a new entity management page
- Implementing dependency checks before destructive actions
- Understanding when to use DangerZone vs inline ConfirmDialog
- Implementing cross-aggregate cascade via events

**Prerequisites**: [ui-patterns.md](ui-patterns.md)

**Key topics**: `danger-zone`, `deactivation`, `deletion`, `confirm-dialog`, `cascade`, `soft-delete`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# Danger Zone Pattern

## Decision Tree: DangerZone vs ConfirmDialog

```
Is this a full entity manage page with an edit form?
├── YES → Use DangerZone collapsible panel
│   Examples: OrganizationsManagePage, RolesManagePage, SchedulesManagePage
│   Component: <DangerZone entityType="Role" ... />
│
└── NO → Use inline ConfirmDialog triggered by action button
    Examples: CustomFieldsTab, CategoriesTab (tab-level list items)
    Component: <ConfirmDialog isOpen={...} variant="warning" ... />
```

## Components

### DangerZone (`components/ui/DangerZone.tsx`)

Collapsible disclosure panel with up to three sections:
- **Deactivate** (active entities only) — orange styling
- **Reactivate** (inactive entities only) — green styling
- **Delete** — red styling, optional `activeDeleteConstraint` warning

Render slots (`deactivateSlot`, `deleteSlot`) allow page-specific cascade warnings.

### ConfirmDialog (`components/ui/ConfirmDialog.tsx`)

Color-coded confirmation with variants:
- `danger` — red, for permanent deletion
- `warning` — orange, for deactivation
- `success` — green, for reactivation

Optional features:
- `details: string[]` — scrollable list of affected entities
- `requireConfirmText: string` — user must type text to enable confirm button

## Shared Base Type

```typescript
// types/danger-zone-dialog.types.ts
export type BaseDangerZoneState =
  | { type: 'none' }
  | { type: 'deactivate'; isLoading: boolean }
  | { type: 'reactivate'; isLoading: boolean }
  | { type: 'delete'; isLoading: boolean }
  | { type: 'discard' }
  | { type: 'activeWarning' };
```

Pages extend with entity-specific variants:
```typescript
type RoleDialogState = BaseDangerZoneState
  | { type: 'hasUsers'; users: string[] };
```

## Dependency Checking Pattern

Before confirming a destructive action, query for dependencies:

1. **Pre-action query** — RPC call to check impact (e.g., `api.get_field_usage_count()`)
2. **Conditional dialog** — Show warning with count/list if dependencies exist
3. **Confirm** — Proceed only after user acknowledges impact

Example flow (CustomFieldsTab):
```
Click trash → getFieldUsageCount(fieldKey) → 
  count > 0 ? ConfirmDialog(warning, "3 clients have data") :
  count = 0 ? ConfirmDialog(warning, "No data affected") →
  Confirm → deactivateCustomField()
```

## Cascade Behavior

### Same-aggregate cascade (handler)
When deactivating within the same projection table (e.g., org unit → child org units), the handler can cascade directly using ltree or self-referential queries.

### Cross-aggregate cascade (RPC)
When deactivation crosses projection tables (e.g., category → field definitions), the **RPC** emits individual events for each dependent entity. This preserves the audit trail in `domain_events`.

Example: `api.deactivate_field_category()` emits `client_field_definition.deactivated` for each active field before emitting `client_field_category.deactivated`. All events share the same `correlation_id`.

**Rule**: Handlers should NOT directly UPDATE other projection tables. Cross-aggregate side effects go through events.

## Soft-Delete Pattern

All deactivations are soft-deletes:
- `is_active = false` on projection row
- Record preserved for audit trail and potential reactivation
- RLS policies filter deactivated records from normal queries
- Event handlers create `*.deactivated` events in `domain_events`

## Accessibility (WCAG 2.1 AA)

### DangerZone
- WAI-ARIA Disclosure Pattern: `button[aria-expanded]` + `aria-controls`
- Content panel: `role="region"` + `aria-labelledby`
- `section[aria-labelledby]` for landmark navigation

### ConfirmDialog
- WAI-ARIA Alert Dialog Pattern: `role="alertdialog"`, `aria-modal="true"`
- Focus trap with Tab/Shift+Tab containment
- Escape key dismissal with focus restoration
- `aria-labelledby`/`aria-describedby` for content association

### Action Buttons
- All deactivate/delete buttons must have `aria-label="Deactivate {entity name}"` (not just icon)

## Consumers

| Page | Pattern | Cascade | Dependency Check |
|------|---------|---------|-----------------|
| OrganizationsManagePage | DangerZone | Backend | None |
| UsersManagePage | DangerZone | None | Role assignments |
| RolesManagePage | DangerZone | None | User list |
| SchedulesManagePage | DangerZone | FK CASCADE | User list |
| OrgUnitsManagePage | DangerZone | ltree handler | Permission-based |
| CustomFieldsTab | ConfirmDialog | None | Client usage count |
| CategoriesTab | ConfirmDialog | Events (cross-aggregate) | Field count + names |

## See Also

- [ui-patterns.md](ui-patterns.md) — Modal architecture, focus management
- [schedule-management.md](../reference/schedule-management.md) — Schedule lifecycle with DangerZone
