# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the Infrastructure as Code (IaC) repository for Analytics4Change (A4C) platform, managing:
- **Supabase**: Authentication (replacing Zitadel), database, Edge Functions, RLS policies
- **Kubernetes**: Temporal.io cluster for workflow orchestration
- **SQL Migrations**: Event-driven schema with CQRS projections
- **Terraform**: Infrastructure automation (future: Supabase resources via IaC)

**Migration Note**: Platform is migrating from Zitadel to Supabase Auth. Zitadel configurations are deprecated and archived in `.archived_plans/zitadel/`.

## Commands

### Terraform Commands
```bash
# Initialize Terraform (run in environment directory)
terraform init

# Validate configuration
terraform validate

# Format Terraform files
terraform fmt -recursive

# Plan changes (dry run)
terraform plan

# Apply changes
terraform apply

# Import existing resources
terraform import <resource_type>.<resource_name> <resource_id>

# Show current state
terraform state list
terraform state show <resource>
```

### Development Workflow
```bash
# Check for configuration drift
terraform plan -detailed-exitcode

# Generate resource import commands
terraform plan -generate-config-out=generated.tf

# Refresh state from actual infrastructure
terraform refresh
```

## Architecture

### Directory Structure
```
infrastructure/
├── terraform/            # Infrastructure as Code (Terraform)
│   ├── environments/     # Environment-specific root modules
│   │   ├── dev/         # Dev environment configuration
│   │   ├── staging/     # Staging environment configuration
│   │   └── production/  # Production environment configuration
│   ├── modules/         # Reusable Terraform modules
│   │   ├── zitadel/    # ⚠️ DEPRECATED - Archived
│   │   └── supabase/   # Supabase resources (future IaC)
│   └── global/         # Shared configuration (providers, backend)
├── supabase/            # Supabase database schema and migrations
│   ├── sql/            # SQL migrations (event-driven schema)
│   │   ├── 01-extensions/       # PostgreSQL extensions (ltree, uuid)
│   │   ├── 02-tables/          # Table definitions (CQRS projections)
│   │   ├── 03-functions/       # Database functions (JWT claims, etc.)
│   │   ├── 04-triggers/        # Event processors
│   │   ├── 05-policies/        # RLS policies
│   │   └── 99-seeds/           # Seed data
│   ├── DEPLOY_TO_SUPABASE_STUDIO.sql  # Deployment script
│   └── SUPABASE-AUTH-SETUP.md          # Auth configuration guide
└── k8s/                 # Kubernetes deployments
    └── temporal/        # Temporal.io cluster and workers
        ├── values.yaml          # Helm configuration
        ├── configmap-dev.yaml   # Dev environment config
        └── worker-deployment.yaml  # Temporal worker deployment
```

### Infrastructure Components

**Supabase** (Primary Backend):
- **Authentication**: Social login (Google, GitHub) + Enterprise SSO (SAML 2.0)
- **Database**: PostgreSQL with event-driven schema (CQRS projections)
- **RLS**: Multi-tenant isolation via JWT custom claims (`org_id`, `permissions`)
- **Edge Functions**: Business logic and API endpoints
- **Custom JWT Claims**: Via database hook (`auth.custom_access_token_hook`)

**Temporal.io** (Workflow Orchestration):
- **Cluster**: Deployed to Kubernetes (`temporal` namespace)
- **Frontend**: `temporal-frontend.temporal.svc.cluster.local:7233`
- **Web UI**: `temporal-web:8080` (port-forward to access)
- **Namespace**: `default`
- **Task Queue**: `bootstrap` (organization workflows)
- **Workers**: Deployed via `k8s/temporal/worker-deployment.yaml`

**Kubernetes** (k3s cluster):
- **Temporal Server**: Helm deployment with PostgreSQL backend
- **Temporal Workers**: Node.js application containers
- **Ingress**: Nginx ingress controller
- **Monitoring**: Prometheus + Grafana (planned)

**~~Zitadel Instance~~ (DEPRECATED)**: `analytics4change-zdswvg.us1.zitadel.cloud`
- ⚠️ **Migration in progress**: Replacing with Supabase Auth
- Project ID: `339658577486583889`
- Documentation archived in `.archived_plans/zitadel/`

### Migration Strategy

This repository follows an **import-first approach**:
1. Import existing manually-created resources into Terraform state
2. Validate that `terraform plan` shows no changes
3. Gradually add new resources via Terraform

Critical: Always use `terraform import` for existing resources - never recreate them.

## Environment Variables

### Terraform Providers
```bash
# Supabase
export TF_VAR_supabase_access_token="<access_token>"
export TF_VAR_supabase_project_ref="<project_ref>"

# Zitadel (DEPRECATED - remove after migration)
# export TF_VAR_zitadel_service_user_id="<service_user_id>"
# export TF_VAR_zitadel_service_user_secret="<service_user_secret>"
```

### Supabase Database
```bash
# For SQL migrations and custom claims setup
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
export SUPABASE_ANON_KEY="your-anon-key"
```

### Temporal Workers (Kubernetes Secrets)
```bash
# View secrets
kubectl get secret temporal-worker-secrets -n temporal -o yaml

# Required secrets:
# - TEMPORAL_ADDRESS=temporal-frontend.temporal.svc.cluster.local:7233
# - SUPABASE_URL=https://your-project.supabase.co
# - SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
# - CLOUDFLARE_API_TOKEN=your-cloudflare-token
# - SMTP_HOST, SMTP_USER, SMTP_PASS (email delivery)
```

## Key Considerations

1. **State Management**: Remote state will be configured in S3/Terraform Cloud with locking
2. **Zero Downtime**: All changes must maintain service availability
3. **Import First**: Always import existing resources rather than recreating them
4. **Environment Isolation**: Each environment has separate state and variables
5. **Service Accounts**: Use dedicated service accounts for Terraform operations