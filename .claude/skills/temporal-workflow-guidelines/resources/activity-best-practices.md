# Activity Best Practices

This guide covers activity implementation patterns including idempotency, retry policies, error handling, timeouts, and integration with external systems in A4C-AppSuite Temporal workflows.

---

## Core Principles

**Activities perform all side effects** - API calls, database operations, email sending, file I/O.

**Activities must be**:
1. **Idempotent** - Safe to retry without duplicating effects
2. **Retryable** - Configured with appropriate retry policies
3. **Event-emitting** - Record state changes as domain events
4. **Well-timed** - Proper timeout configuration

---

## Idempotency Patterns

### Why Idempotency Matters

Temporal automatically retries failed activities. If activities aren't idempotent, retries will duplicate effects (e.g., sending emails twice, creating duplicate records).

### Pattern 1: Check-Then-Execute

Check if operation already completed before executing.

```typescript
export async function sendInvitationEmailActivity(params: EmailParams) {
  // Check if already sent
  const { data: existing } = await supabase
    .from('sent_emails')
    .select('id')
    .eq('idempotency_key', params.invitationId)
    .single()

  if (existing) {
    console.log(`Email already sent for invitation ${params.invitationId}`)
    return  // Skip duplicate send (idempotent)
  }

  // Send email
  await emailService.send({
    to: params.email,
    subject: params.subject,
    body: params.body
  })

  // Record send
  await supabase.from('sent_emails').insert({
    idempotency_key: params.invitationId,
    recipient: params.email,
    sent_at: new Date().toISOString()
  })

  // Emit event
  await emitDomainEvent('InvitationEmailSent', params.invitationId, params)
}
```

### Pattern 2: Upsert Instead of Insert

Use upsert operations for database writes.

```typescript
export async function createOrganizationActivity(params: CreateOrgParams) {
  // Upsert (idempotent) instead of insert
  const { data: org, error } = await supabase
    .from('organizations')
    .upsert({
      id: params.orgId,  // Use deterministic ID from workflow
      name: params.name,
      subdomain: params.subdomain
    }, { onConflict: 'id' })
    .select()
    .single()

  if (error) throw new Error(`Failed to create org: ${error.message}`)

  // Emit event (even on retry - projections handle duplicates)
  await emitDomainEvent('OrganizationCreated', org.id, { name: org.name })

  return org.id
}
```

### Pattern 3: External API with Idempotency Keys

Check for existing resources before creating.

```typescript
export async function provisionDNSActivity(params: DNSParams) {
  // Check if record already exists
  const existingRecords = await cloudflare.dns.records.list({
    zone_id: params.zoneId,
    name: `${params.subdomain}.${params.domain}`
  })

  if (existingRecords.length > 0) {
    console.log('DNS record already exists')
    return existingRecords[0].id
  }

  const record = await cloudflare.dns.records.create({
    zone_id: params.zoneId,
    type: 'CNAME',
    name: params.subdomain,
    content: params.target
  })

  await emitDomainEvent('DNSRecordCreated', params.orgId, { recordId: record.id })
  return record.id
}
```

### Pattern 4: Deterministic IDs from Workflow

Generate IDs in workflow (deterministic), use them in activities.

```typescript
// Workflow
export async function MyWorkflow(params) {
  const resourceId = uuid4()  // Deterministic UUID from Temporal

  await createResourceActivity({ id: resourceId, ...params })

  return { resourceId }
}

// Activity
export async function createResourceActivity(params: { id: string; name: string }) {
  // Use provided ID (idempotent - same ID on retry)
  const { data: resource } = await supabase
    .from('resources')
    .upsert({ id: params.id, name: params.name }, { onConflict: 'id' })
    .select()
    .single()

  await emitDomainEvent('ResourceCreated', params.id, { name: params.name })

  return params.id
}
```

---

## Retry Policies

### Default Retry Policy

Temporal's default retry policy:
- Initial interval: 1s
- Backoff coefficient: 2 (exponential backoff)
- Maximum interval: 100x initial interval
- Maximum attempts: Unlimited

### Configuring Retry Policies

Different activities need different retry strategies.

```typescript
// External API - aggressive retries with longer timeouts
const {
  configureDNSActivity,
  verifyDNSActivity
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '5s',
    backoffCoefficient: 2,
    maximumInterval: '2 minutes',
    maximumAttempts: 5
  }
})

// Validation - no retries (fail fast)
const { validateInputActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30s',
  retry: {
    maximumAttempts: 1  // No retries
  }
})

// Database writes - moderate retries
const {
  createOrgActivity,
  updateOrgActivity
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    maximumAttempts: 3
  }
})

// Email sending - longer backoff for rate limiting
const { sendEmailActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '10s',
    backoffCoefficient: 3,
    maximumInterval: '5 minutes',
    maximumAttempts: 4
  }
})
```

### Retry Policy Guidelines

**External APIs** (DNS, email, payment processors):
- ✅ Long timeout (5-10 minutes)
- ✅ Aggressive retries (5+ attempts)
- ✅ Exponential backoff

**Database operations**:
- ✅ Moderate timeout (2-5 minutes)
- ✅ Few retries (3 attempts)
- ✅ Short backoff

**Validation/checks**:
- ✅ Short timeout (30s - 1 minute)
- ✅ No retries (fail fast)

**Rate-limited APIs**:
- ✅ Long backoff intervals
- ✅ High backoff coefficient (3+)

---

## Error Handling

### Retryable vs Non-Retryable Errors

**Retryable errors** (let Temporal retry):
- Network timeouts
- Temporary API failures (5xx errors)
- Database connection errors
- Rate limiting (429 errors)

**Non-retryable errors** (throw ApplicationFailure):
- Invalid input (400 errors)
- Authentication failures (401 errors)
- Resource not found (404 errors)
- Business logic violations

### Using ApplicationFailure

```typescript
import { ApplicationFailure } from '@temporalio/common'

export async function validateOrgDataActivity(params: ValidateParams) {
  // Validation errors are non-retryable
  if (!params.name) {
    throw ApplicationFailure.create({
      message: 'Organization name is required',
      nonRetryable: true,
      details: [{ field: 'name', error: 'required' }]
    })
  }

  if (params.subdomain.length < 3) {
    throw ApplicationFailure.create({
      message: 'Subdomain must be at least 3 characters',
      nonRetryable: true,
      details: [{ field: 'subdomain', error: 'min_length' }]
    })
  }

  // Check if subdomain already exists (non-retryable)
  const { data: existing } = await supabase
    .from('organizations')
    .select('id')
    .eq('subdomain', params.subdomain)
    .single()

  if (existing) {
    throw ApplicationFailure.create({
      message: 'Subdomain already in use',
      nonRetryable: true,
      details: [{ field: 'subdomain', error: 'duplicate' }]
    })
  }

  return { valid: true }
}
```

### Enriching Error Messages

Include context in error messages for debugging:

```typescript
export async function createOrgActivity(params: CreateOrgParams) {
  const { data: org, error } = await supabase
    .from('organizations')
    .insert({ name: params.name, subdomain: params.subdomain })
    .select()
    .single()

  if (error) {
    throw new Error(
      `Failed to create org "${params.name}" (subdomain: ${params.subdomain}): ${error.message}`
    )
  }

  await emitDomainEvent('OrganizationCreated', org.id, params)
  return org.id
}
```

### Handling Rate Limiting

```typescript
export async function callRateLimitedAPIActivity(params) {
  try {
    const response = await externalAPI.doSomething(params)
    return response.data

  } catch (error) {
    // Check for rate limiting
    if (error.response?.status === 429) {
      const retryAfter = error.response.headers['retry-after'] || 60

      // Throw retryable error with context
      throw new Error(
        `Rate limited - retry after ${retryAfter}s: ${error.message}`
      )
      // Temporal will retry with backoff
    }

    // Check for non-retryable client errors
    if (error.response?.status >= 400 && error.response?.status < 500) {
      throw ApplicationFailure.create({
        message: `Client error (${error.response.status}): ${error.message}`,
        nonRetryable: true
      })
    }

    // All other errors are retryable
    throw error
  }
}
```

---

## Timeout Configuration

### Timeout Types

**startToCloseTimeout**: Maximum duration from activity start to completion (most common).

**scheduleToCloseTimeout**: Maximum duration from scheduling to completion (includes queue time).

**scheduleToStartTimeout**: Maximum time activity can wait in queue before starting.

**heartbeatTimeout**: Maximum time between heartbeats for long-running activities.

### Setting Timeouts

```typescript
// Short timeout for quick operations
const { validateInputActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30s'
})

// Medium timeout for database operations
const { createRecordActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes'
})

// Long timeout for external APIs
const { configureDNSActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes'
})

// Very long timeout for async operations
const { verifyDNSPropagationActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes'
})
```

### Heartbeating for Long Activities

Send heartbeats for activities running longer than a few minutes.

```typescript
import { Context } from '@temporalio/activity'

export async function longRunningActivity(params) {
  const context = Context.current()

  for (let i = 0; i < params.iterations; i++) {
    await processChunk(i)
    context.heartbeat({ progress: i + 1, total: params.iterations })

    if (context.cancellationSignal.aborted) {
      throw new Error('Activity cancelled')
    }
  }

  return { processed: params.iterations }
}

// In workflow: heartbeatTimeout: '30s' - fail if no heartbeat for 30s
```

---

## Activity Context

### Accessing Workflow Information

Use `Context.current().info` to get workflow metadata for event emission.

```typescript
import { Context } from '@temporalio/activity'

export async function myActivity(params) {
  const activityInfo = Context.current().info

  console.log('Workflow ID:', activityInfo.workflowId)
  console.log('Run ID:', activityInfo.runId)
  console.log('Workflow Type:', activityInfo.workflowType)
  console.log('Activity ID:', activityInfo.activityId)

  // Use in event emission
  await supabase.from('domain_events').insert({
    event_type: 'SomethingHappened',
    aggregate_id: params.id,
    metadata: {
      workflow_id: activityInfo.workflowId,
      workflow_run_id: activityInfo.runId,
      workflow_type: activityInfo.workflowType,
      activity_id: activityInfo.activityId
    }
  })
}
```

### Cancellation Handling

```typescript
export async function cancellableActivity(params) {
  const { cancellationSignal } = Context.current()

  // Long-running operation
  for (let i = 0; i < 1000; i++) {
    // Check for cancellation
    if (cancellationSignal.aborted) {
      console.log('Activity cancelled, cleaning up...')
      await cleanup()
      throw new Error('Activity cancelled')
    }

    await processItem(i)
  }

  return { processed: 1000 }
}
```

---



---

## Summary

✅ **Make activities idempotent** - Use check-then-execute, upserts, or idempotency keys
✅ **Configure retry policies** - Match retry strategy to operation type  
✅ **Throw ApplicationFailure for non-retryable errors** - Validation and client errors should fail fast
✅ **Set appropriate timeouts** - Short for validation, long for external APIs
✅ **Always emit domain events** - Record all state changes for CQRS and audit trail
✅ **Enrich error messages** - Include context for debugging
✅ **Use heartbeats for long activities** - Prove liveness for operations >1 minute

See [event-emission.md](event-emission.md) for domain event patterns.
