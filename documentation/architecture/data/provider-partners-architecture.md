---
status: foundation-implemented
last_updated: 2025-12-02
---

# Provider Partner Architecture

> [!NOTE]
> **Foundation Implemented (2025-12-02)**. Core infrastructure for provider partners is complete:
> - ✅ Partner type enum (`var`, `family`, `court`, `other`) in organization bootstrap
> - ✅ Conditional subdomain provisioning (providers get subdomains, partners don't by default)
> - ✅ Referring partner relationship tracking
> - ✅ Organization bootstrap workflow handles both providers and partners
>
> **Not Yet Implemented**: Type-specific relationship projections (VAR contracts, court authorizations, agency assignments, family consents) and cross-tenant access grants.

**Status**: ✅ Foundation Implemented | ⏳ Type-Specific Features Planned
**Version**: 2.2 (Updated for foundation implementation)
**Last Updated**: 2025-12-02
**Authentication**: Supabase Auth

## Executive Summary

This document specifies the architecture for provider partner organizations in the A4C platform. Provider partners are external organizations that require cross-tenant access to healthcare provider data for legitimate business, legal, or family purposes. This includes Value-Added Resellers (VARs), court systems, social services agencies, and family organizations.

### Integration with Supabase Auth + Temporal

**IMPORTANT**: Provider partner organizations are now created and managed via:

1. **Organization Bootstrap**: Temporal.io workflows orchestrate creation
   - **OrganizationBootstrapWorkflow**: Creates partner org, provisions subdomain, sends invitations
   - **Duration**: 10-40 minutes (includes DNS propagation)
   - **Event-Driven**: All steps emit domain events

2. **Authentication**: Supabase Auth (not Zitadel)
   - Partner users authenticate via Supabase Auth (social login, password, or SAML SSO)
   - JWT tokens include custom claims: `org_id`, `user_role`, `permissions`
   - Cross-tenant access enforced via RLS policies

3. **Cross-Tenant Grants**: Event-sourced access grants
   - Grants created when partner relationship is established
   - RLS policies check JWT `org_id` + `cross_tenant_access_grants_projection`
   - Automatic revocation when relationship expires

**Key Changes from Previous Architecture**:
- **Organizations**: Database records (not Zitadel organizations)
- **User Management**: Temporal workflows + Supabase Auth (not Zitadel Management API)
- **Subdomains**: Provisioned via Temporal + Cloudflare API (automated)
- **Invitations**: Secure tokens via Temporal workflows (not Zitadel invitations)

**See Also**:
- **Temporal Workflows**: `.plans/temporal-integration/organization-onboarding-workflow.md`
- **Supabase Auth**: `.plans/supabase-auth-integration/overview.md`
- **Multi-Tenant Architecture**: `.plans/auth-integration/tenants-as-organization-thoughts.md`

---

## Table of Contents

1. [Provider Partner Types](#provider-partner-types)
2. [Architectural Principles](#architectural-principles)
3. [Organizational Structure](#organizational-structure)
4. [Cross-Tenant Access Model](#cross-tenant-access-model)
5. [Database Schema](#database-schema)
6. [Security Considerations](#security-considerations)
7. [Implementation Plan](#implementation-plan)
8. [Testing Strategy](#testing-strategy)

---

## Provider Partner Types

Provider partners are organizations with legitimate need for cross-tenant access to healthcare provider data. The A4C platform supports four main categories:

### 1. Value-Added Resellers (VARs)
**Business Purpose**: Sales and support partners for A4C platform services

**Characteristics**:
- Sell A4C platform to healthcare providers
- Provide tier 1-2 technical support
- Need access to provider usage analytics and reports
- Revenue sharing agreements with A4C

**Access Patterns**:
- Multi-provider dashboard (can access multiple provider customers)
- Usage analytics and reporting data
- Support ticket management and resolution tracking
- Limited to non-PHI data unless specifically authorized

**Relationship Management**: Event-sourced partnership contracts with revenue sharing terms

### 2. Court Systems
**Business Purpose**: Legal oversight and case management for at-risk youth

**Characteristics**:
- Juvenile courts, family courts, guardian ad litem
- Legal authority to access youth records per court orders
- Case-specific access with legal documentation
- Time-limited access tied to case duration

**Access Patterns**:
- Client-specific access based on court orders
- Case management integration
- Legal compliance reporting
- PHI access authorized by court order

**Relationship Management**: Legal authorization tracking with court order references

### 3. Social Services Agencies
**Business Purpose**: Case management and welfare oversight

**Characteristics**:
- Child Protective Services (CPS), case managers, social workers
- Government agencies with statutory authority
- Assignment-based access tied to caseworker responsibilities
- Service coordination and progress tracking

**Access Patterns**:
- Assigned case access only
- Service coordination workflows
- Progress tracking and reporting
- Inter-agency communication tools

**Relationship Management**: Agency agreements with caseworker assignment tracking

### 4. Family Organizations
**Business Purpose**: Family member access to youth information

**Characteristics**:
- Parents, guardians, extended family members
- Consent-based access with youth/provider approval
- Limited access scope (basic health status, appointments)
- Emergency contact capabilities

**Access Patterns**:
- Client-specific family member access
- Basic health status and appointment information
- Communication tools with care providers
- Emergency notification systems

**Relationship Management**: Consent-based authorization with relationship verification

---

## Architectural Principles

### CRITICAL PRINCIPLE: Flat Organizational Structure

**All provider organizations and provider partner organizations exist at the root level in the database** (flat structure). Provider partner relationships are tracked as **business metadata** in projection tables, **NOT as hierarchical ownership**.

**Rationale:**
- Contract/agreement expiration cannot trigger organization restructuring
- Provider organizational structure must remain stable regardless of partner relationships
- Providers may change partners or partnerships may end without affecting their organization
- Multiple provider partners may have relationships with the same provider

### Event-Sourced Architecture

All provider partner relationship state changes are captured as immutable events:
- **Events**: Stored in `domain_events` table with appropriate `stream_type`
- **Projections**: Multiple projection tables maintain queryable state for different partner types
- **Event Processors**: Update projections and manage cross-tenant access grants
- **Audit Trail**: Complete event history for compliance and legal requirements

### Bootstrap Integration

Provider partner organizations are created using the same bootstrap architecture as providers:
- Bootstrap workflow documented in `.plans/provider-management/bootstrap-workflows.md`
- Partner-specific bootstrap sequences in `.plans/provider-management/partner-bootstrap-sequence.md`
- Organizations must complete bootstrap before relationships can be established
- Cross-tenant access grants reference bootstrap completion status

---

## Organizational Structure

### Database Organization Model (Flat)

```
organizations_projection (PostgreSQL)
│
├── Analytics4Change (A4C Internal Org) - Root level
│   ├── type: 'internal'
│   ├── Roles: Super Admin, Partnership Manager
│   └── Can manage all provider partner relationships
│
├── VAR Partner ABC (Provider Partner Org) - Root level
│   ├── type: 'partner'
│   ├── partner_type: 'var'
│   ├── Roles: Partner Administrator, VAR Consultant
│   └── Access: Via cross_tenant_access_grants (future)
│
├── Juvenile Court XYZ (Provider Partner Org) - Root level
│   ├── type: 'partner'
│   ├── partner_type: 'court'
│   ├── Roles: Court Administrator, Guardian ad Litem
│   └── Access: Court order-based grants (future)
│
├── County CPS (Provider Partner Org) - Root level
│   ├── type: 'partner'
│   ├── partner_type: 'other' (social services)
│   ├── Roles: Agency Administrator, Case Worker
│   └── Access: Assignment-based grants (future)
│
├── Johnson Family Org (Provider Partner Org) - Root level
│   ├── type: 'partner'
│   ├── partner_type: 'family'
│   ├── Roles: Parent/Guardian
│   └── Access: Consent-based grants (future)
│
├── Provider A (Provider Org) - Root level
│   ├── type: 'provider'
│   ├── subdomain: 'provider-a.firstovertheline.com' ✅
│   ├── referring_partner_id: 'var_partner_abc' (if applicable)
│   └── May have relationships with multiple provider partners
│
└── Provider B (Provider Org) - Root level (No partners)
    ├── type: 'provider'
    ├── subdomain: 'provider-b.firstovertheline.com' ✅
    └── Provider-defined internal hierarchy
```

### Key Relationships (Event-Sourced Metadata)

**Tracked in PostgreSQL via organization bootstrap workflow**:

```sql
-- Provider partner relationships (type-specific projections)
var_partnerships_projection:           -- VAR-specific contracts
  partner_org_id: org_var_partner_abc
  provider_org_id: org_provider_a
  partnership_type: 'standard'
  revenue_share_percentage: 25.0
  status: 'active'

court_authorizations_projection:      -- Court order tracking
  partner_org_id: org_juvenile_court_xyz
  provider_org_id: org_provider_a
  case_number: '2024-JV-1234'
  authorization_type: 'court_order'
  status: 'active'

agency_assignments_projection:        -- Social services assignments
  partner_org_id: org_county_cps
  provider_org_id: org_provider_a
  caseworker_id: user_caseworker_123
  assignment_type: 'protective_services'
  status: 'active'

family_consents_projection:          -- Family member consents
  partner_org_id: org_johnson_family
  provider_org_id: org_provider_a
  client_id: client_youth_456
  relationship_type: 'parent'
  consent_verified: true
  status: 'active'

-- Unified cross-tenant access grants (IMPLEMENTED ✅)
cross_tenant_access_grants_projection:
  consultant_org_id: [partner_org_id]
  provider_org_id: org_provider_a
  authorization_type: 'var_contract' | 'court_order' | 'agency_assignment' | 'family_consent'
  authorization_reference: [relationship_record_id]
  status: 'active'
```

---

## Cross-Tenant Access Model

### Unified Access Grant System (IMPLEMENTED ✅)

All provider partner types use the same cross-tenant access grant infrastructure with type-specific authorization:

**Event:** `access_grant.created`

```typescript
interface AccessGrantCreatedEvent {
  id: string;
  streamId: string;  // Provider org ID
  streamType: 'access_grant';
  eventType: 'access_grant.created';
  data: {
    grant_id: string;
    consultant_user_id: string;     // Partner user
    consultant_org_id: string;      // Partner organization
    provider_org_id: string;        // Target provider
    authorization_type: 'var_contract' | 'court_order' | 'agency_assignment' | 'family_consent';
    authorization_reference: string; // Relationship record ID
    scope: {
      data_types: string[];          // Type-specific data access
      permissions: string[];         // Allowed operations
      restrictions: {
        client_specific?: string;    // Limit to specific client (court/family)
        time_limited?: string;       // Expiration date (court orders)
        phi_restricted?: boolean;    // Non-PHI only (VARs by default)
      };
    };
    granted_by: string;              // Authorizing user
    granted_at: string;
    expires_at: string | null;
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

### Authorization Type Patterns

**VAR Contract Authorization**:
```typescript
{
  authorization_type: 'var_contract',
  authorization_reference: 'partnership_uuid',
  scope: {
    data_types: ['usage_analytics', 'support_tickets', 'billing_reports'],
    permissions: ['view', 'export'],
    restrictions: {
      phi_restricted: true  // No PHI access by default
    }
  }
}
```

**Court Order Authorization**:
```typescript
{
  authorization_type: 'court_order',
  authorization_reference: 'court_authorization_uuid',
  scope: {
    data_types: ['client_records', 'medication_history', 'treatment_plans'],
    permissions: ['view', 'export'],
    restrictions: {
      client_specific: 'client_uuid',
      time_limited: '2025-12-31T23:59:59Z'
    }
  }
}
```

**Agency Assignment Authorization**:
```typescript
{
  authorization_type: 'agency_assignment',
  authorization_reference: 'assignment_uuid',
  scope: {
    data_types: ['case_notes', 'service_plans', 'progress_reports'],
    permissions: ['view', 'update', 'create'],
    restrictions: {
      client_specific: 'assigned_client_uuid'
    }
  }
}
```

**Family Consent Authorization**:
```typescript
{
  authorization_type: 'family_consent',
  authorization_reference: 'consent_uuid',
  scope: {
    data_types: ['basic_health_status', 'appointment_schedules'],
    permissions: ['view'],
    restrictions: {
      client_specific: 'family_member_client_uuid',
      phi_restricted: true  // Limited health information only
    }
  }
}
```

### RLS Policy Integration

Updated RLS policies check authorization type and reference:

```sql
CREATE POLICY "Provider partners can view data via active grants"
ON clients
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM cross_tenant_access_grants_projection ctag
    WHERE ctag.provider_org_id = clients.org_id
      AND ctag.consultant_user_id = auth.uid()
      AND ctag.status = 'active'
      AND ctag.revoked_at IS NULL
      AND (ctag.expires_at IS NULL OR ctag.expires_at > NOW())
      -- Type-specific validation
      AND (
        -- VAR: Check active partnership
        (ctag.authorization_type = 'var_contract' AND EXISTS (
          SELECT 1 FROM var_partnerships_projection vp
          WHERE vp.id = ctag.authorization_reference::uuid
            AND vp.status = 'active'
            AND (vp.contract_end_date IS NULL OR vp.contract_end_date >= CURRENT_DATE)
        ))
        OR
        -- Court: Check active court order
        (ctag.authorization_type = 'court_order' AND EXISTS (
          SELECT 1 FROM court_authorizations_projection ca
          WHERE ca.id = ctag.authorization_reference::uuid
            AND ca.status = 'active'
        ))
        OR
        -- Agency: Check active assignment
        (ctag.authorization_type = 'agency_assignment' AND EXISTS (
          SELECT 1 FROM agency_assignments_projection aa
          WHERE aa.id = ctag.authorization_reference::uuid
            AND aa.status = 'active'
        ))
        OR
        -- Family: Check valid consent
        (ctag.authorization_type = 'family_consent' AND EXISTS (
          SELECT 1 FROM family_consents_projection fc
          WHERE fc.id = ctag.authorization_reference::uuid
            AND fc.status = 'active'
            AND fc.consent_verified = true
        ))
      )
      -- Client-specific access restriction
      AND (
        ctag.scope->'restrictions'->>'client_specific' IS NULL
        OR clients.id = (ctag.scope->'restrictions'->>'client_specific')::uuid
      )
  )
);
```

---

## Database Schema

### Type-Specific Relationship Projections

**var_partnerships_projection** (VAR-specific contracts):

```sql
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

COMMENT ON TABLE var_partnerships_projection IS 'CQRS projection: VAR partnership contracts (subset of provider partner relationships)';
```

**court_authorizations_projection** (Court order tracking):

```sql
CREATE TABLE court_authorizations_projection (
  id UUID PRIMARY KEY,
  partner_org_id UUID NOT NULL REFERENCES organizations_projection(id),
  partner_org_name TEXT NOT NULL,
  provider_org_id UUID NOT NULL REFERENCES organizations_projection(id),
  provider_org_name TEXT NOT NULL,
  client_id UUID NOT NULL,  -- Specific client for court oversight
  case_number TEXT NOT NULL,
  court_type TEXT NOT NULL CHECK (court_type IN ('juvenile', 'family', 'guardian_ad_litem')),
  authorization_type TEXT NOT NULL CHECK (authorization_type IN ('court_order', 'temporary_custody', 'guardianship')),
  legal_reference TEXT NOT NULL,  -- Court order number, case reference
  authorized_data_types TEXT[] NOT NULL,
  authorized_start_date DATE NOT NULL,
  authorized_end_date DATE,  -- Court orders may have expiration
  status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'revoked')),
  court_contact_info JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (partner_org_id, provider_org_id, case_number)
);

COMMENT ON TABLE court_authorizations_projection IS 'CQRS projection: Court system authorizations for youth case oversight';
```

**agency_assignments_projection** (Social services assignments):

```sql
CREATE TABLE agency_assignments_projection (
  id UUID PRIMARY KEY,
  partner_org_id UUID NOT NULL REFERENCES organizations_projection(id),
  partner_org_name TEXT NOT NULL,
  provider_org_id UUID NOT NULL REFERENCES organizations_projection(id),
  provider_org_name TEXT NOT NULL,
  caseworker_user_id UUID NOT NULL,
  client_id UUID NOT NULL,  -- Specific client assignment
  assignment_type TEXT NOT NULL CHECK (assignment_type IN ('protective_services', 'case_management', 'social_work', 'family_services')),
  agency_type TEXT NOT NULL CHECK (agency_type IN ('cps', 'county_services', 'state_agency', 'nonprofit')),
  assignment_start_date DATE NOT NULL,
  assignment_end_date DATE,
  case_load_priority TEXT CHECK (case_load_priority IN ('low', 'medium', 'high', 'crisis')),
  status TEXT NOT NULL CHECK (status IN ('active', 'transferred', 'closed')),
  supervisor_contact JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (partner_org_id, provider_org_id, caseworker_user_id, client_id)
);

COMMENT ON TABLE agency_assignments_projection IS 'CQRS projection: Social services agency case assignments';
```

**family_consents_projection** (Family member consents):

```sql
CREATE TABLE family_consents_projection (
  id UUID PRIMARY KEY,
  partner_org_id UUID NOT NULL REFERENCES organizations_projection(id),
  partner_org_name TEXT NOT NULL,
  provider_org_id UUID NOT NULL REFERENCES organizations_projection(id),
  provider_org_name TEXT NOT NULL,
  family_member_user_id UUID NOT NULL,
  client_id UUID NOT NULL,  -- Youth family member
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('parent', 'guardian', 'sibling', 'grandparent', 'other_family')),
  consent_type TEXT NOT NULL CHECK (consent_type IN ('full_guardian', 'limited_access', 'emergency_contact')),
  consent_verified BOOLEAN NOT NULL DEFAULT FALSE,
  consent_method TEXT CHECK (consent_method IN ('in_person', 'notarized_form', 'digital_signature', 'court_appointed')),
  access_level TEXT NOT NULL CHECK (access_level IN ('basic_status', 'appointment_info', 'emergency_medical')),
  consent_start_date DATE NOT NULL,
  consent_end_date DATE,  -- May have age-based expiration
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  verification_documents JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (partner_org_id, provider_org_id, family_member_user_id, client_id)
);

COMMENT ON TABLE family_consents_projection IS 'CQRS projection: Family member access consents and relationship verification';
```

### Unified Cross-Tenant Access Grants (IMPLEMENTED ✅)

The cross-tenant access grants projection supports all provider partner types:

```sql
-- Already implemented in:
-- /infrastructure/supabase/sql/02-tables/rbac/005-cross_tenant_access_grants_projection.sql

CREATE TABLE cross_tenant_access_grants_projection (
  id UUID PRIMARY KEY,
  consultant_user_id UUID,
  consultant_org_id UUID NOT NULL,
  provider_org_id UUID NOT NULL,
  authorization_type TEXT NOT NULL CHECK (authorization_type IN (
    'var_contract', 'court_order', 'agency_assignment', 'family_consent'
  )),
  authorization_reference UUID,  -- References type-specific relationship record
  scope JSONB NOT NULL,
  granted_by UUID NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'expired', 'revoked')),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,
  revocation_reason TEXT,
  suspension_reason TEXT,
  suspended_at TIMESTAMPTZ,
  suspended_by UUID,
  reactivated_at TIMESTAMPTZ,
  reactivated_by UUID,
  legal_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

---

## Security Considerations

### HIPAA Compliance by Partner Type

**VAR Partners**: 
- Limited to non-PHI data by default (usage analytics, support metrics)
- PHI access requires explicit authorization and business associate agreements
- Revenue sharing does not typically require PHI access

**Court Systems**:
- PHI access authorized by court order with legal basis
- Time-limited access tied to case duration
- Complete audit trail required for legal compliance

**Social Services**:
- PHI access based on statutory authority and case assignment
- Caseworker-specific access with supervisor oversight
- Service coordination requires treatment plan access

**Family Members**:
- Limited PHI access based on consent and relationship verification
- Basic health status and appointment information
- Emergency medical information with appropriate authorization

### Audit Events for Cross-Tenant Access

Enhanced metadata captures provider partner context:

```typescript
{
  eventType: 'client.viewed',
  streamId: 'client_uuid',
  streamType: 'client',
  metadata: {
    userId: 'partner_user_uuid',
    orgId: 'provider_org_uuid',
    crossTenantAccess: {
      partnerOrgId: 'partner_org_uuid',
      partnerType: 'var' | 'court' | 'agency' | 'family',
      grantId: 'grant_uuid',
      authorizationType: 'var_contract' | 'court_order' | 'agency_assignment' | 'family_consent',
      authorizationReference: 'relationship_uuid',
      legalBasis: 'Court Order #2024-JV-1234' | 'CPS Assignment' | 'Parental Consent',
      dataScope: ['basic_info', 'treatment_notes'],
      accessRestrictions: {
        clientSpecific: true,
        timeLimit: '2025-12-31',
        phiRestricted: false
      }
    },
    timestamp: '2025-10-15T...'
  }
}
```

---

## Implementation Plan

### Phase 0: Foundation (COMPLETED ✅ - 2025-12-02)

**Completed:**
- ✅ Organization bootstrap workflow supports both `provider` and `partner` types
- ✅ `partner_type` enum: `var`, `family`, `court`, `other`
- ✅ Conditional subdomain provisioning (providers get DNS, partners don't)
- ✅ `referring_partner_id` field for tracking partner referrals
- ✅ 2-hop architecture: Frontend → Backend API → Temporal
- ✅ 12 activities (6 forward + 6 compensation) in bootstrap workflow

**Database Schema (Implemented)**:
```sql
-- organizations_projection supports partner organizations
CREATE TYPE organization_type AS ENUM ('provider', 'partner');
CREATE TYPE partner_type AS ENUM ('var', 'family', 'court', 'other');

-- organizations_projection includes:
--   type: organization_type (provider or partner)
--   partner_type: partner_type (for partner orgs only)
--   referring_partner_id: UUID (optional, who referred this org)
```

### Phase 1: Cross-Tenant Access (PLANNED)

**Remaining Tasks:**
1. Create `cross_tenant_access_grants_projection` table
2. Implement access grant event processors
3. Create RLS policies for cross-tenant data access
4. Build UI for managing access grants

### Phase 2: VAR Partnership Implementation

**Focus**: Complete VAR-specific relationship management as the first provider partner type

**Tasks**:
1. Implement `var_partnerships_projection` table and events
2. Create VAR partnership lifecycle management
3. Add revenue sharing and support level tracking
4. Build VAR dashboard and multi-provider access UI

### Phase 3: Court System Integration

**Focus**: Legal authorization and case-specific access

**Tasks**:
1. Implement `court_authorizations_projection` table and events
2. Create court order upload and verification workflows
3. Add time-limited access management
4. Build case-specific data access controls

### Phase 4: Social Services Integration

**Focus**: Agency assignments and caseworker access

**Tasks**:
1. Implement `agency_assignments_projection` table and events
2. Create caseworker assignment workflows
3. Add supervisor oversight and case transfer capabilities
4. Build agency coordination tools

### Phase 5: Family Access Integration

**Focus**: Consent-based family member access

**Tasks**:
1. Implement `family_consents_projection` table and events
2. Create family member registration and verification
3. Add consent management and relationship validation
4. Build family portal with limited access scope

---

## Testing Strategy

### Cross-Partner Type Testing

**Access Grant Validation**:
- [ ] VAR consultant access via active partnership
- [ ] Court official access via valid court order
- [ ] Caseworker access via agency assignment
- [ ] Family member access via verified consent
- [ ] Access denied when authorization expired/revoked

**Authorization Type Isolation**:
- [ ] VAR partnership expiration only affects VAR grants
- [ ] Court order revocation only affects court grants
- [ ] Agency assignment transfer only affects agency grants
- [ ] Family consent revocation only affects family grants

**Audit Trail Completeness**:
- [ ] Partner type captured in all cross-tenant events
- [ ] Legal basis documented for each access
- [ ] Relationship changes tracked with full history
- [ ] Compliance reports include all partner types

---

## Related Documents

### Type-Specific Implementation (Planned)
- 📋 VAR-specific implementation (future)
- 📋 Court system integration (future)
- 📋 Agency assignment workflows (future)
- 📋 Family member access (future)

### Bootstrap and Organization Management (✅ IMPLEMENTED)
- ✅ `documentation/architecture/workflows/organization-onboarding-workflow.md` - Workflow design
- ✅ `documentation/workflows/architecture/organization-bootstrap-workflow-design.md` - Detailed spec
- ✅ `documentation/architecture/data/organization-management-architecture.md` - Full architecture

### Implemented Infrastructure
- ✅ `workflows/src/workflows/organizationBootstrapWorkflow.ts` - Workflow implementation
- ✅ `workflows/src/activities/` - All 12 activities
- ✅ `workflows/src/api/routes/workflows.ts` - Backend API endpoint
- ✅ `infrastructure/supabase/sql/02-tables/organizations/` - Database schema

### Platform Architecture
- `documentation/architecture/data/multi-tenancy-architecture.md` - Multi-tenant design
- `documentation/architecture/authorization/rbac-architecture.md` - RBAC system
- `documentation/architecture/workflows/temporal-overview.md` - Workflow orchestration

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-10-15 | Restructure from VAR-specific to provider partner umbrella | VARs are one type of provider partner, not the complete concept |
| 2025-10-15 | Type-specific relationship projections | Different partner types have different relationship metadata requirements |
| 2025-10-15 | Unified cross-tenant access grants | Common authorization infrastructure across all partner types |
| 2025-10-15 | Bootstrap integration for all partner types | Consistent organization creation regardless of partner type |

---

**Document Version:** 2.2
**Last Updated:** 2025-12-02
**Status:** Foundation Implemented | Type-Specific Features Planned
**Owner:** A4C Architecture Team