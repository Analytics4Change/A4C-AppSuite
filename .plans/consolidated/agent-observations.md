# Agent Observations: A4C AppSuite Architecture

## Core Mission

Enterprise-grade **multi-tenant B2B SaaS platform** for healthcare organizations serving at-risk youth, with controlled cross-organizational access for external stakeholders (Value-Added Resellers, court systems, social services, families). The system enables secure, hierarchical organizational structures where multiple facilities, programs, and teams collaborate while maintaining strict data isolation and healthcare compliance requirements.

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
5. ID token includes: `org_id`, `user_id`, roles, hierarchy claims
6. Frontend stores tokens, API validates on every request

**Role Hierarchy (from most to least privileged):**
```
System Administrator (A4C staff - cross-tenant)
  └── Org Owner (customer admin)
      └── Facility Admin
          └── Program Manager
              └── Team Lead
                  └── Care Provider
                      └── Support Staff
```

**Authorization Model:**
- **Hierarchical Inheritance**: Facility Admins can manage all programs/teams within their facility
- **ltree Queries**: `WHERE hierarchy <@ 'org_123.facility_456'` grants facility-wide access
- **Zitadel Roles**: Synchronized to PostgreSQL for consistent authorization

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

**Access Grant Model:**
```sql
CREATE TABLE cross_tenant_access_grants (
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
WHERE organization_id = current_setting('app.current_org')
   OR EXISTS (
     SELECT 1 FROM cross_tenant_access_grants
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

## Dependency Graph

```
Multi-Tenancy Foundation (CRITICAL PATH)
  │
  ├─→ Cross-Tenant Access Model (BLOCKS: Auth Integration)
  │     │
  │     └─→ Auth Integration (BLOCKS: Impersonation, Event Resilience)
  │           │
  │           ├─→ Impersonation (DEPENDS ON: JWT structure with cross-org context)
  │           │
  │           └─→ Event Resilience (DEPENDS ON: org_id + impersonation metadata in events)
  │
  └─→ Remote Access (DEPENDS ON: Tenant isolation for developer DB access)
```

**Rationale:**
- **Cross-tenant access model must precede auth** because JWT structure needs to include Provider Partner access grants
- **Auth must precede impersonation** because impersonation builds on authentication foundation
- **Impersonation parallel to event resilience** (both depend on auth)
- **Event resilience depends on auth** because queued events need org_id AND cross-org/impersonation context
- **Remote access orthogonal** to business logic features (developer infrastructure)

---

## Cross-Cutting Concerns

### Audit Logging
**Implied Requirements:**
- Healthcare compliance (HIPAA/state regulations) requires immutable audit trails
- Must log: user actions, data access, authentication events, failed authorization attempts
- **PostgreSQL Approach**: Append-only `audit_log` table with `org_id`, `user_id`, `action`, `resource`, `timestamp`
- **Retention**: 7 years (typical healthcare requirement)

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

**Next Immediate Action:** Complete Phase 1 (multi-tenancy foundation) and verify RLS policies with penetration testing before proceeding to event resilience implementation.
