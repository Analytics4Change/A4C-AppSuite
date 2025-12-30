---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection for Temporal workflow job queue. Tracks bootstrap workflow execution status, enables workers to claim jobs via Supabase Realtime subscriptions. Supports retry handling and error tracking.

**When to read**:
- Understanding workflow execution tracking
- Debugging bootstrap workflow failures
- Implementing Temporal worker job claiming
- Querying workflow execution history

**Prerequisites**: [domain_events](./domain_events.md), [organizations_projection](./organizations_projection.md)

**Key topics**: `workflow-queue`, `temporal`, `job-queue`, `bootstrap-workflow`, `realtime`, `retry-handling`

**Estimated read time**: 8 minutes
<!-- TL;DR-END -->

# workflow_queue_projection

## Overview

CQRS projection table that serves as a job queue for Temporal workflow workers. When an `organization.bootstrap.initiated` event is emitted, a row is inserted into this table. Temporal workers subscribe to this table via Supabase Realtime and claim pending jobs for processing. The table tracks the complete lifecycle of workflow execution including retries and failures.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| event_id | uuid | NO | - | Reference to originating domain event |
| event_type | text | NO | - | Type of event (e.g., 'organization.bootstrap.initiated') |
| event_data | jsonb | NO | - | Complete event payload |
| stream_id | uuid | NO | - | Aggregate ID (organization_id) |
| stream_type | text | NO | - | Aggregate type ('organization') |
| status | text | NO | 'pending' | Job status |
| worker_id | text | YES | - | ID of worker that claimed the job |
| claimed_at | timestamptz | YES | - | When job was claimed by worker |
| workflow_id | text | YES | - | Temporal workflow ID |
| workflow_run_id | text | YES | - | Temporal workflow run ID |
| completed_at | timestamptz | YES | - | When job completed successfully |
| failed_at | timestamptz | YES | - | When job failed |
| error_message | text | YES | - | Error message if failed |
| error_stack | text | YES | - | Error stack trace if failed |
| retry_count | integer | NO | 0 | Number of retry attempts |
| result | jsonb | YES | - | Workflow execution result |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | NO | now() | Record update timestamp |

### Column Details

#### status

- **Type**: `text` with CHECK constraint
- **Purpose**: Tracks job lifecycle state
- **Values**:
  - `pending` - Job waiting to be claimed
  - `processing` - Job claimed and being executed
  - `completed` - Job finished successfully
  - `failed` - Job failed (may be retried)
- **Constraint**: `CHECK (status IN ('pending', 'processing', 'completed', 'failed'))`

#### worker_id

- **Type**: `text`
- **Purpose**: Identifies which Temporal worker claimed the job
- **Format**: Typically `{hostname}-{pid}` or similar identifier
- **Set When**: Job transitions from `pending` to `processing`

#### workflow_id / workflow_run_id

- **Type**: `text`
- **Purpose**: Links to actual Temporal workflow execution
- **Format**: `org-bootstrap-{subdomain}` for workflow_id
- **Set When**: Worker starts workflow execution

## Constraints

### Primary Key

```sql
PRIMARY KEY (id)
```

### Check Constraint

```sql
CHECK (status = ANY (ARRAY['pending', 'processing', 'completed', 'failed']))
```

Ensures status is always one of the valid values.

## Event Processing

This table is populated by triggers when workflow-related events are emitted:

### Insertion
When `organization.bootstrap.initiated` event is processed, a new row is inserted with:
- `status = 'pending'`
- `event_data` containing the bootstrap params
- `stream_id` = organization ID

### Status Updates
Workers update the status as they process:
1. `pending` → `processing` (claim job)
2. `processing` → `completed` (success)
3. `processing` → `failed` (error)

## Realtime Subscription

Temporal workers subscribe to pending jobs:

```typescript
// Worker subscription pattern
supabase
  .channel('workflow-queue')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'workflow_queue_projection',
    filter: 'status=eq.pending'
  }, (payload) => {
    // Claim and process the job
  })
  .subscribe();
```

## Usage Examples

### Query Pending Jobs

```sql
SELECT *
FROM workflow_queue_projection
WHERE status = 'pending'
ORDER BY created_at ASC;
```

### Query Failed Jobs for Retry

```sql
SELECT *
FROM workflow_queue_projection
WHERE status = 'failed'
  AND retry_count < 3
ORDER BY failed_at ASC;
```

### Query Workflow History for an Organization

```sql
SELECT
  workflow_id,
  status,
  created_at,
  completed_at,
  error_message
FROM workflow_queue_projection
WHERE stream_id = 'org-uuid-here'
ORDER BY created_at DESC;
```

### Claim a Job (Worker Pattern)

```sql
UPDATE workflow_queue_projection
SET
  status = 'processing',
  worker_id = 'worker-hostname-1234',
  claimed_at = now(),
  updated_at = now()
WHERE id = 'job-uuid-here'
  AND status = 'pending'
RETURNING *;
```

### Mark Job Complete

```sql
UPDATE workflow_queue_projection
SET
  status = 'completed',
  completed_at = now(),
  result = '{"orgId": "...", "domain": "..."}'::jsonb,
  updated_at = now()
WHERE id = 'job-uuid-here';
```

### Mark Job Failed

```sql
UPDATE workflow_queue_projection
SET
  status = 'failed',
  failed_at = now(),
  error_message = 'DNS verification timeout',
  error_stack = '...',
  retry_count = retry_count + 1,
  updated_at = now()
WHERE id = 'job-uuid-here';
```

## Performance Considerations

### Indexes

The table should have indexes on:
- `status` - For filtering pending jobs
- `stream_id` - For querying by organization
- `created_at` - For ordering pending jobs

### Retention

Old completed/failed jobs should be archived or deleted periodically to maintain query performance.

## Related Documentation

- [Organization Bootstrap Workflow](../../../workflows/architecture/organization-bootstrap-workflow-design.md) - Workflow design
- [domain_events](./domain_events.md) - Event store table
- [Event Sourcing Overview](../../../architecture/data/event-sourcing-overview.md) - CQRS pattern
