# Authentication Provider Pattern

## Overview

A4C-AppSuite uses the `IAuthProvider` interface pattern for authentication abstraction. This enables three authentication modes (Mock, Integration, Production) with a unified API, making development flexible and testable.

**Key Benefits:**
- Single interface for all authentication modes
- Easy mocking for development and testing
- Seamless transition between modes
- Type-safe session management with JWT claims

## Common Imports

```typescript
import { useAuth } from "@/providers/AuthProvider";
import type { IAuthProvider, Session, User } from "@/providers/IAuthProvider";
```

## IAuthProvider Interface

The core interface defines authentication operations:

```typescript
interface IAuthProvider {
  // Current session state
  session: Session | null;
  loading: boolean;
  error: string | null;

  // Authentication methods
  signIn(credentials: SignInCredentials): Promise<void>;
  signOut(): Promise<void>;
  signUp(credentials: SignUpCredentials): Promise<void>;
  refreshSession(): Promise<void>;

  // OAuth methods (optional, not in Mock mode)
  signInWithGoogle?(): Promise<void>;
  signInWithGitHub?(): Promise<void>;
}

interface Session {
  user: User;
  access_token: string;
  refresh_token: string;
  expires_at: number;

  // JWT custom claims for RLS
  org_id: string;
  user_role: string;
  permissions: string[];
  scope_path: string;
}

interface User {
  id: string;
  email: string;
  email_verified: boolean;
  user_metadata: Record<string, any>;
  app_metadata: Record<string, any>;
}
```

## Three Authentication Modes

### 1. Mock Mode (Default Development)

**When**: `npm run dev`
**Purpose**: Instant authentication for UI development, component testing
**Benefits**: No network calls, predefined users, complete JWT claims

```typescript
// Mock provider behavior
signIn({ email: "admin@example.com", password: "any" }) // Instant, no validation
  → Returns session with JWT claims (org_id, user_role, permissions, scope_path)
  → No network requests
  → Predefined user profiles available
```

**Predefined Users**:
- `super_admin@example.com` - Super admin with all permissions
- `provider_admin@example.com` - Provider organization admin
- `clinician@example.com` - Clinician with patient access
- `patient@example.com` - Patient with own data access

```typescript
// Using mock mode in component
const { session, signIn } = useAuth();

// Instant sign-in with any predefined email
await signIn({ email: "super_admin@example.com", password: "" });

// Session immediately available with JWT claims
console.log(session.org_id); // "org_123"
console.log(session.user_role); // "super_admin"
console.log(session.permissions); // ["read", "write", "delete", "admin"]
```

### 2. Integration Mode (OAuth Testing)

**When**: `npm run dev:auth` or `npm run dev:integration`
**Purpose**: Test real OAuth flows, JWT tokens from Supabase development project
**Benefits**: Real authentication, OAuth testing, database hook testing

```typescript
// Integration provider behavior
signIn({ email: "user@example.com", password: "real-password" })
  → Real API call to Supabase development project
  → Real OAuth flows with Google/GitHub
  → JWT tokens with custom claims from database hook
  → Tests RLS policies with real session
```

**Use Cases**:
- Testing OAuth flows (Google, GitHub)
- Validating JWT custom claims from database hook
- Testing RLS policies with real sessions
- End-to-end authentication testing

```typescript
// OAuth sign-in with Google
const { signInWithGoogle } = useAuth();
await signInWithGoogle(); // Opens real OAuth flow

// OAuth sign-in with GitHub
const { signInWithGitHub } = useAuth();
await signInWithGitHub(); // Opens real OAuth flow
```

### 3. Production Mode (Production Builds)

**When**: Production builds automatically
**Purpose**: Real Supabase Auth with social login and enterprise SSO
**Benefits**: OAuth2 PKCE, SAML 2.0 support, production security

```typescript
// Production provider behavior
signIn({ email, password })
  → Supabase Auth API call
  → JWT tokens with custom claims
  → RLS enforcement with org_id isolation
  → Session persistence in localStorage
  → Automatic token refresh
```

**Supported Auth Methods**:
- Email/password
- Google OAuth (OAuth2 PKCE)
- GitHub OAuth (OAuth2 PKCE)
- Enterprise SSO (SAML 2.0)

## Using Authentication in Components

### Basic Usage with useAuth Hook

```typescript
import { observer } from "mobx-react-lite";
import { useAuth } from "@/providers/AuthProvider";

export const ProtectedPage = observer(() => {
  const { session, loading, error, signOut } = useAuth();

  if (loading) return <LoadingSpinner />;
  if (!session) return <Navigate to="/login" />;

  const { user_role, org_id, permissions } = session;

  return (
    <div>
      <h1>Welcome, {session.user.email}</h1>
      <p>Role: {user_role}</p>
      <p>Organization: {org_id}</p>
      <p>Permissions: {permissions.join(", ")}</p>
      <button onClick={signOut}>Sign Out</button>
    </div>
  );
});
```

### Sign-In Form

```typescript
import { observer } from "mobx-react-lite";
import { useAuth } from "@/providers/AuthProvider";
import { useState } from "react";

export const SignInForm = observer(() => {
  const { signIn, signInWithGoogle, loading, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await signIn({ email, password });
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        required
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        required
      />
      {error && <p className="text-destructive">{error}</p>}
      <button type="submit" disabled={loading}>
        {loading ? "Signing in..." : "Sign In"}
      </button>

      {/* OAuth options (only available in Integration/Production) */}
      {signInWithGoogle && (
        <button type="button" onClick={signInWithGoogle}>
          Sign In with Google
        </button>
      )}
    </form>
  );
});
```

### Protected Route Pattern

```typescript
import { observer } from "mobx-react-lite";
import { useAuth } from "@/providers/AuthProvider";
import { Navigate } from "react-router-dom";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredPermission?: string;
}

export const ProtectedRoute = observer(({ children, requiredPermission }: ProtectedRouteProps) => {
  const { session, loading } = useAuth();

  if (loading) return <LoadingSpinner />;
  if (!session) return <Navigate to="/login" replace />;

  if (requiredPermission && !session.permissions.includes(requiredPermission)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
});

// Usage
<Route
  path="/admin"
  element={
    <ProtectedRoute requiredPermission="admin">
      <AdminDashboard />
    </ProtectedRoute>
  }
/>
```

### Role-Based Access Control

```typescript
import { observer } from "mobx-react-lite";
import { useAuth } from "@/providers/AuthProvider";

export const RoleBasedContent = observer(() => {
  const { session } = useAuth();

  if (!session) return null;

  const { user_role, permissions } = session;

  return (
    <div>
      {/* Show for all authenticated users */}
      <Dashboard />

      {/* Show only for specific roles */}
      {user_role === "super_admin" && <SuperAdminPanel />}
      {user_role === "provider_admin" && <ProviderAdminPanel />}
      {user_role === "clinician" && <ClinicianTools />}

      {/* Show based on permissions */}
      {permissions.includes("write") && <CreateButton />}
      {permissions.includes("delete") && <DeleteButton />}
      {permissions.includes("admin") && <AdminSettings />}
    </div>
  );
});
```

## JWT Custom Claims for RLS

All authentication modes provide JWT custom claims used by PostgreSQL RLS policies:

```typescript
interface Session {
  // Standard JWT claims
  user: User;
  access_token: string;
  expires_at: number;

  // Custom claims for RLS
  org_id: string;        // Organization ID for multi-tenant isolation
  user_role: string;     // User role: super_admin, provider_admin, clinician, patient
  permissions: string[]; // Permissions: read, write, delete, admin
  scope_path: string;    // Hierarchical scope: org_123, org_123.provider_456, etc.
}
```

**RLS Usage Example**:
```sql
-- RLS policy using JWT claims
CREATE POLICY "Users can only access their organization's data"
ON medications
FOR SELECT
USING (org_id = (current_setting('request.jwt.claims')::json->>'org_id')::uuid);
```

## Switching Between Modes

### Environment Configuration

```bash
# Mock Mode (default)
npm run dev

# Integration Mode (real OAuth, dev Supabase)
npm run dev:auth
npm run dev:integration

# Production Mode (automatic in production builds)
npm run build
npm run preview
```

### Provider Factory

The `AuthProviderFactory` automatically selects the correct provider based on environment:

```typescript
// src/providers/AuthProviderFactory.ts
export class AuthProviderFactory {
  static create(): IAuthProvider {
    const mode = import.meta.env.VITE_AUTH_MODE;

    switch (mode) {
      case "mock":
        return new MockAuthProvider();
      case "integration":
        return new SupabaseAuthProvider(/* dev config */);
      case "production":
        return new SupabaseAuthProvider(/* prod config */);
      default:
        return new MockAuthProvider(); // Default to mock
    }
  }
}
```

## Testing with Auth Provider

### Unit Testing Components

```typescript
import { render, screen } from "@testing-library/react";
import { AuthProvider } from "@/providers/AuthProvider";
import { MockAuthProvider } from "@/providers/MockAuthProvider";
import { ProtectedPage } from "./ProtectedPage";

describe("ProtectedPage", () => {
  it("should show content for authenticated users", async () => {
    const mockProvider = new MockAuthProvider();
    await mockProvider.signIn({ email: "admin@example.com", password: "" });

    render(
      <AuthProvider provider={mockProvider}>
        <ProtectedPage />
      </AuthProvider>
    );

    expect(screen.getByText(/Welcome/)).toBeInTheDocument();
  });

  it("should redirect unauthenticated users", () => {
    const mockProvider = new MockAuthProvider();

    render(
      <AuthProvider provider={mockProvider}>
        <ProtectedPage />
      </AuthProvider>
    );

    // Should show login page or redirect
    expect(screen.queryByText(/Welcome/)).not.toBeInTheDocument();
  });
});
```

### E2E Testing with Playwright

```typescript
import { test, expect } from "@playwright/test";

test("user can sign in with mock provider", async ({ page }) => {
  // Mock mode is default in development
  await page.goto("http://localhost:5173/login");

  await page.fill('input[type="email"]', "admin@example.com");
  await page.fill('input[type="password"]', "any-password");
  await page.click('button[type="submit"]');

  // Should redirect to dashboard after instant sign-in
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText(/Welcome/)).toBeVisible();
});
```

## Session Management

### Session Persistence

Sessions are persisted in localStorage (Production/Integration) or memory (Mock):

```typescript
// Automatic session restoration on app load
const { session, loading } = useAuth();

useEffect(() => {
  if (!loading && !session) {
    // Redirect to login if no session
    navigate("/login");
  }
}, [session, loading]);
```

### Token Refresh

Tokens are automatically refreshed before expiration:

```typescript
// Automatic in SupabaseAuthProvider
async refreshSession() {
  if (this.session && Date.now() < this.session.expires_at - 60000) {
    return; // Token still valid
  }

  const { data, error } = await supabase.auth.refreshSession();
  if (error) throw error;

  runInAction(() => {
    this.session = this.mapSession(data.session);
  });
}
```

## Best Practices

1. **Use useAuth hook**: Access auth state via `useAuth()` hook, not direct store access
2. **Check loading state**: Always handle `loading` before checking `session`
3. **Use observer HOC**: Wrap components with `observer` when using auth state
4. **Mock for development**: Use Mock mode for fast UI development
5. **Integration for OAuth testing**: Use Integration mode to test real OAuth flows
6. **Test with ProtectedRoute**: Use ProtectedRoute pattern for route-level protection
7. **Check permissions**: Use `permissions` array for fine-grained access control
8. **RLS with JWT claims**: Leverage `org_id`, `user_role`, `scope_path` in RLS policies

## Architecture Documentation

For complete implementation details, see:
- `.plans/supabase-auth-integration/frontend-auth-architecture.md` (Implementation)
- `.plans/supabase-auth-integration/overview.md` (Architecture overview)
- `frontend/CLAUDE.md` (Developer guidance)
