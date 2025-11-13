---
status: aspirational
last_updated: 2025-01-12
---

# Impersonation UI Specification
> [!WARNING]
> **This feature is not yet implemented.** This document describes planned functionality that has not been built. Implementation timeline and approach are subject to change based on business priorities.


## Overview

This document specifies the user interface and user experience for Super Admin impersonation in the A4C platform. The UI must provide clear visual indicators that impersonation is active while maintaining usability and accessibility.

**Design Principles:**
1. **Conspicuous:** Impossible to miss that impersonation is active
2. **Informative:** Clear who is being impersonated, in which org, and for how long
3. **Accessible:** WCAG 2.1 Level AA compliant, screen reader friendly
4. **Non-Intrusive:** Visual indicators don't block workflow
5. **Actionable:** Easy to renew or end impersonation

---

## Visual Indicators

### 1. Red Border (Viewport Container)

**Purpose:** Unmistakable visual frame around entire application

**Specifications:**
```css
.impersonation-viewport {
  border: 4px solid #dc2626; /* Tailwind red-600 */
  box-shadow:
    inset 0 0 0 2px #fef2f2, /* Inner light red glow */
    0 0 20px rgba(220, 38, 38, 0.3); /* Outer red glow */
  min-height: 100vh;
  position: relative;
}
```

**Visual Appearance:**
```
┌───────────────────────────────────────────────┐ ← 4px red border
│ ╔═════════════════════════════════════════╗  │
│ ║  Application Content                     ║  │ ← 2px light red inner
│ ║                                          ║  │
│ ║                                          ║  │
│ ╚═════════════════════════════════════════╝  │
└───────────────────────────────────────────────┘
```

**Accessibility:**
- High contrast red (#dc2626) meets WCAG AA
- Border visible in both light and dark themes
- Does not rely on color alone (also has sticky banner)

---

### 2. Sticky Banner (Top of Viewport)

**Purpose:** Display impersonation details and controls

**Organizational Context:**
- Displays target user's organization (root-level Provider or VAR Partner org)
- For Provider internal hierarchy, optionally shows user's scoped unit path
- All Providers exist at root level in Zitadel (flat structure)
- VAR Partner orgs also at root level (NOT hierarchical parent of Providers)

**Layout:**
```
┌──────────────────────────────────────────────────────────────────┐
│ ⚠️  Impersonating: John Doe (Sunshine Youth Services)            │
│     Session expires in: 14:32  [Renewals: 1]  [End Session]      │
└──────────────────────────────────────────────────────────────────┘
```

**Layout with Provider Internal Hierarchy (Optional):**
```
┌─────────────────────────────────────────────────────────────────────────┐
│ ⚠️  Impersonating: Jane Smith (Healing Horizons > South Campus > Unit C) │
│     Session expires in: 14:32  [Renewals: 1]  [End Session]              │
└─────────────────────────────────────────────────────────────────────────┘
```

**Component Structure:**
```tsx
<div className="impersonation-banner">
  <AlertTriangleIcon className="banner-icon" />
  <div className="banner-content">
    <span className="banner-label">Impersonating:</span>
    <strong className="banner-target-user">{targetUser.name}</strong>
    <span className="banner-org">({targetOrg.name})</span>
  </div>
  <div className="banner-session-info">
    <span className="banner-label">Session expires in:</span>
    <Countdown expiresAt={session.expiresAt} />
    {session.renewalCount > 0 && (
      <Badge variant="warning">Renewals: {session.renewalCount}</Badge>
    )}
  </div>
  <Button
    variant="danger"
    size="sm"
    onClick={handleEndImpersonation}
  >
    End Session
  </Button>
</div>
```

**Styles:**
```css
.impersonation-banner {
  position: sticky;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;

  background: linear-gradient(90deg, #dc2626 0%, #b91c1c 100%);
  color: white;

  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 24px;

  font-weight: 600;
  font-size: 14px;
  line-height: 1.5;

  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.banner-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.banner-content {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.banner-session-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.banner-label {
  opacity: 0.9;
  font-weight: 400;
}

.banner-target-user {
  font-weight: 700;
}

.banner-org {
  opacity: 0.85;
  font-style: italic;
}
```

**Accessibility:**
- `role="alert"` for screen reader announcement
- `aria-live="polite"` for timer updates
- High contrast white text on red background
- Focusable "End Session" button with clear label

---

### 3. Favicon Change

**Purpose:** Visual indicator in browser tab

**Implementation:**
```typescript
function setImpersonationFavicon() {
  const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
  if (link) {
    link.href = '/impersonation-favicon.png'; // Red warning icon
  }
}

function restoreNormalFavicon() {
  const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
  if (link) {
    link.href = '/favicon.png'; // Normal A4C icon
  }
}
```

**Icon Design:**
- Red background with white warning triangle
- Matches banner icon for consistency
- 32x32 and 16x16 sizes for different displays

---

### 4. Browser Title Prefix

**Purpose:** Identify impersonation session in browser tab title

**Implementation:**
```typescript
function setImpersonationTitle() {
  const originalTitle = document.title;
  document.title = `[IMPERSONATING] ${originalTitle}`;

  // Store original for restoration
  sessionStorage.setItem('original-title', originalTitle);
}

function restoreNormalTitle() {
  const originalTitle = sessionStorage.getItem('original-title');
  if (originalTitle) {
    document.title = originalTitle;
    sessionStorage.removeItem('original-title');
  }
}
```

**Example:**
```
Before: "Medication Management | A4C Platform"
During:  "[IMPERSONATING] Medication Management | A4C Platform"
```

---

### 5. Optional Watermark (Post-Launch)

**Purpose:** Additional visual indicator on page content

**Implementation:**
```tsx
<div className="impersonation-watermark">
  IMPERSONATION MODE
</div>
```

**Styles:**
```css
.impersonation-watermark {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-45deg);
  z-index: 1;

  font-size: 64px;
  font-weight: 900;
  color: rgba(220, 38, 38, 0.05);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  pointer-events: none;
  user-select: none;
}
```

---

## User Flows

### Flow 1: Start Impersonation

**Trigger:** Super Admin clicks "Impersonate User" button

**Steps:**

1. **User Selection Dialog**

**Organizational Context:**
- All organizations listed at root level (flat structure)
- Provider organizations (healthcare providers)
- VAR Partner organizations (Value-Added Resellers)
- Each organization type displayed with icon/label for clarity

```tsx
<Dialog title="Start Impersonation Session">
  <Form onSubmit={handleStartImpersonation}>
    {/* Organization Selection */}
    <FormField label="Organization">
      <Select
        options={organizations} // Includes Providers + VAR Partners (all root level)
        value={selectedOrg}
        onChange={setSelectedOrg}
        placeholder="Select organization..."
        renderOption={(org) => (
          <div className="org-option">
            <Badge variant={org.type === 'provider' ? 'primary' : 'secondary'}>
              {org.type === 'provider' ? 'Provider' : 'VAR Partner'}
            </Badge>
            <span>{org.name}</span>
          </div>
        )}
      />
    </FormField>

    {/* User Selection (with optional scope path) */}
    <FormField label="User to Impersonate">
      <Select
        options={usersInOrg}
        value={selectedUser}
        onChange={setSelectedUser}
        placeholder="Select user..."
        disabled={!selectedOrg}
        renderOption={(user) => (
          <div className="user-option">
            <span>{user.name} ({user.email})</span>
            {user.scopePath && (
              <span className="user-scope-path">
                Scope: {formatScopePath(user.scopePath)}
              </span>
            )}
          </div>
        )}
      />
    </FormField>

    {/* Justification */}
    <FormField label="Reason for Impersonation" required>
      <Select
        options={[
          { value: 'support_ticket', label: 'Support Ticket' },
          { value: 'emergency', label: 'Emergency Access' },
          { value: 'audit', label: 'Compliance Audit' },
          { value: 'training', label: 'Training/Demo' }
        ]}
        value={reason}
        onChange={setReason}
      />
    </FormField>

    {/* Reference ID (conditional) */}
    {reason === 'support_ticket' && (
      <FormField label="Ticket Number" required>
        <Input
          value={referenceId}
          onChange={setReferenceId}
          placeholder="TICKET-7890"
        />
      </FormField>
    )}

    {/* Optional Notes */}
    <FormField label="Additional Notes">
      <Textarea
        value={notes}
        onChange={setNotes}
        placeholder="Brief explanation of the issue or purpose..."
        rows={3}
      />
    </FormField>

    {/* Warning */}
    <Alert variant="warning">
      <AlertTriangleIcon />
      <div>
        <strong>Impersonation will be fully audited.</strong>
        <p>All actions during this session will be logged with your identity.</p>
      </div>
    </Alert>

    {/* Actions */}
    <DialogActions>
      <Button variant="secondary" onClick={closeDialog}>
        Cancel
      </Button>
      <Button
        variant="danger"
        type="submit"
        disabled={!selectedUser || !reason}
      >
        Start Impersonation
      </Button>
    </DialogActions>
  </Form>
</Dialog>
```

2. **MFA Challenge**
```tsx
<Dialog title="Multi-Factor Authentication Required">
  <p>Enter your authenticator code to proceed with impersonation.</p>

  <FormField label="TOTP Code">
    <Input
      type="text"
      inputMode="numeric"
      pattern="[0-9]{6}"
      maxLength={6}
      value={totpCode}
      onChange={setTotpCode}
      autoFocus
    />
  </FormField>

  <DialogActions>
    <Button variant="secondary" onClick={cancelMFA}>
      Cancel
    </Button>
    <Button
      variant="primary"
      onClick={verifyMFA}
      disabled={totpCode.length !== 6}
    >
      Verify & Start Session
    </Button>
  </DialogActions>
</Dialog>
```

3. **Session Starts**
- Loading spinner: "Starting impersonation session..."
- Page reloads with new JWT
- Red border appears
- Banner displays
- Favicon changes
- Title prefix added

**Expected Duration:** 15-30 seconds total

---

### Flow 2: Session Renewal

**Trigger:** Timer reaches 1 minute before expiry

**Modal:**
```tsx
<Modal
  blocking={true}
  escapable={false}
  onClose={null} // Cannot close without action
>
  <div className="renewal-modal-header">
    <AlertTriangleIcon className="renewal-icon" />
    <h2>Impersonation Session Expiring</h2>
  </div>

  <div className="renewal-modal-body">
    <p>You are impersonating: <strong>{targetUser.name}</strong></p>
    <p>Organization: <strong>{targetOrg.name}</strong></p>

    <div className="renewal-countdown">
      <span>Session expires in:</span>
      <Countdown
        seconds={secondsRemaining}
        onZero={handleAutoLogout}
        className="renewal-timer"
      />
    </div>

    <p className="renewal-warning">
      If you do not renew, you will be automatically logged out when the timer reaches zero.
    </p>
  </div>

  <DialogActions>
    <Button
      variant="secondary"
      onClick={handleEndImpersonation}
    >
      End Impersonation & Logout
    </Button>
    <Button
      variant="primary"
      onClick={handleRenewSession}
      autoFocus
    >
      Continue Impersonation (+30 min)
    </Button>
  </DialogActions>
</Modal>
```

**Styles:**
```css
.renewal-modal-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.renewal-icon {
  width: 32px;
  height: 32px;
  color: #dc2626;
}

.renewal-countdown {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 24px 0;
  padding: 16px;
  background: #fef2f2;
  border: 2px solid #fecaca;
  border-radius: 8px;
}

.renewal-timer {
  font-size: 32px;
  font-weight: 700;
  color: #dc2626;
  font-variant-numeric: tabular-nums;
}

.renewal-warning {
  color: #6b7280;
  font-size: 14px;
  font-style: italic;
}
```

**Behavior:**
- Modal appears at T-60 seconds
- Auto-focus on "Continue" button
- Countdown updates every second
- At T-0, automatic logout occurs
- Cannot be dismissed without action

**Accessibility:**
- `role="alertdialog"`
- `aria-labelledby` pointing to header
- `aria-describedby` pointing to warning
- Screen reader announces countdown updates

---

### Flow 3: End Impersonation

**Trigger:** User clicks "End Session" button in banner

**Confirmation Dialog:**
```tsx
<Dialog title="End Impersonation Session?">
  <p>
    You are currently impersonating <strong>{targetUser.name}</strong> in{' '}
    <strong>{targetOrg.name}</strong>.
  </p>

  <p>Ending this session will log you out and return you to the Super Admin console.</p>

  <Alert variant="info">
    <InfoIcon />
    <div>
      <strong>Session Summary</strong>
      <ul>
        <li>Duration: {formatDuration(session.duration)}</li>
        <li>Renewals: {session.renewalCount}</li>
        <li>Actions performed: {session.actionsPerformed}</li>
      </ul>
    </div>
  </Alert>

  <DialogActions>
    <Button variant="secondary" onClick={closeDialog}>
      Cancel (Stay Impersonating)
    </Button>
    <Button variant="danger" onClick={confirmEndImpersonation}>
      End Session & Logout
    </Button>
  </DialogActions>
</Dialog>
```

**Post-Logout:**
- Loading: "Ending impersonation session..."
- JWT cleared
- Redirect to Super Admin dashboard
- Success toast: "Impersonation session ended"

---

## Responsive Design

### Desktop (≥1024px)
- Full banner with all details
- Red border visible on all sides
- Countdown timer prominent

### Tablet (768px - 1023px)
- Banner layout adjusts to wrap content
- Red border visible
- Abbreviated org name if too long

### Mobile (< 768px)
- Banner stacks vertically
- "End Session" button moves to second row
- Red border 2px (instead of 4px) for smaller screens
- Favicon and title prefix still active

```css
@media (max-width: 1023px) {
  .impersonation-banner {
    flex-wrap: wrap;
    gap: 8px;
  }

  .banner-session-info {
    width: 100%;
  }
}

@media (max-width: 767px) {
  .impersonation-viewport {
    border-width: 2px;
  }

  .impersonation-banner {
    padding: 8px 16px;
    font-size: 12px;
  }
}
```

---

## Accessibility

### Screen Reader Announcements

**On session start:**
```tsx
<div role="alert" aria-live="assertive" aria-atomic="true">
  Impersonation session started. You are now viewing the application as{' '}
  {targetUser.name} from {targetOrg.name}. Session expires in 30 minutes.
</div>
```

**On renewal:**
```tsx
<div role="alert" aria-live="polite">
  Impersonation session renewed. Session will expire in 30 minutes.
</div>
```

**On expiry warning:**
```tsx
<div role="alert" aria-live="assertive">
  Warning: Impersonation session will expire in 1 minute. Please renew or you will be logged out.
</div>
```

### Keyboard Navigation

**Banner Controls:**
- Tab to "End Session" button
- Enter/Space to activate

**Renewal Modal:**
- Auto-focus on "Continue Impersonation" button
- Tab/Shift+Tab to navigate between buttons
- Enter to activate focused button

**User Selection Dialog:**
- Full keyboard navigation through form fields
- Arrow keys in dropdowns
- Tab to move between fields

### Focus Management

**On modal open:**
```typescript
useEffect(() => {
  if (isModalOpen) {
    // Store previous focus
    const previousFocus = document.activeElement;

    // Focus modal
    modalRef.current?.focus();

    // Restore on close
    return () => {
      (previousFocus as HTMLElement)?.focus();
    };
  }
}, [isModalOpen]);
```

---

## Component Implementation

### ImpersonationBanner Component

```tsx
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Countdown } from '@/components/ui/countdown';

export function ImpersonationBanner() {
  const { session, endImpersonation } = useImpersonation();

  if (!session) return null;

  return (
    <div
      className="impersonation-banner"
      role="alert"
      aria-live="polite"
      aria-label={`Impersonating ${session.target.name} from ${session.target.orgName}`}
    >
      <AlertTriangle className="banner-icon" aria-hidden="true" />

      <div className="banner-content">
        <span className="banner-label">Impersonating:</span>
        <strong className="banner-target-user">{session.target.name}</strong>
        <span className="banner-org">({session.target.orgName})</span>
      </div>

      <div className="banner-session-info">
        <span className="banner-label">Session expires in:</span>
        <Countdown expiresAt={session.expiresAt} />
        {session.renewalCount > 0 && (
          <Badge variant="warning" aria-label={`Session renewed ${session.renewalCount} times`}>
            Renewals: {session.renewalCount}
          </Badge>
        )}
      </div>

      <Button
        variant="danger"
        size="sm"
        onClick={endImpersonation}
        aria-label="End impersonation session and logout"
      >
        End Session
      </Button>
    </div>
  );
}
```

### ImpersonationLayout Component

```tsx
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { ImpersonationBanner } from './ImpersonationBanner';
import { RenewalModal } from './RenewalModal';

export function ImpersonationLayout({ children }) {
  const { session } = useImpersonation();

  if (!session) {
    return <>{children}</>;
  }

  return (
    <div className="impersonation-viewport">
      <ImpersonationBanner />
      {children}
      <RenewalModal />
    </div>
  );
}
```

---

## Related Documents

### Impersonation Specification
- `.plans/impersonation/architecture.md` - Overall architecture (includes VAR Partner context)
- `.plans/impersonation/event-schema.md` - Event definitions (includes VAR cross-tenant examples)
- `.plans/impersonation/implementation-guide.md` - Implementation steps (includes Phase 4.5 VAR support)
- `.plans/impersonation/security-controls.md` - Security measures

### Platform Architecture
- `.plans/consolidated/agent-observations.md` - Overall architecture (hierarchy model, VAR partnerships)
- `.plans/auth-integration/tenants-as-organization-thoughts.md` - Organizational structure (flat Provider model)
- `.plans/multi-tenancy/multi-tenancy-organization.html` - Multi-tenancy specification (VAR partnerships as metadata)

### Development Guidelines
- `frontend/CLAUDE.md` - Component development guidelines
- `.plans/event-resilience/plan.md` - Event handling during network failures

---

**Document Version:** 1.0
**Last Updated:** 2025-10-09
**Status:** Final Specification
