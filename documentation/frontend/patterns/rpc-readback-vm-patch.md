---
status: current
last_updated: 2026-04-23
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: When an `api.*` RPC (or Edge Function) returns a Pattern A v2 read-back entity, the consuming ViewModel should patch its observable list in place by id rather than issuing a follow-up `loadX()` refetch; fallback to refetch + `log.warn` when the entity field is missing.

**When to read**:
- Adding a new `api.update_*` / `api.add_*` service call that invokes Pattern A v2
- Consuming a newly-migrated RPC that now returns an entity
- Writing a new Edge Function operation and deciding the response envelope shape
- Debugging stale list state after a successful save

**Prerequisites**: [adr-rpc-readback-pattern.md](../../architecture/decisions/adr-rpc-readback-pattern.md)

**Key topics**: `pattern-a-v2`, `vm-patch`, `in-place-update`, `refetch`, `fallback`, `rpc-readback`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# RPC Read-Back Consumer Pattern (VM In-Place Patch)

This pattern emerged across three domains (Roles, Client Fields, Users) after Pattern A v2 read-back guards landed on `api.update_*` RPCs. Once the backend returns the refreshed entity in its success envelope, the frontend no longer needs to issue a follow-up list refetch — it can patch its observable state in place using the returned row.

## Problem

Before Pattern A v2, `api.update_*` RPCs returned only `{success, <id>}`. To refresh the UI after a save, ViewModels issued a `loadX()` call that re-fetched the entire list. This caused:

- Redundant network round-trips (full list refetch after a single-row mutation)
- Loading-state flicker between save-complete and list-refreshed states
- Silent stale-state bugs if the refetch was ever accidentally dropped

With Pattern A v2, the RPC envelope contains the refreshed entity (`phone`, `role`, `field`, etc.). The VM can apply the update locally.

## Service-layer propagation

The service method must propagate the read-back entity through its return type. Narrow the return to a specific `<Entity>Result` type extending the domain's `RpcEnvelope`:

```typescript
// frontend/src/types/user.types.ts
export interface UserRpcEnvelope {
  success: boolean;
  error?: string;
  errorDetails?: { /* ... */ };
}

export interface UserPhoneResult extends UserRpcEnvelope {
  phoneId?: string;
  phone?: UserPhone;  // Populated on success by Pattern A v2 read-back
}
```

The Supabase service body maps the RPC's raw response shape to the consumer-facing entity type (handles snake_case → camelCase if the RPC uses `row_to_json`):

```typescript
// frontend/src/services/users/SupabaseUserCommandService.ts
async updateUserPhone(request: UpdateUserPhoneRequest): Promise<UserPhoneResult> {
  const { data, error } = await supabaseService.apiRpc<{
    success: boolean;
    phoneId: string;
    eventId: string;
    phone?: { /* snake_case fields from row_to_json */ };
  }>('update_user_phone', { /* params */ });

  // ... error handling ...

  // Map snake_case → camelCase UserPhone
  const phone = data?.phone ? {
    id: data.phone.id,
    userId: data.phone.user_id,
    // ...
    createdAt: new Date(data.phone.created_at),
    updatedAt: new Date(data.phone.updated_at),
  } : undefined;

  return { success: true, phoneId: request.phoneId, phone };
}
```

The Mock service mirrors the contract so tests exercise the same shape.

## ViewModel immutable splice pattern

In the ViewModel, replace the `loadX()` refetch with an immutable `.map()` that substitutes the matching entry:

```typescript
// frontend/src/viewModels/users/UsersViewModel.ts
async updateUserPhone(request: UpdateUserPhoneRequest): Promise<UserPhoneResult> {
  try {
    const result = await this.commandService.updateUserPhone(request);

    // ... error + submission state handling ...

    if (result.success) {
      if (result.phone) {
        runInAction(() => {
          const updated = result.phone!;
          this.userPhones = this.userPhones.map((p) =>
            p.id === updated.id ? updated : p
          );
        });
      } else {
        // Fallback — see next section
      }
    }

    return result;
  } catch (error) { /* ... */ }
}
```

**Always use immutable updates** (`.map()`, `[...list, item]`, splice) per [mobx-patterns.md](./mobx-patterns.md). Never mutate the observable array directly.

**For adds**, append instead of replace:

```typescript
runInAction(() => {
  this.userPhones = [...this.userPhones, result.phone!];
});
```

## Fallback with `log.warn`

The entity field is optional in the result type (`phone?`, `user?`, `notificationPreferences?`). When it's absent, the VM MUST fall back to the old refetch path AND emit a `log.warn` telemetry signal:

```typescript
} else {
  log.warn(
    'updateUserPhone success without phone read-back — falling back to refetch. ' +
      'Backend RPC may be pre-Pattern-A-v2 or on a failed migration.',
    { phoneId: request.phoneId }
  );
  if (this.selectedItemId) {
    await this.loadUserPhones(this.selectedItemId);
  }
}
```

**Why the fallback exists**:
1. **Deploy-window safety**: during a rollout where the backend hasn't yet shipped the read-back, the frontend still works correctly (just with the old refetch pattern).
2. **Structural regression detection**: the `log.warn` surfaces in production logs the moment a backend regression causes the read-back to be dropped. Per [logging-standards.md](../../architecture/logging-standards.md), `warn` is the right severity — operation succeeded, but a structural expectation was violated.

**For Edge Function consumers**, prefer **version-gated detection** over field-presence detection. The Edge Function envelope should include a `deployVersion` marker; the VM can branch on both `deployVersion` and the entity field:

```typescript
// Edge Function (Deno)
const response: ManageUserResponse = {
  success: true,
  userId,
  deployVersion: DEPLOY_VERSION,  // e.g., 'v10-notification-prefs-readback'
  notificationPreferences: prefs,
};
```

## When NOT to patch (LEGITIMATE refetch)

Keep the `loadX()` refetch when the operation's side effects extend beyond the single row the RPC returned. Examples:

- **Dual-scoped lists**: where a list is composed of global + org-specific overrides with computed `isMirrored`/`source` fields (e.g., user phones in some org-switching scenarios).
- **Cross-entity invariants**: setting a new primary implicitly clears the old primary elsewhere; single-row read-back doesn't surface sibling rows.
- **Joined data**: list entries include computed fields that depend on other tables the RPC didn't touch.

Document the refetch as LEGITIMATE with an inline comment citing the reason. Don't silently keep it — make the intent visible.

## Existing implementations

Three domains currently use this pattern:

| Domain | RPC | VM | Notes |
|--------|-----|-----|-------|
| Roles | `api.update_role` | `RolesViewModel.updateRole` | Composes role + permission_ids; COMPLEX-CASE read-back |
| Client Fields | `api.update_field_definition`, `api.update_field_category` | `ClientFieldSettingsViewModel.updateCustomField`, `.updateCategory` | Reads list-shape with joined category_name/category_slug |
| Users | `api.update_user_phone`, `api.add_user_phone`, `api.update_user`, `manage-user` Edge Function (notification prefs) | `UsersViewModel.updateUserPhone`, `.addUserPhone`, `.updateNotificationPreferences` | First use through an Edge Function path (notification prefs) |

## Related Documentation

- [adr-rpc-readback-pattern.md](../../architecture/decisions/adr-rpc-readback-pattern.md) — Pattern A v2 contract, audit-trail-preservation rationale, error envelope spec
- [event-handler-pattern.md](../../infrastructure/patterns/event-handler-pattern.md) — projection read-back guard at the backend
- [mobx-patterns.md](./mobx-patterns.md) — immutable observable updates
- [logging-standards.md](../../architecture/logging-standards.md) — `log.warn` severity choice for structural regressions
