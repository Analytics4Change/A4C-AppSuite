---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Complete schema for `event_metadata` JSONB column. Auto-populated workflow fields: `workflow_id`, `workflow_run_id`, `workflow_type`, `activity_id`. Required: `timestamp` (ISO 8601). Recommended: `tags[]`, `source`. Error tracking: `processing_error`, `retry_count`. Four partial indexes optimize workflow/activity queries. Use `emitEvent()` utility for automatic workflow context capture.

**When to read**:
- Emitting domain events with proper metadata
- Querying events by workflow or activity
- Understanding event-workflow traceability
- Debugging event processing errors

**Prerequisites**: [triggering-workflows](../guides/triggering-workflows.md)

**Key topics**: `event-metadata`, `workflow-traceability`, `timestamp`, `tags`, `processing-error`, `jsonb-indexes`

**Estimated read time**: 18 minutes
<!-- TL;DR-END -->

# Event Metadata Schema Reference

## Overview

This document defines the complete schema for the `event_metadata` JSONB column in the `domain_events` table. Event metadata contains contextual information about events, including workflow traceability, timing, tags, and error tracking.

**Last Updated**: 2025-11-24 (Event-Driven Workflow Triggering Implementation)

## Schema Structure

```typescript
interface EventMetadata {
  // Workflow Traceability (automatically populated by worker)
  workflow_id?: string;        // Temporal workflow ID
  workflow_run_id?: string;    // Temporal workflow run ID (unique per execution)
  workflow_type?: string;      // Workflow function name
  activity_id?: string;        // Activity function name (if event from activity)

  // Timing
  timestamp: string;           // ISO 8601 timestamp (required)

  // Context and Tags
  tags?: string[];             // Contextual tags for filtering/grouping
  source?: string;             // Event source (ui, api, cron, webhook)
  user_id?: string;            // User who triggered event (if applicable)
  correlation_id?: string;     // External correlation ID

  // Error Tracking
  processing_error?: string;   // Error message if workflow start failed
  retry_count?: number;        // Number of retry attempts

  // Custom Fields
  [key: string]: any;          // Additional custom metadata
}
```

## Field Definitions

### Workflow Traceability

These fields create bi-directional links between events and workflows. They are **automatically populated** by the workflow worker when processing events or emitting events from activities.

#### `workflow_id`

**Type**: `string`
**Required**: No (populated automatically)
**Populated By**: Worker (when starting workflow) or Activity (when emitting event)
**Format**: Application-defined (e.g., `org-bootstrap-{organizationId}`)
**Purpose**: Links event to the workflow instance that processed it
**Example**: `"org-bootstrap-550e8400-e29b-41d4-a716-446655440000"`

**Usage**:
```sql
-- Find all events for a workflow
SELECT * FROM domain_events
WHERE event_metadata->>'workflow_id' = 'org-bootstrap-abc123';
```

#### `workflow_run_id`

**Type**: `string`
**Required**: No (populated automatically)
**Populated By**: Worker or Activity
**Format**: Temporal-generated UUID
**Purpose**: Uniquely identifies a specific execution of a workflow (handles retries)
**Example**: `"f47ac10b-58cc-4372-a567-0e02b2c3d479"`

**Usage**:
```sql
-- Find events from specific workflow execution
SELECT * FROM domain_events
WHERE event_metadata->>'workflow_run_id' = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
```

**Note**: If workflow retried, `workflow_id` stays same but `workflow_run_id` changes.

#### `workflow_type`

**Type**: `string`
**Required**: No (populated automatically)
**Populated By**: Worker or Activity
**Format**: Workflow function name from code
**Purpose**: Identifies which workflow processed the event
**Example**: `"organizationBootstrapWorkflow"`

**Usage**:
```sql
-- Find all events processed by specific workflow type
SELECT * FROM domain_events
WHERE event_metadata->>'workflow_type' = 'organizationBootstrapWorkflow';
```

#### `activity_id`

**Type**: `string`
**Required**: No (populated automatically)
**Populated By**: Activity (when emitting event)
**Format**: Activity function name from code
**Purpose**: Identifies which activity emitted the event
**Example**: `"createOrganizationActivity"`

**Usage**:
```sql
-- Find all events emitted by specific activity
SELECT * FROM domain_events
WHERE event_metadata->>'activity_id' = 'createOrganizationActivity';
```

**Note**: Only present on events emitted by activities, not on trigger events.

### Timing

#### `timestamp`

**Type**: `string` (ISO 8601 format)
**Required**: Yes (always)
**Populated By**: Application code
**Format**: `YYYY-MM-DDTHH:mm:ss.sssZ`
**Purpose**: Records exact time event occurred (business logic timestamp)
**Example**: `"2025-11-24T15:30:45.123Z"`

**Usage**:
```typescript
// ✅ Always include timestamp when emitting event
await supabase.from('domain_events').insert({
  event_type: 'organization.bootstrap_initiated',
  event_metadata: {
    timestamp: new Date().toISOString(), // Required
    tags: ['production']
  }
});
```

**Note**: Different from `created_at` column (database insertion time). Use `timestamp` for business logic, `created_at` for audit.

### Context and Tags

#### `tags`

**Type**: `string[]`
**Required**: No (recommended)
**Populated By**: Application code
**Format**: Array of lowercase strings
**Purpose**: Categorize events for filtering, grouping, debugging
**Example**: `["production", "ui-triggered", "experiment-abc"]`

**Common Tags**:
- **Environment**: `production`, `staging`, `development`
- **Source**: `ui-triggered`, `api-triggered`, `cron-triggered`, `webhook-triggered`
- **User Context**: `user-{userId}`, `org-{orgId}`
- **Features**: `experiment-{name}`, `feature-{flag}`
- **Priority**: `high-priority`, `low-priority`

**Usage**:
```sql
-- Find all production UI-triggered events
SELECT * FROM domain_events
WHERE event_metadata->'tags' ? 'production'
  AND event_metadata->'tags' ? 'ui-triggered';
```

**Best Practice**: Always include environment tag (`production`, `development`).

#### `source`

**Type**: `string`
**Required**: No (recommended)
**Populated By**: Application code
**Format**: Lowercase string (common values: `ui`, `api`, `cron`, `webhook`, `worker`)
**Purpose**: Identifies origin of event
**Example**: `"ui"`

**Usage**:
```typescript
// Edge Function emitting event
event_metadata: {
  timestamp: new Date().toISOString(),
  source: 'api',
  tags: ['production']
}

// Cron job emitting event
event_metadata: {
  timestamp: new Date().toISOString(),
  source: 'cron',
  tags: ['daily-cleanup']
}
```

#### `user_id`

**Type**: `string`
**Required**: No (include if event triggered by user)
**Populated By**: Application code
**Format**: UUID
**Purpose**: Links event to user who triggered it
**Example**: `"123e4567-e89b-12d3-a456-426614174000"`

**Usage**:
```typescript
// Include user_id when user triggers event
const { data: { user } } = await supabase.auth.getUser();

await supabase.from('domain_events').insert({
  event_type: 'organization.bootstrap_initiated',
  event_metadata: {
    timestamp: new Date().toISOString(),
    user_id: user.id, // Track who created org
    tags: ['production']
  }
});
```

**Query**:
```sql
-- Find all events triggered by specific user
SELECT * FROM domain_events
WHERE event_metadata->>'user_id' = '123e4567-e89b-12d3-a456-426614174000';
```

#### `correlation_id`

**Type**: `string`
**Required**: No (use for distributed tracing)
**Populated By**: Application code
**Format**: UUID or external trace ID
**Purpose**: Links related events across systems
**Example**: `"trace-550e8400-e29b-41d4-a716-446655440000"`

**Usage**:
```typescript
// Frontend generates correlation ID
const correlationId = uuidv4();

// Pass to Edge Function
await fetch('/api/create-organization', {
  headers: { 'X-Correlation-ID': correlationId },
  body: JSON.stringify({ name, slug })
});

// Edge Function includes in event
const correlationId = req.headers.get('X-Correlation-ID');
await supabase.from('domain_events').insert({
  event_metadata: {
    timestamp: new Date().toISOString(),
    correlation_id: correlationId // Link to frontend request
  }
});
```

**Query**:
```sql
-- Find all events for a request trace
SELECT * FROM domain_events
WHERE event_metadata->>'correlation_id' = 'trace-abc123'
ORDER BY created_at ASC;
```

### Error Tracking

#### `processing_error`

**Type**: `string`
**Required**: No (populated automatically on failure)
**Populated By**: Worker (when workflow start fails)
**Format**: Error message string
**Purpose**: Records why workflow start failed
**Example**: `"Temporal server unavailable: connection timeout"`

**Usage**:
```sql
-- Find all events with processing errors
SELECT
  id,
  event_type,
  event_metadata->>'processing_error' AS error,
  retry_count
FROM domain_events
WHERE event_metadata->>'processing_error' IS NOT NULL
ORDER BY created_at DESC;
```

**Common Errors**:
- `"Temporal server unavailable: connection timeout"` → Temporal down or unreachable
- `"Workflow already running: duplicate workflow ID"` → Idempotency protection (expected)
- `"Invalid event data: missing required field 'name'"` → Validation failure
- `"Database connection lost: reconnecting..."` → Transient network issue

#### `retry_count`

**Type**: `number`
**Required**: No (populated automatically on retry)
**Populated By**: Worker (incremented on each retry)
**Format**: Integer (0, 1, 2, ...)
**Purpose**: Tracks how many times worker attempted to start workflow
**Example**: `3`

**Usage**:
```sql
-- Find events that failed after multiple retries
SELECT
  id,
  event_type,
  event_metadata->>'processing_error' AS error,
  event_metadata->>'retry_count' AS retries
FROM domain_events
WHERE (event_metadata->>'retry_count')::int > 3
ORDER BY created_at DESC;
```

**Alert Threshold**: Alert if `retry_count > 3` (indicates persistent failure).

### Custom Fields

The `event_metadata` JSONB column supports custom fields for application-specific needs.

**Example**:
```typescript
event_metadata: {
  timestamp: new Date().toISOString(),
  tags: ['production'],

  // Custom fields
  client_ip: req.headers.get('X-Forwarded-For'),
  user_agent: req.headers.get('User-Agent'),
  referrer: req.headers.get('Referer'),
  request_id: req.headers.get('X-Request-ID'),

  // A/B testing
  experiment_variant: 'new-ui',
  experiment_cohort: 'control',

  // Feature flags
  feature_flags: ['dark-mode', 'new-dashboard']
}
```

**Query Custom Fields**:
```sql
-- Find events from specific experiment variant
SELECT * FROM domain_events
WHERE event_metadata->>'experiment_variant' = 'new-ui';

-- Find events with specific feature flag enabled
SELECT * FROM domain_events
WHERE event_metadata->'feature_flags' ? 'dark-mode';
```

## Complete Examples

### Trigger Event (Emitted by UI/API)

```typescript
// Edge Function: Create Organization
const { data: event } = await supabase
  .from('domain_events')
  .insert({
    event_type: 'organization.bootstrap_initiated',
    aggregate_type: 'organization',
    aggregate_id: organizationId,
    event_data: {
      name: 'Acme Corp',
      slug: 'acme-corp',
      owner_email: 'owner@acme.com',
      tier: 'premium',
      subdomain_enabled: true
    },
    event_metadata: {
      // Required
      timestamp: '2025-11-24T15:30:45.123Z',

      // Recommended
      tags: ['production', 'ui-triggered'],
      source: 'api',
      user_id: '123e4567-e89b-12d3-a456-426614174000',

      // Optional custom fields
      correlation_id: 'trace-abc123',
      client_ip: '192.168.1.100',
      user_agent: 'Mozilla/5.0...'
    }
  })
  .select()
  .single();
```

**After Worker Processing** (workflow started successfully):
```json
{
  "workflow_id": "org-bootstrap-550e8400-e29b-41d4-a716-446655440000",
  "workflow_run_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "workflow_type": "organizationBootstrapWorkflow",
  "timestamp": "2025-11-24T15:30:45.123Z",
  "tags": ["production", "ui-triggered"],
  "source": "api",
  "user_id": "123e4567-e89b-12d3-a456-426614174000",
  "correlation_id": "trace-abc123",
  "client_ip": "192.168.1.100",
  "user_agent": "Mozilla/5.0..."
}
```

### Activity Event (Emitted by Workflow Activity)

```typescript
// Activity: createOrganizationActivity
import { emitEvent } from '@shared/utils/emit-event';

async function createOrganizationActivity(input: CreateOrgInput) {
  // Create organization in database
  const org = await createOrg(input);

  // Emit event (workflow context automatically captured)
  await emitEvent({
    eventType: 'organization.created',
    aggregateType: 'organization',
    aggregateId: org.id,
    eventData: {
      name: org.name,
      slug: org.slug,
      tier: org.tier,
      owner_id: org.owner_id
    },
    metadata: {
      timestamp: new Date().toISOString(),
      tags: ['production'],
      // No need to manually add workflow context - automatic!
    }
  });

  return org;
}
```

**Emitted Event Metadata** (automatically enhanced):
```json
{
  "workflow_id": "org-bootstrap-550e8400-e29b-41d4-a716-446655440000",
  "workflow_run_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "workflow_type": "organizationBootstrapWorkflow",
  "activity_id": "createOrganizationActivity",
  "timestamp": "2025-11-24T15:30:46.456Z",
  "tags": ["production"]
}
```

### Failed Event (Workflow Start Failed)

```json
{
  "timestamp": "2025-11-24T15:30:45.123Z",
  "tags": ["production", "ui-triggered"],
  "source": "api",
  "processing_error": "Temporal server unavailable: connection timeout after 5000ms",
  "retry_count": 3
}
```

## Indexes for Performance

Four indexes optimize queries on `event_metadata`:

```sql
-- Index 1: Query events by workflow_id
CREATE INDEX idx_domain_events_workflow_id
ON domain_events ((event_metadata->>'workflow_id'))
WHERE event_metadata->>'workflow_id' IS NOT NULL;

-- Index 2: Query events by workflow_run_id
CREATE INDEX idx_domain_events_workflow_run_id
ON domain_events ((event_metadata->>'workflow_run_id'))
WHERE event_metadata->>'workflow_run_id' IS NOT NULL;

-- Index 3: Composite index for workflow + event type queries
CREATE INDEX idx_domain_events_workflow_type
ON domain_events (
  (event_metadata->>'workflow_id'),
  event_type
)
WHERE event_metadata->>'workflow_id' IS NOT NULL;

-- Index 4: Query events by activity_id
CREATE INDEX idx_domain_events_activity_id
ON domain_events ((event_metadata->>'activity_id'))
WHERE event_metadata->>'activity_id' IS NOT NULL;
```

**Usage**:
```sql
-- Fast query using idx_domain_events_workflow_id
SELECT * FROM domain_events
WHERE event_metadata->>'workflow_id' = 'org-bootstrap-abc123';

-- Fast query using idx_domain_events_workflow_type
SELECT * FROM domain_events
WHERE event_metadata->>'workflow_id' = 'org-bootstrap-abc123'
  AND event_type = 'organization.created';

-- Fast query using idx_domain_events_activity_id
SELECT * FROM domain_events
WHERE event_metadata->>'activity_id' = 'createOrganizationActivity';
```

## Validation Rules

### Required Fields

**All Events** (enforced at application layer):
- `timestamp` (ISO 8601 string)

**Recommended Fields**:
- `tags` (at minimum: environment tag)
- `source` (origin of event)

### Field Constraints

| Field | Type | Max Length | Pattern |
|-------|------|------------|---------|
| `workflow_id` | string | 255 chars | Application-defined |
| `workflow_run_id` | string | 36 chars | UUID v4 |
| `workflow_type` | string | 100 chars | camelCase |
| `activity_id` | string | 100 chars | camelCase |
| `timestamp` | string | - | ISO 8601 |
| `tags` | array | 10 items | lowercase, no spaces |
| `source` | string | 50 chars | lowercase |
| `user_id` | string | 36 chars | UUID v4 |
| `correlation_id` | string | 255 chars | Application-defined |
| `processing_error` | string | 1000 chars | - |
| `retry_count` | number | - | >= 0 |

## TypeScript Types

```typescript
// workflows/src/shared/types/event-metadata.ts

/**
 * Event metadata schema for domain_events.event_metadata column
 */
export interface EventMetadata {
  // Workflow Traceability (auto-populated by worker/activities)
  workflow_id?: string;
  workflow_run_id?: string;
  workflow_type?: string;
  activity_id?: string;

  // Timing (required)
  timestamp: string; // ISO 8601

  // Context and Tags (recommended)
  tags?: string[];
  source?: 'ui' | 'api' | 'cron' | 'webhook' | 'worker' | string;
  user_id?: string;
  correlation_id?: string;

  // Error Tracking (auto-populated on failure)
  processing_error?: string;
  retry_count?: number;

  // Custom fields
  [key: string]: any;
}

/**
 * Input for emitEvent() utility
 */
export interface EmitEventMetadata {
  timestamp: string;
  tags?: string[];
  source?: string;
  user_id?: string;
  correlation_id?: string;
  [key: string]: any;
}
```

## Query Patterns

### Find Unprocessed Events

```sql
-- Events that haven't been processed by worker yet
SELECT
  id,
  event_type,
  aggregate_id,
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at)) AS age_seconds
FROM domain_events
WHERE event_metadata->>'workflow_id' IS NULL
  AND event_metadata->>'processing_error' IS NULL
ORDER BY created_at DESC;
```

### Find Events with Errors

```sql
-- Events that failed to start workflow
SELECT
  id,
  event_type,
  aggregate_id,
  event_metadata->>'processing_error' AS error,
  (event_metadata->>'retry_count')::int AS retries,
  created_at
FROM domain_events
WHERE event_metadata->>'processing_error' IS NOT NULL
ORDER BY created_at DESC;
```

### Find Events by Workflow

```sql
-- All events for a workflow (trigger + activity events)
SELECT
  event_type,
  event_metadata->>'activity_id' AS activity,
  event_data,
  created_at
FROM domain_events
WHERE event_metadata->>'workflow_id' = 'org-bootstrap-abc123'
ORDER BY created_at ASC;
```

### Find Events by User

```sql
-- All events triggered by a user
SELECT
  event_type,
  aggregate_type,
  aggregate_id,
  created_at
FROM domain_events
WHERE event_metadata->>'user_id' = '123e4567-e89b-12d3-a456-426614174000'
ORDER BY created_at DESC;
```

### Find Events by Tags

```sql
-- Production UI-triggered events
SELECT
  event_type,
  aggregate_id,
  created_at
FROM domain_events
WHERE event_metadata->'tags' ? 'production'
  AND event_metadata->'tags' ? 'ui-triggered'
ORDER BY created_at DESC;
```

### Find Events by Correlation ID

```sql
-- Trace all events for a distributed request
SELECT
  event_type,
  event_metadata->>'workflow_id' AS workflow_id,
  event_metadata->>'activity_id' AS activity_id,
  created_at
FROM domain_events
WHERE event_metadata->>'correlation_id' = 'trace-abc123'
ORDER BY created_at ASC;
```

## Migration History

### 2025-11-24: Event-Workflow Linking

**Migration**: `018-event-workflow-linking-index.sql`

**Changes**:
- Added 4 new indexes on `event_metadata` for workflow traceability
- No schema changes to `event_metadata` structure (already JSONB)
- Enhanced `emitEvent()` utility to auto-capture workflow context

**Backward Compatibility**: ✅ Fully compatible
- Old events without workflow context remain queryable
- New events automatically include workflow context
- Indexes only apply to events with workflow fields (partial indexes)

## Related Documentation

- **Triggering Workflows Guide**: `documentation/workflows/guides/triggering-workflows.md`
- **Event-Driven Architecture**: `documentation/architecture/workflows/event-driven-workflow-triggering.md`
- **EventQueries API**: `workflows/src/shared/utils/event-queries.ts`
- **emitEvent Utility**: `workflows/src/shared/utils/emit-event.ts`
- **Database Schema**: `infrastructure/supabase/sql/02-tables/events/domain_events.sql`

## Support

For questions about event metadata:
1. Review examples in this document
2. Check `emitEvent()` utility for automatic field population
3. Query `domain_events` table to see real-world examples
4. Review architecture documentation for workflow traceability patterns
