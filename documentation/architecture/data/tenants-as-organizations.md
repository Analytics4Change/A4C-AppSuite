---
status: current
last_updated: 2025-01-12
---

# Provider Management & Multi-Tenancy Architecture

**Status**: ✅ Updated for Supabase Auth + Temporal.io integration
**Last Updated**: 2025-10-27
**Migration**: Zitadel → Supabase Auth (frontend complete, workflows pending)

## Document Overview
This document captures the complete architectural decisions and implementation plan for the Provider Management feature and multi-tenancy support in the A4C platform.

**Major Architecture Change**: This document has been updated to reflect the migration from Zitadel to **Supabase Auth** for authentication and **Temporal.io** for organization bootstrap workflows.

**Frontend Implementation**: ✅ Complete (2025-10-27)
- Three-mode authentication system (mock/integration/production)
- JWT custom claims integration with RLS
- See: `.plans/supabase-auth-integration/frontend-auth-architecture.md`

## Table of Contents
1. [Core Architecture Decisions](#core-architecture-decisions)
2. [Organizational Hierarchy](#organizational-hierarchy)
3. [User Roles and Access Patterns](#user-roles-and-access-patterns)
4. [Authentication and Authorization](#authentication-and-authorization)
5. [Organization Bootstrap Workflow](#organization-bootstrap-workflow)
6. [Provider Information Requirements](#provider-information-requirements)
7. [Technical Implementation Strategy](#technical-implementation-strategy)
8. [Navigation and Routes](#navigation-and-routes)

## Core Architecture Decisions

### Organizations as Database Records (Event-Sourced)

Each Provider organization is represented as **database records** in the `organizations_projection` table, derived from an event-sourced architecture. Organizations are **NOT** separate authentication tenants (unlike the previous Zitadel architecture).

#### Key Changes from Zitadel Architecture:

| Aspect | Previous (Zitadel) | Current (Supabase Auth) |
|--------|-------------------|------------------------|
| **Organizations** | Zitadel organizations | Database records (`organizations_projection`) |
| **Authentication** | Zitadel OAuth2 | Supabase Auth (social login + SAML SSO) |
| **User Management** | Zitadel Management API | Supabase Auth + Temporal workflows |
| **Multi-Tenant Isolation** | Zitadel org-level | RLS policies using JWT `org_id` claim |
| **Organization Creation** | Zitadel API + DB record | Temporal workflow emitting events |
| **User Invitations** | Zitadel invitation API | Temporal workflow + custom tokens |
| **Subdomain Provisioning** | Manual DNS | Temporal workflow + Cloudflare API |

#### Advantages of Supabase Auth + Temporal:

1. **Unified Platform**: Authentication, database, and backend in single service
2. **Event-Driven**: All state changes recorded as immutable events (CQRS)
3. **Durable Workflows**: Organization bootstrap survives crashes (Temporal)
4. **Better Social Login**: More providers, easier configuration
5. **Enterprise SSO**: SAML 2.0 support on Pro plan
6. **Simpler Architecture**: One service vs two (Supabase vs Supabase + Zitadel)
7. **Custom JWT Claims**: Via database hooks, integrated with RLS
8. **Workflow-First**: Clean compensation for rollback (Saga pattern)

#### What We Build Ourselves:

1. **Organization Management**: Via Temporal workflows + database records
2. **User Invitations**: Via Temporal workflows + secure tokens
3. **DNS Provisioning**: Via Temporal workflows + Cloudflare API
4. **Custom JWT Claims**: Via PostgreSQL database hooks
5. **Enterprise SSO Configuration**: Via Supabase CLI + Temporal workflows

### Sub-Provider Implementation (Unchanged)

Sub-providers (e.g., group homes within a larger organization) are implemented as:
- **Database records** in a hierarchical structure using `organization_units_projection` table (separate from root orgs)
- **No enforced depth limit**: ltree supports unlimited nesting levels
  - Level 1: Provider root org (e.g., "Sunshine Youth Services") - stored in `organizations_projection`
  - Level 2+: Organization units (e.g., "Northern Region", "Oak Street Group Home") - stored in `organization_units_projection`
- **Example hierarchy** (5 levels):
  ```
  root.sunshine_youth_services                          (Provider - organizations_projection)
  └── root.sunshine_youth_services.northern_region      (Region - organization_units_projection)
      └── root.sunshine_youth_services.northern_region.residential  (Division)
          └── root.sunshine_youth_services.northern_region.residential.oak_street  (Location)
              └── root.sunshine_youth_services.northern_region.residential.oak_street.unit_a  (Unit)
  ```
- **Permission inheritance**: From parent provider organization via scope_path containment
- **ltree paths**: Hierarchical queries using PostgreSQL ltree extension (`path @> scope_path`)

## Organizational Hierarchy

### CRITICAL ARCHITECTURAL PRINCIPLE

**All Provider organizations exist at the root level in the `organizations_projection` table.** VAR (Value-Added Reseller) relationships with Providers are tracked as **business metadata** in the `var_partnerships_projection` table, NOT as hierarchical ownership.

**Rationale**: VAR contract expiration cannot trigger organizational restructuring or ltree path changes. Provider organizational structure must remain stable regardless of business relationships.

### Platform-Wide Organization Structure (Flat Model)

Organizations are stored in `organizations_projection` table with ltree paths:

```
organizations_projection (PostgreSQL table)
│
├── analytics4change (type: platform_owner)
│   └── path: 'analytics4change'::ltree
│   └── Users assigned via user_roles_projection
│       ├── Super Admin role
│       ├── Provider Admin role
│       └── Support roles
│
├── var_partner_xyz (type: provider_partner, subtype: var)
│   └── path: 'var_partner_xyz'::ltree
│   └── Access to Providers via cross_tenant_access_grants
│       └── Partnership metadata in var_partnerships_projection
│
├── provider_a (type: provider)
│   └── path: 'provider_a'::ltree
│   └── Subdomain: provider-a.firstovertheline.com (via Temporal workflow)
│   ├── Sub-Provider: group_home_1
│   │   └── path: 'provider_a.group_home_1'::ltree
│   ├── Sub-Provider: group_home_2
│   │   └── path: 'provider_a.group_home_2'::ltree
│   └── May be associated with VAR via var_partnerships_projection
│
├── provider_b (type: provider)
│   └── path: 'provider_b'::ltree
│   └── Direct customer (no VAR)
│   └── Sub-Providers (nested ltree paths)
│
├── a4c_demo (type: provider)
│   └── path: 'a4c_demo'::ltree
│   └── Demo/development organization
│
└── a4c_families (type: provider_partner, subtype: family)
    └── path: 'a4c_families'::ltree
    └── Family members accessing client data via grants
```

### Database Schema

```sql
-- Organizations (CQRS projection from domain_events)
CREATE TABLE organizations_projection (
  org_id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('platform_owner', 'provider', 'provider_partner')),
  path LTREE NOT NULL UNIQUE,  -- Hierarchical path (e.g., 'provider_a.group_home_1')
  parent_org_id UUID REFERENCES organizations_projection(org_id),
  domain TEXT UNIQUE,  -- Subdomain (e.g., 'provider-a.firstovertheline.com')
  is_active BOOLEAN NOT NULL DEFAULT FALSE,  -- Activated after bootstrap
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  activated_at TIMESTAMPTZ  -- When organization bootstrap completed
);

-- GiST index for ltree queries
CREATE INDEX idx_organizations_path ON organizations_projection USING gist(path);
```

### Provider Partner Relationships (Event-Sourced Metadata)

**NOT in organizational hierarchy** - tracked in PostgreSQL via bootstrap architecture:

```sql
-- Provider partner relationships (type-specific projections) - IMPLEMENTED ✅
CREATE TABLE var_partnerships_projection (
  id UUID PRIMARY KEY,
  partner_org_id UUID NOT NULL,    -- VAR partner org UUID (provider_partner type)
  provider_org_id UUID NOT NULL,   -- Provider org UUID
  partnership_type TEXT NOT NULL,  -- 'standard' or 'white_label'
  contract_start_date DATE NOT NULL,
  contract_end_date DATE,          -- NULL = ongoing
  status TEXT CHECK (status IN ('active', 'expired', 'terminated')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- Unified cross-tenant access grants for all provider partner types - IMPLEMENTED ✅
-- See: /infrastructure/supabase/sql/02-tables/rbac/005-cross_tenant_access_grants_projection.sql
```

**Access Model (IMPLEMENTED ✅)**:
- Provider partner organizations created via **Temporal bootstrap workflow**
- Cross-tenant access grants via event-sourced `access_grant.*` events
- Grants reference relationship for authorization basis
- Partnership expiration automatically revokes grants (event-driven)
- Provider org remains unchanged when provider partner relationships end

## User Roles and Access Patterns

### Internal A4C Roles (within Analytics4Change org):
- **Super Admin**: Complete system access, can impersonate any user
- **Provider Admin**: Create and manage provider organizations, trigger bootstrap workflows

**Note**: These map to the 3-type organization system:
- **platform_owner**: Analytics4Change org (Super Admin, Provider Admin roles)
- **provider**: Healthcare provider organizations
- **provider_partner**: Provider partner organizations (VARs, courts, social services, families)

### Provider Organization Roles:
- **Administrator** (`provider_admin`): Top-level role within each provider, manages all sub-providers
- **Organization Member** (`organization_member`): Standard access within provider
- **Custom Roles**: Defined by each provider's Administrator based on RBAC system

### Provider Partner Roles:
- **Partner Administrator**: Manages provider partner organization
- **Partner Consultant**: Access to Provider data based on grants

### Key Access Rules:
- Users can belong to **one active organization at a time** (stored in `user_roles_projection.is_active`)
- Users with multiple org memberships can switch orgs (triggers JWT refresh)
- Multi-tenant isolation via RLS policies checking JWT `org_id` claim
- Cross-organization access via `cross_tenant_access_grants_projection` (event-sourced)
- JWT custom claims added via database hook during authentication

### Provider Partner Access Lifecycle:
1. **Relationship Created**: Type-specific relationship event → relationship record in projection
   - VAR: `provider_partner_relationship.created` (partnership terms)
   - Court: `court_authorization.created` (court order)
   - Agency: `agency_assignment.created` (case assignment)
   - Family: `family_consent.created` (verified consent)
2. **Grant Issued**: Admin creates cross-tenant grant for provider partner
   - Event: `access_grant.created`
   - Authorization type: `var_contract`, `court_order`, `agency_assignment`, `family_consent`
3. **Partner Accesses Data**: RLS policies check grant validity + relationship status
4. **Relationship Expires**: Background job or manual action → relationship expiration event
5. **Automatic Revocation**: Event processor emits `access_grant.revoked` events
6. **Access Denied**: RLS policies now exclude provider partner (grant revoked)

## Authentication and Authorization

### Supabase Auth Integration

**Authentication Flow**:
1. User navigates to organization subdomain (e.g., `provider-a.firstovertheline.com`)
2. Frontend initiates authentication via Supabase Auth:
   - Social login (Google, GitHub, etc.)
   - Magic link (email OTP)
   - Password-based
   - Enterprise SSO (SAML 2.0)
3. Supabase Auth generates JWT
4. Database hook adds custom claims: `org_id`, `user_role`, `permissions`, `scope_path`
5. JWT returned to frontend
6. All API requests include JWT in Authorization header
7. RLS policies enforce data isolation using JWT claims

**Custom JWT Claims**:
```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "role": "authenticated",

  // Custom claims added by database hook
  "org_id": "provider-org-uuid",
  "user_role": "provider_admin",
  "permissions": ["medication.create", "client.view", "organization.manage"],
  "scope_path": "provider_a"
}
```

**RLS Policy Example**:
```sql
CREATE POLICY "Tenant isolation"
ON clients FOR ALL
TO authenticated
USING (
  org_id = (auth.jwt()->>'org_id')::uuid
);
```

**See**: `.plans/supabase-auth-integration/` for detailed documentation.

## Organization Bootstrap Workflow

Organizations are created via **Temporal.io workflows** for durable, reliable execution.

### OrganizationBootstrapWorkflow

**Orchestrated Steps**:
1. **Create Organization**: Emit `OrganizationCreated` event
   - Creates record in `organizations_projection` (via event processor)
   - Status: `is_active = false` (activated after full bootstrap)
2. **Configure DNS Subdomain**: Call Cloudflare API
   - Create CNAME record: `{subdomain}.firstovertheline.com` → `app.firstovertheline.com`
   - Emit `DNSConfigured` event
3. **Wait for DNS Propagation**: Durable sleep (5-30 minutes)
   - Workflow survives worker crashes during wait
4. **Verify DNS Resolution**: Retry until success or timeout
   - Query DNS to confirm subdomain resolves
5. **Generate User Invitations**: Emit `UserInvited` events
   - Create secure invitation tokens
   - Store in `user_invitations_projection`
6. **Send Invitation Emails**: Email users with invitation links
   - Emit `InvitationEmailSent` / `InvitationEmailFailed` events
7. **Activate Organization**: Emit `OrganizationActivated` event
   - Updates `is_active = true` in `organizations_projection`

**Duration**: 10-40 minutes (depends on DNS propagation)

**Error Handling**: Saga pattern with compensation
- If DNS fails: Deactivate organization
- If email fails: Continue with partial success, log failures
- Automatic retries with exponential backoff

**Trigger**:
- Via API endpoint (authenticated, requires `organization.bootstrap` permission)
- Via admin UI (Provider Admin role)

**See**: `.plans/temporal-integration/organization-onboarding-workflow.md` for detailed implementation.

## Provider Information Requirements

### MVP Fields:
```typescript
interface Provider {
  // Organization Identity (from organizations_projection)
  org_id: string;
  name: string;
  type: 'provider';
  path: string;                   // ltree path
  domain: string;                 // Subdomain (e.g., 'provider-a.firstovertheline.com')
  is_active: boolean;

  // Business Profile (from organization_business_profiles_projection)
  provider_type: string;          // Data-driven from provider_types table
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

## Technical Implementation Strategy

### Event-Driven Architecture (CQRS)

**Event Store**:
```sql
CREATE TABLE domain_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_data JSONB NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,  -- Includes workflow context
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);
```

**Event Types**:
- `OrganizationCreated`
- `OrganizationActivated`
- `DNSConfigured`
- `UserInvited`
- `InvitationEmailSent`
- `InvitationEmailFailed`
- `access_grant.created`
- `access_grant.revoked`

**Event Processors** (PostgreSQL triggers):
```sql
CREATE TRIGGER trigger_process_organization_created
  AFTER INSERT ON domain_events
  FOR EACH ROW
  EXECUTE FUNCTION process_organization_created();
```

### Audit Trail

- **Domain Events**: All state changes recorded as immutable events
- **Workflow Metadata**: Events include `workflow_id`, `workflow_run_id` for traceability
- **Temporal History**: Complete workflow execution history in Temporal Web UI
- **HIPAA Compliance**: 7-year event retention

### Development Testing Strategy

- **Email Testing**: Gmail plus addressing (admin+provider1@gmail.com)
- **A4C-Demo Organization**: Safe testing environment
- **Local Temporal**: Port-forward Temporal frontend for local testing
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
  /providers/create - Triggers Temporal bootstrap workflow
  /providers/:id/view
  /providers/:id/edit

/system (Super Admin only)
  /system/users
  /system/roles
  /system/audit
  /system/workflows - Temporal workflow monitoring
```

#### A4C Partner:
```
/partner-dashboard - Glassmorphic cards of referred providers
/reports - Partner-specific metrics
```

### Dynamic Navigation Features:
1. **Role-based menu rendering**: Menu items appear/disappear based on JWT claims
2. **Provider context switcher**: Switch active organization (triggers JWT refresh)
3. **Development mode**: All routes visible with lock icons for inaccessible ones
4. **Production mode**: Only show accessible routes

### Client Route Context:
- `/clients` is provider-scoped (RLS enforces via JWT `org_id`)
- CRUD permissions based on JWT `permissions` claim
- Mock data will be migrated to real Supabase data for a4c_demo org

## Implementation Plan

### Phase 1: Supabase Auth Migration

#### Priority 1: Database Schema
- ✅ Create `organizations_projection` table with ltree paths
- ✅ Create `user_roles_projection` table
- ✅ Create `user_permissions_projection` table
- ✅ Create `user_invitations_projection` table
- ✅ Create `domain_events` event store
- ✅ Create event processor triggers

#### Priority 2: Custom JWT Claims
- Create database hook function (`auth.custom_access_token_hook`)
- Register hook with Supabase Auth
- Test JWT contains custom claims
- Update RLS policies to use JWT claims

**See**: `.plans/supabase-auth-integration/custom-claims-setup.md`

#### Priority 3: Temporal Workflow Implementation
- ✅ Create `temporal/` project structure
- Implement `OrganizationBootstrapWorkflow`
- Implement activities (create org, DNS, invitations, emails)
- Deploy worker to Kubernetes
- Test workflow end-to-end

**See**: `.plans/temporal-integration/organization-onboarding-workflow.md`

### Phase 2: Provider Management UI

Create glassmorphic UI matching existing design:
- Provider list page with search/filter
- Create provider form (triggers Temporal workflow)
- View provider with sub-provider tree visualization
- Edit provider details
- View workflow status in UI

New files:
```
/src/pages/providers/
  ├── ProviderListPage.tsx
  ├── ProviderCreatePage.tsx - Triggers Temporal workflow
  ├── ProviderDetailPage.tsx
  └── ProviderManagementLayout.tsx

/src/viewModels/providers/
  ├── ProviderListViewModel.ts
  └── ProviderFormViewModel.ts

/src/services/providers/
  ├── provider.service.ts
  └── temporal-client.service.ts - Triggers workflows

/src/types/provider.types.ts
```

### Phase 3: Migration from Mock Data

- Move mock data to Supabase
- Scope to a4c_demo organization
- Implement RLS policies using JWT claims
- Test multi-tenant isolation

### Phase 4: Enterprise SSO (3-6 Months)

- Configure Supabase SAML providers
- Implement per-organization SSO configuration
- Create SSO configuration workflow (Temporal)
- Test with customer IdP sandbox

**See**: `.plans/supabase-auth-integration/enterprise-sso-guide.md`

---

## Related Documentation

- **Supabase Auth Integration**: `.plans/supabase-auth-integration/overview.md`
- **Custom JWT Claims**: `.plans/supabase-auth-integration/custom-claims-setup.md`
- **Enterprise SSO**: `.plans/supabase-auth-integration/enterprise-sso-guide.md`
- **Temporal Integration**: `.plans/temporal-integration/overview.md`
- **Organization Bootstrap Workflow**: `.plans/temporal-integration/organization-onboarding-workflow.md`
- **RBAC Architecture**: `.plans/rbac-permissions/architecture.md`

---

**Document Version**: 2.0
**Last Updated**: 2025-10-24
**Major Changes**: Migrated from Zitadel to Supabase Auth + Temporal.io workflows
