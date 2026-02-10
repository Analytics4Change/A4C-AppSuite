# organization.bootstrap.workflow_started

**Event Type**: Domain Event
**Stream Type**: organization
**Emitted By**: Event Listener (workflow worker)
**AsyncAPI Contract**: [infrastructure/supabase/contracts/organization-bootstrap-events.yaml](../../../../infrastructure/supabase/contracts/organization-bootstrap-events.yaml)

## Purpose

Records that the event listener successfully started a Temporal workflow in response to an `organization.bootstrap.initiated` event. Provides audit trail linking domain events to workflow executions.

This event maintains event sourcing immutability by creating a **new event** rather than updating the existing `bootstrap.initiated` event.

## Triggering Conditions

1. Event listener receives `organization.bootstrap.initiated` via PostgreSQL NOTIFY
2. Successfully starts Temporal workflow via `temporalClient.workflow.start()`
3. Receives workflow handle with `workflowId` and `firstExecutionRunId`
4. Calls `api.emit_workflow_started_event()` Supabase RPC function

## Event Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| bootstrap_event_id | UUID | Yes | ID of the organization.bootstrap.initiated event that triggered this workflow |
| workflow_id | String | Yes | Temporal workflow ID (deterministic: `org-bootstrap-{stream_id}`) |
| workflow_run_id | String | Yes | Temporal workflow execution run ID (unique per execution) |
| workflow_type | String | Yes | Temporal workflow type name (e.g., `organizationBootstrapWorkflow`) |

### Event Metadata

| Field | Type | Description |
|-------|------|-------------|
| triggered_by | String | Always `event_listener` |
| trigger_time | Timestamp | ISO 8601 timestamp when workflow was started |

## Example Payload

```json
{
  "id": "c5e9d8a3-1f42-4e7b-9c3d-2a1b5e8f7d9c",
  "stream_id": "d8846196-8f69-46dc-af9a-87a57843c4e4",
  "stream_type": "organization",
  "stream_version": 2,
  "event_type": "organization.bootstrap.workflow_started",
  "event_data": {
    "bootstrap_event_id": "b8309521-a46f-4d71-becb-1f138878425b",
    "workflow_id": "org-bootstrap-d8846196-8f69-46dc-af9a-87a57843c4e4",
    "workflow_run_id": "019ab7a4-a6bf-70a3-8394-7b09371e98ba",
    "workflow_type": "organizationBootstrapWorkflow"
  },
  "event_metadata": {
    "triggered_by": "event_listener",
    "trigger_time": "2025-11-24T20:53:32.529Z"
  },
  "created_at": "2025-11-24T20:53:32.540Z",
  "processed_at": "2025-11-24T20:53:32.550Z"
}
```

## Query Examples

### Find workflow execution for a bootstrap event

```sql
SELECT
  initiated.id as bootstrap_event_id,
  initiated.created_at as bootstrap_initiated_at,
  started.id as workflow_started_event_id,
  started.event_data->>'workflow_id' as workflow_id,
  started.event_data->>'workflow_run_id' as workflow_run_id,
  started.created_at as workflow_start_time,
  (started.created_at - initiated.created_at) as latency
FROM domain_events initiated
JOIN domain_events started
  ON started.stream_id = initiated.stream_id
  AND started.event_type = 'organization.bootstrap.workflow_started'
  AND started.event_data->>'bootstrap_event_id' = initiated.id::text
WHERE initiated.event_type = 'organization.bootstrap.initiated'
  AND initiated.id = 'b8309521-a46f-4d71-becb-1f138878425b';
```

### Find all workflow starts for an organization

```sql
SELECT
  id,
  event_data->>'workflow_id' as workflow_id,
  event_data->>'workflow_run_id' as workflow_run_id,
  event_data->>'bootstrap_event_id' as bootstrap_event_id,
  created_at,
  event_metadata->>'trigger_time' as trigger_time
FROM domain_events
WHERE stream_id = 'd8846196-8f69-46dc-af9a-87a57843c4e4'
  AND event_type = 'organization.bootstrap.workflow_started'
ORDER BY created_at DESC;
```

### Find workflows without corresponding workflow_started events (debugging)

```sql
-- Find bootstrap.initiated events that never started workflows
SELECT
  initiated.id,
  initiated.stream_id,
  initiated.created_at,
  initiated.event_data->>'organization_name' as org_name,
  EXTRACT(EPOCH FROM (NOW() - initiated.created_at)) as age_seconds
FROM domain_events initiated
LEFT JOIN domain_events started
  ON started.stream_id = initiated.stream_id
  AND started.event_type = 'organization.bootstrap.workflow_started'
  AND started.event_data->>'bootstrap_event_id' = initiated.id::text
WHERE initiated.event_type = 'organization.bootstrap.initiated'
  AND started.id IS NULL
  AND initiated.created_at > NOW() - INTERVAL '24 hours'
ORDER BY initiated.created_at DESC;
```

### Trace complete bootstrap flow

```sql
-- Trace from initiated → workflow_started → created → completed
WITH bootstrap_flow AS (
  SELECT
    stream_id,
    event_type,
    created_at,
    event_data,
    CASE event_type
      WHEN 'organization.bootstrap.initiated' THEN 1
      WHEN 'organization.bootstrap.workflow_started' THEN 2
      WHEN 'organization.created' THEN 3
      WHEN 'organization.bootstrap.completed' THEN 4
      ELSE 99
    END as event_order
  FROM domain_events
  WHERE stream_id = 'd8846196-8f69-46dc-af9a-87a57843c4e4'
    AND event_type IN (
      'organization.bootstrap.initiated',
      'organization.bootstrap.workflow_started',
      'organization.created',
      'organization.bootstrap.completed'
    )
)
SELECT
  event_type,
  created_at,
  LAG(created_at) OVER (ORDER BY event_order) as previous_event_time,
  created_at - LAG(created_at) OVER (ORDER BY event_order) as time_since_previous,
  event_data->>'workflow_id' as workflow_id,
  event_data->>'organization_name' as org_name
FROM bootstrap_flow
ORDER BY event_order;
```

## Related Events

### Precedes This Event
- **organization.bootstrap.initiated** - Emitted by Edge Function, triggers workflow start via PostgreSQL NOTIFY

### Follows This Event
- **organization.created** - Emitted by workflow activity after creating organization
- **organization.bootstrap.completed** - Emitted when workflow completes successfully
- **organization.bootstrap.failed** - Emitted if workflow fails

## Architecture Pattern

This event is part of the **Event-Driven Workflow Triggering** pattern:

```
1. Edge Function
   ↓ INSERT domain_events
2. organization.bootstrap.initiated
   ↓ PostgreSQL trigger → pg_notify('workflow_events')
3. Event Listener (LISTEN on workflow_events channel)
   ↓ temporalClient.workflow.start()
4. Temporal Workflow Started
   ↓ supabaseClient.rpc('emit_workflow_started_event')
5. organization.bootstrap.workflow_started (this event)
   ↓ workflow executes activities
6. organization.created, etc.
```

### Why Not Update bootstrap.initiated?

**Event Sourcing Principle**: Events are **immutable**. Once created, they should never be modified.

❌ **Anti-Pattern**: Updating existing events
```sql
-- DON'T DO THIS
UPDATE domain_events
SET event_metadata = jsonb_build_object('workflow_id', '...')
WHERE id = bootstrap_event_id;
```

✅ **Correct Pattern**: Creating new events
```sql
-- DO THIS INSTEAD
INSERT INTO domain_events (event_type, event_data, ...)
VALUES ('organization.bootstrap.workflow_started', ...);
```

## Implementation

### SQL Function
Location: `infrastructure/supabase/sql/03-functions/api/emit_workflow_started_event.sql`

```sql
SELECT api.emit_workflow_started_event(
  p_stream_id := 'd8846196-8f69-46dc-af9a-87a57843c4e4',
  p_bootstrap_event_id := 'b8309521-a46f-4d71-becb-1f138878425b',
  p_workflow_id := 'org-bootstrap-d8846196-8f69-46dc-af9a-87a57843c4e4',
  p_workflow_run_id := '019ab7a4-a6bf-70a3-8394-7b09371e98ba',
  p_workflow_type := 'organizationBootstrapWorkflow'
);
```

### TypeScript (Worker)
Location: `workflows/src/worker/event-listener.ts`

```typescript
private async emitWorkflowStartedEvent(
  streamId: string,
  bootstrapEventId: string,
  workflowId: string,
  workflowRunId: string
): Promise<void> {
  const { data: eventId, error } = await this.supabaseClient.rpc(
    'emit_workflow_started_event',
    {
      p_stream_id: streamId,
      p_bootstrap_event_id: bootstrapEventId,
      p_workflow_id: workflowId,
      p_workflow_run_id: workflowRunId,
      p_workflow_type: 'organizationBootstrapWorkflow'
    }
  );
}
```

## Monitoring

### Alert Conditions

1. **High latency** between `bootstrap.initiated` and `workflow_started`:
   ```sql
   -- Alert if > 5 seconds
   SELECT COUNT(*)
   FROM domain_events initiated
   JOIN domain_events started ON ...
   WHERE (started.created_at - initiated.created_at) > INTERVAL '5 seconds';
   ```

2. **Missing workflow_started events**:
   ```sql
   -- Alert if bootstrap.initiated without workflow_started after 30 seconds
   SELECT COUNT(*)
   FROM domain_events initiated
   LEFT JOIN domain_events started ON ...
   WHERE initiated.created_at < NOW() - INTERVAL '30 seconds'
     AND started.id IS NULL;
   ```

3. **High failure rate**:
   ```sql
   -- Alert if > 5% of workflows fail to start
   WITH stats AS (
     SELECT
       COUNT(*) FILTER (WHERE event_type = 'organization.bootstrap.initiated') as total,
       COUNT(*) FILTER (WHERE event_type = 'organization.bootstrap.workflow_started') as started
     FROM domain_events
     WHERE created_at > NOW() - INTERVAL '1 hour'
   )
   SELECT total, started, (total - started)::float / total as failure_rate
   FROM stats
   WHERE (total - started)::float / total > 0.05;
   ```

## See Also

- [AsyncAPI Contract](../../../../infrastructure/supabase/contracts/organization-bootstrap-events.yaml)
- [Temporal Workflow Architecture](../../../architecture/workflows/temporal-overview.md)
- [Event-Driven Triggering](../../../architecture/data/event-sourcing-overview.md)
- [CQRS Projections](../../../architecture/data/event-sourcing-overview.md)
