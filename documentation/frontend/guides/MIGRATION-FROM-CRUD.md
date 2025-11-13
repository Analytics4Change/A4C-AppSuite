---
status: current
last_updated: 2025-01-13
---

# Migration Guide: CRUD to Event-Driven Architecture

This guide helps you migrate existing CRUD operations to the event-driven architecture.

## Quick Reference

| CRUD Operation | Event-Based Equivalent | Key Difference |
|---------------|------------------------|----------------|
| CREATE | Emit `.registered` or `.created` event | Includes reason why created |
| READ | Query projected tables (same as before) | No change needed |
| UPDATE | Emit `.updated` or specific change event | Captures what changed and why |
| DELETE | Emit `.archived` or `.deleted` event | Soft delete with reason |

## Step-by-Step Migration

### 1. Identify CRUD Operations

First, audit your existing code for direct database operations:

```typescript
// Search for patterns like:
supabase.from('clients').insert(...)
supabase.from('clients').update(...)
supabase.from('clients').delete(...)
```

### 2. Map to Event Types

For each CRUD operation, identify the appropriate event type:

```typescript
// CRUD Operations → Event Types
INSERT INTO clients → client.registered
UPDATE clients SET status → client.status_changed
UPDATE clients SET ... → client.information_updated
DELETE FROM clients → client.archived
```

### 3. Add Reason Collection

Every form needs a reason field:

```diff
function ClientForm() {
+ const [reason, setReason] = useState('');

  return (
    <form>
      {/* existing fields */}
+     <ReasonInput
+       value={reason}
+       onChange={setReason}
+       required
+     />
    </form>
  );
}
```

### 4. Replace Database Calls

#### Before (CRUD):
```typescript
// CREATE
const { data, error } = await supabase
  .from('clients')
  .insert({
    first_name: 'John',
    last_name: 'Doe',
    organization_id: orgId
  });

// UPDATE
const { error } = await supabase
  .from('clients')
  .update({ status: 'active' })
  .eq('id', clientId);

// DELETE
const { error } = await supabase
  .from('clients')
  .delete()
  .eq('id', clientId);
```

#### After (Events):
```typescript
import { eventEmitter } from '@/lib/events/event-emitter';

// CREATE → Event
await eventEmitter.emit(
  crypto.randomUUID(),
  'client',
  'client.registered',
  {
    first_name: 'John',
    last_name: 'Doe',
    organization_id: orgId
  },
  'Initial intake from referral #12345' // REQUIRED reason
);

// UPDATE → Event
await eventEmitter.emit(
  clientId,
  'client',
  'client.status_changed',
  {
    previous_status: 'pending',
    new_status: 'active'
  },
  'Intake process completed and approved by supervisor'
);

// DELETE → Event (soft delete)
await eventEmitter.emit(
  clientId,
  'client',
  'client.archived',
  {
    archived_at: new Date().toISOString(),
    archive_type: 'inactive'
  },
  'Client inactive for 6+ months per retention policy'
);
```

## Common Patterns

### Pattern 1: Simple Updates

```typescript
// ❌ OLD: Direct update loses context
async function updatePhone(clientId: string, phone: string) {
  return supabase
    .from('clients')
    .update({ phone })
    .eq('id', clientId);
}

// ✅ NEW: Event captures why phone changed
async function updatePhone(clientId: string, phone: string, reason: string) {
  return eventEmitter.emit(
    clientId,
    'client',
    'client.contact_updated',
    {
      field: 'phone',
      old_value: oldPhone, // Optional: include for audit
      new_value: phone
    },
    reason // e.g., "Client provided new number during session"
  );
}
```

### Pattern 2: Status Transitions

```typescript
// ❌ OLD: Status update without context
async function dischargeClient(clientId: string) {
  return supabase
    .from('clients')
    .update({
      status: 'discharged',
      discharge_date: new Date()
    })
    .eq('id', clientId);
}

// ✅ NEW: Rich event with full context
async function dischargeClient(
  clientId: string,
  dischargeData: DischargeData,
  reason: string
) {
  return eventEmitter.emit(
    clientId,
    'client',
    'client.discharged',
    {
      discharge_date: dischargeData.date,
      discharge_type: dischargeData.type,
      discharge_disposition: dischargeData.disposition,
      follow_up_required: dischargeData.followUpRequired
    },
    reason // e.g., "Treatment goals achieved, transitioning to outpatient"
  );
}
```

### Pattern 3: Bulk Operations

```typescript
// ❌ OLD: Bulk update without individual context
async function bulkUpdateStatus(clientIds: string[], status: string) {
  return supabase
    .from('clients')
    .update({ status })
    .in('id', clientIds);
}

// ✅ NEW: Individual events with reasons
async function bulkUpdateStatus(
  updates: Array<{ clientId: string; status: string; reason: string }>
) {
  const events = updates.map(({ clientId, status, reason }) => ({
    streamId: clientId,
    streamType: 'client' as const,
    eventType: 'client.status_changed',
    eventData: { new_status: status },
    reason
  }));

  return eventEmitter.emitBatch(events);
}
```

### Pattern 4: Complex Updates

```typescript
// ❌ OLD: Multiple related updates
async function admitClient(clientId: string, admissionData: any) {
  // Update client
  await supabase.from('clients').update({
    status: 'admitted',
    admission_date: new Date()
  }).eq('id', clientId);

  // Create admission record
  await supabase.from('admissions').insert({
    client_id: clientId,
    ...admissionData
  });

  // Update bed assignment
  await supabase.from('beds').update({
    occupied_by: clientId
  }).eq('id', admissionData.bedId);
}

// ✅ NEW: Single event captures entire workflow
async function admitClient(
  clientId: string,
  admissionData: AdmissionData,
  reason: string
) {
  return eventEmitter.emit(
    clientId,
    'client',
    'client.admitted',
    {
      admission_date: new Date().toISOString(),
      bed_id: admissionData.bedId,
      unit: admissionData.unit,
      admitting_diagnosis: admissionData.diagnosis,
      insurance_verified: admissionData.insuranceVerified,
      emergency_contact: admissionData.emergencyContact
    },
    reason // e.g., "Emergency admission from ER for acute crisis"
  );

  // The database trigger handles all related updates
}
```

## Migration Checklist

### Phase 1: Preparation
- [ ] Install event-emitter library
- [ ] Add ReasonInput component
- [ ] Set up useEvents hook
- [ ] Deploy event infrastructure to Supabase

### Phase 2: Forms
For each form:
- [ ] Add reason field
- [ ] Add reason validation (min 10 chars)
- [ ] Update submit handler to emit events
- [ ] Test event emission

### Phase 3: Data Operations
For each CRUD operation:
- [ ] Identify appropriate event type
- [ ] Replace database call with event emission
- [ ] Ensure reason is collected
- [ ] Test the operation

### Phase 4: Queries
- [ ] Verify reads still work (no change needed)
- [ ] Add EventHistory components where helpful
- [ ] Test real-time updates if using subscriptions

### Phase 5: Cleanup
- [ ] Remove unused CRUD functions
- [ ] Update documentation
- [ ] Train team on new patterns

## Testing Migration

### Unit Tests

```typescript
describe('Client Registration', () => {
  it('should emit registration event with reason', async () => {
    const spy = jest.spyOn(eventEmitter, 'emit');

    await registerClient({
      firstName: 'John',
      lastName: 'Doe'
    }, 'Test registration for unit test');

    expect(spy).toHaveBeenCalledWith(
      expect.any(String), // UUID
      'client',
      'client.registered',
      expect.objectContaining({
        first_name: 'John',
        last_name: 'Doe'
      }),
      'Test registration for unit test'
    );
  });

  it('should reject without reason', async () => {
    await expect(
      registerClient({ firstName: 'John' }, '') // No reason
    ).rejects.toThrow('Reason must be at least 10 characters');
  });
});
```

### Integration Tests

```typescript
it('should project event to client table', async () => {
  // Emit event
  const clientId = crypto.randomUUID();
  await eventEmitter.emit(
    clientId,
    'client',
    'client.registered',
    { first_name: 'John', last_name: 'Doe' },
    'Integration test client'
  );

  // Wait for projection
  await new Promise(resolve => setTimeout(resolve, 100));

  // Verify projection
  const { data } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();

  expect(data).toMatchObject({
    first_name: 'John',
    last_name: 'Doe'
  });
});
```

## Gradual Migration Strategy

### Option 1: Feature Flags
```typescript
const USE_EVENTS = process.env.NEXT_PUBLIC_USE_EVENTS === 'true';

async function updateClient(id: string, data: any, reason?: string) {
  if (USE_EVENTS && reason) {
    return eventEmitter.emit(id, 'client', 'client.updated', data, reason);
  } else {
    console.warn('Using legacy CRUD - please provide reason');
    return supabase.from('clients').update(data).eq('id', id);
  }
}
```

### Option 2: Dual-Write
```typescript
async function updateClient(id: string, data: any, reason: string) {
  // Write event (source of truth)
  await eventEmitter.emit(id, 'client', 'client.updated', data, reason);

  // Also update directly for backward compatibility
  // Remove this after migration complete
  await supabase.from('clients').update(data).eq('id', id);
}
```

### Option 3: New Features Only
- Keep existing CRUD for old features
- Use events for all new features
- Gradually migrate old features

## Rollback Plan

If you need to rollback:

1. **Keep both systems running**: Events project to tables, so reads still work
2. **Disable event emission**: Switch back to direct updates
3. **Maintain projections**: Keep projection triggers active

```typescript
// Emergency fallback wrapper
class DataService {
  async updateClient(id: string, data: any, reason?: string) {
    try {
      if (reason) {
        return await eventEmitter.emit(id, 'client', 'client.updated', data, reason);
      }
    } catch (error) {
      console.error('Event emission failed, falling back to CRUD', error);
    }

    // Fallback to direct update
    return supabase.from('clients').update(data).eq('id', id);
  }
}
```

## Benefits After Migration

1. **Complete Audit Trail**: Every change has a reason
2. **Time Travel**: Can reconstruct state at any point
3. **Debugging**: See exactly what happened and why
4. **Compliance**: Full audit log for regulations
5. **Analytics**: Understand patterns in changes

## Common Mistakes to Avoid

### ❌ Generic Reasons
```typescript
// Bad: Generic reason
reason: "Updated client"
reason: "Changed"
reason: "Admin action"
```

### ✅ Specific Reasons
```typescript
// Good: Specific reason with context
reason: "Updated phone number per client request during intake call"
reason: "Corrected spelling of last name per ID verification"
reason: "Status changed to active after insurance approval received"
```

### ❌ Forgetting Stream Version
```typescript
// Bad: Hardcoded version
stream_version: 1 // Wrong if entity has existing events
```

### ✅ Calculate Version
```typescript
// Good: Dynamic version calculation
stream_version: await getNextVersion(streamId, streamType)
```

### ❌ Using Events Table for Queries
```typescript
// Bad: Querying events for current state
const events = await supabase.from('domain_events')...
const currentState = reduceEvents(events);
```

### ✅ Query Projected Tables
```typescript
// Good: Query the projected tables
const { data } = await supabase.from('clients').select('*');
```

## Support

- **Documentation**: See [EVENT-DRIVEN-GUIDE.md](./EVENT-DRIVEN-GUIDE.md)
- **Examples**: Check `src/examples/` directory
- **Infrastructure**: See [A4C-Infrastructure/supabase/docs/](https://github.com/Analytics4Change/A4C-Infrastructure/tree/main/supabase/docs)

## Timeline

Suggested migration timeline:

1. **Week 1-2**: Set up infrastructure, add ReasonInput component
2. **Week 3-4**: Migrate high-value forms (registration, medication)
3. **Week 5-6**: Migrate status transitions and workflows
4. **Week 7-8**: Migrate remaining CRUD operations
5. **Week 9-10**: Add EventHistory displays, optimize

Remember: The goal is to capture the "WHY" behind every change! 🎯