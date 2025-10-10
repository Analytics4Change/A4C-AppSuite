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
```
Organization (Zitadel Org = Tenant)
├── Facilities (ltree: "org_123")
│   ├── Programs (ltree: "org_123.facility_456")
│   │   └── Teams (ltree: "org_123.facility_456.program_789")
│   └── Teams (ltree: "org_123.facility_456")
└── Programs (ltree: "org_123")
```

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
- Isolated Zitadel organization per Provider
- Self-contained user base

**Provider Partner (External Stakeholder):**
- **Value-Added Resellers (VARs)**: Manage multiple Provider customers, scope-limited aggregate dashboards
- **Court System**: Judges, guardian ad-litem (case-based access via court orders)
- **Social Services**: Social workers, case managers (assigned client access)
- **Family Members**: Parents/guardians in shared "A4C-Families" org (client-scoped grants)

**Access Grant Model (CQRS Projection):**
```sql
-- NOTE: This is a projection table, maintained by event processors
-- Source of truth: access_grant.created/revoked events in domain_events table

CREATE TABLE cross_tenant_access_grants_projection (
  id UUID PRIMARY KEY,
  consultant_org_id TEXT NOT NULL,        -- Provider Partner org
  consultant_user_id UUID,                 -- Specific user (NULL = org-wide)
  provider_org_id TEXT NOT NULL,          -- Target Provider org
  scope TEXT NOT NULL CHECK (scope IN ('full_org', 'facility', 'client')),
  scope_id UUID,                           -- Specific resource ID
  granted_by UUID NOT NULL,                -- Authorization actor
  granted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,                  -- Time-limited access
  revoked_at TIMESTAMPTZ,
  authorization_type TEXT NOT NULL,        -- 'court_order' | 'parental_consent' | 'var_contract'
  legal_reference TEXT,                    -- Court order #, consent form ID
  metadata JSONB
);
```

**Enhanced RLS Policies:**
```sql
-- Hybrid access: same-tenant OR cross-tenant grant
-- NOTE: Queries the projection table for performance
WHERE organization_id = current_setting('app.current_org')
   OR EXISTS (
     SELECT 1 FROM cross_tenant_access_grants_projection
     WHERE consultant_org_id = current_setting('app.current_org')
       AND provider_org_id = organization_id
       AND (expires_at IS NULL OR expires_at > NOW())
       AND revoked_at IS NULL
       AND check_scope_authorization(scope, scope_id, resource_id)
   )
```

**Dashboard Access Tiers:**
- **Super Admin:** All Providers (unrestricted aggregate analytics)
- **VAR:** Own portfolio only (scope-limited aggregate dashboards)
- **Provider Admin:** Own Provider only (no cross-tenant visibility)

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
