# Temporal Workflow Reviewer Agent

---
description: |
  Specialized agent for reviewing Temporal.io workflow and activity code for determinism compliance,
  proper error handling, Saga compensation patterns, and event emission correctness.
agent_type: review
context: temporal
estimated_time: 5-15 minutes per workflow
---

## Purpose

This agent performs comprehensive review of Temporal workflow and activity implementations to ensure they follow Workflow-First architecture principles, maintain determinism guarantees, implement proper Saga compensation, and correctly emit domain events for CQRS integration.

## When to Invoke

**Automatically**:
- Before committing workflow or activity code to git
- As part of PR review process
- Before deploying workers to development/staging/production

**Manually**:
- After creating a new workflow
- After modifying existing workflow logic
- When debugging non-deterministic workflow errors
- When reviewing activity error handling
- When troubleshooting event emission issues

## Validation Criteria

### 1. Workflow Determinism (CRITICAL)

Workflows MUST be deterministic - same input always produces same output. All side effects must be in activities.

#### Non-Deterministic Code in Workflows (NEVER ALLOWED)

❌ **NEVER do these in workflow code**:
```typescript
import { proxyActivities } from '@temporalio/workflow';

// ❌ WRONG: Direct HTTP calls in workflow
async function bootstrapOrganization(input: BootstrapInput) {
  const response = await fetch('https://api.example.com/org');  // NON-DETERMINISTIC!
  const data = await response.json();
  // ...
}

// ❌ WRONG: Random values in workflow
async function createUser(input: UserInput) {
  const userId = Math.random().toString();  // NON-DETERMINISTIC!
  return userId;
}

// ❌ WRONG: Current time in workflow
async function scheduleTask(input: TaskInput) {
  const now = new Date();  // NON-DETERMINISTIC!
  const deadline = new Date(now.getTime() + 86400000);
  // ...
}

// ❌ WRONG: Direct database queries in workflow
async function loadUserData(userId: string) {
  const user = await supabase.from('users').select('*').eq('id', userId);  // NON-DETERMINISTIC!
  return user;
}

// ❌ WRONG: Emitting events in workflow
async function createOrganization(input: OrgInput) {
  // ... organization creation ...

  await supabase.from('domain_events').insert({  // NON-DETERMINISTIC!
    event_type: 'OrganizationCreated',
    event_data: { org_id: orgId }
  });
}
```

#### Deterministic Workflow Code (REQUIRED)

✅ **CORRECT**: All side effects delegated to activities
```typescript
import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

const {
  createOrganizationInSupabase,
  provisionCloudflareZone,
  sendInvitationEmail,
  emitOrganizationCreatedEvent  // Event emission in activity
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

export async function bootstrapOrganization(input: BootstrapInput): Promise<void> {
  let organizationId: string | undefined;
  let zoneId: string | undefined;

  try {
    // Step 1: Create organization (side effect in activity)
    organizationId = await createOrganizationInSupabase({
      name: input.organizationName,
      subdomain: input.subdomain,
    });

    // Step 2: Provision DNS (side effect in activity)
    zoneId = await provisionCloudflareZone({
      subdomain: input.subdomain,
      organizationId,
    });

    // Step 3: Send invitation (side effect in activity)
    await sendInvitationEmail({
      email: input.adminEmail,
      organizationId,
      invitationCode: input.invitationCode,
    });

    // Step 4: Emit success event (side effect in activity)
    await emitOrganizationCreatedEvent({
      organizationId,
      subdomain: input.subdomain,
      adminEmail: input.adminEmail,
    });

  } catch (error) {
    // Saga compensation: rollback in reverse order
    if (zoneId) {
      await deleteCloudflareZone({ zoneId });
    }
    if (organizationId) {
      await deleteOrganizationFromSupabase({ organizationId });
    }
    throw error;
  }
}
```

**Validation Checks**:
- ✅ No direct HTTP calls, database queries, or random values in workflow
- ✅ No `Date.now()`, `Math.random()`, or other non-deterministic APIs
- ✅ All external interactions delegated to activities
- ✅ Activities proxied with proper configuration
- ✅ Event emission happens in activities, not workflows

### 2. Activity Implementation (IMPORTANT)

Activities contain all side effects and must be idempotent, handle errors properly, and emit events.

#### Activity Structure

✅ **CORRECT**: Idempotent activity with proper error handling and event emission
```typescript
import { ApplicationFailure } from '@temporalio/activity';
import { supabase } from '../lib/supabase';

interface CreateOrgInput {
  name: string;
  subdomain: string;
}

export async function createOrganizationInSupabase(
  input: CreateOrgInput
): Promise<string> {
  try {
    // 1. Idempotency check: Does org already exist?
    const { data: existing } = await supabase
      .from('organizations')
      .select('id')
      .eq('subdomain', input.subdomain)
      .single();

    if (existing) {
      console.log('Organization already exists, returning existing ID');
      return existing.id;  // Idempotent: safe to retry
    }

    // 2. Create organization
    const { data, error } = await supabase
      .from('organizations')
      .insert({
        name: input.name,
        subdomain: input.subdomain,
      })
      .select()
      .single();

    if (error) {
      // 3. Proper error handling: Non-retryable errors
      if (error.code === '23505') {  // Unique constraint violation
        throw ApplicationFailure.create({
          message: `Subdomain ${input.subdomain} already exists`,
          type: 'SubdomainAlreadyExists',
          nonRetryable: true,  // Don't retry validation errors
        });
      }
      throw error;  // Retryable database errors
    }

    // 4. Emit domain event (activities emit, not workflows!)
    await emitDomainEvent({
      event_type: 'OrganizationCreated',
      aggregate_type: 'Organization',
      aggregate_id: data.id,
      event_data: {
        name: input.name,
        subdomain: input.subdomain,
        created_at: data.created_at,
      },
      metadata: {
        workflow_id: Context.current().info.workflowExecution.workflowId,
        run_id: Context.current().info.workflowExecution.runId,
        workflow_type: Context.current().info.workflowType,
        activity_id: Context.current().info.activityId,
      },
    });

    return data.id;

  } catch (error) {
    // 5. Log and re-throw for Temporal retry handling
    console.error('Failed to create organization:', error);
    throw error;
  }
}
```

**Validation Checks**:
- ✅ Idempotency: Check if operation already succeeded before retrying
- ✅ Error handling: Use `ApplicationFailure` for non-retryable errors
- ✅ Event emission: Activities emit domain events, not workflows
- ✅ Event metadata: Includes workflow_id, run_id, workflow_type, activity_id
- ✅ Proper return types and error propagation

#### Common Activity Anti-Patterns

❌ **Non-idempotent activities**:
```typescript
// ❌ WRONG: Creates duplicate organizations on retry
export async function createOrganizationInSupabase(input: CreateOrgInput): Promise<string> {
  const { data } = await supabase
    .from('organizations')
    .insert(input)
    .select()
    .single();  // Will fail on retry if first attempt succeeded!

  return data.id;
}
```

❌ **Missing error classification**:
```typescript
// ❌ WRONG: All errors retry, including validation errors
export async function createOrganizationInSupabase(input: CreateOrgInput): Promise<string> {
  const { data, error } = await supabase
    .from('organizations')
    .insert(input)
    .select()
    .single();

  if (error) throw error;  // Should check if retryable!
  return data.id;
}
```

❌ **Events emitted in workflow instead of activity**:
```typescript
// ❌ WRONG: Workflow emits event (NON-DETERMINISTIC!)
export async function bootstrapOrganization(input: BootstrapInput): Promise<void> {
  const orgId = await createOrganizationInSupabase(input);

  // Event emission should be in activity, not here!
  await supabase.from('domain_events').insert({
    event_type: 'OrganizationCreated',
    event_data: { org_id: orgId }
  });
}
```

### 3. Saga Compensation Pattern (IMPORTANT)

Workflows must implement Saga pattern: rollback in reverse order on failure.

✅ **CORRECT**: Proper Saga compensation with reverse rollback
```typescript
export async function bootstrapOrganization(input: BootstrapInput): Promise<void> {
  let organizationId: string | undefined;
  let zoneId: string | undefined;
  let invitationId: string | undefined;

  try {
    // Forward progress: each step records ID for potential rollback
    organizationId = await createOrganizationInSupabase(input);
    zoneId = await provisionCloudflareZone({ organizationId, subdomain: input.subdomain });
    invitationId = await sendInvitationEmail({ organizationId, email: input.adminEmail });

    await emitOrganizationCreatedEvent({ organizationId });

  } catch (error) {
    // Saga compensation: rollback in REVERSE order
    if (invitationId) {
      await cancelInvitationEmail({ invitationId });  // Rollback step 3
    }
    if (zoneId) {
      await deleteCloudflareZone({ zoneId });  // Rollback step 2
    }
    if (organizationId) {
      await deleteOrganizationFromSupabase({ organizationId });  // Rollback step 1
    }
    throw error;  // Re-throw after cleanup
  }
}
```

❌ **WRONG**: No compensation, leaves orphaned resources
```typescript
export async function bootstrapOrganization(input: BootstrapInput): Promise<void> {
  const organizationId = await createOrganizationInSupabase(input);
  const zoneId = await provisionCloudflareZone({ organizationId, subdomain: input.subdomain });
  const invitationId = await sendInvitationEmail({ organizationId, email: input.adminEmail });
  // No try-catch! If sendInvitationEmail fails, organization and zone are orphaned!
}
```

**Validation Checks**:
- ✅ Try-catch block wraps all steps
- ✅ Each step records IDs for potential rollback
- ✅ Catch block rolls back in REVERSE order
- ✅ Rollback activities are idempotent (safe to call multiple times)
- ✅ Error is re-thrown after cleanup

### 4. Activity Retry Configuration (IMPORTANT)

Different operation types require different retry policies.

✅ **CORRECT**: Tailored retry policies per operation type
```typescript
// External API calls: aggressive retries with backoff
const { provisionCloudflareZone } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts: 5,  // External APIs can be flaky
    initialInterval: '5 seconds',
    backoffCoefficient: 2.0,  // Exponential backoff
    maximumInterval: '1 minute',
  },
});

// Validation activities: few retries (errors likely permanent)
const { validateSubdomain } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    maximumAttempts: 1,  // Validation errors don't benefit from retry
  },
});

// Database operations: moderate retries
const { createOrganizationInSupabase } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1 second',
    backoffCoefficient: 2.0,
  },
});

// Email delivery: patient retries with long timeout
const { sendInvitationEmail } = proxyActivities<typeof activities>({
  startToCloseTimeout: '15 minutes',  // Email can be slow
  retry: {
    maximumAttempts: 10,
    initialInterval: '10 seconds',
    backoffCoefficient: 1.5,
    maximumInterval: '5 minutes',
  },
});
```

**Validation Checks**:
- ✅ `startToCloseTimeout` appropriate for operation type
- ✅ `maximumAttempts` balances success rate vs latency
- ✅ Validation activities have low retry counts
- ✅ External APIs have exponential backoff
- ✅ Email/messaging has patient retries

### 5. Workflow Versioning (ADVANCED)

When modifying existing workflows, use `patched()` to maintain compatibility with running workflows.

✅ **CORRECT**: Using `patched()` for backward compatibility
```typescript
import { patched } from '@temporalio/workflow';

export async function bootstrapOrganization(input: BootstrapInput): Promise<void> {
  const organizationId = await createOrganizationInSupabase(input);

  // New step added in v2: DNS provisioning
  if (patched('add-dns-provisioning')) {
    const zoneId = await provisionCloudflareZone({ organizationId, subdomain: input.subdomain });
  }

  await sendInvitationEmail({ organizationId, email: input.adminEmail });
}
```

**Validation Checks**:
- ✅ Use `patched()` when adding new steps to existing workflows
- ✅ Patch IDs are descriptive (e.g., 'add-dns-provisioning')
- ✅ Patches are documented in workflow comments

### 6. Event Emission Patterns (CRITICAL)

Events MUST be emitted in activities using correct structure and naming.

✅ **CORRECT**: Activity emits event with proper structure
```typescript
// In activity, not workflow!
export async function createOrganizationInSupabase(input: CreateOrgInput): Promise<string> {
  const { data } = await supabase.from('organizations').insert(input).select().single();

  // Emit domain event
  await emitDomainEvent({
    event_type: 'OrganizationCreated',  // PastTense naming
    aggregate_type: 'Organization',
    aggregate_id: data.id,
    event_data: {
      org_id: data.id,
      name: input.name,
      subdomain: input.subdomain,
      created_at: data.created_at,
    },
    metadata: {
      workflow_id: Context.current().info.workflowExecution.workflowId,
      run_id: Context.current().info.workflowExecution.runId,
      workflow_type: Context.current().info.workflowType,
      activity_id: Context.current().info.activityId,
    },
  });

  return data.id;
}
```

**Validation Checks**:
- ✅ Events emitted in activities, NOT workflows
- ✅ Event type uses PastTense naming (OrganizationCreated, not CreateOrganization)
- ✅ Event data includes aggregate_id and relevant fields
- ✅ Metadata includes workflow context (workflow_id, run_id, etc.)
- ✅ Event structure matches AsyncAPI contract (if defined)

## Review Process

When reviewing a workflow or activity file:

1. **Check workflow determinism**:
   - No HTTP calls, database queries, or random values in workflow code
   - No `Date.now()`, `Math.random()`, or other non-deterministic APIs
   - All side effects delegated to activities

2. **Verify activity implementation**:
   - Activities are idempotent (check-then-execute pattern)
   - Proper error handling with ApplicationFailure for non-retryable errors
   - Events emitted in activities with correct structure
   - Event metadata includes workflow context

3. **Validate Saga compensation**:
   - Try-catch block wraps all steps
   - Rollback in reverse order
   - Rollback activities exist and are idempotent

4. **Review retry configuration**:
   - startToCloseTimeout appropriate for operation
   - maximumAttempts balanced for operation type
   - Exponential backoff for external APIs

5. **Check workflow versioning**:
   - New steps use `patched()` for backward compatibility
   - Patch IDs are descriptive

6. **Validate event emission**:
   - Events in activities, not workflows
   - PastTense naming
   - Complete metadata

## Output Format

**Success**:
```
✅ Workflow review PASSED: temporal/src/workflows/bootstrap-organization.ts

Checks completed:
- Determinism: ✅ No side effects in workflow code
- Activities: ✅ Proper idempotency and error handling
- Saga Compensation: ✅ Rollback implemented in reverse order
- Retry Configuration: ✅ Appropriate retry policies
- Event Emission: ✅ Events emitted in activities with correct structure
```

**Failure**:
```
❌ Workflow review FAILED: temporal/src/workflows/bootstrap-organization.ts

Issues found:

[CRITICAL] Non-deterministic code in workflow (Line 23):
  const now = new Date();
  ❌ Date.now() is non-deterministic
  ✅ Move time-based logic to activity or use Temporal's sleep()

[CRITICAL] Event emitted in workflow (Line 45):
  await supabase.from('domain_events').insert(...);
  ❌ Event emission is a side effect (non-deterministic)
  ✅ Move event emission to activity

[IMPORTANT] Missing Saga compensation (Line 30-35):
  No try-catch block for rollback
  ❌ If provisionCloudflareZone fails, organization is orphaned
  ✅ Add try-catch with reverse-order rollback

[IMPORTANT] Activity not idempotent (temporal/src/activities/create-org.ts:15):
  await supabase.from('organizations').insert(input);
  ❌ Will fail on retry if first attempt succeeded
  ✅ Add idempotency check: query first, return if exists

[WARNING] Retry policy too aggressive (Line 12):
  maximumAttempts: 1 for external API call
  ❌ Single attempt will fail on transient network issues
  ✅ Increase to 5+ attempts with exponential backoff
```

## References

- **A4C-AppSuite Workflow Examples**: `temporal/src/workflows/` (existing patterns)
- **Temporal Workflow Skill**: `.claude/skills/temporal-workflow-guidelines/`
- **Temporal CLAUDE.md**: `temporal/CLAUDE.md` (determinism and Saga patterns)
- **Event Emission Patterns**: `.claude/skills/temporal-workflow-guidelines/resources/event-emission.md`

## Usage Example

```bash
# Manually invoke agent on a specific workflow
echo "Review this workflow: temporal/src/workflows/bootstrap-organization.ts"

# Or integrate into pre-commit hook
.claude/hooks/review-workflow.sh temporal/src/workflows/bootstrap-organization.ts
```

---

**Agent Version**: 1.0.0
**Last Updated**: 2025-11-10
**Maintainer**: A4C-AppSuite Temporal Team
