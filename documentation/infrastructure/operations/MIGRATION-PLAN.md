# Infrastructure Migration Plan

## Executive Summary

This document outlines the migration from manually configured infrastructure to Infrastructure as Code (IaC) using Terraform for the A4C platform. The migration will be performed in a zero-downtime manner, importing existing resources rather than recreating them.

## Current State Analysis

### Pain Points with Manual Configuration
1. **Authorization Issues**:
   - Bootstrap page requires hardcoded email addresses
   - Cannot dynamically check Zitadel management roles due to CORS
   - Roles must be manually synced between Zitadel and application

2. **Deployment Challenges**:
   - No reproducible environment creation
   - Manual configuration drift between environments
   - No audit trail of infrastructure changes

3. **Operational Risks**:
   - Single point of failure (manual knowledge)
   - No disaster recovery plan
   - No automated validation of configuration

### Existing Infrastructure

#### Zitadel Resources
- Instance: analytics4change-zdswvg.us1.zitadel.cloud
- Project ID: 339658577486583889
- OAuth Application configured with PKCE
- Unknown number of roles (needs inventory)
- User: lars.tice@gmail.com (admin)

#### Supabase Resources
- Project configured (project ref needed)
- Database schema (needs documentation)
- RLS policies (needs documentation)
- Authentication configured

## Migration Strategy

### Principles
1. **Zero Downtime**: Import existing resources, don't recreate
2. **Incremental**: Migrate one service at a time
3. **Reversible**: Maintain ability to rollback
4. **Validated**: Test each step thoroughly

### Approach: Blue-Green Migration
1. Import existing resources into Terraform state
2. Validate Terraform matches current configuration
3. Make changes through Terraform going forward
4. Keep manual access as emergency fallback

## Detailed Migration Steps

### Phase 1: Preparation (Week 1)

#### Day 1-2: Inventory
- [ ] Login to Zitadel Console
  - Document all projects
  - Document all applications
  - Document all roles and permissions
  - Document user assignments
  - Export configuration if possible

- [ ] Login to Supabase Dashboard
  - Document database schema
  - Document RLS policies
  - Document auth configuration
  - Document edge functions
  - Note project reference ID

#### Day 3-4: Setup
- [ ] Create service accounts
  ```bash
  # Zitadel: Create service user with management permissions
  # Supabase: Generate management API token
  ```

- [ ] Initialize Terraform repository
  ```bash
  cd /Users/lars/dev/A4C-Infrastructure
  git init
  terraform init
  ```

- [ ] Configure state backend
  ```hcl
  # Use Terraform Cloud or S3+DynamoDB
  terraform {
    backend "s3" {
      bucket         = "a4c-terraform-state"
      key            = "infrastructure/terraform.tfstate"
      region         = "us-east-1"
      dynamodb_table = "terraform-state-lock"
      encrypt        = true
    }
  }
  ```

#### Day 5: Initial Configuration
- [ ] Create provider configurations
- [ ] Create module structure
- [ ] Set up environment separation

### Phase 2: Zitadel Migration (Week 2)

#### Day 1-2: Roles and Permissions
```hcl
# terraform/modules/zitadel/roles.tf
resource "zitadel_project_role" "super_admin" {
  org_id       = var.org_id
  project_id   = var.project_id
  role_key     = "super_admin"
  display_name = "Super Administrator"
  group        = "Administration"
}

# Import existing role
# terraform import zitadel_project_role.super_admin <role_id>
```

#### Day 3-4: Import and Validate
```bash
# Import each existing resource
terraform import zitadel_project_role.super_admin "existing-role-id"
terraform import zitadel_application.frontend "existing-app-id"

# Validate no changes needed
terraform plan
# Should show: "No changes. Your infrastructure matches the configuration."
```

#### Day 5: Testing
- [ ] Run bootstrap from frontend
- [ ] Verify roles created correctly
- [ ] Test user authentication flow
- [ ] Document any issues

### Phase 3: Supabase Migration (Week 3)

#### Day 1-2: Database Schema
```hcl
# terraform/modules/supabase/database.tf
resource "supabase_table" "users" {
  project_id = var.project_ref
  name       = "users"
  schema     = "public"

  columns = [
    {
      name = "id"
      type = "uuid"
      primary_key = true
    },
    {
      name = "email"
      type = "text"
      unique = true
    }
  ]
}
```

#### Day 3-4: RLS Policies
```hcl
resource "supabase_rls_policy" "users_select" {
  project_id = var.project_ref
  table      = "users"
  name       = "Users can view own profile"
  command    = "SELECT"
  definition = "auth.uid() = id"
}
```

#### Day 5: Import and Validate
```bash
# Import existing tables and policies
terraform import supabase_table.users "table-id"
terraform import supabase_rls_policy.users_select "policy-id"
```

### Phase 4: Backend Proxy Implementation (Week 4)

#### Option A: Supabase Edge Function
```typescript
// supabase/functions/zitadel-proxy/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req) => {
  // Validate authentication
  const token = req.headers.get('Authorization')
  if (!validateToken(token)) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Proxy to Zitadel Management API
  const response = await fetch('https://api.zitadel.instance/v1/users/me/memberships', {
    headers: {
      'Authorization': token,
      'Accept': 'application/json'
    }
  })

  return response
})
```

#### Option B: Vercel Function
```typescript
// api/zitadel-proxy.ts
export default async function handler(req, res) {
  // Similar implementation
}
```

### Phase 5: Integration and Cutover (Week 5)

#### Day 1-2: Update Frontend
- [ ] Update frontend to use proxy endpoint
- [ ] Remove hardcoded email workarounds
- [ ] Test role detection through proxy

#### Day 3-4: Documentation
- [ ] Update README files
- [ ] Create runbooks
- [ ] Document emergency procedures

#### Day 5: Cutover
- [ ] Deploy to production
- [ ] Monitor for issues
- [ ] Keep manual access ready

## Rollback Plan

### If Issues During Import
1. Don't apply Terraform changes
2. Continue using manual configuration
3. Fix import configurations
4. Retry import

### If Issues After Migration
1. Remove resources from Terraform state (don't destroy)
2. Continue managing manually
3. Fix issues in development environment
4. Re-attempt migration

## Success Criteria

### Technical Success
- [ ] All existing resources imported without changes
- [ ] Terraform plan shows no drift
- [ ] Bootstrap process works through IaC
- [ ] No hardcoded emails needed
- [ ] Management roles detected dynamically

### Operational Success
- [ ] Zero downtime during migration
- [ ] Team trained on Terraform workflow
- [ ] Documentation complete
- [ ] Automated testing in place
- [ ] Disaster recovery tested

## Risk Mitigation

### Risk: State Corruption
**Mitigation**:
- Enable state locking
- Regular state backups
- Use versioned state storage

### Risk: Accidental Resource Deletion
**Mitigation**:
- Use prevent_destroy lifecycle rules
- Require approval for production changes
- Test all changes in dev first

### Risk: Service Account Compromise
**Mitigation**:
- Rotate credentials regularly
- Use minimal permissions
- Audit all access

## Timeline Summary

| Week | Phase | Deliverable |
|------|-------|-------------|
| 1 | Preparation | Inventory complete, Terraform initialized |
| 2 | Zitadel Migration | Roles and auth imported |
| 3 | Supabase Migration | Database and policies imported |
| 4 | Backend Proxy | CORS solution implemented |
| 5 | Integration | Full platform on IaC |

## Next Immediate Steps

1. **Today**:
   - Access Zitadel console
   - Start documenting existing resources
   - Create INVENTORY.md with findings

2. **Tomorrow**:
   - Access Supabase dashboard
   - Complete inventory documentation
   - Plan service account creation

3. **This Week**:
   - Initialize Terraform configuration
   - Create first import script
   - Test with one simple resource

## Questions to Answer

Before proceeding, we need to answer:

1. **Zitadel Questions**:
   - What roles currently exist?
   - What permissions are assigned to each role?
   - What users have which roles?
   - What's the OAuth application configuration?

2. **Supabase Questions**:
   - What's the project reference ID?
   - What tables exist?
   - What RLS policies are configured?
   - Are there any edge functions deployed?

3. **Operational Questions**:
   - Where will we store Terraform state?
   - Who needs access to run Terraform?
   - What's our approval process for changes?
   - How do we handle secrets?

## Communication Plan

- [ ] Notify team of migration plan
- [ ] Schedule knowledge transfer sessions
- [ ] Create Slack channel for migration updates
- [ ] Document all decisions in ADRs (Architecture Decision Records)