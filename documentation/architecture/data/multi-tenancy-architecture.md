---
status: current
last_updated: 2025-12-30
converted_from: .plans/multi-tenancy/multi-tenancy-organization.html
migration_note: "Converted from HTML and updated from Zitadel to Supabase Auth architecture"
original_version: 1.0
original_date: 2025-09-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Multi-tenant data isolation using PostgreSQL Row-Level Security (RLS) with JWT claims. Every data table has `org_id` column and RLS policies that check `jwt->>'org_id'` to enforce tenant isolation at database layer.

**When to read**:
- Creating new tables that need tenant isolation
- Understanding how data isolation is enforced
- Debugging cross-tenant data access issues
- Implementing organization hierarchy features

**Prerequisites**:
- Familiarity with PostgreSQL RLS
- Read: [custom-claims-setup.md](../authentication/custom-claims-setup.md)

**Key topics**: `multi-tenancy`, `rls`, `org_id`, `tenant-isolation`, `jwt-claims`, `postgresql`

**Estimated read time**: 20 minutes
<!-- TL;DR-END -->

# Analytics4Change Multi-Tenant Architecture Specification



**Version:** 1.0 \| **Date:** September 30, 2025 \| **Status:**
Final
Design Document









## 📋 Table of Contents

- [1. Executive Summary](#section-1)
- [2. System Architecture Overview](#section-2)
- [3. Authentication & Authorization](#section-3)
- [4. Multi-Tenancy Implementation](#section-4)
- [5. SSO Configuration Strategy](#section-5)
- [6. Tenant Identification & Routing](#section-6)
- [7. Organizational Hierarchy Management](#section-7)
- [8. Tenant Onboarding Flow](#section-8)
- [9. Data Architecture](#section-9)
- [10. Security & Compliance](#section-10)
- [11. User Experience & UI](#section-11)
- [12. Technical Setup Guide](#section-12)
- [13. Implementation Roadmap](#section-13)
- [14. Appendix](#section-14)





## 1. Executive Summary

### 1.1 Project Overview

Analytics4Change (A4C) is implementing a multi-tenant B2B SaaS platform
with enterprise-grade identity and access management powered by Zitadel
Cloud.

### 1.2 Key Architectural Decisions

| Category              | Decision                                    | Status                                                  |
|-----------------------|---------------------------------------------|---------------------------------------------------------|
| **Identity Provider** | Supabase Auth (Free Plan)                   | ✅ Confirmed |
| **Tenant Isolation**  | Database organization records with RLS policies         | ✅ Confirmed |
| **Hierarchy Model**   | Unlimited depth using PostgreSQL ltree      | ✅ Confirmed |
| **Tenant Routing**    | Subdomain-based (\*.yourapp.com)            | ✅ Confirmed |
| **Data Storage**      | Shared database with tenant_id + RLS        | ✅ Confirmed |
| **SSO Strategy**      | Instance-level social, org-level enterprise | ✅ Confirmed |
| **Onboarding**        | Manual admin-created tenants                | ✅ Confirmed |
| **Caching**           | Redis for state management & lookups        | ✅ Confirmed |

### 1.3 Technology Stack

- **Identity Platform:** Supabase Auth
- **Database:** Supabase (PostgreSQL with ltree extension)
- **Cache:** Redis (Kubernetes-hosted)
- **Infrastructure:** Kubernetes cluster
- **DNS/CDN:** Cloudflare (provider-agnostic implementation)





## 2. System Architecture Overview

### 2.1 High-Level Architecture



┌─────────────────────────────────────────────────────────────┐ │
Internet / Users │
└────────────────────────┬────────────────────────────────────┘ │ ▼
┌─────────────────────────────────────────────────────────────┐ │
Cloudflare (DNS/CDN) │ │ - Wildcard DNS: \*.yourapp.com │ │ - Custom
domains (Post-launch) │
└────────────────────────┬────────────────────────────────────┘ │ ▼
┌─────────────────────────────────────────────────────────────┐ │
Kubernetes Cluster (Application) │ │ │ │
┌──────────────────────────────────────────────────────┐ │ │ │
Application Layer │ │ │ │ - Subdomain parsing middleware │ │ │ │ -
Tenant context resolution │ │ │ │ - Authorization middleware │ │ │ │ -
API endpoints │ │ │
└──────────────────────────────────────────────────────┘ │ │ │ │ │
┌──────────────────────┼───────────────────────────────┐ │ │ │ Redis
Cache │ │ │ │ - OAuth state │ │ │ │ - Tenant lookups │ │ │ │ - User
sessions │ │ │ └──────────────────────────────────────────────────────┘
│ └─────────────────────────┬────────────────────────────────────┘ │
┌────────────────┴────────────────┐ │ │ ▼ ▼ ┌──────────────────────┐
┌──────────────────────┐ │ Supabase Auth │ │ Supabase │ │ -
Organizations │ │ - PostgreSQL │ │ - Users │ │ - ltree extension │ │ -
SSO configs │ │ - RLS policies │ │ - OIDC/OAuth │ │ - Application data │
└──────────────────────┘ └──────────────────────┘



### 2.2 Authentication Flow



**User Authentication Process:**

1.  User visits: customer-abc.yourapp.com
2.  App extracts subdomain "customer-abc"
3.  App queries Redis cache for tenant (with Supabase fallback)
4.  Generate OAuth state token, store in Redis (10 min TTL)
5.  Build OIDC auth URL with organization context
6.  Redirect to Supabase Auth login
7.  User authenticates (password/SSO/social)
8.  Supabase Auth redirects back with code + state
9.  App retrieves tenant context from Redis
10. Exchange code for tokens
11. Verify token's org matches expected tenant
12. Create session with tenant context
13. User logged in to customer-abc.yourapp.com







## 3. Authentication & Authorization

### 3.1 Organization Structure in Supabase

**Decision:** Database organization records with RLS policies
Confirmed

**Implementation:**

- Each customer tenant = separate Database organization record
- AnalyticsForChange organization hosts A4C Portal project
- Service user with IAM_OWNER role manages all organizations

**Benefits:**

- ✅ Clean tenant isolation
- ✅ Tenant-specific SSO configurations
- ✅ Clear security boundaries
- ✅ Independent branding per tenant

### 3.2 Service User Configuration

|               |                                      |
|---------------|--------------------------------------|
| **Role:**     | IAM_OWNER (Instance-level)           |
| **Location:** | AnalyticsForChange organization      |
| **Purpose:**  | Automated tenant and user management |

**Capabilities:**

- Create new Database organization records
- Create users in any organization
- Configure organization-level identity providers
- Manage roles and permissions across organizations
- Grant project access to organizations



**Security Note:** Service user credentials are stored in Kubernetes
secrets, access is limited to backend services only, and all operations
are logged for audit.



### 3.3 Role Structure (Hybrid Approach)

#### Zitadel Roles (Defined in A4C Portal Project)

- `provider_admin` - Full tenant management
- `manager` - Limited management capabilities
- `member` - Standard user access
- `viewer` - Read-only access

#### Application-Level Roles (Stored in Database)

- `super_admin` - Full platform access (AnalyticsForChange staff)
- `support_agent` - Read-only cross-tenant access
- `sales_agent` - Limited sales operations



**Why Hybrid?** Application roles enable cross-tenant operations for
internal staff and support complex business logic that Zitadel's RBAC
cannot handle alone.







## 4. Multi-Tenancy Implementation

### 4.1 Tenant Data Storage Strategy

**Approach:** Shared database with Row-Level Security (RLS)

**Every data table includes tenant reference:**

    CREATE TABLE example_data (
      id UUID PRIMARY KEY,
      organization_id UUID REFERENCES organizations(id) NOT NULL,
      -- other columns...
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX example_data_org_id_idx ON example_data(organization_id);

### 4.2 Row-Level Security (RLS) Policies

    ALTER TABLE example_data ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "Tenant isolation"
    ON example_data FOR SELECT
    USING (
      organization_id IN (
        SELECT id FROM organizations
        WHERE path <@ (
          SELECT path FROM organizations
          WHERE zitadel_org_id = auth.jwt() ->> 'urn:zitadel:iam:org:id'
        )
      )
    );



**RLS Benefits:**

- Database-level enforcement (cannot be bypassed)
- Automatic tenant isolation
- Supports organizational hierarchy
- No application-level filtering needed







## 5. SSO Configuration Strategy

### 5.1 Social Login Providers (Instance-Level)

**Configuration:** Instance-level (shared across all tenants)

| Provider       | Configuration Level | Status                                         |
|----------------|---------------------|------------------------------------------------|
| Google OAuth   | Instance            | MVP |
| Facebook OAuth | Instance            | MVP |
| Apple Sign In  | Instance            | MVP |

### 5.2 Enterprise SSO Providers (Organization-Level)

**Configuration:** Organization-level (per tenant)

**Timeline:** Post-Launch

- Azure AD / Entra ID
- Okta
- Google Workspace (with domain restrictions)
- Generic OIDC
- SAML 2.0



**MVP Approach:** Scaffold support for enterprise SSO in database schema
and UI, but implement post-launch when enterprise customers request it.







## 6. Tenant Identification & Routing

### 6.1 Subdomain-Based Routing (Primary)

**Pattern:** `{tenant-slug}.yourapp.com`

**Examples:**

- `customer-abc.yourapp.com` → Tenant: "Customer ABC"
- `acme-corp.yourapp.com` → Tenant: "Acme Corp"
- `bigenterprise-na.yourapp.com` → Tenant: "BigEnterprise North America"

### 6.2 DNS Configuration (Cloudflare)

|            |                                     |
|------------|-------------------------------------|
| **Type:**  | CNAME                               |
| **Name:**  | \*                                  |
| **Value:** | your-kubernetes-ingress.example.com |
| **Proxy:** | Enabled (Cloudflare orange cloud)   |

### 6.3 Provider-Agnostic Subdomain Provisioning



**Design Pattern:** Implementation uses dependency injection to ensure
DNS provider can be swapped (Cloudflare → Route53 → Azure DNS) without
code changes.



### 6.4 Role Impersonation

AnalyticsForChange organization members (super admins, support agents)
can view/manage any tenant without switching subdomains.





## 7. Organizational Hierarchy Management

### 7.1 Hierarchy Model

**Decision:** Unlimited depth using PostgreSQL ltree extension
Confirmed



**⚠️ CRITICAL ARCHITECTURAL PRINCIPLE:** All Provider organizations
exist at root level. VAR (Value-Added Reseller) relationships are
tracked as metadata in `var_partnerships_projection` table, NOT as
hierarchical ownership. This ensures Provider ltree paths remain stable
when VAR contracts expire.



**Path Format:** `root.segment1.segment2.segment3...`

#### Platform-Wide Structure (Flat Provider Model)



root (AnalyticsForChange Platform - Virtual Root) ├──
root.org_a4c_internal (A4C Internal Organization) ├──
root.org_acme_healthcare (Provider - Direct Customer) │ ├──
root.org_acme_healthcare.north_campus │ └──
root.org_acme_healthcare.outpatient_services ├── root.org_sunshine_youth
(Provider - VAR Customer) │ ├── root.org_sunshine_youth.home_1 │ ├──
root.org_sunshine_youth.home_2 │ └── root.org_sunshine_youth.home_3 ├──
root.org_var_partner_xyz (Provider Partner - VAR) └──
root.org_families_shared (Shared Family Access)





**Key Principles:**

- **Flat Provider Structure:** All Providers at root level (not nested
  under VARs)
- **VAR Relationships are Metadata:** Tracked in
  `var_partnerships_projection` table
- **Provider-Defined Hierarchies:** No prescribed structure below
  Provider root
- **ltree Path Stability:** Provider paths NEVER change due to business
  relationships



#### Real-World Provider Hierarchy Examples

**Example 1: Group Home Provider (Simple Flat Structure)**



root.org_homes_inc ├── root.org_homes_inc.home_1 ├──
root.org_homes_inc.home_2 ├── root.org_homes_inc.home_3 └──
root.org_homes_inc.home_4



**Example 2: Residential Treatment Center (Campus-Based Structure)**



root.org_healing_horizons ├── root.org_healing_horizons.north_campus │
├── root.org_healing_horizons.north_campus.residential_unit_a │ ├──
root.org_healing_horizons.north_campus.residential_unit_b │ └──
root.org_healing_horizons.north_campus.outpatient_clinic ├──
root.org_healing_horizons.south_campus │ ├──
root.org_healing_horizons.south_campus.residential_unit_c │ └──
root.org_healing_horizons.south_campus.family_therapy_center └──
root.org_healing_horizons.administrative_office



**Example 3: Detention Center (Complex Hierarchical Structure)**



root.org_youth_detention_services └──
root.org_youth_detention_services.main_facility ├──
root.org_youth_detention_services.main_facility.intake_unit ├──
root.org_youth_detention_services.main_facility.general_population │ ├──
root.org_youth_detention_services.main_facility.general_population.pod_a
│ ├──
root.org_youth_detention_services.main_facility.general_population.pod_b
│ └──
root.org_youth_detention_services.main_facility.general_population.pod_c
├──
root.org_youth_detention_services.main_facility.behavioral_health_wing │
├──
root.org_youth_detention_services.main_facility.behavioral_health_wing.crisis_stabilization
│ └──
root.org_youth_detention_services.main_facility.behavioral_health_wing.treatment_program
└── root.org_youth_detention_services.main_facility.education_services



### 7.2 Database Schema

    CREATE EXTENSION IF NOT EXISTS ltree;

    -- Organizations Projection Table (CQRS)
    -- Source of truth: organization.* events in domain_events table
    CREATE TABLE organizations_projection (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT,
      slug TEXT UNIQUE NOT NULL,
      zitadel_org_id TEXT UNIQUE, -- NULL for sub-organizations
      type TEXT NOT NULL CHECK (type IN (
        'platform_owner',    -- A4C internal organization (impersonation capability)
        'provider',          -- Healthcare organizations serving clients (data owners)
        'provider_partner'   -- External stakeholders (VARs, families, courts - access via grants)
      )),
      path LTREE NOT NULL UNIQUE,
      parent_path LTREE,
      depth INTEGER GENERATED ALWAYS AS (nlevel(path)) STORED,
      
      -- Lifecycle management
      is_active BOOLEAN DEFAULT true,
      deactivated_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Business Profiles for top-level organizations only
    CREATE TABLE organization_business_profiles_projection (
      organization_id UUID PRIMARY KEY REFERENCES organizations_projection(id),
      organization_type TEXT NOT NULL CHECK (organization_type IN ('provider', 'provider_partner')),
      provider_profile JSONB,     -- Provider-specific business data
      partner_profile JSONB,      -- Provider Partner-specific business data
      mailing_address JSONB,
      physical_address JSONB,
      created_at TIMESTAMPTZ NOT NULL,
      
      CHECK (
        (organization_type = 'provider' AND provider_profile IS NOT NULL AND partner_profile IS NULL)
        OR
        (organization_type = 'provider_partner' AND partner_profile IS NOT NULL AND provider_profile IS NULL)
      )
    );

    -- Performance indexes for hierarchy queries
    CREATE INDEX organizations_path_gist_idx ON organizations_projection USING GIST (path);
    CREATE INDEX organizations_path_btree_idx ON organizations_projection USING BTREE (path);
    CREATE INDEX organizations_type_idx ON organizations_projection(type);
    CREATE INDEX organizations_active_idx ON organizations_projection(is_active) WHERE is_active = true;

### 7.3 Query Examples

    -- Get all organizational units within a Provider
    SELECT * FROM organizations_projection
    WHERE path <@ 'root.org_acme_healthcare'
      AND deleted_at IS NULL;

    -- Get immediate children only (first-level units)
    SELECT * FROM organizations_projection
    WHERE path ~ 'root.org_acme_healthcare.*{1}'
      AND deleted_at IS NULL;

    -- Get all ancestors of a specific unit
    SELECT * FROM organizations_projection
    WHERE 'root.org_acme_healthcare.north_campus.residential_unit_a' <@ path
      AND deleted_at IS NULL
    ORDER BY nlevel(path);

    -- Get all active Providers (root-level organizations)
    SELECT * FROM organizations_projection
    WHERE nlevel(path) = 2  -- root.org_* = level 2
      AND type = 'provider'
      AND is_active = true
      AND deleted_at IS NULL;

    -- Get Provider with business profile
    SELECT o.*, bp.provider_profile, bp.mailing_address
    FROM organizations_projection o
    LEFT JOIN organization_business_profiles_projection bp ON bp.organization_id = o.id
    WHERE o.type = 'provider'
      AND o.deleted_at IS NULL;

    -- Get all Provider Partners (VARs, families, courts)
    SELECT * FROM organizations_projection
    WHERE type = 'provider_partner'
      AND is_active = true
      AND deleted_at IS NULL;





## 8. Tenant Onboarding Flow

### 8.1 Onboarding Method

**Decision:** Manual admin-created tenants
Confirmed

### 8.2 Process Flow

1.  Sales/Admin decides to onboard customer
2.  Super Admin accesses admin panel
3.  Fill tenant creation form (company name, subdomain, admin details)
4.  System validates input
5.  Backend creates tenant:
    - Create Database organization record
    - Provision subdomain (DNS)
    - Create database record
    - Create Provider Admin role
    - Create admin user in Zitadel
    - Grant project access
    - Generate invitation token
    - Send invitation email
6.  Admin receives invitation email
7.  Admin clicks link and sets password/passkey
8.  Admin completes setup
9.  Redirect to tenant dashboard

### 8.3 Invitation System

**Token Expiration:** 48 hours

**Email Template:** Professional invitation with branding

**Acceptance Flow:** Set password or register passkey, accept terms,
complete profile





## 9. Data Architecture

### 9.1 Core Tables

- **organizations_projection:** Tenant hierarchy (ltree)
- **users:** User profiles linked to organizations
- **domain_events:** Immutable event store (audit trail via event metadata)
- **invitations_projection:** Onboarding invitations
- **\[application_data\]:** All include organization_id

### 9.2 Caching Strategy

| Data Type                      | TTL        | Priority |
|--------------------------------|------------|----------|
| Tenant lookups (slug → org ID) | 5 minutes  | High     |
| OAuth state tokens             | 10 minutes | Critical |
| User sessions                  | 1 hour     | High     |
| Organization hierarchies       | 1 hour     | Medium   |
| User permissions/roles         | 10 minutes | High     |

### 9.3 Audit Logging

**Comprehensive logging includes:**

- ✅ Authentication events (login, logout, failures)
- ✅ Tenant creation/modification/deletion
- ✅ User management actions
- ✅ Data access (read, write, update, delete)
- ✅ Configuration changes
- ✅ API calls (all endpoints)
- ✅ Permission violations

**Retention:**

- Active logs: 90 days in hot storage
- Archive: 7 years in cold storage





## 10. Security & Compliance

### 10.1 Multi-Factor Authentication (MFA)

**Policy:**

- ✅ **Required** for all top-level organization admins
- 🔧 **Optional** for tenant users (tenant decides)

**Supported Methods:**

- Authenticator App (TOTP)
- Security Key (U2F/WebAuthn)
- SMS (not recommended for high security)

### 10.2 Data Encryption

|                           |                                            |
|---------------------------|--------------------------------------------|
| **At Rest:**              | AES-256 (Supabase default)                 |
| **In Transit:**           | HTTPS/TLS 1.3                              |
| **Database Connections:** | SSL/TLS                                    |
| **Sensitive Fields:**     | Application-level encryption (AES-256-GCM) |

### 10.3 Security Headers

- Content Security Policy (CSP)
- HTTP Strict Transport Security (HSTS)
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin

### 10.4 Rate Limiting

- **API Endpoints:** 100 requests per 15 minutes
- **Authentication:** 5 attempts per 15 minutes
- **Public Pages:** 200 requests per 15 minutes

### 10.5 Data Residency

**MVP:** Single region (US)
Confirmed

**Post-Launch:** Multi-region support (EU, US, AP)
Planned





## 11. User Experience & UI

### 11.1 Organization Switcher

**Decision:** Only for internal AnalyticsForChange staff
Confirmed

**Rationale:**

- Tenant users view everything through their top-level organization
- Content limited by roles and hierarchy
- Internal staff need cross-tenant access for support/management

### 11.2 Branding & White-Labeling

**Decision:** Tiered approach
Post-Launch

| Tier         | Features                            | Timeline       |
|--------------|-------------------------------------|----------------|
| Standard     | Default A4C branding                | MVP            |
| Professional | Logo + colors                       | Post-Launch Q1 |
| Enterprise   | Full white-labeling + custom domain | Post-Launch Q2 |



**MVP Approach:** Scaffold UI for branding settings but feature-flag it
as "Coming Soon - Enterprise Feature"







## 12. Technical Setup Guide

### 12.1 Prerequisites

- ✅ Supabase Auth account (Free plan)
- ✅ Supabase account and project
- ✅ Kubernetes cluster
- ✅ Cloudflare account with domain
- ✅ Domain name (yourapp.com)

### 12.2 Step-by-Step Setup

#### Step 1: Zitadel Configuration

1.  Create Supabase Auth instance
2.  Create service user
3.  Grant IAM_OWNER role
4.  Generate service user credentials
5.  Create A4C Portal project
6.  Create application with OIDC
7.  Create project roles (provider_admin, manager, member, viewer)
8.  Configure instance-level social login (Google, Facebook, Apple)

#### Step 2: Supabase Configuration

1.  Create Supabase project
2.  Enable ltree extension
3.  Create domain_events table (event store and audit trail)
4.  Create organizations_projection table
5.  Create users table
6.  Create invitations_projection table
7.  Configure RLS policies
8.  Configure authentication settings

#### Step 3: Kubernetes & Redis Setup

1.  Create namespace
2.  Deploy Redis
3.  Verify Redis is running
4.  Configure persistent volumes

#### Step 4: DNS Configuration (Cloudflare)

1.  Add domain to Cloudflare
2.  Create wildcard DNS record (\*)
3.  Create root domain record (@)
4.  Enable SSL/TLS (Full strict)
5.  Enable Always Use HTTPS

#### Step 5: Application Deployment

1.  Configure environment variables
2.  Create Kubernetes secrets
3.  Initialize root organization
4.  Build Docker image
5.  Deploy to Kubernetes
6.  Verify deployment

#### Step 6: Testing



**Testing Checklist:**

- [ ] Root domain loads
- [ ] Wildcard subdomain works
- [ ] Service user can create organizations
- [ ] Subdomain provisioning works
- [ ] OAuth flow completes successfully
- [ ] User lands in correct tenant after login
- [ ] RLS policies enforce tenant isolation
- [ ] Redis caching works
- [ ] Audit logs are created
- [ ] ltree queries work correctly







## 13. Implementation Roadmap

### 13.1 MVP Scope (Phase 1)

**Timeline:** 8-12 weeks

#### Week 1-2: Foundation

- Set up Supabase Auth instance
- Configure service user with IAM_OWNER
- Set up Supabase project
- Enable ltree extension
- Set up Kubernetes cluster
- Deploy Redis
- Configure Cloudflare DNS

#### Week 3-4: Authentication

- Implement OIDC integration
- Build OAuth flow
- Implement state management
- Create session management
- Configure social login

#### Week 5-6: Multi-Tenancy Core

- Implement subdomain routing
- Build tenant context resolution
- Implement caching
- Create RLS policies
- Build subdomain provisioning

#### Week 7-8: User Management

- Build admin panel for tenant creation
- Implement Organization creation via Temporal workflows
- Create invitation system
- Build role assignment

#### Week 9-10: Security & Compliance

- Implement audit logging
- Add MFA enforcement
- Configure security headers
- Implement rate limiting

#### Week 11-12: Polish & Testing

- Build tenant dashboard
- Create admin impersonation
- Integration tests
- Security audit
- Load testing
- Deploy to production

### 13.2 Post-Launch Features (Phase 2)

**Timeline:** 3-6 months after MVP

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th>Quarter</th>
<th>Features</th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Q1 Post-Launch</td>
<td><ul>
<li>Enterprise SSO configuration UI</li>
<li>Branding customization (Professional tier)</li>
<li>Enhanced audit log filtering</li>
<li>Bulk user import/export</li>
</ul></td>
</tr>
<tr class="even">
<td>Q2 Post-Launch</td>
<td><ul>
<li>Full white-labeling (Enterprise tier)</li>
<li>Custom domains</li>
<li>API for third-party integrations</li>
<li>Billing integration</li>
</ul></td>
</tr>
<tr class="odd">
<td>Q3 Post-Launch</td>
<td><ul>
<li>Multi-region support (EU, US, AP)</li>
<li>Mobile applications (iOS, Android)</li>
<li>Advanced analytics</li>
</ul></td>
</tr>
</tbody>
</table>





## 14. Appendix

### 14.1 Glossary

- **A4C:** Analytics4Change (platform owner)
- **IAM:** Identity and Access Management
- **IDP:** Identity Provider (e.g., Google, Okta)
- **ltree:** PostgreSQL extension for hierarchical structures
- **MFA:** Multi-Factor Authentication
- **OIDC:** OpenID Connect (authentication protocol)
- **Provider Admin:** Tenant administrator role
- **RLS:** Row-Level Security (PostgreSQL feature)
- **SSO:** Single Sign-On
- **Super Admin:** Internal staff role with platform-wide access

### 14.2 Reference Links

- **Zitadel Documentation:** <a href="https://zitadel.com/docs"
  target="_blank">https://zitadel.com/docs (DEPRECATED - migrated to Supabase Auth October 2025)
- **Supabase Documentation:** <a href="https://supabase.com/docs"
  target="_blank">https://supabase.com/docs
- **PostgreSQL ltree:**
  <a href="https://www.postgresql.org/docs/current/ltree.html"
  target="_blank">https://www.postgresql.org/docs/current/ltree.html
- **Cloudflare API:** <a href="https://developers.cloudflare.com/api/"
  target="_blank">https://developers.cloudflare.com/api/

---

## Related Documentation

### Authentication & Authorization
- **[Frontend Auth Architecture](../authentication/frontend-auth-architecture.md)** - Three-mode authentication system with JWT claims
- **[RBAC Architecture](../authorization/rbac-architecture.md)** - Role-based access control implementation
- **[JWT Custom Claims Setup](../../infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md)** - Database hooks for org_id and scope_path claims

### Data & Organization Management
- **[Organization Management Architecture](./organization-management-architecture.md)** - Hierarchical organization structure with ltree
- **[Organization Management Implementation](./organization-management-implementation.md)** - Technical implementation details
- **[Tenants as Organizations](./tenants-as-organizations.md)** - Multi-tenancy design philosophy
- **[Event Sourcing Overview](./event-sourcing-overview.md)** - CQRS and domain events for audit trail

### Database Implementation
- **[organizations_projection Table](../../infrastructure/reference/database/tables/organizations_projection.md)** - Complete org table schema (760 lines)
- **[users Table](../../infrastructure/reference/database/tables/users.md)** - User authentication and org association (742 lines)
- **[RBAC Architecture](../authorization/rbac-architecture.md)** - Row-level security patterns and role-based access control
- **[SQL Idempotency Audit](../../infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md)** - Migration best practices

### Workflows & Operations
- **[Organization Onboarding Workflow](../workflows/organization-onboarding-workflow.md)** - Temporal workflow for org setup
- **[Temporal Overview](../workflows/temporal-overview.md)** - Workflow orchestration architecture

### Infrastructure & Deployment
- **[Supabase Auth Setup](../../infrastructure/guides/supabase/SUPABASE-AUTH-SETUP.md)** - OAuth and social login configuration
- **[Deployment Instructions](../../infrastructure/guides/supabase/DEPLOYMENT_INSTRUCTIONS.md)** - Production deployment guide

---

### 14.3 Document Status



#### ✅ FINAL - READY FOR IMPLEMENTATION

**Next Steps:**

1.  Review and approve this specification
2.  Set up development environment following Section 12
3.  Begin Phase 1 implementation per Section 13.1
4.  Schedule weekly standups to track progress
5.  Create project board with tasks from roadmap









**Analytics4Change Multi-Tenant Architecture Specification v1.0**

© 2025 Analytics4Change. All decisions documented and ready for
implementation.

This is a comprehensive technical specification document. For questions
or updates, contact the project lead.



↑ Top
