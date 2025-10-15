# Provider Management & Multi-Tenancy Architecture

## Document Overview
This document captures the complete architectural decisions and implementation plan for the Provider Management feature and multi-tenancy support in the A4C platform. It represents the conversation and decisions made during the design phase of the `feat/auth-integration` branch.

## Table of Contents
1. [Core Architecture Decisions](#core-architecture-decisions)
2. [Organizational Hierarchy](#organizational-hierarchy)
3. [User Roles and Access Patterns](#user-roles-and-access-patterns)
4. [Provider Information Requirements](#provider-information-requirements)
5. [Technical Implementation Strategy](#technical-implementation-strategy)
6. [Navigation and Routes](#navigation-and-routes)
7. [Implementation Plan](#implementation-plan)

## Core Architecture Decisions

### Providers as Zitadel Organizations

After careful consideration of multi-tenancy patterns, we've decided that **each Provider should be its own Zitadel Organization**. This decision was based on several key factors:

#### Advantages of Separate Organizations:
1. **True Multi-Tenant Isolation**: Complete data and user separation between providers
2. **Built-in Cross-Provider Grants**: Zitadel's Project Grants handle cross-organization access elegantly
3. **Security & Compliance**: Isolated authentication per provider, critical for healthcare
4. **Clean RLS Integration**: Direct mapping of organization_id to Supabase row-level security
5. **Provider-Specific Policies**: Each provider can have unique security requirements (MFA, password policies)

#### Alternative Considered (Rejected):
- **Single Organization with Metadata**: Simpler but less secure, would require complex permission logic

#### Implementation Approach:
```typescript
// Abstraction to hide complexity
class ProviderManagementService {
  async createProvider(providerData) {
    // 1. Create Zitadel Organization via Management API
    const org = await zitadelAPI.createOrganization({
      name: providerData.name,
      // Set default roles, policies
    });

    // 2. Create Supabase provider record
    const provider = await supabase.providers.insert({
      id: org.id, // Use Zitadel org ID as provider ID
      ...providerData,
      organization_id: org.id
    });

    // 3. Setup default admin user with email invitation
    // 4. Configure RLS policies

    return provider;
  }
}
```

### Sub-Provider Implementation

Sub-providers (e.g., group homes within a larger organization) will be implemented as:
- **Database records** in a hierarchical structure (not separate Zitadel orgs)
- **Maximum depth**: 3 levels
  - Level 1: Provider (e.g., "Sunshine Youth Services")
  - Level 2: Region/Division (e.g., "Northern Region")
  - Level 3: Location (e.g., "Oak Street Group Home")
- **Permission inheritance**: From parent provider organization
- **No separate billing**: Inherits from parent provider

## Organizational Hierarchy

### CRITICAL ARCHITECTURAL PRINCIPLE

**All Provider organizations exist at the root level in Zitadel.** VAR (Value-Added Reseller) relationships with Providers are tracked as **business metadata** in the `var_partnerships_projection` table, NOT as hierarchical ownership in Zitadel.

**Rationale**: VAR contract expiration cannot trigger Zitadel organization restructuring or ltree path changes. Provider organizational structure must remain stable regardless of business relationships.

### Platform-Wide Zitadel Organization Structure (Flat Model)

```
Zitadel Instance: analytics4change-zdswvg.us1.zitadel.cloud
│
├── Analytics4Change (Zitadel Org) - Internal A4C Organization
│   ├── Super Admin (role) - Can manage all providers
│   ├── Provider Admin (role) - Can create/manage providers
│   ├── Support roles - Created by Super Admin for impersonation
│   └── Internal A4C users
│
├── VAR Partner XYZ (Zitadel Org) - Value Added Reseller/Partner
│   ├── Administrator (static role)
│   ├── Partner-specific roles
│   └── Access: Via cross_tenant_access_grants (NOT hierarchical ownership)
│       └── Partnership metadata in var_partnerships_projection table
│
├── Provider A (Zitadel Org) - Healthcare Provider Organization
│   ├── Administrator (static role - top-level admin for entire provider)
│   ├── Custom roles (defined by Administrator)
│   ├── Sub-Provider: Group Home 1 (database record, not separate Zitadel org)
│   ├── Sub-Provider: Group Home 2 (database record, not separate Zitadel org)
│   └── Sub-Provider: Residential Facility (database record, not separate Zitadel org)
│   └── Note: May be associated with VAR via var_partnerships_projection
│
├── Provider B (Zitadel Org) - Direct Customer (No VAR)
│   ├── Administrator
│   ├── Custom roles
│   └── Sub-Providers (database records)
│
├── A4C-Demo (Zitadel Org) - Demo/Development Provider
│   ├── Administrator (for testing)
│   ├── Demo data for sales/development
│   └── Safe impersonation testing environment
│
└── A4C-Families (Zitadel Org) - Shared Family Access
    └── Family members accessing client data via grants
```

### VAR Partnership Model (Event-Sourced Metadata)

**NOT in Zitadel hierarchy** - tracked in PostgreSQL:

```sql
-- CQRS projection table (never updated directly)
CREATE TABLE var_partnerships_projection (
  id UUID PRIMARY KEY,
  var_org_id UUID NOT NULL,        -- VAR Partner XYZ's org UUID
  provider_org_id UUID NOT NULL,   -- Provider A's org UUID
  contract_start_date DATE NOT NULL,
  contract_end_date DATE,          -- NULL = ongoing
  status TEXT CHECK (status IN ('active', 'expired', 'terminated')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

**Access Model**:
- VAR gets cross-tenant access grants to Provider data
- Grants reference partnership for authorization basis
- Partnership expiration automatically revokes grants (event-driven)
- Provider Zitadel org remains unchanged when VAR relationship ends

## User Roles and Access Patterns

### Internal A4C Roles (within Analytics4Change org):
- **Super Admin**: Complete system access, can impersonate any user, create support roles
- **Provider Admin**: Create and manage provider organizations, set up initial administrators

### Provider Organization Roles:
- **Administrator**: Top-level role within each provider, manages all sub-providers and defines custom roles
- **Custom Roles**: Defined by each provider's Administrator based on their needs

### VAR Partner Roles:
- **VAR Administrator**: Manages VAR organization
- **VAR Consultant**: Access to Provider data based on grants

### Key Access Rules:
- Users can belong to multiple sub-providers within the same provider organization
- Users CANNOT belong to multiple provider organizations (would require separate logins)
- Cross-organization access via `cross_tenant_access_grants_projection` table (event-sourced)
- VAR Partners access Provider data through grants (NOT hierarchical ownership):
  - Grants created when partnership is active
  - Grants reference `var_partnerships_projection` for authorization basis
  - Grants automatically revoked when partnership expires (event-driven)
  - Provider org structure unchanged when VAR relationship ends

### VAR Access Lifecycle:
1. **Partnership Created**: `var_partnership.created` event → partnership record in projection
2. **Grant Issued**: Super Admin creates cross-tenant grant for VAR
   - Event: `access_grant.created`
   - Authorization type: `var_contract`
   - Legal reference: partnership UUID
3. **VAR Accesses Data**: RLS policies check grant validity + partnership status
4. **Contract Expires**: Background job detects expiration → `var_partnership.expired` event
5. **Automatic Revocation**: Event processor emits `access_grant.revoked` events
6. **Access Denied**: RLS policies now exclude VAR (grant revoked)

## Provider Information Requirements

### MVP Fields:
```typescript
interface Provider {
  // Basic Information
  id: string;                    // Matches Zitadel org_id
  name: string;
  type: string;                   // Data-driven from provider_types table
  status: 'pending' | 'active' | 'suspended' | 'inactive';

  // Primary Contact
  primary_contact_name: string;
  primary_contact_email: string;
  primary_contact_phone: string;
  primary_address: string;

  // Billing Contact
  billing_contact_name: string;
  billing_contact_email: string;
  billing_contact_phone: string;
  billing_address: string;
  tax_id: string;

  // Subscription
  subscription_tier_id: string;  // References subscription_tiers table
  service_start_date: Date;

  // Metadata
  metadata: Record<string, any>; // Flexible field for future expansion
}
```

### Provider Types (Data-Driven):
- Group Home
- Detention Center
- Psychiatric Facility (In-patient)
- Family-Based Provider
- Residential Treatment Facility
- Other (with description)

### Subscription Model:
- Data-driven tiers (stored in database, not hard-coded)
- Initially single tier, but architecture supports multiple
- No payment processor integration initially (just store billing info)

### Future Considerations (Post-MVP):
- Licensing information
- Capacity metrics
- Service authorizations
- Compliance tracking
- Insurance information
- Staff ratios

## Technical Implementation Strategy

### Database Architecture

#### Audit Trail:
Using Supabase's built-in capabilities:
- **pg_audit extension** for automatic change tracking
- **Postgres triggers** to capture changes to audit_log table
- **Supabase Realtime** for event streaming (can replace Kafka)
- Every change tracked with: who, what, when, old values, new values

#### Schema Design:
```sql
-- Core provider table with all essential fields
CREATE TABLE providers (
  id UUID PRIMARY KEY, -- Matches Zitadel org_id
  -- ... fields as defined above
  metadata JSONB DEFAULT '{}', -- Extensible for future fields
);

-- Hierarchical sub-providers
CREATE TABLE sub_providers (
  id UUID PRIMARY KEY,
  provider_id UUID REFERENCES providers(id),
  parent_id UUID REFERENCES sub_providers(id), -- Self-referential for hierarchy
  level INT CHECK (level <= 3), -- Enforce maximum depth
);

-- Data-driven configuration tables
CREATE TABLE provider_types (/* ... */);
CREATE TABLE subscription_tiers (/* ... */);

-- Comprehensive audit trail
CREATE TABLE audit_log (
  -- Captures all changes with user context
);
```

### Development Testing Strategy:
- **Email Testing**: Gmail plus addressing (admin+provider1@gmail.com)
- **A4C-Demo Organization**: Safe testing environment
- **Environment Flags**: `VITE_DEV_SHOW_ALL_ROUTES=true` for development visibility

## Navigation and Routes

### Route Structure by Role:

#### Provider Staff (Regular Users):
```
/clients - Their provider's clients only
/medications - Client-specific medications
/reports - Provider-scoped reports
/settings - Personal settings
```

#### Provider Administrator:
All staff routes plus:
```
/settings/organization - Provider configuration
/settings/users - User management
/settings/sub-providers - Sub-provider hierarchy
/settings/roles - Custom role definitions
```

#### A4C Provider Admin/Super Admin:
All routes plus:
```
/providers - Provider Management (MAIN DELIVERABLE)
  /providers/list
  /providers/create
  /providers/:id/view
  /providers/:id/edit

/system (Super Admin only)
  /system/users
  /system/roles
  /system/audit
```

#### A4C Partner:
```
/partner-dashboard - Glassmorphic cards of referred providers
/reports - Partner-specific metrics
```

### Dynamic Navigation Features:
1. **Role-based menu rendering**: Menu items appear/disappear based on user roles
2. **Provider context switcher**: In both header and sidebar initially
3. **Development mode**: All routes visible with lock icons for inaccessible ones
4. **Production mode**: Only show accessible routes

### Client Route Context:
- `/clients` is provider-scoped (users see only their provider's clients)
- CRUD permissions based on roles within that provider
- Mock data will be migrated to real Supabase data for A4C-Demo org

### Medication Architecture (Future):
Template/Instance pattern similar to OOP:
- **Templates** (Classes): Reusable medication definitions at provider level
- **Instances** (Objects): Client-specific medication assignments with customizations

## Implementation Plan

### Phase 1: Current Branch (feat/auth-integration)

#### Priority 1: Documentation
- ✅ Create this architecture document at `/docs/plans/feat-auth-integration/tenants-as-organization-thoughts.md`

#### Priority 2: A4C-Demo Organization
- Create demo organization in Zitadel
- Set up demo Administrator with email invitation
- Implement Super Admin impersonation capability

#### Priority 3: Provider Management UI (Main Deliverable)
Create glassmorphic UI matching existing design:
- Provider list page with search/filter
- Create provider form with admin invitation
- View provider with sub-provider tree visualization
- Edit provider details

New files:
```
/src/pages/providers/
  ├── ProviderListPage.tsx
  ├── ProviderCreatePage.tsx
  ├── ProviderDetailPage.tsx
  └── ProviderManagementLayout.tsx

/src/viewModels/providers/
  ├── ProviderListViewModel.ts
  └── ProviderFormViewModel.ts

/src/services/providers/
  ├── provider.service.ts
  └── zitadel-provider.service.ts

/src/types/provider.types.ts
```

#### Priority 4: Client Data Migration
- Move mock data to Supabase
- Scope to A4C-Demo organization
- Implement proper RLS policies

#### Priority 5: Dynamic Navigation
- Update MainLayout with role-based rendering
- Add provider/sub-provider context switchers
- Implement development visibility mode

### Phase 2: Next Branch
- Medication template system
- Sub-provider management UI
- A4C Partner dashboard
- Advanced audit visualization

## User Interaction Log

### Initial Requirements (User):
- Provider Management for tenant management
- Providers are care providers for at-risk youth (group homes, detention centers, etc.)
- Glassmorphic styling matching existing UI
- Integration with Zitadel for organizations
- Row-level security in Supabase

### Key Decisions Made Through Discussion:
1. **Providers = Zitadel Organizations** (after cost/complexity analysis)
2. **Sub-providers as database records** (not separate Zitadel orgs)
3. **Role hierarchy**: Super Admin → Provider Admin → Administrator → Custom roles
4. **A4C Partners** as separate tenant type for VARs
5. **Billing info storage only** (no payment processor initially)
6. **Audit trail required** (using Supabase features)
7. **Dynamic navigation** based on roles
8. **A4C-Demo organization** for safe testing
9. **Provider/sub-provider context switchers** in both header and sidebar
10. **Development mode** showing all routes with visual indicators

### Implementation Priorities Confirmed:
1. Documentation (this file)
2. Provider Management UI (main deliverable)
3. A4C-Demo setup
4. Client data migration from mocks
5. Dynamic navigation

---

*Document created: 2025-01-28*
*Branch: feat/auth-integration*
*Author: Agent + User collaboration*