# ProtectedRoute

## Overview

A route guard component that ensures only authenticated users can access protected areas of the application. This component integrates with the authentication system to redirect unauthenticated users to the login page while allowing authenticated users to proceed to their intended destination.

## Props Interface

```typescript
// ProtectedRoute takes no props - it uses React Router's Outlet pattern
interface ProtectedRouteProps {
  // No props required - authentication state is managed via context
}
```

## Usage Examples

### Basic Route Protection

```tsx
// In your router configuration
import { createBrowserRouter } from 'react-router-dom';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { LoginPage } from '@/pages/auth/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />
  },
  {
    path: '/',
    element: <ProtectedRoute />,
    children: [
      {
        path: 'dashboard',
        element: <DashboardPage />
      },
      {
        path: 'medications',
        element: <MedicationsPage />
      },
      {
        path: 'clients',
        element: <ClientsPage />
      }
    ]
  }
]);
```

### Advanced Usage with Layout

```tsx
// Combining with layout components
function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        
        {/* Protected routes with layout */}
        <Route path="/" element={<ProtectedRoute />}>
          <Route element={<MainLayout />}>
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="medications" element={<MedicationsPage />} />
            <Route path="clients" element={<ClientsPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

### Integration with Authentication Context

```tsx
// How ProtectedRoute integrates with auth context
import { useAuth } from '@/contexts/AuthContext';

function ProtectedRoute() {
  const { isAuthenticated, user, loading } = useAuth();
  
  if (loading) {
    return <LoadingSpinner />;
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <Outlet />;
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Navigation Flow**: Maintains proper navigation flow during redirects
- **Focus Management**: Preserves focus context when redirecting to login
- **Screen Reader Support**: Navigation changes are announced appropriately

### Authentication States

- Loading state provides appropriate feedback
- Redirect behavior is communicated to assistive technologies
- Error states are properly announced

## Styling

### Visual States

ProtectedRoute doesn't render visible UI - it either renders child routes or redirects. Any loading states should be handled by the authentication context.

### Layout Integration

```tsx
// ProtectedRoute works seamlessly with layout components
<Route path="/" element={<ProtectedRoute />}>
  <Route element={<MainLayout />}>
    <Route path="dashboard" element={<Dashboard />} />
  </Route>
</Route>
```

## Implementation Notes

### Design Patterns

- **Route Guard Pattern**: Implements authentication-based route protection
- **Outlet Pattern**: Uses React Router's Outlet for nested route rendering
- **Context Integration**: Leverages authentication context for state management
- **Declarative Routing**: Works with React Router's declarative route configuration

### Authentication Flow

1. **Route Access**: User attempts to access protected route
2. **Auth Check**: ProtectedRoute checks authentication status via context
3. **Redirect**: If not authenticated, redirects to `/login` with `replace` flag
4. **Render**: If authenticated, renders the requested route via `Outlet`

### Security Considerations

- Uses `replace` navigation to prevent back-button bypass
- Integrates with secure authentication context
- Provides logging for security monitoring
- Handles edge cases like token expiration

### Dependencies

- React Router v6+ for navigation and outlet functionality
- Authentication context for user state
- Logger utility for debugging and monitoring

### Performance Considerations

- Minimal rendering overhead - only authentication check
- No unnecessary re-renders when auth state is stable
- Efficient redirect behavior

## Testing

### Unit Tests

Located in `ProtectedRoute.test.tsx`. Covers:
- Authenticated user access (renders Outlet)
- Unauthenticated user redirect
- Navigation behavior and path preservation
- Integration with authentication context

### E2E Tests

Covered in authentication flow tests:
- Complete login flow with protected route access
- Logout and redirect behavior
- Direct URL access when not authenticated
- Session expiration handling

## Related Components

- `OAuthProviders` - Authentication provider setup
- `MainLayout` - Often used as child of protected routes
- `LoginPage` - Destination for unauthenticated redirects
- `AuthContext` - Provides authentication state

## Security Best Practices

### Route Protection

- Always use `replace` navigation for redirects
- Implement proper session management
- Handle token expiration gracefully
- Log authentication attempts for monitoring

### State Management

- Never store sensitive data in component state
- Use secure authentication context
- Implement proper cleanup on logout
- Handle concurrent session scenarios

## Changelog

- Initial implementation with basic authentication check
- Added logging for security monitoring
- Enhanced integration with authentication context
- Improved error handling and edge cases
- Added support for loading states