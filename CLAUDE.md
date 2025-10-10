# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is the A4C (Analytics4Change) AppSuite monorepo, containing:

- **Frontend**: React/TypeScript medication management application (`frontend/`)
- **Infrastructure**: Terraform-based infrastructure as code (`infrastructure/`)

## Monorepo Structure

```
A4C-AppSuite/
├── frontend/          # React application for medication management
│   ├── src/          # Application source code
│   ├── docs/         # Frontend documentation
│   └── CLAUDE.md     # Detailed frontend guidance
└── infrastructure/    # Terraform IaC for Zitadel and Supabase
    ├── terraform/    # Terraform configurations
    ├── supabase/     # Supabase-specific resources
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

- **Infrastructure**: See `infrastructure/CLAUDE.md` for Terraform workflows, provider configuration, environment management, and deployment procedures.

## Common Development Workflows

### Making Cross-Component Changes

When making changes that affect both frontend and infrastructure:

1. Start with infrastructure changes (database schema, API contracts)
2. Test infrastructure changes in dev environment
3. Update frontend to consume new infrastructure features
4. Test end-to-end integration

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
1. Frontend authenticates users via Zitadel (OAuth2 PKCE)
2. Zitadel issues JWT tokens
3. Supabase validates tokens for database access
4. Row-level security enforces data isolation

### Data Flow
1. Frontend React app (`frontend/`)
2. Supabase Edge Functions (managed in `infrastructure/supabase/`)
3. PostgreSQL with RLS (schema in `infrastructure/supabase/sql/`)

### Infrastructure as Code
- Terraform manages Zitadel and Supabase resources
- Import-first strategy for existing resources
- Environment-specific configurations (dev/staging/production)

## Key Technologies

**Frontend:**
- React 19 + TypeScript
- Vite (build tool)
- MobX (state management)
- Tailwind CSS
- Playwright (E2E testing)

**Infrastructure:**
- Terraform
- Zitadel (authentication)
- Supabase (database/backend)

## Development Environment Variables

### Frontend (`frontend/.env.local`)
```env
VITE_RXNORM_API_URL=https://rxnav.nlm.nih.gov/REST
VITE_ZITADEL_AUTHORITY=https://analytics4change-zdswvg.us1.zitadel.cloud
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

### Infrastructure
```bash
export TF_VAR_zitadel_service_user_id="..."
export TF_VAR_zitadel_service_user_secret="..."
export TF_VAR_supabase_access_token="..."
export TF_VAR_supabase_project_ref="..."
```

## Testing Strategy

### Frontend Testing
- Unit tests: Vitest
- E2E tests: Playwright
- Accessibility: Manual keyboard navigation + screen reader testing

### Infrastructure Testing
- Terraform validation: `terraform validate`
- Terraform plan: Dry-run to detect changes
- Manual verification after apply

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
