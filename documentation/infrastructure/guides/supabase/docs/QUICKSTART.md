---
status: current
last_updated: 2025-01-13
---

# Event-Driven Architecture Quick Start Guide

This guide will get you up and running with the A4C event-driven architecture in 15 minutes.

## Prerequisites

- Access to Supabase project
- Node.js 18+ installed
- Git repository cloned

## 1. Deploy the Database Schema (5 min)

```bash
# Navigate to Supabase directory
cd A4C-Infrastructure/supabase

# Review what will be deployed
./scripts/deploy.sh --dry-run

# Deploy to Supabase (requires connection string)
export SUPABASE_DB_URL="postgresql://postgres:[password]@[project].supabase.co:5432/postgres"
./scripts/deploy.sh
```

This creates:
- ✅ Event store (`domain_events` table)
- ✅ Event processors (automatic projections)
- ✅ 3NF tables for queries
- ✅ Audit trail with reasons

## 2. Generate TypeScript Types (2 min)

```bash
# Generate types from contracts
./scripts/generate-contracts.sh

# View generated types
ls contracts/generated/typescript/
# - api-types.ts      # REST API types
# - event-types.ts    # Event types with required 'reason'
```

## 3. Your First Event (3 min)

### From the Frontend

```typescript
// Simple event emission
await supabase.from('domain_events').insert({
  stream_id: '550e8400-e29b-41d4-a716-446655440000',
  stream_type: 'client',
  event_type: 'client.registered',
  stream_version: 1,
  event_data: {
    organization_id: orgId,
    first_name: 'Jane',
    last_name: 'Doe',
    date_of_birth: '1990-01-15'
  },
  event_metadata: {
    user_id: currentUser.id,
    reason: 'New client intake from emergency department referral #12345' // REQUIRED!
  }
});
```

### What Happens Automatically

1. Event validates against schema
2. Inserts into `domain_events` (immutable)
3. Trigger fires and projects to `clients` table
4. Audit log updated with full context

### Query the Result

```typescript
// Read from normal tables
const { data: client } = await supabase
  .from('clients')
  .select('*')
  .eq('id', '550e8400-e29b-41d4-a716-446655440000')
  .single();
```

## 4. Common Event Patterns (5 min)

### Pattern 1: Create Entity

```typescript
// Register a new client
function registerClient(data: ClientForm) {
  return supabase.from('domain_events').insert({
    stream_id: crypto.randomUUID(),
    stream_type: 'client',
    event_type: 'client.registered',
    stream_version: 1,
    event_data: data,
    event_metadata: {
      user_id: currentUser.id,
      reason: data.intakeReason // From form field
    }
  });
}
```

### Pattern 2: Update Entity

```typescript
// Update client information
function updateClient(clientId: string, changes: Partial<Client>, reason: string) {
  const version = await getNextVersion(clientId, 'client');

  return supabase.from('domain_events').insert({
    stream_id: clientId,
    stream_type: 'client',
    event_type: 'client.information_updated',
    stream_version: version,
    event_data: { changes },
    event_metadata: {
      user_id: currentUser.id,
      reason // Must explain why changes are being made
    }
  });
}
```

### Pattern 3: State Transitions

```typescript
// Discharge a client
function dischargeClient(clientId: string, dischargeForm: DischargeForm) {
  const version = await getNextVersion(clientId, 'client');

  return supabase.from('domain_events').insert({
    stream_id: clientId,
    stream_type: 'client',
    event_type: 'client.discharged',
    stream_version: version,
    event_data: {
      discharge_date: dischargeForm.date,
      discharge_type: dischargeForm.type,
      discharge_disposition: dischargeForm.disposition
    },
    event_metadata: {
      user_id: currentUser.id,
      reason: dischargeForm.reason,
      approval_chain: dischargeForm.approvals
    }
  });
}
```

## 5. React Hook for Events

```typescript
// hooks/useEvents.ts
import { DomainEvent, EventMetadata } from '@/types/events';

export function useEvents() {
  const [submitting, setSubmitting] = useState(false);

  const emitEvent = async (
    streamId: string,
    streamType: string,
    eventType: string,
    eventData: any,
    reason: string,
    additionalMetadata?: Partial<EventMetadata>
  ) => {
    if (!reason || reason.length < 10) {
      throw new Error('A meaningful reason (10+ characters) is required');
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from('domain_events')
        .insert({
          stream_id: streamId,
          stream_type: streamType,
          event_type: eventType,
          stream_version: await getNextVersion(streamId, streamType),
          event_data: eventData,
          event_metadata: {
            user_id: currentUser.id,
            reason,
            ...additionalMetadata
          }
        });

      if (error) throw error;
      return data;
    } finally {
      setSubmitting(false);
    }
  };

  return { emitEvent, submitting };
}

// Usage in component
function MedicationForm() {
  const { emitEvent } = useEvents();

  const handleSubmit = async (formData) => {
    await emitEvent(
      crypto.randomUUID(),
      'medication_history',
      'medication.prescribed',
      {
        client_id: formData.clientId,
        medication_id: formData.medicationId,
        // ... other data
      },
      formData.prescriptionReason // Required reason from form
    );
  };
}
```

## 6. Form with Reason Field

```tsx
// components/ClientDischargeForm.tsx
export function ClientDischargeForm({ clientId }: Props) {
  const { emitEvent } = useEvents();

  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);

      await emitEvent(
        clientId,
        'client',
        'client.discharged',
        {
          discharge_date: formData.get('date'),
          discharge_type: formData.get('type'),
          discharge_disposition: formData.get('disposition')
        },
        formData.get('reason') as string // Required field
      );
    }}>
      <fieldset>
        <legend>Discharge Information</legend>

        <input type="date" name="date" required />

        <select name="type" required>
          <option value="planned">Planned</option>
          <option value="against_medical_advice">AMA</option>
          <option value="transfer">Transfer</option>
        </select>

        <select name="disposition" required>
          <option value="home">Home</option>
          <option value="home_with_services">Home with Services</option>
          <option value="skilled_nursing_facility">SNF</option>
        </select>

        <textarea
          name="reason"
          required
          minLength={10}
          placeholder="Explain the reason for discharge (required for audit)..."
          rows={3}
        />
      </fieldset>

      <button type="submit">Complete Discharge</button>
    </form>
  );
}
```

## 7. Viewing Event History

```typescript
// View complete history with reasons
const { data: history } = await supabase
  .from('event_history_by_entity')
  .select('*')
  .eq('entity_id', clientId)
  .order('version');

// Display in UI
history.map(event => (
  <div key={event.id}>
    <h4>{event.event_type}</h4>
    <p>Reason: {event.change_reason}</p>
    <p>By: {event.changed_by_name} at {event.occurred_at}</p>
  </div>
));
```

## Common Gotchas & Solutions

### ❌ Missing Reason
```typescript
// This will fail validation
await supabase.from('domain_events').insert({
  // ... event data
  event_metadata: {
    user_id: currentUser.id
    // Missing reason!
  }
});
```

### ✅ Always Include Reason
```typescript
await supabase.from('domain_events').insert({
  // ... event data
  event_metadata: {
    user_id: currentUser.id,
    reason: 'Medication discontinued due to adverse reaction reported by patient'
  }
});
```

### ❌ Wrong Version Number
```typescript
// Don't hardcode versions
stream_version: 1 // Wrong if entity has existing events
```

### ✅ Calculate Next Version
```typescript
async function getNextVersion(streamId: string, streamType: string) {
  const { data } = await supabase
    .from('domain_events')
    .select('stream_version')
    .eq('stream_id', streamId)
    .eq('stream_type', streamType)
    .order('stream_version', { ascending: false })
    .limit(1);

  return (data?.[0]?.stream_version || 0) + 1;
}
```

### ❌ Reading from Events Table
```typescript
// Don't query events table for current state
const { data } = await supabase
  .from('domain_events')
  .select('*')
  .eq('stream_id', clientId); // Inefficient!
```

### ✅ Read from Projected Tables
```typescript
// Query the normalized tables instead
const { data } = await supabase
  .from('clients')
  .select('*')
  .eq('id', clientId); // Fast!
```

## Testing Your Implementation

### 1. Test Event Creation
```sql
-- In Supabase SQL Editor
INSERT INTO domain_events (
  stream_id,
  stream_type,
  stream_version,
  event_type,
  event_data,
  event_metadata
) VALUES (
  gen_random_uuid(),
  'client',
  1,
  'client.registered',
  '{"first_name": "Test", "last_name": "User", "date_of_birth": "1990-01-01", "organization_id": "550e8400-e29b-41d4-a716-446655440000"}',
  '{"user_id": "550e8400-e29b-41d4-a716-446655440000", "reason": "Testing event projection system"}'
);
```

### 2. Verify Projection
```sql
-- Check if client was created
SELECT * FROM clients WHERE first_name = 'Test';

-- Check audit log
SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 1;
```

### 3. Check Event Processing
```sql
-- See all events and their processing status
SELECT
  event_type,
  created_at,
  processed_at,
  processing_error,
  event_metadata->>'reason' as reason
FROM domain_events
ORDER BY created_at DESC
LIMIT 10;
```

## Next Steps

1. **Read the full documentation**: [EVENT-DRIVEN-ARCHITECTURE.md](./EVENT-DRIVEN-ARCHITECTURE.md)
2. **Explore event types**: Browse `contracts/asyncapi/domains/`
3. **Add your own events**: Create new event types in AsyncAPI specs
4. **Monitor events**: Set up alerts for failed projections
5. **Implement approval chains**: Add multi-step approval workflows

## Getting Help

- **Events not processing?** Check `SELECT * FROM unprocessed_events`
- **Validation failing?** Ensure reason is 10+ characters
- **Types out of sync?** Run `./scripts/generate-contracts.sh`
- **Need examples?** See `contracts/openapi/api.yaml` for examples

Remember: Every change needs a WHY! 🎯