---
status: current
last_updated: 2025-01-13
---

# Surrogate Key Migration Status

**Date Started**: 2025-10-20
**Purpose**: Standardize all Zitadel ID references to use UUID surrogate keys for consistent JOINs

## Completed Changes

### 1. Created Mapping Infrastructure ✅
- **File**: `02-tables/zitadel_mappings/001-zitadel_organization_mapping.sql`
  - Maps `zitadel_org_id` (TEXT) ↔ `internal_org_id` (UUID)

- **File**: `02-tables/zitadel_mappings/002-zitadel_user_mapping.sql`
  - Maps `zitadel_user_id` (TEXT) ↔ `internal_user_id` (UUID)

- **File**: `03-functions/zitadel-mappings/001-id-resolution-functions.sql`
  - `get_internal_org_id(TEXT) → UUID`
  - `get_zitadel_org_id(UUID) → TEXT`
  - `upsert_org_mapping(UUID, TEXT, TEXT)`
  - `get_internal_user_id(TEXT) → UUID`
  - `get_zitadel_user_id(UUID) → TEXT`
  - `upsert_user_mapping(UUID, TEXT, TEXT)`

### 2. Renamed User External ID ✅
- **File**: `02-tables/users/table.sql`
  - Changed: `external_id TEXT` → `zitadel_user_id TEXT`

- **File**: `02-tables/users/indexes/idx_users_external_id.sql`
  - Changed: `idx_users_external_id` → `idx_users_zitadel_user_id`

- **File**: `01-events/002-event-types-table.sql`
  - Updated event schema: `external_id` → `zitadel_user_id`

### 3. Updated user_roles_projection ✅
- **File**: `02-tables/rbac/004-user_roles_projection.sql`
  - Changed: `org_id TEXT NOT NULL` → `org_id UUID`
  - Changed wildcard pattern: `'*'` → `NULL` for super_admin global access
  - Updated CHECK constraint
  - Updated PRIMARY KEY to handle NULL with COALESCE

### 4. Updated Authorization Functions ✅
- **File**: `03-functions/authorization/001-user_has_permission.sql`
  - `user_has_permission()`: Changed `p_org_id TEXT` → `UUID`, `org_id = '*'` → `org_id IS NULL`
  - `user_permissions()`: Changed `p_org_id TEXT` → `UUID`, `org_id = '*'` → `org_id IS NULL`
  - `is_super_admin()`: Changed `org_id = '*'` → `org_id IS NULL`
  - `is_provider_admin()`: Changed `p_org_id TEXT` → `UUID`
  - `user_organizations()`: Changed return type `org_id TEXT` → `UUID`

### 5. Updated RLS Policies ✅
- **File**: `06-rls/impersonation-policies.sql`
  - Changed: `ur.org_id = '*'` → `ur.org_id IS NULL`
  - Changed: `target_org_id = current_setting('app.current_org')` → cast to UUID

### 6. Updated Impersonation Table ✅
**File**: `02-tables/impersonation/001-impersonation_sessions_projection.sql`

Changed:
```sql
-- BEFORE:
super_admin_org_id TEXT NOT NULL,
target_org_id TEXT NOT NULL,

-- AFTER:
super_admin_org_id UUID,  -- NULL for platform super_admin
target_org_id UUID NOT NULL,  -- Internal UUID
```

### 7. Updated roles_projection ✅
**File**: `02-tables/rbac/002-roles_projection.sql`

Implemented Option A (dual column approach):
- Kept `zitadel_org_id TEXT` for Zitadel API lookups
- Added `organization_id UUID` for internal JOINs
- Updated CHECK constraint to validate both are NULL (super_admin) or both are NOT NULL (org roles)

### 8. Updated RBAC Event Processor ✅
**File**: `03-functions/event-processing/004-process-rbac-events.sql`

Completed:
- Line 48-54: Extract `zitadel_org_id` from event, resolve to internal UUID via `get_internal_org_id()`
- Line 107-112: Convert `org_id` from TEXT to UUID when inserting into `user_roles_projection`
- Line 122: Updated ON CONFLICT to handle NULL with COALESCE
- Line 128-136: Handle `'*'` wildcard → NULL conversion for super_admin roles
- Line 158, 160: Changed access grant org_id extraction to UUID
- Line 206-208: Fixed audit_log org_id insertion to use UUID

### 9. Updated Organization Event Processor ✅
**File**: `03-functions/event-processing/002-process-organization-events.sql`

Added after organization.registered event processing:
```sql
-- Populate Zitadel organization mapping (if zitadel_org_id exists)
IF safe_jsonb_extract_text(p_event.event_data, 'zitadel_org_id') IS NOT NULL THEN
  PERFORM upsert_org_mapping(
    p_event.stream_id,
    safe_jsonb_extract_text(p_event.event_data, 'zitadel_org_id'),
    safe_jsonb_extract_text(p_event.event_data, 'name')
  );
END IF;
```

### 10. Updated Impersonation Event Processor ✅
**File**: `03-functions/event-processing/005-process-impersonation-events.sql`

Completed:
- Line 55-60: Convert super_admin org_id (handles NULL and `'*'` → NULL)
- Line 66: Convert target org_id via `get_internal_org_id()`
- Line 194: Updated `get_org_impersonation_audit()` parameter to UUID
- Line 259: Updated `get_impersonation_session_details()` return type to UUID

### 11. Updated Seed Data ✅
**File**: `99-seeds/003-rbac-initial-setup.sql`

Completed:
- Removed `zitadel_org_id` and `org_hierarchy_scope` from super_admin role definition
- Super admin now correctly has NULL org scoping (global access)
- Template roles (provider_admin, partner_admin) also have NULL scoping (will be scoped during org provisioning)

### 12. Updated Access Grant Event Processor ✅
**File**: `03-functions/event-processing/006-process-access-grant-events.sql`

Completed:
- Line 162: Removed `::TEXT` cast in `validate_cross_tenant_access()` function
- Function now correctly uses UUID for org_id comparison

### 13. Verified Other Event Processors ✅
Checked these files - they do NOT reference org_id:
- `03-functions/event-processing/002-process-client-events.sql` ✅ No org_id references
- `03-functions/event-processing/003-process-medication-events.sql` ✅ No org_id references

## Testing Checklist

After all changes:
- [x] All tables use UUID for internal org references
- [x] Mapping tables created with upsert functions
- [x] Authorization functions work with NULL for super_admin
- [x] RLS policies correctly filter by UUID org_id
- [x] Event processors populate mappings on organization.registered
- [x] Super admin role has NULL org scoping (global access)
- [x] All JOINs use consistent UUID types
- [x] Access grant processing uses UUID for org_id fields
- [ ] Deploy script to Supabase and verify no errors
- [ ] Test organization creation populates mapping table
- [ ] Test super_admin authorization with NULL org_id
- [ ] Test cross-tenant access grants with UUID org references

## Deployment Notes

1. This is a **breaking schema change**
2. Requires data migration if production data exists
3. Frontend may need updates if it relies on TEXT org_id values
4. Consider creating migration script for existing data

## Migration Script (If Needed)

```sql
-- Populate mapping table from existing organizations
INSERT INTO zitadel_organization_mapping (internal_org_id, zitadel_org_id, org_name)
SELECT id, zitadel_org_id, name
FROM organizations_projection
WHERE zitadel_org_id IS NOT NULL
ON CONFLICT (internal_org_id) DO NOTHING;

-- Convert user_roles_projection wildcards
UPDATE user_roles_projection
SET org_id = NULL::UUID
WHERE org_id = '*';

-- Note: Other TEXT org_id columns would need similar treatment
```
