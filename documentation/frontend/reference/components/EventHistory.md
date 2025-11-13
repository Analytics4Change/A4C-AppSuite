---
status: current
last_updated: 2025-11-13
---

# EventHistory

## Overview

`EventHistory` is a complex display component that renders a chronological timeline of domain events for a specific entity. It provides real-time event updates, expandable event details, visual event categorization with icons and colors, and robust error handling with loading states.

This component is essential for audit trails, change tracking, and providing transparency in the application's event-driven architecture. It integrates with the `useEventHistory` hook to subscribe to events and maintain real-time synchronization.

## Props and Usage

```typescript
export interface EventHistoryProps {
  // Entity ID to fetch event history for
  entityId: string;

  // Optional stream type filter (e.g., 'client', 'medication', 'organization')
  streamType?: StreamType;

  // Optional event type filters (e.g., ['client.registered', 'client.updated'])
  eventTypes?: string[];

  // Maximum number of events to display (default: 20)
  limit?: number;

  // Whether to subscribe to real-time event updates (default: true)
  realtime?: boolean;

  // Additional CSS classes for container
  className?: string;

  // Whether to show expandable raw event data (default: false)
  showRawData?: boolean;

  // Custom title for the history section (default: "Change History")
  title?: string;

  // Custom message when no events exist (default: "No changes recorded yet")
  emptyMessage?: string;
}
```

## Usage Examples

### Basic Usage

Display complete event history for a client:

```tsx
import { EventHistory } from '@/components/EventHistory';

const ClientDetailPage = ({ clientId }: { clientId: string }) => {
  return (
    <div>
      <EventHistory entityId={clientId} />
    </div>
  );
};
```

### Filtered Events

Show only specific event types:

```tsx
<EventHistory
  entityId={medicationId}
  streamType="medication"
  eventTypes={['medication.prescribed', 'medication.discontinued']}
  title="Prescription History"
  limit={10}
/>
```

### With Raw Data Debugging

Enable expandable event data for debugging:

```tsx
<EventHistory
  entityId={organizationId}
  streamType="organization"
  showRawData={true}
  title="Organization Changes"
/>
```

### Static (Non-Realtime)

Disable real-time updates for archived data:

```tsx
<EventHistory
  entityId={archivedClientId}
  realtime={false}
  emptyMessage="No archived events found"
/>
```

## Event Visualization

### Event Icons

Events are categorized with emoji icons:
- ➕ Created/Registered
- ✏️ Updated/Changed
- 🗑️ Deleted/Archived
- 🏠 Discharged
- 💊 Prescribed
- ✅ Approved
- ❌ Rejected
- 📝 Default (other)

### Event Colors

Border and background colors indicate event status:
- **Red** (`border-red-500 bg-red-50`): Errors, failures
- **Amber** (`border-amber-500 bg-amber-50`): Warnings
- **Green** (`border-green-500 bg-green-50`): Success, approved
- **Gray** (`border-gray-300 bg-white`): Normal events

### Event Type Formatting

Event types are transformed for readability:
- Input: `client.medication_history.prescribed`
- Output: `Client → Medication History → Prescribed`

## States and Error Handling

### Loading State

Displays animated skeleton placeholders:
```tsx
// 3 pulsing gray rectangles while loading
```

### Error State

Shows error message with retry button:
```tsx
// Red-bordered box with error message and "Try again" link
```

### Empty State

Displays custom or default empty message:
```tsx
// Centered gray text: "No changes recorded yet"
```

## Real-Time Updates

When `realtime={true}` (default):
- Subscribes to new events via `useEventHistory` hook
- Shows green "Live updates" indicator with pulsing dot
- Automatically refreshes when new events occur
- Maintains scroll position during updates

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Semantic Structure**: Uses headings, lists, and semantic HTML
- **Keyboard Navigation**: All interactive elements (expand buttons, retry) are keyboard accessible
- **Focus Indicators**: Visible focus states on all buttons
- **Screen Reader Support**:
  - Event type announced as heading
  - Timestamp with `title` attribute for full date
  - Change reason clearly labeled
  - Error messages in alert boxes
- **Color Contrast**: All text meets 4.5:1 ratio minimum
- **Loading Feedback**: Screen readers announce loading via aria-live regions (via hook)

## Implementation Notes

### Dependencies

- **`useEventHistory` hook**: Fetches and subscribes to events
- **`date-fns`**: For date formatting (`formatDistanceToNow`, `format`)
- **`StreamType`**: Type definition from `@/types/event-types`
- **`cn` utility**: Conditional class names

### State Management

- **Expanded Items**: `Set<string>` tracks which events show raw data
- **Hook Data**: Loading, error, and history state from `useEventHistory`

### Performance

- **Memoization**: Consider wrapping in `React.memo` for large lists
- **Virtual Scrolling**: For > 100 events, consider virtualization
- **Limit Prop**: Default 20 events prevents performance issues

## Testing

### Unit Tests

Key test cases:
- ✅ Renders loading skeleton initially
- ✅ Displays events after load
- ✅ Shows error state with retry button
- ✅ Displays empty state when no events
- ✅ Formats event types correctly
- ✅ Shows/hides raw data on toggle
- ✅ Displays real-time indicator when enabled

### E2E Tests

Key user flows:
- User views event history for entity
- User expands event to see raw data
- User sees new event appear in real-time
- User retries after error

## Related Components

- **`useEventHistory` hook** (`/hooks/useEventHistory.ts`) - Data fetching and real-time subscription
- **Event types** (`/types/event-types.ts`) - Type definitions for events
- **Timeline components** - Similar historical display patterns

## Changelog

- **2025-11-13**: Initial documentation created
- **Component Creation**: Part of event-driven architecture implementation
