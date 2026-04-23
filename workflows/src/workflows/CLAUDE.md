---
status: current
last_updated: 2026-04-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Rules for files under `workflows/src/workflows/` — workflow determinism, the workflow-first orchestration pattern, and what is forbidden inside a workflow function.

**When to read**:
- Writing a new Temporal workflow
- Modifying an existing workflow
- Debugging a non-determinism error in `Worker.runReplayHistory`
- Understanding why a workflow can't call `fetch()` directly

**Prerequisites**: Temporal.io fundamentals, basic TypeScript

**Key topics**: `temporal`, `workflows`, `determinism`, `orchestration`, `replay`

**Estimated read time**: 6 minutes
<!-- TL;DR-END -->

# Workflows Guidelines

This file governs `workflows/src/workflows/`. Two rules: workflows orchestrate, and workflows are deterministic.

## Workflow-First Pattern

**ALL business logic orchestrated through Temporal workflows**, not direct API calls or database updates:

- Workflows are **deterministic** (same input → same output, always)
- Workflows contain orchestration logic, not side effects
- Side effects happen in **activities** (non-deterministic operations) — see [`../activities/CLAUDE.md`](../activities/CLAUDE.md)

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

## Workflow Determinism Requirements

**Workflows MUST be deterministic** — Temporal replays workflows from history. Any non-determinism causes replay errors when workers restart or when `Worker.runReplayHistory` validates a workflow.

### Forbidden in Workflows

- `Math.random()`, `Date.now()`, `new Date()`
- Network calls: `fetch()`, `axios.get()`, any HTTP client
- Database queries (Supabase, raw `pg`, anything)
- File system operations
- Non-deterministic timers: `setTimeout()`, `setInterval()`
- Reading from environment variables (capture them at activity time, pass via input)
- Any third-party SDK that performs I/O internally

### Allowed in Workflows

- `await activities.*()` — Call activities for side effects
- `workflow.sleep(duration)` — Deterministic sleep
- `workflow.condition(predicate)` — Wait for condition
- `workflow.random()` — Deterministic random (seeded from workflow ID)
- `workflow.now()` — Deterministic time (from workflow start)
- `workflow.uuid4()` — Deterministic UUID
- Pure functions over input data
- Calling other workflows (child workflows) or signals

## Saga Pattern (Compensation)

Workflows implement rollback via compensation activities — call them in reverse order on failure:

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
    await activities.emitBootstrapCompleted(orgId);  // Trigger handler sets is_active=true

  } catch (error) {
    // Compensation flow (reverse order)
    if (dnsRecord) {
      await activities.removeDNS(dnsRecord);  // Compensate DNS creation
    }
    if (orgId) {
      await activities.emitBootstrapFailed(orgId);  // Handler sets is_active=false
      await activities.deactivateOrganization(orgId);  // Safety net fallback
    }
    throw error;
  }
}
```

The compensation activities themselves must be idempotent — see [`../activities/CLAUDE.md`](../activities/CLAUDE.md).

## Replay Testing

Every workflow must pass replay validation:

```typescript
it('should replay without non-determinism errors', async () => {
  const history = await getWorkflowHistory('workflow-id');
  await Worker.runReplayHistory({ history });
  // Throws if workflow has non-deterministic code
});
```

Run replay tests in CI on every workflow change. A passing test today does not guarantee replay safety tomorrow if you add forbidden APIs.

## Common Pitfalls

### Random in Workflow

```typescript
// ❌ WRONG: Different value on replay
export async function badWorkflow() {
  const random = Math.random();
  if (random > 0.5) { /* ... */ }
}

// ✅ CORRECT: Deterministic random
export async function goodWorkflow() {
  const random = workflow.random();  // Same value on replay
  if (random > 0.5) { /* ... */ }
}
```

### Reading Time in Workflow

```typescript
// ❌ WRONG: System clock varies between original execution and replay
const now = Date.now();

// ✅ CORRECT: Workflow's deterministic clock
const now = workflow.now();
```

### Calling Side Effects Directly

```typescript
// ❌ WRONG: Network call in workflow body
const data = await fetch('https://api.example.com').then(r => r.json());

// ✅ CORRECT: Wrap in an activity
const data = await activities.fetchExternalData();
```

## Related Documentation

- [Workflows CLAUDE.md](../../CLAUDE.md) — Tech stack, saga pattern, provider pattern, testing, DoD (parent)
- [Activities CLAUDE.md](../activities/CLAUDE.md) — Idempotency, event emission, audit context
- [Temporal architecture overview](../../../documentation/architecture/workflows/temporal-overview.md) — Complete orchestration design
- [Organization bootstrap workflow design](../../../documentation/workflows/architecture/organization-bootstrap-workflow-design.md) — Reference example
