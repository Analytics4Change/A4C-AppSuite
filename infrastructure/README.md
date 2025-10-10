# A4C Infrastructure as Code

This repository manages the infrastructure for the Analytics4Change (A4C) platform using Terraform.

## Overview

The A4C platform consists of:
- **Frontend**: React application (A4C-FrontEnd repository)
- **Authentication**: Zitadel identity management
- **Database**: Supabase (PostgreSQL + Auth + Edge Functions)
- **Infrastructure**: Terraform configurations (this repository)

## Migration Plan

This infrastructure repository is being created to properly manage resources that were initially configured manually. The goal is to create idempotent Terraform configurations that can:

1. **Import existing resources** without disrupting current services
2. **Maintain state** of all infrastructure components
3. **Enable reproducible deployments** across environments
4. **Provide audit trail** of all infrastructure changes

## Current Manual Configuration Inventory

### Zitadel Configuration

#### Organizations
- **Primary Organization**: Analytics4Change
  - Type: Root organization for platform administration
  - Contains: Platform administrators, bootstrap configuration

#### Projects
- **Project ID**: 339658577486583889
- **Project Name**: A4C Platform
- **Client Applications**:
  - PKCE public client for React frontend
  - Redirect URIs configured for localhost and production

#### Roles (Manually Created)
Need to inventory from Zitadel console:
- [ ] List all existing roles
- [ ] Document role permissions
- [ ] Map to BOOTSTRAP_ROLES in frontend

#### Users
- Initial admin users configured
- Need to document user-role assignments

### Supabase Configuration

#### Database Schema
- [ ] Document existing tables
- [ ] Document RLS policies
- [ ] Document functions and triggers

#### Authentication
- [ ] Document auth providers configured
- [ ] Document auth policies

#### Edge Functions
- [ ] List any deployed edge functions
- [ ] Document environment variables

## Directory Structure

```
A4C-Infrastructure/
├── README.md                           # This file
├── terraform/
│   ├── environments/
│   │   ├── dev/
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── terraform.tfvars
│   │   ├── staging/
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── terraform.tfvars
│   │   └── production/
│   │       ├── main.tf
│   │       ├── variables.tf
│   │       └── terraform.tfvars
│   ├── modules/
│   │   ├── zitadel/
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   ├── outputs.tf
│   │   │   ├── roles.tf
│   │   │   ├── projects.tf
│   │   │   └── applications.tf
│   │   └── supabase/
│   │       ├── main.tf
│   │       ├── variables.tf
│   │       ├── outputs.tf
│   │       ├── database.tf
│   │       ├── auth.tf
│   │       └── edge-functions.tf
│   └── global/
│       ├── state.tf                   # Remote state configuration
│       └── versions.tf                # Provider version constraints
├── scripts/
│   ├── import-existing.sh             # Import existing resources
│   ├── backup-state.sh                # Backup terraform state
│   └── validate-deployment.sh         # Post-deployment validation
├── docs/
│   ├── INVENTORY.md                   # Detailed inventory of existing resources
│   ├── MIGRATION-PLAN.md              # Step-by-step migration plan
│   └── RUNBOOK.md                     # Operational procedures
└── .gitignore
```

## Implementation Phases

### Phase 1: Discovery & Documentation (Current)
- [x] Create infrastructure repository
- [ ] Complete inventory of existing Zitadel configuration
- [ ] Complete inventory of existing Supabase configuration
- [ ] Document all manual configurations
- [ ] Create terraform module structure

### Phase 2: Terraform Development
- [ ] Configure Terraform providers for Zitadel and Supabase
- [ ] Create modules for each service
- [ ] Write import configurations for existing resources
- [ ] Set up remote state management

### Phase 3: Import & Validation
- [ ] Import existing Zitadel resources
- [ ] Import existing Supabase resources
- [ ] Validate imported state matches reality
- [ ] Test plan/apply with no changes expected

### Phase 4: Environment Expansion
- [ ] Create dev environment configuration
- [ ] Create staging environment configuration
- [ ] Document environment promotion process
- [ ] Set up CI/CD for infrastructure changes

### Phase 5: Integration
- [ ] Update A4C-FrontEnd to use IaC-managed resources
- [ ] Create backend API proxy for Zitadel Management API
- [ ] Document new development workflow
- [ ] Train team on IaC processes

## Required Environment Variables

### For Terraform
```bash
# Zitadel Provider
export TF_VAR_zitadel_instance_url="https://analytics4change-zdswvg.us1.zitadel.cloud"
export TF_VAR_zitadel_service_user_id=""  # To be created
export TF_VAR_zitadel_service_user_secret=""  # To be created

# Supabase Provider
export TF_VAR_supabase_access_token=""  # From Supabase dashboard
export TF_VAR_supabase_project_ref=""  # From Supabase dashboard
```

## Prerequisites

### Required Tools
- Terraform >= 1.5.0
- Git
- jq (for JSON processing in scripts)
- curl (for API validation)

### Provider Documentation
- [Zitadel Terraform Provider](https://registry.terraform.io/providers/zitadel/zitadel/latest/docs)
- [Supabase Terraform Provider](https://registry.terraform.io/providers/supabase/supabase/latest/docs)

## Security Considerations

1. **State Management**: Terraform state contains sensitive data
   - Use remote state with encryption (S3 + DynamoDB or Terraform Cloud)
   - Enable state locking to prevent concurrent modifications
   - Regular state backups

2. **Secrets Management**:
   - Never commit secrets to Git
   - Use environment variables or secret management tools
   - Consider using Terraform Cloud for secure variable storage

3. **Access Control**:
   - Limit who can run Terraform apply in production
   - Use separate service accounts per environment
   - Audit all infrastructure changes

## Next Steps

1. **Immediate Actions**:
   - [ ] Access Zitadel console and document all existing configurations
   - [ ] Access Supabase dashboard and document all existing configurations
   - [ ] Create service accounts for Terraform in both platforms
   - [ ] Set up Terraform Cloud or S3 backend for state management

2. **Development Setup**:
   - [ ] Initialize Terraform configuration
   - [ ] Configure providers
   - [ ] Create first module (start with Zitadel roles)
   - [ ] Test import of one resource

3. **Validation**:
   - [ ] Run terraform plan to ensure no unexpected changes
   - [ ] Create automated tests for infrastructure
   - [ ] Document rollback procedures

## Contributing

This infrastructure is critical to the A4C platform. All changes must:
1. Be reviewed by at least one other team member
2. Be tested in dev environment first
3. Include documentation updates
4. Follow the principle of least privilege

## Support

For questions or issues:
- Create an issue in this repository
- Contact the platform team
- Refer to provider documentation links above