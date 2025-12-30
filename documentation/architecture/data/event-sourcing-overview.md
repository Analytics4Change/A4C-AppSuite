---
status: current
last_updated: 2025-12-30
source: .plans/consolidated/agent-observations.md
migration_note: "Extracted CQRS/Event Sourcing content from consolidated planning doc. Zitadel references updated to Supabase Auth."
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Event-First Architecture with CQRS where all state changes are recorded as immutable events in `domain_events` table, then projected to read-model tables via PostgreSQL triggers.

**When to read**:
- Understanding how data flows through the system
- Implementing new domain events
- Creating or updating projection tables
- Debugging data inconsistencies

**Prerequisites**: Familiarity with PostgreSQL triggers

**Key topics**: `cqrs`, `events`, `projections`, `domain-events`, `event-sourcing`, `triggers`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# Event Sourcing & CQRS Architecture

## CQRS/Event Sourcing Foundation

**CRITICAL**: The A4C platform uses an **Event-First Architecture with CQRS (Command Query Responsibility Segregation)** where all state changes flow through an immutable event log before being projected to normalized tables for efficient querying.

**Primary Documentation**:
- `documentation/infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md` - Full CQRS architecture specification
- `documentation/frontend/guides/EVENT-DRIVEN-GUIDE.md` - Frontend implementation patterns

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
- All schemas in this system are CQRS projections (NOT source-of-truth tables)
- Permission changes, role assignments, cross-tenant grants are all event-sourced
- RLS policies query projections for performance
- Full audit trail for every state change (compliance requirement)

---

## Multi-Tenancy & Authentication Integration

**Current Architecture**: Supabase Auth with custom JWT claims

**Key Technologies**:
- **Supabase Auth**: Social login (Google, GitHub) + SAML 2.0 for enterprise SSO
- **Custom JWT Claims**: `org_id`, `user_role`, `permissions`, `scope_path` added via database hook
- **PostgreSQL ltree**: Unlimited organizational hierarchy via materialized paths
- **Row-Level Security (RLS)**: Database-level tenant isolation using JWT claims
- **Subdomain Routing**: `{tenant}.a4c.app` for tenant-specific access

**Authentication Flow**:
1. User navigates to `acme-healthcare.a4c.app`
2. Subdomain resolver maps to `org_id: acme_healthcare_001`
3. OAuth2/OIDC redirect to Supabase Auth with organization context
4. Supabase Auth authenticates and issues JWT
5. Database hook adds custom claims: `org_id`, roles, permissions, hierarchy
6. Frontend stores tokens, API validates on every request
7. RLS policies enforce multi-tenant data isolation

---

## Cross-Cutting Concerns

### Audit Logging

**Event-Sourced Audit Trail:**
- **Single Source of Truth**: The `domain_events` table IS the audit log (immutable, append-only)
- **No Separate Audit Table**: All audit queries go directly against `domain_events`
- Healthcare compliance (HIPAA/state regulations) requires immutable audit trails
- Every state change captured: user actions, data access, authentication events, permission changes
- **Retention**: 7 years (typical healthcare requirement)

**Audit Query Patterns:**

```sql
-- Who changed this resource?
SELECT
  event_type,
  event_metadata->>'user_id' as actor,
  event_metadata->>'reason' as reason,
  created_at
FROM domain_events
WHERE stream_id = '<resource_id>'
ORDER BY created_at DESC;

-- What did user X do?
SELECT *
FROM domain_events
WHERE event_metadata->>'user_id' = '<user_id>'
ORDER BY created_at DESC;

-- Trace a complete workflow execution
SELECT *
FROM domain_events
WHERE event_metadata->>'workflow_id' = '<workflow_id>'
ORDER BY created_at;
```

**Cross-Tenant Disclosure Tracking:**
- **HIPAA Requirement**: All Provider Partner access to Provider data must be logged (45 CFR § 164.528)
- Audit events: consultant org, user, provider org, resource, authorization type
- Cross-tenant audit events MUST be synchronous (no IndexedDB queue - data leakage risk)
- Track legal authorization basis (court order #, consent form ID, contract reference)

**Impersonation Audit Trail:**
- All impersonation lifecycle events (started, renewed, ended)
- All user actions during impersonation include metadata (original user, session ID)
- Query pattern: "Show all actions by Super Admin X while impersonating in org Y"
- Immutable event log with 7-year retention for compliance

**Compliance Considerations:**
If future compliance requirements need specialized audit views:
1. **DO NOT** create a parallel audit table
2. **DO** create a CQRS projection derived from `domain_events`
3. **DO** implement specific retention policies on the projection
4. **DO** add indexes optimized for compliance queries

The projection can always be rebuilt from `domain_events` since events are immutable.

### Performance & Caching

**Inferred from Architecture:**
- **JWT Token Caching**: Frontend caches tokens until expiration (reduces auth latency)
- **RLS Performance**: ltree GiST indexes on `hierarchy` column for fast hierarchical queries
- **Connection Pooling**: Supavisor must support per-tenant connection pools (avoid cross-tenant query plan pollution)

### Progressive Enhancement

**Event Resilience Implications:**
- Core functionality works offline (queue to IndexedDB)
- Background Sync API enhances experience when supported
- Graceful degradation for older browsers (polling fallback)

---

## Event-Driven Patterns

### Domain Events Table Schema

```sql
CREATE TABLE domain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL,
  stream_type TEXT NOT NULL,
  stream_version BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL,
  event_metadata JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stream_id, stream_version)
);

CREATE INDEX idx_domain_events_stream ON domain_events(stream_id, stream_version);
CREATE INDEX idx_domain_events_type ON domain_events(stream_type, event_type);
CREATE INDEX idx_domain_events_created ON domain_events(created_at);
```

### Event Metadata Structure

All events include standardized metadata for audit trail and traceability:

**Required Fields** (automatically added by Temporal workflows):
```json
{
  "timestamp": "2025-01-12T00:00:00Z",
  "workflow_id": "org-bootstrap-abc123",
  "workflow_run_id": "uuid",
  "workflow_type": "organizationBootstrapWorkflow",
  "activity_id": "createOrganizationActivity"
}
```

**Audit Context Fields** (recommended for all events):
| Field | Type | Purpose |
|-------|------|---------|
| `user_id` | UUID | Who initiated the action |
| `reason` | string | Human-readable justification for the action |
| `ip_address` | string | Client IP address (security audit) |
| `user_agent` | string | Client info (debugging) |
| `request_id` | string | Correlation with API logs |
| `correlation_id` | UUID | Trace related events across workflows |
| `causation_id` | UUID | Event that caused this event |

**Example Event Metadata**:
```json
{
  "timestamp": "2025-01-12T00:00:00Z",
  "workflow_id": "org-bootstrap-abc123",
  "workflow_run_id": "550e8400-e29b-41d4-a716-446655440000",
  "workflow_type": "organizationBootstrapWorkflow",
  "activity_id": "createOrganizationActivity",
  "user_id": "d3f4a5b6-c7e8-9012-3456-789abcdef012",
  "reason": "Organization bootstrap initiated by super admin",
  "ip_address": "192.168.1.100",
  "request_id": "req-abc123"
}
```

### Projection Update Pattern

Database triggers process events and update projections:

```sql
CREATE OR REPLACE FUNCTION process_domain_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Route to appropriate event processor based on stream_type
  CASE NEW.stream_type
    WHEN 'organization' THEN
      PERFORM process_organization_event(NEW);
    WHEN 'access_grant' THEN
      PERFORM process_access_grant_event(NEW);
    WHEN 'var_partnership' THEN
      PERFORM process_var_partnership_event(NEW);
    WHEN 'permission' THEN
      PERFORM process_permission_event(NEW);
    -- ... other stream types
  END CASE;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_process_domain_events
  AFTER INSERT ON domain_events
  FOR EACH ROW
  EXECUTE FUNCTION process_domain_event();
```

---

## Related Documentation

### CQRS/Event Sourcing Implementation
- **[Event-Driven Architecture Guide](../../infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md)** - Complete event sourcing specification
- **[Frontend Event-Driven Guide](../../frontend/guides/EVENT-DRIVEN-GUIDE.md)** - Frontend CQRS implementation patterns
- **[domain_events Table](../../infrastructure/reference/database/tables/domain_events.md)** - Event store schema documentation
- **[event_subscriptions Table](../../infrastructure/reference/database/tables/event_subscriptions.md)** - Event subscriber configuration

### Database & Projections
- **[Database Tables Reference](../../infrastructure/reference/database/tables/)** - All CQRS projection tables
  - [organizations_projection.md](../../infrastructure/reference/database/tables/organizations_projection.md) - Organization read model
  - [users.md](../../infrastructure/reference/database/tables/users.md) - User read model
  - [permissions_projection.md](../../infrastructure/reference/database/tables/permissions_projection.md) - Permissions read model
  - [roles_projection.md](../../infrastructure/reference/database/tables/roles_projection.md) - Roles read model
  - [domain_events](../../infrastructure/reference/database/tables/domain_events.md) - Event store (audit trail)
- **[SQL Idempotency Audit](../../infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md)** - Idempotent trigger patterns

### Authentication & Authorization
- **[Supabase Auth Overview](../authentication/supabase-auth-overview.md)** - Supabase Auth integration
- **[Frontend Auth Architecture](../authentication/frontend-auth-architecture.md)** - Three-mode auth system
- **[JWT Custom Claims Setup](../authentication/custom-claims-setup.md)** - JWT custom claims configuration
- **[RBAC Architecture](../authorization/rbac-architecture.md)** - Event-sourced RBAC system

### Multi-Tenancy & Data
- **[Multi-Tenancy Architecture](./multi-tenancy-architecture.md)** - Multi-tenant data isolation with RLS
- **[Organization Management Architecture](./organization-management-architecture.md)** - Hierarchical organization structure
- **[Tenants as Organizations](./tenants-as-organizations.md)** - Organization design philosophy

### Workflow Orchestration
- **[Temporal Overview](../workflows/temporal-overview.md)** - Workflow orchestration architecture
- **[Organization Onboarding Workflow](../workflows/organization-onboarding-workflow.md)** - Event-driven org setup
- **[Error Handling and Compensation](../../workflows/guides/error-handling-and-compensation.md)** - Saga pattern for rollback

---

## Historical Note

> **For historical Zitadel-based architecture**, see `.plans/consolidated/agent-observations-zitadel-deprecated.md`
>
> The A4C platform migrated from Zitadel to Supabase Auth in October 2025. The event-sourcing and CQRS patterns remained unchanged during this migration - only the authentication provider was replaced.
