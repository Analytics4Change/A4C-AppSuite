---
status: current
last_updated: 2025-11-13
---

# ImpersonationModal

## Overview

`ImpersonationModal` is a security-critical modal dialog component for initiating impersonation sessions. It provides user search and selection, mandatory reason input, prominent security warnings, and comprehensive form validation before starting an impersonation session.

This component is essential for administrative troubleshooting and support scenarios, ensuring all impersonation sessions are properly justified, audited, and time-limited. The modal enforces strict validation requirements and displays clear warnings about audit logging and session restrictions.

## Props and Usage

```typescript
interface ImpersonationModalProps {
  // Controls modal visibility
  isOpen: boolean;

  // Callback invoked when modal should close
  onClose: () => void;

  // Current authenticated user initiating impersonation
  currentUser: {
    id: string;
    email: string;
    role: string;
  };

  // Callback invoked after impersonation successfully starts
  onImpersonationStart: () => void;
}

interface UserOption {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationName?: string;
}
```

## Usage Examples

### Basic Usage

Display modal when super admin initiates impersonation:

```tsx
import { useState } from 'react';
import { ImpersonationModal } from '@/components/auth/ImpersonationModal';
import { useAuth } from '@/contexts/AuthContext';

const AdminDashboard = () => {
  const [showImpersonationModal, setShowImpersonationModal] = useState(false);
  const { user } = useAuth();

  const handleImpersonationStart = () => {
    // Refresh UI to show impersonation banner
    window.location.reload();
  };

  return (
    <div>
      <button onClick={() => setShowImpersonationModal(true)}>
        Start Impersonation
      </button>

      <ImpersonationModal
        isOpen={showImpersonationModal}
        onClose={() => setShowImpersonationModal(false)}
        currentUser={user}
        onImpersonationStart={handleImpersonationStart}
      />
    </div>
  );
};
```

### With Permission Check

Restrict modal access to super admins only:

```tsx
import { ImpersonationModal } from '@/components/auth/ImpersonationModal';
import { RequirePermission } from '@/components/auth/RequirePermission';
import { useAuth } from '@/contexts/AuthContext';

const AdminTools = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { user } = useAuth();

  return (
    <RequirePermission permission="impersonation.start">
      <button onClick={() => setIsOpen(true)}>
        Impersonate User
      </button>

      <ImpersonationModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        currentUser={user}
        onImpersonationStart={() => {
          setIsOpen(false);
          // Navigate or refresh UI
        }}
      />
    </RequirePermission>
  );
};
```

### With Keyboard Shortcut

Allow admins to open modal via keyboard:

```tsx
import { useEffect, useState } from 'react';
import { ImpersonationModal } from '@/components/auth/ImpersonationModal';

const AdminLayout = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+I to open impersonation modal
      if (e.ctrlKey && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        setIsOpen(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <>
      {/* Layout content */}
      <ImpersonationModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        currentUser={user}
        onImpersonationStart={() => {
          setIsOpen(false);
          window.location.reload();
        }}
      />
    </>
  );
};
```

## Modal Sections

### Header

**Styling**: Yellow background (`bg-yellow-50`) with warning icon
**Content**:
- ⚠️ Alert triangle icon (yellow)
- "Start Impersonation Session" title
- Close button (X icon)

### Security Warning Banner

**Styling**: Yellow background with border
**Message**:
- All actions logged for audit
- 30-minute session expiration
- Administrative action restrictions during impersonation

### User Search

**Field**: Text input with search icon
**Placeholder**: "Search by name, email, or organization..."
**Functionality**:
- Real-time filtering as user types
- Case-insensitive matching
- Searches across name, email, and organization name

### User Selection List

**Container**: Scrollable list (max height 192px)
**Display**:
- Radio button selection
- User icon
- User name (bold)
- User email, role, organization (gray)
- Highlight selected user (blue background)

**States**:
- **Loading**: "Loading users..." message
- **Empty**: "No users found" message
- **Filtered**: Shows only matching users

### Reason Input

**Field**: Textarea (3 rows)
**Label**: "Reason for Impersonation" with red asterisk
**Placeholder**: "Provide a detailed reason for this impersonation session..."
**Validation**: Required, must not be empty or whitespace-only

### Error Display

**Styling**: Red background (`bg-red-50`) with border
**Position**: Above footer, below form fields
**Examples**:
- "Please select a user to impersonate"
- "Please provide a reason for impersonation"
- "Failed to start impersonation"

### Footer

**Styling**: Gray background (`bg-gray-50`)
**Buttons**:
- **Cancel**: Gray border, closes modal without action
- **Start Impersonation**: Yellow background, disabled until form valid

## Form Validation

### Client-Side Validation

**Before Submission**:
1. ✅ User must be selected
2. ✅ Reason must be provided (non-empty after trim)
3. ✅ Form cannot be submitted while already submitting

**Validation Timing**:
- On form submit (not on field blur)
- Errors displayed immediately after validation failure
- Clear error messages guide user to correct issues

### Server-Side Validation

**Via impersonationService.startImpersonation()**:
- Session creation validation
- Permission verification
- Audit log creation
- JWT token generation with impersonation claims

## User Search Behavior

### Search Algorithm

```typescript
const filteredUsers = users.filter(user =>
  user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
  user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
  user.organizationName?.toLowerCase().includes(searchTerm.toLowerCase())
);
```

**Features**:
- Case-insensitive matching
- Partial string matching (contains, not startsWith)
- Searches across multiple fields simultaneously
- Real-time filtering (no debouncing)

### User List Display

**Format**:
```
[●] User Icon   John Doe
              john.doe@example.com • administrator • Clinic A
```

**Selection**:
- Click anywhere on row to select
- Radio button automatically checked
- Selected row highlighted with blue background
- Only one user can be selected at a time

## Security Considerations

### Audit Trail

**All impersonation sessions logged with**:
- Impersonator user ID and email
- Target user ID and email
- Session start time
- Reason provided
- Session duration limit (30 minutes)
- All actions taken during session

**Log Location**: `impersonationService` creates audit events

### Session Restrictions

- **Duration**: 30-minute maximum (server-enforced)
- **Blocked Actions**: Some admin operations disabled during impersonation
- **Single Session**: Only one active impersonation per admin at a time
- **Automatic Expiration**: Session terminates after timeout

### Security Warnings

**Displayed Before Session Start**:
- Audit logging notification
- Session expiration warning
- Action restriction notice

**Color Coding**:
- Yellow header and warning banner (caution)
- Red for errors
- Blue for selected state

### Permission Requirements

**Required Permission**: `impersonation.start`
**Role Requirement**: Typically `super_admin` only
**Enforcement**: Server-side via RBAC policies

## States and Error Handling

### Loading State

**Trigger**: User list fetch in progress
**Display**: "Loading users..." message in user list area
**Behavior**: Form disabled, cannot submit

### Error State

**User Load Failure**:
- Message: "Failed to load users"
- Logged via Logger
- No retry button (modal must be reopened)

**Submission Failure**:
- Display error message from service
- User can retry submission
- Error clears on next submit attempt

### Submitting State

**Trigger**: Form submitted, awaiting service response
**Display**: Button text changes to "Starting..."
**Behavior**: Button disabled, prevents double-submission

### Reset State

**Trigger**: Modal closes (isOpen changes to false)
**Behavior**:
- Clear search term
- Clear selected user
- Clear reason
- Clear error
- Ready for next use

## Accessibility

### WCAG 2.1 Level AA Compliance

#### Keyboard Navigation

- **Tab**: Navigate between search input, user list, reason textarea, buttons
- **Shift+Tab**: Navigate backward
- **Arrow Keys**: Navigate within user list radio group
- **Space**: Select focused user radio button
- **Enter**: Submit form when button focused
- **Escape**: Close modal without starting impersonation

#### ARIA Attributes

**Modal Container**:
- `role="dialog"` (implicit via semantic div)
- Should add `aria-modal="true"` for proper modal semantics
- Should add `aria-labelledby` pointing to title

**Search Input**:
- `type="text"`
- `placeholder` for guidance
- Should add `aria-label="Search users to impersonate"`

**User List**:
- Radio buttons with proper `name` attribute
- Labels wrap entire row for large click target
- Should add `role="radiogroup"` and `aria-label="Select user"`

**Reason Textarea**:
- `id="reason"` with associated `<label htmlFor="reason">`
- `required` attribute
- Should add `aria-required="true"`
- Should add `aria-invalid="true"` when error present

**Error Message**:
- Should add `role="alert"` for immediate announcement
- Should add `aria-live="polite"` for dynamic errors

#### Focus Management

- **Modal Open**: Focus should move to first focusable element (search input)
- **Focus Trap**: Focus should remain within modal while open
- **Modal Close**: Focus should return to trigger element
- **Escape Key**: Should close modal and restore focus

**Current Implementation**: Missing focus trap and focus restoration

#### Screen Reader Support

- **Modal Purpose**: "Start Impersonation Session" announced as heading
- **Warning Content**: Full warning text announced
- **User Selection**: "John Doe john.doe@example.com • administrator • Clinic A" announced
- **Required Fields**: Asterisk should be announced via aria-required
- **Errors**: Should be announced immediately via role="alert"

#### Visual Indicators

- **Required Fields**: Red asterisk (*) after label
- **Selected User**: Blue background highlight
- **Disabled State**: Reduced opacity on submit button
- **Error State**: Red background box with error text
- **Loading State**: Text message (should consider spinner icon)

## Implementation Notes

### Dependencies

- **Lucide React**: `X`, `AlertTriangle`, `Search`, `User` icons
- **impersonationService**: Session management and audit logging
- **supabaseService**: User data fetching (planned)
- **Logger**: Error and info logging

### State Management

**Internal State**:
- `searchTerm`: Current search query (string)
- `selectedUser`: Currently selected user (UserOption | null)
- `reason`: Impersonation justification (string)
- `users`: All available users (UserOption[])
- `loading`: User list loading state (boolean)
- `error`: Error message (string | null)
- `isSubmitting`: Form submission in progress (boolean)

**No External State**: Component is fully self-contained

### Data Fetching

**Current Implementation**: Mock data
```typescript
const mockUsers: UserOption[] = [
  { id: '1', email: 'john.doe@example.com', name: 'John Doe',
    role: 'administrator', organizationName: 'Clinic A' },
  // ...
].filter(u => u.id !== currentUser.id);
```

**Planned Implementation**: Fetch from Supabase
```typescript
const { data, error } = await supabaseService.getUsersForImpersonation();
```

**User Filtering**: Current user excluded from list (cannot impersonate self)

### Form Submission Flow

1. **Validate Selection**: Check selectedUser not null
2. **Validate Reason**: Check reason not empty after trim
3. **Set Submitting**: Disable form, show loading state
4. **Call Service**: `impersonationService.startImpersonation()`
5. **Handle Success**:
   - Log success event
   - Call `onImpersonationStart` callback
   - Close modal
6. **Handle Error**:
   - Display error message
   - Keep modal open
   - Allow retry

### Performance

- **User List Rendering**: Virtualization not implemented (assume < 100 users)
- **Search Filtering**: Client-side, no API calls
- **Form Reset**: Clears state on modal close for clean reopen
- **Memo Opportunities**: Consider memoizing filtered users if performance issues

## Testing

### Unit Tests

**Key Test Cases**:
- ✅ Renders modal when isOpen is true
- ✅ Hides modal when isOpen is false
- ✅ Displays security warning message
- ✅ Loads users on modal open
- ✅ Filters users based on search term
- ✅ Selects user on radio button click
- ✅ Validates form before submission
- ✅ Shows error when no user selected
- ✅ Shows error when reason empty
- ✅ Calls onImpersonationStart on successful submission
- ✅ Closes modal on cancel
- ✅ Resets form when modal closes

**Test Example**:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImpersonationModal } from './ImpersonationModal';

const mockCurrentUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  role: 'super_admin'
};

test('validates form before submission', async () => {
  const handleStart = vi.fn();

  render(
    <ImpersonationModal
      isOpen={true}
      onClose={() => {}}
      currentUser={mockCurrentUser}
      onImpersonationStart={handleStart}
    />
  );

  // Try to submit without selection
  const submitButton = screen.getByText('Start Impersonation');
  fireEvent.click(submitButton);

  await waitFor(() => {
    expect(screen.getByText(/please select a user/i)).toBeInTheDocument();
  });

  expect(handleStart).not.toHaveBeenCalled();
});

test('filters users by search term', async () => {
  render(
    <ImpersonationModal
      isOpen={true}
      onClose={() => {}}
      currentUser={mockCurrentUser}
      onImpersonationStart={() => {}}
    />
  );

  await waitFor(() => {
    expect(screen.getByText('john.doe@example.com')).toBeInTheDocument();
  });

  const searchInput = screen.getByPlaceholderText(/search by name/i);
  fireEvent.change(searchInput, { target: { value: 'jane' } });

  expect(screen.queryByText('john.doe@example.com')).not.toBeInTheDocument();
  expect(screen.getByText('jane.smith@example.com')).toBeInTheDocument();
});
```

### E2E Tests

**Key User Flows**:
- Admin opens impersonation modal
- Admin searches for user
- Admin selects user
- Admin provides reason
- Admin starts impersonation
- Impersonation banner appears
- Admin ends impersonation

**Test Example**:

```typescript
test('complete impersonation flow', async ({ page }) => {
  // Login as super admin
  await page.goto('http://localhost:5173/admin');

  // Open modal
  await page.click('button:has-text("Start Impersonation")');

  // Search for user
  await page.fill('input[placeholder*="Search"]', 'john');

  // Select user
  await page.click('label:has-text("john.doe@example.com")');

  // Enter reason
  await page.fill('#reason', 'Debugging client issue #1234');

  // Submit
  await page.click('button:has-text("Start Impersonation")');

  // Verify banner appears
  await expect(page.locator('text=/IMPERSONATING/i')).toBeVisible();
  await expect(page.locator('text=john.doe@example.com')).toBeVisible();
});
```

## Related Components

- **ImpersonationBanner** (`/components/auth/ImpersonationBanner.tsx`) - Displays active session
- **RequirePermission** (`/components/auth/RequirePermission.tsx`) - Guards modal access
- **impersonationService** (`/services/auth/impersonation.service.ts`) - Session management
- **supabaseService** (`/services/auth/supabase.service.ts`) - User data fetching

## Security Architecture

For complete impersonation security architecture, see:
- `../../../architecture/authentication/impersonation-architecture.md`
- `../../../architecture/authentication/impersonation-security-controls.md`
- `../../../architecture/authentication/impersonation-ui-specification.md`

## Accessibility Improvements Needed

**Current Gaps** (for future implementation):

1. **Focus Management**:
   - Add focus trap to keep focus within modal
   - Focus first element (search input) on open
   - Restore focus to trigger on close

2. **ARIA Enhancements**:
   - Add `aria-modal="true"` to modal container
   - Add `aria-labelledby` pointing to title ID
   - Add `aria-describedby` for warning message
   - Add `role="radiogroup"` to user list
   - Add `aria-required="true"` to reason textarea
   - Add `role="alert"` to error messages

3. **Screen Reader Support**:
   - Add `aria-live="polite"` for dynamic user count
   - Announce when users finish loading
   - Announce when filter updates

4. **Keyboard Enhancement**:
   - Add Escape key handler to close modal
   - Ensure Tab cycles through modal only (focus trap)

## Common Issues and Solutions

### Issue: Users Not Loading

**Cause**: API fetch not implemented (still using mock data)

**Solution**: Implement real user fetch:

```typescript
const loadUsers = async () => {
  setLoading(true);
  setError(null);
  try {
    const { data, error } = await supabaseService.getUsersForImpersonation();
    if (error) throw error;

    // Filter out current user
    const filteredUsers = data.filter(u => u.id !== currentUser.id);
    setUsers(filteredUsers);
  } catch (err) {
    log.error('Failed to load users', err);
    setError('Failed to load users');
  } finally {
    setLoading(false);
  }
};
```

### Issue: Form Submits Without Validation

**Cause**: Validation checks missing or incorrect

**Solution**: Ensure all validation in `handleSubmit`:

```typescript
if (!selectedUser) {
  setError('Please select a user to impersonate');
  return;
}

if (!reason.trim()) {
  setError('Please provide a reason for impersonation');
  return;
}
```

### Issue: Modal Doesn't Reset on Reopen

**Cause**: useEffect cleanup not resetting state

**Solution**: Reset all state in useEffect when modal closes:

```typescript
useEffect(() => {
  if (isOpen) {
    loadUsers();
  } else {
    setSearchTerm('');
    setSelectedUser(null);
    setReason('');
    setError(null);
  }
}, [isOpen]);
```

## Changelog

- **2025-11-13**: Initial documentation created
- **Component Creation**: Part of impersonation feature implementation (aspirational)
