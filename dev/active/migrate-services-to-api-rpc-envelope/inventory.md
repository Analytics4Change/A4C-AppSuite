# Phase 0 Inventory — Direct `api.*` RPC Call Sites

**Generated**: 2026-05-11 during PR-A planning
**Source of truth**: `frontend/src/services/api/rpc-registry.generated.ts` (M3 enforcement — `EnvelopeRpcs` and `ReadRpcs` string-literal unions emitted from `COMMENT ON FUNCTION api.<name> IS '... @a4c-rpc-shape: envelope|read'` tags)
**Total**: 85 production sites across 11 service files (65 envelope + 20 read; 2 SDK helper definitions and 5 doc-example matches in `services/CLAUDE.md` excluded)

---

## Per-service breakdown

### organization/

#### `SupabaseOrganizationQueryService.ts` (4 read)

| Line | Method | RPC | Shape |
|---|---|---|---|
| 87  | `getOrganizations`         | `get_organizations`         | read |
| 117 | `getOrganizationById`      | `get_organization_by_id`    | read |
| 145 | `getChildOrganizations`    | `get_child_organizations`   | read |
| 177 | `getOrganizationsPaginated`| `get_organizations_paginated` | read |

#### `SupabaseOrganizationCommandService.ts` (4 envelope)

| Line | Method | RPC | Shape |
|---|---|---|---|
| 32  | `updateOrganization`     | `update_organization`     | env |
| 63  | `deactivateOrganization` | `deactivate_organization` | env |
| 90  | `reactivateOrganization` | `reactivate_organization` | env |
| 116 | `deleteOrganization`     | `delete_organization`     | env |

Note: uses `{data: result, error}` destructure variant.

#### `SupabaseOrganizationEntityService.ts` (1 envelope; only real dynamic-name site)

| Line | Method | RPC | Shape |
|---|---|---|---|
| 104 | `callEntityRpc` (private wrapper) | `<dynamic: rpcName>` | env |

The 9 public methods (`createContact`, `updateContact`, `deleteContact`, `createAddress`, `updateAddress`, `deleteAddress`, `createPhone`, `updatePhone`, `deletePhone`) all dispatch to `callEntityRpc` with static literal RPC names. All 9 literals are members of `EnvelopeRpcs`, so re-typing `rpcName: EnvelopeRpcs` keeps the polymorphism while routing through `apiRpcEnvelope`.

#### `SupabaseOrganizationUnitService.ts` (5 envelope + 2 read)

| Line | Method | RPC | Shape |
|---|---|---|---|
| 190 | `getUnits`        | `get_organization_units`         | read |
| 217 | `getUnitById`     | `get_organization_unit_by_id`    | read |
| 277 | `createUnit`      | `create_organization_unit`       | env |
| 350 | `updateUnit`      | `update_organization_unit`       | env |
| 421 | `deactivateUnit`  | `deactivate_organization_unit`   | env |
| 488 | `reactivateUnit`  | `reactivate_organization_unit`   | env |
| 556 | `deleteUnit`      | `delete_organization_unit`       | env |

#### `getOrganizationSubdomainInfo.ts` (1 read, special)

| Line | Method | RPC | Shape | Notes |
|---|---|---|---|---|
| 54-55 | `getOrganizationSubdomainInfo` (top-level fn) | `get_organization_by_id` | read | **`.single<T>()` chained.** Refactor in place per Q5: `apiRpc<Organization[]>(...)` + `data?.[0] ?? null`. UUID lookup makes multi-row case impossible. |

### client-fields/

#### `SupabaseClientFieldService.ts` (13 envelope + 1 read)

| Line | Method | RPC | Shape |
|---|---|---|---|
| 50  | `batchUpdateFieldDefinitions` | `batch_update_field_definitions` | env |
| 72  | `createFieldDefinition`       | `create_field_definition`       | env |
| 100 | `updateFieldDefinition`       | `update_field_definition`       | env |
| 126 | `deactivateFieldDefinition`   | `deactivate_field_definition`   | env |
| 148 | `reactivateFieldDefinition`   | `reactivate_field_definition`   | env |
| 170 | `deleteFieldDefinition`       | `delete_field_definition`       | env |
| 188 | `listFieldCategories`         | `list_field_categories`         | read |
| 208 | `createFieldCategory`         | `create_field_category`         | env |
| 232 | `updateFieldCategory`         | `update_field_category`         | env |
| 255 | `deactivateFieldCategory`     | `deactivate_field_category`     | env |
| 277 | `reactivateFieldCategory`     | `reactivate_field_category`     | env |
| 299 | `deleteFieldCategory`         | `delete_field_category`         | env |
| 317 | `getFieldUsageCount`          | `get_field_usage_count`         | **env** (per registry; service currently does not check `result.success`) |
| 336 | `getCategoryFieldCount`       | `get_category_field_count`     | **env** (per registry; service currently does not check `result.success`) |

The two `get_*_count` envelopes are an architectural note: the service constructs `{success: true, count: result?.count ?? 0}` from raw `result` without validating the envelope's success bit. Migration via `apiRpcEnvelope<{count: number}>` will surface a real failure case if/when the RPC ever returns `success: false`.

Test file `__tests__/SupabaseClientFieldService.test.ts:14-20` mocks `@/lib/supabase` chain directly — refactor to mock the helpers (Q2).

### roles/

#### `SupabaseRoleService.ts` (5 envelope + 8 read)

| Line | Method | RPC | Shape |
|---|---|---|---|
| 284 | `getRoles`                       | `get_roles`                       | read |
| 311 | `getRoleById`                    | `get_role_by_id`                  | read |
| 341 | `getPermissions`                 | `get_permissions`                 | read |
| 365 | `getUserPermissions`             | `get_user_permissions`            | read |
| 402 | `createRole`                     | `create_role`                     | env |
| 486 | `updateRole`                     | `update_role`                     | env |
| 581 | `deactivateRole`                 | `deactivate_role`                 | env |
| 630 | `reactivateRole`                 | `reactivate_role`                 | env |
| 679 | `deleteRole`                     | `delete_role`                     | env |
| 734 | `listUsersForBulkAssignment`     | `list_users_for_bulk_assignment`  | read |
| 787 | `bulkAssignRole`                 | `bulk_assign_role`                | **read** (registry — agent's plan-stage claim of envelope was wrong; method doesn't check `response.success`, treats `data` as bulk-result shape directly) |
| 848 | `listUsersForRoleManagement`     | `list_users_for_role_management`  | read |
| 902 | `syncRoleAssignments`            | `sync_role_assignments`           | **read** (registry — same as `bulk_assign_role`) |

All read methods THROW on error (`throw new Error(...)` after `if (error)`). Migration must preserve throw contract (use `error` from `apiRpc` return tuple).

### schedule/

#### `SupabaseScheduleService.ts` (9 envelope + 2 read)

| Line | Method | RPC | Shape | Notes |
|---|---|---|---|---|
| 64  | `listTemplates`                 | `list_schedule_templates`             | env  | `parseOrThrow` THROWS on `!success` |
| 82  | `getTemplate`                   | `get_schedule_template`               | env  | `parseOrThrow` |
| 118 | `createTemplate`                | `create_schedule_template`            | env  | `parseOrThrow` |
| 143 | `updateTemplate`                | `update_schedule_template`            | env  | `parseOrThrow` |
| 162 | `deactivateTemplate`            | `deactivate_schedule_template`        | env  | `parseOrThrow` |
| 179 | `reactivateTemplate`            | `reactivate_schedule_template`        | env  | `parseOrThrow` |
| 198 | `deleteTemplate`                | `delete_schedule_template`            | env  | `parseRpcResult` — RETURNS on `!success` |
| 238 | `assignUser`                    | `assign_user_to_schedule`             | env  | `parseOrThrow` |
| 267 | `unassignUser`                  | `unassign_user_from_schedule`         | env  | `parseOrThrow` |
| 290 | `listUsersForScheduleManagement`| `list_users_for_schedule_management`  | read | array data |
| 326 | `syncScheduleAssignments`       | `sync_schedule_assignments`           | read | array data |

Throw-vs-return split per Q6: methods using `parseOrThrow` keep throwing (`if (!env.success) throw new Error(env.error)`); `deleteTemplate` (using `parseRpcResult`) keeps returning.

### clients/

#### `SupabaseClientService.ts` (25 envelope)

All 25 sites are writes routed through local `parseResponse(data)` helper which is mechanically replaced by direct `apiRpcEnvelope<T>` consumption. RPCs: `list_clients`, `get_client`, `register_client`, `update_client`, `admit_client`, `discharge_client`, `add_client_phone`, `update_client_phone`, `remove_client_phone`, `add_client_email`, `update_client_email`, `remove_client_email`, `add_client_address`, `update_client_address`, `remove_client_address`, `add_client_insurance`, `update_client_insurance`, `remove_client_insurance`, `change_client_placement`, `end_client_placement`, `add_client_funding_source`, `update_client_funding_source`, `remove_client_funding_source`, `assign_client_contact`, `unassign_client_contact`. (Note: `list_clients` and `get_client` are in `EnvelopeRpcs` per registry — same Pattern A v2 read envelope variant as Schedule's list/get.)

### direct-care/

#### `SupabaseDirectCareSettingsService.ts` (1 envelope + 1 read)

| Line | Method | RPC | Shape | Notes |
|---|---|---|---|---|
| 28-29  | `getSettings`    | `get_organization_direct_care_settings`    | read | multi-line chained `.schema('api')\n.rpc(...)` |
| 65-66+ | `updateSettings` | `update_organization_direct_care_settings` | env  | multi-line chained; **L84-95 has legacy/v2 dual-shape parse** — confirm v1 path is dead before deleting |

### assignment/

#### `SupabaseAssignmentService.ts` (2 envelope + 1 read)

| Line | Method | RPC | Shape | Notes |
|---|---|---|---|---|
| 29  | `listUserClientAssignments` | `list_user_client_assignments` | **env** (per registry — Pattern A v2 read envelope variant) | multi-line chained |
| 61  | `assignClientToUser`        | `assign_client_to_user`        | env  | multi-line chained |
| 93  | `unassignClientFromUser`    | `unassign_client_from_user`    | env  | multi-line chained |

### auth/ (SDK helpers — excluded from migration)

#### `supabase.service.ts` (2 helper definitions)

| Line | Method | RPC | Shape | Status |
|---|---|---|---|---|
| 126 | `apiRpc<T>` | `<dynamic: functionName: ReadRpcs>` | read | **must not migrate** — implements the boundary |
| 167 | `apiRpcEnvelope<T>` | `<dynamic: functionName: EnvelopeRpcs>` | env | **must not migrate** — implements the boundary |

### Excluded: documentation examples

`services/CLAUDE.md` contains 5 `.schema('api').rpc(` matches in code examples — these are doc snippets, not call sites.

---

## Aggregate totals

| Service | Env | Read | Total |
|---|---:|---:|---:|
| OrgQuery | 0 | 4 | 4 |
| OrgCommand | 4 | 0 | 4 |
| OrgEntity | 1 | 0 | 1 |
| OrgUnit | 5 | 2 | 7 |
| OrgSubdomain | 0 | 1 | 1 |
| ClientFields | 13 | 1 | 14 |
| Roles | 5 | 8 | 13 |
| Schedule | 9 | 2 | 11 |
| Clients | 25 | 0 | 25 |
| DirectCare | 1 | 1 | 2 |
| Assignment | 2 | 1 | 3 |
| **TOTAL** | **65** | **20** | **85** |

---

## Already-migrated services (no work)

These services already consume `supabaseService.apiRpc` / `apiRpcEnvelope`:

- `frontend/src/services/users/SupabaseUserCommandService.ts` (migrated by PR #44)
- `frontend/src/services/users/SupabaseUserQueryService.ts`
- `frontend/src/services/admin/EventMonitoringService.ts`
- `frontend/src/services/admin/OrphanedDeletionService.ts`

---

## PR scope

- **PR-A pilots (14 sites)**: OrgEntity (1 env) + Roles (5 env + 8 read = 13)
- **PR-B bulk (41 sites)**: OrgCommand (4) + OrgUnit (5+2) + ClientFields (13+1) + Schedule (9+2) + DirectCare (1+1) + Assignment (2+1)
- **PR-C closeout (30 sites + rule)**: Clients (25) + OrgQuery (4) + OrgSubdomain (1 — refactor in place) + activate ESLint rule

## Open question resolutions

Documented in the plan file (`~/.claude/plans/ddoes-it-make-sense-lucky-dongarra.md`). Summarized:

- **Q1 dynamic names**: `rpcName: EnvelopeRpcs` on Entity wrapper
- **Q2 test mocks**: refactor `SupabaseClientFieldService.test.ts` to helper-mock pattern
- **Q3 dead imports**: drop `@/lib/supabase` per file if unused
- **Q4 lint lifecycle**: accept the window — rule activates only in PR-C
- **Q5 `.single<T>()`**: refactor in place to `apiRpc<T[]>` + `[0] ?? null`
- **Q6 Schedule throw/return**: preserve throw-on-`!success` for `parseOrThrow` methods
- **Q7 selector scope**: matches any `.schema(*).rpc(...)`; comment notes today's assumption that no `public` schema calls exist
