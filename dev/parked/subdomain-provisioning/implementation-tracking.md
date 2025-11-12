# Subdomain Provisioning Implementation

## Status: Phase 0-2 Complete

**Date Started**: 2025-10-17
**Architecture**: Temporal-first, greenfield implementation
**Repository**: A4C-AppSuite monorepo

## Overview

Adding subdomain creation and provisioning as part of provider/provider-partner bootstrap workflow, using Temporal for orchestration and PostgreSQL for event sourcing/CQRS projections.

## Key Architectural Decisions

### 1. Temporal-First Approach
- **Decision**: Implement all orchestration in Temporal workflows from day 1
- **Rationale**:
  - Greenfield project (no existing production implementation)
  - Future workflows already planned (medication admin notifications, incidents)
  - Avoid migration work from SQL → Temporal later
  - Better observability, retry handling, and scalability
  - Real API integration vs SQL simulations

### 2. PostgreSQL Role: Events & Projections Only
- **Decision**: PostgreSQL stores events and CQRS projections, NOT orchestration logic
- **Pattern**: Temporal workflows emit events → PostgreSQL triggers project to read models
- **Benefits**: Clean separation of concerns, audit trail, scalable architecture

### 3. Non-Blocking Subdomain Provisioning
- **Decision**: Bootstrap workflow completes immediately, subdomain provisions in background
- **Flow**:
  1. Create Zitadel org/user (5-10s)
  2. Create organization record (1s)
  3. Start subdomain workflow (child workflow, non-blocking)
  4. Assign roles (2s)
  5. Send invitation email (2s)
  6. Mark bootstrap complete ✅
  7. Subdomain verifies in background (1-10 minutes)

### 4. Environment-Aware Base Domains
- **Development**: `{slug}.firstovertheline.com`
- **Production**: `{slug}.analytics4change.com`
- **Configuration**: Environment variables + ConfigMaps

## Implementation Progress

### ✅ Phase 0: Cleanup (Complete)

**Actions Taken**:
1. Moved unused PostgreSQL bootstrap functions to `sql/00-reference/`
   - `001-zitadel-bootstrap-service.sql` → `zitadel-bootstrap-reference.sql`
   - Added README documenting why archived
   - Kept as reference for patterns (circuit breaker, retry logic)

2. Updated `bootstrap-event-listener.sql` for Temporal integration
   - Removed PostgreSQL orchestration logic
   - Kept event-driven cleanup triggers
   - Added support for `organization.bootstrap.temporal_initiated` event
   - Updated status tracking functions

**Files Changed**:
- `infrastructure/supabase/sql/00-reference/` (new)
  - `README.md`
  - `zitadel-bootstrap-reference.sql`
- `infrastructure/supabase/sql/04-triggers/bootstrap-event-listener.sql` (updated)

### 🔄 Phase 1: Temporal Infrastructure (In Progress)

**Actions Taken**:
1. Created Kubernetes manifest directory: `infrastructure/k8s/temporal/`
2. Created deployment configuration files:
   - `namespace.yaml` - Temporal namespace
   - `secrets-template.yaml` - Credentials template
   - `configmap-dev.yaml` - Development environment config
   - `configmap-prod.yaml` - Production environment config
   - `values.yaml` - Helm chart values
   - `README.md` - Deployment documentation

**Next Steps**:
1. Create actual `secrets.yaml` with real credentials (git-crypted)
2. Deploy Temporal to k3s cluster:
   ```bash
   helm install temporal temporalio/temporal \
     --namespace temporal \
     --values infrastructure/k8s/temporal/values.yaml
   ```
3. Verify deployment:
   ```bash
   kubectl get pods -n temporal
   kubectl port-forward -n temporal svc/temporal-ui 8080:8080
   ```

### ✅ Phase 2: Database Schema (Complete)

**Actions Taken**:
1. Created `subdomain_status` ENUM type (`infrastructure/supabase/sql/01-events/003-subdomain-status-enum.sql`)
   - Values: `pending`, `dns_created`, `verifying`, `verified`, `failed`
   - Tracks subdomain provisioning lifecycle

2. Added subdomain columns to `organizations_projection` (`infrastructure/supabase/sql/02-tables/organizations/003-add-subdomain-columns.sql`)
   - `subdomain_status` - Provisioning status tracking
   - `cloudflare_record_id` - DNS record ID from Cloudflare
   - `dns_verified_at` - Verification timestamp
   - `subdomain_metadata` - JSONB for DNS record details, verification attempts, errors
   - Indexes for status querying and failed attempts

3. Created subdomain helper functions (`infrastructure/supabase/sql/03-functions/external-services/001-subdomain-helpers.sql`)
   - `get_base_domain()` - Returns environment-based domain (firstovertheline.com vs analytics4change.com)
   - `get_full_subdomain(slug)` - Computes {slug}.{base_domain}
   - `get_organization_subdomain(org_id)` - Gets subdomain for organization

4. Added subdomain event types (`infrastructure/supabase/contracts/types/events.ts`)
   - `SubdomainDNSCreatedEvent` - DNS record created
   - `SubdomainVerifiedEvent` - DNS verification successful
   - `SubdomainVerificationFailedEvent` - Verification failed
   - Updated `StreamType` to include `'subdomain'`

5. Updated event processor (`infrastructure/supabase/sql/03-functions/event-processing/002-process-organization-events.sql`)
   - Added handlers for all 3 subdomain events
   - Updates `subdomain_status` and `subdomain_metadata` based on events
   - Maintains CQRS projection integrity

**Files Changed**:
- `infrastructure/supabase/sql/01-events/003-subdomain-status-enum.sql` (new)
- `infrastructure/supabase/sql/02-tables/organizations/003-add-subdomain-columns.sql` (new)
- `infrastructure/supabase/sql/03-functions/external-services/001-subdomain-helpers.sql` (new)
- `infrastructure/supabase/contracts/types/events.ts` (modified)
- `infrastructure/supabase/sql/03-functions/event-processing/002-process-organization-events.sql` (modified)

**Key Decision**: Store `slug` only, compute full subdomain dynamically from environment-based `BASE_DOMAIN`
- No data migration needed when changing domains
- Environment-agnostic database schema
- Single source of truth for base domain (ConfigMaps)

### ⏳ Phase 3-10: Implementation (Pending)

See full implementation plan in approved plan above.

## Technical Architecture

### Workflow Orchestration (Temporal)

```
bootstrapOrganizationWorkflow
├─ createZitadelOrganization (activity)
├─ emitEvent: organization.zitadel.created
├─ createOrganizationRecord (activity)
├─ emitEvent: organization.created
├─ provisionSubdomainWorkflow (child, non-blocking)
│  ├─ createCloudflareRecord (activity)
│  ├─ emitEvent: organization.subdomain.dns_record_created
│  ├─ verifyDNS (activity with retry)
│  └─ emitEvent: organization.subdomain.verified
├─ assignAdminRole (activity)
├─ emitEvent: user.role.assigned
├─ sendAdminInvitation (activity)
└─ emitEvent: organization.bootstrap.completed
```

### Event Flow

```
1. Frontend → Temporal API: Start workflow
2. Temporal Worker → Zitadel API: Create org/user
3. Temporal Worker → Supabase: Insert organization.zitadel.created event
4. PostgreSQL Trigger → Update organizations_projection (CQRS)
5. Temporal Worker → Cloudflare API: Create DNS record
6. Temporal Worker → Poll DNS until verified
7. Temporal Worker → Supabase: Insert organization.subdomain.verified event
8. PostgreSQL Trigger → Update subdomain_status = 'active'
```

## Infrastructure

### Cloudflare
- **Zone ID**: `538e5229b00f5660508a1c7fcd097f97`
- **Account ID**: `78543858cff7b3f27078f7e9eee52c2a`
- **API Token**: Available (stored in secrets)
- **Provider**: Cloudflare DNS API

### Zitadel
- **Instance**: `analytics4change-zdswvg.us1.zitadel.cloud`
- **Project ID**: `339658577486583889`
- **Integration**: Real Management API (not simulated)

### Temporal
- **Deployment**: k3s cluster at `192.168.122.42`
- **Namespace**: `temporal`
- **UI**: Port 8080 (http://localhost:8080 after port-forward)
- **Storage**: PostgreSQL (Supabase or dedicated instance)
- **Cost**: $0 (runs on existing infrastructure)

## Environment Configuration

### Development
- Base Domain: `firstovertheline.com`
- App URL: `https://app.firstovertheline.com`
- Subdomains: `{slug}.firstovertheline.com`

### Production
- Base Domain: `analytics4change.com`
- App URL: `https://app.analytics4change.com`
- Subdomains: `{slug}.analytics4change.com`

## Timeline

- **Week 1**: ✅ Cleanup + Temporal k8s manifests
- **Week 2**: Deploy Temporal, database schema
- **Week 3**: Cloudflare integration
- **Week 4**: Subdomain workflow
- **Week 5**: Zitadel integration
- **Week 6**: Bootstrap workflow
- **Week 7**: Event processors
- **Week 8**: Frontend integration
- **Week 9**: Testing
- **Week 10**: Production deployment

## Success Criteria

**Phase 0-1:**
- ✅ Unused PostgreSQL functions archived (not deleted)
- ✅ Temporal k8s manifests created
- ✅ Temporal running on k3s with UI accessible
- ✅ PostgreSQL deployed for Temporal (dedicated instance)
- ✅ Temporal schemas initialized

**Phase 2:**
- ✅ Subdomain database schema created
- ✅ Event types defined for subdomain provisioning
- ✅ Event processors handle subdomain lifecycle
- ✅ Helper functions for environment-aware subdomains
- ⏳ Schema changes applied and tested in Supabase

**Future Phases:**
- ⏳ Bootstrap workflow completes in <30 seconds
- ⏳ Subdomain provisioned in background (1-10 minutes)
- ⏳ All events recorded in domain_events table
- ⏳ Zitadel org/user created via real API
- ⏳ DNS verified automatically
- ⏳ Subdomain status visible in admin panel

## Next Actions

1. ~~Create `infrastructure/k8s/temporal/secrets.yaml` with actual credentials~~ ✅
2. ~~Deploy Temporal to k3s cluster~~ ✅
3. ~~Verify Temporal UI is accessible~~ ✅
4. ~~Begin Phase 2: Database schema updates~~ ✅
5. **Apply Phase 2 schema changes to Supabase** ⬅ Current
6. Test subdomain helper functions in dev environment
7. Begin Phase 3: Cloudflare DNS integration (Temporal activities)
