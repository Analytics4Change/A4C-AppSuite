---
status: current
last_updated: 2025-01-13
---

# Event-Driven Architecture FAQ

## General Questions

### Q: Why events instead of traditional CRUD?

**A:** Traditional CRUD operations have several limitations:
- **Lost context**: UPDATE overwrites data, losing the "why" and previous values
- **No history**: Can't see how data changed over time
- **Audit gaps**: Difficult to reconstruct who did what when
- **Coupling**: Business logic mixed with data persistence

Events solve these by:
- **Capturing intent**: Every event includes a mandatory `reason` field
- **Immutable history**: Events are append-only, never deleted or modified
- **Complete audit trail**: Full context preserved forever
- **Decoupling**: Write events, read projections

### Q: What is CQRS and why use it?

**A:** CQRS (Command Query Responsibility Segregation) separates writes from reads:
- **Commands** (writes) go through events
- **Queries** (reads) use projected 3NF tables

Benefits:
- Optimize write path for audit/history
- Optimize read path for performance
- Scale reads and writes independently
- Different models for different concerns

### Q: Won't this use more storage?

**A:** Yes, but:
- Storage is cheap (pennies per GB)
- Compliance/audit requirements often mandate history anyway
- Can archive old events to cold storage
- Projected tables are same size as traditional approach
- The business value of complete history far exceeds the cost

### Q: Is this more complex than CRUD?

**A:** Different, not necessarily more complex:
- **Simpler application code**: Just emit events, no complex UPDATE logic
- **Clearer business logic**: Events map directly to business actions
- **Easier debugging**: Can trace exactly what happened
- **Better testing**: Events are easy to unit test

## Implementation Questions

### Q: Why is the "reason" field required?

**A:** The reason field is the heart of our audit system:
- **Regulatory compliance**: Many industries require documenting why changes were made
- **Debugging**: Understand not just what changed, but why
- **Business intelligence**: Analyze patterns in why things happen
- **Accountability**: Users must think before making changes

### Q: How do I handle validation?

**A:** Validation happens at three levels:

1. **Contract level** (AsyncAPI/OpenAPI schemas)
```yaml
reason:
  type: string
  minLength: 10
  maxLength: 500
```

2. **Database level** (CHECK constraints)
```sql
CHECK (jsonb_typeof(event_metadata) = 'object')
CHECK (event_metadata->>'reason' IS NOT NULL)
```

3. **Application level** (TypeScript types)
```typescript
if (!event.event_metadata.reason || event.event_metadata.reason.length < 10) {
  throw new Error('Reason must be at least 10 characters');
}
```

### Q: How do I handle eventual consistency?

**A:** The projection from events to tables happens in a trigger (synchronously):
- For most cases, it's effectively immediate (milliseconds)
- If you need guaranteed read-after-write, you can:
  1. Wait for `processed_at` to be set
  2. Use optimistic UI updates
  3. Query the events table directly (rare)

### Q: Can I update or delete events?

**A:** No, events are immutable by design:
- **Updates**: Emit a new event with the changes
- **Deletes**: Emit a "deleted" or "archived" event
- **Corrections**: Emit a compensating event with explanation

Example:
```typescript
// Don't try to update an event
// Instead, emit a correction event
await emitEvent(
  medicationId,
  'medication_history',
  'medication.dosage_corrected',
  {
    previous_dosage: 50,
    correct_dosage: 25,
    error_type: 'data_entry'
  },
  'Correcting dosage error: prescribed amount was incorrectly entered as 50mg instead of 25mg'
);
```

### Q: How do I query historical state?

**A:** Several options:

1. **Event history view**
```sql
SELECT * FROM event_history_by_entity
WHERE entity_id = 'client-123'
  AND occurred_at <= '2024-01-15'
ORDER BY version;
```

2. **Rebuild state at point in time**
```typescript
function getStateAtTime(entityId: string, timestamp: Date) {
  const events = await supabase
    .from('domain_events')
    .select('*')
    .eq('stream_id', entityId)
    .lte('created_at', timestamp)
    .order('stream_version');

  return events.reduce((state, event) => {
    return applyEvent(state, event);
  }, {});
}
```

3. **Time-travel queries** (if using temporal tables)
```sql
SELECT * FROM clients
AS OF SYSTEM TIME '2024-01-15 10:00:00'
WHERE id = 'client-123';
```

## Performance Questions

### Q: Will this be slower than direct updates?

**A:** Not significantly:
- **Writes**: One INSERT instead of UPDATE (often faster)
- **Reads**: Same performance (reading from normal tables)
- **Projections**: Happen in triggers (minimal overhead)
- **Can optimize** with indexes, materialized views, etc.

### Q: How do I handle high-volume events?

**A:** Several strategies:

1. **Batch events** where appropriate
```typescript
// Instead of one event per field change
await emitBatchEvent('client.bulk_update', updates);
```

2. **Async processing** for non-critical projections
```sql
-- Use pg_net for async processing
CREATE TRIGGER async_process_event
  AFTER INSERT ON domain_events
  FOR EACH ROW
  EXECUTE FUNCTION queue_for_processing();
```

3. **Partitioning** for large event tables
```sql
-- Partition by date
CREATE TABLE domain_events_2024_01 PARTITION OF domain_events
FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
```

### Q: What about database size?

**A:** Manage growth with:

1. **Archive old events**
```sql
-- Move events older than 1 year to archive
INSERT INTO domain_events_archive
SELECT * FROM domain_events
WHERE created_at < NOW() - INTERVAL '1 year';
```

2. **Compress event data**
```sql
-- Use JSONB compression
ALTER TABLE domain_events
SET (toast_compression = lz4);
```

3. **Prune derived data**
```sql
-- Remove processed_at, processing_error after success
UPDATE domain_events
SET processing_error = NULL
WHERE processed_at IS NOT NULL
  AND processing_error IS NOT NULL;
```

## Troubleshooting Questions

### Q: My event isn't being processed. What do I check?

**A:** Debug checklist:

1. **Check for errors**
```sql
SELECT * FROM domain_events
WHERE stream_id = 'your-id'
  AND processing_error IS NOT NULL;
```

2. **Verify event structure**
```sql
SELECT
  event_type,
  jsonb_typeof(event_data) as data_type,
  jsonb_typeof(event_metadata) as meta_type,
  event_metadata->>'reason' as reason
FROM domain_events
WHERE id = 'event-id';
```

3. **Check processor function**
```sql
-- Manually test processor
SELECT process_domain_event(
  (SELECT * FROM domain_events WHERE id = 'event-id')
);
```

4. **Review logs**
```sql
-- Check Postgres logs for trigger errors
SELECT * FROM postgres_logs
WHERE severity = 'ERROR'
  AND message LIKE '%domain_event%'
ORDER BY timestamp DESC;
```

### Q: How do I reprocess failed events?

**A:** Reset and retry:

```sql
-- Reset single event
UPDATE domain_events
SET processed_at = NULL,
    processing_error = NULL,
    retry_count = retry_count + 1
WHERE id = 'failed-event-id';

-- Bulk retry all failed events
UPDATE domain_events
SET processed_at = NULL,
    processing_error = NULL,
    retry_count = retry_count + 1
WHERE processing_error IS NOT NULL
  AND retry_count < 3;
```

### Q: How do I handle duplicate events?

**A:** Prevent with constraints:

```sql
-- Idempotency key
ALTER TABLE domain_events
ADD COLUMN idempotency_key TEXT;

ALTER TABLE domain_events
ADD CONSTRAINT unique_idempotency
UNIQUE (idempotency_key);

-- Or use stream versioning
ALTER TABLE domain_events
ADD CONSTRAINT unique_stream_version
UNIQUE (stream_id, stream_type, stream_version);
```

Client-side:
```typescript
async function emitEventIdempotent(event: DomainEvent, idempotencyKey: string) {
  // Will fail if duplicate
  return await supabase.from('domain_events').insert({
    ...event,
    idempotency_key: idempotencyKey
  });
}
```

## Migration Questions

### Q: How do I migrate existing data to events?

**A:** Create backfill events:

```sql
-- Generate registration events for existing clients
INSERT INTO domain_events (
  stream_id,
  stream_type,
  stream_version,
  event_type,
  event_data,
  event_metadata,
  created_at
)
SELECT
  id,
  'client',
  1,
  'client.registered',
  jsonb_build_object(
    'organization_id', organization_id,
    'first_name', first_name,
    'last_name', last_name,
    'date_of_birth', date_of_birth
  ),
  jsonb_build_object(
    'user_id', COALESCE(created_by, 'system'),
    'reason', 'Historical data migration from legacy system',
    'migration_batch', 'initial_import_2024'
  ),
  COALESCE(created_at, NOW())
FROM clients;
```

### Q: Can I use this with my existing CRUD code?

**A:** Yes, gradually:

```typescript
// Adapter pattern
class ClientRepository {
  async update(id: string, data: any, reason?: string) {
    if (reason) {
      // New path: emit event
      return this.emitUpdateEvent(id, data, reason);
    } else {
      // Legacy path: direct update
      console.warn('Direct update without reason - consider migrating');
      return this.directUpdate(id, data);
    }
  }
}
```

### Q: How long should the migration take?

**A:** Depends on your approach:

1. **Big Bang** (1-2 sprints)
   - Convert everything at once
   - Higher risk, faster completion

2. **Gradual** (2-6 months)
   - New features use events
   - Migrate existing features over time
   - Lower risk, minimal disruption

3. **Hybrid** (Recommended)
   - Critical audit tables first (medications, clients)
   - Reference data later (if ever)
   - Config/settings can stay traditional

## Architecture Questions

### Q: Should every table be event-sourced?

**A:** No, use events for:
- ✅ Core domain entities (clients, medications)
- ✅ Anything requiring audit trail
- ✅ Complex state machines
- ✅ Multi-step workflows

Keep traditional for:
- ❌ Reference data (countries, states)
- ❌ Configuration (app settings)
- ❌ Temporary data (sessions, caches)
- ❌ High-volume metrics (use time-series DB)

### Q: How do I handle relationships?

**A:** Events can reference other entities:

```typescript
// Event references both client and medication
await emitEvent(
  prescriptionId,
  'medication_history',
  'medication.prescribed',
  {
    client_id: clientId,        // Reference
    medication_id: medicationId, // Reference
    dosage: 50
  },
  'Prescribed for anxiety disorder per treatment plan'
);
```

Projections maintain foreign keys:
```sql
-- Projection maintains referential integrity
INSERT INTO medication_history (
  client_id, -- FK to clients
  medication_id, -- FK to medications
  ...
)
```

### Q: What about transactions?

**A:** Several patterns:

1. **Single aggregate** (most common)
```typescript
// One event affects one entity
await emitEvent(clientId, 'client', 'client.discharged', ...);
```

2. **Saga pattern** (complex workflows)
```typescript
// Coordinate multiple events
const saga = new DischargeSaga(clientId);
await saga.start(); // Emits multiple related events
```

3. **Event sourcing transaction**
```typescript
// Multiple events in transaction
await supabase.rpc('emit_events_transactional', {
  events: [event1, event2, event3]
});
```

## Security Questions

### Q: How do I secure events?

**A:** Multiple layers:

1. **RLS on domain_events**
```sql
-- Users can only create events for their organization
CREATE POLICY "Users can create events for their org"
ON domain_events FOR INSERT
WITH CHECK (
  (event_data->>'organization_id')::UUID = auth.jwt()->>'organization_id'
);
```

2. **Event authorization**
```typescript
// Validate permissions before emitting
if (!canEmitEvent(user, eventType)) {
  throw new ForbiddenError();
}
```

3. **Encrypt sensitive data**
```sql
-- Encrypt PII in events
event_data = jsonb_set(
  event_data,
  '{ssn}',
  to_jsonb(encrypt(event_data->>'ssn'))
);
```

### Q: Can users see all events?

**A:** No, use RLS and views:

```sql
-- Users only see events for their organization
CREATE VIEW my_organization_events AS
SELECT * FROM domain_events
WHERE (event_data->>'organization_id')::UUID = auth.jwt()->>'organization_id';

-- Or just query projected tables with RLS
SELECT * FROM clients; -- RLS automatically filters
```

### Q: What about GDPR/Right to be forgotten?

**A:** Handle with crypto-shredding:

```sql
-- Store PII encrypted with per-user key
-- To "forget", delete the key
DELETE FROM encryption_keys
WHERE user_id = 'gdpr-request-user-id';

-- Events remain but PII is unreadable
-- Alternatively, emit a "data_erased" event
INSERT INTO domain_events (...) VALUES (
  ...,
  'user.data_erased',
  '{"user_id": "...", "erased_fields": ["email", "name", "phone"]}',
  '{"reason": "GDPR Article 17 request received on 2024-01-15"}'
);
```

## Still Have Questions?

1. Check the [main documentation](./EVENT-DRIVEN-ARCHITECTURE.md)
2. Review [example code](./QUICKSTART.md)
3. Browse the [AsyncAPI contracts](../../../../../infrastructure/supabase/contracts/asyncapi/)
4. Search existing events: `SELECT DISTINCT event_type FROM domain_events`
5. Ask the team - we're here to help!

Remember: When in doubt, emit an event with a clear reason! 🎯