# Zitadel Infrastructure Inventory

This document provides a comprehensive inventory of all Zitadel resources for the Analytics4Change platform. Use this to document the current state before importing into Terraform.

**Instance URL**: https://analytics4change-zdswvg.us1.zitadel.cloud
**API URL**: https://api.analytics4change-zdswvg.us1.zitadel.cloud
**Last Updated**: [DATE]
**Updated By**: [NAME]

## Required Credentials and Setup

### Service User Credentials
```bash
# Service user for API access
export ZITADEL_CLIENT_ID="a4c-service-user"
export ZITADEL_CLIENT_SECRET="Uz7M7a7sAWHDTO7N3Y1O4mlVX4fRGhoiWS2KsvE4Qn4NbHB66Ehlnt708g22zEbJ"
export ZITADEL_INSTANCE="analytics4change-zdswvg.us1.zitadel.cloud"
export ZITADEL_API_URL="https://analytics4change-zdswvg.us1.zitadel.cloud"
```

### Required Permissions
The service user `a4c-service-user` has **Organization Project Owner** membership which provides:
- Full read/write access to project 339658577486583889
- Access to all applications, roles, and grants within the project
- Organization-level configuration read access
- User and grant management capabilities

This permission level is sufficient for complete inventory collection.

### Get Access Token
```bash
# Obtain JWT access token using client credentials
# The Project Owner role automatically grants all necessary scopes
ACCESS_TOKEN=$(curl -s -X POST "https://${ZITADEL_INSTANCE}/oauth/v2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=${ZITADEL_CLIENT_ID}" \
  -d "client_secret=${ZITADEL_CLIENT_SECRET}" \
  -d "scope=openid profile email urn:zitadel:iam:org:project:id:zitadel:aud" \
  | jq -r '.access_token')

echo "Access Token: ${ACCESS_TOKEN:0:20}..."
```

## Instance Configuration

### Instance Details
| Field | Value | Status |
|-------|-------|--------|
| Instance Name | analytics4change-zdswvg | ✅ Documented |
| Instance ID | `[TO BE COLLECTED]` | ⏳ Pending |
| Region | us1 | ✅ Documented |
| Tier | `[FREE/PAID]` | ⏳ Pending |
| Custom Domain | Not configured | ✅ Documented |
| Default Language | en | ⏳ Pending |
| Created Date | `[TO BE COLLECTED]` | ⏳ Pending |

### Instance Settings
```bash
# Get instance configuration
curl -s -X GET "${ZITADEL_API_URL}/admin/v1/iam" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  | jq '.'
```

## Organizations

### Default Organization
| Field | Value | Status |
|-------|-------|--------|
| Organization ID | `[TO BE COLLECTED]` | ⏳ Pending |
| Organization Name | Analytics4Change | ⏳ Pending |
| Primary Domain | `[TO BE COLLECTED]` | ⏳ Pending |
| Verified Domains | `[LIST]` | ⏳ Pending |
| State | Active | ⏳ Pending |

```bash
# Get default organization
curl -s -X GET "${ZITADEL_API_URL}/management/v1/orgs/default" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  | jq '.'

# List all organizations
curl -s -X POST "${ZITADEL_API_URL}/management/v1/orgs/_search" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  | jq '.'
```

### Tenant Organizations
| Org ID | Org Name | Domain | Parent Org | State | Metadata |
|--------|----------|--------|------------|-------|----------|
| `[IF ANY]` | | | | | |

## Projects

### A4C Platform Project
| Field | Value | Status |
|-------|-------|--------|
| Project ID | 339658577486583889 | ✅ Documented |
| Project Name | `[TO BE COLLECTED]` | ⏳ Pending |
| Resource Owner | `[ORG_ID]` | ⏳ Pending |
| State | Active | ⏳ Pending |
| Has Project Check | `[YES/NO]` | ⏳ Pending |
| Private Labeling Setting | `[SETTING]` | ⏳ Pending |
| Created Date | `[TO BE COLLECTED]` | ⏳ Pending |

```bash
# Get project details
curl -s -X GET "${ZITADEL_API_URL}/management/v1/projects/339658577486583889" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  | jq '.'

# List all projects
curl -s -X POST "${ZITADEL_API_URL}/management/v1/projects/_search" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  | jq '.'
```

## Applications

### Frontend Application (PKCE)
| Field | Value | Status |
|-------|-------|--------|
| Application Name | `[TO BE COLLECTED]` | ⏳ Pending |
| Application ID | `[TO BE COLLECTED]` | ⏳ Pending |
| Client ID | `[FROM .env: VITE_ZITADEL_CLIENT_ID]` | ⏳ Pending |
| Application Type | OIDC - PKCE | ⏳ Pending |
| Auth Method | PKCE (Code Challenge) | ⏳ Pending |
| Dev Mode | `[ENABLED/DISABLED]` | ⏳ Pending |
| State | Active | ⏳ Pending |

#### OAuth Configuration
| Setting | Value | Status |
|---------|-------|--------|
| Response Types | code | ⏳ Pending |
| Grant Types | authorization_code, refresh_token | ⏳ Pending |
| App Type | USER_AGENT | ⏳ Pending |
| Clock Skew | `[DURATION]` | ⏳ Pending |
| Additional Origins | `[LIST]` | ⏳ Pending |

#### Redirect URIs
| URI | Environment | Status |
|-----|-------------|--------|
| http://localhost:5173/auth/callback | Development | ⏳ Pending |
| `[PRODUCTION_URL]/auth/callback` | Production | ⏳ Pending |

#### Post Logout URIs
| URI | Environment | Status |
|-----|-------------|--------|
| http://localhost:5173 | Development | ⏳ Pending |
| `[PRODUCTION_URL]` | Production | ⏳ Pending |

#### Token Configuration
| Token Type | Expiration | Idle Expiration | Status |
|------------|------------|-----------------|--------|
| Access Token | `[DURATION]` | `[DURATION]` | ⏳ Pending |
| ID Token | `[DURATION]` | N/A | ⏳ Pending |
| Refresh Token | `[DURATION]` | `[DURATION]` | ⏳ Pending |
| User Info in ID Token | `[YES/NO]` | N/A | ⏳ Pending |

```bash
# Get all applications in project
curl -s -X POST "${ZITADEL_API_URL}/management/v1/projects/339658577486583889/apps/_search" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  | jq '.'

# Get specific application details (replace APP_ID)
curl -s -X GET "${ZITADEL_API_URL}/management/v1/projects/339658577486583889/apps/[APP_ID]" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  | jq '.'
```

### API/Service Applications
| App Name | App ID | Client ID | Auth Method | Scopes | Status |
|----------|--------|-----------|-------------|--------|--------|
| a4c-service-user | `[TO BE COLLECTED]` | a4c-service-user | Client Secret | `[LIST]` | ⏳ Pending |
| `[OTHER APPS]` | | | | | |

## Roles

### Platform Roles (from BOOTSTRAP_ROLES)
| Role Key | Display Name | Group | Description | Status |
|----------|--------------|-------|-------------|--------|
| super_admin | Super Administrator | Platform | Full system access including IAM | ⏳ Pending |
| partner_onboarder | Partner Onboarder | Platform | Can onboard new partner organizations | ⏳ Pending |
| administrator | Administrator | Platform | General administrative access | ⏳ Pending |
| provider_admin | Provider Administrator | Provider | Manage healthcare providers | ⏳ Pending |
| admin | Admin | Platform | Basic admin access | ⏳ Pending |
| clinician | Clinician | Clinical | Clinical access | ⏳ Pending |
| nurse | Nurse | Clinical | Nursing access | ⏳ Pending |
| caregiver | Caregiver | Clinical | Care provider access | ⏳ Pending |
| viewer | Viewer | Platform | Read-only access | ⏳ Pending |

```bash
# Get all roles in project
curl -s -X POST "${ZITADEL_API_URL}/management/v1/projects/339658577486583889/roles/_search" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"limit": 100}' \
  | jq '.result[] | {key: .key, display_name: .display_name, group: .group}'
```

### Custom Roles
| Role Key | Display Name | Group | Description | Status |
|----------|--------------|-------|-------------|--------|
| `[IF ANY]` | | | | |

## Users

### System Users
| Email | User ID | Type | State | Roles | Last Login |
|-------|---------|------|-------|-------|------------|
| lars.tice@gmail.com | 339658157368929074 | Human | Active | `[TO BE COLLECTED]` | `[DATE]` |

### Service Users
| Username | User ID | Client ID | Description | Access Token Expiry |
|----------|---------|-----------|-------------|-------------------|
| a4c-service-user | `[TO BE COLLECTED]` | a4c-service-user | Terraform/API Access | `[EXPIRY]` |

```bash
# Search for users
curl -s -X POST "${ZITADEL_API_URL}/management/v1/users/_search" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"limit": 100}' \
  | jq '.result[] | {id: .id, email: .human.email, username: .machine.username, state: .state}'

# Get specific user details
curl -s -X GET "${ZITADEL_API_URL}/management/v1/users/339658157368929074" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  | jq '.'
```

## User Grants (Role Assignments)

### Management Grants
| User | Role | Resource | Project | Org | Status |
|------|------|----------|---------|-----|--------|
| lars.tice@gmail.com | ORG_OWNER | Organization | N/A | Default | ⏳ Pending |
| lars.tice@gmail.com | IAM_OWNER | Instance | N/A | N/A | ⏳ Pending |
| lars.tice@gmail.com | PROJECT_OWNER | Project | 339658577486583889 | Default | ⏳ Pending |

### Application Grants
| User | Role(s) | Project | Organization | Status |
|------|---------|---------|--------------|--------|
| lars.tice@gmail.com | super_admin | 339658577486583889 | Default | ⏳ Pending |
| `[OTHER USERS]` | | | | |

```bash
# Get user grants
curl -s -X POST "${ZITADEL_API_URL}/management/v1/users/grants/_search" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"queries": [{"user_id_query": {"user_id": "339658157368929074"}}]}' \
  | jq '.result[] | {grant_id: .id, roles: .role_keys, project_id: .project_id}'

# Get all grants for project
curl -s -X POST "${ZITADEL_API_URL}/management/v1/users/grants/_search" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"queries": [{"project_id_query": {"project_id": "339658577486583889"}}]}' \
  | jq '.'
```

## Actions (Hooks/Flows)

### Configured Actions
| Action Name | ID | Script | State | Created |
|-------------|-----|--------|-------|---------|
| `[IF ANY]` | | | | |

### Flow Triggers
| Flow Type | Trigger Point | Action | Order | Status |
|-----------|---------------|--------|-------|--------|
| `[e.g., PreUserRegistration]` | | | | |

```bash
# List all actions
curl -s -X POST "${ZITADEL_API_URL}/management/v1/actions/_search" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  | jq '.'

# Get flow configuration
curl -s -X GET "${ZITADEL_API_URL}/management/v1/flows/types" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  | jq '.'
```

## Identity Providers

### External IDPs
| Provider Name | Type | Client ID | Enabled | Auto Register | Status |
|---------------|------|-----------|---------|---------------|--------|
| `[IF ANY]` | OAuth2/OIDC/SAML | | | | |

```bash
# List identity providers
curl -s -X POST "${ZITADEL_API_URL}/admin/v1/idps/_search" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  | jq '.'
```

## Security Settings

### Password Policy
| Setting | Value | Status |
|---------|-------|--------|
| Min Length | `[NUMBER]` | ⏳ Pending |
| Has Uppercase | `[YES/NO]` | ⏳ Pending |
| Has Lowercase | `[YES/NO]` | ⏳ Pending |
| Has Number | `[YES/NO]` | ⏳ Pending |
| Has Symbol | `[YES/NO]` | ⏳ Pending |

### Login Policy
| Setting | Value | Status |
|---------|-------|--------|
| Allow Username Password | `[YES/NO]` | ⏳ Pending |
| Allow Register | `[YES/NO]` | ⏳ Pending |
| Allow External IDP | `[YES/NO]` | ⏳ Pending |
| Force MFA | `[YES/NO]` | ⏳ Pending |
| Password Check Lifetime | `[DURATION]` | ⏳ Pending |

```bash
# Get password complexity policy
curl -s -X GET "${ZITADEL_API_URL}/management/v1/policies/password/complexity" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  | jq '.'

# Get login policy
curl -s -X GET "${ZITADEL_API_URL}/management/v1/policies/login" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  | jq '.'
```

## Custom Domain Configuration

| Domain | Status | SSL Certificate | DNS Configured |
|--------|--------|-----------------|----------------|
| `[IF CONFIGURED]` | | | |

## Metadata

### Organization Metadata
| Key | Value | Entity Type | Entity ID |
|-----|-------|-------------|-----------|
| `[IF ANY]` | | Organization | |

### User Metadata
| User | Key | Value | Purpose |
|------|-----|-------|---------|
| `[IF ANY]` | | | |

```bash
# Get organization metadata
curl -s -X POST "${ZITADEL_API_URL}/management/v1/orgs/metadata/_search" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  | jq '.'
```

## Quotas and Limits

| Resource | Used | Limit | Status |
|----------|------|-------|--------|
| Users | `[COUNT]` | `[LIMIT]` | ⏳ Pending |
| Organizations | `[COUNT]` | `[LIMIT]` | ⏳ Pending |
| Projects | `[COUNT]` | `[LIMIT]` | ⏳ Pending |
| Applications | `[COUNT]` | `[LIMIT]` | ⏳ Pending |
| Actions | `[COUNT]` | `[LIMIT]` | ⏳ Pending |
| Authentications/month | `[COUNT]` | `[LIMIT]` | ⏳ Pending |

## Integration Points

### Frontend Integration
- **Auth Library**: `@zitadel/react` (if using) or custom OIDC
- **Token Storage**: Session Storage / Local Storage
- **Refresh Strategy**: `[DESCRIBE]`
- **Logout Flow**: `[DESCRIBE]`

### Backend Integration
- **Token Validation**: `[METHOD]`
- **Role Extraction**: From JWT claims
- **User Sync**: `[MANUAL/WEBHOOK/SCHEDULED]`

### Supabase Integration
- **User Mapping**: `[DESCRIBE]`
- **Role Sync**: `[DESCRIBE]`
- **JWT Validation**: `[DESCRIBE]`

## Data Collection Script

Save this as `collect-zitadel-data.sh`:

```bash
#!/bin/bash

# Zitadel Data Collection Script
# Run this to collect all Zitadel configuration data

set -e

# Configuration
ZITADEL_CLIENT_ID="${ZITADEL_CLIENT_ID:-a4c-service-user}"
ZITADEL_CLIENT_SECRET="${ZITADEL_CLIENT_SECRET}"
ZITADEL_INSTANCE="${ZITADEL_INSTANCE:-analytics4change-zdswvg.us1.zitadel.cloud}"
ZITADEL_API_URL="https://api.${ZITADEL_INSTANCE}"
PROJECT_ID="339658577486583889"

# Output directory
OUTPUT_DIR="./zitadel-inventory-data"
mkdir -p "${OUTPUT_DIR}"

echo "Collecting Zitadel data..."
echo "Instance: ${ZITADEL_INSTANCE}"
echo "Output: ${OUTPUT_DIR}"

# Get access token
echo "Authenticating..."
ACCESS_TOKEN=$(curl -s -X POST "https://${ZITADEL_INSTANCE}/oauth/v2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=${ZITADEL_CLIENT_ID}" \
  -d "client_secret=${ZITADEL_CLIENT_SECRET}" \
  -d "scope=openid urn:zitadel:iam:org:project:read urn:zitadel:iam:org:read urn:zitadel:iam:user:read urn:zitadel:iam:application:read urn:zitadel:iam:role:read urn:zitadel:iam:grant:read" \
  | jq -r '.access_token')

if [ -z "${ACCESS_TOKEN}" ]; then
    echo "Failed to obtain access token"
    exit 1
fi

echo "Successfully authenticated"

# Function to make API call and save response
api_call() {
    local endpoint=$1
    local output_file=$2
    local method=${3:-GET}
    local data=${4:-}

    echo "Fetching ${endpoint}..."

    if [ "${method}" == "POST" ]; then
        curl -s -X POST "${ZITADEL_API_URL}${endpoint}" \
            -H "Authorization: Bearer ${ACCESS_TOKEN}" \
            -H "Content-Type: application/json" \
            -d "${data}" \
            | jq '.' > "${OUTPUT_DIR}/${output_file}"
    else
        curl -s -X GET "${ZITADEL_API_URL}${endpoint}" \
            -H "Authorization: Bearer ${ACCESS_TOKEN}" \
            | jq '.' > "${OUTPUT_DIR}/${output_file}"
    fi

    echo "  Saved to ${output_file}"
}

# Collect data
api_call "/management/v1/orgs/me" "organization.json"
api_call "/management/v1/projects/${PROJECT_ID}" "project.json"
api_call "/management/v1/projects/${PROJECT_ID}/apps/_search" "applications.json" "POST" '{"limit": 100}'
api_call "/management/v1/projects/${PROJECT_ID}/roles/_search" "roles.json" "POST" '{"limit": 100}'
api_call "/management/v1/users/_search" "users.json" "POST" '{"limit": 100}'
api_call "/management/v1/users/grants/_search" "user_grants.json" "POST" '{"limit": 100}'
api_call "/management/v1/policies/login" "login_policy.json"
api_call "/management/v1/policies/password/complexity" "password_policy.json"
api_call "/management/v1/actions/_search" "actions.json" "POST" '{}'
api_call "/admin/v1/idps/_search" "identity_providers.json" "POST" '{}'

echo ""
echo "Data collection complete!"
echo "Files saved in: ${OUTPUT_DIR}"
echo ""
echo "Next steps:"
echo "1. Review the JSON files in ${OUTPUT_DIR}"
echo "2. Update ZITADEL-INVENTORY.md with the collected data"
echo "3. Note any missing permissions if API calls failed"
echo "4. Manually verify critical settings in Zitadel console"
```

## Validation Checklist

### Pre-Collection
- [ ] Service user credentials configured
- [ ] Access token successfully obtained
- [ ] Required permissions verified

### Data Collection - Automated
- [ ] Organization details retrieved
- [ ] Project configuration exported
- [ ] Applications list complete
- [ ] Roles inventory complete
- [ ] Users and grants documented
- [ ] Policies captured
- [ ] Actions/Hooks identified
- [ ] Identity providers listed

### Manual Verification
- [ ] Login to Zitadel Console: https://analytics4change-zdswvg.us1.zitadel.cloud
- [ ] Verify project name matches ID 339658577486583889
- [ ] Confirm all 9 platform roles exist
- [ ] Check application redirect URIs
- [ ] Verify user role assignments
- [ ] Screenshot critical configurations
- [ ] Document any custom domain settings
- [ ] Check for any webhooks/integrations

### Cross-Reference with Frontend
- [ ] Match Client ID in .env with Zitadel application
- [ ] Verify redirect URIs match application configuration
- [ ] Confirm role names match BOOTSTRAP_ROLES
- [ ] Check organization ID matches frontend config

### Known Issues to Document
- [ ] CORS configuration for Management API
- [ ] Role detection limitations (ORG_OWNER/IAM_OWNER)
- [ ] Any hardcoded values (lars.tice@gmail.com)
- [ ] Missing features or workarounds

### Final Steps
- [ ] All [TO BE COLLECTED] fields populated
- [ ] Status columns updated to ✅
- [ ] Integration points documented
- [ ] Known issues listed with workarounds
- [ ] Document reviewed for completeness
- [ ] Ready for Terraform import planning

## Import Strategy

### Phase 1: Read-Only Import
1. Import existing resources without modification
2. Verify terraform plan shows no changes
3. Document any drift or inconsistencies

### Phase 2: Configuration Management
1. Manage configuration through Terraform
2. Add missing resources via Terraform
3. Standardize naming conventions

### Phase 3: Full Infrastructure as Code
1. All resources managed by Terraform
2. Automated provisioning for new environments
3. Disaster recovery procedures in place

## Notes and Observations

### Current Configuration
- Instance URL: analytics4change-zdswvg.us1.zitadel.cloud
- Using Zitadel Cloud (not self-hosted)
- Project ID: 339658577486583889
- Known admin user: lars.tice@gmail.com (ID: 339658157368929074)

### Security Considerations
- Service user has read-only permissions
- Client secret should be rotated regularly
- Consider using separate service users for different environments

### Migration Risks
- Avoid recreating existing resources
- Maintain current user sessions during migration
- Preserve all role assignments and grants
- Keep authentication flow unchanged

---

**Next Steps**:
1. Run `collect-zitadel-data.sh` script with credentials
2. Review collected JSON data
3. Update this document with actual values
4. Verify in Zitadel console
5. Plan Terraform import strategy