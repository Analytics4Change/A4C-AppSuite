---
status: seed
last_updated: 2026-07-27
---

# Seed: Surface client-field count-read failures in the delete/deactivate confirm UI

**Origin**: `software-architect-dbc` review of PR #99 (correlation-id on `apiRpcEnvelope` reads), observation **O1** (LOW, pre-existing — not introduced by #99). Priority: **LOW** (backend still guards the destructive action).

## Problem

The two client-field count reads are pre-flight checks that populate a destructive-action confirmation dialog:

- `ClientFieldSettingsViewModel.getFieldUsageCount(fieldKey)` → *"how many clients have data in this field?"* (drives `CustomFieldsTab` delete/deactivate confirm).
- `ClientFieldSettingsViewModel.getCategoryFieldCount(categoryId, includeInactive)` → *"how many fields live in this category?"* (drives `CategoriesTab` delete/deactivate confirm; `includeInactive=true` for the delete gate).

Both **collapse a read failure into a legitimate-looking zero**:

```ts
async getFieldUsageCount(fieldKey) {
  const correlationId = this.getSessionCorrelationId();
  try {
    const result = await this.service.getFieldUsageCount(fieldKey, correlationId);
    return result.success ? result.count : 0;
  } catch (error) {
    log.error('Failed to get field usage count', { error, correlationId }); // ← PR #99 added the log
    return 0;                                                               // ← but still returns a bare 0
  }
}
```

PR #99 added the **failure log** (it was a silent `catch {}` before), so the failure is now *traceable*. But the return is still a bare `0`/`{ count: 0, fields: [] }` — so on a network/RLS/RPC error the confirm dialog renders **"0 clients use this field — safe to delete"** when the true count is actually *unknown*, nudging an admin toward a destructive action on false pretenses.

## Why it's LOW (backend still guards it)

`delete_field_definition` / `delete_field_category` re-check usage server-side and **reject** if the count is non-zero — so this cannot cause data loss. The gap is purely the frontend confirm surface: a misleading "0" then a confusing server-side rejection if the admin proceeds. This is why dbc rated it an observation, not a finding.

## Proposed

Give the count reads a **failure channel** so callers can distinguish "0" from "couldn't determine", then render an honest confirm state:

1. **Return-shape change (VM)**: `getFieldUsageCount`/`getCategoryFieldCount` currently return a bare `number` / `{ count, fields }` with no failure signal. Return a discriminated shape (e.g. `{ status: 'ok'; count } | { status: 'error' }`) — or surface the existing `result.success === false` and the thrown-error path distinctly — instead of coercing both to `0`.
2. **Dialog rendering (`CustomFieldsTab.tsx` / `CategoriesTab.tsx`)**: when the count is *unknown*, show an "unable to verify usage — the server will re-check on confirm" state rather than "0"; consider disabling the confirm button or downgrading the reassurance copy. Keep the server-side gate as the real guard.

## Scope note

This is an **error-surfacing-to-UI** change (a different concern than PR #99's observability threading), touching the two settings tab components + the VM return contract. Not bolted onto the read-path PR. → related: [[pr-98-close-out]] (read-path pattern), [[command-feedback-standard]] (failure-surfacing conventions).
