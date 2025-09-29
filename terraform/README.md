# Terraform Infrastructure Setup

This directory contains the Terraform configuration for managing A4C's Supabase infrastructure.

## Prerequisites

### 1. Install Terraform
```bash
# macOS with Homebrew
brew install terraform

# Or download from https://www.terraform.io/downloads
```

### 2. Install git-crypt
```bash
# macOS with Homebrew
brew install git-crypt

# Ubuntu/Debian
sudo apt-get install git-crypt
```

### 3. Unlock the Repository
The repository contains encrypted sensitive files. You need the git-crypt key to unlock them:

```bash
# From the repository root
git-crypt unlock A4C-Infrastructure-git-crypt.key
```

⚠️ **Never commit the git-crypt key file!** Share it securely via 1Password, AWS Secrets Manager, or other secure channels.

## Directory Structure

```
terraform/
├── environments/          # Environment-specific configurations
│   ├── dev/              # Development environment
│   ├── staging/          # Staging environment (TODO)
│   └── production/       # Production environment (TODO)
├── modules/              # Reusable Terraform modules
│   └── supabase/        # Supabase resource definitions
└── global/              # Shared configuration files
```

## Getting Started

### 1. Navigate to Environment
```bash
cd terraform/environments/dev
```

### 2. Initialize Terraform
```bash
terraform init
```

### 3. Review the Plan
```bash
terraform plan
```

### 4. Apply Changes
```bash
terraform apply
```

## Encrypted Files

The following files are encrypted with git-crypt:
- `terraform.tfvars` - Contains sensitive API tokens and keys
- Any file matching patterns in `.gitattributes`

### Viewing Encrypted Status
```bash
# Check if files are encrypted (locked)
git-crypt status

# Lock the repository (encrypt files)
git-crypt lock

# Unlock the repository (decrypt files)
git-crypt unlock A4C-Infrastructure-git-crypt.key
```

## Environment Variables

Each environment has its own `terraform.tfvars` file containing:
- `supabase_access_token` - Management API token from Supabase Dashboard
- `supabase_service_role_key` - Service role key for admin operations
- `supabase_project_ref` - Project reference ID

## Managing Credentials

### Updating Credentials
1. Unlock the repository with git-crypt
2. Edit `terraform/environments/<env>/terraform.tfvars`
3. Commit changes (files will be encrypted automatically)

### Getting New Tokens
- **Access Token**: https://supabase.com/dashboard/account/tokens
- **Project Keys**: https://supabase.com/dashboard/project/[project-ref]/settings/api

## Import Existing Resources

To avoid downtime, we import existing resources rather than recreating them:

```bash
# Example: Import an existing table
terraform import module.supabase.supabase_table.organizations "existing-table-id"

# Verify no changes are needed
terraform plan
# Should show: "No changes. Your infrastructure matches the configuration."
```

## Module Usage

The Supabase module manages:
- Database tables and schemas
- Row Level Security (RLS) policies
- Edge Functions
- Storage buckets
- Audit logging

### Feature Flags
Configure in `main.tf`:
```hcl
module "supabase" {
  source = "../../modules/supabase"

  enable_audit_logs      = true
  enable_api_rate_limits = true
  enable_hateoas         = false
}
```

## Troubleshooting

### Files Not Decrypting
```bash
# Check if repository is unlocked
git-crypt status

# Re-unlock if needed
git-crypt unlock A4C-Infrastructure-git-crypt.key
```

### Terraform Can't Find Provider
```bash
# Re-initialize to download providers
terraform init -upgrade
```

### Access Denied Errors
- Verify your access token is valid
- Check token hasn't expired
- Ensure you have the correct permissions in Supabase

## Security Best Practices

1. **Never commit unencrypted secrets**
2. **Keep git-crypt key secure** - Store in password manager
3. **Rotate tokens regularly** - Especially after team changes
4. **Use different tokens per environment**
5. **Enable state locking** when using remote backend
6. **Review changes** before applying to production

## Next Steps

1. Set up remote state backend (S3, Terraform Cloud)
2. Configure CI/CD pipeline for automated deployments
3. Implement remaining database tables from SUPABASE-INVENTORY.md
4. Set up staging and production environments
5. Create import scripts for existing resources