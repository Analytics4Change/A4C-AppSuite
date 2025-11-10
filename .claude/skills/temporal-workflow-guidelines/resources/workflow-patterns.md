# Workflow Patterns

This guide covers deterministic workflow design, versioning strategies, saga compensation, and child workflow patterns for Temporal.io in A4C-AppSuite.

---

## Determinism Requirements

### What is Determinism?

Workflows must be **deterministic** - the same workflow code with the same inputs must always produce the same execution history. Temporal replays workflows from event history after crashes/restarts, so non-deterministic code will break replay.

### Deterministic Operations (Safe to Use)

```typescript
import { uuid4, sleep, condition } from '@temporalio/workflow'

// ✅ Temporal's deterministic UUID
const workflowRunId = uuid4()

// ✅ Deterministic sleep (durable timer)
await sleep('5 minutes')

// ✅ Deterministic conditional wait
await condition(() => workflowState === 'ready', '1 hour')

// ✅ Workflow parameters (same input → same result)
const orgName = params.organizationName

// ✅ Activity results (recorded in history)
const result = await myActivity(params)
```

### Non-Deterministic Operations (Must Avoid)

```typescript
// ❌ Math.random() - different each replay
const randomId = Math.random().toString()

// ❌ Date.now() - different each replay
const timestamp = Date.now()

// ❌ new Date() - different each replay
const now = new Date()

// ❌ setTimeout - not durable
setTimeout(() => console.log('done'), 5000)

// ❌ Direct API calls - side effects
const response = await fetch('https://api.example.com')

// ❌ Direct database access - side effects
await supabase.from('orgs').insert({ name: 'test' })

// ❌ Process.env at runtime - may change
const apiKey = process.env.API_KEY  // Use at import time instead
```

### Correct Patterns

```typescript
// ✅ Use Temporal's deterministic APIs
import { uuid4, sleep } from '@temporalio/workflow'
const workflowId = uuid4()
await sleep('5 minutes')

// ✅ Use activities for all side effects
const timestamp = await getCurrentTimestampActivity()
const data = await fetchAPIActivity({ url: 'https://api.example.com' })
await createOrgActivity({ name: 'test' })
```

---

## Workflow Versioning

### The Problem

When you update workflow code, in-flight workflows (already running) will replay with the new code. This can cause non-determinism errors if the execution history doesn't match the new code.

### Solution: patched()

Use `patched()` to introduce versioned changes that work for both old and new workflows.

```typescript
import { patched, proxyActivities } from '@temporalio/workflow'
import type * as activities from '../../activities/organization'

const { step1Activity, step2Activity, newStepActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes'
})

export async function BootstrapWorkflow(params) {
  // Original logic (all workflows - old and new)
  const orgId = await step1Activity(params)
  await step2Activity({ orgId })

  // New logic (only NEW workflows execute this)
  if (patched('add-email-notification')) {
    await newStepActivity({ orgId })
  }

  return { orgId }
}
```

### How patched() Works

**First deployment** (with `patched()`):
- **Old workflows** (already running): `patched()` returns `false`, skip new logic
- **New workflows**: `patched()` returns `true`, execute new logic

**Future deployment** (after all old workflows complete):
- Remove `patched()` block entirely
- All workflows now execute the new logic unconditionally

### Deployment Process

```bash
# Step 1: Deploy with patched() block
git commit -m "Add email notification with patched()"
npm run build && docker build -t worker:v1.1.0 .
kubectl set image deployment/temporal-worker worker=worker:v1.1.0

# Step 2: Wait for old workflows to complete
# Query Temporal Web UI - ensure no workflows running old code

# Step 3: Remove patched() block
# After all old workflows complete, remove the conditional:
# if (patched('add-email-notification')) { ... }
# becomes unconditional:
# await newStepActivity({ orgId })

git commit -m "Remove patched block after migration"
npm run build && docker build -t worker:v1.2.0 .
kubectl set image deployment/temporal-worker worker=worker:v1.2.0
```

### Multiple Versions

```typescript
export async function ComplexWorkflow(params) {
  const result1 = await step1Activity(params)

  // Version 2: Added step2
  if (patched('add-step2')) {
    await step2Activity({ result1 })
  }

  // Version 3: Added step3
  if (patched('add-step3')) {
    await step3Activity({ result1 })
  }

  return result1
}

// After all v1 workflows complete, remove first patched()
// After all v2 workflows complete, remove second patched()
```

---

## Saga Compensation

### The Pattern

Saga pattern implements distributed transactions by rolling back completed steps when a later step fails.

**Key Principle**: Track which steps completed, compensate in reverse order on failure.

### Basic Saga Template

```typescript
export async function SagaWorkflow(params: SagaParams) {
  // Track completion state
  let resourceCreated = false
  let dnsConfigured = false
  let databaseProvisioned = false

  try {
    // Step 1: Create resource
    const resourceId = await createResourceActivity(params)
    resourceCreated = true

    // Step 2: Configure DNS
    await configureDNSActivity({ resourceId, subdomain: params.subdomain })
    dnsConfigured = true

    // Step 3: Provision database
    await provisionDatabaseActivity({ resourceId })
    databaseProvisioned = true

    return { success: true, resourceId }

  } catch (error) {
    // Compensation: rollback in REVERSE order
    if (databaseProvisioned) {
      await deprovisionDatabaseActivity({ resourceId })
    }
    if (dnsConfigured) {
      await deleteDNSRecordActivity({ subdomain: params.subdomain })
    }
    if (resourceCreated) {
      await deleteResourceActivity({ resourceId })
    }

    // Re-throw to mark workflow as failed
    throw error
  }
}
```

### Advanced Saga with Partial Success

Return partial results even on failure by catching errors and returning status instead of throwing.

```typescript
export async function ProvisionTenantWorkflow(params) {
  let orgId: string, dnsConfigured = false, dbReady = false

  try {
    orgId = await createOrganizationActivity(params)
    await configureDNSActivity({ orgId })
    dnsConfigured = true
    await provisionDatabaseActivity({ orgId })
    dbReady = true

    return { success: true, orgId, dnsConfigured, dbReady }
  } catch (error) {
    if (dbReady) await deprovisionDatabaseActivity({ orgId })
    if (dnsConfigured) await deleteDNSRecordActivity(params)

    return { success: false, orgId, dnsConfigured: false, dbReady: false, error: error.message }
  }
}
```

### Compensation Best Practices

1. **Rollback in Reverse Order**: Undo steps in opposite order of execution
2. **Track State Carefully**: Use boolean flags to know what needs compensation
3. **Idempotent Compensation**: Compensation activities must be safe to retry
4. **Handle Compensation Failures**: Log errors, consider manual intervention
5. **Don't Always Rollback Everything**: Some resources should persist (e.g., audit logs)

```typescript
// Compensation activity should be idempotent
export async function deleteResourceActivity(params: { resourceId: string }) {
  // Check if resource exists first
  const { data: resource } = await supabase
    .from('resources')
    .select('id')
    .eq('id', params.resourceId)
    .single()

  if (!resource) {
    console.log(`Resource ${params.resourceId} already deleted`)
    return  // Idempotent - safe to call multiple times
  }

  // Delete resource
  await supabase.from('resources').delete().eq('id', params.resourceId)

  // Emit compensation event
  await supabase.from('domain_events').insert({
    event_type: 'ResourceDeleted',
    aggregate_type: 'Resource',
    aggregate_id: params.resourceId,
    event_data: { reason: 'compensation' }
  })
}
```

---

## Child Workflows

### When to Use Child Workflows

Use child workflows for:
- **Modular processes** that can be reused
- **Parallel execution** of independent tasks
- **Different retry policies** for sub-processes
- **Long-running sub-processes** that may outlive parent

### Starting a Child Workflow

```typescript
import { startChild, executeChild } from '@temporalio/workflow'

export async function ParentWorkflow(params: ParentParams) {
  // Option 1: Fire-and-forget (don't wait for completion)
  const childHandle = await startChild(ChildWorkflow, {
    workflowId: `child-${params.orgId}`,
    args: [{ orgId: params.orgId }]
  })

  console.log(`Started child workflow: ${childHandle.workflowId}`)

  // Option 2: Execute and wait for result
  const result = await executeChild(ChildWorkflow, {
    workflowId: `child-${params.orgId}`,
    args: [{ orgId: params.orgId }]
  })

  return result
}
```

### Parallel Child Workflows

```typescript
export async function BulkInviteWorkflow(params: { emails: string[] }) {
  const childHandles = await Promise.all(
    params.emails.map(email =>
      startChild(SendInvitationWorkflow, {
        workflowId: `invite-${email}`,
        args: [{ email }]
      })
    )
  )

  const results = await Promise.all(childHandles.map(h => h.result()))
  return { invitationsSent: results.filter(r => r.success).length }
}
```

### Child Workflow Patterns

**Fan-Out/Fan-In (Parallel)**:  Start multiple child workflows and collect results.

**Sequential**: Chain child workflows where each stage uses previous results.

---

## Durable State Management

### Workflow State Persists Across Replays

```typescript
export async function StatefulWorkflow(params) {
  // Workflow variables persist across replays
  let counter = 0
  const steps: string[] = []

  // Step 1
  await step1Activity()
  counter++
  steps.push('step1')

  // Step 2
  await step2Activity()
  counter++
  steps.push('step2')

  // After replay, counter = 2 and steps = ['step1', 'step2']
  // State is reconstructed from event history

  return { counter, steps }
}
```

### Using Signals and Queries

**Signals** for external updates (write):
```typescript
import { defineSignal, setHandler, condition } from '@temporalio/workflow'

const approvalSignal = defineSignal<[boolean]>('approval')

export async function ApprovalWorkflow(params) {
  let approved = false
  setHandler(approvalSignal, (isApproved: boolean) => { approved = isApproved })

  await condition(() => approved, '24 hours')
  if (!approved) throw new Error('Approval timeout')

  await provisionResourcesActivity(params)
  return { success: true }
}
```

**Queries** for external reads (read-only):
```typescript
import { defineQuery, setHandler } from '@temporalio/workflow'

const statusQuery = defineQuery<string>('status')

export async function LongRunningWorkflow(params) {
  let status = 'initializing'
  setHandler(statusQuery, () => status)

  status = 'creating-resources'
  await createResourcesActivity(params)

  status = 'complete'
  return { success: true }
}
```

---

## Complete Examples

### Example 1: Organization Bootstrap with Saga

```typescript
export async function BootstrapOrganizationWorkflow(params: BootstrapParams) {
  let orgId: string | undefined, dnsConfigured = false, dbProvisioned = false

  try {
    orgId = await createOrganizationActivity(params)

    await configureDNSActivity({ orgId, subdomain: params.subdomain })
    dnsConfigured = true

    const dnsVerified = await verifyDNSActivity({ subdomain: params.subdomain })

    await provisionDatabaseActivity({ orgId })
    dbProvisioned = true

    await sendInvitationsActivity({ orgId, adminEmail: params.adminEmail })

    return { orgId, subdomain: params.subdomain, dnsVerified, success: true }

  } catch (error) {
    // Compensation in reverse order
    if (dbProvisioned && orgId) await deprovisionDatabaseActivity({ orgId })
    if (dnsConfigured) await deleteDNSRecordActivity({ subdomain: params.subdomain })
    if (orgId) await deleteOrganizationActivity({ orgId })

    throw error
  }
}
```

### Example 2: Versioned Workflow

```typescript
import { proxyActivities, patched } from '@temporalio/workflow'
import type * as activities from '../../activities'

const { step1Activity, step2Activity, newStepActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes'
})

export async function EvolvingWorkflow(params) {
  // Original logic (all workflows)
  const result = await step1Activity(params)
  await step2Activity({ result })

  // Version 2: Added email notification
  if (patched('add-email-notification')) {
    await newStepActivity({ result })
  }

  return { result }
}
```

### Example 3: Parallel Processing with Child Workflows

```typescript
import { startChild } from '@temporalio/workflow'

export async function ProcessBatchWorkflow(params: { items: string[] }) {
  const childHandles = await Promise.all(
    params.items.map(item =>
      startChild(ProcessItemWorkflow, {
        workflowId: `process-${item}`,
        args: [{ item }]
      })
    )
  )

  const results = await Promise.all(childHandles.map(h => h.result()))
  return { total: params.items.length, successful: results.filter(r => r.success).length }
}
```

---

## Summary

✅ **Always maintain determinism** - use Temporal APIs for UUIDs, timers, conditions
✅ **Use patched() for versioning** - safely update workflows without breaking in-flight executions
✅ **Implement saga compensation** - rollback completed steps on failure in reverse order
✅ **Use child workflows** for modular, reusable, parallel processes
✅ **Leverage durable state** - workflow variables persist across replays
✅ **Use signals/queries** for external communication with running workflows

See [activity-best-practices.md](activity-best-practices.md) for activity implementation patterns.
