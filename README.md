# A4C AppSuite

Analytics4Change monorepo containing frontend and infrastructure components.

## Repository Structure

```
A4C-AppSuite/
├── frontend/          # React/TypeScript frontend application
└── infrastructure/    # Terraform infrastructure as code
```

## Overview

This monorepo consolidates the Analytics4Change (A4C) platform:

- **Frontend**: React-based medication management application
- **Infrastructure**: Terraform configurations for Zitadel (auth) and Supabase (database)

## Getting Started

### Frontend

```bash
cd frontend
npm install
npm run dev
```

See `frontend/CLAUDE.md` for detailed frontend development guidance.

### Infrastructure

```bash
cd infrastructure/terraform/environments/dev
terraform init
terraform plan
```

See `infrastructure/CLAUDE.md` for detailed infrastructure guidance.

## Deployment

### Automated Deployment (CI/CD)

The platform uses GitHub Actions for automated deployment to production:

- **Frontend**: Automatic deployment on merge to `main` (changes in `frontend/**`)
- **Temporal Workers**: Automatic deployment on merge to `main` (changes in `workflows/**`)
- **Database Migrations**: Automatic deployment on merge to `main` (changes in `infrastructure/supabase/sql/**`)

**Prerequisites:**
1. Update KUBECONFIG secret to use Cloudflare Tunnel endpoint
2. Ensure SQL migrations are idempotent
3. Configure all required GitHub secrets

See **[Deployment Runbook](infrastructure/CLAUDE.md#deployment-runbook)** for complete deployment procedures, troubleshooting, and disaster recovery.

### Manual Deployment

#### Frontend
```bash
cd frontend
docker build -t ghcr.io/analytics4change/a4c-frontend:latest .
kubectl apply -f frontend/k8s/deployment.yaml
kubectl rollout status deployment/a4c-frontend
```

#### Temporal Workers
```bash
cd workflows
docker build -t ghcr.io/analytics4change/a4c-workflows:latest .
kubectl set image deployment/workflow-worker \
  worker=ghcr.io/analytics4change/a4c-workflows:latest -n temporal
```

#### Database Migrations
```bash
# See infrastructure/supabase/SQL_IDEMPOTENCY_AUDIT.md first
psql -h db.<project-ref>.supabase.co -U postgres -d postgres \
  -f infrastructure/supabase/sql/<migration-file>.sql
```

### Deployment Documentation

- **Full Runbook**: [infrastructure/CLAUDE.md#deployment-runbook](infrastructure/CLAUDE.md#deployment-runbook)
- **KUBECONFIG Setup**: [documentation/infrastructure/operations/KUBECONFIG_UPDATE_GUIDE.md](documentation/infrastructure/operations/KUBECONFIG_UPDATE_GUIDE.md)
- **SQL Idempotency**: [documentation/infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md](documentation/infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md)
- **Connectivity Test**: [infrastructure/test-k8s-connectivity.sh](infrastructure/test-k8s-connectivity.sh)

## Git-Crypt

This repository uses git-crypt to encrypt sensitive files. After cloning:

```bash
git-crypt unlock /path/to/A4C-*.key
```

## Migration Notice

This repository was created by merging:
- `Analytics4Change/A4C-FrontEnd` → `frontend/`
- `Analytics4Change/A4C-Infrastructure` → `infrastructure/`

All commit history from both repositories has been preserved.

## Documentation

- Frontend Documentation: `frontend/CLAUDE.md`
- Infrastructure Documentation: `infrastructure/CLAUDE.md`
- Combined Guidance: `CLAUDE.md`
