# Provider Onboarding Quickstart Guide

**Version**: 1.0
**Last Updated**: 2025-12-02
**Status**: Current

## Overview

This guide walks through the process of creating a new provider organization in A4C-AppSuite. Provider onboarding uses the **Organization Bootstrap Workflow** orchestrated by Temporal to ensure reliable, fault-tolerant creation of all required resources.

### Architecture Summary

```
Frontend Form → Backend API → Temporal → Domain Events → PostgreSQL
     │              │            │            │               │
     │              │            │            │               └─ Projections updated via triggers
     │              │            │            └─ Events stored for audit trail
     │              │            └─ 12 activities (6 forward + 6 compensation)
     │              └─ JWT validation, workflow initiation
     └─ 3-section form with validation
```

---

## Prerequisites

Before creating a provider organization, ensure:

1. **User Authentication**: You must be logged in with a user that has `organization.create_root` permission
2. **Network Access**: The frontend must be able to reach the Backend API (`api-a4c.firstovertheline.com`)
3. **Temporal Cluster**: The Temporal cluster must be running and accessible from the Backend API

---

## Step-by-Step Guide

### Step 1: Navigate to Organization Creation

1. Log into the A4C application
2. Navigate to **Organizations** → **Create New Organization**
3. Select **Provider** as the organization type

### Step 2: Complete the General Information Section

This section captures the organization's primary contact and headquarters information.

| Field | Required | Description |
|-------|----------|-------------|
| **Organization Name** | Yes | Legal name of the provider organization |
| **Subdomain** | Yes | URL-safe identifier (auto-formatted, lowercase, hyphens) |
| **Headquarters Address** | Yes | Primary business address |
| **Street 1** | Yes | Street address line 1 |
| **Street 2** | No | Suite, floor, etc. |
| **City** | Yes | City name |
| **State** | Yes | 2-letter state code |
| **ZIP Code** | Yes | 5-digit ZIP code |
| **General Phone** | Yes | Main contact phone number |
| **Phone Extension** | No | Optional extension |

### Step 3: Complete the Billing Information Section

The Billing section is **only visible for Provider organizations** (not Partners).

| Field | Required | Description |
|-------|----------|-------------|
| **Billing Contact First Name** | Yes | Accounts payable contact first name |
| **Billing Contact Last Name** | Yes | Accounts payable contact last name |
| **Billing Contact Email** | Yes | Email for invoices and billing |
| **Billing Contact Title** | No | Job title |
| **Billing Contact Department** | No | Department name |
| **Billing Address** | Yes | Address for billing correspondence |
| **Billing Phone** | Yes | Phone for billing inquiries |

#### "Use General Information" Checkbox

Check this box to automatically copy the address and/or phone from the General Information section. This creates a **junction link** to the same record (not a duplicate).

- **Use General Address for Billing**: Copies headquarters address to billing
- **Use General Phone for Billing**: Copies general phone to billing

### Step 4: Complete the Provider Admin Section

This section identifies the initial administrator for the provider organization.

| Field | Required | Description |
|-------|----------|-------------|
| **Provider Admin First Name** | Yes | Admin user first name |
| **Provider Admin Last Name** | Yes | Admin user last name |
| **Provider Admin Email** | Yes | Email for login and invitation |
| **Provider Admin Title** | No | Job title |
| **Provider Admin Department** | No | Department name |
| **Provider Admin Address** | Yes | Admin contact address |
| **Provider Admin Phone** | Yes | Admin contact phone |

#### "Use General Information" Checkbox

- **Use General Address for Provider Admin**: Copies headquarters address
- **Use General Phone for Provider Admin**: Copies general phone

### Step 5: Review and Submit

1. Review all entered information
2. Click **Submit** to start the workflow
3. You will be redirected to the **Workflow Status** page

---

## Workflow Execution

### What Happens After Submission

When you submit the form, the following sequence occurs:

1. **Frontend Validation**: Form data validated locally
2. **Backend API Call**: Data sent to `POST /api/v1/workflows/organization-bootstrap`
3. **Event Emission**: `organization.bootstrap.initiated` event recorded
4. **Temporal Workflow Started**: Workflow ID returned immediately

### Workflow Activities (12 Total)

The workflow executes these activities in sequence:

| # | Activity | Description | Events Emitted |
|---|----------|-------------|----------------|
| 1 | `createOrganization` | Creates organization record | `organization.created` |
| 2 | `createContacts` | Creates contact records | `contact.created` (per contact) |
| 3 | `createAddresses` | Creates address records | `address.created` (per address) |
| 4 | `createPhones` | Creates phone records | `phone.created` (per phone) |
| 5 | `configureDNS` | Creates Cloudflare CNAME record | `organization.dns_configured` |
| 6 | `generateAndSendInvitations` | Emails invitation to provider admin | `user.invited` |

If any activity fails, compensation activities run in reverse order to clean up partial state.

### Workflow Status States

| Status | Description |
|--------|-------------|
| `initiated` | Workflow started, not yet processing |
| `running` | Activities executing |
| `completed` | All activities successful |
| `failed` | Error occurred (check logs) |
| `compensating` | Rollback in progress |
| `compensated` | Rollback complete |

### Expected Duration

- **Typical**: 10-30 seconds
- **DNS Propagation**: May take additional time to resolve

---

## Form Data Structure

### Workflow Parameters

When submitted, form data transforms to this structure:

```typescript
interface OrganizationBootstrapParams {
  subdomain: string;
  orgData: {
    name: string;
    type: 'provider' | 'partner';
    contacts: ContactInfo[];    // Billing + Provider Admin contacts
    addresses: AddressInfo[];   // General + Billing + Provider Admin
    phones: PhoneInfo[];        // General + Billing + Provider Admin
    partnerType?: 'var' | 'family' | 'court' | 'other';
    referringPartnerId?: string;
  };
  users: OrganizationUser[];    // Provider Admin for invitation
}
```

### Contact Types

| Type | Label | Description |
|------|-------|-------------|
| `headquarters` | Headquarters | Primary organization contact |
| `billing` | Billing Contact | Accounts payable contact |
| `admin` | Provider Admin | Initial administrator |
| `emergency` | Emergency | Emergency contact |
| `other` | (Custom) | User-defined type |

### Address Types

| Type | Label | Description |
|------|-------|-------------|
| `physical` | Physical Address | Business location |
| `billing` | Billing Address | Invoice address |
| `mailing` | Mailing Address | Correspondence address |
| `other` | (Custom) | User-defined type |

### Phone Types

| Type | Label | Description |
|------|-------|-------------|
| `office` | Office | Main business line |
| `mobile` | Mobile | Cell phone |
| `fax` | Fax | Fax number |
| `emergency` | Emergency | Emergency contact |
| `other` | (Custom) | User-defined type |

---

## Troubleshooting

### Common Issues

#### 1. "Authentication required to start workflow"

**Cause**: Session expired or user not logged in.

**Solution**:
- Refresh the page and log in again
- Ensure cookies are enabled
- Check that the JWT token has not expired

#### 2. "Backend API not available in current mode"

**Cause**: Running in mock mode without Backend API access.

**Solution**:
- For local development: Use `npm run dev:integration` mode
- For production: Verify `VITE_BACKEND_API_URL` is set correctly
- Ensure network access to `api-a4c.firstovertheline.com`

#### 3. "Failed to start workflow: HTTP 401 Unauthorized"

**Cause**: JWT token rejected by Backend API.

**Solution**:
- Check that the user has `organization.create_root` permission
- Verify JWT custom claims are being set correctly
- Check Backend API logs for detailed error

#### 4. "Failed to start workflow: HTTP 500"

**Cause**: Backend API or Temporal error.

**Solution**:
- Check Backend API logs: `kubectl logs -n temporal -l app=backend-api`
- Check Temporal Web UI for workflow errors
- Verify Temporal worker is running: `kubectl logs -n temporal -l app=workflow-worker`

#### 5. Workflow stuck in "running" state

**Cause**: Activity timeout or Temporal worker issues.

**Solution**:
- Check worker logs for activity errors
- Verify Cloudflare API token is valid (DNS activity)
- Verify Resend API key is valid (email activity)
- Check Temporal Web UI for activity retry attempts

#### 6. DNS not resolving after workflow completion

**Cause**: DNS propagation delay.

**Solution**:
- Wait 5-15 minutes for DNS propagation
- Verify Cloudflare dashboard shows the CNAME record
- Use `dig subdomain.firstovertheline.com` to check DNS status

#### 7. Invitation email not received

**Cause**: Email delivery issues.

**Solution**:
- Check spam/junk folder
- Verify email address is correct
- Check Resend dashboard for delivery status
- Check worker logs for email activity errors

### Checking Workflow Status

#### Via Temporal Web UI

1. Access Temporal Web UI (port-forward if needed)
2. Search for workflow ID: `org-bootstrap-{subdomain}-{timestamp}`
3. View workflow history for activity details

#### Via Database Events

```sql
-- Check domain events for an organization
SELECT
  event_type,
  aggregate_id,
  created_at,
  event_data
FROM domain_events
WHERE event_data->>'subdomain' = 'your-subdomain'
ORDER BY created_at DESC;
```

#### Via Application Logs

```bash
# Backend API logs
kubectl logs -n temporal -l app=backend-api --tail=100

# Workflow worker logs
kubectl logs -n temporal -l app=workflow-worker --tail=100
```

---

## Related Documentation

- [Organization Bootstrap Workflow Design](../architecture/organization-bootstrap-workflow-design.md) - Detailed workflow specification
- [Organization Onboarding Workflow](../../architecture/workflows/organization-onboarding-workflow.md) - Architecture overview
- [Temporal Overview](../../architecture/workflows/temporal-overview.md) - Workflow orchestration architecture
- [Organization Management Architecture](../../architecture/data/organization-management-architecture.md) - Data model
- [Error Handling and Compensation](./error-handling-and-compensation.md) - Saga pattern details

---

## Quick Reference

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/workflows/organization-bootstrap` | POST | Start bootstrap workflow |

### Required Permissions

| Permission | Description |
|------------|-------------|
| `organization.create_root` | Create root-level organizations |

### Environment Variables (Frontend)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_BACKEND_API_URL` | Yes (prod) | Backend API base URL |
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |

### Environment Variables (Backend API)

| Variable | Required | Description |
|----------|----------|-------------|
| `TEMPORAL_ADDRESS` | Yes | Temporal frontend address |
| `TEMPORAL_NAMESPACE` | Yes | Temporal namespace |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
