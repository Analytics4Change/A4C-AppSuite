---
status: current
last_updated: 2025-11-13
---

# RequirePermission

## Overview

`RequirePermission` is a route guard component that enforces permission-based access control. It checks whether the current user has a specific permission before rendering child components. Users without the required permission are automatically redirected to a fallback route, preventing unauthorized access to protected pages.

This component integrates with the application's RBAC (Role-Based Access Control) system through the `AuthContext`, making it ideal for protecting administrative pages, feature-specific routes, and sensitive operations.

## Props and Usage

Props are documented inline in the component source code using TypeScript:

```typescript
interface RequirePermissionProps {
  // Permission string to check (e.g., "organization.create_root", "medication.delete")
  permission: string;
  // Fallback route to redirect to if permission check fails (default: '/clients')
  fallback?: string;
  // Child components to render if permission check passes
  children: React.ReactNode;
}
```

## Usage Examples

### Basic Usage

Protecting a route that requires specific permission:

```tsx
import { RequirePermission } from '@/components/auth/RequirePermission';
import { OrganizationCreatePage } from '@/pages/organizations';

// In your router configuration
<Route
  path="/organizations/create"
  element={
    <RequirePermission permission="organization.create_root">
      <OrganizationCreatePage />
    </RequirePermission>
  }
/>
```

### Advanced Usage with Custom Fallback

Redirecting to a specific page when permission is denied:

```tsx
import { RequirePermission } from '@/components/auth/RequirePermission';
import { MedicationDeletePage } from '@/pages/medications';

<Route
  path="/medications/:id/delete"
  element={
    <RequirePermission
      permission="medication.delete"
      fallback="/medications"
    >
      <MedicationDeletePage />
    </RequirePermission>
  }
/>
```

### Multiple Permission Checks

For routes requiring multiple permissions, nest `RequirePermission` components:

```tsx
<RequirePermission permission="organization.view">
  <RequirePermission permission="organization.edit">
    <OrganizationEditPage />
  </RequirePermission>
</RequirePermission>
```

### Protecting Page Sections

Use within a page to conditionally render sections:

```tsx
import { RequirePermission } from '@/components/auth/RequirePermission';

const ClientDetailPage = () => {
  return (
    <div>
      <ClientInfo />

      <RequirePermission
        permission="client.edit"
        fallback="/clients"
      >
        <ClientEditForm />
      </RequirePermission>

      <RequirePermission
        permission="medication.create"
        fallback="/clients"
      >
        <AddMedicationButton />
      </RequirePermission>
    </div>
  );
};
```

## Accessibility

### WCAG 2.1 Level AA Compliance

#### Loading State

- **Visual Indicator**: Displays a spinning loader icon during permission check
- **Semantic Structure**: Uses semantic `<div>` with flex centering for clear visual presentation
- **Color Contrast**: Loader icon uses blue-600 (high contrast against white background)

#### ARIA Attributes

- **Loading State**: The loader should ideally include `aria-label="Checking permissions"` for screen reader users (enhancement opportunity)
- **Redirect Behavior**: No ARIA needed as user is immediately redirected before content renders

#### Focus Management

- **Loading State**: Focus remains on previous element during brief permission check
- **Redirect**: Browser handles focus automatically when navigating to fallback route
- **Success**: Focus transfers to first focusable element in child components

#### Screen Reader Support

- **Permission Denied**: Console warning provides developer feedback (not user-facing)
- **Enhancement Opportunity**: Consider announcing redirect reason via `aria-live` region before navigation
- **Success State**: Child components handle their own screen reader support

## Styling

### CSS Classes

The component uses inline Tailwind CSS classes:

- **Loading Container**: `flex items-center justify-center min-h-screen`
  - Vertically and horizontally centers the loader
  - Full viewport height for consistent positioning

- **Loader Icon**: `h-8 w-8 animate-spin text-blue-600`
  - 8×8 size (2rem) for clear visibility
  - Spinning animation via Tailwind's `animate-spin`
  - Blue color matching application theme

### Customization

The component does not accept custom styling props. To customize:

1. **Loading Indicator**: Modify the loader JSX directly in the component source
2. **Fallback Behavior**: Change via `fallback` prop (route, not UI)
3. **Permission Check**: Implement via RBAC system configuration

## Implementation Notes

### Design Patterns

- **Route Guard Pattern**: Prevents rendering of protected content until permission verified
- **Redirect Pattern**: Uses React Router's `navigate` with `replace: true` to prevent back-button issues
- **Early Return Pattern**: Exits early when permission denied (renders `null` after redirect)

### State Management

- **Local State**: Uses `useState` hook for permission check result (`allowed: boolean | null`)
  - `null`: Permission check in progress
  - `true`: Permission granted, render children
  - `false`: Permission denied, redirect initiated

- **Effect Hook**: `useEffect` runs permission check on mount and when dependencies change:
  - `permission`: Permission string to check
  - `hasPermission`: Auth context function
  - `navigate`: React Router navigation function
  - `fallback`: Fallback route
  - `session`: Current session data

### Dependencies

- **React Router**: Uses `useNavigate` hook for redirection
- **AuthContext**: Provides `hasPermission` function and `session` data
- **Lucide React**: `Loader2` icon for loading indicator

### Performance Considerations

- **Async Permission Check**: Permission validation is asynchronous to support complex RBAC lookups
- **Replace Navigation**: Uses `replace: true` to avoid polluting browser history with unauthorized access attempts
- **Early Exit**: Renders `null` immediately after redirect to minimize unnecessary rendering

### Security Considerations

- **Client-Side Only**: This is a UX convenience, **not a security control**
- **Server-Side Enforcement**: Always enforce permissions on the backend/API layer
- **Permission Logging**: Logs denied access attempts to console for debugging (includes user email and permissions)
- **Token Validation**: Relies on JWT claims validation in `hasPermission` function

### Error Handling

- **Missing Permission**: Logs warning and redirects to fallback
- **Network Errors**: Handled by underlying auth provider
- **Invalid Permission String**: Auth system should handle gracefully

## Testing

### Unit Tests

**Location**: Tests should be added to verify permission guard behavior

**Key Test Cases**:
- ✅ Renders loading state initially
- ✅ Renders children when permission granted
- ✅ Redirects to fallback when permission denied
- ✅ Uses default fallback (`/clients`) when not specified
- ✅ Logs warning when permission denied
- ✅ Re-checks permission when prop changes

**Test Example**:

```typescript
import { render, screen } from '@testing-library/react';
import { RequirePermission } from './RequirePermission';
import { AuthContext } from '@/contexts/AuthContext';
import { MemoryRouter } from 'react-router-dom';

const mockHasPermission = vi.fn();
const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  ...vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

test('renders children when permission granted', async () => {
  mockHasPermission.mockResolvedValue(true);

  render(
    <MemoryRouter>
      <AuthContext.Provider value={{ hasPermission: mockHasPermission }}>
        <RequirePermission permission="test.permission">
          <div>Protected Content</div>
        </RequirePermission>
      </AuthContext.Provider>
    </MemoryRouter>
  );

  await screen.findByText('Protected Content');
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('redirects when permission denied', async () => {
  mockHasPermission.mockResolvedValue(false);

  render(
    <MemoryRouter>
      <AuthContext.Provider value={{ hasPermission: mockHasPermission }}>
        <RequirePermission permission="test.permission" fallback="/denied">
          <div>Protected Content</div>
        </RequirePermission>
      </AuthContext.Provider>
    </MemoryRouter>
  );

  await waitFor(() => {
    expect(mockNavigate).toHaveBeenCalledWith('/denied', { replace: true });
  });
});
```

### E2E Tests

**Location**: E2E tests should verify permission-based routing behavior

**Key User Flows**:
- User without permission attempts to access protected route
- User with permission successfully accesses protected route
- User permission changes and route access updates
- Browser back button behavior after redirect

**Test Example**:

```typescript
test('redirects unauthorized user from protected route', async ({ page }) => {
  // Login as user without organization.create_root permission
  await page.goto('http://localhost:5173/login');
  await page.fill('#email', 'user@example.com');
  await page.fill('#password', 'password');
  await page.click('button[type="submit"]');

  // Attempt to access protected route
  await page.goto('http://localhost:5173/organizations/create');

  // Should redirect to fallback
  await expect(page).toHaveURL(/\/clients/);

  // Should not see protected content
  await expect(page.locator('text=Create Organization')).not.toBeVisible();
});
```

## Related Components

- **AuthContext** (`/contexts/AuthContext.tsx`) - Provides authentication state and permission checking
- **ProtectedRoute** (if exists) - Alternative route protection pattern
- **Login** (`/pages/auth/Login.tsx`) - Authentication entry point
- **ImpersonationBanner** - Shows when super admin is impersonating another user
- **RequireRole** (if exists) - Role-based route guard (alternative approach)

## Common Permission Strings

Based on the application's RBAC system:

- `organization.create_root` - Create root organizations
- `organization.view` - View organization details
- `organization.edit` - Edit organization settings
- `organization.delete` - Delete organizations
- `medication.create` - Create medication records
- `medication.edit` - Edit medication records
- `medication.delete` - Delete medication records
- `medication.view` - View medication records
- `client.create` - Create client records
- `client.edit` - Edit client records
- `client.delete` - Delete client records
- `client.view` - View client records

For complete permission list, see: `../../../architecture/authorization/rbac-architecture.md`

## Changelog

- **2025-11-13**: Initial documentation created
- **2025-10-27**: Component created as part of Supabase Auth integration
