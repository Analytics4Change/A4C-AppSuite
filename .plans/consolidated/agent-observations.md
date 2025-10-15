# Agent Observations: A4C AppSuite Architecture

## Core Mission

Enterprise-grade **multi-tenant B2B SaaS platform** for healthcare organizations serving at-risk youth, with controlled cross-organizational access for external stakeholders (Value-Added Resellers, court systems, social services, families). The system enables secure, hierarchical organizational structures where multiple facilities, programs, and teams collaborate while maintaining strict data isolation and healthcare compliance requirements.

---

## CQRS/Event Sourcing Foundation

**CRITICAL**: The A4C platform uses an **Event-First Architecture with CQRS (Command Query Responsibility Segregation)** where all state changes flow through an immutable event log before being projected to normalized tables for efficient querying.

**Primary Documentation**:
- `/infrastructure/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md` - Full CQRS architecture specification
- `/frontend/docs/EVENT-DRIVEN-GUIDE.md` - Frontend implementation patterns

**Core Principles**:
- **Events are the single source of truth**: The `domain_events` table is append-only and immutable
- **All database tables are projections**: Read-model tables are automatically maintained by database triggers that process events
- **Audit by design**: Every change captures WHO, WHAT, WHEN, and WHY (required `reason` field)
- **Temporal queries**: Can reconstruct state at any point in time
- **HIPAA compliance**: Immutable audit trail with 7-year retention

**How It Works**:
```
Application emits event → domain_events table → Database trigger fires → Event processor updates projections → Application queries projected tables
```

**Implications for Architecture**:
- All schemas shown in this document are CQRS projections (NOT source-of-truth tables)
- Permission changes, role assignments, cross-tenant grants are all event-sourced
- RLS policies query projections for performance
- Full audit trail for every state change (compliance requirement)

---

## Architectural Pillars

### 1. Multi-Tenancy Foundation
**Primary Documents:** `.plans/multi-tenancy/multi-tenancy-organization.html`, `.plans/auth-integration/tenants-as-organization-thoughts.md`

**Core Decision:** Zitadel organizations map 1:1 to tenants (customer healthcare organizations)

**Key Technologies:**
- **Zitadel Cloud**: Identity provider with native organization support
- **PostgreSQL ltree**: Unlimited organizational hierarchy via materialized paths
- **Row-Level Security (RLS)**: Database-level tenant isolation
- **Subdomain Routing**: `{tenant}.a4c.app` for tenant-specific access

**Hierarchy Model:**

**Platform-Wide Structure (Flat Provider Model):**
```
root (Analytics4Change Platform - Virtual Root)
│
├── org_a4c_internal (A4C Internal Organization - Zitadel Org)
│   └── Users: super_admin, support_agent
│
├── org_acme_healthcare (Provider - Direct Customer - Zitadel Org)
│   └── [Provider-defined internal hierarchy - see examples below]
│
├── org_sunshine_youth (Provider - VAR Customer - Zitadel Org)
│   └── [Provider-defined internal hierarchy - see examples below]
│
├── org_var_partner_xyz (Provider Partner - VAR - Zitadel Org)
│   └── Users: var_admin, var_consultant
│       └── Access: Managed via cross_tenant_access_grants (metadata, not hierarchy)
│
└── org_families_shared (Shared Family Access - Zitadel Org)
    └── Users: family_member_1, family_member_2
        └── Access: Client-scoped grants to Provider data
```

**CRITICAL ARCHITECTURAL PRINCIPLES:**

1. **All Providers are at Root Level**: VAR relationships do NOT create hierarchical ownership
   - Rationale: VAR contract expiration cannot trigger ltree path reorganization
   - VAR partnerships tracked in `var_partnerships_projection` table (metadata)
   - Provider ltree paths remain stable regardless of business relationships

2. **Provider-Defined Internal Hierarchies**: No prescribed structure below Provider root
   - Providers create their own organizational taxonomy
   - System enforces ltree relationships, NOT semantic levels
   - Rationale: Cannot predict how Providers name their organizational units

3. **VAR Relationships are Optional**: Not all Providers are associated with VARs
   - Default: Direct Provider customer (e.g., `org_acme_healthcare`)
   - Optional: VAR partnership tracked in projection table
   - Flexible: Providers can change VARs without data migration

**Real-World Provider Hierarchy Examples:**

**Example 1: Group Home Provider (Simple Flat Structure)**
```
org_homes_inc (Provider Root)
├── org_homes_inc.home_1
├── org_homes_inc.home_2
├── org_homes_inc.home_3
└── org_homes_inc.home_4
```
- Use Case: Small operator with 4 independent group homes
- No intermediate levels needed
- Each home operates autonomously

**Example 2: Residential Treatment Center (Campus-Based Structure)**
```
org_healing_horizons (Provider Root)
├── org_healing_horizons.north_campus
│   ├── org_healing_horizons.north_campus.residential_unit_a
│   ├── org_healing_horizons.north_campus.residential_unit_b
│   └── org_healing_horizons.north_campus.outpatient_clinic
├── org_healing_horizons.south_campus
│   ├── org_healing_horizons.south_campus.residential_unit_c
│   └── org_healing_horizons.south_campus.family_therapy_center
└── org_healing_horizons.administrative_office
```
- Use Case: Multi-campus treatment facility
- Intermediate: campus level
- Leaf nodes: specific units/clinics

**Example 3: Detention Center (Complex Hierarchical Structure)**
```
org_youth_detention_services (Provider Root)
└── org_youth_detention_services.main_facility
    ├── org_youth_detention_services.main_facility.intake_unit
    ├── org_youth_detention_services.main_facility.general_population
    │   ├── org_youth_detention_services.main_facility.general_population.pod_a
    │   ├── org_youth_detention_services.main_facility.general_population.pod_b
    │   └── org_youth_detention_services.main_facility.general_population.pod_c
    ├── org_youth_detention_services.main_facility.behavioral_health_wing
    │   ├── org_youth_detention_services.main_facility.behavioral_health_wing.crisis_stabilization
    │   └── org_youth_detention_services.main_facility.behavioral_health_wing.treatment_program
    └── org_youth_detention_services.main_facility.education_services
```
- Use Case: Large detention facility with multiple specialized units
- Deep nesting: facility → wing → pod
- Hierarchical permission scoping for security roles

---

### VAR Partnership Model (Event-Sourced Metadata)

**Problem Statement:** Value-Added Reseller (VAR) relationships with Providers cannot be hierarchical because contract expiration would require ltree path reorganization. VAR partnerships must be tracked as business metadata that can change without affecting Provider organizational structure.

**Solution Architecture: Event-Sourced VAR Partnerships**

**Projection Table (CQRS Read Model):**
```sql
-- NOTE: This is a CQRS projection table - NEVER updated directly
-- Source of truth: domain_events table with stream_type='var_partnership'
-- Updated ONLY by event processor: process_var_partnership_event()

CREATE TABLE var_partnerships_projection (
  id UUID PRIMARY KEY,
  var_org_id UUID NOT NULL REFERENCES organizations(id),
  provider_org_id UUID NOT NULL REFERENCES organizations(id),
  contract_start_date DATE NOT NULL,
  contract_end_date DATE,  -- NULL = ongoing/indefinite
  status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'terminated')),
  revenue_share_percentage DECIMAL(5,2),
  support_level TEXT,  -- 'basic' | 'premium' | 'enterprise'
  terms JSONB,  -- Flexible contract terms
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (var_org_id, provider_org_id)
);

CREATE INDEX idx_var_partnerships_var_org ON var_partnerships_projection(var_org_id) WHERE status = 'active';
CREATE INDEX idx_var_partnerships_provider_org ON var_partnerships_projection(provider_org_id) WHERE status = 'active';
CREATE INDEX idx_var_partnerships_expiring ON var_partnerships_projection(contract_end_date) WHERE status = 'active' AND contract_end_date IS NOT NULL;

COMMENT ON TABLE var_partnerships_projection IS
  'CQRS projection of VAR partnerships. Maintained by event processor, never updated directly.
   Tracks business relationships between VARs and Providers without hierarchical coupling.';
```

**Event Schemas:**

**1. var_partnership.created**
```typescript
{
  event_type: 'var_partnership.created',
  stream_id: 'partnership-uuid',
  stream_type: 'var_partnership',
  stream_version: 1,
  event_data: {
    partnership_id: 'partnership-uuid',
    var_org_id: 'var_xyz_org_uuid',
    provider_org_id: 'sunshine_youth_org_uuid',
    contract_start_date: '2025-01-01',
    contract_end_date: '2025-12-31',
    revenue_share_percentage: 15.00,
    support_level: 'premium',
    terms: {
      billing_cycle: 'monthly',
      minimum_commitment: '12_months',
      renewal_type: 'auto_renew'
    }
  },
  event_metadata: {
    user_id: 'super_admin_uuid',
    reason: 'New VAR partnership signed with Sunshine Youth Services',
    timestamp: '2025-01-01T00:00:00Z'
  }
}
```

**2. var_partnership.renewed**
```typescript
{
  event_type: 'var_partnership.renewed',
  stream_id: 'partnership-uuid',
  stream_type: 'var_partnership',
  stream_version: 2,
  event_data: {
    partnership_id: 'partnership-uuid',
    new_contract_end_date: '2026-12-31',
    revenue_share_percentage: 12.50,  // Negotiated discount
    renewal_reason: 'auto_renewal'
  },
  event_metadata: {
    user_id: '00000000-0000-0000-0000-000000000000',  // System user
    reason: 'Automatic contract renewal per terms',
    automated: true,
    timestamp: '2025-12-01T00:00:00Z'
  }
}
```

**3. var_partnership.expired**
```typescript
{
  event_type: 'var_partnership.expired',
  stream_id: 'partnership-uuid',
  stream_type: 'var_partnership',
  stream_version: 3,
  event_data: {
    partnership_id: 'partnership-uuid',
    var_org_id: 'var_xyz_org_uuid',
    provider_org_id: 'sunshine_youth_org_uuid',
    contract_end_date: '2025-12-31',
    expiration_reason: 'contract_term_ended'
  },
  event_metadata: {
    user_id: '00000000-0000-0000-0000-000000000000',  // System user
    reason: 'Automated contract expiration: contract term ended on 2025-12-31',
    automated: true,
    timestamp: '2026-01-01T00:00:00Z'
  }
}
```

**4. var_partnership.terminated**
```typescript
{
  event_type: 'var_partnership.terminated',
  stream_id: 'partnership-uuid',
  stream_type: 'var_partnership',
  stream_version: 4,
  event_data: {
    partnership_id: 'partnership-uuid',
    var_org_id: 'var_xyz_org_uuid',
    provider_org_id: 'sunshine_youth_org_uuid',
    termination_date: '2025-06-30',
    termination_reason: 'provider_requested',
    termination_notes: 'Provider transitioning to direct customer relationship'
  },
  event_metadata: {
    user_id: 'provider_admin_uuid',
    reason: 'Provider requested early contract termination',
    timestamp: '2025-06-30T00:00:00Z'
  }
}
```

**Event Processing & Cascading Effects:**

**Background Job: Contract Expiration Detection**
```typescript
// Scheduled job: Daily at 00:00 UTC
async function detectExpiredPartnerships() {
  const today = new Date().toISOString().split('T')[0];

  const expiredPartnerships = await supabase
    .from('var_partnerships_projection')
    .select('*')
    .eq('status', 'active')
    .lte('contract_end_date', today);

  for (const partnership of expiredPartnerships.data) {
    // Emit event (not direct update) ✅ CORRECT EVENT-SOURCED PATTERN
    await emitEvent({
      stream_id: partnership.id,
      stream_type: 'var_partnership',
      event_type: 'var_partnership.expired',
      event_data: {
        partnership_id: partnership.id,
        var_org_id: partnership.var_org_id,
        provider_org_id: partnership.provider_org_id,
        contract_end_date: partnership.contract_end_date,
        expiration_reason: 'contract_term_ended'
      },
      event_metadata: {
        user_id: SYSTEM_USER_ID,
        reason: `Automated expiration: contract term ended on ${partnership.contract_end_date}`,
        automated: true
      }
    });
  }
}
```

**Event Processor: Cascading Access Grant Revocation**
```sql
-- process_var_partnership_event() excerpt
WHEN 'var_partnership.expired' THEN
  -- 1. Update projection status
  UPDATE var_partnerships_projection
  SET
    status = 'expired',
    updated_at = p_event.created_at
  WHERE id = (p_event.event_data->>'partnership_id')::UUID;

  -- 2. Emit cascading access grant revocation events
  INSERT INTO domain_events (stream_id, stream_type, event_type, event_data, event_metadata)
  SELECT
    grant.id,
    'access_grant',
    'access_grant.revoked',
    jsonb_build_object(
      'grant_id', grant.id,
      'revocation_reason', 'var_partnership_expired',
      'partnership_id', (p_event.event_data->>'partnership_id')::UUID
    ),
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-000000000000',
      'reason', 'Automatically revoking access grant due to expired VAR partnership',
      'automated', true,
      'triggered_by_event_id', p_event.id
    )
  FROM cross_tenant_access_grants_projection grant
  WHERE grant.consultant_org_id = (p_event.event_data->>'var_org_id')::UUID
    AND grant.provider_org_id = (p_event.event_data->>'provider_org_id')::UUID
    AND grant.authorization_type = 'var_contract'
    AND grant.revoked_at IS NULL;
```

**Key Architectural Guarantees:**

1. **ltree Path Stability**: Provider organizational structure (`org_sunshine_youth.*`) NEVER changes due to VAR relationship changes
2. **Event-Sourced Lifecycle**: All partnership state changes captured as immutable events (created → renewed → expired/terminated)
3. **Automated Expiration**: Background job detects expired contracts and emits events (not direct updates)
4. **Cascading Revocations**: Partnership expiration automatically triggers access grant revocation events
5. **Audit Trail**: Complete history of VAR relationships with WHO, WHAT, WHEN, WHY for every change
6. **Temporal Queries**: Can reconstruct "Which Providers were partnered with VAR X on date Y?"

**Security Architecture:**
- JWT tokens contain `org_id` claim
- RLS policies filter all queries: `WHERE org_id = current_setting('app.current_org')`
- Connection pooling requires per-tenant isolation (Supavisor configuration)
- API Gateway validates subdomain → org_id mapping

---

### 2. Enterprise Identity & Access Management
**Primary Documents:** `.plans/auth-integration/tenants-as-organization-thoughts.md`, `.plans/multi-tenancy/multi-tenancy-organization.html`

**Authentication Flow:**
1. User navigates to `acme-healthcare.a4c.app`
2. Subdomain resolver maps to `org_id: acme_healthcare_001`
3. OAuth2/OIDC redirect to Zitadel with organization context
4. Zitadel authenticates within specific organization
5. ID token includes: `org_id`, `user_id`, roles, permissions, hierarchy claims
6. Frontend stores tokens, API validates on every request

**Initial Role Model (Phase 1):**
- **`super_admin`**: IAM_OWNER (Zitadel instance-level), all permissions across all organizations
- **`provider_admin`**: ORG_OWNER (Zitadel org-level), all permissions within their organization

**Future Roles (Event-Driven Extensibility):**
- `facility_admin`, `program_manager`, `clinician`, `read_only_auditor`, `var_partner_admin`
- New roles added via event sourcing (no schema migrations required)

**Authorization Model:**
- **Permission-Based RBAC**: Permissions are atomic units (e.g., `medication.create`, `provider.impersonate`)
- **Roles collect permissions**: Flexible for future expansion
- **Event-Sourced**: All role/permission changes captured as immutable events
- **Zitadel Synchronization**: Roles synchronized to PostgreSQL projections for consistent authorization
- **Hierarchical Scoping**: ltree-based permission scoping for facility/program-level access (future)

---

### 3. Healthcare-Critical Event Resilience
**Primary Document:** `.plans/event-resilience/plan.md`

**Problem Statement:** In healthcare settings, medication administration events and care observations MUST be delivered reliably even during network outages. Dropped events could endanger patient safety.

**Solution Architecture:**

```
┌─────────────────────────────────────────────┐
│  Event Creation (Med Admin, Vital Signs)   │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  Resilient Event Emitter                    │
│  - Immediate attempt to send                │
│  - On failure → IndexedDB queue             │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  Network Monitor                            │
│  - Detects online/offline transitions       │
│  - Triggers queue processing on reconnect   │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  Retry Logic with Circuit Breaker           │
│  - Exponential backoff: 1s → 2s → 4s → 8s  │
│  - Circuit breaker: 3 failures = OPEN       │
│  - Half-open retry after cooldown           │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
         ┌─────────┴──────────┐
         │                    │
         ▼                    ▼
    ┌────────┐          ┌──────────┐
    │ SUCCESS│          │  FAILED  │
    │ (clear)│          │ (persist)│
    └────────┘          └──────────┘
```

**Implementation Details:**
- **IndexedDB Schema**: `{ id, event_type, payload, timestamp, retry_count, status }`
- **Idempotency**: Events include UUID to prevent duplicate processing
- **User Feedback**: UI indicators show "Sending..." → "Delivered" or "Queued for retry"
- **Background Sync API**: Progressive enhancement for browser-level resilience

**Critical Design Decision:** Queue persists locally (IndexedDB) rather than server-side to ensure zero data loss during client offline periods.

---

### 4. Secure Developer Operations
**Primary Documents:** `.plans/cloudflare-remote-access/plan.md`, `.plans/cloudflare-remote-access/todo.md`

**Use Case:** Enable secure SSH/VNC access to Supabase database and development environments without exposing public ports or managing VPN infrastructure.

**Cloudflare Zero Trust Architecture:**

```
Developer Workstation
  │
  ├─ cloudflared tunnel (SSH)
  │    └─ Authenticates via Cloudflare Access
  │         └─ Tunnels to supabase-db.tunnel.example.com
  │              └─ Cloudflare Edge validates JWT
  │                   └─ Routes to localhost:5432 on Supabase VM
  │
  └─ cloudflared tunnel (VNC)
       └─ Routes to localhost:5901 on Supabase VM
            └─ TigerVNC server (display :1)
```

**Security Controls:**
- **Identity-Aware Proxy**: Cloudflare Access validates developer email/role before allowing tunnel connection
- **No Public Ports**: Supabase VM has no inbound firewall rules
- **Audit Logging**: Cloudflare logs all access attempts with identity context
- **Just-In-Time Access**: Temporary access grants via Cloudflare dashboard

**Implementation Status:** 18.75% complete (3/16 tasks per `todo.md`)

**Next Steps:**
1. Configure Cloudflare Tunnel for SSH (Port 22 → localhost:22)
2. Set up Access policy requiring `@a4c.app` email domain
3. Install TigerVNC server on Supabase VM
4. Create VNC tunnel (Port 5901 → localhost:5901)

---

### 5. Cross-Tenant Access & Provider Partner Collaboration
**Primary Documents:** `.plans/auth-integration/tenants-as-organization-thoughts.md`, `.plans/multi-tenancy/multi-tenancy-organization.html`

**Tenant Classification:**

**Provider (Data Owner):**
- Healthcare organizations (group homes, detention centers, residential facilities)
- Own patient/client data
- Isolated Zitadel organization per Provider (e.g., `org_acme_healthcare`)
- Self-contained user base
- **Structural Independence**: Providers exist at root level regardless of business relationships

**Provider Partner (External Stakeholder):**
- **Value-Added Resellers (VARs)**: Manage multiple Provider customers via cross-tenant grants (NOT hierarchical ownership)
  - VAR access managed through `cross_tenant_access_grants_projection`
  - Partnership metadata tracked in `var_partnerships_projection`
  - Contract expiration automatically revokes grants (event-driven)
  - Scope-limited aggregate dashboards (portfolio view)
- **Court System**: Judges, guardian ad-litem (case-based access via court orders)
- **Social Services**: Social workers, case managers (assigned client access)
- **Family Members**: Parents/guardians in shared "A4C-Families" org (client-scoped grants)

**CRITICAL ARCHITECTURAL PRINCIPLE: VAR Access via Grants, Not Hierarchy**

VARs do NOT own Provider organizations hierarchically. Instead:
1. Provider organizations remain at root level (e.g., `org_sunshine_youth`)
2. VAR partnership creates metadata relationship in `var_partnerships_projection`
3. Cross-tenant access grants authorize specific VAR users to access Provider data
4. Grants reference partnership for authorization basis
5. Partnership expiration cascades to automatic grant revocation

**Why This Matters:**
- Provider ltree paths (`org_sunshine_youth.home_1`) NEVER change when VAR contracts expire
- No data migration required when Provider changes VARs
- Provider can operate independently if VAR relationship ends
- Clear separation between business relationships (metadata) and data structure (hierarchy)

**Access Grant Model (CQRS Projection):**
```sql
-- NOTE: This is a projection table, maintained by event processors
-- Source of truth: access_grant.created/revoked events in domain_events table

CREATE TABLE cross_tenant_access_grants_projection (
  id UUID PRIMARY KEY,
  consultant_org_id UUID NOT NULL,         -- Provider Partner org (e.g., VAR org)
  consultant_user_id UUID,                 -- Specific user (NULL = org-wide)
  provider_org_id UUID NOT NULL,           -- Target Provider org
  scope TEXT NOT NULL CHECK (scope IN ('full_org', 'facility', 'program', 'client')),
  scope_id UUID,                           -- Specific resource ID (NULL for full_org)
  granted_by UUID NOT NULL,                -- Authorization actor
  granted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,                  -- Time-limited access (NULL = indefinite)
  revoked_at TIMESTAMPTZ,                  -- Revocation timestamp
  authorization_type TEXT NOT NULL,        -- 'var_contract' | 'court_order' | 'parental_consent'
  legal_reference TEXT,                    -- Court order #, consent form ID, partnership ID
  metadata JSONB,                          -- Additional context
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_cross_tenant_grants_consultant ON cross_tenant_access_grants_projection(consultant_org_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_cross_tenant_grants_provider ON cross_tenant_access_grants_projection(provider_org_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_cross_tenant_grants_expiring ON cross_tenant_access_grants_projection(expires_at) WHERE revoked_at IS NULL AND expires_at IS NOT NULL;

COMMENT ON TABLE cross_tenant_access_grants_projection IS
  'CQRS projection of cross-tenant access grants. Enables Provider Partners (VARs, courts, families)
   to access Provider data without hierarchical ownership. Maintained by event processor.';
```

**Enhanced RLS Policies:**
```sql
-- Hybrid access: same-tenant OR cross-tenant grant
-- NOTE: Queries the projection table for performance
WHERE organization_id = current_setting('app.current_org')::UUID
   OR EXISTS (
     SELECT 1 FROM cross_tenant_access_grants_projection grant
     WHERE grant.consultant_org_id = current_setting('app.current_org')::UUID
       AND grant.provider_org_id = organization_id
       AND (grant.expires_at IS NULL OR grant.expires_at > NOW())
       AND grant.revoked_at IS NULL
       AND check_scope_authorization(grant.scope, grant.scope_id, resource_id)
   )
```

**Dashboard Access Tiers:**
- **Super Admin:** All Providers (unrestricted aggregate analytics)
- **VAR Admin:** Portfolio view only (Providers with active grants + active partnerships)
  - Filtered by: `WHERE EXISTS (SELECT 1 FROM cross_tenant_access_grants_projection WHERE consultant_org_id = current_var_org AND authorization_type = 'var_contract' AND revoked_at IS NULL)`
  - Automatically loses access when partnership expires (cascading grant revocation)
- **Provider Admin:** Own Provider only (no cross-tenant visibility)

**VAR Access Lifecycle Example:**

1. **Partnership Created**: `var_partnership.created` event emitted
2. **Grant Issued**: Super Admin creates cross-tenant grant for VAR
   - Event: `access_grant.created`
   - Data: `{ consultant_org_id: 'var_xyz', provider_org_id: 'sunshine_youth', authorization_type: 'var_contract', legal_reference: 'partnership-uuid' }`
3. **VAR Accesses Data**: RLS policy checks grant validity + partnership status
4. **Contract Expires**: Background job detects expiration date reached
   - Event: `var_partnership.expired` emitted
5. **Automatic Revocation**: Event processor detects expired partnership
   - Cascading Event: `access_grant.revoked` emitted for all VAR grants
6. **Access Denied**: RLS policy now excludes VAR (grant revoked)
7. **Audit Trail**: Complete history preserved in `domain_events` table

---

### 6. Super Admin Impersonation & Support Operations
**Primary Document:** `.plans/impersonation/architecture.md`

**Problem Statement:** Platform support, emergency access, and compliance audits require Super Admin ability to view/operate as any user in any Provider organization while maintaining comprehensive audit trails.

**Solution Architecture:**

**Session Management:**
- 30-minute time-limited sessions (configurable)
- Renewal modal at 1-minute warning
- Automatic logout on timeout
- Server-side session tracking (Redis with TTL)

**Event-Driven Audit:**
```
impersonation.started → [user actions with metadata] → impersonation.renewed* → impersonation.ended
```

**Visual Indicators:**
- Bright red border around entire viewport
- Sticky banner: "Impersonating: [User] ([Org])"
- Favicon change to warning icon
- Browser title prefix: "[IMPERSONATING]"
- Session timer countdown

**Security Controls:**
- MFA required before impersonation
- Justification required (support ticket, emergency, audit, training)
- Nested impersonation prevented
- Comprehensive audit logging (who, what, when, why, how long)

**JWT Structure:**
```json
{
  "sub": "target-user-id",
  "org_id": "target-org-id",
  "impersonation": {
    "sessionId": "uuid",
    "originalUserId": "super-admin-id",
    "targetUserId": "target-user-id",
    "expiresAt": 1728484200
  }
}
```

**Compliance:** All impersonation events immutable in audit log, 7-year retention for healthcare regulations.

---

### 7. Permission-Based RBAC Architecture
**Primary Document:** `.plans/rbac-permissions/architecture.md`

**Problem Statement:** Healthcare applications require granular, auditable access control that can evolve without schema migrations. Permission changes must be traceable for compliance.

**Solution Architecture:**

**Permission Model:**
- Permissions defined per **applet** (medication, provider, client, user, etc.)
- Naming convention: `applet.action` (e.g., `medication.create`, `provider.impersonate`)
- Permission types: CRUD (`create`, `view`, `update`, `delete`) + custom (`approve`, `impersonate`)
- Metadata includes MFA requirements and hierarchical scope types

**Event-Driven RBAC (CQRS Projections):**
```sql
-- ALL tables are projections from domain_events

permissions_projection (id, applet, action, name, description, scope_type, requires_mfa)
roles_projection (id, name, description, zitadel_org_id, org_hierarchy_scope)
role_permissions_projection (role_id, permission_id)
user_roles_projection (user_id, role_id, org_id, scope_path)
```

**Event Schemas:**
- `permission.defined` - New permission created
- `role.created` - New role defined
- `role.permission.granted` - Permission added to role
- `role.permission.revoked` - Permission removed from role
- `user.role.assigned` - Role granted to user
- `user.role.revoked` - Role removed from user

**Authorization Patterns:**
- SQL function: `user_has_permission(user_id, permission_name, org_id, scope_path)`
- RLS policies integrate permission checks
- Frontend queries permissions before rendering UI
- API validates permissions before processing commands

**Initial Role Definitions:**

**super_admin:**
- Zitadel: IAM_OWNER
- Scope: All organizations (`org_id = '*'`)
- Permissions: ALL (`*`)
- Use cases: Platform support, emergency access, compliance audits

**provider_admin:**
- Zitadel: ORG_OWNER
- Scope: Single organization (`org_id = specific org`)
- Permissions: ALL within their organization
- Use cases: Healthcare org administrators, facility directors

**Key Design Decisions:**
- Start with 2 foundational roles, extend via events (no migrations)
- Impersonation inherits target user's permissions (not super admin's)
- Cross-tenant grants also event-sourced for full audit trail
- MFA required for sensitive permissions (`provider.impersonate`, `access_grant.create`)

**Compliance:**
- Full audit trail of all permission changes
- Query pattern: "Who granted what permission to whom, when, and why?"
- 7-year retention for HIPAA compliance
- Immutable events prevent tampering

---

## Dependency Graph

```
CQRS/Event Sourcing Foundation (FOUNDATIONAL LAYER)
  │
  └─→ Multi-Tenancy Foundation (CRITICAL PATH)
        │
        ├─→ Cross-Tenant Access Model (BLOCKS: Auth Integration)
        │     │
        │     └─→ Auth Integration (BLOCKS: RBAC, Impersonation, Event Resilience)
        │           │
        │           ├─→ RBAC/Permissions (DEPENDS ON: Event-sourced roles/permissions)
        │           │     │
        │           │     └─→ Impersonation (DEPENDS ON: Permission inheritance from target user)
        │           │
        │           └─→ Event Resilience (DEPENDS ON: org_id + impersonation metadata in events)
        │
        └─→ Remote Access (DEPENDS ON: Tenant isolation for developer DB access)
```

**Rationale:**
- **CQRS/Event Sourcing is foundational** because all state changes (including permissions) are event-sourced
- **Cross-tenant access model must precede auth** because JWT structure needs to include Provider Partner access grants
- **Auth must precede RBAC** because authentication provides user context for permission checks
- **RBAC must precede impersonation** because impersonation inherits target user's permissions
- **Event resilience depends on auth** because queued events need org_id AND cross-org/impersonation context
- **Remote access orthogonal** to business logic features (developer infrastructure)

---

## Cross-Cutting Concerns

### Audit Logging
**Event-Sourced Audit Trail:**
- **Primary Source**: The `domain_events` table IS the audit log (immutable, append-only)
- Healthcare compliance (HIPAA/state regulations) requires immutable audit trails
- Every state change captured: user actions, data access, authentication events, permission changes
- **Retention**: 7 years (typical healthcare requirement)
- **Query Pattern**: Filter `domain_events` by `stream_type`, `event_type`, `event_metadata->>'user_id'`

**Cross-Tenant Disclosure Tracking:**
- **HIPAA Requirement:** All Provider Partner access to Provider data must be logged (45 CFR § 164.528)
- Audit events: consultant org, user, provider org, resource, authorization type
- Cross-tenant audit events MUST be synchronous (no IndexedDB queue - data leakage risk)
- Track legal authorization basis (court order #, consent form ID, contract reference)

**Impersonation Audit Trail:**
- All impersonation lifecycle events (started, renewed, ended)
- All user actions during impersonation include metadata (original user, session ID)
- Query pattern: "Show all actions by Super Admin X while impersonating in org Y"
- Immutable audit log with 7-year retention for compliance

### Performance & Caching
**Inferred from Architecture:**
- **Zitadel Token Caching**: Frontend caches ID tokens until expiration (reduces auth latency)
- **RLS Performance**: ltree GiST indexes on `hierarchy` column for fast hierarchical queries
- **Connection Pooling**: Supavisor must support per-tenant connection pools (avoid cross-tenant query plan pollution)

### Progressive Enhancement
**Event Resilience Implications:**
- Core functionality works offline (queue to IndexedDB)
- Background Sync API enhances experience when supported
- Graceful degradation for older browsers (polling fallback)

---

## Strategic Intent Summary

### Phase 1: Foundation (Current Focus)
**Goal:** Establish multi-tenant identity and data isolation
**Deliverables:**
- Zitadel organization-per-tenant configured
- PostgreSQL ltree + RLS implemented
- Subdomain routing functional
- JWT claims include `org_id` and hierarchy path
- Cross-tenant access grants table schema
- Enhanced RLS policies (same-tenant OR cross-org grant)
- JWT structure supports Provider Partner access context
- Impersonation session management (Redis store, 30-min TTL)
- Impersonation event schema (started, renewed, ended)

### Phase 2: Resilience (Next Priority)
**Goal:** Healthcare-grade reliability for critical events
**Deliverables:**
- IndexedDB event queue operational
- Exponential backoff + circuit breaker tested
- User feedback for queue status
- Idempotency verification

### Phase 3: Developer Experience (Parallel Track)
**Goal:** Secure, auditable access to production-like environments
**Deliverables:**
- Cloudflare Zero Trust tunnels configured
- SSH/VNC access for authorized developers
- Audit logs integrated with Cloudflare Access logs

### Phase 4: Scale & Optimization (Future)
**Goal:** Support 100+ tenants with sub-200ms API response times
**Deliverables:**
- Per-tenant connection pooling
- ltree query optimization
- Token refresh automation
- Monitoring/alerting for offline event queue depths

---

## Open Questions for Product Team

1. **Tenant Onboarding:** How will new organizations be provisioned in Zitadel? Self-service vs. manual?
2. **Hierarchy Depth Limits:** Is there a practical maximum depth for facility → program → team nesting?
3. **Cross-Tenant Collaboration:** Do any use cases require sharing data between organizations (e.g., inter-facility referrals)?
4. **Event Retention:** How long should failed events persist in IndexedDB before alerting users?
5. **Developer Access Audit:** What is the approval workflow for granting Cloudflare Zero Trust access?
6. **Provider Partner Onboarding:** Self-service VAR signup vs. manual Super Admin approval? Court order integration workflow?
7. **Family Access Portal:** Dedicated subdomain (families.a4c.app) vs. email magic links for parents?
8. **Impersonation Justification:** Dropdown values sufficient, or free-text notes required for all sessions?
9. **Concurrent Impersonation:** Allow Super Admin to impersonate multiple users in different tabs simultaneously?
10. **Provider Notifications:** Email Provider Admins when Super Admin accesses their org? (transparency vs. friction trade-off)

---

## Technical Debt & Risk Register

### High Risk
- **RLS Policy Correctness:** Incorrect policies could leak tenant data (requires extensive testing)
- **Token Expiration Handling:** Must gracefully handle expired tokens mid-session without data loss
- **Cross-Tenant Grant Validation:** Incorrect scope checks could expose unauthorized Provider data to Provider Partners
- **Impersonation Session Hijacking:** JWT replay or stolen session could allow unauthorized impersonation

### Medium Risk
- **IndexedDB Quota Limits:** Browsers cap storage (50MB-1GB) - needs monitoring and user alerts
- **ltree Migration Complexity:** Changing hierarchy structure after production launch is high-risk
- **Impersonation Audit Gaps:** Browser crashes before `impersonation.ended` event could lose session end time (mitigated by server-side cleanup)
- **Legal Authorization Tracking:** Missing or incorrect legal basis documentation could violate HIPAA disclosure requirements

### Low Risk
- **Cloudflare Tunnel Reliability:** Fallback to bastion host if Cloudflare has extended outage

---

## Conclusion

The A4C AppSuite architecture demonstrates **cohesive design across security, reliability, and scalability dimensions**. The choice of Zitadel organizations for multi-tenancy, PostgreSQL ltree for hierarchy, and client-side event queuing for resilience reflects a deep understanding of healthcare SaaS requirements.

**Key Success Factors:**
1. **Tenant Isolation:** Zitadel + RLS provides defense-in-depth
2. **Healthcare Reliability:** Offline-first event handling prevents data loss
3. **Developer Productivity:** Cloudflare Zero Trust eliminates VPN friction
4. **Scalable Hierarchy:** ltree supports unlimited nesting without schema changes
5. **Provider Partner Collaboration:** Granular access grants enable court, VAR, family access without compromising isolation
6. **Transparent Support Operations:** Impersonation audit trail + visual indicators ensure accountable Super Admin access

**Next Immediate Action:** Complete Phase 1 (multi-tenancy foundation + RBAC) and verify RLS policies with penetration testing before proceeding to event resilience implementation.

---

## Related Documentation Index

### CQRS/Event Sourcing
- `/infrastructure/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md` - Complete event sourcing specification
- `/frontend/docs/EVENT-DRIVEN-GUIDE.md` - Frontend event implementation patterns

### Multi-Tenancy & Auth
- `.plans/multi-tenancy/multi-tenancy-organization.html` - Multi-tenancy architecture
- `.plans/auth-integration/tenants-as-organization-thoughts.md` - Zitadel integration

### RBAC/Permissions
- `.plans/rbac-permissions/architecture.md` - Permission-based RBAC with event sourcing

### Cross-Tenant Access
- (See Multi-Tenancy and RBAC documents for cross-tenant grant model)

### Impersonation
- `.plans/impersonation/architecture.md` - Impersonation system design
- `.plans/impersonation/event-schema.md` - Impersonation events
- `.plans/impersonation/ui-specification.md` - Visual indicators and UX
- `.plans/impersonation/security-controls.md` - Security measures

### Event Resilience
- `.plans/event-resilience/plan.md` - Offline queue and retry architecture

### Developer Operations
- `.plans/cloudflare-remote-access/plan.md` - Zero Trust remote access
- `.plans/cloudflare-remote-access/todo.md` - Implementation checklist
