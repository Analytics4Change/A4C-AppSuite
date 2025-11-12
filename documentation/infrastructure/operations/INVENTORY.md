# Infrastructure Inventory

This document captures the current state of manually configured infrastructure that needs to be imported into Terraform.

## Zitadel Configuration

### Instance Details
- **Instance URL**: https://analytics4change-zdswvg.us1.zitadel.cloud
- **API URL**: https://api.analytics4change-zdswvg.us1.zitadel.cloud
- **Instance ID**: `[TO BE DOCUMENTED]`
- **Default Organization ID**: `[TO BE DOCUMENTED]`

### Projects

#### A4C Platform Project
- **Project ID**: 339658577486583889
- **Project Name**: `[TO BE DOCUMENTED]`
- **Created Date**: `[TO BE DOCUMENTED]`
- **Description**: `[TO BE DOCUMENTED]`

### Applications

#### Frontend Application (PKCE)
- **Application ID**: `[TO BE DOCUMENTED]`
- **Client ID**: `[FROM .env: VITE_ZITADEL_CLIENT_ID]`
- **Application Type**: PKCE (Public Client)
- **Redirect URIs**:
  - http://localhost:5173/auth/callback
  - `[PRODUCTION URL]/auth/callback`
- **Post Logout URIs**:
  - http://localhost:5173
  - `[PRODUCTION URL]`
- **Allowed Origins**: `[TO BE DOCUMENTED]`
- **Dev Mode**: `[YES/NO]`
- **Token Settings**:
  - Access Token Type: `[JWT/Opaque]`
  - Access Token Expiration: `[DURATION]`
  - ID Token Expiration: `[DURATION]`
  - Refresh Token Expiration: `[DURATION]`
- **Granted Scopes**:
  - openid
  - profile
  - email
  - offline_access
  - urn:zitadel:iam:org:project:id:zitadel:aud

### Roles

#### Platform Roles (Expected from BOOTSTRAP_ROLES)

| Role Key | Display Name | Description | Status |
|----------|--------------|-------------|---------|
| super_admin | Super Administrator | Full system access | `[EXISTS/MISSING]` |
| partner_onboarder | Partner Onboarder | Can onboard new partners | `[EXISTS/MISSING]` |
| administrator | Administrator | General admin access | `[EXISTS/MISSING]` |
| provider_admin | Provider Administrator | Manage healthcare providers | `[EXISTS/MISSING]` |
| admin | Admin | Basic admin access | `[EXISTS/MISSING]` |
| clinician | Clinician | Clinical access | `[EXISTS/MISSING]` |
| nurse | Nurse | Nursing access | `[EXISTS/MISSING]` |
| caregiver | Caregiver | Care provider access | `[EXISTS/MISSING]` |
| viewer | Viewer | Read-only access | `[EXISTS/MISSING]` |

#### Management Roles (System)
- **ORG_OWNER**: `[USER LIST]`
- **IAM_OWNER**: `[USER LIST]`
- **PROJECT_OWNER**: `[USER LIST]`

### Users

#### Admin Users
| Email | User ID | Roles | Created Date | Status |
|-------|---------|-------|--------------|--------|
| lars.tice@gmail.com | 339658157368929074 | `[TO BE DOCUMENTED]` | `[DATE]` | Active |
| `[OTHER ADMINS]` | | | | |

### Organizations

#### Primary Organization
- **Organization ID**: `[TO BE DOCUMENTED]`
- **Organization Name**: Analytics4Change
- **Type**: Root Organization
- **Metadata**: `[TO BE DOCUMENTED]`

#### Tenant Organizations (if any)
| Org ID | Org Name | Type | Parent Org | Metadata |
|--------|----------|------|------------|----------|
| | | | | |

### API Keys / Service Users
| Name | User ID | Client ID | Scopes | Created | Expires |
|------|---------|-----------|--------|---------|---------|
| `[IF ANY EXIST]` | | | | | |

### Actions (Hooks)
| Name | Trigger | Script Location | Status |
|------|---------|-----------------|--------|
| `[IF ANY EXIST]` | | | |

### Identity Providers
| Name | Type | Client ID | Status |
|------|------|-----------|--------|
| `[IF ANY CONFIGURED]` | | | |

## Supabase Configuration

### Project Details
- **Project Name**: `[TO BE DOCUMENTED]`
- **Project Reference**: `[TO BE DOCUMENTED]`
- **Project URL**: `[TO BE DOCUMENTED]`
- **API URL**: `[TO BE DOCUMENTED]`
- **Database URL**: `[TO BE DOCUMENTED]`
- **Region**: `[TO BE DOCUMENTED]`
- **Created Date**: `[TO BE DOCUMENTED]`

### Database Schema

#### Tables

##### users
```sql
-- [TO BE DOCUMENTED: Run \d+ users in SQL editor]
CREATE TABLE users (
  id UUID PRIMARY KEY,
  ...
);
```

##### clients
```sql
-- [TO BE DOCUMENTED: Run \d+ clients in SQL editor]
CREATE TABLE clients (
  ...
);
```

##### medications
```sql
-- [TO BE DOCUMENTED: Run \d+ medications in SQL editor]
CREATE TABLE medications (
  ...
);
```

#### RLS Policies

##### users table policies
| Policy Name | Command | Definition | Roles |
|------------|---------|------------|-------|
| `[TO BE DOCUMENTED]` | SELECT | | |

##### clients table policies
| Policy Name | Command | Definition | Roles |
|------------|---------|------------|-------|
| `[TO BE DOCUMENTED]` | | | |

#### Functions
| Function Name | Arguments | Returns | Purpose |
|--------------|-----------|---------|---------|
| `[IF ANY EXIST]` | | | |

#### Triggers
| Trigger Name | Table | Event | Function |
|--------------|-------|-------|----------|
| `[IF ANY EXIST]` | | | |

### Authentication Configuration

#### Providers
| Provider | Status | Client ID | Settings |
|----------|--------|-----------|----------|
| Email | `[ENABLED/DISABLED]` | N/A | |
| Zitadel (Custom) | `[CONFIGURED?]` | | |

#### JWT Configuration
- **JWT Secret**: `[CONFIGURED]`
- **JWT Expiry**: `[DURATION]`
- **Custom Claims**: `[IF ANY]`

### Storage Buckets
| Bucket Name | Public | Allowed MIME Types | Max File Size |
|-------------|--------|-------------------|---------------|
| `[IF ANY EXIST]` | | | |

### Edge Functions
| Function Name | URL Path | Environment Variables | Deployed |
|--------------|----------|----------------------|----------|
| `[IF ANY EXIST]` | | | |

### Secrets and Environment Variables
| Key | Purpose | Set In |
|-----|---------|--------|
| ZITADEL_INSTANCE_URL | Zitadel OAuth endpoint | Edge Functions |
| `[OTHER VARS]` | | |

### API Keys
| Name | Key Prefix | Scopes | Created | Last Used |
|------|------------|--------|---------|-----------|
| `[IF ANY EXIST]` | | | | |

## Current Integration Points

### Frontend → Zitadel
- **Authentication Flow**: PKCE OAuth 2.0
- **Token Storage**: Session Storage
- **Refresh Strategy**: `[TO BE DOCUMENTED]`
- **Logout Flow**: `[TO BE DOCUMENTED]`

### Frontend → Supabase
- **Connection Method**: `[Direct/Proxy]`
- **Authentication**: `[How tokens are passed]`
- **Real-time Subscriptions**: `[IF ANY]`

### Zitadel ↔ Supabase
- **User Sync**: `[Manual/Automatic]`
- **Role Mapping**: `[TO BE DOCUMENTED]`
- **Token Validation**: `[TO BE DOCUMENTED]`

## Known Issues and Gaps

### Current Problems
1. **CORS Issue**: Cannot call Zitadel Management API from browser
2. **Role Detection**: Cannot detect ORG_OWNER/IAM_OWNER roles in frontend
3. **Bootstrap Access**: Requires hardcoded email for lars.tice@gmail.com
4. **[OTHER ISSUES]**:

### Missing Features
1. Backend proxy for Zitadel Management API
2. Automated role synchronization
3. Multi-tenant organization support
4. `[OTHER GAPS]`

## Data to Collect

### From Zitadel Console
- [ ] Login and navigate to Projects
- [ ] Document exact project name and settings
- [ ] Navigate to Applications
- [ ] Document all application settings
- [ ] Navigate to Roles
- [ ] List all roles with their exact keys
- [ ] Navigate to Users
- [ ] Document user-role assignments
- [ ] Check for any Actions/Hooks
- [ ] Check for any API keys/Service users

### From Supabase Dashboard
- [ ] Get project reference from Settings
- [ ] Export database schema
- [ ] Document all RLS policies
- [ ] List any edge functions
- [ ] Document storage buckets
- [ ] Check authentication providers
- [ ] Note any custom configurations

### From Application Code
- [ ] Verify all environment variables in use
- [ ] Document any hardcoded values
- [ ] List all API endpoints called
- [ ] Note any workarounds in code

## Notes

### Conventions and Patterns
- Role names use snake_case (e.g., super_admin)
- `[OTHER PATTERNS OBSERVED]`

### Temporary Solutions
- lars.tice@gmail.com hardcoded as admin in useZitadelAdmin hook
- `[OTHER TEMPORARY FIXES]`

### Dependencies
- Frontend depends on specific role names from Zitadel
- `[OTHER DEPENDENCIES]`

---

**Last Updated**: [DATE]
**Updated By**: [NAME]
**Next Review**: [DATE]

## Checklist for Completion

- [ ] All Zitadel resources documented
- [ ] All Supabase resources documented
- [ ] All integration points mapped
- [ ] All credentials/secrets identified (not values)
- [ ] All issues and gaps listed
- [ ] Screenshots taken of key configurations
- [ ] Export of database schema obtained
- [ ] Review with team completed