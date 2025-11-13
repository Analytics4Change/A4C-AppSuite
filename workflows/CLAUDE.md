# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A4C Workflows implements durable, fault-tolerant business process orchestration using Temporal.io. This component manages long-running operations like organization onboarding, DNS provisioning, and user invitations with automatic retry, compensation (Saga pattern), and event sourcing.

## Technology Stack

- **Orchestration**: Temporal.io (workflow engine)
- **Runtime**: Node.js 20+ with TypeScript
- **Database**: Supabase PostgreSQL (event store + projections)
- **DNS Provider**: Cloudflare API
- **Email Providers**: Resend API, SMTP
- **Testing**: Jest, Temporal test framework
- **Deployment**: Docker + Kubernetes

## Available Commands

```bash
npm install        # Install dependencies
npm run dev        # Start worker with auto-reload
npm run build      # Build TypeScript
npm run worker     # Run production worker
npm test           # Run unit tests
npm test:coverage  # Run tests with coverage
npm run lint       # Lint code

# Development entity management
npm run query:dev    # Query dev entities
npm run cleanup:dev  # Delete dev entities
```

## Architecture Patterns (Temporal-Specific)

### Workflow-First Pattern
**ALL business logic orchestrated through Temporal workflows**, not direct API calls or database updates:
- Workflows are **deterministic** (same input → same output, always)
- Workflows contain orchestration logic, not side effects
- Side effects happen in **activities** (non-deterministic operations)

```typescript
// ✅ CORRECT: Workflow orchestrates, activities execute
export async function organizationBootstrapWorkflow(input: OrganizationInput) {
  const orgId = await activities.createOrganization(input);  // Activity
  const dnsRecord = await activities.configureDNS(orgId);     // Activity
  return { orgId, dnsRecord };
}

// ❌ WRONG: Side effects in workflow (non-deterministic)
export async function badWorkflow(input: OrganizationInput) {
  const response = await fetch('https://api.example.com');  // ❌ Non-deterministic!
  const random = Math.random();                             // ❌ Non-deterministic!
  const now = new Date();                                   // ❌ Non-deterministic!
}
```

### CQRS/Event Sourcing Pattern
All state changes emit domain events that update read projections:
- **Command**: Activity creates/updates entity
- **Event**: Activity emits domain event (e.g., `OrganizationCreated`)
- **Projection**: Database trigger updates read model (e.g., `organizations_projection`)

```typescript
// Activity emits event after successful operation
async function createOrganizationActivity(input: OrgInput): Promise<string> {
  // 1. Create organization via Supabase
  const { data } = await supabase.from('organizations_projection').insert({...});

  // 2. Emit domain event
  await emitEvent({
    event_type: 'organization.created',
    aggregate_id: data.id,
    event_data: { name: input.name, ... }
  });

  return data.id;
}
```

### Three-Layer Idempotency
Workflows and activities MUST be idempotent (safe to retry):

**Layer 1 - Workflow ID**: Unique workflow ID prevents duplicate workflow executions
```typescript
// Client triggers workflow with idempotency key
await client.workflow.start(organizationBootstrapWorkflow, {
  workflowId: `org-bootstrap-${orgId}`,  // Unique ID prevents duplicates
  taskQueue: 'bootstrap',
  args: [input]
});
```

**Layer 2 - Activity Check-Then-Act**: Activities check existence before creating
```typescript
async function createOrganizationActivity(input: OrgInput): Promise<string> {
  // Check if already exists
  const existing = await supabase
    .from('organizations_projection')
    .select('id')
    .eq('slug', input.slug)
    .maybeSingle();

  if (existing) return existing.id;  // Already created, return existing

  // Create new organization
  const { data } = await supabase.from('organizations_projection').insert({...});
  return data.id;
}
```

**Layer 3 - Event Deduplication**: Database prevents duplicate event processing
```typescript
-- Event insertion with unique constraint
INSERT INTO domain_events (event_id, event_type, aggregate_id, ...)
VALUES (gen_random_uuid(), 'organization.created', ...)
ON CONFLICT (aggregate_id, event_type, created_at) DO NOTHING;
```

### Saga Pattern (Compensation)
Workflows implement rollback via compensation activities:

```typescript
export async function organizationBootstrapWorkflow(input: OrgInput) {
  let dnsRecord: DNSRecord | null = null;
  let orgId: string | null = null;

  try {
    // Forward flow
    orgId = await activities.createOrganization(input);
    dnsRecord = await activities.configureDNS(orgId);
    await activities.generateInvitations(orgId);
    await activities.sendInvitationEmails(orgId);
    await activities.activateOrganization(orgId);

  } catch (error) {
    // Compensation flow (reverse order)
    if (dnsRecord) {
      await activities.removeDNS(dnsRecord);  // Compensate DNS creation
    }
    if (orgId) {
      await activities.deactivateOrganization(orgId);  // Compensate org creation
    }
    throw error;
  }
}
```

### Provider Pattern (Pluggable Dependencies)
DNS and Email providers selected via configuration:

**Factory Pattern**:
```typescript
// src/shared/providers/dns/factory.ts
export function createDNSProvider(config: Config): IDNSProvider {
  switch (config.dnsProvider) {
    case 'cloudflare': return new CloudflareDNSProvider(config);
    case 'logging': return new LoggingDNSProvider();
    case 'mock': return new MockDNSProvider();
  }
}
```

**Mode-Based Selection**:
```bash
# .env configuration
WORKFLOW_MODE=development  # → LoggingDNS + LoggingEmail (console logs)
WORKFLOW_MODE=production   # → CloudflareDNS + ResendEmail (real providers)
WORKFLOW_MODE=mock         # → MockDNS + MockEmail (in-memory, testing)
```

## Development Guidelines

### Workflow Determinism Requirements

**Workflows MUST be deterministic** - Temporal replays workflows from history:

**❌ FORBIDDEN in Workflows**:
- `Math.random()`, `Date.now()`, `new Date()`
- Network calls: `fetch()`, `axios.get()`
- Database queries
- File system operations
- Non-deterministic timers: `setTimeout()`, `setInterval()`

**✅ ALLOWED in Workflows**:
- `await activities.*()` - Call activities for side effects
- `workflow.sleep(duration)` - Deterministic sleep
- `workflow.condition(predicate)` - Wait for condition
- `workflow.random()` - Deterministic random (seeded)
- `workflow.now()` - Deterministic time (from workflow start)

### Activity Implementation Best Practices

**1. Idempotency** (can be retried safely):
```typescript
// ✅ Check-then-act pattern
async function createResource(id: string) {
  const existing = await db.findById(id);
  if (existing) return existing;  // Already created
  return await db.create({ id });
}

// ❌ Not idempotent (creates duplicate on retry)
async function badCreate(id: string) {
  return await db.create({ id });  // Error on retry!
}
```

**2. Error Handling** (let Temporal retry):
```typescript
// ✅ Throw errors for Temporal to retry
async function reliableActivity() {
  try {
    return await externalAPI.call();
  } catch (error) {
    // Log error, then throw for Temporal to retry
    console.error('Activity failed, will retry:', error);
    throw error;  // Temporal retries automatically
  }
}
```

**3. Heartbeats** (for long-running activities):
```typescript
import { Context } from '@temporalio/activity';

export async function longRunningActivity(items: string[]) {
  const context = Context.current();

  for (let i = 0; i < items.length; i++) {
    await processItem(items[i]);
    context.heartbeat(i);  // Report progress
  }
}
```

### Configuration Management

**Master Control Variable**: `WORKFLOW_MODE`
```bash
# Development (console logs, no real resources)
WORKFLOW_MODE=development

# Testing (in-memory mocks, fast)
WORKFLOW_MODE=mock

# Production (real DNS, real emails)
WORKFLOW_MODE=production
```

**Provider Override** (advanced):
```bash
# Use real DNS but log emails
WORKFLOW_MODE=development
DNS_PROVIDER=cloudflare
CLOUDFLARE_API_TOKEN=your-token
# EMAIL_PROVIDER defaults to logging
```

**Configuration Validation**:
```typescript
// Worker validates on startup
import { validateConfig } from './shared/config/validate-config';

const config = validateConfig(process.env);
// ❌ Configuration has errors:
//    • DNS_PROVIDER=cloudflare requires CLOUDFLARE_API_TOKEN
```

### Event Emission Pattern

**All activities that modify state MUST emit domain events**:

```typescript
import { emitEvent } from '../shared/utils/event-emitter';

async function createOrganizationActivity(input: OrgInput): Promise<string> {
  // 1. Perform state change
  const { data } = await supabase
    .from('organizations_projection')
    .insert({ name: input.name, slug: input.slug })
    .select()
    .single();

  // 2. Emit domain event
  await emitEvent({
    event_type: 'organization.created',
    aggregate_type: 'organization',
    aggregate_id: data.id,
    event_data: {
      name: data.name,
      slug: data.slug,
      created_by: input.created_by
    }
  });

  return data.id;
}
```

**Event Schema Validation** (AsyncAPI):
- Event schemas defined in: `infrastructure/supabase/contracts/asyncapi.yaml`
- Validate event_data matches schema before emitting
- Use TypeScript types generated from AsyncAPI spec

## Testing Patterns

### Unit Tests (Mock Mode)
```bash
WORKFLOW_MODE=mock npm test
```

```typescript
// Use mock providers for fast, isolated tests
describe('OrganizationBootstrapWorkflow', () => {
  it('should create organization and configure DNS', async () => {
    const env = await TestWorkflowEnvironment.createLocal();

    const result = await env.client.workflow.execute(
      organizationBootstrapWorkflow,
      { args: [{ name: 'Test Org', slug: 'test' }] }
    );

    expect(result.orgId).toBeDefined();
  });
});
```

### Workflow Replay Tests
```typescript
// Temporal can replay workflows from history
it('should replay without non-determinism errors', async () => {
  const history = await getWorkflowHistory('workflow-id');
  await Worker.runReplayHistory({ history });
  // Throws if workflow has non-deterministic code
});
```

### Integration Tests (Real Providers)
```bash
WORKFLOW_MODE=production npm test -- --testPathPattern=integration
```

```typescript
// Test with real Cloudflare and Resend
describe('DNS Integration', () => {
  it('should create real DNS record', async () => {
    const result = await configureDNSActivity({
      domain: 'test.example.com',
      recordType: 'CNAME',
      value: 'target.example.com'
    });

    expect(result.id).toBeDefined();

    // Cleanup
    await removeDNSActivity(result);
  });
});
```

## Cross-Component Integration

### Frontend → Workflows
Frontend triggers workflows via Temporal client:

```typescript
// Frontend: Trigger organization bootstrap
import { client } from '@/lib/temporal';

async function createOrganization(orgData: OrgInput) {
  const handle = await client.workflow.start(organizationBootstrapWorkflow, {
    workflowId: `org-bootstrap-${orgData.slug}`,
    taskQueue: 'bootstrap',
    args: [orgData]
  });

  // Poll for status or subscribe to updates
  const result = await handle.result();
  return result;
}
```

### Workflows → Infrastructure (Events)
Workflows emit events that update database projections:

```typescript
// Activity emits event
await emitEvent({
  event_type: 'organization.created',
  aggregate_id: orgId,
  event_data: { name, slug }
});

// Database trigger processes event (infrastructure/supabase/sql/04-triggers/)
-- Trigger on domain_events table updates organizations_projection
```

### Workflows → Infrastructure (Database)
Activities use Supabase service role for database access:

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // Bypasses RLS
);

// Activities can read/write all tables
const { data } = await supabase.from('organizations_projection').select('*');
```

## Common Pitfalls (Temporal-Specific)

### 1. Non-Determinism in Workflows
```typescript
// ❌ WRONG: Random in workflow
export async function badWorkflow() {
  const random = Math.random();  // Different value on replay!
  if (random > 0.5) { /* ... */ }
}

// ✅ CORRECT: Use Temporal's deterministic random
export async function goodWorkflow() {
  const random = workflow.random();  // Same value on replay
  if (random > 0.5) { /* ... */ }
}
```

### 2. Activity Not Idempotent
```typescript
// ❌ WRONG: Creates duplicate on retry
async function sendEmailActivity(email: string) {
  await sendEmail(email);  // Sends duplicate if retried
}

// ✅ CORRECT: Check if already sent
async function sendEmailActivity(email: string, invitationId: string) {
  const sent = await db.query('SELECT sent FROM invitations WHERE id = ?', invitationId);
  if (sent) return;  // Already sent

  await sendEmail(email);
  await db.update('UPDATE invitations SET sent = true WHERE id = ?', invitationId);
}
```

### 3. Missing Event Emission
```typescript
// ❌ WRONG: State change without event
async function createOrgActivity(input: OrgInput) {
  const { data } = await supabase.from('organizations_projection').insert({...});
  return data.id;  // No event emitted!
}

// ✅ CORRECT: Always emit event after state change
async function createOrgActivity(input: OrgInput) {
  const { data } = await supabase.from('organizations_projection').insert({...});
  await emitEvent({ event_type: 'organization.created', ... });  // Event emitted
  return data.id;
}
```

### 4. Configuration Validation Errors
```typescript
// ❌ WRONG: No validation, fails at runtime
const dnsProvider = new CloudflareDNSProvider({
  token: process.env.CLOUDFLARE_API_TOKEN  // Undefined → cryptic error
});

// ✅ CORRECT: Validate config on startup
import { validateConfig } from './shared/config/validate-config';

const config = validateConfig(process.env);  // Throws clear error if invalid
const dnsProvider = createDNSProvider(config);
```

### 5. Event Ordering Issues
```typescript
// ❌ WRONG: Emit event before state change
async function badActivity() {
  await emitEvent({ event_type: 'org.created', ... });  // Event first
  await supabase.from('orgs').insert({...});             // State second
  // If state change fails, event already emitted!
}

// ✅ CORRECT: State change first, then event
async function goodActivity() {
  const { data } = await supabase.from('orgs').insert({...});  // State first
  await emitEvent({ event_type: 'org.created', ... });          // Event second
  // If event fails, Temporal retries entire activity
}
```

## MCP Tool Usage

### Supabase MCP (Database Operations)
Use for database queries during workflow development:

```typescript
// When implementing activity: Check database schema
// Claude: Use mcp__supabase__list_tables to see available tables
// Claude: Use mcp__supabase__execute_sql to test queries
```

### Context7 MCP (Temporal Documentation)
Use for Temporal.io best practices:

```typescript
// When implementing workflow: Get Temporal.io documentation
// Claude: Use mcp__context7__resolve-library-id with "temporalio"
// Claude: Use mcp__context7__get-library-docs for workflow patterns
```

### Exa MCP (Code Examples)
Use for workflow pattern research:

```typescript
// When implementing Saga pattern: Find examples
// Claude: Use mcp__exa__get_code_context_exa with "Temporal Saga pattern"
```

## Documentation Standards

### Workflow Documentation Requirements
Each workflow must document:
- **Purpose**: What business process does it orchestrate?
- **Inputs**: TypeScript interface for workflow arguments
- **Outputs**: Return type and success criteria
- **Activities**: List of activities called (in order)
- **Compensation**: Saga compensation logic (if any)
- **Events**: Domain events emitted
- **Retry Policy**: Custom retry configuration (if any)

**Example**:
```typescript
/**
 * OrganizationBootstrapWorkflow
 *
 * Purpose: Orchestrates organization onboarding from creation to activation
 *
 * Inputs:
 *   - name: Organization name
 *   - slug: URL-safe organization identifier
 *   - admin_email: Initial admin user email
 *
 * Outputs:
 *   - org_id: Created organization ID
 *   - dns_record_id: Cloudflare DNS record ID
 *
 * Activities (in order):
 *   1. createOrganization - Creates organization record
 *   2. configureDNS - Creates Cloudflare CNAME record
 *   3. verifyDNS - Polls DNS until propagated
 *   4. generateInvitations - Creates invitation records
 *   5. sendInvitationEmails - Sends invitation emails
 *   6. activateOrganization - Sets organization status to active
 *
 * Compensation (Saga):
 *   - If any step fails after DNS creation: removeDNS(dns_record_id)
 *   - If any step fails after org creation: deactivateOrganization(org_id)
 *
 * Events Emitted:
 *   - organization.created
 *   - organization.dns_configured
 *   - organization.activated
 */
```

### Activity Documentation Requirements
Each activity must document:
- **Purpose**: What side effect does it perform?
- **Idempotency**: How is check-then-act implemented?
- **Retry Policy**: Temporal retry configuration
- **Events**: Domain events emitted (if any)
- **External Dependencies**: APIs called, providers used

### Event Schema Documentation (AsyncAPI)
All domain events defined in `infrastructure/supabase/contracts/asyncapi.yaml`:

```yaml
# AsyncAPI 3.0 spec
organization.created:
  payload:
    type: object
    properties:
      organization_id:
        type: string
        format: uuid
      name:
        type: string
      slug:
        type: string
      created_by:
        type: string
        format: uuid
```

## Definition of Done (Workflows)

Before marking workflow development complete:

### Code Quality
- [ ] Workflow is deterministic (no `Math.random()`, `Date.now()`, `fetch()`)
- [ ] Activities are idempotent (check-then-act pattern)
- [ ] Error handling delegates to Temporal retry (throw errors, don't swallow)
- [ ] Configuration validated on worker startup
- [ ] TypeScript strict mode passes with no errors

### Testing
- [ ] Unit tests with mock providers (`WORKFLOW_MODE=mock`)
- [ ] Workflow replay tests (no non-determinism errors)
- [ ] Integration tests with real providers (if applicable)
- [ ] Test coverage ≥ 80% for activities
- [ ] Tested compensation logic (Saga rollback)

### Documentation
- [ ] Workflow documented with purpose, inputs, outputs, activities, compensation
- [ ] Activities documented with idempotency pattern and retry policy
- [ ] Domain events defined in AsyncAPI spec
- [ ] Configuration variables added to .env.example
- [ ] README.md updated if adding new workflow

### Event-Driven Architecture
- [ ] All state changes emit domain events
- [ ] Event schema matches AsyncAPI contract
- [ ] Events trigger database projection updates (verify trigger exists)
- [ ] Event deduplication prevents duplicate processing

### Deployment Verification
- [ ] Docker image builds successfully
- [ ] Kubernetes ConfigMap updated with new environment variables
- [ ] Health check responds after deployment
- [ ] Worker connects to Temporal server
- [ ] Worker processes test workflow successfully
- [ ] Production mode uses real providers (`WORKFLOW_MODE=production`)
- [ ] Development mode uses logging providers (`WORKFLOW_MODE=development`)

### Cross-Component Integration
- [ ] Frontend can trigger workflow
- [ ] Frontend can query workflow status
- [ ] Database projections update correctly via events
- [ ] RLS policies allow service role access (activities use service_role_key)

## Additional Resources

- **Temporal Documentation**: Use Context7 MCP for `/temporalio/sdk-typescript`
- **Architecture Overview**: `documentation/architecture/workflows/temporal-overview.md`
- **Workflow Implementation**: `documentation/workflows/architecture/organization-bootstrap-workflow-design.md`
- **Event-Driven Guide**: `documentation/infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md`
- **AsyncAPI Contracts**: `infrastructure/supabase/contracts/asyncapi.yaml`
- **Configuration Reference**: `documentation/infrastructure/operations/configuration/ENVIRONMENT_VARIABLES.md`

## Quick Reference

**Start Development**:
```bash
# Terminal 1: Port-forward Temporal
kubectl port-forward -n temporal svc/temporal-frontend 7233:7233

# Terminal 2: Run worker
TEMPORAL_ADDRESS=localhost:7233 npm run dev
```

**Test Workflow**:
```bash
WORKFLOW_MODE=mock npm test
```

**Deploy Worker**:
```bash
kubectl apply -f infrastructure/k8s/temporal/worker-configmap.yaml
kubectl apply -f infrastructure/k8s/temporal/worker-deployment.yaml
kubectl rollout status deployment/workflow-worker -n temporal
```

**Check Worker Health**:
```bash
kubectl logs -n temporal -l app=workflow-worker --tail=100
```
