# Error Handling and Compensation - Temporal Patterns

**Status**: ✅ Complete error handling guide
**Purpose**: Patterns for resilient workflow execution and rollback
**Pattern**: Saga pattern with automatic compensation

---

## Table of Contents

1. [Overview](#overview)
2. [Temporal Error Handling Basics](#temporal-error-handling-basics)
3. [Retry Policies](#retry-policies)
4. [Saga Pattern for Compensation](#saga-pattern-for-compensation)
5. [Error Classification](#error-classification)
6. [Workflow-Level Error Handling](#workflow-level-error-handling)
7. [Activity-Level Error Handling](#activity-level-error-handling)
8. [Compensation Strategies](#compensation-strategies)
9. [Monitoring and Alerting](#monitoring-and-alerting)

---

## Overview

Temporal provides built-in error handling and retry mechanisms, but applications must design proper compensation logic for partial failures. The A4C Platform uses the **Saga pattern** to ensure consistent state even when workflows fail midway through execution.

**Key Concepts**:
- **Retries**: Temporal automatically retries failed activities with exponential backoff
- **Compensation**: Rollback completed steps when workflow fails
- **Idempotency**: Activities can be retried safely without side effects
- **Event-driven**: All state changes are recorded, enabling audit and recovery

---

## Temporal Error Handling Basics

### Error Propagation

```typescript
// Activity throws error
export async function myActivity() {
  throw new Error('Something went wrong')
}

// Temporal automatically:
// 1. Catches error
// 2. Records in workflow history
// 3. Applies retry policy
// 4. If retries exhausted, propagates to workflow
```

### Error Types

| Error Type | Behavior | Retryable |
|------------|----------|-----------|
| **ApplicationError** | Business logic error | Configurable |
| **TemporalFailure** | Temporal system error | No |
| **CancelledError** | Workflow/activity cancelled | No |
| **TimeoutError** | Activity exceeded timeout | Yes (if retries remain) |

### ApplicationError for Controlled Failures

```typescript
import { ApplicationFailure } from '@temporalio/common'

export async function validateOrgData(params) {
  if (!params.name) {
    // Non-retryable business logic error
    throw ApplicationFailure.create({
      message: 'Organization name is required',
      nonRetryable: true,
      details: [{ field: 'name', error: 'required' }]
    })
  }

  // Retryable external API error
  try {
    await externalAPI.validate(params)
  } catch (error) {
    throw ApplicationFailure.create({
      message: 'External validation failed',
      nonRetryable: false,  // Retryable
      cause: error
    })
  }
}
```

---

## Retry Policies

### Default Retry Policy

```typescript
const activities = proxyActivities<typeof activitiesModule>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    maximumAttempts: 3
  }
})
```

**Retry Schedule**:
- Attempt 1: Immediate
- Attempt 2: +1s delay
- Attempt 3: +2s delay
- Attempt 4: +4s delay (fails if maximumAttempts=3)

### Per-Activity Retry Policies

```typescript
// DNS operations: More retries, longer intervals
const { configureDNSActivity } = proxyActivities<typeof activitiesModule>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '5s',
    backoffCoefficient: 2,
    maximumInterval: '2 minutes',
    maximumAttempts: 5
  }
})

// Email operations: Fewer retries, shorter intervals
const { sendEmailActivity } = proxyActivities<typeof activitiesModule>({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '500ms',
    backoffCoefficient: 2,
    maximumInterval: '10s',
    maximumAttempts: 2
  }
})
```

### Conditional Retries

```typescript
const activities = proxyActivities<typeof activitiesModule>({
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumAttempts: 3,
    nonRetryableErrorTypes: [
      'ValidationError',      // Don't retry validation failures
      'AuthenticationError',  // Don't retry auth failures
      'QuotaExceededError'    // Don't retry quota errors
    ]
  }
})
```

### No Retry Policy

```typescript
// For activities that should fail fast
const { validateInputActivity } = proxyActivities<typeof activitiesModule>({
  startToCloseTimeout: '30s',
  retry: {
    maximumAttempts: 1  // No retries
  }
})
```

---

## Saga Pattern for Compensation

The Saga pattern ensures that when a workflow fails, all completed steps are rolled back to maintain consistency.

### Basic Saga Implementation

```typescript
export async function OrganizationBootstrapWorkflow(params) {
  let orgCreated = false
  let dnsConfigured = false
  let invitationsSent = false

  let orgId: string
  let dnsRecordId: string

  try {
    // Step 1: Create organization
    orgId = await activities.createOrganizationActivity(params.orgData)
    orgCreated = true

    // Step 2: Configure DNS
    const dns = await activities.configureDNSActivity({
      orgId,
      subdomain: params.subdomain
    })
    dnsRecordId = dns.recordId
    dnsConfigured = true

    // Step 3: Send invitations
    await activities.sendInvitationsActivity({ orgId, users: params.users })
    invitationsSent = true

    return { orgId, success: true }

  } catch (error) {
    // ========================================
    // COMPENSATION: Rollback in reverse order
    // ========================================

    if (invitationsSent) {
      // NOTE: Email invitations can't be "unsent"
      // Instead, mark them as cancelled in projection
      await activities.cancelInvitationsActivity({ orgId })
    }

    if (dnsConfigured) {
      await activities.removeDNSActivity({ subdomain: params.subdomain })
    }

    if (orgCreated) {
      await activities.deactivateOrganizationActivity({ orgId })
    }

    throw error  // Re-throw for Temporal to record
  }
}
```

### Advanced Saga with Compensation Log

Track compensation steps for observability:

```typescript
export async function OrganizationBootstrapWorkflow(params) {
  const compensations: Array<() => Promise<void>> = []

  try {
    // Step 1: Create organization
    const orgId = await activities.createOrganizationActivity(params.orgData)
    compensations.push(() =>
      activities.deactivateOrganizationActivity({ orgId })
    )

    // Step 2: Configure DNS
    await activities.configureDNSActivity({ orgId, subdomain: params.subdomain })
    compensations.push(() =>
      activities.removeDNSActivity({ subdomain: params.subdomain })
    )

    // Step 3: Send invitations
    await activities.sendInvitationsActivity({ orgId, users: params.users })
    compensations.push(() =>
      activities.cancelInvitationsActivity({ orgId })
    )

    return { orgId, success: true }

  } catch (error) {
    // Execute compensations in reverse order
    for (let i = compensations.length - 1; i >= 0; i--) {
      try {
        await compensations[i]()
      } catch (compensationError) {
        console.error(`Compensation ${i} failed:`, compensationError)
        // Continue with other compensations
      }
    }

    throw error
  }
}
```

---

## Error Classification

### Transient Errors (Retryable)

Errors that may succeed on retry:

```typescript
class TransientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransientError'
  }
}

// Examples:
// - Network timeouts
// - Rate limiting (429 Too Many Requests)
// - Database connection errors
// - External API temporary unavailability

export async function myActivity() {
  try {
    return await externalAPI.call()
  } catch (error) {
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
      throw new TransientError(`API temporarily unavailable: ${error.message}`)
    }
    throw error
  }
}
```

### Permanent Errors (Non-Retryable)

Errors that will never succeed on retry:

```typescript
import { ApplicationFailure } from '@temporalio/common'

// Examples:
// - Validation errors
// - Authorization errors
// - Resource not found
// - Quota exceeded

export async function myActivity(params) {
  if (!params.orgId) {
    throw ApplicationFailure.create({
      message: 'Organization ID is required',
      nonRetryable: true
    })
  }

  const org = await db.findOrg(params.orgId)
  if (!org) {
    throw ApplicationFailure.create({
      message: `Organization not found: ${params.orgId}`,
      nonRetryable: true
    })
  }
}
```

### Partial Errors (Retryable with Backoff)

Errors where some operations succeeded:

```typescript
export async function sendBatchEmailsActivity(params) {
  const results = { successCount: 0, failures: [] }

  for (const email of params.emails) {
    try {
      await sendEmail(email)
      results.successCount++
    } catch (error) {
      results.failures.push({ email: email.to, error: error.message })
    }
  }

  // Fail only if ALL failed (allows retry)
  if (results.successCount === 0) {
    throw new Error('All emails failed to send')
  }

  // Return partial success for logging
  return results
}
```

---

## Workflow-Level Error Handling

### Try-Catch with Structured Errors

```typescript
export async function OrganizationBootstrapWorkflow(params) {
  try {
    const orgId = await activities.createOrganizationActivity(params.orgData)
    return { orgId, success: true }

  } catch (error) {
    if (error instanceof ApplicationFailure) {
      // Business logic error
      return {
        success: false,
        error: error.message,
        details: error.details
      }
    }

    if (error instanceof CancelledError) {
      // Workflow cancelled by user
      console.log('[WORKFLOW] Cancelled by user')
      throw error
    }

    // Unknown error - re-throw for Temporal to handle
    throw error
  }
}
```

### Timeout Handling

```typescript
import { setWorkflowTimeout } from '@temporalio/workflow'

export async function OrganizationBootstrapWorkflow(params) {
  // Set overall workflow timeout (max 1 hour)
  setWorkflowTimeout('1 hour')

  try {
    // Long-running operation with custom timeout
    const dns = await activities.configureDNSActivity(params)

    // Wait for DNS with timeout
    const maxWait = 30 * 60 * 1000  // 30 minutes
    const startTime = Date.now()

    while (Date.now() - startTime < maxWait) {
      try {
        await activities.verifyDNSActivity({ domain: dns.fqdn })
        break  // Success
      } catch (error) {
        if (Date.now() - startTime >= maxWait) {
          throw new Error('DNS verification timeout after 30 minutes')
        }
        await sleep(5 * 60 * 1000)  // Retry in 5 minutes
      }
    }

  } catch (error) {
    console.error('[WORKFLOW] Error:', error)
    throw error
  }
}
```

### Conditional Error Handling

```typescript
export async function OrganizationBootstrapWorkflow(params) {
  try {
    const orgId = await activities.createOrganizationActivity(params.orgData)
    return { orgId }

  } catch (error) {
    // If organization already exists, return existing ID
    if (error.message.includes('already exists')) {
      const existing = await activities.findOrganizationBySubdomainActivity({
        subdomain: params.subdomain
      })
      return { orgId: existing.id, alreadyExists: true }
    }

    // Otherwise, re-throw
    throw error
  }
}
```

---

## Activity-Level Error Handling

### Enriching Error Context

```typescript
export async function configureDNSActivity(params) {
  try {
    const result = await cloudflare.dns.records.create(/* ... */)
    return result

  } catch (error) {
    // Enrich error with activity context
    const enrichedError = new Error(
      `Failed to configure DNS for subdomain "${params.subdomain}": ${error.message}`
    )
    enrichedError.cause = error  // Preserve original error

    // Add custom properties for debugging
    ;(enrichedError as any).context = {
      subdomain: params.subdomain,
      orgId: params.orgId,
      cloudflareZone: process.env.CLOUDFLARE_ZONE_ID
    }

    throw enrichedError
  }
}
```

### Rate Limiting Handling

```typescript
export async function callExternalAPIActivity(params) {
  try {
    return await externalAPI.call(params)

  } catch (error) {
    // Detect rate limiting
    if (error.statusCode === 429) {
      const retryAfter = error.headers['retry-after'] || '60'
      throw ApplicationFailure.create({
        message: `Rate limited, retry after ${retryAfter}s`,
        nonRetryable: false,  // Allow retry
        details: [{ retryAfter: parseInt(retryAfter) }]
      })
    }

    throw error
  }
}
```

### Graceful Degradation

```typescript
export async function enrichOrganizationDataActivity(params) {
  let enrichedData = { ...params }

  // Try to enrich with external data (optional)
  try {
    const externalData = await externalAPI.getOrgData(params.name)
    enrichedData = { ...enrichedData, ...externalData }
  } catch (error) {
    // Log but don't fail - enrichment is optional
    console.warn('[ACTIVITY] Failed to enrich org data:', error)
  }

  return enrichedData
}
```

---

## Compensation Strategies

### Strategy 1: Immediate Compensation

Compensate as soon as an error occurs:

```typescript
export async function MyWorkflow(params) {
  let resourceCreated = false
  let resourceId: string

  try {
    resourceId = await activities.createResource(params)
    resourceCreated = true

    await activities.configureResource({ resourceId })
    return { resourceId }

  } catch (error) {
    // Immediate compensation
    if (resourceCreated) {
      await activities.deleteResource({ resourceId })
    }
    throw error
  }
}
```

### Strategy 2: Deferred Compensation

Mark resources for cleanup instead of deleting immediately:

```typescript
export async function MyWorkflow(params) {
  try {
    const orgId = await activities.createOrganizationActivity(params)
    // ... workflow steps ...
    return { orgId }

  } catch (error) {
    // Mark for cleanup instead of immediate deletion
    await activities.markOrganizationForCleanupActivity({ orgId })

    // Separate cleanup workflow runs periodically
    // to delete marked resources
    throw error
  }
}
```

### Strategy 3: Partial Compensation

Some resources can't be fully rolled back:

```typescript
export async function OrganizationBootstrapWorkflow(params) {
  try {
    const orgId = await activities.createOrganizationActivity(params)
    await activities.sendInvitationsActivity({ orgId, users: params.users })
    return { orgId }

  } catch (error) {
    // Can't "unsend" emails, but can mark invitations as cancelled
    await activities.cancelInvitationsActivity({ orgId })

    // Deactivate org (soft delete)
    await activities.deactivateOrganizationActivity({ orgId })

    throw error
  }
}
```

### Strategy 4: Compensation with Audit

Log all compensation actions for compliance:

```typescript
export async function MyWorkflow(params) {
  try {
    // ... workflow steps ...
  } catch (error) {
    // Log compensation start
    await activities.logCompensationStartActivity({
      workflowId: workflowInfo.workflowId,
      error: error.message
    })

    // Execute compensation
    await activities.compensateStep1()
    await activities.compensateStep2()

    // Log compensation complete
    await activities.logCompensationCompleteActivity({
      workflowId: workflowInfo.workflowId
    })

    throw error
  }
}
```

---

## Monitoring and Alerting

### Workflow Failure Metrics

```typescript
const metrics = {
  'workflow.failed': counter,
  'workflow.compensation.executed': counter,
  'workflow.compensation.failed': counter,
  'activity.retry.count': histogram,
  'activity.permanent_failure': counter
}
```

### Alert Rules

```yaml
alerts:
  - name: Workflow Failure Rate High
    condition: workflow.failed / workflow.started > 0.1
    duration: 5m
    severity: warning
    action: page_oncall

  - name: Compensation Execution
    condition: workflow.compensation.executed > 0
    severity: info
    action: log_and_notify

  - name: Compensation Failed
    condition: workflow.compensation.failed > 0
    severity: critical
    action: page_oncall

  - name: Activity Permanent Failure
    condition: activity.permanent_failure > 5
    duration: 10m
    severity: warning
    action: notify_team
```

### Logging Best Practices

```typescript
export async function MyWorkflow(params) {
  console.log('[WORKFLOW] Started:', { workflowId, params })

  try {
    const result = await activities.step1(params)
    console.log('[WORKFLOW] Step 1 completed:', result)

    const result2 = await activities.step2(result)
    console.log('[WORKFLOW] Step 2 completed:', result2)

    return { success: true }

  } catch (error) {
    console.error('[WORKFLOW] Error at step:', error)
    console.log('[WORKFLOW] Starting compensation...')

    try {
      await compensate()
      console.log('[WORKFLOW] Compensation completed')
    } catch (compensationError) {
      console.error('[WORKFLOW] Compensation failed:', compensationError)
    }

    throw error
  }
}
```

---

## Testing Error Scenarios

### Unit Test: Activity Retry

```typescript
describe('configureDNSActivity', () => {
  it('should retry on transient error', async () => {
    let attempts = 0

    const mockCloudflare = {
      dns: {
        records: {
          create: jest.fn().mockImplementation(() => {
            attempts++
            if (attempts < 3) {
              throw new Error('Network timeout')
            }
            return { result: { id: 'record-id' } }
          })
        }
      }
    }

    const result = await configureDNSActivity(params)
    expect(attempts).toBe(3)
    expect(result.recordId).toBe('record-id')
  })
})
```

### Integration Test: Workflow Compensation

```typescript
describe('OrganizationBootstrapWorkflow', () => {
  it('should compensate on DNS failure', async () => {
    // Mock DNS activity to fail
    const mockActivities = {
      createOrganizationActivity: jest.fn().mockResolvedValue('org-123'),
      configureDNSActivity: jest.fn().mockRejectedValue(new Error('DNS failed')),
      deactivateOrganizationActivity: jest.fn().mockResolvedValue(undefined)
    }

    await expect(
      testWorkflow(OrganizationBootstrapWorkflow, params, mockActivities)
    ).rejects.toThrow('DNS failed')

    // Verify compensation was called
    expect(mockActivities.deactivateOrganizationActivity)
      .toHaveBeenCalledWith({ orgId: 'org-123' })
  })
})
```

---

## Related Documentation

- **Temporal Integration Overview**: `overview.md`
- **Organization Onboarding Workflow**: `organization-onboarding-workflow.md`
- **Activities Reference**: `activities-reference.md`

---

**Document Version**: 1.0
**Last Updated**: 2025-10-24
**Status**: Complete Error Handling Guide
