# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is the A4C (Analytics4Change) AppSuite monorepo, containing:

- **Frontend**: React/TypeScript medication management application (`frontend/`)
- **Workflows**: Temporal.io workflow orchestration for long-running business processes (`workflows/`)
- **Infrastructure**: Terraform-based infrastructure as code (`infrastructure/`)

## Monorepo Structure

```
A4C-AppSuite/
├── frontend/          # React application for medication management
│   ├── src/          # Application source code
│   └── CLAUDE.md     # Detailed frontend guidance
├── workflows/         # Temporal.io workflows and activities
│   ├── src/          # Workflows, activities, workers
│   │   ├── workflows/    # Durable workflow definitions
│   │   ├── activities/   # Side effects (API calls, events)
│   │   ├── worker/       # Worker startup
│   │   └── shared/       # Shared config and utilities
│   ├── Dockerfile    # Worker container image
│   └── CLAUDE.md     # Detailed workflow guidance
├── documentation/     # Consolidated documentation (115+ files)
│   ├── architecture/ # Cross-cutting concerns (auth, CQRS, multi-tenancy)
│   ├── frontend/     # Frontend guides and reference
│   ├── workflows/    # Workflow guides and reference
│   └── infrastructure/ # Infrastructure guides and reference
└── infrastructure/    # Terraform IaC and deployment configs
    ├── terraform/    # Terraform configurations
    ├── supabase/     # Supabase-specific resources (SQL, migrations)
    ├── k8s/          # Kubernetes deployments (Temporal, workers)
    └── CLAUDE.md     # Detailed infrastructure guidance
```

## Quick Start Commands

### Frontend Development

```bash
cd frontend
npm install
npm run dev        # Start development server
npm run build      # Production build
npm run test       # Run tests
npm run lint       # Lint code
```

### Workflow Development

```bash
cd workflows
npm install
npm run dev        # Start worker in development mode
npm run build      # Build for production
npm run test       # Run tests
npm run worker     # Run worker (requires TEMPORAL_ADDRESS env var)
```

**Note**: Temporal workers require connection to Temporal server. For local development:
```bash
kubectl port-forward -n temporal svc/temporal-frontend 7233:7233
TEMPORAL_ADDRESS=localhost:7233 npm run worker
```

### Infrastructure Management

```bash
cd infrastructure/terraform/environments/dev
terraform init
terraform plan
terraform apply
```

## Component-Specific Guidance

For detailed guidance on each component, refer to their respective CLAUDE.md files:

- **Frontend**: See `frontend/CLAUDE.md` for comprehensive React/TypeScript development guidelines, accessibility standards, state management patterns, and component architecture.

- **Workflows**: See `workflows/CLAUDE.md` for Temporal.io workflow development, activity patterns, event-driven architecture, error handling, and testing strategies.

- **Infrastructure**: See `infrastructure/CLAUDE.md` for Terraform workflows, provider configuration, environment management, and deployment procedures.

- **Documentation**: See `documentation/README.md` for consolidated architecture, guides, and reference documentation across all components.

## Common Development Workflows

### Making Cross-Component Changes

When making changes that affect multiple components:

1. **Infrastructure first**: Database schema, API contracts, event definitions
   - Update Supabase SQL schema (`infrastructure/supabase/sql/`)
   - Deploy migrations to development environment
2. **Workflow orchestration**: Temporal workflow logic and event emission
   - Create/update workflows (`workflows/src/workflows/`)
   - Create/update activities with event emission (`workflows/src/activities/`)
   - Test workflows locally against dev Temporal cluster
3. **Frontend integration**: UI to consume new features
   - Update React components to trigger workflows
   - Display workflow status and results
4. **End-to-end testing**: Verify complete flow
   - Test organization bootstrap from UI to completion
   - Verify events populate projections correctly

### Git-Crypt

This repository uses git-crypt for encrypting sensitive files:

```bash
# Unlock the repository after cloning
git-crypt unlock /path/to/A4C-AppSuite-git-crypt.key
```

### GitHub Actions

GitHub Actions workflows are located in `.github/workflows/` at the repository root. Each workflow is prefixed with its target component:

- `frontend-*.yml` - Frontend CI/CD workflows
- `infrastructure-*.yml` - Infrastructure workflows (when added)

Workflows use path filters to run only when relevant files change.

## Architecture Overview

### Authentication Flow

**Status**: ✅ Frontend implementation complete (2025-10-27)

#### Production Flow
1. Frontend authenticates users via **Supabase Auth** (OAuth2 PKCE for social login, SAML 2.0 for enterprise SSO)
2. Supabase Auth issues JWT tokens with custom claims (org_id, permissions, role, scope_path)
3. Custom claims added via PostgreSQL database hook
4. Row-level security (RLS) enforces multi-tenant data isolation using JWT claims
5. Frontend uses provider interface pattern for authentication abstraction

#### Development Modes

The frontend supports three authentication modes for different development needs:

1. **Mock Mode** (default) - `npm run dev`
   - Instant authentication without network calls
   - Complete JWT claims structure for RLS testing
   - Predefined user profiles (super_admin, provider_admin, clinician, etc.)
   - Use for: UI development, component testing

2. **Integration Mode** - `npm run dev:auth` or `npm run dev:integration`
   - Real OAuth flows with Google/GitHub
   - Real JWT tokens from Supabase development project
   - Custom claims from database hook
   - Use for: Testing authentication, OAuth flows, RLS policies

3. **Production Mode** - Automatic in production builds
   - Real Supabase Auth with social login
   - Enterprise SSO support (SAML 2.0)
   - JWT custom claims with full RLS enforcement

#### Key Implementation Details

- **Provider Interface**: `IAuthProvider` interface with dependency injection
- **Factory Pattern**: `AuthProviderFactory` selects provider based on environment
- **JWT Claims**: `org_id`, `user_role`, `permissions`, `scope_path` in all modes
- **Session Management**: Unified `Session` type across all providers
- **Testing**: Easy mocking via injected auth provider

**See**:
- `documentation/architecture/authentication/frontend-auth-architecture.md` (Complete implementation)
- `frontend/CLAUDE.md` (Developer guidance)
- `documentation/architecture/authentication/supabase-auth-overview.md` (Architecture overview)

### Data Flow
1. Frontend React app (`frontend/`)
2. Supabase Auth for authentication (`infrastructure/supabase/`)
3. Temporal workflows for orchestration (`workflows/`)
4. PostgreSQL with RLS and CQRS projections (`infrastructure/supabase/sql/`)

### Event-Driven Architecture
- **Domain events**: All state changes recorded as immutable events
- **Event store**: `domain_events` table in PostgreSQL
- **Projections**: Read models derived from event stream (CQRS pattern)
- **Temporal activities**: Emit domain events for all side effects
- **Event processors**: PostgreSQL triggers update projections

### Workflow Orchestration
- **Temporal.io**: Durable workflow orchestration platform
- **Deployed**: Kubernetes cluster (`temporal` namespace)
- **Use cases**: Organization onboarding, DNS provisioning, user invitations
- **Pattern**: Workflow-First with Saga compensation for rollback

### Infrastructure as Code
- Terraform manages Supabase resources (Zitadel migration complete - October 2025)
- Kubernetes deployments for Temporal server and workers
- Event-driven data model with CQRS projections
- Environment-specific configurations (dev/staging/production)

## Key Technologies

**Frontend:**
- React 19 + TypeScript
- Vite (build tool)
- MobX (state management)
- Tailwind CSS
- Playwright (E2E testing)

**Workflows:**
- Temporal.io (workflow orchestration)
- Node.js 20 + TypeScript
- Cloudflare API (DNS provisioning)
- Nodemailer (email delivery)

**Infrastructure:**
- Terraform (IaC)
- Supabase Auth (primary authentication provider)
- Supabase (PostgreSQL database, Edge Functions, RLS)
- Kubernetes (k3s cluster for Temporal and workers)

## Development Environment Variables

### Frontend (`frontend/.env.local`)
```env
VITE_RXNORM_API_URL=https://rxnav.nlm.nih.gov/REST
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Note: Zitadel migration complete (October 2025) - now using Supabase Auth
# VITE_ZITADEL_AUTHORITY=https://analytics4change-zdswvg.us1.zitadel.cloud (deprecated)
```

### Workflows (`workflows/.env` for local development)
```bash
export TEMPORAL_ADDRESS=localhost:7233  # or cluster address
export TEMPORAL_NAMESPACE=default
export TEMPORAL_TASK_QUEUE=bootstrap
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
export CLOUDFLARE_API_TOKEN=your-cloudflare-token
export SMTP_HOST=smtp.example.com
export SMTP_USER=your-smtp-user
export SMTP_PASS=your-smtp-password
```

### Infrastructure
```bash
export TF_VAR_supabase_access_token="..."
export TF_VAR_supabase_project_ref="..."

# Note: Zitadel migration complete (October 2025)
# export TF_VAR_zitadel_service_user_id="..." (deprecated)
# export TF_VAR_zitadel_service_user_secret="..." (deprecated)
```

## Testing Strategy

### Frontend Testing
- Unit tests: Vitest
- E2E tests: Playwright
- Accessibility: Manual keyboard navigation + screen reader testing

### Workflow Testing
- Activity unit tests: Jest
- Workflow replay tests: Temporal testing framework
- Integration tests: Test against dev Temporal cluster
- Local testing: Port-forward Temporal and run workers locally

### Infrastructure Testing
- Terraform validation: `terraform validate`
- Terraform plan: Dry-run to detect changes
- Manual verification after apply
- Event processing: Verify triggers update projections correctly

## Documentation Standards

Both components follow strict documentation requirements:
- All components must be documented
- TypeScript interfaces must match documentation exactly
- Run `npm run docs:check` before committing frontend changes

## Migration History

This monorepo was created by merging:
- `Analytics4Change/A4C-Infrastructure` → `infrastructure/`
- `Analytics4Change/A4C-FrontEnd` → `frontend/`

All commit history from both repositories has been preserved through git subtree merge.

## Support and Resources

- Frontend Details: `frontend/CLAUDE.md`
- Infrastructure Details: `infrastructure/CLAUDE.md`
- Frontend README: `frontend/README.md`
- Infrastructure README: `infrastructure/README.md`
