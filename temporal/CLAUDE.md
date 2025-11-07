# CLAUDE.md - Temporal Workflows Development

This file provides guidance to Claude Code when working with Temporal workflows, activities, and workers in the `temporal/` directory.

---

## Overview

The `temporal/` directory contains Temporal.io workflows, activities, and workers for orchestrating long-running business processes in the A4C Platform. This is a **Node.js/TypeScript project** using the Temporal SDK.

**Primary Use Cases**:
- Organization onboarding and bootstrap
- DNS subdomain provisioning (async with Cloudflare API)
- User invitation workflows
- SSO configuration (future)
- Scheduled reports and exports (future)

---

## Project Structure

```
temporal/
├── src/
│   ├── workflows/           # Workflow definitions (durable orchestration)
│   │   └── organization/    # Organization-related workflows
│   │       └── bootstrap-workflow.ts
│   ├── activities/          # Activity implementations (side effects)
│   │   └── organization/    # Organization-related activities
│   │       ├── create-organization.ts
│   │       ├── configure-dns.ts
│   │       ├── verify-dns.ts
│   │       ├── generate-invitations.ts
│   │       ├── send-invitation-emails.ts
│   │       ├── activate-organization.ts
│   │       └── compensation.ts
│   ├── workers/             # Worker startup and configuration
│   │   └── index.ts         # Main worker entry point
│   ├── shared/              # Shared types and utilities
│   │   ├── types.ts         # TypeScript interfaces
│   │   └── utils.ts         # Helper functions
│   └── tests/               # Workflow replay tests
│       └── organization/
├── package.json
├── tsconfig.json
├── Dockerfile               # Worker container image
├── .dockerignore
├── README.md                # User-facing documentation
└── CLAUDE.md                # This file (development guidance)
```

---

## Key Concepts

### Workflow-First Architecture

**Pattern**: Workflows orchestrate all steps; activities perform side effects and emit events.

- **Workflows** = Orchestration logic (what to do, when to do it)
  - Deterministic (no side effects, no randomness)
  - Durable (survive crashes and restarts)
  - Versioned (safe updates with `patched()`)

- **Activities** = Side effects (I/O, API calls, database writes)
  - Retryable (configurable retry policies)
  - Idempotent (safe to retry without duplicating effects)
  - Event-emitting (all state changes recorded as domain events)

### Event-Driven Activities

**Critical**: Every activity that changes state MUST emit a domain event to the `domain_events` table in Supabase.

**Pattern**:
```typescript
export async function myActivity(params) {
  // 1. Perform side effect
  const result = await externalAPI.doSomething(params)

  // 2. Emit domain event
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

  // 3. Return result
  return result
}
```

**Why Event-Driven?**:
- CQRS: Events are source of truth, projections are derived
- Audit trail: HIPAA requires 7-year event retention
- Traceability: Link events back to originating workflow
- Recovery: Rebuild projections from event stream

---

## Development Workflow

### Local Development

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Port-Forward Temporal Frontend**
   ```bash
   kubectl port-forward -n temporal svc/temporal-frontend 7233:7233
   ```

3. **Set Environment Variables**
   ```bash
   export TEMPORAL_ADDRESS=localhost:7233
   export TEMPORAL_NAMESPACE=default
   export TEMPORAL_TASK_QUEUE=bootstrap
   export SUPABASE_URL=https://your-project.supabase.co
   export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   export CLOUDFLARE_API_TOKEN=your-cloudflare-token
   ```

4. **Run Worker (Development Mode)**
   ```bash
   npm run dev
   ```

5. **Trigger Workflow (Separate Terminal)**
   ```bash
   npm run trigger-workflow
   ```

### Building for Production

```bash
# Build TypeScript
npm run build

# Build Docker image
docker build -t a4c-temporal-worker:v1.0.0 .

# Push to registry
docker push registry.example.com/a4c-temporal-worker:v1.0.0
```

### Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test -- bootstrap-workflow.test.ts

# Run tests in watch mode
npm run test:watch
```

---

## Temporal Infrastructure

### Operational Deployment

**Cluster**: Kubernetes (k3s)
**Namespace**: `temporal`
**Deployed**: 2025-10-17

**Connection Details**:
- **Temporal Frontend**: `temporal-frontend.temporal.svc.cluster.local:7233`
- **Temporal Web UI**: `temporal-web:8080` (port-forward to access)
- **Namespace**: `default`
- **Task Queue**: `bootstrap`

### Accessing Temporal Web UI

```bash
# Port-forward Web UI
kubectl port-forward -n temporal svc/temporal-web 8080:8080

# Open in browser
open http://localhost:8080
```

**Web UI Features**:
- View running/completed/failed workflows
- Inspect workflow history and events
- Replay workflows for debugging
- Query workflow state
- Manually terminate stuck workflows

---

## Writing Workflows

### Workflow File Location

Place workflows in: `src/workflows/{category}/{workflow-name}.ts`

Example: `src/workflows/organization/bootstrap-workflow.ts`

### Workflow Template

```typescript
// File: src/workflows/organization/my-workflow.ts

import { proxyActivities, sleep } from '@temporalio/workflow'
import type * as activities from '../../activities/organization'

// Proxy activities with retry policies
const {
  myActivity
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    maximumAttempts: 3
  }
})

export interface MyWorkflowParams {
  // Define workflow input parameters
}

export interface MyWorkflowResult {
  // Define workflow output
}

export async function MyWorkflow(
  params: MyWorkflowParams
): Promise<MyWorkflowResult> {
  // Track state for compensation
  let resourceCreated = false

  try {
    // Step 1: Execute activity
    const result = await myActivity(params)
    resourceCreated = true

    // Step 2: Durable sleep (if needed)
    await sleep('5 minutes')

    // Step 3: More activities...

    return { success: true, result }

  } catch (error) {
    // Compensation: Rollback completed steps
    if (resourceCreated) {
      await myCompensationActivity()
    }

    throw error
  }
}
```

### Workflow Best Practices

1. **Determinism**: Workflows must be deterministic
   - ❌ DON'T use `Math.random()`, `Date.now()`, or any non-deterministic functions
   - ✅ DO use Temporal's `uuid4()`, `sleep()`, and other workflow APIs

2. **No Side Effects**: Workflows should not perform I/O
   - ❌ DON'T call APIs, databases, or external services directly
   - ✅ DO delegate side effects to activities

3. **Saga Pattern**: Implement compensation for rollback
   - Track which steps completed successfully
   - Rollback in reverse order on failure
   - Handle compensation failures gracefully

4. **Logging**: Use `console.log()` for workflow logging
   - Logs appear in workflow history
   - Useful for debugging and observability

---

## Writing Activities

### Activity File Location

Place activities in: `src/activities/{category}/{activity-name}.ts`

Example: `src/activities/organization/create-organization.ts`

### Activity Template

```typescript
// File: src/activities/organization/my-activity.ts

import { Context } from '@temporalio/activity'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface MyActivityParams {
  // Define activity input parameters
}

export async function myActivity(
  params: MyActivityParams
): Promise<string> {

  // 1. Perform side effect (API call, database operation)
  const result = await externalAPI.doSomething(params)

  // 2. Emit domain event
  const workflowInfo = Context.current().info

  const { error: eventError } = await supabase
    .from('domain_events')
    .insert({
      event_type: 'SomethingHappened',
      aggregate_type: 'MyAggregate',
      aggregate_id: result.id,
      event_data: {
        // Include relevant data
        ...result
      },
      metadata: {
        workflow_id: workflowInfo.workflowId,
        workflow_run_id: workflowInfo.runId,
        workflow_type: workflowInfo.workflowType,
        activity_id: workflowInfo.activityId
      }
    })

  if (eventError) {
    throw new Error(`Failed to emit event: ${eventError.message}`)
  }

  console.log(`[ACTIVITY] Emitted SomethingHappened event for: ${result.id}`)

  // 3. Return result
  return result.id
}
```

### Activity Best Practices

1. **Idempotency**: Activities should be safe to retry
   - Check if operation already completed before executing
   - Use idempotency keys when calling external APIs

2. **Event Emission**: Always emit domain events for state changes
   - Include workflow metadata for traceability
   - Fail activity if event emission fails

3. **Error Handling**: Throw descriptive errors
   - Enrich errors with context (params, state)
   - Use `ApplicationFailure` for non-retryable errors

4. **Logging**: Log activity execution
   - Log start, completion, errors
   - Include relevant context (IDs, params)

---

## Error Handling

### Retry Policies

Configure retry policies per activity:

```typescript
// More retries for external APIs
const { configureDNSActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '5s',
    backoffCoefficient: 2,
    maximumInterval: '2 minutes',
    maximumAttempts: 5
  }
})

// Fewer retries for validation
const { validateInputActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30s',
  retry: {
    maximumAttempts: 1  // No retries
  }
})
```

### Non-Retryable Errors

Use `ApplicationFailure` for errors that shouldn't be retried:

```typescript
import { ApplicationFailure } from '@temporalio/common'

export async function validateOrgData(params) {
  if (!params.name) {
    throw ApplicationFailure.create({
      message: 'Organization name is required',
      nonRetryable: true,
      details: [{ field: 'name', error: 'required' }]
    })
  }
}
```

### Compensation

Implement compensation for rollback:

```typescript
export async function MyWorkflow(params) {
  let resourceId: string

  try {
    resourceId = await createResourceActivity(params)
    await configureResourceActivity({ resourceId })
    return { resourceId }

  } catch (error) {
    // Compensation: Clean up created resource
    if (resourceId) {
      await deleteResourceActivity({ resourceId })
    }
    throw error
  }
}
```

---

## Testing

### Unit Tests for Activities

```typescript
// File: src/activities/organization/__tests__/my-activity.test.ts

import { myActivity } from '../my-activity'
import { createClient } from '@supabase/supabase-js'

jest.mock('@supabase/supabase-js')

describe('myActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should emit domain event', async () => {
    const mockSupabase = {
      from: jest.fn().mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: null })
      })
    }
    ;(createClient as jest.Mock).mockReturnValue(mockSupabase)

    const result = await myActivity({ orgId: 'test-uuid' })

    expect(mockSupabase.from).toHaveBeenCalledWith('domain_events')
    expect(result).toBeDefined()
  })
})
```

### Workflow Replay Tests

```typescript
// File: src/workflows/organization/__tests__/my-workflow.test.ts

import { TestWorkflowEnvironment } from '@temporalio/testing'
import { Worker } from '@temporalio/worker'
import { MyWorkflow } from '../my-workflow'
import * as activities from '../../../activities/organization'

describe('MyWorkflow', () => {
  let testEnv: TestWorkflowEnvironment

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createLocal()
  })

  afterAll(async () => {
    await testEnv?.teardown()
  })

  it('should complete successfully', async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: 'test',
      workflowsPath: require.resolve('../my-workflow'),
      activities
    })

    await worker.runUntil(async () => {
      const result = await testEnv.client.workflow.execute(MyWorkflow, {
        workflowId: 'test-' + Date.now(),
        taskQueue: 'test',
        args: [{ /* params */ }]
      })

      expect(result.success).toBe(true)
    })
  })
})
```

---

## Common Tasks

### Adding a New Workflow

1. **Create workflow file**: `src/workflows/{category}/{name}-workflow.ts`
2. **Define interfaces**: `*Params`, `*Result`
3. **Implement workflow logic** with saga pattern
4. **Export workflow function**
5. **Add tests**: `src/workflows/{category}/__tests__/{name}-workflow.test.ts`
6. **Update worker**: Register workflow in `src/workers/index.ts`
7. **Document**: Add to `.plans/temporal-integration/`

### Adding a New Activity

1. **Create activity file**: `src/activities/{category}/{name}.ts`
2. **Define interfaces**: `*Params`, return type
3. **Implement activity logic**:
   - Perform side effect
   - Emit domain event
   - Return result
4. **Add tests**: `src/activities/{category}/__tests__/{name}.test.ts`
5. **Export from index**: `src/activities/{category}/index.ts`
6. **Use in workflows**: Import and proxy activities

### Modifying Existing Workflow

**IMPORTANT**: Use versioning to avoid breaking in-flight workflows!

```typescript
import { patched } from '@temporalio/workflow'

export async function MyWorkflow(params) {
  // Original logic (version 1)
  const result = await oldActivity(params)

  // New logic (version 2)
  if (patched('add-new-step')) {
    await newActivity(result)
  }

  return result
}
```

**Deployment Steps**:
1. Add new logic with `patched('version-name')`
2. Deploy worker
3. New workflows use new logic
4. Wait for all old workflows to complete
5. Remove `patched()` block after old workflows finish

---

## Environment Variables

Required environment variables for workers:

```bash
# Temporal connection
TEMPORAL_ADDRESS=temporal-frontend.temporal.svc.cluster.local:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=bootstrap

# Supabase connection (service role for admin operations)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Cloudflare API (for DNS operations)
CLOUDFLARE_API_TOKEN=your-cloudflare-token
CLOUDFLARE_ZONE_ID=your-zone-id  # Optional, can query by domain

# Email service (SMTP or transactional API)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password

# Application settings
NODE_ENV=production
LOG_LEVEL=info
```

**Kubernetes Secrets**:
```bash
# View secrets
kubectl get secret temporal-worker-secrets -n temporal -o yaml

# Edit secrets
kubectl edit secret temporal-worker-secrets -n temporal
```

---

## Debugging

### Debug Workflow Execution

1. **View in Temporal Web UI**:
   ```bash
   kubectl port-forward -n temporal svc/temporal-web 8080:8080
   open http://localhost:8080
   ```

2. **Search for workflow by ID or type**

3. **View execution history**: See all activities, timers, events

4. **Replay workflow**: Test with modified code locally

### Debug Activity Failures

1. **Check activity logs**:
   ```bash
   kubectl logs -n temporal deployment/temporal-worker -f
   ```

2. **View error details in Temporal Web UI**:
   - Navigate to workflow execution
   - Click on failed activity
   - View stack trace and error message

3. **Test activity in isolation**:
   ```bash
   npm test -- my-activity.test.ts
   ```

### Common Issues

**Issue**: Activities not registering with worker
- **Solution**: Ensure activity is exported from `src/activities/{category}/index.ts`
- Check worker logs for registration errors

**Issue**: Workflow fails with "activity not found"
- **Solution**: Verify activity is proxied correctly in workflow
- Check activity import path

**Issue**: Event emission fails
- **Solution**: Check Supabase service role key permissions
- Verify `domain_events` table exists and has correct schema

**Issue**: DNS verification timeout
- **Solution**: Increase DNS propagation wait time
- Check Cloudflare API for DNS record creation success

---

## Deployment

### Build and Deploy Worker

```bash
# Build Docker image
npm run build
docker build -t a4c-temporal-worker:v1.0.0 .

# Push to registry
docker push registry.example.com/a4c-temporal-worker:v1.0.0

# Update deployment
kubectl set image deployment/temporal-worker \
  worker=registry.example.com/a4c-temporal-worker:v1.0.0 \
  -n temporal

# Monitor rollout
kubectl rollout status deployment/temporal-worker -n temporal
```

### Verify Deployment

```bash
# Check worker pods
kubectl get pods -n temporal -l app=temporal-worker

# View worker logs
kubectl logs -n temporal -l app=temporal-worker -f

# Trigger test workflow
npm run trigger-workflow
```

---

## Related Documentation

- **Temporal Integration Overview**: `.plans/temporal-integration/overview.md`
- **Organization Onboarding Workflow**: `.plans/temporal-integration/organization-onboarding-workflow.md`
- **Activities Reference**: `.plans/temporal-integration/activities-reference.md`
- **Error Handling**: `.plans/temporal-integration/error-handling-and-compensation.md`
- **Kubernetes Deployment**: `infrastructure/k8s/temporal/README.md`
- **Supabase Auth Integration**: `.plans/supabase-auth-integration/overview.md`

---

## Quick Reference

### Start Worker Locally
```bash
kubectl port-forward -n temporal svc/temporal-frontend 7233:7233
TEMPORAL_ADDRESS=localhost:7233 npm run worker
```

### Trigger Workflow
```bash
npm run trigger-workflow
```

### View Workflows
```bash
kubectl port-forward -n temporal svc/temporal-web 8080:8080
open http://localhost:8080
```

### Run Tests
```bash
npm test
```

### Build Production
```bash
npm run build
docker build -t a4c-temporal-worker:latest .
```

---

**Last Updated**: 2025-10-24
**Status**: Complete Development Guide
