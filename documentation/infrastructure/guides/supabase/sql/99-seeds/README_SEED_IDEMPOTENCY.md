---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Guide for making seed files idempotent using conditional INSERT with DO blocks, preserving event sourcing patterns while preventing duplicate events on re-execution.

**When to read**:
- Creating or updating seed data files
- Fixing duplicate event issues in migrations
- Understanding event-sourcing idempotency patterns
- Testing seed file re-execution safety

**Prerequisites**: [TEST_SQL_IDEMPOTENCY.md](../../TEST_SQL_IDEMPOTENCY.md)

**Key topics**: `seed-idempotency`, `conditional-insert`, `event-sourcing`, `duplicate-prevention`, `migration-safety`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# Seed Data Idempotency Guide

## Status

**Current**: Seed files use `gen_random_uuid()` which creates duplicate events on re-execution
**Target**: Idempotent seed execution using conditional inserts

## Recommended Approach: Conditional Event Insertion

For event-sourced seed data (domain_events table), we use conditional INSERT with DO blocks:

```sql
DO $$
BEGIN
  -- Only insert if this permission doesn't already exist
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'create_root'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(),
      'permission',
      1,
      'permission.defined',
      '{"applet": "organization", "action": "create_root", ...}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", ...}'::jsonb
    );
  END IF;
END $$;
```

## Why This Approach?

1. **Idempotent**: Can run multiple times safely
2. **Event Integrity**: Preserves event sourcing patterns (random UUIDs per event)
3. **Flexible**: Each event has unique stream_id (correct for event sourcing)
4. **Maintainable**: Easy to understand and modify

## Alternative: Fixed UUIDs (Not Recommended for Events)

```sql
-- ❌ Not recommended for event sourcing
INSERT INTO domain_events (stream_id, ...)
VALUES ('11111111-0000-0000-0000-000000000001'::UUID, ...)
ON CONFLICT (stream_id) DO NOTHING;
```

**Why not?** In event sourcing, `stream_id` represents the aggregate ID (e.g., permission ID), not a unique seed identifier. Using fixed UUIDs would violate event sourcing principles.

## Files to Update

### High Priority (Contains gen_random_uuid)
- ✅ 001-minimal-permissions.sql (22 permissions) - **UPDATED**
- ✅ 003-rbac-initial-setup.sql (12 permissions) - **UPDATED**
- ✅ 004-organization-permissions-setup.sql (8 permissions) - **UPDATED**

### Low Priority (Already idempotent or manual-only)
- ✅ 002-bootstrap-org-roles.sql (no gen_random_uuid)
- ✅ 003-grant-super-admin-permissions.sql (no gen_random_uuid)
- ✅ 004-lars-tice-bootstrap.sql (personal bootstrap, manual only)

## Testing Idempotency

### Automated Testing

Use the comprehensive test script:

```bash
cd infrastructure/supabase

# Set environment variables
export SUPABASE_URL="https://yourproject.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Run automated test
./test-idempotency.sh
```

See `TEST_SQL_IDEMPOTENCY.md` for complete testing guide with manual verification steps.

### Manual Testing

```bash
# Run seed file twice
psql -f infrastructure/supabase/sql/99-seeds/001-minimal-permissions.sql
psql -f infrastructure/supabase/sql/99-seeds/001-minimal-permissions.sql

# Check event count (should be same)
psql -c "SELECT COUNT(*) FROM domain_events WHERE event_type = 'permission.defined';"
# Expected: 22 (not 44)
```

## Implementation Notes

### For Permission Events
Check combination of `applet` + `action`:
```sql
WHERE event_type = 'permission.defined'
  AND event_data->>'applet' = 'organization'
  AND event_data->>'action' = 'create_root'
```

### For Role Events
Check `role_name`:
```sql
WHERE event_type = 'role.defined'
  AND event_data->>'name' = 'super_admin'
```

### For Role Permission Assignments
Check `role_id` + `permission_id` combination:
```sql
WHERE event_type = 'role.permission_assigned'
  AND event_data->>'role_id' = '...'
  AND event_data->>'permission_id' = '...'
```

## Migration Strategy

1. ✅ Update 001-minimal-permissions.sql first (most critical)
2. ✅ Update 003-rbac-initial-setup.sql
3. ✅ Update 004-organization-permissions-setup.sql
4. Test on development database
5. Add to CI/CD workflow
6. Deploy to production

## Status

- **Triggers**: ✅ Fixed (3/3 files updated)
- **Seed Data**: ✅ Fixed (3/3 files updated)
- **Testing**: ⏸️ Pending
