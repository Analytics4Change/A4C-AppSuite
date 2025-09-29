# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the Infrastructure as Code (IaC) repository for Analytics4Change (A4C) platform, using Terraform to manage Zitadel (identity management) and Supabase (database/backend) infrastructure.

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
terraform/
├── environments/         # Environment-specific root modules
│   ├── dev/             # Dev environment configuration
│   ├── staging/         # Staging environment configuration
│   └── production/      # Production environment configuration
├── modules/             # Reusable Terraform modules
│   ├── zitadel/        # Zitadel IAM resources
│   └── supabase/       # Supabase database/backend resources
└── global/             # Shared configuration (providers, backend)
```

### Infrastructure Components

**Zitadel Instance**: `analytics4change-zdswvg.us1.zitadel.cloud`
- Project ID: `339658577486583889`
- Manages authentication for React frontend via OAuth2 PKCE flow
- Defines platform roles: super_admin, administrator, clinician, specialist, parent, youth

**Supabase Integration**:
- PostgreSQL database with Row Level Security
- Edge functions for business logic
- Integrated with Zitadel for authentication

### Migration Strategy

This repository follows an **import-first approach**:
1. Import existing manually-created resources into Terraform state
2. Validate that `terraform plan` shows no changes
3. Gradually add new resources via Terraform

Critical: Always use `terraform import` for existing resources - never recreate them.

## Environment Variables

Required for Terraform providers:
```bash
# Zitadel
export TF_VAR_zitadel_service_user_id="<service_user_id>"
export TF_VAR_zitadel_service_user_secret="<service_user_secret>"

# Supabase
export TF_VAR_supabase_access_token="<access_token>"
export TF_VAR_supabase_project_ref="<project_ref>"
```

## Key Considerations

1. **State Management**: Remote state will be configured in S3/Terraform Cloud with locking
2. **Zero Downtime**: All changes must maintain service availability
3. **Import First**: Always import existing resources rather than recreating them
4. **Environment Isolation**: Each environment has separate state and variables
5. **Service Accounts**: Use dedicated service accounts for Terraform operations