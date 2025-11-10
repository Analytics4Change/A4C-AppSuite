# Testing Workflows

This guide covers testing strategies for Temporal workflows and activities including replay testing, activity mocking, local development setup, and debugging techniques.

---

## Local Development Setup

### Port-Forward Temporal Frontend

Temporal workers need to connect to the Temporal server running in Kubernetes.

```bash
# Port-forward Temporal frontend to localhost
kubectl port-forward -n temporal svc/temporal-frontend 7233:7233

# Keep this running in a separate terminal
```

### Set Environment Variables

```bash
# Temporal connection
export TEMPORAL_ADDRESS=localhost:7233
export TEMPORAL_NAMESPACE=default
export TEMPORAL_TASK_QUEUE=bootstrap

# Supabase (for activities)
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Other service credentials
export CLOUDFLARE_API_TOKEN=your-token
export SMTP_HOST=smtp.example.com
export SMTP_USER=your-user
export SMTP_PASS=your-pass
```

### Run Worker Locally

```bash
cd temporal
npm install
npm run dev  # Watches for changes and restarts worker
```

### Trigger a Workflow

```typescript
// scripts/trigger-workflow.ts
import { Client } from '@temporalio/client'
import { BootstrapOrganizationWorkflow } from './src/workflows/organization/bootstrap-workflow'

async function run() {
  const client = new Client({
    connection: {
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233'
    },
    namespace: process.env.TEMPORAL_NAMESPACE || 'default'
  })

  const handle = await client.workflow.start(BootstrapOrganizationWorkflow, {
    taskQueue: process.env.TEMPORAL_TASK_QUEUE || 'bootstrap',
    workflowId: `bootstrap-org-${Date.now()}`,
    args: [{
      organizationName: 'Test Organization',
      subdomain: 'test-org',
      adminEmail: 'admin@test-org.com'
    }]
  })

  console.log(`Started workflow: ${handle.workflowId}`)

  const result = await handle.result()
  console.log('Workflow completed:', result)
}

run().catch(console.error)
```

```bash
# Run trigger script
npm run trigger-workflow
```

---

## Workflow Replay Testing

### Why Replay Testing?

Temporal replays workflows from event history to reconstruct state. Replay tests verify that workflow code changes don't break existing workflows.

### Test Environment Setup

```typescript
import { TestWorkflowEnvironment } from '@temporalio/testing'
import { Worker } from '@temporalio/worker'

describe('BootstrapWorkflow', () => {
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
      workflowsPath: require.resolve('../organization/bootstrap-workflow'),
      activities
    })

    await worker.runUntil(async () => {
      const result = await testEnv.client.workflow.execute(BootstrapWorkflow, {
        workflowId: `test-${Date.now()}`,
        taskQueue: 'test',
        args: [{ organizationName: 'Test Org', subdomain: 'test-org' }]
      })

      expect(result.success).toBe(true)
      expect(result.orgId).toBeDefined()
    })
  })
})
```

### Running Replay Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- bootstrap-workflow.test.ts

# Run tests in watch mode
npm run test:watch
```

---

## Activity Mocking

### Why Mock Activities?

- Test workflow logic independently of external dependencies
- Fast test execution (no real API calls)
- Deterministic results (no network flakiness)

### Mocking Strategy

```typescript
describe('BootstrapWorkflow (Mocked)', () => {
  it('should handle failure with compensation', async () => {
    const mockActivities = {
      createOrganizationActivity: async () => 'mock-org-id',
      configureDNSActivity: async () => { throw new Error('DNS failed') },
      deleteOrganizationActivity: async () => { console.log('Compensated') }
    }

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: 'test',
      workflowsPath: require.resolve('../organization/bootstrap-workflow'),
      activities: mockActivities
    })

    await worker.runUntil(async () => {
      await expect(
        testEnv.client.workflow.execute(BootstrapWorkflow, {
          workflowId: `test-${Date.now()}`,
          taskQueue: 'test',
          args: [{ organizationName: 'Test', subdomain: 'test' }]
        })
      ).rejects.toThrow('DNS failed')
    })
  })
})
```

---

## Activity Unit Testing

### Testing Activities in Isolation

```typescript
import { createOrganizationActivity } from '../organization/create-organization'

jest.mock('@supabase/supabase-js')
jest.mock('@temporalio/activity')

describe('createOrganizationActivity', () => {
  it('should create organization and emit event', async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: { id: 'org-123', name: 'Test Org', subdomain: 'test-org' },
      error: null
    })

    const result = await createOrganizationActivity({
      id: 'org-123',
      name: 'Test Org',
      subdomain: 'test-org'
    })

    expect(result).toBe('org-123')
    expect(mockSupabase.from).toHaveBeenCalledWith('organizations')
    expect(mockSupabase.from).toHaveBeenCalledWith('domain_events')
  })

  it('should throw error if creation fails', async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Duplicate subdomain' }
    })

    await expect(
      createOrganizationActivity({ id: 'org-123', name: 'Test', subdomain: 'test' })
    ).rejects.toThrow('Failed to create org')
  })
})
```

---

## Testing Event Emission

### Verify Events in Database

```typescript
// Integration test - verify events are actually emitted
describe('Event Emission Integration', () => {
  it('should emit OrganizationCreated event', async () => {
    const orgId = await createOrganizationActivity({
      id: uuid(),
      name: 'Test Org',
      subdomain: 'test-org'
    })

    // Query domain_events table
    const { data: events } = await supabase
      .from('domain_events')
      .select('*')
      .eq('aggregate_type', 'Organization')
      .eq('aggregate_id', orgId)
      .eq('event_type', 'OrganizationCreated')

    expect(events).toHaveLength(1)
    expect(events[0].event_data).toMatchObject({
      name: 'Test Org',
      subdomain: 'test-org'
    })
    expect(events[0].metadata.workflow_id).toBeDefined()
  })
})
```

---

## Debugging Workflows

### Using Temporal Web UI

```bash
# Port-forward Temporal Web UI
kubectl port-forward -n temporal svc/temporal-web 8080:8080

# Open in browser
open http://localhost:8080
```

**Web UI Features**:
- View running/completed/failed workflows
- Inspect workflow history and events
- See all activity executions with retry attempts
- View workflow state and pending activities
- Manually terminate stuck workflows
- Query workflow execution by ID or type

### Viewing Workflow Execution History

In Temporal Web UI:
1. Navigate to workflow execution by ID
2. Click "History" tab
3. See all events in chronological order:
   - WorkflowExecutionStarted
   - ActivityTaskScheduled
   - ActivityTaskStarted
   - ActivityTaskCompleted
   - WorkflowExecutionCompleted

### Debugging Failed Activities

```bash
# View worker logs
kubectl logs -n temporal deployment/temporal-worker -f

# Filter for specific workflow
kubectl logs -n temporal deployment/temporal-worker | grep "workflow-id"
```

**Common failure patterns**:
- Activity timeout → Check `startToCloseTimeout`
- Retry exhausted → Check retry policy configuration
- Non-retryable error → ApplicationFailure thrown
- Event emission failed → Check Supabase service role key

### Workflow Replay Debugging

If workflow fails on replay:

```bash
# Download workflow history from Temporal Web UI
# Save as workflow-history.json

# Replay locally
npm run replay-workflow -- workflow-history.json
```

---

## Integration Testing

### Testing Full Workflow Against Dev Cluster

```typescript
import { Client } from '@temporalio/client'

describe('Bootstrap Workflow Integration', () => {
  it('should bootstrap organization end-to-end', async () => {
    const client = new Client({ connection: { address: 'localhost:7233' } })
    const subdomain = `test-${Date.now()}`

    const handle = await client.workflow.start(BootstrapWorkflow, {
      taskQueue: 'bootstrap',
      workflowId: `integration-${subdomain}`,
      args: [{ organizationName: 'Test', subdomain }]
    })

    const result = await handle.result()

    expect(result.success).toBe(true)
    expect(result.orgId).toBeDefined()

    // Verify in database
    const { data: org } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', result.orgId)
      .single()

    expect(org.subdomain).toBe(subdomain)

    // Verify events
    const { data: events } = await supabase
      .from('domain_events')
      .select('*')
      .eq('aggregate_id', result.orgId)

    expect(events.map(e => e.event_type)).toContain('OrganizationCreated')

    // Cleanup
    await supabase.from('organizations').delete().eq('id', result.orgId)
  }, 60000)
})
```

---

## Testing Best Practices

### 1. Test Workflow Logic with Mocks

Fast unit tests with mocked activities for workflow logic.

### 2. Test Activities in Isolation

Unit test activities with mocked dependencies (Supabase, APIs).

### 3. Integration Tests for Critical Flows

End-to-end tests against dev Temporal cluster for key workflows.

### 4. Verify Event Emission

Check that domain events are emitted correctly with proper metadata.

### 5. Test Compensation Logic

Mock activity failures to verify saga compensation works.

### 6. Use Replay Tests for Versioning

Ensure workflow changes don't break existing executions.

---

## Common Testing Pitfalls

### Pitfall 1: Not Mocking Time

```typescript
// ❌ Wrong - uses actual Date.now()
const timestamp = Date.now()

// ✅ Correct - use Temporal's workflow time (deterministic)
import { sleep } from '@temporalio/workflow'
await sleep('0ms')  // Gets workflow time
```

### Pitfall 2: Forgetting to Clean Up Test Data

```typescript
afterEach(async () => {
  // Clean up test organizations
  await supabase
    .from('organizations')
    .delete()
    .like('subdomain', 'test-%')
})
```

### Pitfall 3: Hardcoded Workflow IDs

```typescript
// ❌ Bad - workflow ID collision in parallel tests
workflowId: 'test-workflow'

// ✅ Good - unique ID per test
workflowId: `test-workflow-${Date.now()}-${Math.random()}`
```

---

## Summary

✅ **Local development** - Port-forward Temporal frontend, run worker locally
✅ **Replay tests** - Verify workflow code changes don't break existing workflows
✅ **Mock activities** - Fast unit tests with deterministic results
✅ **Activity unit tests** - Test activities in isolation with mocked dependencies
✅ **Integration tests** - End-to-end tests against dev Temporal cluster
✅ **Debug with Web UI** - Inspect workflow history, activity executions, errors
✅ **Verify events** - Check domain_events table for emitted events
✅ **Test compensation** - Mock failures to verify saga rollback logic

See `temporal/CLAUDE.md` for complete local development setup and environment variables.
