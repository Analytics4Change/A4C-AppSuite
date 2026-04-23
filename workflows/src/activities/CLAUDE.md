---
status: current
last_updated: 2026-04-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Rules for files under `workflows/src/activities/` — three-layer idempotency, mandatory event emission with audit context, business-scoped correlation IDs, and the state-change-then-emit ordering rule.

**When to read**:
- Writing a new Temporal activity
- Modifying an existing activity that touches Supabase or external APIs
- Adding event emission to an activity
- Debugging duplicate side effects (emails sent twice, DNS records created twice)
- Tracing a multi-activity workflow by `correlation_id`

**Prerequisites**: Understanding of Temporal activities and event sourcing

**Key topics**: `activities`, `idempotency`, `event-emission`, `audit-context`, `correlation-id`, `tracing`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# Activities Guidelines

This file governs `workflows/src/activities/`. Activities are where side effects happen. Three rules: be idempotent, emit events, and propagate tracing context.

## Three-Layer Idempotency

Activities MUST be safe to retry — Temporal will retry them on failure, on worker crash, and on timeout. Every activity needs idempotency at one or more layers:

### Layer 1 — Workflow ID

Unique workflow ID prevents duplicate workflow executions:

```typescript
await client.workflow.start(organizationBootstrapWorkflow, {
  workflowId: `org-bootstrap-${orgId}`,  // Unique ID prevents duplicates
  taskQueue: 'bootstrap',
  args: [input],
});
```

### Layer 2 — Activity Check-Then-Act

Activities check existence before creating:

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

### Layer 3 — Event Deduplication

Database prevents duplicate event processing:

```sql
-- Event insertion with unique constraint
INSERT INTO domain_events (event_id, event_type, stream_id, ...)
VALUES (gen_random_uuid(), 'organization.created', ...)
ON CONFLICT (stream_id, event_type, created_at) DO NOTHING;
```

## Activity Implementation Best Practices

### Idempotency

```typescript
// ✅ Check-then-act pattern
async function createResource(id: string) {
  const existing = await db.findById(id);
  if (existing) return existing;
  return await db.create({ id });
}

// ❌ Not idempotent (creates duplicate on retry)
async function badCreate(id: string) {
  return await db.create({ id });  // Error on retry!
}
```

### Error Handling — Let Temporal Retry

```typescript
// ✅ Throw errors for Temporal to retry
async function reliableActivity() {
  try {
    return await externalAPI.call();
  } catch (error) {
    console.error('Activity failed, will retry:', error);
    throw error;  // Temporal retries automatically
  }
}
```

### Heartbeats for Long-Running Activities

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

## Event Emission Pattern

**All activities that modify state MUST emit domain events.** State changes without events break CQRS projections, audit trail, and event-driven workflows downstream.

```typescript
import { emitEvent } from '../shared/utils/emit-event';

async function createOrganizationActivity(input: OrgInput): Promise<string> {
  // 1. Perform state change FIRST
  const { data } = await supabase
    .from('organizations_projection')
    .insert({ name: input.name, slug: input.slug })
    .select()
    .single();

  // 2. Emit domain event with audit context
  await emitEvent({
    event_type: 'organization.created',
    aggregate_type: 'organization',
    aggregate_id: data.id,
    event_data: {
      name: data.name,
      slug: data.slug,
      created_by: input.created_by,
    },
    user_id: input.initiated_by_user_id,
    reason: 'Organization bootstrap workflow',
  });

  return data.id;
}
```

### Ordering Rule: State First, Then Event

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

### Missing Event Emission

```typescript
// ❌ WRONG: State change without event
async function createOrgActivity(input: OrgInput) {
  const { data } = await supabase.from('organizations_projection').insert({...});
  return data.id;  // No event emitted!
}

// ✅ CORRECT: Always emit event after state change
async function createOrgActivity(input: OrgInput) {
  const { data } = await supabase.from('organizations_projection').insert({...});
  await emitEvent({ event_type: 'organization.created', ... });
  return data.id;
}
```

## Audit Context in Events

**The `domain_events` table is the SINGLE SOURCE OF TRUTH for all audit queries.** No separate audit table — all audit context goes in event metadata.

| Field | When to Include | Example |
|-------|-----------------|---------|
| `user_id` | Always (who initiated) | UUID of initiating user |
| `reason` | When action has business context | `"Organization bootstrap workflow"` |
| `ip_address` | Edge Functions only | From request headers |
| `user_agent` | Edge Functions only | From request headers |
| `request_id` | When available from API layer | Correlation with API logs |

### Workflow Input Pattern — Accept Audit Context

```typescript
interface OrganizationBootstrapInput {
  // Business fields
  name: string;
  subdomain: string;
  admin_email: string;

  // Audit context (passed from API caller)
  initiated_by_user_id?: string;
  initiated_reason?: string;
  request_context?: {
    ip_address?: string;
    user_agent?: string;
    request_id?: string;
  };
}
```

### Audit Query Examples

```sql
-- Who changed this organization?
SELECT event_type, event_metadata->>'user_id' as actor,
       event_metadata->>'reason' as reason, created_at
FROM domain_events
WHERE stream_id = '<org_id>'
ORDER BY created_at DESC;

-- Trace a workflow execution
SELECT * FROM domain_events
WHERE event_metadata->>'workflow_id' = '<workflow_id>'
ORDER BY created_at;
```

### Event Schema Validation

- Event schemas defined in `infrastructure/supabase/contracts/asyncapi.yaml`
- Validate `event_data` matches schema before emitting
- Use TypeScript types generated from AsyncAPI spec (import from `@/types/events`, never hand-write)

## Correlation ID Pattern (Business-Scoped)

`correlation_id` ties together the ENTIRE business transaction lifecycle, not just a single request.

### Activity Implementation

- **Never generate** new `correlation_id` in activities
- **Always use** `params.tracing.correlationId` from workflow input
- Workflow receives `tracing` from API layer (via `extractTracingFromHeaders`)

### Example — Using Tracing in Activities

```typescript
import { buildTracingForEvent } from '@shared/utils/emit-event.js';

async function sendInvitationEmailsActivity(params: SendInvitationEmailsParams) {
  await emitEvent({
    event_type: 'user.invited',
    aggregate_id: params.invitationId,
    event_data: { ... },
    // Use workflow's tracing context — preserves original correlation_id
    ...buildTracingForEvent(params.tracing, 'sendInvitationEmails'),
  });
}
```

### API Layer Extracts and Passes Tracing

```typescript
// workflows/src/api/routes/workflows.ts
const tracing = extractTracingFromHeaders(request.headers);
await client.workflow.start('organizationBootstrapWorkflow', {
  args: [{ ...params, tracing }],  // Pass tracing to workflow
});
```

### Why It Matters

```sql
SELECT event_type, created_at FROM domain_events
WHERE correlation_id = 'abc-123'::uuid ORDER BY created_at;
-- user.invited → invitation.resent → invitation.accepted (same ID)
```

## Common Pitfalls

### Activity Not Idempotent

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

### Generating New Correlation IDs

```typescript
// ❌ WRONG: Breaks lifecycle tracing
await emitEvent({
  event_type: 'invitation.resent',
  correlation_id: crypto.randomUUID(),  // New ID disconnects from original invitation
  ...
});

// ✅ CORRECT: Use workflow's tracing context
...buildTracingForEvent(params.tracing, 'resendInvitation'),
```

## Related Documentation

- [Workflows CLAUDE.md](../../CLAUDE.md) — Tech stack, saga pattern, provider pattern, testing, DoD (parent)
- [Workflow CLAUDE.md](../workflows/CLAUDE.md) — Workflow determinism rules
- [Event metadata schema](../../../documentation/workflows/reference/event-metadata-schema.md) — Correlation strategy reference
- [Activities reference catalog](../../../documentation/workflows/reference/activities-reference.md) — Existing activities
- [Event-driven architecture](../../../documentation/infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md) — Backend event sourcing
