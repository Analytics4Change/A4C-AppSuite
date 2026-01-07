---
status: current
last_updated: 2026-01-07
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Complete schema for `event_metadata` JSONB column and dedicated tracing columns. Auto-populated workflow fields: `workflow_id`, `workflow_run_id`, `workflow_type`, `activity_id`. W3C Trace Context fields: `trace_id`, `span_id`, `parent_span_id`, `session_id`, `correlation_id` (promoted to columns for query performance). Timing: `duration_ms`. Required: `timestamp` (ISO 8601). Recommended: `tags[]`, `source`. Error tracking: `processing_error`, `retry_count`. Indexes optimize workflow, tracing, and activity queries.

**When to read**:
- Emitting domain events with proper metadata
- Querying events by workflow or activity
- Understanding event-workflow traceability
- Debugging event processing errors
- Implementing distributed tracing across services

**Prerequisites**: [triggering-workflows](../guides/triggering-workflows.md), [event-observability](../../infrastructure/guides/event-observability.md)

**Key topics**: `event-metadata`, `workflow-traceability`, `timestamp`, `tags`, `processing-error`, `jsonb-indexes`, `trace-id`, `span-id`, `parent-span-id`, `session-id`, `correlation-id`, `duration-ms`, `w3c-trace-context`

**Estimated read time**: 22 minutes
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

  // Distributed Tracing - W3C Trace Context compatible
  // NOTE: These fields are ALSO stored in dedicated columns for query performance
  trace_id?: string;           // W3C trace ID (32 hex chars) - stored in column
  span_id?: string;            // Operation span ID (16 hex chars) - stored in column
  parent_span_id?: string;     // Parent span for causation chains - stored in column
  session_id?: string;         // Supabase Auth session ID (UUID) - stored in column
  correlation_id?: string;     // Business request correlation (UUID) - stored in column
  duration_ms?: number;        // Operation duration in milliseconds

  // Service Context
  service_name?: string;       // 'edge-function', 'temporal-worker', 'frontend'
  operation_name?: string;     // Operation being performed

  // Timing
  timestamp: string;           // ISO 8601 timestamp (required)

  // Context and Tags
  tags?: string[];             // Contextual tags for filtering/grouping
  source?: string;             // Event source (ui, api, cron, webhook)
  user_id?: string;            // User who triggered event (if applicable)

  // Error Tracking
  processing_error?: string;   // Error message if workflow start failed
  retry_count?: number;        // Number of retry attempts

  // Custom Fields
  [key: string]: any;          // Additional custom metadata
}
```

### Column vs JSONB Storage Strategy

**Why some fields have dedicated columns**:

Five tracing fields are promoted to dedicated columns in the `domain_events` table (not just JSONB):

| Field | Column Type | Why Column? |
|-------|-------------|-------------|
| `correlation_id` | `UUID` | High-cardinality queries by request |
| `session_id` | `UUID` | Session-level debugging queries |
| `trace_id` | `TEXT` | W3C format, trace timeline reconstruction |
| `span_id` | `TEXT` | Operation-level queries |
| `parent_span_id` | `TEXT` | Causation chain traversal |

**Benefits of column promotion**:
1. **Query Performance**: Composite indexes like `(correlation_id, created_at DESC)` enable sub-100ms queries
2. **JSONB Limitation**: Extracting from JSONB prevents index usage in `WHERE correlation_id = X AND created_at > Y`
3. **Schema Validation**: Column types enforce format (UUID vs TEXT)

**Automatic Population**: The `api.emit_domain_event()` function automatically extracts these fields from `p_event_metadata` JSONB and populates the columns. You don't need to pass them separately.

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
-- Find all events for a request trace (uses column index)
SELECT * FROM domain_events
WHERE correlation_id = '550e8400-e29b-41d4-a716-446655440000'::uuid
ORDER BY created_at ASC;
```

### Distributed Tracing (W3C Trace Context)

These fields enable end-to-end request tracing across frontend, Edge Functions, Temporal workflows, and database. They support [W3C Trace Context](https://www.w3.org/TR/trace-context/) for APM tool interoperability.

#### `trace_id`

**Type**: `string`
**Required**: No (auto-populated by tracing utilities)
**Populated By**: Frontend tracing utils, Edge Function `extractTracingContext()`, or worker
**Format**: 32 lowercase hex characters (W3C compatible)
**Column**: `trace_id TEXT` (promoted from JSONB)
**Purpose**: Unique identifier for an entire distributed trace
**Example**: `"4bf92f3577b34da6a3ce929d0e0e4736"`

**Usage**:
```sql
-- Find all events in a trace (uses column index)
SELECT * FROM domain_events
WHERE trace_id = '4bf92f3577b34da6a3ce929d0e0e4736'
ORDER BY created_at ASC;

-- Or use RPC function for hierarchical view
SELECT * FROM api.get_trace_timeline('4bf92f3577b34da6a3ce929d0e0e4736');
```

**Note**: Generated from UUID v4 without dashes. Same trace_id links all events from a single user request across services.

#### `span_id`

**Type**: `string`
**Required**: No (auto-populated by tracing utilities)
**Populated By**: Edge Function `createSpan()`, activity `buildTracingForEvent()`
**Format**: 16 lowercase hex characters (W3C compatible)
**Column**: `span_id TEXT` (promoted from JSONB)
**Purpose**: Unique identifier for a single operation within a trace
**Example**: `"00f067aa0ba902b7"`

**Usage**:
```sql
-- Find specific operation
SELECT * FROM domain_events
WHERE span_id = '00f067aa0ba902b7';
```

**Note**: Each Edge Function call, Temporal activity, or distinct operation gets a unique span_id.

#### `parent_span_id`

**Type**: `string`
**Required**: No (NULL for root spans)
**Populated By**: `createSpan()` from current context's span_id
**Format**: 16 lowercase hex characters
**Column**: `parent_span_id TEXT` (promoted from JSONB)
**Purpose**: Links to parent operation, enabling call tree reconstruction
**Example**: `"a716446655440000"`

**Usage**:
```sql
-- Find child operations of a span
SELECT * FROM domain_events
WHERE parent_span_id = 'a716446655440000'
ORDER BY created_at ASC;

-- Reconstruct call tree (using CTE)
WITH RECURSIVE trace_tree AS (
  -- Root spans (no parent)
  SELECT id, event_type, span_id, parent_span_id, 0 AS depth
  FROM domain_events
  WHERE trace_id = '4bf92f3577b34da6a3ce929d0e0e4736'
    AND parent_span_id IS NULL

  UNION ALL

  -- Child spans
  SELECT e.id, e.event_type, e.span_id, e.parent_span_id, tt.depth + 1
  FROM domain_events e
  JOIN trace_tree tt ON e.parent_span_id = tt.span_id
  WHERE e.trace_id = '4bf92f3577b34da6a3ce929d0e0e4736'
)
SELECT * FROM trace_tree ORDER BY depth, created_at;
```

**Note**: NULL indicates a root span (entry point). The `api.get_trace_timeline()` RPC function provides this logic.

#### `session_id`

**Type**: `string`
**Required**: No (populated from JWT when available)
**Populated By**: Frontend `getSessionId()`, extracted from Supabase Auth JWT
**Format**: UUID v4
**Column**: `session_id UUID` (promoted from JSONB)
**Purpose**: Links events to user authentication session
**Example**: `"f47ac10b-58cc-4372-a567-0e02b2c3d479"`

**Usage**:
```sql
-- Find all events for a user session (uses column index)
SELECT * FROM domain_events
WHERE session_id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'::uuid
ORDER BY created_at ASC;

-- Or use RPC function
SELECT * FROM api.get_events_by_session('f47ac10b-58cc-4372-a567-0e02b2c3d479'::uuid);
```

**Note**: Tied to Supabase Auth session. Session ID changes when user logs out and back in.

#### `duration_ms`

**Type**: `number`
**Required**: No (populated by span timing)
**Populated By**: `endSpan()` calculates from start time
**Format**: Integer milliseconds
**Storage**: JSONB only (not promoted to column)
**Purpose**: Measures operation latency for performance analysis
**Example**: `245`

**Usage**:
```sql
-- Find slow operations (>1 second)
SELECT
  id,
  event_type,
  (event_metadata->>'duration_ms')::int AS duration_ms,
  event_metadata->>'operation_name' AS operation,
  created_at
FROM domain_events
WHERE (event_metadata->>'duration_ms')::int > 1000
ORDER BY (event_metadata->>'duration_ms')::int DESC
LIMIT 20;

-- Average duration by event type
SELECT
  event_type,
  AVG((event_metadata->>'duration_ms')::numeric) AS avg_ms,
  MAX((event_metadata->>'duration_ms')::int) AS max_ms,
  COUNT(*) AS count
FROM domain_events
WHERE event_metadata->>'duration_ms' IS NOT NULL
GROUP BY event_type
ORDER BY avg_ms DESC;
```

**Note**: Captures end-to-end operation time. Useful for identifying performance bottlenecks.

#### `service_name`

**Type**: `string`
**Required**: No (recommended for debugging)
**Populated By**: Application code
**Format**: Lowercase string
**Storage**: JSONB only
**Purpose**: Identifies which service emitted the event
**Values**: `'edge-function'`, `'temporal-worker'`, `'frontend'`
**Example**: `"edge-function"`

#### `operation_name`

**Type**: `string`
**Required**: No (recommended for debugging)
**Populated By**: `createSpan(context, operationName)` or `buildEventMetadata()`
**Format**: kebab-case or camelCase
**Storage**: JSONB only
**Purpose**: Identifies the specific operation being performed
**Example**: `"invite-user"`, `"createOrganizationActivity"`

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

### Tracing Column Indexes (Promoted Columns)

Three composite indexes optimize tracing queries on dedicated columns:

```sql
-- Index 1: Query by correlation_id with time range
CREATE INDEX CONCURRENTLY idx_events_correlation_time
ON domain_events (correlation_id, created_at DESC)
WHERE correlation_id IS NOT NULL;

-- Index 2: Query by session_id with time range
CREATE INDEX CONCURRENTLY idx_events_session_time
ON domain_events (session_id, created_at DESC)
WHERE session_id IS NOT NULL;

-- Index 3: Query by trace_id with time range
CREATE INDEX CONCURRENTLY idx_events_trace_time
ON domain_events (trace_id, created_at DESC)
WHERE trace_id IS NOT NULL;
```

**Usage**:
```sql
-- Fast correlation lookup (uses column index)
SELECT * FROM domain_events
WHERE correlation_id = '550e8400-e29b-41d4-a716-446655440000'::uuid
ORDER BY created_at DESC;

-- Fast session lookup (uses column index)
SELECT * FROM domain_events
WHERE session_id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'::uuid
ORDER BY created_at DESC;

-- Fast trace lookup (uses column index)
SELECT * FROM domain_events
WHERE trace_id = '4bf92f3577b34da6a3ce929d0e0e4736'
ORDER BY created_at DESC;
```

### Workflow Metadata Indexes (JSONB)

Four indexes optimize queries on `event_metadata` JSONB:

```sql
-- Index 4: Query events by workflow_id
CREATE INDEX idx_domain_events_workflow_id
ON domain_events ((event_metadata->>'workflow_id'))
WHERE event_metadata->>'workflow_id' IS NOT NULL;

-- Index 5: Query events by workflow_run_id
CREATE INDEX idx_domain_events_workflow_run_id
ON domain_events ((event_metadata->>'workflow_run_id'))
WHERE event_metadata->>'workflow_run_id' IS NOT NULL;

-- Index 6: Composite index for workflow + event type queries
CREATE INDEX idx_domain_events_workflow_type
ON domain_events (
  (event_metadata->>'workflow_id'),
  event_type
)
WHERE event_metadata->>'workflow_id' IS NOT NULL;

-- Index 7: Query events by activity_id
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

| Field | Type | Max Length | Pattern | Storage |
|-------|------|------------|---------|---------|
| `workflow_id` | string | 255 chars | Application-defined | JSONB |
| `workflow_run_id` | string | 36 chars | UUID v4 | JSONB |
| `workflow_type` | string | 100 chars | camelCase | JSONB |
| `activity_id` | string | 100 chars | camelCase | JSONB |
| `trace_id` | string | 32 chars | 32 lowercase hex | **Column** |
| `span_id` | string | 16 chars | 16 lowercase hex | **Column** |
| `parent_span_id` | string | 16 chars | 16 lowercase hex | **Column** |
| `session_id` | string | 36 chars | UUID v4 | **Column** |
| `correlation_id` | string | 36 chars | UUID v4 | **Column** |
| `duration_ms` | number | - | >= 0 | JSONB |
| `service_name` | string | 50 chars | lowercase | JSONB |
| `operation_name` | string | 100 chars | kebab-case/camelCase | JSONB |
| `timestamp` | string | - | ISO 8601 | JSONB |
| `tags` | array | 10 items | lowercase, no spaces | JSONB |
| `source` | string | 50 chars | lowercase | JSONB |
| `user_id` | string | 36 chars | UUID v4 | JSONB |
| `processing_error` | string | 1000 chars | - | JSONB |
| `retry_count` | number | - | >= 0 | JSONB |

## TypeScript Types

```typescript
// workflows/src/shared/types/index.ts

/**
 * Event metadata schema for domain_events.event_metadata column
 */
export interface EventMetadata {
  // Workflow Traceability (auto-populated by worker/activities)
  workflow_id?: string;
  workflow_run_id?: string;
  workflow_type?: string;
  activity_id?: string;

  // Distributed Tracing - W3C Trace Context compatible
  // NOTE: Also stored in dedicated columns for query performance
  trace_id?: string;         // 32 hex chars - stored in column
  span_id?: string;          // 16 hex chars - stored in column
  parent_span_id?: string;   // 16 hex chars - stored in column
  session_id?: string;       // UUID - stored in column
  correlation_id?: string;   // UUID - stored in column
  duration_ms?: number;      // Operation duration

  // Service Context
  service_name?: string;     // 'edge-function', 'temporal-worker', 'frontend'
  operation_name?: string;   // Operation being performed

  // Timing (required)
  timestamp: string; // ISO 8601

  // Context and Tags (recommended)
  tags?: string[];
  source?: 'ui' | 'api' | 'cron' | 'webhook' | 'worker' | string;
  user_id?: string;

  // Error Tracking (auto-populated on failure)
  processing_error?: string;
  retry_count?: number;

  // Custom fields
  [key: string]: any;
}

/**
 * Tracing context for distributed tracing
 */
export interface TracingContext {
  correlationId: string;      // Business request correlation
  sessionId: string | null;   // Supabase Auth session
  traceId: string;            // W3C trace ID (32 hex)
  spanId: string;             // Current operation span (16 hex)
  parentSpanId: string | null; // Parent operation span
  sampled: boolean;           // Whether trace is sampled
}

/**
 * Subset of tracing context passed to workflows
 */
export interface WorkflowTracingParams {
  correlationId: string;
  sessionId?: string | null;
  traceId: string;
  parentSpanId?: string | null;
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
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
  session_id?: string;
  duration_ms?: number;
  service_name?: string;
  operation_name?: string;
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

### 2026-01-07: W3C Trace Context Support

**Migrations**:
- `20260107170706_add_event_tracing_columns.sql` - Add tracing columns and indexes
- `20260107171628_update_emit_domain_event_tracing.sql` - Update emit_domain_event to extract tracing

**Changes**:
- Added 5 dedicated columns: `correlation_id`, `session_id`, `trace_id`, `span_id`, `parent_span_id`
- Added 3 composite indexes for tracing queries
- Added 3 RPC functions: `api.get_events_by_session()`, `api.get_events_by_correlation()`, `api.get_trace_timeline()`
- Updated `api.emit_domain_event()` to auto-extract tracing fields from metadata JSONB

**Backward Compatibility**: ✅ Fully compatible
- Old events without tracing fields remain queryable (columns are nullable)
- `api.emit_domain_event()` auto-extracts tracing from metadata (no API change)
- New column indexes are partial (only index non-null values)

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

- **Event Observability Guide**: `documentation/infrastructure/guides/event-observability.md` - W3C Trace Context, debugging workflows
- **Triggering Workflows Guide**: `documentation/workflows/guides/triggering-workflows.md`
- **Event-Driven Architecture**: `documentation/architecture/workflows/event-driven-workflow-triggering.md`
- **EventQueries API**: `workflows/src/shared/utils/event-queries.ts`
- **emitEvent Utility**: `workflows/src/shared/utils/emit-event.ts`
- **Frontend Tracing**: `frontend/src/utils/tracing.ts` - W3C traceparent, correlation ID generation
- **Edge Function Tracing**: `infrastructure/supabase/supabase/functions/_shared/tracing-context.ts`
- **Database Schema**: `infrastructure/supabase/sql/02-tables/events/domain_events.sql`

## Support

For questions about event metadata:
1. Review examples in this document
2. Check `emitEvent()` utility for automatic field population
3. Query `domain_events` table to see real-world examples
4. Review architecture documentation for workflow traceability patterns
