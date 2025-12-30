---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: The event store table implementing CQRS/Event Sourcing pattern - immutable, append-only record of all state changes. All projections are derived from this table. Includes stream versioning for optimistic concurrency and metadata for audit trails.

**When to read**:
- Understanding event sourcing and CQRS architecture
- Implementing new domain events or event processors
- Debugging projection issues or event processing failures
- Querying audit trails or user action history

**Prerequisites**: [Event Sourcing Overview](../../../architecture/data/event-sourcing-overview.md)

**Key topics**: `domain-events`, `event-sourcing`, `cqrs`, `audit-trail`, `stream-versioning`, `projections`

**Estimated read time**: 25 minutes
<!-- TL;DR-END -->

# domain_events

## Overview

The `domain_events` table is the **single source of truth** for all state changes in the A4C-AppSuite platform. It implements the Event Store pattern in a CQRS (Command Query Responsibility Segregation) architecture, where all system changes are recorded as immutable, append-only events.

**Key Characteristics**:
- **Immutable**: Events are never modified or deleted once created
- **Append-only**: New events are always added, never updated
- **Complete audit trail**: Every state change is recorded with full context
- **Event Sourcing**: Current state can be reconstructed by replaying events
- **Time-travel debugging**: Historical state can be reconstructed at any point in time

**Architecture Role**: This table is the "write model" in CQRS - all state changes flow through here first, then get projected to read-optimized tables (like `clients`, `medications`, `medication_history`).

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key - unique event identifier |
| sequence_number | bigserial | NO | auto-increment | Global ordering across all events |
| stream_id | uuid | NO | - | The aggregate/entity ID this event belongs to |
| stream_type | text | NO | - | Entity type ('client', 'medication', 'user', etc.) |
| stream_version | integer | NO | - | Version number within this specific entity stream |
| event_type | text | NO | - | Event type in format: 'domain.action' (e.g., 'client.admitted') |
| event_data | jsonb | NO | - | The actual event payload with all data needed for projection |
| event_metadata | jsonb | NO | '{}' | Context: user_id, reason, correlation_id, causation_id, etc. |
| created_at | timestamptz | NO | now() | When the event was created |
| processed_at | timestamptz | YES | - | When successfully projected to read models (3NF tables) |
| processing_error | text | YES | - | Error message if projection failed |
| retry_count | integer | NO | 0 | Number of projection retry attempts |

### Column Details

#### id
- **Type**: `uuid`
- **Purpose**: Unique identifier for each event
- **Generation**: Automatically generated via `gen_random_uuid()`
- **Constraints**: PRIMARY KEY
- **Usage**: Reference events in logs, debugging, error tracking

#### sequence_number
- **Type**: `bigserial`
- **Purpose**: **Global ordering** of all events across all entities
- **Generation**: Auto-incremented PostgreSQL sequence
- **Constraints**: UNIQUE, NOT NULL
- **Critical for**: Event replay, ensuring correct projection order
- **Guarantees**: Monotonically increasing (gaps possible, never duplicates)

#### stream_id
- **Type**: `uuid`
- **Purpose**: The ID of the aggregate/entity this event belongs to
- **Examples**:
  - `client_id` for 'client.admitted' event
  - `medication_id` for 'medication.prescribed' event
  - `organization_id` for 'organization.created' event
- **Pattern**: Same stream_id groups all events for a single entity

#### stream_type
- **Type**: `text`
- **Purpose**: Categorizes which type of entity this event affects
- **Valid Values**: 'client', 'medication', 'medication_history', 'dosage', 'user', 'organization', etc.
- **Usage**: Filter events by entity type, route to correct projection handler
- **Constraint**: Used with `unique_stream_version` to ensure version uniqueness per stream

#### stream_version
- **Type**: `integer`
- **Purpose**: Version number for this specific entity's event stream
- **Pattern**: Starts at 1, increments for each event on same stream_id
- **Optimistic Concurrency**: Prevents conflicting concurrent updates to same entity
- **Constraint**: UNIQUE (stream_id, stream_type, stream_version)
- **Example**:
  ```
  stream_id: client-123, stream_type: 'client', stream_version: 1 → 'client.registered'
  stream_id: client-123, stream_type: 'client', stream_version: 2 → 'client.admitted'
  stream_id: client-123, stream_type: 'client', stream_version: 3 → 'client.discharged'
  ```

#### event_type
- **Type**: `text`
- **Purpose**: Describes what happened (the domain event)
- **Format**: `domain.action` or `domain.subdomain.action`
- **Examples**:
  - `client.registered`
  - `client.admitted`
  - `medication.prescribed`
  - `organization.bootstrap.initiated`
- **Constraint**: CHECK constraint enforces format: `^[a-z_]+(\.[a-z_]+)+$`
- **Registered**: Must exist in `event_types` table (catalog of valid events)

#### event_data
- **Type**: `jsonb`
- **Purpose**: The actual event payload - all data needed to project to read models
- **Schema**: Defined per event_type in `event_types.event_schema`
- **Constraint**: CHECK (jsonb_typeof(event_data) = 'object') - must be JSON object
- **Immutable**: Never modified after event creation
- **Example** (client.admitted):
  ```json
  {
    "client_id": "uuid",
    "organization_id": "uuid",
    "admission_date": "2025-11-13T10:00:00Z",
    "facility_id": "uuid",
    "reason": "Voluntary admission",
    "assigned_room": "B-214"
  }
  ```

#### event_metadata
- **Type**: `jsonb`
- **Purpose**: Context about **WHY** and **WHO** - the story behind the event
- **Default**: `{}`
- **Common Fields**:
  - `user_id`: Who initiated this action
  - `reason`: Why this action was taken
  - `correlation_id`: Groups related events (e.g., entire workflow)
  - `causation_id`: The event that caused this event
  - `ip_address`: Where the request came from
  - `user_agent`: Client application details
  - `approval_chain`: Who approved this action (if requires_approval)
  - `notes`: Additional human context
- **Example**:
  ```json
  {
    "user_id": "staff-uuid",
    "reason": "Family requested admission",
    "correlation_id": "admission-workflow-uuid",
    "ip_address": "192.168.1.100",
    "notes": "Spoke with daughter, completed intake forms"
  }
  ```

#### created_at
- **Type**: `timestamptz`
- **Purpose**: When the event occurred
- **Default**: `now()`
- **Usage**: Event timeline, audit trail, temporal queries
- **Indexed**: DESC index for recent events queries

#### processed_at
- **Type**: `timestamptz`
- **Purpose**: When this event was successfully projected to read models
- **Nullable**: YES (NULL = not yet processed)
- **Usage**: Track projection lag, identify stuck events
- **Indexed**: Partial index on NULL for finding unprocessed events

#### processing_error
- **Type**: `text`
- **Purpose**: Error message if projection failed
- **Nullable**: YES (NULL = no error)
- **Usage**: Debugging failed projections, alerting on errors
- **Pattern**: Contains full stack trace and error context

#### retry_count
- **Type**: `integer`
- **Purpose**: Number of times projection was retried
- **Default**: 0
- **Usage**: Prevent infinite retry loops, alert on high retry counts
- **Max**: Implementation-specific (typically 3-5 retries before manual intervention)

## Relationships

### Parent Relationships (Foreign Keys)

⚠️ **Intentionally None**: Event store is foundational - no foreign keys to avoid circular dependencies and maintain independence.

### Child Relationships (Referenced By)

**Conceptual** (not enforced by FK):
- All projection tables (`clients`, `medications`, `medication_history`, etc.) are derived from events in this table
- Event processors (triggers, functions) consume events and update projections

### Related Tables

- **event_types** → Catalog of valid event_type values with schemas
- **All projection tables** → Read models derived from event stream

## Indexes

### Primary Index
```sql
PRIMARY KEY (id)
```
- **Purpose**: Fast lookups by event ID
- **Performance**: O(log n) for single event retrieval

### idx_domain_events_stream
```sql
CREATE INDEX idx_domain_events_stream ON domain_events(stream_id, stream_type);
```
- **Purpose**: Retrieve all events for a specific entity (event stream)
- **Used By**: Event replay, entity history reconstruction
- **Performance**: Essential for time-travel debugging
- **Example Query**:
  ```sql
  SELECT * FROM domain_events
  WHERE stream_id = 'client-uuid' AND stream_type = 'client'
  ORDER BY stream_version;
  ```

### idx_domain_events_type
```sql
CREATE INDEX idx_domain_events_type ON domain_events(event_type);
```
- **Purpose**: Filter events by type (e.g., all 'client.admitted' events)
- **Used By**: Analytics, reporting, event-specific processing
- **Example Query**:
  ```sql
  SELECT COUNT(*) FROM domain_events
  WHERE event_type = 'medication.prescribed'
  AND created_at > now() - interval '30 days';
  ```

### idx_domain_events_created
```sql
CREATE INDEX idx_domain_events_created ON domain_events(created_at DESC);
```
- **Purpose**: Recent events queries, chronological ordering
- **Used By**: Event monitoring, recent activity dashboards
- **Performance**: DESC order for "latest events" queries

### idx_domain_events_unprocessed (Partial Index)
```sql
CREATE INDEX idx_domain_events_unprocessed ON domain_events(processed_at)
WHERE processed_at IS NULL;
```
- **Purpose**: Find events awaiting projection (not yet processed)
- **Used By**: Projection workers, monitoring alerts
- **Optimization**: Partial index only indexes unprocessed events
- **Critical For**: Detecting projection lag or failures

### idx_domain_events_correlation (Partial Index)
```sql
CREATE INDEX idx_domain_events_correlation ON domain_events((event_metadata->>'correlation_id'))
WHERE event_metadata ? 'correlation_id';
```
- **Purpose**: Trace all events in a workflow/transaction
- **Used By**: Debugging, distributed tracing, workflow visualization
- **Example**: Find all events in an organization bootstrap workflow

### idx_domain_events_user (Partial Index)
```sql
CREATE INDEX idx_domain_events_user ON domain_events((event_metadata->>'user_id'))
WHERE event_metadata ? 'user_id';
```
- **Purpose**: User activity audit trail
- **Used By**: User action history, compliance audits
- **Example**: "Show all actions taken by user X"

## RLS Policies

### Current State

RLS policies are defined in `infrastructure/supabase/sql/06-rls/001-core-projection-policies.sql`:

```sql
-- Super admins can view all domain events (audit trail)
DROP POLICY IF EXISTS domain_events_super_admin_all ON domain_events;
CREATE POLICY domain_events_super_admin_all
  ON domain_events
  FOR ALL
  USING (is_super_admin(get_current_user_id()));
```

**Current Access**:
- ✅ Super admins: Full access (SELECT, INSERT, UPDATE, DELETE)
- ❌ Organization admins: No access
- ❌ Regular users: No access

### Future Enhancements

**Recommended**: Organization-scoped SELECT access (requires event_metadata.org_id):

```sql
-- Organization admins can view events for their organization
CREATE POLICY domain_events_org_admin_select ON domain_events
  FOR SELECT
  USING (
    is_org_admin(get_current_user_id(), (event_metadata->>'org_id')::uuid)
  );
```

**Note**: Requires standardizing `org_id` in event_metadata for all events.

## Constraints

### Check Constraints

#### valid_event_type
```sql
CONSTRAINT valid_event_type CHECK (event_type ~ '^[a-z_]+(\.[a-z_]+)+$')
```
- **Purpose**: Enforce event type naming convention
- **Format**: `domain.action` (e.g., 'client.admitted') or `domain.subdomain.action`
- **Prevents**: Typos, invalid formats, inconsistent naming

#### event_data_not_empty
```sql
CONSTRAINT event_data_not_empty CHECK (jsonb_typeof(event_data) = 'object')
```
- **Purpose**: Ensure event_data is a JSON object (not array, string, or null)
- **Prevents**: Invalid event payloads

### Unique Constraints

#### unique_stream_version
```sql
CONSTRAINT unique_stream_version UNIQUE(stream_id, stream_type, stream_version)
```
- **Purpose**: Optimistic concurrency control
- **Prevents**: Conflicting concurrent updates to same entity
- **Example Failure**: Two processes try to create version 3 for same client simultaneously
- **Pattern**: Application must handle conflict and retry with incremented version

## Usage Examples

### Append Event

```sql
-- Record a client admission event
INSERT INTO domain_events (
  stream_id,
  stream_type,
  stream_version,
  event_type,
  event_data,
  event_metadata
) VALUES (
  '123e4567-e89b-12d3-a456-426614174000'::uuid, -- client_id
  'client',
  2, -- This is the 2nd event for this client
  'client.admitted',
  jsonb_build_object(
    'client_id', '123e4567-e89b-12d3-a456-426614174000',
    'organization_id', 'org-uuid',
    'admission_date', '2025-11-13T10:00:00Z',
    'facility_id', 'facility-uuid',
    'reason', 'Voluntary admission'
  ),
  jsonb_build_object(
    'user_id', auth.uid(),
    'reason', 'Family requested admission',
    'correlation_id', gen_random_uuid(),
    'ip_address', current_setting('request.headers', true)::json->>'x-real-ip'
  )
) RETURNING *;
```

### Retrieve Event Stream

```sql
-- Get complete event history for a client
SELECT
  sequence_number,
  stream_version,
  event_type,
  event_data,
  event_metadata,
  created_at,
  processed_at
FROM domain_events
WHERE stream_id = 'client-uuid'
  AND stream_type = 'client'
ORDER BY stream_version ASC;
```

**Output**: Complete timeline of all events for this client (registered → admitted → medicated → discharged)

### Find Unprocessed Events

```sql
-- Find events awaiting projection
SELECT
  id,
  event_type,
  created_at,
  retry_count,
  processing_error
FROM domain_events
WHERE processed_at IS NULL
  AND retry_count < 5
ORDER BY created_at ASC
LIMIT 100;
```

**Usage**: Projection workers poll this query to find events to process

### Mark Event as Processed

```sql
-- Update after successful projection
UPDATE domain_events
SET
  processed_at = now(),
  processing_error = NULL
WHERE id = 'event-uuid';
```

### Record Processing Error

```sql
-- Record projection failure
UPDATE domain_events
SET
  processing_error = 'Foreign key violation: client_id not found',
  retry_count = retry_count + 1
WHERE id = 'event-uuid';
```

### Trace Workflow

```sql
-- Find all events in a workflow using correlation_id
SELECT
  event_type,
  stream_type,
  stream_id,
  created_at,
  processed_at
FROM domain_events
WHERE event_metadata->>'correlation_id' = 'workflow-uuid'
ORDER BY created_at;
```

**Example**: Trace an organization bootstrap workflow from initiation → DNS provisioning → user invitation → completion

### User Audit Trail

```sql
-- Find all actions by a specific user
SELECT
  event_type,
  stream_type,
  stream_id,
  event_data,
  created_at
FROM domain_events
WHERE event_metadata->>'user_id' = 'user-uuid'
ORDER BY created_at DESC
LIMIT 50;
```

### Recent Events Dashboard

```sql
-- Recent events across all types
SELECT
  event_type,
  stream_type,
  COUNT(*) as event_count,
  MAX(created_at) as last_occurrence
FROM domain_events
WHERE created_at > now() - interval '24 hours'
GROUP BY event_type, stream_type
ORDER BY event_count DESC;
```

## Triggers

No triggers currently defined on this table.

**Recommended**: Consider adding triggers for:
- Automatic projection dispatch (call projection functions on INSERT)
- Event validation against `event_types.event_schema`
- Metrics/monitoring (emit to observability platform)

## Migration History

### Initial Creation
- **Migration**: `infrastructure/supabase/sql/01-events/001-domain-events-table.sql`
- **Purpose**: Create event store table with complete schema
- **Features**:
  - Event sourcing pattern (immutable, append-only)
  - Stream-based versioning (stream_id + stream_version)
  - Projection tracking (processed_at, processing_error, retry_count)
  - Rich metadata (correlation_id, causation_id, user context)
  - Performance indexes (stream, type, created, unprocessed, correlation, user)

### Schema Changes

None yet applied.

## Performance Considerations

### Query Performance

**Expected Row Count**:
- Small deployment: 10,000-100,000 events
- Medium deployment: 100,000-1,000,000 events
- Large deployment: 1,000,000-10,000,000+ events
- Platform total: 10,000,000-100,000,000+ events

**Growth Rate**: Continuous, proportional to user activity (100-10,000 events/day per organization)

**Hot Paths** (most common query patterns):
1. Find unprocessed events (projection workers)
2. Retrieve event stream for entity (event replay)
3. Recent events (monitoring dashboards)
4. Events by type (analytics)

**Optimization Strategies**:
- Existing indexes cover primary query patterns
- Partial indexes minimize index size (only unprocessed, only with correlation_id, etc.)
- Consider partitioning by created_at for very large deployments (time-series partitioning)
- Archive old events (> 1 year) to separate table if retention policy allows

### Write Performance

**Characteristics**:
- Append-only (no UPDATEs to event_data or event_type)
- High write volume during peak activity
- Minimal contention (different stream_ids don't conflict)

**Bottlenecks**:
- `sequence_number` serial (global lock on increment)
- Index maintenance on 6 indexes

**Mitigations**:
- Use batch INSERT for bulk operations
- Consider `UNLOGGED` table for non-critical events (testing only)
- Monitor index bloat, REINDEX periodically

### Storage Considerations

**Size Estimation**:
- Average event size: 1-5 KB (event_data + event_metadata)
- 1 million events ≈ 1-5 GB raw data
- Indexes add ~30-50% overhead
- JSONB compression helps (PostgreSQL TOAST)

**Archival Strategy**:
- Keep last 12 months in hot storage
- Archive older events to cold storage (S3, Glacier)
- Maintain recent event_types indefinitely for compliance

## Security Considerations

### Data Sensitivity

- **Sensitivity Level**: **RESTRICTED** (contains PHI and audit trail)
- **PII/PHI**: YES - event_data may contain names, DOB, medical information
- **Compliance**: **HIPAA**, **GDPR**, **SOC 2** (immutable audit trail)

**Critical Fields**:
- event_data: May contain PHI depending on event_type
- event_metadata: Contains user_id, ip_address, notes (audit trail)

### Access Control

- ✅ RLS enabled on table
- ✅ SELECT policy for super_admin
- ⚠️ No organization-scoped access (future enhancement)
- ⚠️ No policies for INSERT/UPDATE/DELETE (only super_admin via FOR ALL policy)

**Recommended**: Restrict INSERT to service roles only (events should come from Temporal workflows, not direct API calls)

### Encryption

- **At-rest encryption**: PostgreSQL/Supabase (AES-256)
- **In-transit encryption**: TLS/SSL connections enforced
- **Column-level encryption**: Not required (RLS provides access control)

### Audit Trail Integrity

- **Immutability**: Events must NEVER be modified after creation
- **Deletion**: Should NEVER occur (violates audit trail integrity)
- **Recommendation**: Add database-level triggers to prevent UPDATE/DELETE on event_data

## Compliance Notes

### HIPAA

- ✅ Complete audit trail of all PHI access and modifications
- ✅ Immutable records (satisfies audit log requirements)
- ✅ User attribution (event_metadata.user_id)
- ⚠️ Ensure backup encryption for archived events

### GDPR

- ⚠️ **Right to erasure**: Events containing PII may need to be redacted (not deleted)
- **Recommendation**: Implement event redaction (replace event_data with `{"redacted": true}`)
- Maintain event structure for audit but remove personal data

### SOC 2

- ✅ Complete activity logging
- ✅ Change tracking for all entities
- ✅ Tamper-proof audit trail (immutable events)

## Best Practices

### Event Design

1. **Events describe what happened** (past tense): 'client.admitted' not 'admit.client'
2. **Include all data needed for projection** in event_data (no joins required)
3. **Never modify events** after creation (append new events instead)
4. **Use correlation_id** to group related events (workflows, sagas)
5. **Record WHY** in event_metadata (not just WHAT)

### Projection Patterns

1. **Idempotent projections**: Replay same event → same result
2. **Handle out-of-order events**: Use stream_version for ordering
3. **Retry failed projections**: Exponential backoff, max retries
4. **Monitor projection lag**: Alert if processed_at falls behind

### Schema Evolution

1. **Additive changes only**: New fields can be added, never remove
2. **Version event schemas**: `event_types.event_schema` documents structure
3. **Backward compatible**: Old events must still project correctly
4. **Schema migration**: Create new event_type, deprecate old (don't modify)

## Related Documentation

- **[event_types](event_types.md)** - Catalog of valid event types with schemas
- **[Event Sourcing Overview](../../../architecture/data/event-sourcing-overview.md)** - CQRS architecture patterns
- **[Event-Driven Architecture](../../guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md)** - Backend event sourcing specification
- **[Temporal Workflows](../../../architecture/workflows/temporal-overview.md)** - Workflows emit domain events
