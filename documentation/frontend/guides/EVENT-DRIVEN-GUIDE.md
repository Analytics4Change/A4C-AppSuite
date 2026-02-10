---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Guide to implementing CQRS patterns in React components. Emit events (not CRUD updates), always include a "reason", and use ViewModels to trigger events and read from projections.

**When to read**:
- Implementing a new feature that modifies data
- Converting CRUD operations to event-driven patterns
- Understanding why events require "reason" field
- Building forms that emit domain events

**Prerequisites**:
- Read: [event-sourcing-overview.md](../../architecture/data/event-sourcing-overview.md)

**Key topics**: `events`, `cqrs`, `react`, `viewmodel`, `domain-events`, `frontend`

**Estimated read time**: 15 minutes
<!-- TL;DR-END -->

# Event-Driven Frontend Implementation Guide

This guide explains how to implement the event-driven architecture in the A4C Frontend application.

## Core Concepts

### Events vs CRUD
Instead of directly updating database records, we emit events that describe what happened:
- ❌ `UPDATE clients SET status = 'discharged'` (loses context)
- ✅ Emit `client.discharged` event with reason (preserves full context)

### The "Reason" Requirement
Every event MUST include a reason explaining WHY the change is happening:
```typescript
// This is REQUIRED - minimum 10 characters
event_metadata: {
  user_id: currentUser.id,
  reason: "Client discharged to home with family support per treatment team decision"
}
```

## TypeScript Setup

### 1. Install Event Types
```bash
# Copy generated types from Infrastructure repo (for local development when both repos are checked out side-by-side)
# For remote access, see: https://github.com/Analytics4Change/A4C-Infrastructure/tree/main/supabase/contracts/generated/typescript
cp ../A4C-Infrastructure/supabase/contracts/generated/typescript/* src/types/
```

### 2. Create Event SDK
```typescript
// src/lib/events/event-emitter.ts
import { supabase } from '@/lib/supabase';
import { DomainEvent, EventMetadata } from '@/types/event-types';

export class EventEmitter {
  private async getNextVersion(streamId: string, streamType: string): Promise<number> {
    const { data } = await supabase
      .from('domain_events')
      .select('stream_version')
      .eq('stream_id', streamId)
      .eq('stream_type', streamType)
      .order('stream_version', { ascending: false })
      .limit(1);

    return (data?.[0]?.stream_version || 0) + 1;
  }

  async emit<T = any>(
    streamId: string,
    streamType: string,
    eventType: string,
    eventData: T,
    reason: string,
    additionalMetadata?: Partial<EventMetadata>
  ): Promise<void> {
    // Validate reason
    if (!reason || reason.length < 10) {
      throw new Error('Reason must be at least 10 characters');
    }

    const version = await this.getNextVersion(streamId, streamType);

    const { error } = await supabase
      .from('domain_events')
      .insert({
        stream_id: streamId,
        stream_type: streamType,
        stream_version: version,
        event_type: eventType,
        event_data: eventData,
        event_metadata: {
          user_id: (await supabase.auth.getUser()).data.user?.id,
          reason,
          ...additionalMetadata
        }
      });

    if (error) throw error;
  }
}

export const eventEmitter = new EventEmitter();
```

## React Hooks

### useEvents Hook
```typescript
// src/hooks/useEvents.ts
import { useState } from 'react';
import { eventEmitter } from '@/lib/events/event-emitter';
import { EventMetadata } from '@/types/event-types';

export function useEvents() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emitEvent = async (
    streamId: string,
    streamType: string,
    eventType: string,
    eventData: any,
    reason: string,
    additionalMetadata?: Partial<EventMetadata>
  ) => {
    setSubmitting(true);
    setError(null);

    try {
      await eventEmitter.emit(
        streamId,
        streamType,
        eventType,
        eventData,
        reason,
        additionalMetadata
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to emit event');
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  return { emitEvent, submitting, error };
}
```

### useEventHistory Hook
```typescript
// src/hooks/useEventHistory.ts
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface EventHistoryItem {
  event_type: string;
  change_reason: string;
  changed_by_name: string;
  occurred_at: string;
  event_data: any;
}

export function useEventHistory(entityId: string) {
  const [history, setHistory] = useState<EventHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchHistory() {
      const { data, error } = await supabase
        .from('event_history_by_entity')
        .select('*')
        .eq('entity_id', entityId)
        .order('version');

      if (!error) setHistory(data || []);
      setLoading(false);
    }

    fetchHistory();
  }, [entityId]);

  return { history, loading };
}
```

## Component Patterns

### Pattern 1: Form with Reason Field
```tsx
// src/components/forms/ClientRegistrationForm.tsx
import { useEvents } from '@/hooks/useEvents';
import { ReasonInput } from '@/components/ui/ReasonInput';

export function ClientRegistrationForm() {
  const { emitEvent, submitting } = useEvents();
  const [reason, setReason] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);

    await emitEvent(
      crypto.randomUUID(),
      'client',
      'client.registered',
      {
        organization_id: currentOrg.id,
        first_name: formData.get('firstName'),
        last_name: formData.get('lastName'),
        date_of_birth: formData.get('dateOfBirth'),
        // ... other fields
      },
      reason
    );
  };

  return (
    <form onSubmit={handleSubmit}>
      <fieldset>
        <legend>Client Information</legend>
        <input name="firstName" required />
        <input name="lastName" required />
        <input type="date" name="dateOfBirth" required />
      </fieldset>

      <ReasonInput
        value={reason}
        onChange={setReason}
        placeholder="Reason for registration (e.g., 'Referral from Dr. Smith for anxiety treatment')"
        required
      />

      <button type="submit" disabled={submitting}>
        Register Client
      </button>
    </form>
  );
}
```

### Pattern 2: Reason Input Component
```tsx
// src/components/ui/ReasonInput.tsx
interface ReasonInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
}

export function ReasonInput({
  value,
  onChange,
  placeholder,
  required = true,
  minLength = 10
}: ReasonInputProps) {
  const [error, setError] = useState('');

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    if (newValue.length < minLength) {
      setError(`Reason must be at least ${minLength} characters`);
    } else {
      setError('');
    }
  };

  return (
    <div className="reason-input">
      <label>
        Reason for Change <span className="required">*</span>
        <textarea
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          rows={3}
          className={error ? 'error' : ''}
        />
      </label>
      {error && <span className="error-message">{error}</span>}
      <small className="help-text">
        Explain why this change is being made (required for audit trail)
      </small>
    </div>
  );
}
```

### Pattern 3: Event History Display
```tsx
// src/components/EventHistory.tsx
import { useEventHistory } from '@/hooks/useEventHistory';

export function EventHistory({ entityId }: { entityId: string }) {
  const { history, loading } = useEventHistory(entityId);

  if (loading) return <div>Loading history...</div>;

  return (
    <div className="event-history">
      <h3>Change History</h3>
      {history.map((event, index) => (
        <div key={index} className="event-item">
          <div className="event-header">
            <span className="event-type">{formatEventType(event.event_type)}</span>
            <span className="event-date">{formatDate(event.occurred_at)}</span>
          </div>
          <div className="event-reason">
            <strong>Reason:</strong> {event.change_reason}
          </div>
          <div className="event-user">
            <small>By {event.changed_by_name}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatEventType(type: string): string {
  return type.split('.').join(' ').replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}
```

## Common Use Cases

### 1. Creating a New Entity
```typescript
// Register a new client
await emitEvent(
  crypto.randomUUID(),
  'client',
  'client.registered',
  clientData,
  'Initial intake from emergency department referral #12345'
);
```

### 2. Updating Information
```typescript
// Update client information
await emitEvent(
  clientId,
  'client',
  'client.information_updated',
  { changes: updatedFields },
  'Updated contact information per client request during session'
);
```

### 3. State Transitions
```typescript
// Discharge a client
await emitEvent(
  clientId,
  'client',
  'client.discharged',
  {
    discharge_date: new Date(),
    discharge_type: 'planned',
    discharge_disposition: 'home_with_services'
  },
  'Successful completion of treatment program, transitioning to outpatient care'
);
```

### 4. Complex Workflows
```typescript
// Prescribe medication with approval
await emitEvent(
  prescriptionId,
  'medication_history',
  'medication.prescribed',
  {
    client_id: clientId,
    medication_id: medicationId,
    dosage_amount: 25,
    dosage_unit: 'mg',
    frequency: 'twice daily'
  },
  'Initial prescription for anxiety disorder per DSM-5 diagnosis',
  {
    approval_chain: [{
      approver_id: physicianId,
      approver_name: 'Dr. Smith',
      role: 'physician',
      approved_at: new Date().toISOString()
    }]
  }
);
```

## Form Validation

### Reason Validation Schema (Zod)
```typescript
// src/lib/validation/event-schemas.ts
import { z } from 'zod';

export const reasonSchema = z.string()
  .min(10, 'Reason must be at least 10 characters')
  .max(500, 'Reason must be less than 500 characters');

export const eventMetadataSchema = z.object({
  user_id: z.string().uuid(),
  reason: reasonSchema,
  correlation_id: z.string().uuid().optional(),
  approval_chain: z.array(z.object({
    approver_id: z.string().uuid(),
    role: z.enum(['physician', 'nurse_practitioner', 'pharmacist', 'administrator']),
    approved_at: z.string().datetime()
  })).optional()
});

// Example form schema
export const clientRegistrationSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  date_of_birth: z.string().date(),
  reason: reasonSchema // Always include reason
});
```

### React Hook Form Integration
```tsx
// src/components/forms/MedicationForm.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { medicationPrescriptionSchema } from '@/lib/validation';

export function MedicationForm({ clientId }: { clientId: string }) {
  const { emitEvent } = useEvents();

  const form = useForm({
    resolver: zodResolver(medicationPrescriptionSchema),
    defaultValues: {
      reason: ''
    }
  });

  const onSubmit = async (data: any) => {
    await emitEvent(
      crypto.randomUUID(),
      'medication_history',
      'medication.prescribed',
      {
        client_id: clientId,
        ...data
      },
      data.reason // Reason from form
    );
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      {/* Form fields */}

      <div>
        <label>Reason for Prescription *</label>
        <textarea
          {...form.register('reason')}
          placeholder="Explain medical justification..."
        />
        {form.formState.errors.reason && (
          <span>{form.formState.errors.reason.message}</span>
        )}
      </div>

      <button type="submit">Prescribe Medication</button>
    </form>
  );
}
```

## Testing

### Testing Event Emission
```typescript
// src/lib/events/__tests__/event-emitter.test.ts
import { eventEmitter } from '../event-emitter';

describe('EventEmitter', () => {
  it('should require a reason of at least 10 characters', async () => {
    await expect(
      eventEmitter.emit(
        'test-id',
        'client',
        'client.test',
        {},
        'short' // Too short!
      )
    ).rejects.toThrow('Reason must be at least 10 characters');
  });

  it('should emit valid events', async () => {
    const spy = jest.spyOn(supabase.from('domain_events'), 'insert');

    await eventEmitter.emit(
      'test-id',
      'client',
      'client.test',
      { test: true },
      'Valid reason for testing purposes'
    );

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        event_metadata: expect.objectContaining({
          reason: 'Valid reason for testing purposes'
        })
      })
    );
  });
});
```

### Testing React Components
```tsx
// src/components/__tests__/ReasonInput.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ReasonInput } from '../ui/ReasonInput';

test('validates minimum length', () => {
  const onChange = jest.fn();
  render(<ReasonInput value="" onChange={onChange} />);

  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'short' } });

  expect(screen.getByText(/at least 10 characters/)).toBeInTheDocument();
});
```

## Error Handling

### Global Event Error Handler
```typescript
// src/lib/events/error-handler.ts
export class EventError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'EventError';
  }
}

export function handleEventError(error: any): never {
  if (error.code === '23514') { // CHECK constraint violation
    throw new EventError(
      'Event validation failed. Reason may be too short.',
      'VALIDATION_ERROR',
      error
    );
  }

  if (error.code === '23505') { // Unique constraint violation
    throw new EventError(
      'Duplicate event detected',
      'DUPLICATE_EVENT',
      error
    );
  }

  throw error;
}
```

### User-Friendly Error Messages
```tsx
// src/components/forms/ErrorBoundary.tsx
export function EventErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallbackRender={({ error }) => {
        if (error instanceof EventError) {
          return (
            <Alert variant="error">
              <AlertTitle>Event Error</AlertTitle>
              <AlertDescription>
                {error.code === 'VALIDATION_ERROR'
                  ? 'Please provide a detailed reason (at least 10 characters) explaining why this change is necessary.'
                  : error.message}
              </AlertDescription>
            </Alert>
          );
        }
        return <div>Something went wrong</div>;
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
```

## Performance Optimization

### Batch Event Processing
```typescript
// src/lib/events/batch-emitter.ts
export class BatchEventEmitter {
  private queue: DomainEvent[] = [];
  private timer: NodeJS.Timeout | null = null;

  async emitBatch(events: Omit<DomainEvent, 'id'>[]): Promise<void> {
    const { error } = await supabase
      .from('domain_events')
      .insert(events);

    if (error) throw error;
  }

  queueEvent(event: Omit<DomainEvent, 'id'>) {
    this.queue.push(event);

    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), 100);
    }
  }

  private async flush() {
    if (this.queue.length > 0) {
      await this.emitBatch(this.queue);
      this.queue = [];
    }
    this.timer = null;
  }
}
```

### Optimistic Updates
```typescript
// src/hooks/useOptimisticEvents.ts
export function useOptimisticEvents() {
  const queryClient = useQueryClient();
  const { emitEvent } = useEvents();

  const emitWithOptimisticUpdate = async (
    streamId: string,
    streamType: string,
    eventType: string,
    eventData: any,
    reason: string,
    optimisticUpdate?: (cache: any) => any
  ) => {
    // Optimistically update the UI
    if (optimisticUpdate) {
      queryClient.setQueryData(['entity', streamId], optimisticUpdate);
    }

    try {
      await emitEvent(streamId, streamType, eventType, eventData, reason);
    } catch (error) {
      // Revert optimistic update on failure
      queryClient.invalidateQueries(['entity', streamId]);
      throw error;
    }
  };

  return { emitWithOptimisticUpdate };
}
```

## Debugging

### Event Inspector Component
```tsx
// src/components/debug/EventInspector.tsx
export function EventInspector() {
  const [events, setEvents] = useState<DomainEvent[]>([]);

  useEffect(() => {
    // Subscribe to real-time events
    const subscription = supabase
      .channel('events')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'domain_events'
      }, payload => {
        setEvents(prev => [payload.new as DomainEvent, ...prev]);
      })
      .subscribe();

    return () => subscription.unsubscribe();
  }, []);

  if (process.env.NODE_ENV !== 'development') return null;

  return (
    <div className="fixed bottom-0 right-0 p-4 bg-black text-white max-w-md">
      <h3>Event Stream</h3>
      {events.map(event => (
        <div key={event.id} className="mb-2 text-xs">
          <div>{event.event_type}</div>
          <div>Reason: {event.event_metadata.reason}</div>
        </div>
      ))}
    </div>
  );
}
```

## Migration Guide

### Converting CRUD to Events
```typescript
// ❌ OLD: Direct update
async function updateClient(id: string, data: any) {
  return supabase
    .from('clients')
    .update(data)
    .eq('id', id);
}

// ✅ NEW: Event-based update
async function updateClient(id: string, changes: any, reason: string) {
  return eventEmitter.emit(
    id,
    'client',
    'client.information_updated',
    { changes },
    reason
  );
}

// ❌ OLD: Delete
async function deleteClient(id: string) {
  return supabase
    .from('clients')
    .delete()
    .eq('id', id);
}

// ✅ NEW: Soft delete via event
async function archiveClient(id: string, reason: string) {
  return eventEmitter.emit(
    id,
    'client',
    'client.archived',
    { archived_at: new Date() },
    reason
  );
}
```

## Best Practices

### 1. Always Capture Intent
```typescript
// Bad: Generic reason
reason: "Updated client information"

// Good: Specific reason with context
reason: "Updated phone number per client request during intake call on 2024-01-15"
```

### 2. Use Domain-Specific Event Types
```typescript
// Bad: Generic event
event_type: 'entity.updated'

// Good: Specific event
event_type: 'client.contact_information_updated'
```

### 3. Include Relevant Context
```typescript
// Include who approved changes
event_metadata: {
  user_id: currentUser.id,
  reason: "Medication change per psychiatrist recommendation",
  approval_chain: [{
    approver_id: psychiatristId,
    role: 'physician',
    approved_at: new Date().toISOString()
  }]
}
```

### 4. Validate Before Emitting
```typescript
// Validate business rules before emitting
if (dosage > MAX_DOSAGE) {
  throw new Error(`Dosage exceeds maximum allowed (${MAX_DOSAGE}mg)`);
}

await emitEvent(...);
```

## Troubleshooting

### Common Issues

#### "Reason too short" error
- Ensure reason is at least 10 characters
- Provide meaningful context, not just "updated" or "changed"

#### Events not processing
- Check `processing_error` field in domain_events table
- Verify event_type matches expected format (domain.action)
- Ensure event_data is valid JSON

#### Wrong version number
- Don't hardcode stream_version
- Always calculate next version dynamically
- Use the getNextVersion helper function

---

## Related Documentation

### Event Sourcing & CQRS Architecture
- **[Event Sourcing Overview](../../architecture/data/event-sourcing-overview.md)** - CQRS and domain events architecture
- **[Event-Driven Architecture Guide](../../infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md)** - Complete backend event sourcing specification
- **[domain_events Table](../../infrastructure/reference/database/tables/domain_events.md)** - Event store schema documentation
- **event_subscriptions** - Event subscriber configuration (not yet implemented)

### Frontend Architecture
- **[Frontend Architecture Overview](../architecture/overview.md)** - High-level application architecture
- **[ViewModels Architecture](../architecture/viewmodels.md)** - MobX state management with events
- **[Event Resilience Plan](../architecture/event-resilience-plan.md)** - Event-driven reliability patterns
- **[Frontend Auth Architecture](../../architecture/authentication/frontend-auth-architecture.md)** - JWT claims in event metadata

### Database & Projections
- **[Multi-Tenancy Architecture](../../architecture/data/multi-tenancy-architecture.md)** - Organization isolation with RLS
- **[Database Tables Reference](../../infrastructure/reference/database/tables/)** - All CQRS projection tables
  - [organizations_projection.md](../../infrastructure/reference/database/tables/organizations_projection.md) - Organization read model
  - [users.md](../../infrastructure/reference/database/tables/users.md) - User read model
  - [domain_events.md](../../infrastructure/reference/database/tables/domain_events.md) - Event store (audit trail)

### Implementation & Testing
- **[Design Patterns Migration Guide](./DESIGN_PATTERNS_MIGRATION_GUIDE.md)** - Component architecture patterns
- **[Testing Strategies](../testing/TESTING.md)** - Unit and E2E testing with events

---

## Resources

- [Infrastructure Documentation](https://github.com/Analytics4Change/A4C-Infrastructure/tree/main/supabase/docs)
- [AsyncAPI Contracts](https://github.com/Analytics4Change/A4C-Infrastructure/tree/main/supabase/contracts/asyncapi)
- [OpenAPI Specification](https://github.com/Analytics4Change/A4C-Infrastructure/tree/main/supabase/contracts/openapi)
- [SQL Event Processing](https://github.com/Analytics4Change/A4C-Infrastructure/tree/main/supabase/sql/03-functions/event-processing)

## Next Steps

1. Install type definitions from Infrastructure repo
2. Implement EventEmitter class
3. Create ReasonInput component
4. Add reason field to all forms
5. Replace CRUD operations with events
6. Add event history displays
7. Test with sample events

Remember: Every change needs a reason! 🎯