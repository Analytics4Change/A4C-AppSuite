---
status: current
last_updated: 2026-04-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Temporal.io workflow component guide — tech stack, provider patterns, saga compensation, configuration, testing, deployment, and Definition of Done. Subdirectory CLAUDE.md files cover workflow determinism and activity idempotency rules.

**When to read**:
- Setting up the workflow worker locally
- Understanding the saga / provider / configuration patterns
- Adding a new DNS or email provider
- Configuring `WORKFLOW_MODE` for a new environment
- Reviewing the Definition of Done before merge

**Prerequisites**: Basic Temporal.io concepts, Node.js/TypeScript

**Key topics**: `temporal`, `saga`, `provider-pattern`, `configuration`, `cloudflare-dns`, `resend-email`

**Estimated read time**: 12 minutes (full), 4 minutes (relevant sections)
<!-- TL;DR-END -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A4C Workflows implements durable, fault-tolerant business process orchestration using Temporal.io. This component manages long-running operations like organization onboarding, DNS provisioning, and user invitations with automatic retry, compensation (Saga pattern), and event sourcing.

## Technology Stack

- **Orchestration**: Temporal.io (workflow engine)
- **Runtime**: Node.js 20+ with TypeScript
- **Database**: Supabase PostgreSQL (event store + projections)
- **DNS Provider**: Cloudflare API
- **Email Providers**: Resend API (primary), SMTP (fallback) — see [Resend Email Provider Guide](../documentation/workflows/guides/resend-email-provider.md)
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

## Subdirectory CLAUDE.md Files

For domain-specific rules, see the CLAUDE.md file in the relevant subdirectory:

| Path | Covers |
|------|--------|
| [`src/workflows/CLAUDE.md`](src/workflows/CLAUDE.md) | Workflow-first pattern, determinism rules (forbidden APIs in workflows), replay testing |
| [`src/activities/CLAUDE.md`](src/activities/CLAUDE.md) | Three-layer idempotency, event emission with audit context, correlation ID propagation |

This file (workflows/CLAUDE.md) covers cross-cutting concerns: saga pattern, provider configuration, testing, deployment, DoD.

## Architecture Patterns (Cross-Cutting)

### CQRS / Event Sourcing

All state changes emit domain events that update read projections:

- **Command**: Activity creates/updates entity
- **Event**: Activity emits domain event (e.g., `OrganizationCreated`)
- **Projection**: Database trigger updates read model (e.g., `organizations_projection`)

Detail and event-emission rules in [`src/activities/CLAUDE.md`](src/activities/CLAUDE.md).

### Saga Pattern (Compensation)

Workflows implement rollback via compensation activities — call them in reverse order on failure. The full pattern with compensation example is in [`src/workflows/CLAUDE.md`](src/workflows/CLAUDE.md).

### Provider Pattern (Pluggable Dependencies)

DNS and Email providers selected via configuration:

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
WORKFLOW_MODE=development  # → LoggingDNS + LoggingEmail (console logs)
WORKFLOW_MODE=production   # → CloudflareDNS + ResendEmail (real providers)
WORKFLOW_MODE=mock         # → MockDNS + MockEmail (in-memory, testing)
```

## Configuration Management

**Master Control Variable**: `WORKFLOW_MODE`

```bash
WORKFLOW_MODE=development  # Console logs, no real resources
WORKFLOW_MODE=mock         # In-memory mocks, fast tests
WORKFLOW_MODE=production   # Real DNS, real emails
```

**Provider Override** (advanced):
```bash
WORKFLOW_MODE=development
DNS_PROVIDER=cloudflare
CLOUDFLARE_API_TOKEN=your-token
# EMAIL_PROVIDER defaults to logging
```

**Validation runs on worker startup**:
```typescript
import { validateConfig } from './shared/config/validate-config';
const config = validateConfig(process.env);
// ❌ Configuration has errors:
//    • DNS_PROVIDER=cloudflare requires CLOUDFLARE_API_TOKEN
```

### Common Pitfall: No Config Validation

```typescript
// ❌ WRONG: No validation, fails at runtime with cryptic error
const dnsProvider = new CloudflareDNSProvider({
  token: process.env.CLOUDFLARE_API_TOKEN  // Undefined → cryptic error
});

// ✅ CORRECT: Validate config on startup
const config = validateConfig(process.env);  // Throws clear error if invalid
const dnsProvider = createDNSProvider(config);
```

## Testing Patterns

### Unit Tests (Mock Mode)

```bash
WORKFLOW_MODE=mock npm test
```

```typescript
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

Required for every workflow change — see [`src/workflows/CLAUDE.md`](src/workflows/CLAUDE.md) for the full pattern.

### Integration Tests (Real Providers)

```bash
WORKFLOW_MODE=production npm test -- --testPathPattern=integration
```

```typescript
describe('DNS Integration', () => {
  it('should create real DNS record', async () => {
    const result = await configureDNSActivity({
      domain: 'test.example.com',
      recordType: 'CNAME',
      value: 'target.example.com'
    });
    expect(result.id).toBeDefined();
    await removeDNSActivity(result);  // Cleanup
  });
});
```

## Cross-Component Integration

### Frontend → Workflows

Frontend triggers workflows via Temporal client:

```typescript
import { client } from '@/lib/temporal';

async function createOrganization(orgData: OrgInput) {
  const handle = await client.workflow.start(organizationBootstrapWorkflow, {
    workflowId: `org-bootstrap-${orgData.slug}`,
    taskQueue: 'bootstrap',
    args: [orgData],
  });
  return handle.result();
}
```

### Workflows → Infrastructure (Events)

Activities emit events that update database projections via PostgreSQL triggers (`infrastructure/supabase/sql/04-triggers/`). See [`src/activities/CLAUDE.md`](src/activities/CLAUDE.md) for emission rules.

### Workflows → Infrastructure (Database)

Activities use Supabase service role for database access:

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // Bypasses RLS
);
```

## MCP Tool Usage

- **Supabase MCP**: Use for database queries during workflow development (`mcp__supabase__list_tables`, `mcp__supabase__execute_sql`)
- **Context7 MCP**: Use for Temporal.io documentation (`mcp__context7__resolve-library-id` with `"temporalio"`)
- **Exa MCP**: Use for workflow pattern research (`mcp__exa__get_code_context_exa`)

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

### Activity Documentation Requirements

Each activity must document:

- **Purpose**: What side effect does it perform?
- **Idempotency**: How is check-then-act implemented?
- **Retry Policy**: Temporal retry configuration
- **Events**: Domain events emitted (if any)
- **External Dependencies**: APIs called, providers used

### Event Schema Documentation

All domain events defined in `infrastructure/supabase/contracts/asyncapi.yaml`. Frontend imports types from `@/types/events`, never hand-write.

## Definition of Done (Workflows)

### Code Quality
- [ ] Workflow is deterministic (no `Math.random()`, `Date.now()`, `fetch()`) — see [`src/workflows/CLAUDE.md`](src/workflows/CLAUDE.md)
- [ ] Activities are idempotent (check-then-act pattern) — see [`src/activities/CLAUDE.md`](src/activities/CLAUDE.md)
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
- [ ] Configuration variables added to `.env.example`
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
- [ ] RLS policies allow service role access (activities use `service_role_key`)

## Quick Reference

**Start Development**:
```bash
# Terminal 1: Port-forward Temporal
kubectl port-forward -n temporal svc/temporal-frontend 7233:7233

# Terminal 2: Run worker
TEMPORAL_ADDRESS=localhost:7233 npm run dev
```

**Test Workflow**: `WORKFLOW_MODE=mock npm test`

**Deploy Worker**:
```bash
kubectl apply -f infrastructure/k8s/temporal/worker-configmap.yaml
kubectl apply -f infrastructure/k8s/temporal/worker-deployment.yaml
kubectl rollout status deployment/workflow-worker -n temporal
```

**Check Worker Health**: `kubectl logs -n temporal -l app=workflow-worker --tail=100`

## Documentation Resources

- **[Subdirectory CLAUDE.md files](#subdirectory-claudemd-files)** — Workflow + activity rules
- **[Temporal Architecture Overview](../documentation/architecture/workflows/temporal-overview.md)** — Complete orchestration design
- **[Organization Onboarding Workflow](../documentation/architecture/workflows/organization-onboarding-workflow.md)** — Reference workflow
- **[Activities Reference](../documentation/workflows/reference/activities-reference.md)** — Complete activity catalog
- **[Event Metadata Schema](../documentation/workflows/reference/event-metadata-schema.md)** — Correlation strategy reference
- **[Resend Email Provider Guide](../documentation/workflows/guides/resend-email-provider.md)** — Email setup, monitoring, key rotation
- **[Agent Navigation Index](../documentation/AGENT-INDEX.md)** — Keyword-based doc navigation for AI agents
- **[Agent Guidelines](../documentation/AGENT-GUIDELINES.md)** — Documentation creation and update rules
- **[Workflows Documentation](../documentation/workflows/)** — All workflow-specific documentation
