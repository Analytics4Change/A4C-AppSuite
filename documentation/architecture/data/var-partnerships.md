---
status: aspirational
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Planned implementation for Value-Added Reseller (VAR) partnerships including business model, revenue sharing, cross-tenant access patterns, and contract tracking.

**When to read**:
- Planning VAR partnership feature implementation
- Understanding VAR business model requirements
- Designing cross-tenant access for resellers
- Implementing revenue share tracking

**Prerequisites**: [provider-partners-architecture.md](provider-partners-architecture.md)

**Key topics**: `var`, `partnerships`, `revenue-share`, `reseller`, `white-label`, `cross-tenant`

**Estimated read time**: 15 minutes
<!-- TL;DR-END -->

# VAR Partnership Implementation
> [!WARNING]
> **This feature is not yet implemented.** This document describes planned functionality that has not been built. Implementation timeline and approach are subject to change based on business priorities.


## Overview

This document provides detailed implementation specifications for Value-Added Reseller (VAR) partnerships within the A4C provider partner ecosystem. VAR partners are commercial organizations that sell and support A4C platform services to healthcare providers on behalf of Analytics4Change.

**Parent Architecture**: See `.plans/provider-partners/architecture.md` for the complete provider partner framework

**Status:** Implementation Specification  
**Version:** 1.0 (Extracted from provider partner umbrella)  
**Last Updated:** 2025-10-15

---

## VAR Partnership Business Model

### Problem Statement

Analytics4Change (A4C) sells platform services through two channels:
1. **Direct Sales**: A4C sells directly to provider organizations
2. **VAR Channel**: Value-Added Resellers sell and support provider organizations

### VAR Requirements

VAR partners need the ability to:
- **Manage Client Relationships**: Track which provider organizations are their customers
- **Access Provider Data**: View provider platform usage and reports (with consent)
- **Provide Support**: Troubleshoot provider issues, generate reports
- **Earn Revenue Share**: Track partnership terms and revenue distribution

### Partnership Types

**1. Standard VAR Partnership**
- VAR sells A4C platform to providers
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
- `active`: Partnership is valid, VAR has access to provider data
- `expired`: Contract end date passed, access automatically revoked
- `terminated`: Early termination by either party, access immediately revoked

---

## Event-Sourced VAR Partnership Lifecycle

### Partnership Creation

**Event:** `provider_partner_relationship.created` (with VAR-specific data)

```typescript
interface VARPartnershipCreatedEvent {
  id: string;
  streamId: string;  // VAR org ID
  streamType: 'provider_partner_relationship';
  eventType: 'provider_partner_relationship.created';
  data: {
    relationship_id: string;
    partner_type: 'var';
    partner_subtype: 'standard' | 'white_label';
    partner_org_id: string;
    partner_org_name: string;
    provider_org_id: string;
    provider_org_name: string;
    contract_start_date: string;  // ISO 8601
    contract_end_date: string | null;  // NULL = ongoing
    revenue_share_percentage: number;  // e.g., 25.0
    support_level: 'tier1' | 'tier1_tier2' | 'full';
    terms: {
      auto_renewal: boolean;
      termination_notice_days: number;
      minimum_commitment_months?: number;
      performance_metrics?: {
        min_monthly_sales?: number;
        customer_satisfaction_threshold?: number;
      };
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

**Event:** `provider_partner_relationship.renewed`

```typescript
interface VARPartnershipRenewedEvent {
  id: string;
  streamId: string;  // VAR org ID
  streamType: 'provider_partner_relationship';
  eventType: 'provider_partner_relationship.renewed';
  data: {
    relationship_id: string;
    partner_type: 'var';
    previous_end_date: string;
    new_end_date: string;
    updated_terms: {
      revenue_share_percentage?: number;
      support_level?: 'tier1' | 'tier1_tier2' | 'full';
      performance_metrics?: object;
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

### Partnership Expiration (Automated)

**Event:** `provider_partner_relationship.expired`

**Trigger:** Daily background job detects partnerships with `contract_end_date <= TODAY` and `status = 'active'`

```typescript
interface VARPartnershipExpiredEvent {
  id: string;
  streamId: string;  // VAR org ID
  streamType: 'provider_partner_relationship';
  eventType: 'provider_partner_relationship.expired';
  data: {
    relationship_id: string;
    partner_type: 'var';
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

**Event:** `provider_partner_relationship.terminated`

```typescript
interface VARPartnershipTerminatedEvent {
  id: string;
  streamId: string;  // VAR org ID
  streamType: 'provider_partner_relationship';
  eventType: 'provider_partner_relationship.terminated';
  data: {
    relationship_id: string;
    partner_type: 'var';
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

---

## VAR Access Patterns

### Multi-Provider Dashboard Access

VAR partners typically manage multiple provider customers and need unified access:

```typescript
interface VARAccessScope {
  data_types: [
    'usage_analytics',     // Platform usage metrics
    'billing_reports',     // Subscription and payment data
    'support_tickets',     // Tier 1-2 support history
    'client_summaries',    // Aggregated client counts (no PHI)
    'system_health'        // Platform performance metrics
  ];
  permissions: ['view', 'export'];
  restrictions: {
    phi_restricted: true;        // No PHI access by default
    read_only: true;            // Cannot modify provider data
    aggregated_only: true;      // No individual client records
  };
}
```

### VAR-Specific Dashboard Features

**Portfolio Management**:
- Provider A: Active, 45 clients, $2,400/month
- Provider B: Active, 23 clients, $1,200/month  
- Provider C: Setup pending, expected $800/month

**Revenue Tracking**:
- Monthly commission calculation
- YTD performance vs. targets
- Commission payment status

**Support Analytics**:
- Open tickets by provider
- Resolution time metrics
- Customer satisfaction scores

### Cross-Tenant Access Grant for VARs

When a VAR partnership is active, access grants are created with VAR-specific scope:

```typescript
interface VARAccessGrant {
  authorization_type: 'var_contract';
  authorization_reference: 'var_partnership_uuid';
  scope: {
    data_types: ['usage_analytics', 'support_tickets', 'billing_reports'],
    permissions: ['view', 'export'],
    restrictions: {
      phi_restricted: true,
      read_only: true,
      provider_scoped: true  // Limited to contracted providers only
    }
  };
  expires_at: null;  // Relies on partnership expiration
}
```

---

## Database Schema

### VAR Partnerships Projection

```sql
-- CQRS projection table (NEVER updated directly - only via event processor)
CREATE TABLE var_partnerships_projection (
  id UUID PRIMARY KEY,
  partner_org_id UUID NOT NULL REFERENCES organizations_projection(id),
  partner_org_name TEXT NOT NULL,
  provider_org_id UUID NOT NULL REFERENCES organizations_projection(id),
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
  UNIQUE (partner_org_id, provider_org_id)
);

-- Indexes for VAR-specific queries
CREATE INDEX idx_var_partnerships_partner_org ON var_partnerships_projection(partner_org_id) WHERE status = 'active';
CREATE INDEX idx_var_partnerships_provider_org ON var_partnerships_projection(provider_org_id) WHERE status = 'active';
CREATE INDEX idx_var_partnerships_status ON var_partnerships_projection(status);
CREATE INDEX idx_var_partnerships_expiry ON var_partnerships_projection(contract_end_date) WHERE status = 'active';

-- Comments
COMMENT ON TABLE var_partnerships_projection IS 'CQRS projection: VAR partnership contracts (subset of provider partner relationships)';
COMMENT ON COLUMN var_partnerships_projection.contract_end_date IS 'NULL = ongoing contract with no fixed end date';
```

### Event Processor for VAR Partnerships

```sql
CREATE OR REPLACE FUNCTION process_var_partnership_event()
RETURNS TRIGGER AS $$
DECLARE
  v_event_data JSONB;
  v_partnership_id UUID;
BEGIN
  -- Only process VAR-specific events
  IF NEW.stream_type = 'provider_partner_relationship' 
     AND (NEW.event_data->>'partner_type') = 'var' THEN

    v_event_data := NEW.event_data;

    CASE NEW.event_type
      -- Partnership Created
      WHEN 'provider_partner_relationship.created' THEN
        INSERT INTO var_partnerships_projection (
          id,
          partner_org_id,
          partner_org_name,
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
          (v_event_data->>'relationship_id')::UUID,
          (v_event_data->>'partner_org_id')::UUID,
          v_event_data->>'partner_org_name',
          (v_event_data->>'provider_org_id')::UUID,
          v_event_data->>'provider_org_name',
          v_event_data->>'partner_subtype',  -- 'standard' or 'white_label'
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
      WHEN 'provider_partner_relationship.renewed' THEN
        UPDATE var_partnerships_projection
        SET contract_end_date = (v_event_data->>'new_end_date')::DATE,
            revenue_share_percentage = COALESCE((v_event_data->'updated_terms'->>'revenue_share_percentage')::DECIMAL, revenue_share_percentage),
            support_level = COALESCE(v_event_data->'updated_terms'->>'support_level', support_level),
            terms = terms || COALESCE(v_event_data->'updated_terms', '{}'::JSONB),
            updated_at = NEW.created_at
        WHERE id = (v_event_data->>'relationship_id')::UUID;

      -- Partnership Expired
      WHEN 'provider_partner_relationship.expired' THEN
        v_partnership_id := (v_event_data->>'relationship_id')::UUID;

        -- Update projection status
        UPDATE var_partnerships_projection
        SET status = 'expired',
            updated_at = NEW.created_at
        WHERE id = v_partnership_id;

        -- Emit cascading access grant revocation events
        INSERT INTO domain_events (stream_id, stream_type, event_type, event_data, event_metadata, created_at)
        SELECT
          grant.provider_org_id,
          'access_grant',
          'access_grant.revoked',
          jsonb_build_object(
            'grant_id', grant.id,
            'revoked_at', NOW(),
            'revocation_reason', 'var_partnership_expired',
            'partnership_id', v_partnership_id
          ),
          jsonb_build_object(
            'userId', 'system',
            'orgId', 'org_a4c_platform',
            'timestamp', NOW()
          ),
          NOW()
        FROM cross_tenant_access_grants_projection grant
        WHERE grant.authorization_reference = v_partnership_id
          AND grant.authorization_type = 'var_contract'
          AND grant.status = 'active';

      -- Partnership Terminated
      WHEN 'provider_partner_relationship.terminated' THEN
        v_partnership_id := (v_event_data->>'relationship_id')::UUID;

        -- Update projection status
        UPDATE var_partnerships_projection
        SET status = 'terminated',
            updated_at = NEW.created_at
        WHERE id = v_partnership_id;

        -- Emit cascading access grant revocation events (immediate)
        INSERT INTO domain_events (stream_id, stream_type, event_type, event_data, event_metadata, created_at)
        SELECT
          grant.provider_org_id,
          'access_grant',
          'access_grant.revoked',
          jsonb_build_object(
            'grant_id', grant.id,
            'revoked_at', NOW(),
            'revocation_reason', 'var_partnership_terminated',
            'partnership_id', v_partnership_id
          ),
          jsonb_build_object(
            'userId', NEW.event_metadata->>'userId',
            'orgId', NEW.event_metadata->>'orgId',
            'timestamp', NOW()
          ),
          NOW()
        FROM cross_tenant_access_grants_projection grant
        WHERE grant.authorization_reference = v_partnership_id
          AND grant.authorization_type = 'var_contract'
          AND grant.status = 'active';

    END CASE;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for VAR partnership events
CREATE TRIGGER process_var_partnership_event_trigger
AFTER INSERT ON domain_events
FOR EACH ROW
WHEN (NEW.stream_type = 'provider_partner_relationship' AND NEW.event_data->>'partner_type' = 'var')
EXECUTE FUNCTION process_var_partnership_event();
```

### Background Job for Partnership Expiration

```typescript
// Daily cron job at 00:00 UTC
async function detectExpiredVARPartnerships() {
  const today = new Date().toISOString().split('T')[0];

  const expiredPartnerships = await supabase
    .from('var_partnerships_projection')
    .select('*')
    .eq('status', 'active')
    .not('contract_end_date', 'is', null)
    .lte('contract_end_date', today);

  for (const partnership of expiredPartnerships.data || []) {
    const daysSinceExpiration = dateDiff(partnership.contract_end_date, today);

    // Emit expiration event using updated event schema
    await emitEvent({
      stream_id: partnership.partner_org_id,
      stream_type: 'provider_partner_relationship',
      event_type: 'provider_partner_relationship.expired',
      event_data: {
        relationship_id: partnership.id,
        partner_type: 'var',
        contract_end_date: partnership.contract_end_date,
        days_since_expiration: daysSinceExpiration
      },
      event_metadata: {
        userId: 'system',
        orgId: 'org_a4c_platform',
        timestamp: new Date().toISOString()
      }
    }, 'VAR partnership contract expired (automated detection)');
  }
}
```

---

## VAR-Specific UI Components

### VAR Partner Dashboard

**Portfolio Overview**:
```typescript
interface VARPortfolioSummary {
  total_providers: number;
  active_providers: number;
  monthly_recurring_revenue: number;
  total_commission_ytd: number;
  avg_customer_satisfaction: number;
  open_support_tickets: number;
}
```

**Provider List with VAR Metrics**:
```typescript
interface VARProviderSummary {
  provider_id: string;
  provider_name: string;
  subscription_tier: string;
  monthly_revenue: number;
  client_count: number;
  last_login: string;
  support_tickets_open: number;
  satisfaction_score: number;
  contract_status: 'active' | 'pending_renewal' | 'at_risk';
}
```

### Commission Tracking

**Revenue Share Calculation**:
- Base commission rate from partnership terms
- Performance bonuses based on customer satisfaction
- Volume discounts for multiple providers
- Monthly payment scheduling and tracking

**Commission Dashboard Features**:
- Real-time commission calculation
- Payment history and pending amounts
- Performance metrics vs. targets
- Annual commission projections

---

## Implementation Roadmap

### Phase 1: VAR Partnership Core (Week 1-2)

**Tasks:**
1. Implement `var_partnerships_projection` table and event processor
2. Create VAR partnership lifecycle API endpoints
3. Build basic VAR dashboard with portfolio overview
4. Add commission calculation logic

### Phase 2: Multi-Provider Access (Week 3-4)

**Tasks:**
1. Implement cross-tenant access grants for VARs
2. Create unified provider data views for VAR dashboard
3. Add aggregated reporting and analytics
4. Build provider onboarding workflow for VARs

### Phase 3: Advanced VAR Features (Week 5-6)

**Tasks:**
1. Add commission tracking and payment management
2. Implement customer satisfaction monitoring
3. Create VAR performance analytics
4. Build white-label customization options

### Phase 4: Integration and Testing (Week 7-8)

**Tasks:**
1. Integration testing with provider partner bootstrap
2. Commission calculation accuracy testing
3. Multi-provider access security testing
4. Performance testing with large VAR portfolios

---

## Related Documents

### Provider Partner Framework
- 📋 `.plans/provider-partners/architecture.md` - Provider partner umbrella architecture
- 📋 `.plans/provider-partners/court-access.md` - Court system integration (planned)
- 📋 `.plans/provider-partners/social-services.md` - Agency assignment workflows (planned)
- 📋 `.plans/provider-partners/family-access.md` - Family member access (planned)

### Bootstrap Integration (✅ IMPLEMENTED)
- ✅ `.plans/provider-management/bootstrap-workflows.md` - Organization bootstrap architecture
- ✅ `.plans/provider-management/partner-bootstrap-sequence.md` - Provider partner bootstrap workflow

### Cross-Tenant Infrastructure (✅ IMPLEMENTED)
- ✅ `/infrastructure/supabase/contracts/asyncapi/domains/access_grant.yaml` - Access grant event contracts
- ✅ `/infrastructure/supabase/sql/03-functions/event-processing/006-process-access-grant-events.sql` - Access grant processors
- ✅ `/infrastructure/supabase/sql/02-tables/rbac/005-cross_tenant_access_grants_projection.sql` - Cross-tenant access schema

---

**Document Version:** 1.0  
**Last Updated:** 2025-10-15  
**Status:** Ready for Implementation  
**Owner:** A4C VAR Partnership Team