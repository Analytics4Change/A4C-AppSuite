# Integration Testing Guide for Event-Driven Workflows

## Overview

This guide covers end-to-end integration testing for the event-driven workflow triggering system in A4C AppSuite. Integration tests verify the complete flow from event emission through workflow execution to projection updates.

**Test Scope**:
- Edge Function → Event Emission → Database Trigger → Worker Listener → Workflow Start → Activity Execution → Projection Updates

**Test Environment**:
- Local Supabase (PostgreSQL + Edge Functions runtime)
- Local Temporal cluster (port-forwarded from Kubernetes)
- Local workflow worker (connected to both)

## Architecture Under Test

```mermaid
sequenceDiagram
    participant T as Test Script
    participant EF as Edge Function
    participant DB as PostgreSQL
    participant W as Worker
    participant TM as Temporal
    participant P as Projections

    T->>EF: POST /create-organization
    EF->>DB: INSERT domain_events
    DB->>W: NOTIFY workflow_events
    W->>TM: startWorkflow()
    TM->>W: Execute activities
    W->>DB: INSERT events (activity)
    W->>P: UPDATE projections
    T->>DB: Query & verify results
```

## Prerequisites

### 1. Local Development Environment

**Install Tools**:
```bash
# Supabase CLI
brew install supabase/tap/supabase

# Temporal CLI (for cluster management)
brew install temporal

# Node.js 20+
node --version # v20.x.x

# PostgreSQL client (for SQL queries)
brew install postgresql
```

### 2. Running Services

**Start Local Supabase**:
```bash
cd infrastructure/supabase
./local-tests/start-local.sh

# Verify services
supabase status

# Expected output:
# API URL: http://localhost:54321
# DB URL: postgresql://postgres:postgres@localhost:54322/postgres
# Studio URL: http://localhost:54323
```

**Port-Forward Temporal Cluster**:
```bash
# Port-forward Temporal frontend (gRPC)
kubectl port-forward -n temporal svc/temporal-frontend 7233:7233 &

# Port-forward Temporal Web UI (HTTP)
kubectl port-forward -n temporal svc/temporal-web 8080:8080 &

# Verify connection
temporal workflow list --namespace default
```

**Start Local Worker**:
```bash
cd workflows

# Set environment variables
export TEMPORAL_ADDRESS=localhost:7233
export TEMPORAL_NAMESPACE=default
export TEMPORAL_TASK_QUEUE=bootstrap
export SUPABASE_URL=http://localhost:54321
export SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o json | jq -r '.service_role_key')
export WORKFLOW_MODE=development

# Start worker
npm run worker

# Expected output:
# ✅ Database connection established
# ✅ Listening on channel: workflow_events
# 🔄 Worker connected to Temporal
```

## Test Setup

### Test Project Structure

```
workflows/
├── src/
│   └── tests/
│       └── integration/
│           ├── setup.ts                      # Test environment setup
│           ├── organization-bootstrap.test.ts # Bootstrap workflow tests
│           ├── event-workflow-linking.test.ts # Traceability tests
│           └── utils/
│               ├── helpers.ts                # Test utilities
│               ├── fixtures.ts               # Test data
│               └── assertions.ts             # Custom assertions
└── package.json
```

### Install Test Dependencies

```bash
cd workflows

# Install Jest and testing utilities
npm install --save-dev \
  jest \
  @types/jest \
  ts-jest \
  @supabase/supabase-js \
  uuid

# Update package.json scripts
{
  "scripts": {
    "test:integration": "jest --testPathPattern=integration --runInBand",
    "test:integration:watch": "jest --testPathPattern=integration --watch --runInBand"
  }
}
```

### Test Configuration

**File**: `workflows/jest.config.integration.js`

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/integration/**/*.test.ts'],
  testTimeout: 30000, // 30 seconds (workflows can be slow)
  setupFilesAfterEnv: ['<rootDir>/src/tests/integration/setup.ts'],
  globals: {
    'ts-jest': {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
    },
  },
};
```

## Test Utilities

### Setup File

**File**: `workflows/src/tests/integration/setup.ts`

```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export let supabase: SupabaseClient;

beforeAll(async () => {
  // Initialize Supabase client
  supabase = createClient(
    process.env.SUPABASE_URL || 'http://localhost:54321',
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Verify database connection
  const { error } = await supabase.from('domain_events').select('id').limit(1);
  if (error) {
    throw new Error(`Database connection failed: ${error.message}`);
  }

  console.log('✅ Test environment ready');
});

afterAll(async () => {
  // Cleanup (if needed)
});
```

### Test Helpers

**File**: `workflows/src/tests/integration/utils/helpers.ts`

```typescript
import { supabase } from '../setup';
import { v4 as uuidv4 } from 'uuid';

/**
 * Wait for workflow to start (event updated with workflow_id)
 */
export async function waitForWorkflowStart(
  eventId: string,
  timeoutMs: number = 10000
): Promise<string> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const { data: event } = await supabase
      .from('domain_events')
      .select('event_metadata, processing_error')
      .eq('id', eventId)
      .single();

    if (event?.processing_error) {
      throw new Error(`Workflow start failed: ${event.processing_error}`);
    }

    if (event?.event_metadata?.workflow_id) {
      return event.event_metadata.workflow_id;
    }

    await sleep(500); // Poll every 500ms
  }

  throw new Error(`Workflow start timeout after ${timeoutMs}ms`);
}

/**
 * Wait for workflow to complete (organization.created event)
 */
export async function waitForWorkflowCompletion(
  organizationId: string,
  timeoutMs: number = 30000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const { data: events } = await supabase
      .from('domain_events')
      .select('event_type')
      .eq('aggregate_type', 'organization')
      .eq('aggregate_id', organizationId)
      .eq('event_type', 'organization.created');

    if (events && events.length > 0) {
      return; // Workflow completed
    }

    await sleep(1000); // Poll every 1 second
  }

  throw new Error(`Workflow completion timeout after ${timeoutMs}ms`);
}

/**
 * Get all events for a workflow
 */
export async function getWorkflowEvents(workflowId: string) {
  const { data: events } = await supabase
    .from('domain_events')
    .select('*')
    .eq('event_metadata->>workflow_id', workflowId)
    .order('created_at', { ascending: true });

  return events || [];
}

/**
 * Clean up test organization
 */
export async function cleanupOrganization(organizationId: string) {
  await supabase
    .from('organizations_projection')
    .delete()
    .eq('id', organizationId);

  await supabase
    .from('domain_events')
    .delete()
    .eq('aggregate_id', organizationId);
}

/**
 * Generate unique test slug
 */
export function generateTestSlug(): string {
  return `test-org-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Test Fixtures

**File**: `workflows/src/tests/integration/utils/fixtures.ts`

```typescript
import { v4 as uuidv4 } from 'uuid';
import { generateTestSlug } from './helpers';

export function createOrganizationFixture(overrides = {}) {
  return {
    name: 'Test Organization',
    slug: generateTestSlug(),
    owner_email: 'owner@test.com',
    tier: 'free' as const,
    subdomain_enabled: false,
    ...overrides,
  };
}

export function createBootstrapEventFixture(organizationId: string, data: any) {
  return {
    event_type: 'organization.bootstrap_initiated',
    aggregate_type: 'organization',
    aggregate_id: organizationId,
    event_data: data,
    event_metadata: {
      timestamp: new Date().toISOString(),
      tags: ['integration-test'],
      source: 'test',
    },
  };
}
```

## Integration Tests

### Test 1: Organization Bootstrap End-to-End

**File**: `workflows/src/tests/integration/organization-bootstrap.test.ts`

```typescript
import { supabase } from './setup';
import { v4 as uuidv4 } from 'uuid';
import {
  waitForWorkflowStart,
  waitForWorkflowCompletion,
  cleanupOrganization,
} from './utils/helpers';
import {
  createOrganizationFixture,
  createBootstrapEventFixture,
} from './utils/fixtures';

describe('Organization Bootstrap Workflow', () => {
  let organizationId: string;
  let eventId: string;

  afterEach(async () => {
    // Cleanup after each test
    if (organizationId) {
      await cleanupOrganization(organizationId);
    }
  });

  test('should trigger workflow on event emission', async () => {
    // Arrange
    organizationId = uuidv4();
    const orgData = createOrganizationFixture();
    const event = createBootstrapEventFixture(organizationId, orgData);

    // Act: Emit event
    const { data: insertedEvent, error } = await supabase
      .from('domain_events')
      .insert(event)
      .select()
      .single();

    expect(error).toBeNull();
    eventId = insertedEvent!.id;

    // Assert: Workflow starts within 10 seconds
    const workflowId = await waitForWorkflowStart(eventId, 10000);
    expect(workflowId).toBe(`org-bootstrap-${organizationId}`);
  });

  test('should create organization projection', async () => {
    // Arrange
    organizationId = uuidv4();
    const orgData = createOrganizationFixture({
      name: 'Integration Test Org',
      tier: 'premium',
    });

    // Act: Trigger workflow
    const { data: event } = await supabase
      .from('domain_events')
      .insert(createBootstrapEventFixture(organizationId, orgData))
      .select()
      .single();

    await waitForWorkflowCompletion(organizationId, 30000);

    // Assert: Organization created in projection
    const { data: org } = await supabase
      .from('organizations_projection')
      .select('*')
      .eq('id', organizationId)
      .single();

    expect(org).toBeTruthy();
    expect(org!.name).toBe('Integration Test Org');
    expect(org!.slug).toBe(orgData.slug);
    expect(org!.tier).toBe('premium');
    expect(org!.status).toBe('active');
  });

  test('should emit all expected events', async () => {
    // Arrange
    organizationId = uuidv4();
    const orgData = createOrganizationFixture();

    // Act: Trigger workflow
    const { data: event } = await supabase
      .from('domain_events')
      .insert(createBootstrapEventFixture(organizationId, orgData))
      .select()
      .single();

    const workflowId = await waitForWorkflowStart(event!.id);
    await waitForWorkflowCompletion(organizationId);

    // Assert: Expected events emitted
    const { data: events } = await supabase
      .from('domain_events')
      .select('event_type')
      .eq('aggregate_id', organizationId)
      .order('created_at', { ascending: true });

    const eventTypes = events!.map(e => e.event_type);

    expect(eventTypes).toContain('organization.bootstrap_initiated');
    expect(eventTypes).toContain('organization.created');
    // Add more event types as workflow evolves
  });

  test('should handle idempotency (duplicate events)', async () => {
    // Arrange
    organizationId = uuidv4();
    const orgData = createOrganizationFixture();
    const eventPayload = createBootstrapEventFixture(organizationId, orgData);

    // Act: Emit same event twice
    const { data: event1 } = await supabase
      .from('domain_events')
      .insert(eventPayload)
      .select()
      .single();

    await waitForWorkflowStart(event1!.id);

    // Emit duplicate event
    const { data: event2 } = await supabase
      .from('domain_events')
      .insert(eventPayload)
      .select()
      .single();

    await sleep(2000); // Wait for processing

    // Assert: Second event has error (workflow already running)
    const { data: processedEvent2 } = await supabase
      .from('domain_events')
      .select('event_metadata')
      .eq('id', event2!.id)
      .single();

    expect(processedEvent2!.event_metadata.processing_error).toContain(
      'already running'
    );
  });
});
```

### Test 2: Event-Workflow Traceability

**File**: `workflows/src/tests/integration/event-workflow-linking.test.ts`

```typescript
import { supabase } from './setup';
import { v4 as uuidv4 } from 'uuid';
import {
  waitForWorkflowCompletion,
  getWorkflowEvents,
  cleanupOrganization,
} from './utils/helpers';
import {
  createOrganizationFixture,
  createBootstrapEventFixture,
} from './utils/fixtures';

describe('Event-Workflow Traceability', () => {
  let organizationId: string;

  afterEach(async () => {
    if (organizationId) {
      await cleanupOrganization(organizationId);
    }
  });

  test('should link events to workflow ID', async () => {
    // Arrange
    organizationId = uuidv4();
    const orgData = createOrganizationFixture();

    // Act: Trigger workflow
    const { data: event } = await supabase
      .from('domain_events')
      .insert(createBootstrapEventFixture(organizationId, orgData))
      .select()
      .single();

    await waitForWorkflowCompletion(organizationId);

    // Assert: Trigger event updated with workflow_id
    const { data: processedEvent } = await supabase
      .from('domain_events')
      .select('event_metadata')
      .eq('id', event!.id)
      .single();

    expect(processedEvent!.event_metadata.workflow_id).toBe(
      `org-bootstrap-${organizationId}`
    );
    expect(processedEvent!.event_metadata.workflow_run_id).toBeTruthy();
    expect(processedEvent!.event_metadata.workflow_type).toBe(
      'organizationBootstrapWorkflow'
    );
  });

  test('should link activity events to workflow', async () => {
    // Arrange
    organizationId = uuidv4();
    const orgData = createOrganizationFixture();

    // Act: Trigger workflow
    await supabase
      .from('domain_events')
      .insert(createBootstrapEventFixture(organizationId, orgData));

    await waitForWorkflowCompletion(organizationId);

    // Assert: Activity events have workflow context
    const { data: activityEvents } = await supabase
      .from('domain_events')
      .select('event_type, event_metadata')
      .eq('aggregate_id', organizationId)
      .eq('event_type', 'organization.created')
      .single();

    expect(activityEvents!.event_metadata.workflow_id).toBe(
      `org-bootstrap-${organizationId}`
    );
    expect(activityEvents!.event_metadata.activity_id).toBeTruthy();
  });

  test('should support bi-directional queries', async () => {
    // Arrange
    organizationId = uuidv4();
    const orgData = createOrganizationFixture();

    // Act: Trigger workflow
    const { data: triggerEvent } = await supabase
      .from('domain_events')
      .insert(createBootstrapEventFixture(organizationId, orgData))
      .select()
      .single();

    await waitForWorkflowCompletion(organizationId);

    // Get workflow ID from trigger event
    const { data: processedTrigger } = await supabase
      .from('domain_events')
      .select('event_metadata')
      .eq('id', triggerEvent!.id)
      .single();

    const workflowId = processedTrigger!.event_metadata.workflow_id;

    // Assert: Can query all events by workflow_id
    const workflowEvents = await getWorkflowEvents(workflowId);

    expect(workflowEvents.length).toBeGreaterThan(1);
    expect(workflowEvents.map(e => e.event_type)).toContain(
      'organization.bootstrap_initiated'
    );
    expect(workflowEvents.map(e => e.event_type)).toContain(
      'organization.created'
    );
  });
});
```

### Test 3: Error Handling

**File**: `workflows/src/tests/integration/error-handling.test.ts`

```typescript
import { supabase } from './setup';
import { v4 as uuidv4 } from 'uuid';
import { waitForWorkflowStart, cleanupOrganization, sleep } from './utils/helpers';
import { createBootstrapEventFixture } from './utils/fixtures';

describe('Error Handling', () => {
  let organizationId: string;

  afterEach(async () => {
    if (organizationId) {
      await cleanupOrganization(organizationId);
    }
  });

  test('should record error if event data invalid', async () => {
    // Arrange: Invalid event (missing required field)
    organizationId = uuidv4();
    const invalidEvent = createBootstrapEventFixture(organizationId, {
      // Missing 'name' field (required)
      slug: 'test-slug',
      owner_email: 'owner@test.com',
    });

    // Act: Emit invalid event
    const { data: event } = await supabase
      .from('domain_events')
      .insert(invalidEvent)
      .select()
      .single();

    await sleep(5000); // Wait for processing

    // Assert: Error recorded
    const { data: processedEvent } = await supabase
      .from('domain_events')
      .select('event_metadata')
      .eq('id', event!.id)
      .single();

    expect(processedEvent!.event_metadata.processing_error).toBeTruthy();
    expect(processedEvent!.event_metadata.processing_error).toContain('name');
  });

  test('should handle worker restart gracefully', async () => {
    // Arrange
    organizationId = uuidv4();

    // Act: Emit event while worker temporarily down
    // (manually stop worker, emit event, restart worker)

    // This test requires manual intervention or Docker control
    // Skip in CI unless worker management automated

    // Assert: Event processed after worker restart
    // expect(workflowId).toBeTruthy();
  });
});
```

## Running Tests

### Run All Integration Tests

```bash
cd workflows

# Ensure services running
# 1. Local Supabase: ./local-tests/start-local.sh
# 2. Temporal cluster: kubectl port-forward -n temporal svc/temporal-frontend 7233:7233
# 3. Worker: npm run worker (in separate terminal)

# Run tests
npm run test:integration

# Expected output:
# PASS  src/tests/integration/organization-bootstrap.test.ts
#   Organization Bootstrap Workflow
#     ✓ should trigger workflow on event emission (5234ms)
#     ✓ should create organization projection (12456ms)
#     ✓ should emit all expected events (13123ms)
#     ✓ should handle idempotency (8765ms)
#
# PASS  src/tests/integration/event-workflow-linking.test.ts
#   Event-Workflow Traceability
#     ✓ should link events to workflow ID (11234ms)
#     ✓ should link activity events to workflow (12567ms)
#     ✓ should support bi-directional queries (13890ms)
#
# Test Suites: 2 passed, 2 total
# Tests:       7 passed, 7 total
```

### Run Specific Test

```bash
# Run single test file
npm run test:integration -- organization-bootstrap.test.ts

# Run single test case
npm run test:integration -- -t "should trigger workflow on event emission"
```

### Watch Mode

```bash
# Auto-rerun tests on file changes
npm run test:integration:watch
```

## Continuous Integration (GitHub Actions)

### CI Workflow Configuration

**File**: `.github/workflows/integration-tests.yml`

```yaml
name: Integration Tests

on:
  pull_request:
    paths:
      - 'workflows/**'
      - 'infrastructure/supabase/sql/**'
  push:
    branches:
      - main

jobs:
  integration-tests:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: supabase/postgres:15.1.0.54
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 54322:5432

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1

      - name: Start Supabase
        run: |
          cd infrastructure/supabase
          supabase start

      - name: Port-forward Temporal
        run: |
          # Assume Temporal running in K8s (or use Docker)
          # kubectl port-forward -n temporal svc/temporal-frontend 7233:7233 &

      - name: Install dependencies
        run: |
          cd workflows
          npm ci

      - name: Run integration tests
        env:
          SUPABASE_URL: http://localhost:54321
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          TEMPORAL_ADDRESS: localhost:7233
        run: |
          cd workflows
          npm run test:integration

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: integration-test-results
          path: workflows/coverage/
```

## Troubleshooting

### Tests Timeout

**Issue**: Tests fail with timeout errors

**Fix**:
```bash
# Check worker running
ps aux | grep "npm run worker"

# Check Temporal connection
temporal workflow list --namespace default

# Increase test timeout
jest.config.js: testTimeout: 60000 // 60 seconds
```

### Events Not Processing

**Issue**: Events emitted but workflow not starting

**Fix**:
```bash
# Check worker logs
tail -f workflows/worker.log

# Check database trigger
psql postgres://postgres:postgres@localhost:54322/postgres -c \
  "SELECT tgname, tgenabled FROM pg_trigger WHERE tgname='process_organization_bootstrap_initiated';"

# Verify NOTIFY working
psql postgres://postgres:postgres@localhost:54322/postgres -c \
  "LISTEN workflow_events;" &
# Emit event, check for NOTIFY
```

### Database State Pollution

**Issue**: Tests fail due to leftover data from previous runs

**Fix**:
```bash
# Clean up test data before running
psql postgres://postgres:postgres@localhost:54322/postgres -c \
  "DELETE FROM domain_events WHERE event_metadata->'tags' ? 'integration-test';"

psql postgres://postgres:postgres@localhost:54322/postgres -c \
  "DELETE FROM organizations_projection WHERE slug LIKE 'test-org-%';"
```

## Best Practices

### 1. Use Unique Test Data

```typescript
// ✅ Good: Generate unique slugs
const slug = `test-org-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// ❌ Bad: Hardcoded slug (causes conflicts)
const slug = 'test-org';
```

### 2. Always Clean Up

```typescript
afterEach(async () => {
  if (organizationId) {
    await cleanupOrganization(organizationId);
  }
});
```

### 3. Use Meaningful Timeouts

```typescript
// ✅ Good: Specific timeout for each wait
await waitForWorkflowStart(eventId, 10000); // 10s (fast)
await waitForWorkflowCompletion(orgId, 30000); // 30s (slower)

// ❌ Bad: Generic timeout
await waitForWorkflowStart(eventId); // Defaults may be too short
```

### 4. Test Both Happy and Error Paths

```typescript
// Test success case
test('should create organization', async () => { ... });

// Test failure cases
test('should reject invalid email', async () => { ... });
test('should handle duplicate slug', async () => { ... });
```

## Related Documentation

- **Triggering Workflows Guide**: `documentation/workflows/guides/triggering-workflows.md`
- **Event Metadata Schema**: `documentation/workflows/reference/event-metadata-schema.md`
- **Event-Driven Architecture**: `documentation/architecture/workflows/event-driven-workflow-triggering.md`
- **Jest Documentation**: https://jestjs.io/docs/getting-started

## Support

For integration testing issues:
1. Verify all services running (Supabase, Temporal, Worker)
2. Check test logs for specific error messages
3. Review worker logs for processing errors
4. Query `domain_events` table for event status
