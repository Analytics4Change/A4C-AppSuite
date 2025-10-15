# VAR Partnership Architecture

## Executive Summary

This document specifies the architecture for Value-Added Reseller (VAR) partnerships in the A4C platform. VAR Partners are organizations that sell and support A4C platform services to healthcare Provider organizations on behalf of Analytics4Change.

**Status:** Architectural Specification
**Version:** 1.0
**Last Updated:** 2025-10-09

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Business Model](#business-model)
3. [Architectural Principles](#architectural-principles)
4. [Organizational Structure](#organizational-structure)
5. [Event-Sourced Partnership Lifecycle](#event-sourced-partnership-lifecycle)
6. [Cross-Tenant Access Model](#cross-tenant-access-model)
7. [Database Schema](#database-schema)
8. [Security Considerations](#security-considerations)
9. [Implementation Plan](#implementation-plan)
10. [Testing Strategy](#testing-strategy)

---

## Problem Statement

Analytics4Change (A4C) sells platform services through two channels:
1. **Direct Sales**: A4C sells directly to Provider organizations
2. **Partner Channel**: Value-Added Resellers (VARs) sell and support Provider organizations

### VAR Requirements

VARs need ability to:
- **Manage Client Relationships**: Track which Providers are their customers
- **Access Provider Data**: View Provider platform usage and reports (with consent)
- **Provide Support**: Troubleshoot Provider issues, generate reports
- **Earn Revenue Share**: Track partnership terms and revenue distribution

### Compliance Requirements

- **HIPAA Compliance**: All cross-tenant data access must be audited
- **Consent Management**: Providers must explicitly authorize VAR access
- **Data Isolation**: VARs cannot access Provider data without valid grant
- **Audit Trails**: Complete event history for compliance and forensics

---

## Business Model

### Partnership Types

**1. Standard VAR Partnership**
- VAR sells A4C platform to Providers
- Revenue share: 20-30% of subscription revenue
- VAR provides Tier 1-2 support
- A4C provides Tier 3 support and infrastructure

**2. White-Label Partnership**
- VAR sells platform under their brand
- Revenue share: 40-50% of subscription revenue
- VAR provides all customer-facing support
- A4C provides infrastructure and updates

### Partnership Lifecycle

```
Partnership Created → Active → (Optional: Renewed) → Expired/Terminated
```

**States:**
- `active`: Partnership is valid, VAR has access to Provider data
- `expired`: Contract end date passed, access automatically revoked
- `terminated`: Early termination by either party, access immediately revoked

---

## Architectural Principles

### CRITICAL PRINCIPLE: Flat Organizational Structure

**All Provider organizations exist at the root level in Zitadel** (flat structure). VAR Partner organizations also exist at root level. **VAR partnerships are tracked as business metadata** in the `var_partnerships_projection` table, **NOT as hierarchical ownership in Zitadel**.

**Rationale:**
- VAR contract expiration cannot trigger Zitadel organization restructuring
- Provider organizational structure must remain stable regardless of VAR relationships
- Providers may switch VARs or go direct without affecting their Zitadel organization

### Event-Sourced Architecture

All partnership state changes are captured as immutable events:
- **Events**: Stored in `domain_events` table with `stream_type = 'var_partnership'`
- **Projection**: `var_partnerships_projection` table maintains queryable state
- **Event Processor**: `process_var_partnership_event()` updates projection
- **Audit Trail**: Complete event history for compliance

---

## Organizational Structure

### Zitadel Hierarchy (Flat Model)

```
Zitadel Instance: analytics4change-zdswvg.us1.zitadel.cloud
│
├── Analytics4Change (A4C Internal Org) - Root level
│   ├── Super Admin (role) - Can manage all partnerships
│   ├── Partnership Manager (role) - Can create/manage VAR partnerships
│   └── Internal users
│
├── VAR Partner XYZ (VAR Org) - Root level (NOT parent of Providers)
│   ├── VAR Administrator (role)
│   ├── VAR Consultant (role) - Access to Provider data via grants
│   └── Access: Via cross_tenant_access_grants (NOT Zitadel hierarchy)
│       └── Partnership metadata in var_partnerships_projection table
│
├── Provider A (Provider Org) - Root level
│   ├── Administrator (role)
│   ├── Provider-defined internal hierarchy
│   └── May be associated with VAR via var_partnerships_projection
│
├── Provider B (Provider Org) - Root level (No VAR, Direct Customer)
│   ├── Administrator (role)
│   └── Provider-defined internal hierarchy
│
└── Provider C (Provider Org) - Root level
    └── May be associated with DIFFERENT VAR
```

### Key Relationships (Event-Sourced Metadata)

**NOT in Zitadel hierarchy** - tracked in PostgreSQL:

```sql
-- VAR Partner XYZ ↔ Provider A (active partnership)
var_partnerships_projection:
  var_org_id: org_var_partner_xyz
  provider_org_id: org_provider_a
  status: 'active'
  contract_end_date: 2026-12-31

-- Cross-tenant access grant (based on partnership)
cross_tenant_access_grants_projection:
  consultant_org_id: org_var_partner_xyz
  provider_org_id: org_provider_a
  authorization_type: 'var_contract'
  partnership_id: <var_partnerships_projection.id>
  revoked_at: NULL
```

---

## Event-Sourced Partnership Lifecycle

### Partnership Creation

**Event:** `var_partnership.created`

```typescript
interface VARPartnershipCreatedEvent {
  id: string;
  streamId: string;  // VAR org ID
  streamType: 'var_partnership';
  eventType: 'var_partnership.created';
  data: {
    partnership_id: string;
    var_org_id: string;
    var_org_name: string;
    provider_org_id: string;
    provider_org_name: string;
    contract_start_date: string;  // ISO 8601
    contract_end_date: string | null;  // NULL = ongoing
    partnership_type: 'standard' | 'white_label';
    revenue_share_percentage: number;  // e.g., 25.0
    support_level: 'tier1' | 'tier1_tier2' | 'full';
    terms: {
      auto_renewal: boolean;
      termination_notice_days: number;
      // ... other contractual terms
    };
  };
  metadata: {
    userId: string;  // Partnership Manager who created
    orgId: string;   // Analytics4Change org
    timestamp: string;
  };
  timestamp: string;
  reason: string;
}
```

**Event Processor Actions:**
1. Insert row into `var_partnerships_projection` with `status = 'active'`
2. Emit `access_grant.created` events for VAR consultant users (if configured)

### Partnership Renewal

**Event:** `var_partnership.renewed`

```typescript
interface VARPartnershipRenewedEvent {
  id: string;
  streamId: string;  // VAR org ID
  streamType: 'var_partnership';
  eventType: 'var_partnership.renewed';
  data: {
    partnership_id: string;
    previous_end_date: string;
    new_end_date: string;
    updated_terms: {
      revenue_share_percentage?: number;  // May change on renewal
      // ... other updated terms
    };
  };
  metadata: {
    userId: string;
    orgId: string;
    timestamp: string;
  };
  timestamp: string;
  reason: string;
}
```

**Event Processor Actions:**
1. Update `var_partnerships_projection.contract_end_date`
2. Update `var_partnerships_projection.updated_at`
3. Maintain `status = 'active'` if new end date is in future

### Partnership Expiration (Automated)

**Event:** `var_partnership.expired`

**Trigger:** Daily background job detects partnerships with `contract_end_date <= TODAY` and `status = 'active'`

```typescript
interface VARPartnershipExpiredEvent {
  id: string;
  streamId: string;  // VAR org ID
  streamType: 'var_partnership';
  eventType: 'var_partnership.expired';
  data: {
    partnership_id: string;
    contract_end_date: string;
    days_since_expiration: number;
  };
  metadata: {
    userId: 'system';  // Automated background job
    orgId: 'org_a4c_platform';
    timestamp: string;
  };
  timestamp: string;
  reason: string;
}
```

**Event Processor Actions:**
1. Update `var_partnerships_projection.status = 'expired'`
2. Update `var_partnerships_projection.updated_at`
3. **Emit cascading `access_grant.revoked` events** for all VAR users with grants based on this partnership

### Partnership Termination (Manual)

**Event:** `var_partnership.terminated`

```typescript
interface VARPartnershipTerminatedEvent {
  id: string;
  streamId: string;  // VAR org ID
  streamType: 'var_partnership';
  eventType: 'var_partnership.terminated';
  data: {
    partnership_id: string;
    terminated_by: 'var' | 'provider' | 'a4c';
    termination_reason: string;
    effective_date: string;  // May be immediate or future-dated
  };
  metadata: {
    userId: string;  // User who initiated termination
    orgId: string;
    timestamp: string;
  };
  timestamp: string;
  reason: string;
}
```

**Event Processor Actions:**
1. Update `var_partnerships_projection.status = 'terminated'`
2. Update `var_partnerships_projection.updated_at`
3. **Emit cascading `access_grant.revoked` events** immediately

---

## Cross-Tenant Access Model

### Access Grant Lifecycle

**1. Grant Creation (When Partnership Active)**

**Event:** `access_grant.created`

```typescript
interface AccessGrantCreatedEvent {
  id: string;
  streamId: string;  // Provider org ID
  streamType: 'access_grant';
  eventType: 'access_grant.created';
  data: {
    grant_id: string;
    consultant_user_id: string;  // VAR consultant
    consultant_org_id: string;   // VAR Partner org
    provider_org_id: string;     // Provider org
    authorization_type: 'var_contract';
    authorization_reference: string;  // Partnership ID
    scope: {
      data_types: string[];  // ['reports', 'analytics', 'client_list']
      permissions: string[]; // ['view', 'export']
      restrictions: {
        exclude_phi: boolean;  // May restrict PHI access
        read_only: boolean;    // VAR cannot modify Provider data
      };
    };
    granted_by: string;  // Super Admin or Provider Admin who authorized
    granted_at: string;
    expires_at: string | null;  // Typically NULL (relies on partnership expiration)
  };
  metadata: {
    userId: string;
    orgId: string;
    timestamp: string;
  };
  timestamp: string;
  reason: string;
}
```

**Event Processor Actions:**
1. Insert row into `cross_tenant_access_grants_projection`
2. RLS policies now allow VAR user to access Provider data

**2. Grant Revocation (When Partnership Expires/Terminates)**

**Event:** `access_grant.revoked`

**Trigger:** Emitted by `var_partnership.expired` or `var_partnership.terminated` event processor

```typescript
interface AccessGrantRevokedEvent {
  id: string;
  streamId: string;  // Provider org ID
  streamType: 'access_grant';
  eventType: 'access_grant.revoked';
  data: {
    grant_id: string;
    revoked_at: string;
    revocation_reason: 'partnership_expired' | 'partnership_terminated' | 'manual_revocation';
    partnership_id: string;  // Reference to expired/terminated partnership
  };
  metadata: {
    userId: 'system' | string;  // System for automated, user ID for manual
    orgId: string;
    timestamp: string;
  };
  timestamp: string;
  reason: string;
}
```

**Event Processor Actions:**
1. Update `cross_tenant_access_grants_projection.revoked_at`
2. RLS policies now deny VAR user access to Provider data

### RLS Policy (Example)

```sql
CREATE POLICY "VAR consultants can view Provider data via active grants"
ON clients
FOR SELECT
USING (
  -- VAR access via cross-tenant grant
  EXISTS (
    SELECT 1
    FROM cross_tenant_access_grants_projection ctag
    WHERE ctag.provider_org_id = clients.org_id
      AND ctag.consultant_user_id = auth.uid()
      AND ctag.authorization_type = 'var_contract'
      AND ctag.revoked_at IS NULL
      -- Verify underlying partnership is still active
      AND EXISTS (
        SELECT 1
        FROM var_partnerships_projection vp
        WHERE vp.id = ctag.authorization_reference::uuid
          AND vp.status = 'active'
          AND (vp.contract_end_date IS NULL OR vp.contract_end_date >= CURRENT_DATE)
      )
  )
);
```

---

## Database Schema

### Projection Tables

**var_partnerships_projection:**

```sql
-- CQRS projection table (NEVER updated directly - only via event processor)
CREATE TABLE var_partnerships_projection (
  id UUID PRIMARY KEY,
  var_org_id UUID NOT NULL REFERENCES organizations(id),
  var_org_name TEXT NOT NULL,
  provider_org_id UUID NOT NULL REFERENCES organizations(id),
  provider_org_name TEXT NOT NULL,
  partnership_type TEXT NOT NULL CHECK (partnership_type IN ('standard', 'white_label')),
  contract_start_date DATE NOT NULL,
  contract_end_date DATE,  -- NULL = ongoing
  status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'terminated')),
  revenue_share_percentage DECIMAL(5,2) NOT NULL,
  support_level TEXT NOT NULL CHECK (support_level IN ('tier1', 'tier1_tier2', 'full')),
  terms JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (var_org_id, provider_org_id)
);

-- Indexes for common queries
CREATE INDEX idx_var_partnerships_var_org ON var_partnerships_projection(var_org_id) WHERE status = 'active';
CREATE INDEX idx_var_partnerships_provider_org ON var_partnerships_projection(provider_org_id) WHERE status = 'active';
CREATE INDEX idx_var_partnerships_status ON var_partnerships_projection(status);
CREATE INDEX idx_var_partnerships_expiry ON var_partnerships_projection(contract_end_date) WHERE status = 'active';

-- Comments
COMMENT ON TABLE var_partnerships_projection IS 'CQRS projection: VAR partnerships (updated via event processor only)';
COMMENT ON COLUMN var_partnerships_projection.contract_end_date IS 'NULL = ongoing contract with no fixed end date';
```

**cross_tenant_access_grants_projection:**

```sql
-- CQRS projection table (NEVER updated directly - only via event processor)
CREATE TABLE cross_tenant_access_grants_projection (
  id UUID PRIMARY KEY,
  consultant_user_id UUID NOT NULL REFERENCES users(id),
  consultant_org_id UUID NOT NULL REFERENCES organizations(id),
  provider_org_id UUID NOT NULL REFERENCES organizations(id),
  authorization_type TEXT NOT NULL CHECK (authorization_type IN ('var_contract', 'consulting_agreement', 'temporary_access')),
  authorization_reference UUID,  -- Partnership ID or agreement ID
  scope JSONB NOT NULL,
  granted_by UUID NOT NULL REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- Indexes for RLS policies and audit queries
CREATE INDEX idx_access_grants_consultant ON cross_tenant_access_grants_projection(consultant_user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_access_grants_provider ON cross_tenant_access_grants_projection(provider_org_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_access_grants_authorization ON cross_tenant_access_grants_projection(authorization_reference) WHERE revoked_at IS NULL;
CREATE INDEX idx_access_grants_granted_at ON cross_tenant_access_grants_projection(granted_at);

-- Comments
COMMENT ON TABLE cross_tenant_access_grants_projection IS 'CQRS projection: Cross-tenant data access grants (updated via event processor only)';
COMMENT ON COLUMN cross_tenant_access_grants_projection.authorization_reference IS 'Partnership ID (for var_contract) or agreement ID (for consulting_agreement)';
```

### Event Processor

```sql
CREATE OR REPLACE FUNCTION process_var_partnership_event()
RETURNS TRIGGER AS $$
DECLARE
  v_event_data JSONB;
  v_partnership_id UUID;
BEGIN
  v_event_data := NEW.event_data;

  CASE NEW.event_type
    -- Partnership Created
    WHEN 'var_partnership.created' THEN
      INSERT INTO var_partnerships_projection (
        id,
        var_org_id,
        var_org_name,
        provider_org_id,
        provider_org_name,
        partnership_type,
        contract_start_date,
        contract_end_date,
        status,
        revenue_share_percentage,
        support_level,
        terms,
        created_at,
        updated_at
      ) VALUES (
        (v_event_data->>'partnership_id')::UUID,
        (v_event_data->>'var_org_id')::UUID,
        v_event_data->>'var_org_name',
        (v_event_data->>'provider_org_id')::UUID,
        v_event_data->>'provider_org_name',
        v_event_data->>'partnership_type',
        (v_event_data->>'contract_start_date')::DATE,
        (v_event_data->>'contract_end_date')::DATE,
        'active',
        (v_event_data->>'revenue_share_percentage')::DECIMAL,
        v_event_data->>'support_level',
        v_event_data->'terms',
        NEW.created_at,
        NEW.created_at
      );

    -- Partnership Renewed
    WHEN 'var_partnership.renewed' THEN
      UPDATE var_partnerships_projection
      SET contract_end_date = (v_event_data->>'new_end_date')::DATE,
          revenue_share_percentage = COALESCE((v_event_data->'updated_terms'->>'revenue_share_percentage')::DECIMAL, revenue_share_percentage),
          terms = terms || COALESCE(v_event_data->'updated_terms', '{}'::JSONB),
          updated_at = NEW.created_at
      WHERE id = (v_event_data->>'partnership_id')::UUID;

    -- Partnership Expired (Automated)
    WHEN 'var_partnership.expired' THEN
      v_partnership_id := (v_event_data->>'partnership_id')::UUID;

      -- Update projection status
      UPDATE var_partnerships_projection
      SET status = 'expired',
          updated_at = NEW.created_at
      WHERE id = v_partnership_id;

      -- Emit cascading access grant revocation events
      INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
      SELECT
        grant.provider_org_id,
        'access_grant',
        COALESCE((
          SELECT MAX(stream_version) + 1
          FROM domain_events
          WHERE stream_id = grant.provider_org_id AND stream_type = 'access_grant'
        ), 1),
        'access_grant.revoked',
        jsonb_build_object(
          'grant_id', grant.id,
          'revoked_at', NOW(),
          'revocation_reason', 'partnership_expired',
          'partnership_id', v_partnership_id
        ),
        jsonb_build_object(
          'userId', 'system',
          'orgId', 'org_a4c_platform',
          'timestamp', NOW()
        )
      FROM cross_tenant_access_grants_projection grant
      WHERE grant.authorization_reference = v_partnership_id
        AND grant.authorization_type = 'var_contract'
        AND grant.revoked_at IS NULL;

    -- Partnership Terminated (Manual)
    WHEN 'var_partnership.terminated' THEN
      v_partnership_id := (v_event_data->>'partnership_id')::UUID;

      -- Update projection status
      UPDATE var_partnerships_projection
      SET status = 'terminated',
          updated_at = NEW.created_at
      WHERE id = v_partnership_id;

      -- Emit cascading access grant revocation events (same as expired)
      INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
      SELECT
        grant.provider_org_id,
        'access_grant',
        COALESCE((
          SELECT MAX(stream_version) + 1
          FROM domain_events
          WHERE stream_id = grant.provider_org_id AND stream_type = 'access_grant'
        ), 1),
        'access_grant.revoked',
        jsonb_build_object(
          'grant_id', grant.id,
          'revoked_at', NOW(),
          'revocation_reason', 'partnership_terminated',
          'partnership_id', v_partnership_id
        ),
        jsonb_build_object(
          'userId', NEW.event_metadata->>'userId',
          'orgId', NEW.event_metadata->>'orgId',
          'timestamp', NOW()
        )
      FROM cross_tenant_access_grants_projection grant
      WHERE grant.authorization_reference = v_partnership_id
        AND grant.authorization_type = 'var_contract'
        AND grant.revoked_at IS NULL;

  END CASE;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for VAR partnership events
CREATE TRIGGER process_var_partnership_event_trigger
AFTER INSERT ON domain_events
FOR EACH ROW
WHEN (NEW.stream_type = 'var_partnership')
EXECUTE FUNCTION process_var_partnership_event();
```

### Background Job (Partnership Expiration Detection)

```typescript
// Daily cron job at 00:00 UTC
async function detectExpiredPartnerships() {
  const today = new Date().toISOString().split('T')[0];

  const expiredPartnerships = await supabase
    .from('var_partnerships_projection')
    .select('*')
    .eq('status', 'active')
    .not('contract_end_date', 'is', null)
    .lte('contract_end_date', today);

  for (const partnership of expiredPartnerships.data || []) {
    const daysSinceExpiration = dateDiff(partnership.contract_end_date, today);

    // Emit expiration event (NOT direct update) ✅ CORRECT
    await emitEvent({
      stream_id: partnership.var_org_id,
      stream_type: 'var_partnership',
      event_type: 'var_partnership.expired',
      event_data: {
        partnership_id: partnership.id,
        contract_end_date: partnership.contract_end_date,
        days_since_expiration: daysSinceExpiration
      },
      event_metadata: {
        userId: 'system',
        orgId: 'org_a4c_platform',
        timestamp: new Date().toISOString()
      }
    }, 'Partnership contract expired (automated detection)');
  }
}
```

---

## Security Considerations

### HIPAA Compliance

**Requirement:** All cross-tenant data access must be audited and authorized

**Implementation:**
1. **Explicit Authorization**: Provider Admin must approve VAR access grant
2. **Complete Audit Trail**: All events logged in immutable `domain_events` table
3. **Real-Time Revocation**: Partnership expiration immediately revokes access
4. **Disclosure Tracking**: Every VAR data access logged with cross-tenant metadata

### Audit Events for Cross-Tenant Access

When VAR consultant accesses Provider data, events include enhanced metadata:

```typescript
{
  eventType: 'client.viewed',
  streamId: 'client_uuid',
  streamType: 'client',
  metadata: {
    userId: 'var_consultant_uuid',
    orgId: 'provider_org_uuid',  // Cross-tenant access
    crossTenantAccess: {
      consultantOrgId: 'var_partner_org_uuid',
      grantId: 'grant_uuid',
      authorizationType: 'var_contract',
      partnershipId: 'partnership_uuid',
      partnershipStatus: 'active',  // Validated at access time
      contractEndDate: '2026-12-31'
    },
    timestamp: '2025-10-09T...'
  }
}
```

### Network Failure Handling

**CRITICAL SECURITY REQUIREMENT**: Cross-tenant access MUST be blocked if audit event cannot be written synchronously.

**Rationale:**
- HIPAA requires disclosure tracking before data access
- VAR partnership validation requires online connection
- No IndexedDB queue for cross-tenant audit (prevents data exposure if device stolen)

See `.plans/event-resilience/plan.md` Scenario 7 for details.

---

## Implementation Plan

### Phase 1: Database Infrastructure (Week 1)

**Tasks:**
1. Create `var_partnerships_projection` table
2. Create `cross_tenant_access_grants_projection` table
3. Implement `process_var_partnership_event()` function
4. Implement `process_access_grant_event()` function
5. Update main event router to include new stream types
6. Write database migration scripts

**Deliverables:**
- SQL migration files in `/infrastructure/supabase/sql/02-tables/var-partnerships/`
- Event processor in `/infrastructure/supabase/sql/03-functions/event-processing/`
- Unit tests for event processors

### Phase 2: Backend Services (Week 2)

**Tasks:**
1. Create `VARPartnershipService` for partnership CRUD
2. Create `CrossTenantAccessService` for grant management
3. Implement background job for expiration detection
4. Add RLS policies for cross-tenant data access
5. Create audit query helper functions

**Deliverables:**
- Backend services in `/backend/src/services/var-partnerships/`
- Background job in `/backend/src/jobs/detect-expired-partnerships.ts`
- API endpoints for partnership management

### Phase 3: Frontend UI (Week 3)

**Tasks:**
1. Create Partnership Management UI for Super Admin
2. Create VAR Dashboard for VAR Partner users
3. Add cross-tenant access request workflow
4. Implement Provider consent UI for VAR access
5. Create partnership audit reports

**Deliverables:**
- UI components in `/frontend/src/pages/partnerships/`
- VAR dashboard in `/frontend/src/pages/var-dashboard/`
- ViewModels and services

### Phase 4: Testing & Deployment (Week 4)

**Tasks:**
1. Integration testing of full partnership lifecycle
2. Security testing of cross-tenant RLS policies
3. Load testing with multiple concurrent VAR accesses
4. Compliance testing of audit trails
5. Production deployment

**Deliverables:**
- Test suites
- Documentation
- Deployment scripts

---

## Testing Strategy

### Unit Tests

**Event Processors:**
- [ ] `var_partnership.created` creates projection row
- [ ] `var_partnership.renewed` updates projection
- [ ] `var_partnership.expired` emits cascading grant revocations
- [ ] `var_partnership.terminated` emits cascading grant revocations
- [ ] Event idempotency (re-processing same event produces same result)

**Access Grant Events:**
- [ ] `access_grant.created` creates projection row
- [ ] `access_grant.revoked` updates revoked_at timestamp
- [ ] RLS policies deny access when grant revoked

### Integration Tests

**Partnership Lifecycle:**
- [ ] Create partnership → VAR can access Provider data
- [ ] Renew partnership → Access continues
- [ ] Expire partnership → Access automatically revoked
- [ ] Terminate partnership → Access immediately revoked

**Cross-Tenant Access:**
- [ ] VAR consultant can query Provider data when grant active
- [ ] VAR consultant denied when grant revoked
- [ ] VAR consultant denied when partnership expired
- [ ] All access logged with cross-tenant metadata

### Compliance Tests

**Audit Trail:**
- [ ] All partnership events logged
- [ ] All access grant events logged
- [ ] All cross-tenant data access includes metadata
- [ ] Audit queries return complete history

**Security:**
- [ ] Cross-tenant access blocked when offline (no audit event)
- [ ] Partnership validation requires active status + valid contract date
- [ ] Grant validation requires active partnership
- [ ] RLS policies enforce isolation

---

## Related Documents

### Platform Architecture
- `.plans/consolidated/agent-observations.md` - Overall architecture (hierarchy model, VAR partnerships)
- `.plans/auth-integration/tenants-as-organization-thoughts.md` - Organizational structure (flat Provider model)
- `.plans/multi-tenancy/multi-tenancy-organization.html` - Multi-tenancy specification

### Event-Driven Architecture
- `/infrastructure/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md` - CQRS foundation
- `.plans/event-resilience/plan.md` - Event handling and network failures

### Impersonation (VAR Context)
- `.plans/impersonation/architecture.md` - VAR Partner impersonation
- `.plans/impersonation/event-schema.md` - VAR cross-tenant event examples
- `.plans/impersonation/implementation-guide.md` - Phase 4.5 VAR support

### RBAC
- `.plans/rbac-permissions/architecture.md` - Permission system
- `.plans/rbac-permissions/implementation-guide.md` - Implementation steps

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-10-09 | Flat Provider structure (VAR partnerships as metadata) | VAR contract expiration cannot trigger Zitadel org restructuring |
| 2025-10-09 | Event-sourced partnership lifecycle | Complete audit trail, immutable history, automated access revocation |
| 2025-10-09 | Cascading grant revocation on expiration | Automatic access cleanup when partnership ends |
| 2025-10-09 | Block cross-tenant access when offline | HIPAA requires real-time disclosure tracking |
| 2025-10-09 | Daily background job for expiration detection | Automated detection, emits events (not direct updates) |

---

**Document Version:** 1.0
**Last Updated:** 2025-10-09
**Status:** Approved for Implementation
**Owner:** A4C Architecture Team
