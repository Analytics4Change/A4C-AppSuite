# Event Emission

This guide covers domain event patterns for creating immutable audit trails in A4C-AppSuite Temporal workflows.

---

## Core Principle

**Every activity that changes state MUST emit a domain event.**

Events create an immutable audit trail required for HIPAA compliance and enable CQRS read models (projections) to stay synchronized.

---

## Domain Event Structure

### Event Schema

Events stored in `domain_events` table:

```sql
CREATE TABLE domain_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_data JSONB NOT NULL,
  metadata JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sequence_number BIGSERIAL
);
```

### Event Fields

**event_type**: What happened (e.g., `OrganizationCreated`, `DNSConfigured`, `InvitationSent`)

**aggregate_type**: Entity type (e.g., `Organization`, `Invitation`, `User`)

**aggregate_id**: Specific entity ID (UUID)

**event_data**: Domain-specific payload (JSONB)

**metadata**: Workflow context for traceability

**occurred_at**: Automatic timestamp

**sequence_number**: Global ordering

---

## Emitting Events from Activities

### Basic Pattern

```typescript
import { Context } from '@temporalio/activity'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function createOrganizationActivity(params: CreateOrgParams) {
  // 1. Perform side effect
  const { data: org, error } = await supabase
    .from('organizations')
    .insert({
      name: params.name,
      subdomain: params.subdomain
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create org: ${error.message}`)

  // 2. Emit domain event
  const workflowInfo = Context.current().info

  const { error: eventError } = await supabase
    .from('domain_events')
    .insert({
      event_type: 'OrganizationCreated',
      aggregate_type: 'Organization',
      aggregate_id: org.id,
      event_data: {
        name: org.name,
        subdomain: org.subdomain,
        created_at: org.created_at
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

  console.log(`[EVENT] OrganizationCreated: ${org.id}`)

  // 3. Return result
  return org.id
}
```

### Reusable Event Emission Helper

```typescript
import { Context } from '@temporalio/activity'

export async function emitDomainEvent(
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  eventData: Record<string, unknown>
): Promise<void> {
  const workflowInfo = Context.current().info

  const { error } = await supabase
    .from('domain_events')
    .insert({
      event_type: eventType,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      event_data: eventData,
      metadata: {
        workflow_id: workflowInfo.workflowId,
        workflow_run_id: workflowInfo.runId,
        workflow_type: workflowInfo.workflowType,
        activity_id: workflowInfo.activityId,
        emitted_at: new Date().toISOString()
      }
    })

  if (error) {
    throw new Error(`Failed to emit ${eventType} event: ${error.message}`)
  }

  console.log(`[EVENT] ${eventType} for ${aggregateType}:${aggregateId}`)
}

// Usage in activities
export async function myActivity(params) {
  const result = await doSomething(params)

  await emitDomainEvent(
    'SomethingHappened',
    'MyAggregate',
    result.id,
    { ...result }
  )

  return result.id
}
```

---

## Event Naming Conventions

### Event Type Format

Use **PastTense** format: `{Entity}{Action}` in past tense.

**Good examples**:
- `OrganizationCreated`
- `DNSConfigured`
- `InvitationSent`
- `UserActivated`
- `SubscriptionCancelled`

**Bad examples**:
- `CreateOrganization` (command, not event)
- `organization_created` (wrong casing)
- `OrgCreate` (incomplete/unclear)

### Aggregate Type Format

Use **PascalCase** singular nouns:
- `Organization`
- `Invitation`
- `User`
- `Subscription`
- `DNSRecord`

---

## Event Metadata

### Required Metadata Fields

Always include workflow context for traceability:

```typescript
metadata: {
  workflow_id: workflowInfo.workflowId,          // Unique workflow instance
  workflow_run_id: workflowInfo.runId,           // Specific execution run
  workflow_type: workflowInfo.workflowType,      // Workflow name
  activity_id: workflowInfo.activityId,          // Activity that emitted
  emitted_at: new Date().toISOString()           // Emission timestamp
}
```

### Optional Metadata Fields

```typescript
metadata: {
  ...requiredMetadata,
  user_id: params.userId,                        // Who triggered workflow
  correlation_id: params.correlationId,          // External request ID
  environment: process.env.NODE_ENV,             // prod/dev/staging
  worker_version: process.env.WORKER_VERSION     // Deployment version
}
```

### Querying Events by Workflow

```typescript
// Find all events emitted by a specific workflow
const { data: events } = await supabase
  .from('domain_events')
  .select('*')
  .eq('metadata->>workflow_id', workflowId)
  .order('occurred_at', { ascending: true })

// Reconstruct workflow execution from events
events.forEach(event => {
  console.log(`${event.occurred_at}: ${event.event_type}`, event.event_data)
})
```

---

## Event Data Design

### Include Relevant State

Event data should capture the state **after** the change:

```typescript
// ✅ Good - includes relevant state
await emitDomainEvent('OrganizationCreated', 'Organization', org.id, {
  name: org.name,
  subdomain: org.subdomain,
  created_at: org.created_at,
  admin_email: org.admin_email,
  plan: org.plan
})

// ❌ Bad - missing context
await emitDomainEvent('OrganizationCreated', 'Organization', org.id, {
  name: org.name
})
```

### Avoid Sensitive Data

Don't store passwords, tokens, or PII directly in events:

```typescript
// ✅ Good - no sensitive data
await emitDomainEvent('UserCreated', 'User', user.id, {
  email: user.email,
  role: user.role,
  created_at: user.created_at
})

// ❌ Bad - includes password hash
await emitDomainEvent('UserCreated', 'User', user.id, {
  email: user.email,
  password_hash: user.password_hash  // NO!
})
```

### Keep Events Immutable

Never modify existing events. Emit new events instead:

```typescript
// ✅ Correct - emit new event for state change
await emitDomainEvent('OrganizationUpdated', 'Organization', orgId, {
  name: newName,
  previous_name: oldName,
  updated_at: new Date().toISOString()
})

// ❌ Wrong - modifying existing event
await supabase
  .from('domain_events')
  .update({ event_data: { name: newName } })
  .eq('aggregate_id', orgId)  // DON'T DO THIS!
```

---

## Creating New Event Types

When introducing a new event type, follow this checklist:

### 1. Emit Event in Activity

Implement event emission in your activity as shown above.

### 2. Register Event Schema in AsyncAPI Contract

**All new event types must be registered in the AsyncAPI specification.**

This ensures:
- Contract-first development
- Type safety across services
- Automatic API documentation
- Schema validation

**See**: `infrastructure/supabase/contracts/README.md` for AsyncAPI contract structure and registration requirements.

### 3. Update Projection Triggers (if needed)

If your event should update a CQRS projection (read model), add trigger logic.

**Note**: Activities emit events only. PostgreSQL triggers update projections (infrastructure layer).

**See**: `infrastructure/CLAUDE.md` for projection trigger patterns.

---

## Event Ordering

### Sequence Numbers

Events have automatic `sequence_number` for global ordering:

```sql
-- Query events in order
SELECT * FROM domain_events
ORDER BY sequence_number ASC;
```

### Per-Aggregate Ordering

Order events for specific aggregate:

```typescript
const { data: orgEvents } = await supabase
  .from('domain_events')
  .select('*')
  .eq('aggregate_type', 'Organization')
  .eq('aggregate_id', orgId)
  .order('occurred_at', { ascending: true })

// Events in chronological order:
// 1. OrganizationCreated
// 2. DNSConfigured
// 3. DatabaseProvisioned
// 4. InvitationSent
```

---

## CQRS Pattern Overview

**Activities' Responsibility**: Emit events to `domain_events` table (this document).

**Infrastructure's Responsibility**: PostgreSQL triggers process events and update projection tables.

**Frontend's Responsibility**: Query projection tables for denormalized read models.

**Event Flow**:
1. Activity emits event → `domain_events` table
2. PostgreSQL trigger processes event → Updates projection table
3. Frontend queries projection → Gets current state

For projection trigger implementation, see `infrastructure/CLAUDE.md`.

---

## Complete Example

```typescript
import { Context } from '@temporalio/activity'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Reusable helper
async function emitEvent(
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  eventData: Record<string, unknown>
) {
  const info = Context.current().info

  const { error } = await supabase.from('domain_events').insert({
    event_type: eventType,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    event_data: eventData,
    metadata: {
      workflow_id: info.workflowId,
      workflow_run_id: info.runId,
      workflow_type: info.workflowType,
      activity_id: info.activityId
    }
  })

  if (error) throw new Error(`Event emission failed: ${error.message}`)
  console.log(`[EVENT] ${eventType} for ${aggregateType}:${aggregateId}`)
}

// Activity using event emission
export async function configureDNSActivity(params: DNSParams) {
  // 1. Check if already done (idempotency)
  const existingRecords = await cloudflare.dns.records.list({
    zone_id: params.zoneId,
    name: `${params.subdomain}.${params.domain}`
  })

  if (existingRecords.length > 0) {
    console.log('DNS already configured')
    return existingRecords[0].id
  }

  // 2. Configure DNS
  const record = await cloudflare.dns.records.create({
    zone_id: params.zoneId,
    type: 'CNAME',
    name: params.subdomain,
    content: params.target,
    ttl: 1  // Automatic
  })

  // 3. Emit domain event
  await emitEvent('DNSConfigured', 'Organization', params.orgId, {
    subdomain: params.subdomain,
    dns_record_id: record.id,
    target: params.target,
    configured_at: new Date().toISOString()
  })

  // 4. Return result
  return record.id
}
```

---

## Summary

✅ **Always emit events** - Every state change gets an event to `domain_events` table
✅ **Use past tense naming** - `OrganizationCreated` not `CreateOrganization`
✅ **Include workflow metadata** - Enable traceability back to workflow
✅ **Keep events immutable** - Never modify existing events
✅ **Design clear event data** - Include relevant state, avoid sensitive data
✅ **Register new event types** - Add to AsyncAPI spec (see `infrastructure/supabase/contracts/README.md`)
✅ **Projections via triggers** - Infrastructure updates read models (see `infrastructure/CLAUDE.md`)
✅ **Events enable audit trail** - HIPAA compliance with 7-year retention

See [testing-workflows.md](testing-workflows.md) for testing event-driven workflows.
