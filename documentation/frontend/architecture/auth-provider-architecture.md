---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Three-mode authentication system (mock, integration, production) using IAuthProvider interface with dependency injection for flexible development workflows.

**When to read**:
- Switching between mock and real authentication
- Testing OAuth flows in development
- Understanding JWT claims access patterns
- Implementing role/permission checks in components

**Prerequisites**: [supabase-auth-overview.md](../../architecture/authentication/supabase-auth-overview.md) for architecture context

**Key topics**: `auth-provider`, `mock-auth`, `oauth`, `jwt-claims`, `permissions`, `dependency-injection`

**Estimated read time**: 12 minutes
<!-- TL;DR-END -->

# Authentication Provider Architecture

**Quick Reference for Developers**

### Quick Commands

```bash
# Fast UI development (instant auth, any credentials work)
npm run dev

# Test real OAuth flows and auth features
npm run dev:auth

# Production (auto-configured)
npm run build
```

All authentication goes through the `IAuthProvider` interface. Never import concrete providers directly.

---

## Overview

The authentication system uses **dependency injection** with three operational modes to balance development speed with production requirements.

### Core Principle

**Interface-Based Authentication**: All code accesses auth through `IAuthProvider`, never concrete implementations.

```typescript
// ✅ CORRECT
import { getAuthProvider } from '@/services/auth/AuthProviderFactory';
const auth = getAuthProvider();

// ❌ WRONG
import { SupabaseAuthProvider } from '@/services/auth/SupabaseAuthProvider';
```

---

## Three Modes

### 1. Mock Mode (Default Development)

**When to use**: UI development, component iteration, testing UI behavior

**Characteristics**:
- ✅ Instant login (zero latency)
- ✅ Any email/password works
- ✅ Complete JWT claims for RLS testing
- ✅ No network calls
- ⚠️ No real authentication validation

**Start**:
```bash
npm run dev        # Uses .env.development
npm run dev:mock   # Explicit mock mode
```

**Visual indicator**: Login page shows "Mock Authentication Mode" banner

**Customize test user** (`.env.development`):
```bash
VITE_AUTH_PROVIDER=mock
VITE_DEV_PROFILE=super_admin  # or provider_admin, clinician, viewer
```

### 2. Integration Mode (Auth Testing)

**When to use**: Testing OAuth, JWT claims, RLS policies, auth workflows

**Characteristics**:
- ✅ Real OAuth redirects (Google, GitHub)
- ✅ Real JWT tokens from Supabase
- ✅ Custom claims from database hook
- ✅ RLS policies enforced
- ⚠️ Requires OAuth provider setup
- ⚠️ 2-5 second login time

**Start**:
```bash
npm run dev:auth         # Uses Supabase in dev environment
npm run dev:integration  # Uses .env.development.integration
```

**Configuration** (`.env.development.integration`):
```bash
VITE_AUTH_PROVIDER=supabase
VITE_SUPABASE_URL=https://your-dev-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-dev-anon-key
VITE_DEBUG_AUTH=true
```

### 3. Production Mode

**When to use**: Production deployments, end users

**Characteristics**:
- ✅ Real OAuth with production providers
- ✅ Enterprise SSO (SAML 2.0)
- ✅ Full RLS enforcement
- ✅ Rate limiting and security controls
- ⚠️ Debug logging disabled

**Build**:
```bash
npm run build    # Auto-uses .env.production
```

---

## Using Authentication in Code

### Get Current User

```typescript
import { useAuth } from '@/contexts/AuthContext';

const MyComponent = () => {
  const { session, user } = useAuth();

  return (
    <div>
      <p>User: {user?.name}</p>
      <p>Email: {user?.email}</p>
    </div>
  );
};
```

### Check Permissions

```typescript
const MyComponent = () => {
  const { hasPermission } = useAuth();

  const canCreate = await hasPermission('medication.create');

  if (!canCreate) {
    return <AccessDenied />;
  }

  return <CreateMedicationForm />;
};
```

### Access JWT Claims

```typescript
const MyComponent = () => {
  const { session } = useAuth();

  // All custom claims available
  const orgId = session?.claims.org_id;
  const role = session?.claims.user_role;
  const permissions = session?.claims.permissions;
  const scopePath = session?.claims.scope_path;

  return (
    <div>
      <p>Organization: {orgId}</p>
      <p>Role: {role}</p>
      <p>Permissions: {permissions.length}</p>
    </div>
  );
};
```

### Check Role

```typescript
const AdminPanel = () => {
  const { session } = useAuth();

  const isAdmin = session?.claims.user_role === 'provider_admin';

  if (!isAdmin) {
    return <Navigate to="/unauthorized" />;
  }

  return <AdminDashboard />;
};
```

### Switch Organization

```typescript
const OrgSwitcher = () => {
  const { switchOrganization } = useAuth();

  const handleSwitch = async (newOrgId: string) => {
    // Updates database + refreshes JWT
    await switchOrganization(newOrgId);
  };

  return <OrganizationSelector onSelect={handleSwitch} />;
};
```

---

## Testing with Authentication

### Unit Tests

```typescript
import { render } from '@testing-library/react';
import { DevAuthProvider } from '@/services/auth/DevAuthProvider';
import { PREDEFINED_PROFILES } from '@/config/dev-auth.config';
import { AuthProvider } from '@/contexts/AuthContext';

describe('MyComponent', () => {
  it('renders for admin user', () => {
    const mockAuth = new DevAuthProvider({
      profile: PREDEFINED_PROFILES.provider_admin
    });

    render(
      <AuthProvider authProvider={mockAuth}>
        <MyComponent />
      </AuthProvider>
    );

    // assertions...
  });
});
```

### E2E Tests

Mock mode enables fast E2E tests:

```typescript
import { test, expect } from '@playwright/test';

test('user can login', async ({ page }) => {
  await page.goto('http://localhost:5173');

  // Any credentials work in mock mode
  await page.fill('#email', 'test@example.com');
  await page.fill('#password', 'any-password');
  await page.click('button[type="submit"]');

  // Instant redirect
  await expect(page).toHaveURL(/\/clients/);
});
```

---

## File Reference

### Core Files

| File | Purpose |
|------|---------|
| `src/types/auth.types.ts` | Type definitions (Session, User, JWTClaims) |
| `src/services/auth/IAuthProvider.ts` | Provider interface contract |
| `src/services/auth/DevAuthProvider.ts` | Mock provider implementation |
| `src/services/auth/SupabaseAuthProvider.ts` | Real provider implementation |
| `src/services/auth/AuthProviderFactory.ts` | Provider selection & singleton |
| `src/contexts/AuthContext.tsx` | React context wrapper |
| `src/config/dev-auth.config.ts` | Mock user profiles |

### Pages

| File | Purpose |
|------|---------|
| `src/pages/auth/LoginPage.tsx` | Login UI (works with all modes) |
| `src/pages/auth/AuthCallback.tsx` | OAuth callback handler |

### Environment Files

| File | Purpose |
|------|---------|
| `.env.development` | Mock mode (default) |
| `.env.development.integration` | Integration mode |
| `.env.production` | Production mode |

---

## Common Patterns

### Conditional Rendering Based on Role

```typescript
const Navigation = () => {
  const { session } = useAuth();
  const role = session?.claims.user_role;

  return (
    <nav>
      <Link to="/clients">Clients</Link>
      <Link to="/medications">Medications</Link>

      {(role === 'super_admin' || role === 'provider_admin') && (
        <Link to="/admin">Administration</Link>
      )}

      {role === 'super_admin' && (
        <Link to="/impersonate">Impersonation</Link>
      )}
    </nav>
  );
};
```

### Permission-Based Button Disabling

```typescript
const MedicationList = () => {
  const { hasPermission } = useAuth();
  const [canCreate, setCanCreate] = useState(false);

  useEffect(() => {
    hasPermission('medication.create').then(setCanCreate);
  }, [hasPermission]);

  return (
    <div>
      <button disabled={!canCreate}>
        Create Medication
      </button>
    </div>
  );
};
```

### Protected Route

```typescript
const ProtectedRoute = ({ children, requiredPermission }) => {
  const { hasPermission, loading } = useAuth();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (requiredPermission) {
      hasPermission(requiredPermission).then(setAllowed);
    }
  }, [requiredPermission]);

  if (loading) return <Loading />;
  if (!allowed) return <Navigate to="/unauthorized" />;

  return children;
};
```

---

## Debugging

### Check Current Mode

```typescript
import { getAuthProviderType } from '@/services/auth/AuthProviderFactory';

console.log('Auth mode:', getAuthProviderType()); // 'mock' or 'supabase'
```

### Inspect JWT Claims

```typescript
const { session } = useAuth();
console.log('JWT Claims:', session?.claims);
```

### Enable Debug Logging

```bash
# .env.development.integration
VITE_DEBUG_AUTH=true
```

---

## Migration Notes

### From Zitadel to Supabase Auth

**Completed**: 2025-10-27

**Key Changes**:
- `zitadelService.getUser()` → `getAuthProvider().getUser()`
- User object now includes `claims` property
- Organization ID accessed via `session.claims.org_id`
- Permissions accessed via `session.claims.permissions`

**Breaking Changes**:
- Bootstrap page removed (role management in database)
- Organization creation uses Temporal workflows
- User invitations require custom implementation

---

## Related Documentation

- **Complete Architecture**: `.plans/supabase-auth-integration/frontend-auth-architecture.md`
- **Supabase Auth Overview**: `.plans/supabase-auth-integration/overview.md`
- **Custom JWT Claims**: `.plans/supabase-auth-integration/custom-claims-setup.md`
- **RBAC Architecture**: `.plans/rbac-permissions/architecture.md`
- **Developer Guide**: `frontend/CLAUDE.md`

---

**Last Updated**: 2025-10-27
**Status**: Production Ready
