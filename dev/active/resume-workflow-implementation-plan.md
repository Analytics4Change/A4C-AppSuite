# Resume Organization Bootstrap Workflow - Implementation Plan

**Created**: 2025-11-22
**Status**: PLANNING
**Purpose**: Design and implement a resume workflow that can recover from any organization bootstrap workflow failure after Saga compensation has run

---

## 1. Overview & Context

### Problem Statement

When the `organizationBootstrapWorkflow` fails at any point, the Saga compensation pattern runs and soft-deletes all created resources:

- Organization marked as `is_active: false`, `deleted_at: timestamp`
- Contacts, addresses, phones soft-deleted
- DNS records removed (if created)
- Invitations revoked (if created)

**Current behavior when user wants to retry:**

❌ **Re-entering data via UI** → New workflow finds existing soft-deleted org → Returns org_id early → Contacts/addresses/phones NOT recreated → Organization activated but EMPTY

❌ **Starting new workflow manually** → Same broken behavior

✅ **Manual cleanup + retry** → Works but loses audit trail, requires SQL access

### Solution: Resume Workflow

Create a dedicated `organizationBootstrapResumeWorkflow` that:

1. **Detects the current state** of a failed organization
2. **Reactivates soft-deleted resources** where appropriate
3. **Recreates missing resources** (contacts, addresses, phones)
4. **Resumes from the point of failure** (e.g., DNS configuration)
5. **Completes the bootstrap process** (invitations, activation)
6. **Preserves complete audit trail** of both original and resume attempts

### Success Criteria

- ✅ Can resume from any activity failure point
- ✅ Handles all edge cases (partial completion, multiple failures)
- ✅ Idempotent (can retry resume workflow if it fails)
- ✅ Preserves complete event history in `domain_events`
- ✅ No manual SQL intervention required
- ✅ Safe for production use with concurrent workflows

---

## 2. State Detection & Recovery Points

### Workflow State Machine

Each activity in the bootstrap workflow represents a state. The resume workflow must detect which state the organization is in:

| State | Activity Completed | Resources Created | Can Resume? | Resume Actions |
|-------|-------------------|-------------------|-------------|----------------|
| **S0: Not Started** | None | None | ❌ No | Use original workflow |
| **S1: Org Created** | `createOrganization` | Org + contacts/addresses/phones | ✅ Yes | Recreate children, resume from DNS |
| **S1-Compensated** | Org compensated | Soft-deleted org | ✅ Yes | Reactivate, recreate children, resume from DNS |
| **S2: DNS Configured** | `configureDNS` | DNS record created | ✅ Yes | Resume from DNS verify |
| **S2-Failed** | DNS failed | No DNS record | ✅ Yes | Resume from DNS config |
| **S3: Invitations Generated** | `generateInvitations` | Invitation records | ✅ Yes | Resume from email sending |
| **S4: Emails Sent** | `sendInvitationEmails` | Emails sent | ✅ Yes | Resume from activation |
| **S5: Completed** | All | Fully activated org | ❌ No | Already complete |

### State Detection Logic

```typescript
interface OrgBootstrapState {
  orgExists: boolean;
  orgDeleted: boolean;
  contactsExist: boolean;
  addressesExist: boolean;
  phonesExist: boolean;
  dnsConfigured: boolean;
  invitationsGenerated: boolean;
  emailsSent: boolean;
  orgActive: boolean;
}

async function detectOrgState(orgId: string): Promise<OrgBootstrapState> {
  // Query database projections and domain events to determine state
  const org = await getOrgStatus(orgId);
  const contacts = await getContactsByOrg(orgId);
  const addresses = await getAddressesByOrg(orgId);
  const phones = await getPhonesByOrg(orgId);
  const invitations = await getInvitationsByOrg(orgId);
  const events = await getEventsByAggregateId(orgId);

  return {
    orgExists: !!org,
    orgDeleted: !!org?.deleted_at,
    contactsExist: contacts.length > 0,
    addressesExist: addresses.length > 0,
    phonesExist: phones.length > 0,
    dnsConfigured: events.some(e => e.event_type === 'organization.dns.configured'),
    invitationsGenerated: invitations.length > 0,
    emailsSent: invitations.some(i => i.email_sent),
    orgActive: org?.is_active === true
  };
}
```

### Resumable vs Non-Resumable States

**Resumable States** (can use resume workflow):
- Organization exists but soft-deleted
- Organization exists but missing child resources
- DNS failed to configure
- Invitations not sent or partially sent

**Non-Resumable States** (must use original workflow):
- No organization record exists
- Organization fully active and complete
- Data corruption detected (inconsistent state)

---

## 3. Idempotency Considerations

### Activity-Level Idempotency Patterns

Each activity in the resume workflow must handle idempotency differently than the original workflow:

#### Original Workflow Pattern
```typescript
// Original: Check-then-act (prevent duplicates)
async function createOrganization(params) {
  const existing = await checkOrgBySlug(params.slug);
  if (existing) return existing.id;  // Early return

  // Create new
  const org = await insertOrg(params);
  return org.id;
}
```

#### Resume Workflow Pattern
```typescript
// Resume: Check-then-resurrect-or-create
async function createOrganizationResume(params) {
  const existing = await checkOrgBySlug(params.slug);

  if (existing) {
    const status = await getOrgStatus(existing.id);

    if (status.deleted_at) {
      // Resurrect soft-deleted org
      await reactivateOrg(existing.id);

      // Recreate missing children
      await ensureContactsExist(existing.id, params.contacts);
      await ensureAddressesExist(existing.id, params.addresses);
      await ensurePhonesExist(existing.id, params.phones);

      return existing.id;
    }

    // Already active - verify completeness
    await ensureContactsExist(existing.id, params.contacts);
    return existing.id;
  }

  // Create new (shouldn't happen in resume, but handle it)
  const org = await insertOrg(params);
  return org.id;
}
```

### Handling Soft-Deleted Resources

**Question**: When resuming, should we:
- A. Reactivate existing soft-deleted resources?
- B. Hard delete and recreate resources?

**Decision**: **Reactivate existing resources** (Option A)

**Rationale**:
- Preserves audit trail (all events stay in `domain_events`)
- Maintains referential integrity (UUIDs don't change)
- Simpler logic (no cascade deletion)
- Aligns with event sourcing principles (append-only)

**Implementation**:
```typescript
async function ensureContactsExist(orgId: string, expectedContacts: Contact[]) {
  const existing = await getContactsByOrg(orgId, { includeDeleted: true });

  for (const expectedContact of expectedContacts) {
    const found = existing.find(c => c.email === expectedContact.email);

    if (found && found.deleted_at) {
      // Reactivate soft-deleted contact
      await emitEvent({
        event_type: 'contact.reactivated',
        aggregate_id: found.id,
        event_data: { org_id: orgId, email: found.email }
      });
    } else if (!found) {
      // Create new contact
      await emitEvent({
        event_type: 'contact.created',
        aggregate_id: uuid(),
        event_data: { org_id: orgId, ...expectedContact }
      });
    }
    // else: Contact exists and active - no action needed
  }
}
```

### Event Deduplication Strategy

**Challenge**: Resume workflow may emit events for actions that already have events from the original workflow.

**Example**:
- Original workflow: Emits `organization.created` → Fails at DNS → Emits `organization.deactivated`
- Resume workflow: Emits `organization.reactivated` → Completes → Emits `organization.activated`

**Strategy**: Use distinct event types for resume operations

| Original Event | Resume Event | Trigger Action |
|---------------|--------------|----------------|
| `organization.created` | `organization.reactivated` | Update `deleted_at: null` |
| `contact.created` | `contact.reactivated` | Update `deleted_at: null` |
| `organization.activated` | `organization.activated` | Idempotent (checks if already active) |

---

## 4. Data Requirements

### Resume Workflow Input Parameters

```typescript
interface OrganizationBootstrapResumeParams {
  // REQUIRED: Identify the failed organization
  orgId: string;  // UUID of the soft-deleted organization

  // REQUIRED: Original workflow parameters (for recreation)
  originalParams: OrganizationBootstrapParams;

  // OPTIONAL: Resume configuration
  resumeFrom?: 'auto' | 'dns' | 'invitations' | 'activation';  // Default: 'auto' (detect state)
  skipDNS?: boolean;  // If DNS is permanently unavailable, skip it
  forceRecreateContacts?: boolean;  // Force recreation instead of reactivation

  // OPTIONAL: Metadata
  resumeReason?: string;  // Why are we resuming? (for audit trail)
  originalWorkflowId?: string;  // Link to failed workflow
}
```

### State Persistence Strategy

**Where to store resume state?**

**Option 1: Query from database** (Recommended)
- Pros: Always up-to-date, no separate storage needed
- Cons: Requires queries to multiple tables

**Option 2: Store in workflow memo**
- Pros: Fast access, no database queries
- Cons: Stale data if manual changes made, limited size

**Decision**: **Query from database** (Option 1)

**Rationale**:
- Resume may happen hours/days after failure (state could change)
- Database is source of truth for current state
- Workflow determinism not affected (queries are in activities)

### Original Workflow Parameter Recovery

**Challenge**: How to get the original workflow parameters?

**Options**:

**A. User re-enters data** (Simple but poor UX)
```typescript
// User must provide all original data
POST /api/admin/resume-org-bootstrap
{
  "orgId": "...",
  "name": "Test Healthcare Provider",  // Must re-enter
  "contacts": [/* must re-enter all */],
  // ... all original params
}
```

**B. Store in organization metadata** (Better UX)
```sql
-- Add to organizations_projection table
ALTER TABLE organizations_projection
ADD COLUMN bootstrap_params JSONB;

-- Store during original workflow
UPDATE organizations_projection
SET bootstrap_params = '{
  "name": "Test Healthcare Provider",
  "contacts": [...],
  "addresses": [...],
  "phones": [...],
  "users": [...]
}'
WHERE id = orgId;
```

**C. Query from Temporal workflow history** (Best UX, more complex)
```typescript
// Retrieve original workflow parameters from Temporal
const originalWorkflow = await client.workflow.getHandle(originalWorkflowId);
const history = await originalWorkflow.fetchHistory();
const startEvent = history.events.find(e => e.eventType === 'WorkflowExecutionStarted');
const originalParams = startEvent.workflowExecutionStartedEventAttributes.input;
```

**Decision**: **Option B** (Store in organization metadata)

**Rationale**:
- Simpler than querying Temporal API
- Faster than re-entering data
- Always available even if Temporal history is archived
- Useful for other features (audit, display original request)

**Implementation**:
```typescript
// In createOrganization activity
const { data: org } = await supabase
  .from('organizations_projection')
  .insert({
    name: params.name,
    slug: params.slug,
    bootstrap_params: {
      name: params.name,
      type: params.type,
      contacts: params.contacts,
      addresses: params.addresses,
      phones: params.phones,
      users: params.users,
      subdomain: params.subdomain
    }
  });
```

---

## 5. Resume Workflow Design

### Workflow Interface

```typescript
/**
 * OrganizationBootstrapResumeWorkflow
 *
 * Resumes a failed organization bootstrap workflow after Saga compensation has run.
 *
 * Flow:
 * 1. Detect current state of organization (soft-deleted, missing resources, etc.)
 * 2. Validate that resume is possible (not already complete, not corrupt)
 * 3. Reactivate organization and recreate missing resources
 * 4. Resume from the appropriate step (DNS, invitations, or activation)
 * 5. Complete the bootstrap process
 *
 * Idempotency:
 * - Can be retried if resume fails
 * - Activities check state before acting
 * - Events use distinct types for resume operations (e.g., 'organization.reactivated')
 *
 * Compensation:
 * - If resume fails, runs same Saga compensation as original workflow
 * - Organization returns to soft-deleted state
 */
export async function organizationBootstrapResumeWorkflow(
  params: OrganizationBootstrapResumeParams
): Promise<OrganizationBootstrapResult>;
```

### Activity Sequence

```typescript
export async function organizationBootstrapResumeWorkflow(
  params: OrganizationBootstrapResumeParams
): Promise<OrganizationBootstrapResult> {

  log.info('Starting OrganizationBootstrapResumeWorkflow', {
    orgId: params.orgId,
    resumeFrom: params.resumeFrom
  });

  const state: WorkflowState = {
    orgId: params.orgId,
    orgReactivated: false,
    dnsConfigured: false,
    invitationsSent: false,
    errors: [],
    compensationErrors: []
  };

  try {
    // ========================================
    // Step 1: Detect State & Validate
    // ========================================
    log.info('Step 1: Detecting organization state');

    const currentState = await detectOrganizationState({ orgId: params.orgId });

    // Validate resume is possible
    if (!currentState.resumable) {
      throw new Error(
        `Organization ${params.orgId} is not in a resumable state: ${currentState.reason}`
      );
    }

    log.info('State detected', { currentState });

    // ========================================
    // Step 2: Reactivate Organization & Resources
    // ========================================
    log.info('Step 2: Reactivating organization and resources');

    await reactivateOrganizationAndResources({
      orgId: params.orgId,
      originalParams: params.originalParams,
      currentState
    });

    state.orgReactivated = true;
    log.info('Organization and resources reactivated');

    // ========================================
    // Step 3: Resume from appropriate point
    // ========================================
    const resumePoint = params.resumeFrom === 'auto'
      ? determineResumePoint(currentState)
      : params.resumeFrom;

    log.info('Resuming from step', { resumePoint });

    // DNS Configuration (if needed)
    if (resumePoint === 'dns' && params.originalParams.subdomain && !params.skipDNS) {
      log.info('Step 3a: Configuring DNS');

      const dnsResult = await configureDNS({
        orgId: params.orgId,
        subdomain: params.originalParams.subdomain,
        targetDomain: 'firstovertheline.com'
      });

      state.dnsConfigured = true;
      state.domain = dnsResult.fqdn;

      await verifyDNS({ orgId: params.orgId, domain: dnsResult.fqdn });

      log.info('DNS configured successfully', { fqdn: dnsResult.fqdn });
    }

    // Invitations (if needed)
    if (['dns', 'invitations'].includes(resumePoint) && params.originalParams.users.length > 0) {
      log.info('Step 3b: Generating invitations');

      state.invitations = await generateInvitations({
        orgId: params.orgId,
        users: params.originalParams.users
      });

      log.info('Step 3c: Sending invitation emails');

      const emailResult = await sendInvitationEmails({
        orgId: params.orgId,
        invitations: state.invitations,
        domain: state.domain || params.originalParams.subdomain || 'a4c.firstovertheline.com',
        frontendUrl: 'https://a4c.firstovertheline.com'
      });

      state.invitationsSent = true;

      if (emailResult.failures.length > 0) {
        for (const failure of emailResult.failures) {
          state.errors.push(`Email failed for ${failure.email}: ${failure.error}`);
        }
      }
    }

    // ========================================
    // Step 4: Final Activation
    // ========================================
    log.info('Step 4: Final activation');

    await activateOrganization({ orgId: params.orgId });

    log.info('OrganizationBootstrapResumeWorkflow completed successfully');

    return {
      orgId: params.orgId,
      domain: state.domain || '',
      dnsConfigured: state.dnsConfigured,
      invitationsSent: state.invitations?.length || 0,
      errors: state.errors
    };

  } catch (error) {
    // ========================================
    // Failure - Run Compensation (Same as Original)
    // ========================================
    log.error('Resume workflow failed, running compensation', { error });

    // Run same Saga compensation as original workflow
    // (deactivate org, delete resources, remove DNS, revoke invitations)

    // ... compensation logic (same as original workflow)

    throw error;
  }
}
```

### Compensation Handling

**If the resume workflow fails**, it should run the **same Saga compensation** as the original workflow:

1. Revoke invitations (if generated during resume)
2. Remove DNS (if configured during resume)
3. Delete contacts, addresses, phones
4. Deactivate organization

**Result**: Organization returns to soft-deleted state, can be resumed again.

---

## 6. Per-Activity Resume Logic

### Activity: `reactivateOrganizationAndResources`

**New activity** (doesn't exist in original workflow)

**Purpose**: Reactivate soft-deleted organization and recreate missing child resources

**Implementation**:

```typescript
interface ReactivateOrgParams {
  orgId: string;
  originalParams: OrganizationBootstrapParams;
  currentState: OrgBootstrapState;
}

export async function reactivateOrganizationAndResources(
  params: ReactivateOrgParams
): Promise<void> {

  const { orgId, originalParams, currentState } = params;

  // 1. Reactivate organization if soft-deleted
  if (currentState.orgDeleted) {
    await supabase.schema('api').rpc('update_organization_status', {
      p_org_id: orgId,
      p_is_active: true,
      p_deleted_at: null,
      p_deactivated_at: null
    });

    await emitEvent({
      event_type: 'organization.reactivated',
      aggregate_type: 'organization',
      aggregate_id: orgId,
      event_data: {
        reactivated_at: new Date().toISOString(),
        reason: 'workflow_resume'
      }
    });
  }

  // 2. Ensure contacts exist (reactivate or create)
  if (!currentState.contactsExist || currentState.contactsDeleted) {
    await ensureContactsExist(orgId, originalParams.contacts);
  }

  // 3. Ensure addresses exist (reactivate or create)
  if (!currentState.addressesExist || currentState.addressesDeleted) {
    await ensureAddressesExist(orgId, originalParams.addresses);
  }

  // 4. Ensure phones exist (reactivate or create)
  if (!currentState.phonesExist || currentState.phonesDeleted) {
    await ensurePhonesExist(orgId, originalParams.phones);
  }
}

async function ensureContactsExist(orgId: string, expectedContacts: Contact[]) {
  const existing = await supabase
    .schema('api')
    .rpc('get_contacts_by_org', { p_org_id: orgId, p_include_deleted: true });

  for (const expectedContact of expectedContacts) {
    const found = existing.find(c => c.email === expectedContact.email);

    if (found && found.deleted_at) {
      // Reactivate soft-deleted contact
      await emitEvent({
        event_type: 'contact.reactivated',
        aggregate_type: 'contact',
        aggregate_id: found.id,
        event_data: {
          org_id: orgId,
          email: found.email,
          reactivated_at: new Date().toISOString()
        }
      });
    } else if (!found) {
      // Create new contact (shouldn't happen, but handle it)
      const contactId = uuid();
      await emitEvent({
        event_type: 'contact.created',
        aggregate_type: 'contact',
        aggregate_id: contactId,
        event_data: {
          org_id: orgId,
          ...expectedContact
        }
      });
    }
    // else: Contact exists and active - no action
  }
}

// Similar implementations for ensureAddressesExist, ensurePhonesExist
```

### Activity: `detectOrganizationState`

**New activity** (state detection)

```typescript
interface DetectOrgStateParams {
  orgId: string;
}

interface OrgStateResult {
  resumable: boolean;
  reason?: string;  // If not resumable, why?
  orgDeleted: boolean;
  contactsExist: boolean;
  contactsDeleted: boolean;
  addressesExist: boolean;
  addressesDeleted: boolean;
  phonesExist: boolean;
  phonesDeleted: boolean;
  dnsConfigured: boolean;
  invitationsGenerated: boolean;
  emailsSent: boolean;
  orgActive: boolean;
}

export async function detectOrganizationState(
  params: DetectOrgStateParams
): Promise<OrgStateResult> {

  // Query organization status
  const { data: orgData } = await supabase
    .schema('api')
    .rpc('get_organization_status', { p_org_id: params.orgId });

  if (!orgData) {
    return {
      resumable: false,
      reason: 'Organization not found',
      orgDeleted: false,
      contactsExist: false,
      // ... all false
    };
  }

  // Query child resources
  const { data: contacts } = await supabase
    .schema('api')
    .rpc('get_contacts_by_org', { p_org_id: params.orgId, p_include_deleted: true });

  const { data: addresses } = await supabase
    .schema('api')
    .rpc('get_addresses_by_org', { p_org_id: params.orgId, p_include_deleted: true });

  const { data: phones } = await supabase
    .schema('api')
    .rpc('get_phones_by_org', { p_org_id: params.orgId, p_include_deleted: true });

  // Query domain events to detect DNS configuration
  const { data: events } = await supabase
    .from('domain_events')
    .select('event_type')
    .eq('aggregate_id', params.orgId)
    .in('event_type', [
      'organization.dns.configured',
      'organization.dns.verified',
      'user.invited',
      'invitation.email.sent'
    ]);

  const dnsConfigured = events?.some(e => e.event_type === 'organization.dns.configured') || false;
  const invitationsGenerated = events?.some(e => e.event_type === 'user.invited') || false;
  const emailsSent = events?.some(e => e.event_type === 'invitation.email.sent') || false;

  const contactsDeleted = contacts?.every(c => c.deleted_at !== null) || false;
  const addressesDeleted = addresses?.every(a => a.deleted_at !== null) || false;
  const phonesDeleted = phones?.every(p => p.deleted_at !== null) || false;

  // Determine if resumable
  const orgDeleted = !!orgData.deleted_at;
  const orgActive = orgData.is_active && !orgData.deleted_at;

  let resumable = true;
  let reason = '';

  if (orgActive && !contactsDeleted && !addressesDeleted && !phonesDeleted) {
    resumable = false;
    reason = 'Organization is already fully active and complete';
  }

  return {
    resumable,
    reason,
    orgDeleted,
    contactsExist: (contacts?.length || 0) > 0,
    contactsDeleted,
    addressesExist: (addresses?.length || 0) > 0,
    addressesDeleted,
    phonesExist: (phones?.length || 0) > 0,
    phonesDeleted,
    dnsConfigured,
    invitationsGenerated,
    emailsSent,
    orgActive
  };
}
```

### Modified Activities from Original Workflow

Most activities from the original workflow can be reused as-is:
- `configureDNS` - Already idempotent (checks for existing records)
- `verifyDNS` - Already idempotent (just checks DNS)
- `generateInvitations` - Already idempotent (checks for existing invitations)
- `sendInvitationEmails` - Already idempotent (email provider handles)
- `activateOrganization` - Already idempotent (checks if already active)

**No changes needed to existing activities!**

---

## 7. Edge Cases & Error Scenarios

### Edge Case 1: Resume Fails at Same Point as Original

**Scenario**: Original workflow failed at DNS → Resume workflow also fails at DNS

**Handling**:
- Resume workflow runs Saga compensation (returns to soft-deleted state)
- User can retry resume again later
- Each attempt creates new workflow execution in Temporal
- All attempts linked via `orgId` in domain events

**Observability**: Track resume attempt count in organization metadata

```sql
ALTER TABLE organizations_projection
ADD COLUMN resume_attempt_count INTEGER DEFAULT 0;

-- Increment on each resume attempt
UPDATE organizations_projection
SET resume_attempt_count = resume_attempt_count + 1
WHERE id = orgId;
```

### Edge Case 2: External Service Still Down

**Scenario**: Cloudflare still down when user attempts resume

**Options**:

**A. Fail fast with better error message**
```typescript
// Pre-flight check before resume
await checkExternalServiceHealth({
  cloudflare: params.originalParams.subdomain ? true : false,
  emailProvider: params.originalParams.users.length > 0
});

// Throws: "Cannot resume: Cloudflare DNS service is unreachable. Please try again later."
```

**B. Allow skipping failed step**
```typescript
// Resume params
{
  orgId: "...",
  skipDNS: true,  // Skip DNS if Cloudflare still down
  originalParams: { ... }
}

// Workflow continues without DNS
// Organization can be manually configured with DNS later
```

**Decision**: **Both** (pre-flight check + skip option)

### Edge Case 3: Data Inconsistencies

**Scenario**: Between original failure and resume attempt, someone manually modified the database

**Examples**:
- Manually added/removed contacts
- Manually created DNS record outside of workflow
- Manually activated the organization

**Handling**:

```typescript
// Detect inconsistencies during state detection
async function detectOrganizationState(params) {
  const state = await queryCurrentState(params.orgId);
  const expectedState = await queryExpectedStateFromEvents(params.orgId);

  // Compare actual vs expected
  const inconsistencies = findInconsistencies(state, expectedState);

  if (inconsistencies.length > 0) {
    log.warn('Data inconsistencies detected', {
      orgId: params.orgId,
      inconsistencies
    });

    // Options:
    // A. Fail the resume (safest)
    // B. Continue with reconciliation (more complex)
    // C. Ask user to confirm (best UX)
  }
}
```

**Decision**: **Log warnings but continue** (Option B with reconciliation)

**Rationale**: Manual fixes should not block resume. Resume workflow will reconcile state.

### Edge Case 4: Race Conditions

**Scenario**: Two users try to resume the same organization simultaneously

**Handling**: Use workflow ID as idempotency key

```typescript
// Workflow ID includes orgId (prevents concurrent resumes)
const workflowId = `org-bootstrap-resume-${params.orgId}`;

await client.workflow.start(organizationBootstrapResumeWorkflow, {
  workflowId,  // Temporal rejects duplicate workflow IDs
  taskQueue: 'bootstrap',
  args: [params]
});
```

**Result**: Second resume attempt is rejected by Temporal with "workflow already running" error

### Edge Case 5: Multiple Resume Attempts

**Scenario**: Resume fails → User retries resume → Fails again → Retries again

**Handling**: Each resume is a new workflow execution

```typescript
// Track all resume attempts via domain events
await emitEvent({
  event_type: 'organization.resume.attempted',
  aggregate_id: params.orgId,
  event_data: {
    attempt_number: currentAttemptCount + 1,
    resume_from: params.resumeFrom,
    workflow_id: workflowInfo.workflowId,
    workflow_run_id: workflowInfo.runId
  }
});

// Query event history to see all resume attempts
SELECT * FROM domain_events
WHERE aggregate_id = 'orgId'
  AND event_type = 'organization.resume.attempted'
ORDER BY created_at DESC;
```

---

## 8. User Interface & Triggers

### Admin UI: Failed Workflows View

**Location**: `/admin/workflows/failed`

**Display**:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Failed Organization Bootstrap Workflows                             │
├──────────────┬─────────────────────┬──────────────┬─────────────────┤
│ Organization │ Failed At           │ Failure Point│ Actions         │
├──────────────┼─────────────────────┼──────────────┼─────────────────┤
│ Test Org     │ 2025-11-21 10:30 PM │ DNS Config   │ [Resume] [View] │
│ (test-001)   │ (2 hours ago)       │              │                 │
├──────────────┼─────────────────────┼──────────────┼─────────────────┤
│ Family Ref   │ 2025-11-20 3:15 PM  │ Invitations  │ [Resume] [View] │
│ (family-ref) │ (1 day ago)         │              │                 │
└──────────────┴─────────────────────┴──────────────┴─────────────────┘
```

**Query to populate this view**:

```sql
-- Find organizations with failed bootstrap workflows
SELECT
  o.id,
  o.name,
  o.slug,
  o.deleted_at AS failed_at,
  o.bootstrap_params,
  e.event_data->>'error' AS failure_reason
FROM organizations_projection o
LEFT JOIN domain_events e ON e.aggregate_id = o.id
  AND e.event_type = 'organization.deactivated'
WHERE o.deleted_at IS NOT NULL
  AND o.is_active = false
ORDER BY o.deleted_at DESC;
```

### Resume Workflow Trigger Mechanism

**Button Click** → **Confirmation Modal** → **API Request** → **Workflow Start**

#### Step 1: User clicks "Resume" button

**Frontend**:
```typescript
async function handleResumeClick(orgId: string) {
  // Fetch organization details
  const org = await fetchOrganization(orgId);

  // Show confirmation modal with resume options
  setResumeModalData({
    orgId,
    orgName: org.name,
    failedAt: org.deleted_at,
    bootstrapParams: org.bootstrap_params
  });

  setResumeModalOpen(true);
}
```

#### Step 2: Confirmation modal

```typescript
<Modal>
  <h2>Resume Organization Bootstrap</h2>

  <p><strong>Organization:</strong> {orgName}</p>
  <p><strong>Failed:</strong> {formatDate(failedAt)}</p>

  <FormField label="Resume From">
    <Select value={resumeFrom} onChange={setResumeFrom}>
      <option value="auto">Auto-detect (Recommended)</option>
      <option value="dns">DNS Configuration</option>
      <option value="invitations">Invitations</option>
      <option value="activation">Activation</option>
    </Select>
  </FormField>

  <Checkbox
    checked={skipDNS}
    onChange={setSkipDNS}
    label="Skip DNS configuration if unavailable"
  />

  <Button onClick={handleResumeConfirm}>Resume Workflow</Button>
  <Button onClick={handleCancel}>Cancel</Button>
</Modal>
```

#### Step 3: API request

**Endpoint**: `POST /api/admin/workflows/resume-organization-bootstrap`

**Request**:
```typescript
interface ResumeRequest {
  orgId: string;
  resumeFrom?: 'auto' | 'dns' | 'invitations' | 'activation';
  skipDNS?: boolean;
  resumeReason?: string;
}

async function resumeOrganizationBootstrap(req: ResumeRequest) {
  // Validate admin permissions
  if (!req.user.hasRole('super_admin')) {
    throw new ForbiddenError('Only super admins can resume workflows');
  }

  // Fetch organization and validate state
  const org = await fetchOrganization(req.orgId);

  if (!org) {
    throw new NotFoundError(`Organization ${req.orgId} not found`);
  }

  if (!org.deleted_at) {
    throw new BadRequestError('Organization is not in failed state');
  }

  // Start resume workflow via Temporal client
  const handle = await temporalClient.workflow.start(
    organizationBootstrapResumeWorkflow,
    {
      workflowId: `org-bootstrap-resume-${req.orgId}`,
      taskQueue: 'bootstrap',
      args: [{
        orgId: req.orgId,
        originalParams: org.bootstrap_params,
        resumeFrom: req.resumeFrom || 'auto',
        skipDNS: req.skipDNS || false,
        resumeReason: req.resumeReason,
        originalWorkflowId: org.original_workflow_id  // If stored
      }]
    }
  );

  return {
    success: true,
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId
  };
}
```

#### Step 4: Status monitoring

**Real-time updates** via workflow query or polling:

```typescript
// Poll for workflow status
async function monitorResumeWorkflow(workflowId: string) {
  const handle = temporalClient.workflow.getHandle(workflowId);

  try {
    const result = await handle.result();

    // Success!
    showSuccessNotification('Organization bootstrap completed successfully');
    redirectTo(`/admin/organizations/${result.orgId}`);

  } catch (error) {
    // Failed again
    showErrorNotification(`Resume failed: ${error.message}`);

    // Show retry option
    setShowRetryButton(true);
  }
}
```

---

## 9. Audit Trail & Observability

### Event Emission Strategy

**All resume operations emit distinct events**:

| Event Type | Emitted When | Event Data |
|-----------|--------------|------------|
| `organization.resume.attempted` | Resume workflow starts | `{ attempt_number, resume_from, workflow_id }` |
| `organization.reactivated` | Soft-deleted org reactivated | `{ reactivated_at, reason }` |
| `contact.reactivated` | Soft-deleted contact reactivated | `{ org_id, email, reactivated_at }` |
| `address.reactivated` | Soft-deleted address reactivated | `{ org_id, street1, reactivated_at }` |
| `phone.reactivated` | Soft-deleted phone reactivated | `{ org_id, number, reactivated_at }` |
| `organization.resume.completed` | Resume workflow succeeds | `{ workflow_id, duration_ms }` |
| `organization.resume.failed` | Resume workflow fails | `{ workflow_id, error, attempt_number }` |

### Linking Original and Resume Workflow Executions

**Store original workflow ID in organization metadata**:

```typescript
// During original workflow
await supabase
  .from('organizations_projection')
  .update({
    original_workflow_id: workflowInfo.workflowId,
    original_workflow_run_id: workflowInfo.runId
  })
  .eq('id', orgId);

// During resume workflow
await supabase
  .from('organizations_projection')
  .update({
    resume_workflow_id: workflowInfo.workflowId,
    resume_workflow_run_id: workflowInfo.runId,
    last_resume_at: new Date().toISOString()
  })
  .eq('id', orgId);
```

**Query all workflows for an organization**:

```sql
-- Get complete workflow history for an organization
SELECT
  'original' AS workflow_type,
  original_workflow_id AS workflow_id,
  original_workflow_run_id AS run_id,
  created_at AS executed_at
FROM organizations_projection
WHERE id = 'orgId'

UNION ALL

SELECT
  'resume' AS workflow_type,
  resume_workflow_id AS workflow_id,
  resume_workflow_run_id AS run_id,
  last_resume_at AS executed_at
FROM organizations_projection
WHERE id = 'orgId'
  AND resume_workflow_id IS NOT NULL

UNION ALL

-- Get all resume attempts from events
SELECT
  'resume-attempt' AS workflow_type,
  event_data->>'workflow_id' AS workflow_id,
  event_data->>'workflow_run_id' AS run_id,
  created_at AS executed_at
FROM domain_events
WHERE aggregate_id = 'orgId'
  AND event_type = 'organization.resume.attempted'
ORDER BY executed_at;
```

### Metrics & Monitoring

**Temporal metrics** (via Temporal UI):
- Resume workflow success rate
- Average resume duration
- Resume retry count distribution

**Custom metrics** (via application monitoring):

```typescript
// Emit metrics to DataDog/Prometheus/CloudWatch
metrics.increment('org_bootstrap_resume.attempted', {
  resume_from: params.resumeFrom,
  skip_dns: params.skipDNS
});

metrics.increment('org_bootstrap_resume.succeeded', {
  duration_ms: executionDuration
});

metrics.increment('org_bootstrap_resume.failed', {
  failure_point: failedStep,
  error_type: error.name
});
```

### Debugging Failed Resumes

**Temporal Web UI**:
1. Navigate to workflow execution: `/namespaces/default/workflows/{workflowId}/{runId}`
2. View workflow history (all activity executions)
3. Check activity inputs/outputs
4. View errors and stack traces

**Database queries**:

```sql
-- Get all events for an organization (complete audit trail)
SELECT
  event_type,
  created_at,
  event_data,
  metadata
FROM domain_events
WHERE aggregate_id = 'orgId'
ORDER BY created_at;

-- Get state at time of resume
SELECT
  is_active,
  deleted_at,
  deactivated_at,
  (SELECT COUNT(*) FROM contacts_projection WHERE organization_id = o.id AND deleted_at IS NULL) AS active_contacts,
  (SELECT COUNT(*) FROM contacts_projection WHERE organization_id = o.id AND deleted_at IS NOT NULL) AS deleted_contacts
FROM organizations_projection o
WHERE id = 'orgId';
```

---

## 10. Testing Strategy

### Unit Tests

**Test each activity in isolation**:

```typescript
describe('reactivateOrganizationAndResources', () => {
  it('should reactivate soft-deleted organization', async () => {
    // Arrange: Create soft-deleted org
    const orgId = await createSoftDeletedOrg();

    // Act: Reactivate
    await reactivateOrganizationAndResources({
      orgId,
      originalParams: mockBootstrapParams,
      currentState: { orgDeleted: true, ... }
    });

    // Assert: Org is active
    const org = await getOrgStatus(orgId);
    expect(org.is_active).toBe(true);
    expect(org.deleted_at).toBeNull();
  });

  it('should recreate soft-deleted contacts', async () => {
    // Arrange: Org with soft-deleted contacts
    const orgId = await createOrgWithSoftDeletedContacts();

    // Act: Reactivate
    await reactivateOrganizationAndResources({
      orgId,
      originalParams: mockBootstrapParams,
      currentState: { contactsDeleted: true, ... }
    });

    // Assert: Contacts are active
    const contacts = await getContactsByOrg(orgId);
    expect(contacts).toHaveLength(3);
    expect(contacts.every(c => !c.deleted_at)).toBe(true);
  });

  it('should emit reactivation events', async () => {
    // ... test event emission
  });
});

describe('detectOrganizationState', () => {
  it('should detect soft-deleted org state', async () => {
    // Arrange: Soft-deleted org
    const orgId = await createSoftDeletedOrg();

    // Act: Detect state
    const state = await detectOrganizationState({ orgId });

    // Assert: State is accurate
    expect(state.orgDeleted).toBe(true);
    expect(state.resumable).toBe(true);
    expect(state.reason).toBeUndefined();
  });

  it('should detect non-resumable state (already active)', async () => {
    // Arrange: Fully active org
    const orgId = await createActiveOrg();

    // Act: Detect state
    const state = await detectOrganizationState({ orgId });

    // Assert: Not resumable
    expect(state.resumable).toBe(false);
    expect(state.reason).toContain('already fully active');
  });
});
```

### Integration Tests

**Test complete resume workflow against Temporal**:

```typescript
describe('organizationBootstrapResumeWorkflow', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createLocal();
  });

  it('should resume from DNS failure', async () => {
    // Arrange: Run original workflow, fail at DNS
    const originalResult = await runOriginalWorkflowUntilDNSFailure();
    expect(originalResult.errors).toContain('DNS configuration failed');

    // Verify compensation ran
    const org = await getOrgStatus(originalResult.orgId);
    expect(org.deleted_at).not.toBeNull();

    // Act: Resume workflow
    const resumeResult = await testEnv.client.workflow.execute(
      organizationBootstrapResumeWorkflow,
      {
        workflowId: `resume-${originalResult.orgId}`,
        taskQueue: 'bootstrap',
        args: [{
          orgId: originalResult.orgId,
          originalParams: mockBootstrapParams,
          resumeFrom: 'dns'
        }]
      }
    );

    // Assert: Workflow completed
    expect(resumeResult.errors).toHaveLength(0);
    expect(resumeResult.dnsConfigured).toBe(true);

    // Verify org is active
    const finalOrg = await getOrgStatus(resumeResult.orgId);
    expect(finalOrg.is_active).toBe(true);
    expect(finalOrg.deleted_at).toBeNull();
  });

  it('should handle resume failure with compensation', async () => {
    // Arrange: Soft-deleted org, DNS provider still down
    const orgId = await createSoftDeletedOrg();
    mockDNSProvider.mockRejectedValue(new Error('DNS service unavailable'));

    // Act: Attempt resume (should fail)
    await expect(
      testEnv.client.workflow.execute(
        organizationBootstrapResumeWorkflow,
        {
          args: [{ orgId, originalParams: mockBootstrapParams }]
        }
      )
    ).rejects.toThrow('DNS service unavailable');

    // Assert: Compensation ran, org still soft-deleted
    const org = await getOrgStatus(orgId);
    expect(org.deleted_at).not.toBeNull();
  });
});
```

### Failure Injection Testing

**Test resume workflow with injected failures**:

```typescript
describe('Resume workflow failure scenarios', () => {
  it('should handle failure during contact reactivation', async () => {
    // Inject failure in ensureContactsExist activity
    mockContactsRPC.mockRejectedValueOnce(new Error('Database connection lost'));

    // Attempt resume
    await expect(resumeWorkflow()).rejects.toThrow();

    // Verify compensation ran
    const org = await getOrgStatus(orgId);
    expect(org.deleted_at).not.toBeNull();
  });

  it('should handle partial email sending failure', async () => {
    // Inject failure for 2 out of 3 emails
    mockEmailProvider
      .mockResolvedValueOnce({ success: true })  // Email 1: success
      .mockRejectedValueOnce(new Error('SMTP timeout'))  // Email 2: fail
      .mockResolvedValueOnce({ success: true });  // Email 3: success

    // Resume should complete but with errors
    const result = await resumeWorkflow();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('SMTP timeout');
    expect(result.invitationsSent).toBe(2);  // 2 out of 3
  });
});
```

### Manual Testing Procedures for Phase 4.1

**Test Case: Resume after DNS failure**

1. **Setup**: Run original workflow with DNS provider mocked to fail
   ```bash
   export WORKFLOW_MODE=development
   export DNS_PROVIDER=mock-fail  # Custom mock that always fails
   npm run trigger-workflow
   ```

2. **Verify**: Organization is soft-deleted
   ```sql
   SELECT id, name, is_active, deleted_at
   FROM organizations_projection
   WHERE slug = 'test-provider-001';
   -- Expected: is_active=false, deleted_at=<timestamp>
   ```

3. **Resume**: Trigger resume workflow via admin UI or script
   ```bash
   export DNS_PROVIDER=mock-success  # Mock that succeeds
   npm run resume-workflow -- --org-id=<org-id>
   ```

4. **Verify**: Organization is active
   ```sql
   SELECT id, name, is_active, deleted_at
   FROM organizations_projection
   WHERE id = '<org-id>';
   -- Expected: is_active=true, deleted_at=null
   ```

5. **Verify**: All events emitted
   ```sql
   SELECT event_type, created_at
   FROM domain_events
   WHERE aggregate_id = '<org-id>'
   ORDER BY created_at;
   -- Expected:
   -- organization.created
   -- organization.deactivated (from compensation)
   -- organization.resume.attempted
   -- organization.reactivated
   -- organization.dns.configured
   -- organization.activated
   ```

---

## 11. Implementation Phases

### Phase 1: Core Resume Workflow (DNS Failure Recovery)

**Goal**: Implement minimal resume workflow that handles DNS failure scenario

**Scope**:
- ✅ `detectOrganizationState` activity
- ✅ `reactivateOrganizationAndResources` activity
- ✅ `organizationBootstrapResumeWorkflow` (basic version)
- ✅ Resume from DNS failure only
- ✅ Unit tests for new activities
- ✅ Integration test for DNS failure → resume

**Timeline**: 1-2 days

**Deliverables**:
- Working resume workflow for DNS failures
- Test coverage ≥80%
- Documentation in `workflows/CLAUDE.md`

### Phase 2: Full Activity Coverage

**Goal**: Support resume from any failure point

**Scope**:
- ✅ Resume from invitation generation failure
- ✅ Resume from email sending failure
- ✅ Resume from activation failure
- ✅ Handle all edge cases (missing contacts, duplicate resources, etc.)
- ✅ Comprehensive test suite

**Timeline**: 2-3 days

**Deliverables**:
- Resume workflow handles all failure scenarios
- Edge case tests passing
- Updated documentation

### Phase 3: Admin UI Integration

**Goal**: User-friendly interface for triggering resumes

**Scope**:
- ✅ Failed workflows dashboard (`/admin/workflows/failed`)
- ✅ Resume confirmation modal
- ✅ API endpoint: `POST /api/admin/workflows/resume-organization-bootstrap`
- ✅ Real-time status monitoring
- ✅ Resume history view

**Timeline**: 2-3 days

**Deliverables**:
- Admin UI for resume workflows
- User documentation

### Phase 4: Production Hardening

**Goal**: Production-ready with observability and error handling

**Scope**:
- ✅ Metrics and monitoring (resume success rate, duration, etc.)
- ✅ Error alerting (PagerDuty/Slack integration)
- ✅ Pre-flight health checks (external services)
- ✅ Retry limits and backoff strategies
- ✅ Production testing with real Cloudflare API

**Timeline**: 1-2 days

**Deliverables**:
- Production-ready resume workflow
- Runbook for on-call engineers
- Monitoring dashboards

**Total Timeline**: 6-10 days

---

## 12. Alternative Approaches

### Approach A: Resume Workflow (Recommended)

**Design**: Dedicated `organizationBootstrapResumeWorkflow` that reactivates and completes

**Pros**:
- ✅ Explicit intent (resume vs create)
- ✅ Preserves complete audit trail
- ✅ Handles all edge cases cleanly
- ✅ No changes to original workflow
- ✅ Can add resume-specific logic (pre-flight checks, skip options)

**Cons**:
- ❌ More code (new workflow + activities)
- ❌ Requires admin UI for triggering
- ❌ More complex testing (2 workflows)

### Approach B: Retry Original Workflow

**Design**: Modify `createOrganization` activity to resurrect soft-deleted orgs, then retry original workflow

**Pros**:
- ✅ Reuses existing workflow
- ✅ Less code (just modify activities)
- ✅ User can retry from UI (same flow)

**Cons**:
- ❌ Conflates "create" and "resume" logic in activities
- ❌ Harder to reason about (single activity does two things)
- ❌ Audit trail less clear (looks like new org creation)
- ❌ Edge cases harder to handle (can't skip DNS easily)

### Approach C: Manual Cleanup + Retry

**Design**: Provide SQL scripts for cleanup, user manually deletes and retries

**Pros**:
- ✅ No new code needed
- ✅ Simple (just delete rows)

**Cons**:
- ❌ Loses audit trail (events deleted)
- ❌ Requires SQL access (security risk)
- ❌ Poor UX (manual intervention)
- ❌ Error-prone (easy to miss FK constraints)
- ❌ Not acceptable for production

### Comparison Matrix

| Feature | Resume Workflow (A) | Retry Original (B) | Manual Cleanup (C) |
|---------|---------------------|--------------------|--------------------|
| Preserves audit trail | ✅ Yes | ⚠️ Partial | ❌ No |
| User-friendly | ✅ Yes (admin UI) | ✅ Yes (same UI) | ❌ No (SQL access) |
| Handles edge cases | ✅ Excellent | ⚠️ Good | ❌ Poor |
| Code complexity | ⚠️ High | ⚠️ Medium | ✅ Low |
| Production-ready | ✅ Yes | ⚠️ Acceptable | ❌ No |
| Supports skip options | ✅ Yes | ❌ No | ✅ Yes (manual) |

**Decision**: **Approach A (Resume Workflow)**

**Rationale**:
- HIPAA compliance requires complete audit trail
- Production system must not require SQL access for recovery
- Edge cases (skip DNS, handle inconsistencies) require dedicated logic
- Separation of concerns: "create" vs "resume" are different intents

---

## 13. Open Questions & Decisions Needed

### Question 1: Event Types for Reactivation

**Options**:
- A. New event types: `*.reactivated` (e.g., `organization.reactivated`, `contact.reactivated`)
- B. Reuse existing event types: `*.created` with metadata flag `is_reactivation: true`
- C. Single event: `organization.resumed` with details of all resources reactivated

**Recommendation**: **Option A** (new event types)

**Rationale**:
- Explicit event types make audit trail clearer
- Event processors can handle reactivation differently than creation
- Easier to query for "all reactivations" vs "all creations"

### Question 2: Should Resume Workflow Modify Original Bootstrap Params?

**Scenario**: User wants to resume but also change invitation list

**Options**:
- A. Resume uses original params exactly (immutable)
- B. Allow overriding params during resume
- C. Separate "resume" from "modify" (two workflows)

**Recommendation**: **Option A** (immutable params)

**Rationale**:
- Resume = "complete what was started", not "change the plan"
- If user wants different params, they should create a new organization
- Simplifies testing and reasoning

### Question 3: Hard Delete vs Soft Delete for Resume Failures

**Scenario**: Resume workflow fails, compensation runs again. Should we:
- A. Soft-delete again (keep accumulating deleted_at timestamps)
- B. Hard-delete the organization (remove from database)
- C. Keep organization but mark as "failed permanently" (no more resumes)

**Recommendation**: **Option A** (soft-delete again)

**Rationale**:
- Preserves audit trail (never lose data)
- User can retry resume again if they want
- Consistent with existing compensation pattern

### Question 4: Pre-flight Health Checks

**Should resume workflow check external service health before starting?**

**Options**:
- A. Always check (fail fast if service down)
- B. Never check (let activities fail naturally)
- C. Optional check (user can skip via param)

**Recommendation**: **Option C** (optional, but enabled by default)

**Rationale**:
- Good UX: Users don't wait 20 minutes for DNS retries if Cloudflare is down
- Optional: If user knows service is up, they can skip the check
- Minimal cost: Simple HTTP request to external service health endpoint

---

## Next Steps

1. **Review this plan** with team and stakeholders
2. **Make decisions** on open questions
3. **Create tasks** in project management tool
4. **Start Phase 1** implementation (core resume workflow)
5. **Test against Phase 4.1** failed workflow scenarios
6. **Iterate** based on testing feedback

---

## References

- **Original Workflow**: `workflows/src/workflows/organization-bootstrap/workflow.ts`
- **Temporal Workflow Guidelines**: `.claude/skills/temporal-workflow-guidelines/`
- **Phase 4.1 Context**: `dev/active/phase-4.1-workflow-verification-context.md`
- **Temporal Docs**: https://docs.temporal.io/workflows#saga-pattern
- **CQRS Event Sourcing**: `documentation/architecture/data/event-sourcing-overview.md`
