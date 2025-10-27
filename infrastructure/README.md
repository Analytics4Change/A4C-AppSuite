# A4C Infrastructure

Infrastructure as Code and database schema for the Analytics4Change (A4C) platform.

---

## Overview

**Status**: Supabase Auth migration complete (frontend), workflows in progress
**Last Updated**: 2025-10-27

The A4C platform consists of:
- **Frontend**: React application with three-mode authentication system ✅
- **Authentication**: Supabase Auth (OAuth2 + Enterprise SSO)
- **Database**: Supabase PostgreSQL with event-driven schema (CQRS)
- **Workflows**: Temporal.io for orchestration
- **Infrastructure**: Kubernetes (k3s) for Temporal cluster

---

## Architecture

### Authentication & Authorization

**Primary Provider**: Supabase Auth (replaced Zitadel)

**Frontend Authentication** (✅ Complete 2025-10-27):
- Three-mode system: Mock, Integration, Production
- Provider interface pattern with dependency injection
- JWT custom claims: `org_id`, `user_role`, `permissions`, `scope_path`
- See: `.plans/supabase-auth-integration/frontend-auth-architecture.md`

**Backend Integration** (🚧 In Progress):
- Database hook for JWT custom claims enrichment
- RLS policies using JWT claims for multi-tenant isolation
- Organization management via Temporal workflows
- See: `.plans/supabase-auth-integration/custom-claims-setup.md`

### Database (Supabase PostgreSQL)

**Architecture**: Event-Driven with CQRS Projections

- **Events**: `domain_events` table (source of truth)
- **Projections**: Read models derived from event stream
- **RLS**: Multi-tenant isolation via JWT `org_id` claim
- **Triggers**: Automatic projection updates from events
- **Functions**: JWT enrichment, authorization helpers

**Deployment**:
```bash
cd infrastructure/supabase
psql -f DEPLOY_TO_SUPABASE_STUDIO.sql
```

**See**: `infrastructure/supabase/README.md` for detailed schema documentation

### Workflows (Temporal.io)

**Cluster**: Kubernetes deployment in `temporal` namespace

**Use Cases**:
- Organization bootstrap (provisioning, DNS, invitations)
- User invitation workflows
- DNS provisioning via Cloudflare API
- Email delivery

**Local Development**:
```bash
# Port-forward Temporal server
kubectl port-forward -n temporal svc/temporal-frontend 7233:7233

# Connect workers
cd temporal
TEMPORAL_ADDRESS=localhost:7233 npm run worker
```

**See**: `temporal/CLAUDE.md` for workflow development

---

## Directory Structure

```
infrastructure/
├── supabase/                    # Database schema and migrations
│   ├── sql/                     # Event-driven SQL schema
│   │   ├── 01-extensions/       # PostgreSQL extensions (ltree, uuid)
│   │   ├── 02-tables/           # CQRS projection tables
│   │   ├── 03-functions/        # JWT claims, authorization
│   │   ├── 04-triggers/         # Event processors
│   │   ├── 05-policies/         # RLS policies (deprecated location)
│   │   ├── 06-rls/              # RLS policies (current)
│   │   └── 99-seeds/            # Initial data
│   ├── DEPLOY_TO_SUPABASE_STUDIO.sql   # Master deployment script
│   ├── SUPABASE-AUTH-SETUP.md          # Auth configuration guide
│   └── README.md                         # Schema documentation
├── k8s/                         # Kubernetes deployments
│   └── temporal/                # Temporal.io cluster
│       ├── values.yaml          # Helm configuration
│       └── worker-deployment.yaml  # Worker pods
├── terraform/                   # Infrastructure as Code (future)
│   ├── environments/            # Environment-specific configs
│   └── modules/                 # Reusable modules
└── CLAUDE.md                    # Developer guidance
```

---

## Environment Variables

### Supabase (Database + Auth)

```bash
# Required for SQL migrations
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
export SUPABASE_ANON_KEY="your-anon-key"
```

### Temporal Workers (Kubernetes Secrets)

```bash
# View secrets
kubectl get secret temporal-worker-secrets -n temporal -o yaml

# Required:
# - TEMPORAL_ADDRESS=temporal-frontend.temporal.svc.cluster.local:7233
# - SUPABASE_URL=https://your-project.supabase.co
# - SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
# - CLOUDFLARE_API_TOKEN=your-cloudflare-token
# - SMTP_HOST, SMTP_USER, SMTP_PASS
```

### Frontend (Auth Provider Selection)

```bash
# Development (mock auth)
VITE_AUTH_PROVIDER=mock

# Integration (real auth for testing)
VITE_AUTH_PROVIDER=supabase
VITE_SUPABASE_URL=https://your-dev-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-dev-anon-key

# Production (real auth)
VITE_AUTH_PROVIDER=supabase
VITE_SUPABASE_URL=https://your-prod-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-prod-anon-key
```

---

## Migration from Zitadel to Supabase Auth

**Status**: Frontend complete, backend in progress

### Completed (2025-10-27)
✅ Frontend authentication architecture
✅ Three-mode system (mock/integration/production)
✅ Provider interface pattern
✅ JWT claims structure defined
✅ Mock development environment
✅ Integration testing environment
✅ Documentation complete

### In Progress
🚧 Database hook for JWT custom claims
🚧 RLS policy migration to use JWT claims
🚧 Temporal workflows for organization bootstrap
🚧 User invitation system

### Deprecated/Archived
❌ Zitadel Terraform modules → Archived
❌ Zitadel service integration → Removed from frontend
❌ collect-zitadel-data.sh → Historical reference only

**Note**: Some database tables retain "zitadel_" prefixes for backwards compatibility but are not actively used for authentication. These will be migrated in a future phase.

---

## Development Workflows

### Database Changes

1. **Create SQL migration** in `supabase/sql/<category>/`
2. **Add to deployment script** `DEPLOY_TO_SUPABASE_STUDIO.sql`
3. **Test locally** via `psql` or Supabase Studio
4. **Deploy** by running full deployment script
5. **Verify** with `VERIFY_DEPLOYMENT.sql`

### Frontend Development

1. **Mock Mode** - `npm run dev` (instant auth, UI iteration)
2. **Integration Mode** - `npm run dev:auth` (test OAuth, RLS, JWT)
3. **Production** - `npm run build` (auto-configured)

See: `frontend/CLAUDE.md` for complete frontend development guide

### Temporal Workflows

1. **Port-forward Temporal** cluster
2. **Start worker** in temporal/ directory
3. **Trigger workflow** from frontend or CLI
4. **Monitor** via Temporal Web UI (port 8080)

See: `temporal/CLAUDE.md` for workflow development guide

---

## Key Technologies

- **Supabase Auth**: OAuth2 PKCE (Google, GitHub) + Enterprise SSO (SAML 2.0)
- **PostgreSQL**: Event sourcing + CQRS projections
- **ltree**: Hierarchical organizational scopes
- **Temporal.io**: Durable workflow orchestration
- **Kubernetes (k3s)**: Temporal cluster hosting
- **Cloudflare API**: DNS provisioning for subdomains

---

## Security

### Multi-Tenant Isolation

**Critical**: RLS policies are the ONLY line of defense

```sql
-- Example: Tenant isolation via JWT
CREATE POLICY "tenant_isolation"
ON clients FOR ALL
USING (org_id = (auth.jwt()->>'org_id')::uuid);
```

**Never** trust `org_id` from client requests - always use JWT claims from `auth.jwt()`.

### JWT Custom Claims

Custom claims added via PostgreSQL database hook:

```json
{
  "org_id": "uuid",
  "user_role": "provider_admin",
  "permissions": ["medication.create", "client.view"],
  "scope_path": "org_acme_healthcare"
}
```

**Hook Location**: `supabase/sql/03-functions/authorization/002-authentication-helpers.sql`

---

## Documentation

### Planning Documents
- `.plans/supabase-auth-integration/` - Authentication migration plans
- `.plans/rbac-permissions/` - RBAC architecture
- `.plans/temporal-integration/` - Workflow specifications
- `.plans/auth-integration/` - Multi-tenancy architecture

### Developer Guides
- `CLAUDE.md` - Infrastructure development guide (this directory)
- `frontend/CLAUDE.md` - Frontend development guide
- `temporal/CLAUDE.md` - Workflow development guide
- `supabase/SUPABASE-AUTH-SETUP.md` - Auth configuration

### API Contracts
- `supabase/contracts/` - Event schemas (AsyncAPI)
- `supabase/contracts/types/` - TypeScript event types

---

## Common Tasks

### Deploy Database Changes

```bash
cd infrastructure/supabase

# Deploy all migrations
psql -f DEPLOY_TO_SUPABASE_STUDIO.sql

# Verify deployment
psql -f VERIFY_DEPLOYMENT.sql
```

### Test JWT Claims Hook

```sql
-- Test custom claims function
SELECT auth.custom_access_token_hook(
  jsonb_build_object(
    'user_id', 'your-user-uuid',
    'claims', '{}'::jsonb
  )
);
```

### Port-Forward Temporal

```bash
# Frontend service (for workers)
kubectl port-forward -n temporal svc/temporal-frontend 7233:7233

# Web UI (for monitoring)
kubectl port-forward -n temporal svc/temporal-web 8080:8080
```

### Check Temporal Workflows

```bash
# List workflows
temporal workflow list

# Describe workflow
temporal workflow describe -w <workflow-id>

# Show workflow history
temporal workflow show -w <workflow-id>
```

---

## Next Steps

### Phase 1: JWT Custom Claims (✅ Complete - Ready for Deployment)
- [x] Implement database hook for JWT enrichment
- [x] Create authentication helper functions for Supabase Auth
- [x] Add JWT claims extraction functions (org_id, user_role, permissions, scope_path)
- [x] Add organization switching functionality
- [x] Update deployment script with all new functions
- [ ] **Deploy to development** (Next: Follow `JWT-CLAIMS-SETUP.md`)
- [ ] Test custom claims with real authentication
- [ ] Deploy to production
- [ ] Verify RLS policies work with JWT claims

### Phase 2: Organization Workflows
- [ ] Implement organization bootstrap workflow (Temporal)
- [ ] DNS provisioning via Cloudflare API
- [ ] User invitation system
- [ ] Admin onboarding automation

### Phase 3: Enterprise SSO
- [ ] Configure SAML 2.0 providers (3-6 month timeline)
- [ ] Test SAML flows in development
- [ ] Document enterprise onboarding process

### Phase 4: Migration Cleanup
- [ ] Remove deprecated Zitadel mapping tables
- [ ] Archive Zitadel Terraform modules
- [ ] Update all documentation
- [ ] Remove zitadel_ prefixes from tables

---

## Support

For questions or issues:
- **Frontend Auth**: See `frontend/docs/auth-provider-architecture.md`
- **Database Schema**: See `supabase/README.md`
- **Workflows**: See `temporal/CLAUDE.md`
- **Architecture Plans**: See `.plans/` directory

---

**Document Version**: 2.0
**Last Updated**: 2025-10-27
**Migration Status**: Frontend Complete, Backend In Progress
