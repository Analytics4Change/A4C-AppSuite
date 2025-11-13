---
status: current
last_updated: 2025-11-13
---

# ImpersonationBanner

## Overview

`ImpersonationBanner` is a security-critical UI component that displays a prominent banner at the top of the screen when a super admin is impersonating another user. It provides high visibility of the impersonation session, shows time remaining with visual urgency indicators, and offers quick access to end the session.

This component is essential for security compliance, audit trail transparency, and preventing unauthorized prolonged impersonation. The banner uses color-coded visual states that escalate urgency as the session approaches expiration.

## Props and Usage

```typescript
interface ImpersonationBannerProps {
  // Current impersonation session data
  session: ImpersonationSession;

  // Callback invoked when user clicks "End Impersonation" button
  onEndImpersonation: () => void;
}

// Session interface (from impersonation.service.ts)
interface ImpersonationSession {
  context: {
    impersonatedUserEmail: string;    // Email of impersonated user
    impersonatedUserRole: string;     // Role of impersonated user
    reason?: string;                  // Reason for impersonation (optional)
  };
  timeRemaining: number;              // Minutes remaining in session
  isWarning: boolean;                 // Critical time threshold (< 5 min)
}
```

## Usage Examples

### Basic Usage

Display banner in main layout when impersonation active:

```tsx
import { ImpersonationBanner } from '@/components/auth/ImpersonationBanner';
import { useImpersonation } from '@/contexts/ImpersonationContext';

const AppLayout = ({ children }) => {
  const { session, endImpersonation } = useImpersonation();

  return (
    <div>
      {session && (
        <ImpersonationBanner
          session={session}
          onEndImpersonation={endImpersonation}
        />
      )}
      <main>{children}</main>
    </div>
  );
};
```

### With Navigation Integration

Position banner above navigation:

```tsx
const MainLayout = () => {
  const { impersonationSession, stopImpersonation } = useAuth();

  return (
    <>
      {impersonationSession && (
        <ImpersonationBanner
          session={impersonationSession}
          onEndImpersonation={stopImpersonation}
        />
      )}
      <Navigation />
      <PageContent />
    </>
  );
};
```

## Visual States

### Color-Coded Urgency

The banner changes color based on time remaining:

**Yellow** (`bg-yellow-600`):
- Time remaining: > 10 minutes
- Standard visibility
- No animation

**Orange** (`bg-orange-600`):
- Time remaining: 5-10 minutes
- Increased urgency
- No animation

**Red** (`bg-red-600`):
- Time remaining: < 5 minutes OR `isWarning: true`
- Critical urgency
- Pulsing time display (`animate-pulse`)

### Time Display Format

```typescript
formatTimeRemaining(45) → "45 minutes"
formatTimeRemaining(10) → "10 minutes"
formatTimeRemaining(1)  → "1 minute"
formatTimeRemaining(0)  → "Less than 1 minute"
```

## Layout and Content

### Banner Sections

**Left Side** (Session Info):
- ⚠️ Alert triangle icon
- "IMPERSONATING: user@example.com"
- "As: provider_admin" (role)
- "Reason: Debug issue #123" (if provided)

**Right Side** (Actions):
- 🕐 Clock icon with time remaining
- "End Impersonation" button

### Responsive Design

- **Desktop**: Full horizontal layout with all info visible
- **Tablet/Mobile**: Consider truncating reason or stacking elements

## Accessibility

### WCAG 2.1 Level AA Compliance

- **High Visibility**: Banner uses high-contrast colors (white text on colored background)
- **Keyboard Accessible**: "End Impersonation" button fully keyboard accessible
- **ARIA Label**: Button has `aria-label="End impersonation"`
- **Screen Reader Support**:
  - All session details announced
  - Time remaining announced
  - Color changes don't convey info alone (text also changes)
- **Focus Indicator**: Button shows focus state for keyboard navigation
- **z-index**: `z-50` ensures banner is always visible above other content

## Security Considerations

### Audit Trail

The banner displays:
- Who is being impersonated (email + role)
- Why (if reason provided)
- When session will expire (time remaining)

All information is recorded in audit logs via `impersonationService`.

### Session Timeout

- Default: 30-minute sessions (configurable)
- Visual warnings escalate as expiration approaches
- Automatic session termination on timeout
- Manual termination via "End Impersonation" button

### Visual Security

- **High Visibility**: Cannot be hidden or dismissed accidentally
- **Color Urgency**: Red color signals critical security state
- **Persistent Display**: Always visible at top of page
- **Clear Labeling**: "IMPERSONATING" in all caps for emphasis

## Implementation Notes

### Dependencies

- **Lucide React**: `AlertTriangle`, `X`, `Clock` icons
- **impersonationService**: Session management service
- **Tailwind CSS**: Utility classes for styling

### State Management

- **No Internal State**: Fully controlled by parent via `session` prop
- **Time Updates**: Parent responsible for updating `timeRemaining` periodically
- **End Handler**: Parent handles session cleanup via `onEndImpersonation`

### Performance

- **Simple Rendering**: Pure functional component, minimal re-renders
- **Color Calculation**: Inline functions run on each render (negligible cost)
- **No Side Effects**: Component only displays data, doesn't manage session

## Testing

### Unit Tests

Key test cases:
- ✅ Renders with yellow background when > 10 min remaining
- ✅ Renders with orange background when 5-10 min remaining
- ✅ Renders with red background when < 5 min remaining
- ✅ Shows pulsing animation when `isWarning: true`
- ✅ Displays impersonated user email and role
- ✅ Shows reason if provided
- ✅ Formats time remaining correctly
- ✅ Calls `onEndImpersonation` when button clicked

### E2E Tests

Key user flows:
- Super admin starts impersonation, sees banner appear
- User clicks "End Impersonation" button, banner disappears
- Time counts down, banner color changes appropriately
- Session expires automatically, user returned to original account

## Related Components

- **ImpersonationModal** - Modal for initiating impersonation
- **RequirePermission** - Guards impersonation feature to super admins only
- **AuthContext** - Provides impersonation session state
- **impersonationService** - Manages impersonation sessions and audit logs

## Security Architecture

For complete impersonation security architecture, see:
- `../../../architecture/authentication/impersonation-architecture.md`
- `../../../architecture/authentication/impersonation-security-controls.md`

## Changelog

- **2025-11-13**: Initial documentation created
- **Component Creation**: Part of impersonation feature implementation (aspirational)
