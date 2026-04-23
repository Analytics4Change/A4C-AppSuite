---
status: current
last_updated: 2026-04-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: React contexts for the frontend — `AuthContext` (Supabase auth with smart mock/real detection, IAuthProvider DI pattern, JWT custom claims), `DiagnosticsContext`, `FocusBehaviorContext`.

**When to read**:
- Adding or modifying auth context consumers (`useAuth`)
- Switching between mock and real auth modes locally
- Working with JWT custom claims (`org_id`, `org_type`, `effective_permissions`)
- Writing component tests that need an auth provider
- Adding a new React context

**Prerequisites**: React Context API, Supabase Auth basics

**Key topics**: `auth-context`, `iauthprovider`, `jwt-claims`, `mock-auth`, `dependency-injection`, `testing`

**Estimated read time**: 8 minutes
<!-- TL;DR-END -->

# Frontend Contexts Guidelines

This file governs `frontend/src/contexts/`. Most rules here cover `AuthContext.tsx` — the others (`DiagnosticsContext.tsx`, `FocusBehaviorContext.tsx`) follow the same React Context API patterns without the dependency-injection complexity.

## Authentication Architecture

**Status**: Supabase Auth with smart detection (Updated 2026-01-02)

The application uses **dependency injection** with smart environment detection to automatically determine the authentication mode.

### Smart Detection

The authentication mode is automatically detected based on runtime conditions:

| Scenario | Credentials | Hostname | Result |
|----------|-------------|----------|--------|
| `npm run dev` | Present | localhost | Real auth, NO subdomain redirect |
| `npm run dev` | Missing | localhost | Mock auth, NO subdomain redirect |
| `npm run dev:mock` | Present | localhost | Mock auth (forced), NO subdomain redirect |
| Production build | Present | *.example.com | Real auth, subdomain redirect enabled |

### Two Authentication Modes

**1. Mock Mode**
- Instant authentication without network calls
- Complete JWT claims structure for testing
- Configurable user profiles (`super_admin`, `provider_admin`, etc.)
- **Triggered by**: No Supabase credentials OR `VITE_FORCE_MOCK=true`
- Use: `npm run dev` (without credentials) or `npm run dev:mock`

**2. Real Mode** (Supabase)
- Real OAuth flows with Google/GitHub
- Real JWT tokens from Supabase
- Custom claims from database hooks
- Enterprise SSO support (SAML 2.0)
- **Triggered by**: Supabase credentials present (and not forcing mock)

### Provider Interface Pattern

All authentication is accessed through the `IAuthProvider` interface:

```typescript
// ✅ GOOD - Uses abstraction
import { getAuthProvider } from '@/services/auth/AuthProviderFactory';
const auth = getAuthProvider();
const user = await auth.getUser();

// ❌ BAD - Direct dependency
import { SupabaseAuthProvider } from './SupabaseAuthProvider';
```

**Key files**:
- `src/services/auth/IAuthProvider.ts` — Interface definition
- `src/services/auth/DevAuthProvider.ts` — Mock provider
- `src/services/auth/SupabaseAuthProvider.ts` — Real provider
- `src/services/auth/AuthProviderFactory.ts` — Provider selection
- `src/contexts/AuthContext.tsx` — React context wrapper
- `src/config/dev-auth.config.ts` — Mock user configuration

### JWT Custom Claims (v4)

The application uses custom JWT claims for multi-tenant isolation and RBAC:

```typescript
interface JWTClaims {
  sub: string;                                  // User UUID
  email: string;
  org_id: string;                               // Organization UUID (for RLS)
  org_type: string;                             // Organization type
  effective_permissions: EffectivePermission[]; // Scoped permissions [{p, s}]
  claims_version: number;                       // Currently 4
  access_blocked?: boolean;
  current_org_unit_id?: string | null;
  current_org_unit_path?: string | null;
}

interface EffectivePermission {
  p: string;  // Permission name (e.g., "medication.create")
  s: string;  // Scope path (ltree, e.g., "acme.pediatrics")
}
```

> **⚠️ Deprecated v3 fields**: `permissions` (flat array), `user_role`, `app_metadata.org_id` were removed in claims v4. Never read these fields. If you find code that does, it's broken.

### Usage in Components

```typescript
import { useAuth } from '@/contexts/AuthContext';

const MyComponent = () => {
  const { session, hasPermission } = useAuth();

  // Access claims
  const orgId = session?.claims.org_id;
  const orgType = session?.claims.org_type;
  const eps = session?.claims.effective_permissions;

  // Check permission (simple - any scope)
  const canCreate = await hasPermission('medication.create');

  // Check permission (scope-aware)
  const canViewUnit = await hasPermission('organization.view_ou', 'acme.pediatrics');

  return (
    <div>
      <p>Organization: {orgId}</p>
      <p>Type: {orgType}</p>
    </div>
  );
};
```

### Environment Configuration

Authentication mode is **automatically detected** — no `VITE_APP_MODE` needed:

```bash
# .env.local - Real auth (credentials present = real mode)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Optional: Force mock mode even with credentials
# VITE_FORCE_MOCK=true
```

**Key behaviors:**
- Credentials present → Real Supabase auth
- Credentials missing → Mock auth
- Localhost → Subdomain routing disabled (stays on `localhost:5173`)
- Production hostname → Subdomain routing enabled

### Testing with Authentication

**Unit Tests** (with mock auth):

```typescript
import { DevAuthProvider } from '@/services/auth/DevAuthProvider';
import { PREDEFINED_PROFILES } from '@/config/dev-auth.config';

const mockAuth = new DevAuthProvider({
  profile: PREDEFINED_PROFILES.provider_admin
});

render(
  <AuthProvider authProvider={mockAuth}>
    <MyComponent />
  </AuthProvider>
);
```

**E2E Tests** (mock mode):

```typescript
test('user can login with any credentials', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.fill('#email', 'test@example.com');
  await page.fill('#password', 'any-password');
  await page.click('button[type="submit"]');

  // Mock auth provides instant authentication
  await expect(page).toHaveURL(/\/clients/);
});
```

## Other Contexts

- **`DiagnosticsContext.tsx`** — Toggles for debug monitors (MobX state, performance, log overlay, network). See parent CLAUDE.md "Logging and Diagnostics" section for shortcut keys and debug monitor descriptions.
- **`FocusBehaviorContext.tsx`** — Centralized focus-trap behavior configuration for modals.

## Related Documentation

- [Frontend CLAUDE.md](../../CLAUDE.md) — Tech stack, MobX rules, accessibility (parent)
- [Services CLAUDE.md](../services/CLAUDE.md) — Session retrieval rules (uses session from `auth.getSession()`, never from context)
- [Frontend auth architecture](../../../documentation/architecture/authentication/frontend-auth-architecture.md) — Complete three-mode design
- [Supabase auth overview](../../../documentation/architecture/authentication/supabase-auth-overview.md) — Backend perspective
- [JWT claims setup](../../../documentation/infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md) — Database hook configuration
