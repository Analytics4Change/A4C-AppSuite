---
status: current
last_updated: 2026-02-07
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Complete reference for all Temporal activities. Categories: Organization (create, emitBootstrapCompleted), DNS (configure via Cloudflare, verify with quorum-based multi-server lookup), Invitations (generate tokens, send via Resend), RBAC (grantProviderAdminPermissions from templates), Event Emission (emitBootstrapCompleted, emitBootstrapFailed), Compensation (removeDNS, deactivate). All activities emit domain events with workflow context. Key pattern: check-then-act for idempotency.

**When to read**:
- Understanding activity signatures and parameters
- Implementing new activities following patterns
- Debugging activity failures
- Understanding event data schemas per activity

**Prerequisites**: [temporal-overview](../../architecture/workflows/temporal-overview.md), [error-handling-and-compensation](../guides/error-handling-and-compensation.md)

**Key topics**: `activities-reference`, `createOrganization`, `configureDNS`, `verifyDNS`, `grantProviderAdminPermissions`, `compensation-activities`

**Estimated read time**: 25 minutes
<!-- TL;DR-END -->

# Temporal Activities Reference

**Status**: ✅ Complete reference for all activities
**Purpose**: Catalog of all Temporal activities with signatures and behavior
**Pattern**: Event-driven activities (all state changes emit domain events)

---

## Table of Contents

1. [Overview](#overview)
2. [Activity Categories](#activity-categories)
3. [Organization Activities](#organization-activities)
4. [DNS Activities](#dns-activities)
5. [User Invitation Activities](#user-invitation-activities)
6. [RBAC Activities](#rbac-activities)
7. [Compensation Activities](#compensation-activities)
8. [Activity Design Patterns](#activity-design-patterns)

---

## Overview

Activities in Temporal perform side effects: API calls, database operations, external service integrations. In A4C Platform, **all activities that change state emit domain events** to maintain the event-driven architecture.

**Key Principles**:
- ✅ **Idempotent**: Activities can be retried safely without side effects
- ✅ **Event-driven**: All state changes emit immutable domain events
- ✅ **Metadata**: Events include workflow context for traceability
- ✅ **Error handling**: Activities throw descriptive errors for Temporal to retry
- ✅ **Logging**: Activities log execution for observability

---

## Activity Categories

| Category | Purpose | Activities |
|----------|---------|------------|
| **Organization** | Organization lifecycle | `createOrganizationActivity` |
| **DNS** | Subdomain provisioning | `configureDNSActivity`, `verifyDNSActivity` |
| **Invitations** | User invitations | `generateInvitationsActivity`, `sendInvitationEmailsActivity` |
| **RBAC** | Role & permission provisioning | `grantProviderAdminPermissions` |
| **Event Emission** | Lifecycle events | `emitBootstrapCompletedActivity`, `emitBootstrapFailedActivity` |
| **Compensation** | Rollback on failures | `removeDNSActivity`, `deactivateOrganizationActivity` |

---

## Organization Activities

### `createOrganizationActivity`

Creates a new organization record by emitting an `OrganizationCreated` event.

**Signature**:
```typescript
export async function createOrganizationActivity(
  params: CreateOrganizationParams
): Promise<string>
```

**Parameters**:
```typescript
interface CreateOrganizationParams {
  name: string                // Organization display name
  type: 'provider' | 'partner'  // Organization type
  parentOrgId?: string        // Parent org UUID (required for partners)
  contactEmail: string        // Primary contact email
  subdomain: string           // URL subdomain (e.g., "acme-healthcare")
}
```

**Returns**: `string` - Organization UUID

**Events Emitted**:
- `OrganizationCreated` → Creates record in `organizations_projection`

**Event Data**:
```typescript
{
  event_type: 'OrganizationCreated',
  aggregate_type: 'Organization',
  aggregate_id: orgId,
  event_data: {
    org_id: string
    name: string
    type: 'provider' | 'partner'
    parent_org_id: string | null
    contact_email: string
    domain: string  // e.g., "acme-healthcare.firstovertheline.com"
    path: string    // ltree path (e.g., "acme_healthcare" or "parent.child")
    is_active: boolean  // false initially, true after full bootstrap
  },
  metadata: {
    workflow_id: string
    workflow_run_id: string
    workflow_type: string
    activity_id: string
  }
}
```

**Error Conditions**:
- Parent organization not found (for partner type)
- Invalid subdomain format
- Database event insertion failure

**Retry Policy**:
```typescript
{
  initialInterval: '1s',
  backoffCoefficient: 2,
  maximumInterval: '30s',
  maximumAttempts: 3
}
```

**Idempotency**: Safe to retry. If event already exists with same `aggregate_id`, insertion is ignored (ON CONFLICT).

---

### `emitBootstrapCompletedActivity`

Emits an `organization.bootstrap.completed` event when the bootstrap workflow succeeds. The synchronous trigger handler (`handle_bootstrap_completed`) sets `is_active = true` on the `organizations_projection`.

> **Note**: Replaces the old `activateOrganizationActivity` which made direct RPC calls to `update_organization_status` (dual write removed per CQRS audit). The old activity has been deleted.

**Signature**:
```typescript
export async function emitBootstrapCompletedActivity(
  params: EmitBootstrapCompletedParams
): Promise<EmitBootstrapCompletedResult>
```

**Parameters**:
```typescript
interface EmitBootstrapCompletedParams {
  orgId: string;              // Organization UUID
  bootstrapId: string;        // Bootstrap workflow run ID for correlation
  adminRoleAssigned: string;  // Admin role (e.g. 'provider_admin')
  permissionsGranted: number; // Number of permissions granted
  ltreePath?: string;         // Ltree path for org hierarchy
  tracing?: WorkflowTracingParams;
}
```

**Returns**:
```typescript
interface EmitBootstrapCompletedResult {
  eventId: string;  // Event ID of the emitted completion event
}
```

**Events Emitted**:
- `organization.bootstrap.completed` → Handler sets `is_active=true`, records `metadata.bootstrap.completed_at` in `organizations_projection`

**Event Data**:
```typescript
{
  event_type: 'organization.bootstrap.completed',
  aggregate_type: 'organization',
  aggregate_id: orgId,
  event_data: {
    bootstrap_id: string,
    organization_id: string,
    admin_role_assigned: AdminRole,  // 'provider_admin' | 'partner_admin'
    permissions_granted: number,
    ltree_path?: string
  }
}
```

**Error Conditions**:
- Database event insertion failure
- Supabase RPC unavailable

**Retry Policy**: Default (3 attempts, exponential backoff)

**Idempotency**: Safe to retry. Event deduplication via aggregate_id + event_type + created_at constraint.

---

### `emitBootstrapFailedActivity`

Emits an `organization.bootstrap.failed` event when the bootstrap workflow fails. Called from the workflow's catch block BEFORE running compensation activities. The synchronous trigger handler (`handle_bootstrap_failed`) sets `is_active = false`, `deactivated_at`, and `deleted_at`.

**Signature**:
```typescript
export async function emitBootstrapFailedActivity(
  params: EmitBootstrapFailedParams
): Promise<EmitBootstrapFailedResult>
```

**Parameters**:
```typescript
interface EmitBootstrapFailedParams {
  orgId: string;
  bootstrapId: string;
  failureStage: BootstrapFailureStage;
  errorMessage: string;
  partialCleanupRequired: boolean;
  tracing?: WorkflowTracingParams;
}
```

**Returns**:
```typescript
interface EmitBootstrapFailedResult {
  eventId: string;
}
```

**Events Emitted**:
- `organization.bootstrap.failed` → Handler sets `is_active=false`, `deactivated_at`, `deleted_at`, records error in `metadata.bootstrap`

**Retry Policy**: Default (3 attempts)

**Idempotency**: Safe to retry. Event deduplication prevents duplicates.

---

## DNS Activities

### `configureDNSActivity`

Provisions a DNS subdomain via Cloudflare API and emits a `DNSConfigured` event.

**Signature**:
```typescript
export async function configureDNSActivity(
  params: ConfigureDNSParams
): Promise<ConfigureDNSResult>
```

**Parameters**:
```typescript
interface ConfigureDNSParams {
  orgId: string         // Organization UUID
  subdomain: string     // Subdomain (e.g., "acme-healthcare")
  targetDomain: string  // Base domain (e.g., "firstovertheline.com")
}
```

**Returns**:
```typescript
interface ConfigureDNSResult {
  fqdn: string      // Full domain (e.g., "acme-healthcare.firstovertheline.com")
  recordId: string  // Cloudflare DNS record ID
}
```

**Events Emitted**:
- `DNSConfigured` → Records DNS configuration for audit

**Event Data**:
```typescript
{
  event_type: 'DNSConfigured',
  aggregate_type: 'Organization',
  aggregate_id: orgId,
  event_data: {
    org_id: string
    subdomain: string
    fqdn: string
    cloudflare_record_id: string
    proxied: boolean  // true if Cloudflare proxied (SSL/CDN)
  },
  metadata: {
    workflow_id: string
    workflow_run_id: string
    workflow_type: string
  }
}
```

**External API**:
- **Cloudflare DNS API**: Creates CNAME record
- **Endpoint**: `POST /zones/{zone_id}/dns_records`

**Error Conditions**:
- Cloudflare API failure (rate limit, auth error)
- Zone not found for target domain
- Subdomain already exists
- Database event insertion failure

**Retry Policy**:
```typescript
{
  initialInterval: '5s',
  backoffCoefficient: 2,
  maximumInterval: '2 minutes',
  maximumAttempts: 5  // More retries for external API calls
}
```

**Idempotency**: **Partially idempotent**. Cloudflare API returns error if record already exists. Activity should check for existing record before creating.

**Recommended Idempotency Check**:
```typescript
// Check if DNS record already exists
const existingRecords = await cloudflare.dns.records.list(zoneId, {
  name: `${subdomain}.${targetDomain}`
})

if (existingRecords.result && existingRecords.result.length > 0) {
  console.log('[ACTIVITY] DNS record already exists, skipping creation')
  return {
    fqdn: `${subdomain}.${targetDomain}`,
    recordId: existingRecords.result[0].id
  }
}
```

---

### `verifyDNSActivity`

Verifies DNS record propagation using quorum-based multi-server lookup. Queries multiple public DNS servers in parallel and requires a quorum to confirm propagation.

**Why Quorum-Based Verification**:
- **Cloudflare Proxy**: When Cloudflare proxy is enabled (orange cloud), DNS queries return **A records** (Cloudflare IPs), not CNAME records. Using `dns.resolveCname()` would fail with `ENODATA`.
- **Redundancy**: Single DNS server might be temporarily unreachable
- **Global Confirmation**: Different providers = different network paths
- **Prevents False Negatives**: One slow server won't block verification

**Signature**:
```typescript
export async function verifyDNSActivity(
  params: VerifyDNSParams
): Promise<boolean>
```

**Parameters**:
```typescript
interface VerifyDNSParams {
  orgId: string   // Organization UUID (for event emission)
  domain: string  // FQDN to verify (e.g., "acme-healthcare.firstovertheline.com")
}
```

**Returns**: `boolean` - `true` if DNS verified (quorum reached)

**DNS Servers Queried** (parallel execution):
| Server | IP | Provider |
|--------|-----|----------|
| Google DNS | `8.8.8.8` | Google (most widely used globally) |
| Cloudflare DNS | `1.1.1.1` | Cloudflare (fast, privacy-focused) |
| OpenDNS | `208.67.222.222` | Cisco (enterprise-grade) |

**Quorum Configuration**:
- **Total servers**: 3
- **Required for success**: 2 (quorum)
- **Timeout per server**: 5000ms
- **Resolution method**: `resolver.resolve4()` (A records, not CNAME)

**Events Emitted**:
- `organization.subdomain.verified` → Updates `subdomain_status='verified'` in `organizations_projection`

**Event Data**:
```typescript
{
  event_type: 'organization.subdomain.verified',
  aggregate_type: 'Organization',
  aggregate_id: orgId,
  event_data: {
    domain: string,              // FQDN verified
    verified: true,
    verified_at: string,         // ISO 8601 timestamp
    verification_method: 'dns_quorum' | 'development',
    quorum: string,              // e.g., "3/3" or "2/3"
    dns_results: Array<{         // Individual server results
      server: string,            // "Google", "Cloudflare", "OpenDNS"
      success: boolean,
      ips?: string[]             // Resolved IP addresses
    }>,
    resolved_ips: string[]       // IPs from first successful result
  },
  metadata: {
    workflow_id: string,
    workflow_run_id: string,
    workflow_type: string
  }
}
```

**Development/Mock Mode**:
- In `development` or `mock` workflow mode, DNS verification is skipped
- Event emitted with `verification_method: 'development'`
- Always returns `true` (no network calls)

**External Dependency**:
- **DNS Resolution**: Uses Node.js `Resolver` class with `setServers()` for isolated queries
- Each server queried via separate `Resolver` instance (avoids affecting other queries)

**Error Conditions**:
- **Quorum not reached**: Less than 2 servers confirmed A records
- **DNS timeout**: Individual server timeout (5s) doesn't fail activity, just reduces quorum count
- **DNS not propagated**: Returns NXDOMAIN (normal during propagation, workflow retries)

**Error Message Example**:
```
DNS verification failed: only 1/3 servers confirmed. Required quorum: 2.
Domain may not be fully propagated. This is normal during DNS propagation (60-300 seconds).
Workflow will retry automatically.
```

**Retry Policy**:
- **Called by workflow** with custom retry logic
- Workflow retries with exponential backoff
- DNS propagation typically takes 60-300 seconds
- Activity throws error if quorum not reached (workflow retries)

**Idempotency**: Fully idempotent. Read-only DNS queries, event emission is idempotent via `ON CONFLICT`.

---

## User Invitation Activities

### `generateInvitationsActivity`

Generates secure invitation tokens and emits `UserInvited` events.

**Signature**:
```typescript
export async function generateInvitationsActivity(
  params: GenerateInvitationsParams
): Promise<Invitation[]>
```

**Parameters**:
```typescript
interface GenerateInvitationsParams {
  orgId: string
  users: Array<{
    email: string
    firstName: string
    lastName: string
    role: string  // e.g., "provider_admin", "organization_member"
  }>
}
```

**Returns**:
```typescript
interface Invitation {
  invitationId: string  // UUID
  email: string
  token: string         // URL-safe base64 token
  expiresAt: Date       // 7 days from creation
}
```

**Events Emitted**:
- `UserInvited` (one per user) → Creates record in `user_invitations_projection`

**Event Data**:
```typescript
{
  event_type: 'UserInvited',
  aggregate_type: 'User',
  aggregate_id: invitationId,
  event_data: {
    invitation_id: string
    org_id: string
    email: string
    first_name: string
    last_name: string
    role: string
    token: string
    expires_at: string  // ISO 8601
    status: 'pending'
  },
  metadata: {
    workflow_id: string
    workflow_run_id: string
    workflow_type: string
  }
}
```

**Token Generation**:
```typescript
import { randomBytes } from 'crypto'

const token = randomBytes(32).toString('base64url')  // URL-safe, 43 chars
```

**Error Conditions**:
- Database event insertion failure
- Token generation failure (entropy source unavailable)

**Retry Policy**: Default (3 attempts)

**Idempotency**: **Not fully idempotent**. Each retry generates new tokens. To make idempotent, use deterministic token generation based on `invitationId` (e.g., HMAC).

**Recommended Idempotent Token Generation**:
```typescript
import { createHmac } from 'crypto'

const secret = process.env.INVITATION_SECRET!
const token = createHmac('sha256', secret)
  .update(invitationId)
  .digest('base64url')
```

---

### `sendInvitationEmailsActivity`

Sends invitation emails via Resend email service and emits success/failure events.

**Email Service**: Resend (https://resend.com) - Modern transactional email API
- ✅ Excellent deliverability
- ✅ Simple API (no SMTP configuration)
- ✅ Free tier: 100 emails/day
- ✅ Production: $20/month for 50,000 emails
- ✅ Environment variable: `RESEND_API_KEY`

**Signature**:
```typescript
export async function sendInvitationEmailsActivity(
  params: SendInvitationEmailsParams
): Promise<SendInvitationEmailsResult>
```

**Parameters**:
```typescript
interface SendInvitationEmailsParams {
  orgId: string
  invitations: Invitation[]
  domain: string  // FQDN for invitation link
}
```

**Returns**:
```typescript
interface SendInvitationEmailsResult {
  successCount: number
  failures: Array<{
    email: string
    error: string
  }>
}
```

**Events Emitted**:
- `InvitationEmailSent` (per success) → Audit trail
- `InvitationEmailFailed` (per failure) → Alert support team

**Event Data**:
```typescript
// Success
{
  event_type: 'InvitationEmailSent',
  aggregate_type: 'User',
  aggregate_id: invitationId,
  event_data: {
    invitation_id: string
    email: string
    sent_at: string  // ISO 8601
  }
}

// Failure
{
  event_type: 'InvitationEmailFailed',
  aggregate_type: 'User',
  aggregate_id: invitationId,
  event_data: {
    invitation_id: string
    email: string
    error: string
  }
}
```

**External Service**:
- **Email Provider**: Resend API (recommended, requires `RESEND_API_KEY`) or SMTP (nodemailer, requires `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`)

**Error Handling**:
- **Per-email failure**: Activity continues, logs failure, returns partial success
- **Complete failure**: Activity throws error for Temporal retry

**Retry Policy**: Default (3 attempts for complete activity failure)

**Idempotency**: **Partially idempotent**. Email provider should deduplicate (if supported). Consider adding `idempotency_key` to email metadata.

---

## RBAC Activities

### `grantProviderAdminPermissions`

Creates a `provider_admin` role for an organization and grants all template-defined permissions. This activity is called during organization bootstrap to ensure the initial admin user has the correct role and permissions.

**Signature**:
```typescript
export async function grantProviderAdminPermissions(
  params: GrantProviderAdminPermissionsParams
): Promise<GrantProviderAdminPermissionsResult>
```

**Parameters**:
```typescript
interface GrantProviderAdminPermissionsParams {
  orgId: string      // Organization UUID
  scopePath: string  // Scope path for the role (e.g., subdomain like 'acme-health')
}
```

**Returns**:
```typescript
interface GrantProviderAdminPermissionsResult {
  roleId: string              // Role UUID (new or existing)
  permissionsGranted: number  // Count of permissions granted (0 if all already existed)
  roleAlreadyExisted: boolean // Whether role already existed
}
```

**Permission Source**: Database-driven via `role_permission_templates` table

The activity queries the `role_permission_templates` table for active templates matching the role type. This enables platform owners to manage permission templates without code changes:

```typescript
// Query template permissions from database
const { data } = await supabase
  .from('role_permission_templates')
  .select('permission_name')
  .eq('role_name', 'provider_admin')
  .eq('is_active', true);
```

**Fallback Behavior**: If no templates are found in the database (e.g., during bootstrap before seeds run), the activity falls back to a hardcoded `PROVIDER_ADMIN_PERMISSIONS` constant with 16 canonical permissions.

**Events Emitted**:
- `role.created` → Creates record in `roles_projection` (if role doesn't exist)
- `role.permission.granted` → Creates records in `role_permissions_projection` (for each missing permission)

**Event Data (role.created)**:
```typescript
{
  event_type: 'role.created',
  aggregate_type: 'role',
  aggregate_id: roleId,
  event_data: {
    name: 'provider_admin',
    display_name: 'Provider Administrator',
    description: 'Organization owner with full control within the organization',
    organization_id: string,       // ✅ Required for non-super_admin roles
    org_hierarchy_scope: string,   // ✅ LTREE path (e.g., 'acme_health')
    scope: 'organization',
    is_system_role: true
  },
  metadata: {
    workflow_id: string,
    workflow_run_id: string,
    workflow_type: string
  }
}
```

**Event Data (role.permission.granted)**:
```typescript
{
  event_type: 'role.permission.granted',
  aggregate_type: 'role',
  aggregate_id: roleId,
  event_data: {
    permission_id: string,   // UUID from permissions_projection
    permission_name: string  // e.g., 'organization.view_ou'
  },
  metadata: { ... }
}
```

**Role Scoping Architecture**:
- `super_admin`: Global scope (organization_id = NULL)
- `provider_admin`, `partner_admin`, etc.: Per-organization scope (organization_id = org UUID)

Only `super_admin` is seeded as a global role. All other roles are created per-organization during bootstrap with proper `organization_id` and `org_hierarchy_scope` set.

**Error Conditions**:
- Failed to fetch permission templates from database
- Failed to query existing role
- Failed to query existing permissions
- Permission not found in `permissions_projection`
- Database event insertion failure

**Retry Policy**: Default (3 attempts, exponential backoff)

**Idempotency**: Fully idempotent via three-layer check:
1. Checks if `provider_admin` role already exists for the organization
2. Checks which permissions are already granted
3. Only emits events for missing role/permissions

**Related Files**:
- **Activity**: `workflows/src/activities/organization-bootstrap/grant-provider-admin-permissions.ts`
- **Templates Table**: `infrastructure/supabase/sql/02-tables/rbac/006-role_permission_templates.sql`
- **Template Seeds**: `infrastructure/supabase/sql/99-seeds/012-role-permission-templates.sql`

**Related Documentation**:
- [Permissions Reference](../../../architecture/authorization/permissions-reference.md)
- [Provider Admin Permissions Architecture](../../../architecture/authorization/provider-admin-permissions-architecture.md)
- [role_permission_templates Table Reference](../../../infrastructure/reference/database/tables/role_permission_templates.md)

---

## Compensation Activities

Compensation activities rollback state changes when workflows fail.

### `removeDNSActivity`

Removes DNS record from Cloudflare and emits `DNSRemoved` event.

**Signature**:
```typescript
export async function removeDNSActivity(
  params: RemoveDNSParams
): Promise<void>
```

**Parameters**:
```typescript
interface RemoveDNSParams {
  subdomain: string  // Subdomain to remove
}
```

**Returns**: `void`

**Events Emitted**:
- `DNSRemoved` → Audit trail for compensation

**Event Data**:
```typescript
{
  event_type: 'DNSRemoved',
  aggregate_type: 'Organization',
  aggregate_id: subdomain,
  event_data: {
    subdomain: string
    reason: 'compensation'  // Always 'compensation' for rollback
  },
  metadata: {
    workflow_id: string
    workflow_run_id: string
  }
}
```

**External API**:
- **Cloudflare DNS API**: Deletes DNS record
- **Endpoint**: `DELETE /zones/{zone_id}/dns_records/{record_id}`

**Error Conditions**:
- DNS record not found (idempotent - OK)
- Cloudflare API failure

**Retry Policy**: Default (3 attempts)

**Idempotency**: Fully idempotent. If record doesn't exist, no-op.

---

### `deactivateOrganizationActivity`

Safety net fallback that directly updates `organizations_projection` when event emission has failed. Does NOT emit events (the event path already failed if this runs). Intentional CQRS exception.

> **Note**: This activity is a **safety net only** in the bootstrap workflow's Saga compensation. When `emitBootstrapFailedActivity` succeeds, the `handle_bootstrap_failed` handler already sets `is_active = false`. `deactivateOrganization` only fires as a fallback when event emission itself has failed — it direct-writes `is_active = false` to the projection.

**Signature**:
```typescript
export async function deactivateOrganizationActivity(
  params: DeactivateOrganizationParams
): Promise<void>
```

**Parameters**:
```typescript
interface DeactivateOrganizationParams {
  orgId: string
}
```

**Returns**: `void`

**Events Emitted**:
- `organization.deactivated` → Handler sets `is_active=false`, `deactivated_at`, `deleted_at` in projection

**Error Conditions**:
- Organization not found
- Database event insertion failure

**Retry Policy**: Default (3 attempts)

**Idempotency**: Fully idempotent. Deactivation is idempotent state transition.

---

## Activity Design Patterns

### Pattern 1: Event-Driven State Changes

All activities that mutate state must emit domain events:

```typescript
export async function myStateChangingActivity(params) {
  // Perform side effect
  const result = await externalAPI.doSomething(params)

  // Emit domain event
  await supabase.from('domain_events').insert({
    event_type: 'SomethingHappened',
    aggregate_type: 'MyAggregate',
    aggregate_id: result.id,
    event_data: { ...result },
    metadata: {
      workflow_id: Context.current().info.workflowId,
      workflow_run_id: Context.current().info.runId,
      workflow_type: Context.current().info.workflowType
    }
  })

  return result
}
```

### Pattern 2: Idempotency Checks

For non-idempotent external APIs, check if operation already completed:

```typescript
export async function createExternalResourceActivity(params) {
  // Check if resource already exists
  const existing = await externalAPI.find(params.uniqueKey)
  if (existing) {
    console.log('[ACTIVITY] Resource already exists, returning existing')
    return existing.id
  }

  // Create new resource
  const resource = await externalAPI.create(params)

  // Emit event
  await emitEvent('ResourceCreated', resource)

  return resource.id
}
```

### Pattern 3: Error Handling with Context

Provide detailed error context for debugging:

```typescript
export async function myActivity(params) {
  try {
    return await riskyOperation(params)
  } catch (error) {
    // Enrich error with context
    const contextError = new Error(
      `Failed to perform operation for org ${params.orgId}: ${error.message}`
    )
    contextError.cause = error
    throw contextError
  }
}
```

### Pattern 4: Partial Success Handling

For batch operations, return partial results instead of failing completely:

```typescript
export async function sendBatchEmailsActivity(params) {
  const results = {
    successCount: 0,
    failures: []
  }

  for (const email of params.emails) {
    try {
      await sendEmail(email)
      results.successCount++
    } catch (error) {
      results.failures.push({
        email: email.to,
        error: error.message
      })
    }
  }

  // Only throw if ALL failed
  if (results.successCount === 0) {
    throw new Error('All emails failed to send')
  }

  return results
}
```

### Pattern 5: Activity Cancellation

Activities should respect cancellation signals:

```typescript
import { CancellationScope } from '@temporalio/activity'

export async function longRunningActivity(params) {
  const scope = CancellationScope.current()

  for (let i = 0; i < 1000; i++) {
    if (scope.consideredCancelled) {
      console.log('[ACTIVITY] Cancellation detected, cleaning up...')
      await cleanup()
      throw new Error('Activity cancelled')
    }

    await processItem(i)
  }
}
```

---

## Activity Testing

### Unit Test Template

```typescript
import { myActivity } from '../my-activity'
import { createClient } from '@supabase/supabase-js'

jest.mock('@supabase/supabase-js')

describe('myActivity', () => {
  let mockSupabase: any

  beforeEach(() => {
    mockSupabase = {
      from: jest.fn().mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: null }),
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: {} })
          })
        })
      })
    }
    ;(createClient as jest.Mock).mockReturnValue(mockSupabase)
  })

  it('should emit event on success', async () => {
    const params = { orgId: 'test-uuid' }
    await myActivity(params)

    expect(mockSupabase.from).toHaveBeenCalledWith('domain_events')
  })

  it('should throw error on database failure', async () => {
    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockResolvedValue({
        error: new Error('DB error')
      })
    })

    await expect(myActivity({ orgId: 'test' }))
      .rejects.toThrow('DB error')
  })
})
```

---

## Activity Monitoring

### Key Metrics

```typescript
const activityMetrics = {
  'activity.executed': counter,
  'activity.failed': counter,
  'activity.duration_seconds': histogram,
  'activity.retry_count': histogram
}
```

### Alerting

```yaml
alerts:
  - name: Activity Failure Rate High
    condition: activity.failed / activity.executed > 0.2
    duration: 5m
    severity: warning

  - name: Activity Duration Excessive
    condition: activity.duration_seconds > 300  # 5 minutes
    severity: warning
```

---

## Related Documentation

- **Temporal Integration Overview**: `overview.md`
- **Organization Onboarding Workflow**: `organization-onboarding-workflow.md`
- **Error Handling**: `error-handling-and-compensation.md`

---

**Document Version**: 1.2
**Last Updated**: 2025-12-20
**Status**: Complete Reference
