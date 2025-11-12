# GHCR Token Rotation Process

## Overview

The A4C-FrontEnd project uses a machine user account (`analytics4change-ghcr-bot`) with a Classic Personal Access Token for GitHub Container Registry (GHCR) authentication. This document outlines the token rotation process and schedule.

## Current Configuration

- **Machine User Account**: `analytics4change-ghcr-bot`
- **Token Name**: `A4C-GHCR-Pull-Token`
- **Token Scope**: `read:packages` (Classic PAT)
- **GitHub Secret**: `GHCR_PULL_TOKEN`
- **Expiration**: 90 days from creation
- **Created**: 2025-09-20

## Why Machine User Instead of Personal PAT

**Problem with Personal PATs:**
- Creates single point of failure tied to individual developer
- If developer leaves organization, deployments break
- Other developers cannot push to main without authentication issues

**Machine User Benefits:**
- Organization-owned account not tied to individuals
- Centralized token management
- Any authorized developer can rotate tokens
- Clear audit trail and access control

## Token Rotation Schedule

### **Quarterly Rotation (Recommended)**
- **Frequency**: Every 90 days
- **Next Due**: 2025-12-20
- **Reminder**: Set calendar alerts 2 weeks before expiration

### **Emergency Rotation**
- If token is potentially compromised
- If authentication failures are detected
- Before removing machine user from organization

## Rotation Process

### Prerequisites
- Admin access to Analytics4Change organization
- Access to `analytics4change-ghcr-bot` account credentials
- Admin access to A4C-FrontEnd repository

### Step-by-Step Process

#### 1. Generate New Token
```bash
# Log in as analytics4change-ghcr-bot
# Go to: https://github.com/settings/tokens
# Click "Generate new token (classic)"
# Configure:
#   - Name: A4C-GHCR-Pull-Token
#   - Expiration: 90 days
#   - Scopes: read:packages only
```

#### 2. Update Repository Secret
```bash
# Using GitHub CLI (as organization admin)
gh secret set GHCR_PULL_TOKEN --body "NEW_TOKEN_HERE" --repo Analytics4Change/A4C-FrontEnd

# Verify secret was updated
gh secret list --repo Analytics4Change/A4C-FrontEnd | grep GHCR
```

#### 3. Test Authentication
```bash
# Test the new token works
curl -H "Authorization: token NEW_TOKEN_HERE" \
  https://api.github.com/user/packages?package_type=container

# Should return JSON array (success) or error message
```

#### 4. Trigger Test Deployment
```bash
# Push a small change to trigger pipeline
git commit --allow-empty -m "test: Verify GHCR authentication after token rotation"
git push origin main

# Monitor deployment for authentication issues
gh run list --repo Analytics4Change/A4C-FrontEnd --limit 1
```

#### 5. Revoke Old Token
```bash
# Only after confirming new token works
# Go to: https://github.com/settings/tokens
# Find old token and click "Delete"
```

#### 6. Update Documentation
```bash
# Update creation date in this file
# Update next rotation due date
```

## Monitoring and Alerts

### Automated Monitoring
- Set up calendar reminders 2 weeks before expiration
- Monitor deployment failures for authentication errors
- Track GHCR pull failures in application logs

### Manual Checks
- Monthly verification that token still works
- Quarterly review of machine user permissions
- Annual review of rotation process effectiveness

## Troubleshooting

### Common Issues

#### "Authentication failed" during deployment
1. Check if token has expired
2. Verify secret is correctly set in repository
3. Confirm machine user still has organization access
4. Test token manually with curl commands above

#### "Permission denied" for GHCR operations
1. Verify machine user is still in Analytics4Change organization
2. Check if organization package permissions changed
3. Confirm token has `read:packages` scope
4. Verify package visibility settings

#### Machine user account issues
1. Confirm account hasn't been suspended
2. Check if 2FA is still configured correctly
3. Verify organization membership status
4. Review organization SSO requirements

### Emergency Contacts
- **Primary**: Organization administrators
- **Repository**: A4C-FrontEnd maintainers
- **Escalation**: Contact GitHub Support if account issues

## Security Considerations

### Token Security
- Never commit tokens to repository
- Use GitHub Secrets for storage
- Rotate tokens quarterly minimum
- Monitor token usage patterns

### Machine User Security
- Enable 2FA on machine user account
- Use strong, unique password
- Limit organization permissions to minimum required
- Regular audit of account activity

### Access Control
- Only organization admins can rotate tokens
- Document all token rotation activities
- Maintain audit trail of changes
- Review permissions quarterly

## Future Migration

### When GitHub Apps Support GHCR
Once GitHub officially supports GitHub App authentication for GHCR (currently in roadmap):
1. Create GitHub App with package permissions
2. Update workflow to use app authentication
3. Deprecate machine user account
4. Remove this rotation process

### Monitoring for Updates
- Check GitHub roadmap quarterly: https://github.com/github/roadmap
- Monitor GitHub blog for authentication updates
- Review GitHub Actions documentation for new features

---

**Last Updated**: 2025-09-20  
**Next Review**: 2025-12-20  
**Process Version**: 1.0