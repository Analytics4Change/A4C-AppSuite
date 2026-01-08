---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection enabling cross-organization data access for provider_partner orgs (VAR contracts, court orders, social services). Time-bound, scope-limited grants with full audit trail. Supports statuses: active, revoked, expired, suspended. RLS enabled but policies NOT YET IMPLEMENTED - CRITICAL GAP.

**When to read**:
- Implementing VAR (Vendor Authorized Representative) access
- Building cross-tenant authorization checks
- Managing court-ordered or emergency access scenarios
- Understanding provider_partner → provider data sharing model

**Prerequisites**: [organizations_projection](./organizations_projection.md), [users](./users.md)

**Key topics**: `cross-tenant`, `access-grants`, `var-contracts`, `provider-partner`, `authorization`, `compliance`, `rls-gap`

**Estimated read time**: 20 minutes
<!-- TL;DR-END -->

# cross_tenant_access_grants_projection

## Overview

The `cross_tenant_access_grants_projection` table is a **CQRS read model** that enables secure, auditable cross-organization data access. This table supports business scenarios where `provider_partner` organizations (consultants, auditors, social services) require controlled access to `provider` organization data. Each grant represents a legally authorized, time-bound, scope-limited access delegation with full audit trail tracking.

**Primary Use Case**: VAR (Vendor Authorized Representative) contracts, court-ordered access, social services oversight, emergency access scenarios.

**Data Sensitivity**: RESTRICTED (legal authorization records, cross-tenant access control)
**CQRS Role**: Read model projection (event-sourced)
**Multi-Tenancy**: Cross-tenant access management (bridge between organizations)

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | - | Primary key (grant identifier) |
| consultant_org_id | uuid | NO | - | provider_partner organization requesting access |
| consultant_user_id | uuid | YES | NULL | Specific user (NULL for org-wide grant) |
| provider_org_id | uuid | NO | - | Target provider organization owning data |
| scope | text | NO | - | Access scope level (full_org, facility, program, client_specific) |
| scope_id | uuid | YES | NULL | Specific resource UUID for scoped access |
| authorization_type | text | NO | - | Legal basis (var_contract, court_order, parental_consent, etc.) |
| legal_reference | text | YES | NULL | Reference to legal document/contract |
| granted_by | uuid | NO | - | User who authorized the grant |
| granted_at | timestamptz | NO | - | Grant creation timestamp |
| expires_at | timestamptz | YES | NULL | Expiration timestamp (NULL for indefinite) |
| permissions | jsonb | YES | '[]' | Specific permissions granted |
| terms | jsonb | YES | '{}' | Additional terms (read_only, data_retention_days) |
| status | text | NO | 'active' | Current status (active, revoked, expired, suspended) |
| revoked_at | timestamptz | YES | NULL | Permanent revocation timestamp |
| revoked_by | uuid | YES | NULL | User who revoked the grant |
| revocation_reason | text | YES | NULL | Reason for revocation |
| revocation_details | text | YES | NULL | Detailed revocation explanation |
| expired_at | timestamptz | YES | NULL | When grant expired (auto or manual) |
| expiration_type | text | YES | NULL | How grant expired (auto, manual) |
| suspended_at | timestamptz | YES | NULL | Temporary suspension timestamp |
| suspended_by | uuid | YES | NULL | User who suspended the grant |
| suspension_reason | text | YES | NULL | Reason for suspension |
| suspension_details | text | YES | NULL | Detailed suspension explanation |
| expected_resolution_date | timestamptz | YES | NULL | Expected suspension resolution date |
| reactivated_at | timestamptz | YES | NULL | When grant was reactivated from suspension |
| reactivated_by | uuid | YES | NULL | User who reactivated the grant |
| resolution_details | text | YES | NULL | Suspension resolution explanation |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | NO | now() | Record last update timestamp |

### Column Details

#### id
- **Type**: `uuid`
- **Purpose**: Unique identifier for each access grant
- **Generation**: Assigned from domain event payload
- **Constraints**: PRIMARY KEY
- **Usage**: Grant reference in audit logs, API responses

#### consultant_org_id
- **Type**: `uuid`
- **Purpose**: Requesting `provider_partner` organization
- **Constraints**: NOT NULL
- **Foreign Key**: References `organizations_projection(id)` (implicit)
- **Index**: `idx_access_grants_consultant_org` (BTREE)
- **Examples**: VAR company UUID, social services agency UUID, audit firm UUID

#### consultant_user_id
- **Type**: `uuid`
- **Purpose**: Specific user within consultant org (NULL for org-wide grant)
- **Nullable**: YES
- **Index**: `idx_access_grants_consultant_user` (partial WHERE NOT NULL)
- **Granularity**:
  - `NULL` - All users in consultant_org have access
  - `<uuid>` - Only specific user has access
- **Use Case**: Limit access to specific consultant, not entire organization

#### provider_org_id
- **Type**: `uuid`
- **Purpose**: Target `provider` organization owning the data
- **Constraints**: NOT NULL
- **Foreign Key**: References `organizations_projection(id)` (implicit)
- **Index**: `idx_access_grants_provider_org` (BTREE)
- **Security**: Provider org must explicitly authorize grant

#### scope
- **Type**: `text`
- **Purpose**: Hierarchical access scope level
- **Constraints**: CHECK constraint enforces enum values
- **Valid Values**:
  - `'full_org'` - Complete organization access (all facilities, programs, clients)
  - `'facility'` - Specific facility access
  - `'program'` - Specific program access
  - `'client_specific'` - Individual client access only
- **Index**: `idx_access_grants_scope` (BTREE)
- **Least Privilege**: Prefer narrower scopes (client > program > facility > org)

#### scope_id
- **Type**: `uuid`
- **Purpose**: Specific resource UUID for scoped access (NULL for full_org)
- **Nullable**: YES
- **CHECK Constraint**: Required for facility/program/client scopes
- **Examples**:
  - `full_org` → scope_id = NULL
  - `facility` → scope_id = facility UUID
  - `program` → scope_id = program UUID
  - `client_specific` → scope_id = client UUID

#### authorization_type
- **Type**: `text`
- **Purpose**: Legal/business basis for access grant
- **Constraints**: CHECK constraint enforces enum values
- **Valid Values**:
  - `'var_contract'` - Vendor Authorized Representative contract
  - `'court_order'` - Court-mandated access
  - `'parental_consent'` - Parent/guardian authorization
  - `'social_services_assignment'` - Social services case assignment
  - `'emergency_access'` - Emergency/crisis access (time-limited)
- **Index**: `idx_access_grants_authorization_type` (BTREE)
- **Compliance**: Documents legal basis for HIPAA/GDPR compliance

#### legal_reference
- **Type**: `text`
- **Purpose**: Reference to legal document authorizing access
- **Nullable**: YES (recommended for all grants)
- **Examples**:
  - `'VAR Contract #2025-ABC-001'`
  - `'Court Order Case #12345, Superior Court, County of XYZ'`
  - `'Parental Consent Form dated 2025-01-13, Client ID: 789'`
  - `'Emergency Access Protocol 2025-01-13T14:30:00Z'`
- **Audit**: Critical for compliance audits and legal defense

#### granted_by
- **Type**: `uuid`
- **Purpose**: User who authorized the access grant
- **Constraints**: NOT NULL
- **Foreign Key**: References `users(id)` (implicit)
- **Index**: `idx_access_grants_granted_by` (composite with granted_at)
- **Audit**: Who made the authorization decision
- **Compliance**: Required for HIPAA "minimum necessary" standard documentation

#### granted_at
- **Type**: `timestamptz`
- **Purpose**: When grant was created
- **Constraints**: NOT NULL
- **Usage**: Audit trail, temporal access tracking
- **Compliance**: Legal requirement for access log retention

#### expires_at
- **Type**: `timestamptz`
- **Purpose**: Expiration timestamp for time-limited grants
- **Nullable**: YES (NULL for indefinite grants)
- **Index**: `idx_access_grants_expires` (composite with status, partial)
- **Cleanup**: Automated expiration process monitors this field
- **Best Practice**: Always set expiration for emergency/court-ordered access

#### permissions
- **Type**: `jsonb`
- **Purpose**: Specific permissions granted (overrides default for authorization_type)
- **Default**: `'[]'::JSONB`
- **Schema**:
```typescript
type PermissionsArray = string[];  // Permission names: ['clients.view', 'medications.view']
```
- **Usage**: Grant subset of permissions rather than full role
- **Example**: `['clients.view', 'medications.view']` (read-only access)

#### terms
- **Type**: `jsonb`
- **Purpose**: Additional grant terms and conditions
- **Default**: `'{}'::JSONB`
- **Schema**:
```typescript
interface GrantTerms {
  read_only?: boolean;                  // Prohibit updates/deletes
  data_retention_days?: number;          // Data retention limit
  notification_required?: boolean;       // Notify provider org on access
  audit_required?: boolean;              // Enhanced audit logging
  allowed_ip_ranges?: string[];         // IP whitelist
  allowed_time_windows?: Array<{        // Time-based access restrictions
    start: string;  // '09:00'
    end: string;    // '17:00'
    timezone: string;
  }>;
}
```
- **Compliance**: Implements "minimum necessary" and "least privilege" principles

#### status
- **Type**: `text`
- **Purpose**: Current grant status
- **Constraints**: CHECK constraint enforces enum values
- **Valid Values**:
  - `'active'` - Grant is currently valid and usable
  - `'revoked'` - Permanently revoked (cannot be reactivated)
  - `'expired'` - Expired (passed expires_at timestamp or manual expiration)
  - `'suspended'` - Temporarily suspended (can be reactivated)
- **Default**: `'active'`
- **Index**: `idx_access_grants_status` (BTREE)
- **State Machine**:
  ```
  active → revoked (permanent)
  active → expired (time-based or manual)
  active → suspended → reactivated (active)
  suspended → revoked (permanent)
  suspended → expired
  ```

#### revoked_at / revoked_by / revocation_reason / revocation_details
- **Purpose**: Permanent revocation audit trail
- **Pattern**: Revocation is irreversible (no reactivation from revoked state)
- **Use Cases**:
  - Contract termination
  - Security breach
  - Misuse of access
  - Provider org withdrawal of consent
- **Compliance**: Required for access termination audit trail

#### expired_at / expiration_type
- **Purpose**: Expiration audit trail (auto or manual)
- **Expiration Types**:
  - `'auto'` - Automatic expiration via scheduled job (expires_at reached)
  - `'manual'` - Manual expiration by administrator
- **Use Case**: Time-limited emergency access, court order duration compliance

#### suspended_at / suspended_by / suspension_reason / suspension_details / expected_resolution_date
- **Purpose**: Temporary suspension audit trail
- **Pattern**: Suspension is reversible (can be reactivated)
- **Use Cases**:
  - Investigation of access misuse
  - Temporary legal hold
  - Provider org data freeze
  - Renewal pending (administrative delay)
- **Index**: `idx_access_grants_suspended` (partial WHERE suspended)
- **Monitoring**: Expected resolution date triggers alerts for overdue suspensions

#### reactivated_at / reactivated_by / resolution_details
- **Purpose**: Reactivation from suspension audit trail
- **Pattern**: Reactivation returns grant to active status
- **Use Case**: Investigation concluded, legal hold lifted, renewal completed

#### created_at / updated_at
- **Purpose**: Record lifecycle timestamps
- **Default**: `now()`
- **Usage**: Audit trail, change tracking

## Relationships

### Parent Relationships (Foreign Keys)

- **organizations_projection** → `consultant_org_id`
  - Requesting provider_partner organization
  - Implicit foreign key (not enforced)

- **organizations_projection** → `provider_org_id`
  - Target provider organization owning data
  - Implicit foreign key (not enforced)

- **users** → `consultant_user_id`
  - Specific user (if grant is user-scoped)
  - Implicit foreign key (not enforced)

- **users** → `granted_by`, `revoked_by`, `suspended_by`, `reactivated_by`
  - Audit trail user references
  - Implicit foreign keys (not enforced)

### Child Relationships (Referenced By)

**None** - This is a pure access control table

## Indexes

| Index Name | Type | Columns | Purpose | Notes |
|------------|------|---------|---------|-------|
| PRIMARY KEY | BTREE | id | Unique identification | Automatic |
| idx_access_grants_consultant_org | BTREE | consultant_org_id | Find grants for consultant | Common query |
| idx_access_grants_consultant_user | BTREE (partial) | consultant_user_id WHERE NOT NULL | User-scoped grants | Partial index |
| idx_access_grants_provider_org | BTREE | provider_org_id | Find grants to provider | Common query |
| idx_access_grants_scope | BTREE | scope | Filter by scope level | Audit queries |
| idx_access_grants_authorization_type | BTREE | authorization_type | Filter by legal basis | Compliance reports |
| idx_access_grants_status | BTREE | status | Filter by status | Active grants lookup |
| idx_access_grants_lookup | BTREE | (consultant_org_id, provider_org_id, status) WHERE status = 'active' | Authorization check | Critical path optimization |
| idx_access_grants_expires | BTREE | (expires_at, status) WHERE expires_at IS NOT NULL AND status IN ('active', 'suspended') | Expiration monitoring | Cleanup jobs |
| idx_access_grants_suspended | BTREE | expected_resolution_date WHERE status = 'suspended' | Suspension monitoring | Alert generation |
| idx_access_grants_granted_by | BTREE | (granted_by, granted_at) | Audit by grantor | Compliance audits |

### Index Usage Patterns

**Authorization Check (Critical Path)**:
```sql
SELECT *
FROM cross_tenant_access_grants_projection
WHERE consultant_org_id = '<consultant-uuid>'
  AND provider_org_id = '<provider-uuid>'
  AND status = 'active'
  AND (consultant_user_id IS NULL OR consultant_user_id = '<user-uuid>')
  AND (expires_at IS NULL OR expires_at > NOW());
-- Uses: idx_access_grants_lookup (optimized for active grants)
```

**Find Expiring Grants**:
```sql
SELECT id, provider_org_id, expires_at
FROM cross_tenant_access_grants_projection
WHERE expires_at < NOW() + INTERVAL '7 days'
  AND status IN ('active', 'suspended')
ORDER BY expires_at;
-- Uses: idx_access_grants_expires
```

**Compliance Audit by Grantor**:
```sql
SELECT
  provider_org_id,
  consultant_org_id,
  authorization_type,
  granted_at
FROM cross_tenant_access_grants_projection
WHERE granted_by = '<user-uuid>'
ORDER BY granted_at DESC;
-- Uses: idx_access_grants_granted_by
```

## Row-Level Security (RLS)

**Status**: ⚠️ ENABLED but **NO POLICIES DEFINED** - CRITICAL GAP

### Current State
```sql
ALTER TABLE cross_tenant_access_grants_projection ENABLE ROW LEVEL SECURITY;
-- RLS is enabled but NO policies exist
-- Result: Table is COMPLETELY BLOCKED for non-superuser access
```

### Recommended Policies (NOT YET IMPLEMENTED)

**Policy 1: Super Admin Full Access**
```sql
CREATE POLICY access_grants_super_admin_all
  ON cross_tenant_access_grants_projection FOR ALL
  USING (is_super_admin(get_current_user_id()));
```

**Policy 2: Consultant Organization View Own Grants**
```sql
CREATE POLICY access_grants_consultant_view
  ON cross_tenant_access_grants_projection FOR SELECT
  USING (
    consultant_org_id = (current_setting('request.jwt.claims', true)::json->>'org_id')::UUID
    OR is_super_admin(get_current_user_id())
  );
```

**Policy 3: Provider Organization View Grants to Them**
```sql
CREATE POLICY access_grants_provider_view
  ON cross_tenant_access_grants_projection FOR SELECT
  USING (
    provider_org_id = (current_setting('request.jwt.claims', true)::json->>'org_id')::UUID
    OR is_super_admin(get_current_user_id())
  );
```

**Policy 4: Provider Admin Can Grant/Revoke**
```sql
CREATE POLICY access_grants_provider_manage
  ON cross_tenant_access_grants_projection FOR ALL
  USING (
    provider_org_id = get_current_org_id()
    AND has_org_admin_permission()
  );
```

### CRITICAL ACTION REQUIRED
**RLS policies MUST be implemented before production use. Current state blocks all access.**

## Constraints

### Check Constraint: Scope Requires scope_id
```sql
CHECK (
  (scope = 'full_org' AND scope_id IS NULL)
  OR
  (scope IN ('facility', 'program', 'client_specific') AND scope_id IS NOT NULL)
)
```
- **Purpose**: Scoped grants must specify target resource
- **Validation**: Prevents grants with missing scope details

### Check Constraint: status Enum
```sql
CHECK (status IN ('active', 'revoked', 'expired', 'suspended'))
```
- **Purpose**: Enforces valid status values
- **State Machine**: Application enforces state transitions

### Check Constraint: scope Enum
```sql
CHECK (scope IN ('full_org', 'facility', 'program', 'client_specific'))
```

### Check Constraint: authorization_type Enum
```sql
CHECK (authorization_type IN ('var_contract', 'court_order', 'parental_consent', 'social_services_assignment', 'emergency_access'))
```

## CQRS Event Sourcing

### Source Events

**Event Types**:
1. `access_grant.created` - New cross-tenant access grant
2. `access_grant.revoked` - Permanent revocation
3. `access_grant.expired` - Manual or automatic expiration
4. `access_grant.suspended` - Temporary suspension
5. `access_grant.reactivated` - Reactivation from suspension

**Event Payload (access_grant.created)**:
```typescript
{
  event_type: 'access_grant.created',
  aggregate_id: '<grant-uuid>',
  aggregate_type: 'access_grant',
  payload: {
    id: '<grant-uuid>',
    consultant_org_id: '<provider_partner-uuid>',
    consultant_user_id: '<user-uuid>' | null,
    provider_org_id: '<provider-uuid>',
    scope: 'full_org' | 'facility' | 'program' | 'client_specific',
    scope_id: '<resource-uuid>' | null,
    authorization_type: 'var_contract' | 'court_order' | ...,
    legal_reference: 'Contract #2025-001',
    granted_by: '<admin-uuid>',
    granted_at: '2025-01-13T10:30:00Z',
    expires_at: '2025-12-31T23:59:59Z' | null,
    permissions: ['clients.view', 'medications.view'],
    terms: { read_only: true, audit_required: true }
  },
  metadata: {
    user_id: '<admin-uuid>',
    correlation_id: '<uuid>'
  }
}
```

### Event Processor

**Function**: `process_access_grant_events()` and `process_rbac_events()`

**Location**: `infrastructure/supabase/sql/03-functions/event-processing/006-process-access-grant-events.sql`

**Processing Logic**: INSERT for created, UPDATE for status changes

**Idempotency**: `ON CONFLICT (id) DO UPDATE` for all events

**Trigger**: Executed automatically via `process_domain_event_trigger`

## Common Queries

### Find Active Grants for Consultant Organization
```sql
SELECT
  ctag.id,
  p_org.name as provider_name,
  ctag.scope,
  ctag.authorization_type,
  ctag.expires_at
FROM cross_tenant_access_grants_projection ctag
JOIN organizations_projection p_org ON p_org.id = ctag.provider_org_id
WHERE ctag.consultant_org_id = '<consultant-uuid>'
  AND ctag.status = 'active'
  AND (ctag.expires_at IS NULL OR ctag.expires_at > NOW())
ORDER BY p_org.name;
```

### Authorization Check for Cross-Tenant Access
```sql
-- Check if consultant org/user has access to provider org
SELECT EXISTS (
  SELECT 1
  FROM cross_tenant_access_grants_projection
  WHERE consultant_org_id = '<consultant-uuid>'
    AND (consultant_user_id IS NULL OR consultant_user_id = '<user-uuid>')
    AND provider_org_id = '<provider-uuid>'
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > NOW())
) AS has_access;
```

### Find Grants Expiring Soon
```sql
SELECT
  ctag.id,
  c_org.name as consultant_name,
  p_org.name as provider_name,
  ctag.authorization_type,
  ctag.expires_at,
  EXTRACT(epoch FROM (ctag.expires_at - NOW())) / 86400 as days_remaining
FROM cross_tenant_access_grants_projection ctag
JOIN organizations_projection c_org ON c_org.id = ctag.consultant_org_id
JOIN organizations_projection p_org ON p_org.id = ctag.provider_org_id
WHERE ctag.expires_at < NOW() + INTERVAL '30 days'
  AND ctag.status IN ('active', 'suspended')
ORDER BY ctag.expires_at;
```

### Compliance Audit: All Grants by Authorization Type
```sql
SELECT
  authorization_type,
  COUNT(*) as total_grants,
  SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_grants,
  SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END) as revoked_grants,
  SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired_grants
FROM cross_tenant_access_grants_projection
GROUP BY authorization_type
ORDER BY total_grants DESC;
```

## Usage Examples

### 1. Create Cross-Tenant Access Grant (via Event)
```typescript
// Temporal Activity: CreateAccessGrantActivity
async function createAccessGrant(params: {
  consultant_org_id: string;
  consultant_user_id?: string;
  provider_org_id: string;
  scope: 'full_org' | 'facility' | 'program' | 'client_specific';
  scope_id?: string;
  authorization_type: string;
  legal_reference: string;
  expires_at?: string;
  permissions?: string[];
  terms?: object;
}) {
  const grantId = uuidv4();

  await supabase.from('domain_events').insert({
    event_type: 'access_grant.created',
    aggregate_id: grantId,
    aggregate_type: 'access_grant',
    payload: {
      id: grantId,
      ...params,
      granted_by: getCurrentUserId(),
      granted_at: new Date().toISOString()
    },
    metadata: {
      user_id: getCurrentUserId(),
      correlation_id: uuidv4()
    }
  });

  return grantId;
}
```

### 2. Revoke Access Grant
```typescript
async function revokeAccessGrant(params: {
  grant_id: string;
  revocation_reason: string;
  revocation_details: string;
}) {
  await supabase.from('domain_events').insert({
    event_type: 'access_grant.revoked',
    aggregate_id: params.grant_id,
    aggregate_type: 'access_grant',
    payload: {
      revoked_by: getCurrentUserId(),
      revoked_at: new Date().toISOString(),
      revocation_reason: params.revocation_reason,
      revocation_details: params.revocation_details
    },
    metadata: {
      user_id: getCurrentUserId(),
      correlation_id: uuidv4()
    }
  });
}
```

### 3. Automated Expiration Cleanup Job
```typescript
// Cron job: Expire grants past expires_at
async function expireAccessGrants() {
  const { data: expiringGrants } = await supabase
    .from('cross_tenant_access_grants_projection')
    .select('id')
    .lte('expires_at', new Date().toISOString())
    .in('status', ['active', 'suspended']);

  for (const grant of expiringGrants) {
    await supabase.from('domain_events').insert({
      event_type: 'access_grant.expired',
      aggregate_id: grant.id,
      aggregate_type: 'access_grant',
      payload: {
        expired_at: new Date().toISOString(),
        expiration_type: 'auto'
      },
      metadata: {
        user_id: 'system',
        correlation_id: uuidv4()
      }
    });
  }
}
```

## Audit Trail

### Full Grant Lifecycle History
```sql
SELECT
  de.event_type,
  de.occurred_at,
  de.payload,
  de.metadata->>'user_id' as actor
FROM domain_events de
WHERE de.aggregate_type = 'access_grant'
  AND de.aggregate_id = '<grant-uuid>'
ORDER BY de.occurred_at;
```

### Grants Created by User
```sql
SELECT
  c_org.name as consultant,
  p_org.name as provider,
  ctag.authorization_type,
  ctag.granted_at,
  ctag.status
FROM cross_tenant_access_grants_projection ctag
JOIN organizations_projection c_org ON c_org.id = ctag.consultant_org_id
JOIN organizations_projection p_org ON p_org.id = ctag.provider_org_id
WHERE ctag.granted_by = '<user-uuid>'
ORDER BY ctag.granted_at DESC;
```

## Troubleshooting

### Issue: RLS Blocks All Access

**Symptoms**: All queries return 0 rows despite grants existing

**Diagnosis**:
```sql
-- Check if RLS is enabled
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'cross_tenant_access_grants_projection';

-- Check for policies
SELECT COUNT(*) FROM pg_policies
WHERE tablename = 'cross_tenant_access_grants_projection';
```

**Resolution**: Implement RLS policies (see Recommended Policies section)

### Issue: Grant Not Authorizing Access

**Diagnosis**:
```sql
-- Check grant status and expiration
SELECT *
FROM cross_tenant_access_grants_projection
WHERE id = '<grant-uuid>';

-- Check if grant matches authorization criteria
SELECT *
FROM cross_tenant_access_grants_projection
WHERE consultant_org_id = '<consultant-uuid>'
  AND provider_org_id = '<provider-uuid>'
  AND status = 'active'
  AND (expires_at IS NULL OR expires_at > NOW());
```

**Common Causes**:
1. Grant expired → Check expires_at
2. Grant revoked/suspended → Check status field
3. Wrong consultant_user_id → Grant may be user-scoped
4. Scope mismatch → Check scope and scope_id

## Performance Considerations

### Authorization Check Performance
```sql
EXPLAIN ANALYZE
SELECT * FROM cross_tenant_access_grants_projection
WHERE consultant_org_id = '<uuid>'
  AND provider_org_id = '<uuid>'
  AND status = 'active';
-- Expected: Index Scan using idx_access_grants_lookup
-- Cost: < 1ms
```

### Expiration Job Performance
- **Frequency**: Daily cron job
- **Index**: idx_access_grants_expires ensures efficient lookup
- **Volume**: Typically < 100 grants expire per day

## Related Tables

- **organizations_projection** - Consultant and provider organizations
- **users** - Grant actors (granted_by, revoked_by, etc.)
- **domain_events** - Source of truth for grant lifecycle

## Migration History

**Initial Schema**: Created with provider_partner feature (2024-Q4)

**Schema Changes**:
- Added suspension/reactivation fields (2025-01-05)
- Added JSONB terms field (2024-12-20)
- Migration from Zitadel to Supabase Auth (2025-10-27) - No schema changes

## References

- **Event Processor**: `infrastructure/supabase/sql/03-functions/event-processing/006-process-access-grant-events.sql`
- **Table Definition**: `infrastructure/supabase/sql/02-tables/rbac/005-cross_tenant_access_grants_projection.sql`
- **RLS Enable**: `infrastructure/supabase/sql/06-rls/enable_rls_all_tables.sql:17`
- **⚠️ RLS Policies**: **NOT YET IMPLEMENTED** - CRITICAL GAP
