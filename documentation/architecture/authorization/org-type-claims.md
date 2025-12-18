---
status: current
last_updated: 2025-12-18
---

# Organization Type Claims for UI Feature Gating

**Status**: Implemented
**Purpose**: Enable conditional navigation and feature visibility based on organization type
**Implementation**: JWT custom claims + frontend nav filtering

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Organization Types](#organization-types)
4. [JWT Claims Structure](#jwt-claims-structure)
5. [Frontend Implementation](#frontend-implementation)
6. [Usage Patterns](#usage-patterns)
7. [Testing](#testing)

---

## Overview

The `org_type` claim enables UI-driven feature gating based on organization type. This follows the **defense in depth** pattern: the UI controls visibility (UX optimization) while the backend (RLS/API) still enforces authorization.

**Key Principle**: Platform owners CAN have permission to do anything. The UI simply chooses not to show certain features that aren't relevant to the platform owner use case.

**Use Cases**:
- Hide "Organization Units" nav item for platform owners (they manage the platform, not individual orgs)
- Future: Route-level gating, feature flags per org type
- Future: Conditional form fields or UI sections

---

## Architecture

```
Database (organizations_projection.type)
    ↓
JWT Hook (adds org_type to claims)
    ↓
Frontend (reads claims.org_type for UI decisions)
    ↓
RLS/API (still enforces actual permissions)
```

### Why Claims-Based?

| Approach | Pros | Cons |
|----------|------|------|
| **JWT Claims (chosen)** | No runtime queries, follows existing pattern, single source of truth | ~25 bytes added to JWT |
| Query on login | Flexible | Extra DB query, context management |
| Permission-based | Uses existing system | Permission proliferation, doesn't address UX concern |

---

## Organization Types

Organization type is an enum with three values:

```typescript
type OrganizationType = 'platform_owner' | 'provider' | 'provider_partner';
```

| Type | Description | Typical Features Hidden |
|------|-------------|------------------------|
| `platform_owner` | Manages the A4C platform itself | "Org Units" (manages platform, not individual orgs) |
| `provider` | Healthcare provider organization | None currently |
| `provider_partner` | Partner organization (VAR, reseller) | None currently |

### Super Admin Handling

Super admins have `org_id = NULL` (global scope). For consistency, their `org_type` defaults to `'platform_owner'`.

---

## JWT Claims Structure

The org_type claim is added to the JWT by the custom claims hook:

```json
{
  "iss": "supabase",
  "sub": "user-uuid",
  "org_id": "org-uuid",
  "org_type": "provider",
  "user_role": "provider_admin",
  "permissions": ["medications.read", "users.manage"],
  "scope_path": "/org-uuid/"
}
```

### Backend Implementation

**File**: `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql`

```sql
-- Variable declaration
v_org_type text;

-- Org type lookup with super_admin handling
IF v_org_id IS NULL THEN
  v_org_type := 'platform_owner';
ELSE
  SELECT o.type::text INTO v_org_type
  FROM public.organizations_projection o
  WHERE o.id = v_org_id;
END IF;

-- Added to claims object
jsonb_build_object(
  'org_id', v_org_id,
  'org_type', v_org_type,
  ...
)

-- Error handler also includes org_type
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'org_type', NULL,
    ...
  );
```

---

## Frontend Implementation

### TypeScript Types

**File**: `frontend/src/types/auth.types.ts`

```typescript
export type OrganizationType = 'platform_owner' | 'provider' | 'provider_partner';

export interface JWTClaims {
  org_id: string;
  org_type: OrganizationType;
  user_role: string;
  permissions: string[];
  scope_path: string;
}
```

### Navigation Filtering

**File**: `frontend/src/components/layouts/MainLayout.tsx`

```typescript
interface NavItem {
  to: string;
  icon: React.ComponentType;
  label: string;
  roles: string[];
  permission?: string;
  hideForOrgTypes?: OrganizationType[];  // NEW
}

const navItems: NavItem[] = [
  {
    to: '/org-units',
    icon: BuildingOffice2Icon,
    label: 'Org Units',
    roles: ['super_admin', 'provider_admin', 'partner_admin'],
    hideForOrgTypes: ['platform_owner']  // Hide for platform owners
  },
  // ... other items
];

// Filter logic
const filteredNavItems = navItems.filter(item => {
  // 1. Role check
  if (!item.roles.includes(claims.user_role)) return false;

  // 2. Permission check
  if (item.permission && !claims.permissions.includes(item.permission)) return false;

  // 3. Org type check (NEW)
  if (item.hideForOrgTypes?.includes(claims.org_type)) return false;

  return true;
});
```

### Mock Auth Profiles

**File**: `frontend/src/config/dev-auth.config.ts`

All dev profiles include `org_type`:

| Profile | org_type |
|---------|----------|
| `super_admin` | `platform_owner` |
| `provider_admin` | `provider` |
| `partner_admin` | `provider_partner` |
| `clinician` | `provider` |
| `scheduler` | `provider` |
| `viewer` | `provider` |

### JWT Decoding

**File**: `frontend/src/services/auth/SupabaseAuthProvider.ts`

```typescript
const claims: JWTClaims = {
  org_id: decoded.org_id,
  org_type: decoded.org_type || 'provider',  // Default fallback
  user_role: decoded.user_role,
  permissions: decoded.permissions || [],
  scope_path: decoded.scope_path || '/'
};
```

---

## Usage Patterns

### Hide a Nav Item for Specific Org Types

```typescript
{
  to: '/some-route',
  icon: SomeIcon,
  label: 'Some Feature',
  roles: ['provider_admin'],
  hideForOrgTypes: ['platform_owner', 'provider_partner']
}
```

### Future: Show Only for Specific Org Types

If needed, add `showOnlyForOrgTypes` for inclusion-based filtering:

```typescript
{
  to: '/provider-only',
  icon: ProviderIcon,
  label: 'Provider Dashboard',
  roles: ['provider_admin'],
  showOnlyForOrgTypes: ['provider']  // Future enhancement
}
```

### Future: Route-Level Gating

```typescript
// In route guard
if (claims.org_type === 'platform_owner') {
  return <Navigate to="/platform-dashboard" />;
}
```

---

## Testing

### Mock Mode Testing

```bash
# Default profile (provider_admin) - should see "Org Units"
npm run dev

# Super admin profile - should NOT see "Org Units"
VITE_DEV_PROFILE=super_admin npm run dev
```

### Production Deployment

Apply the updated JWT hook to production:

```bash
psql -h db.${PROJECT_REF}.supabase.co -U postgres -d postgres \
  -f infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql
```

### Verifying JWT Contains org_type

In browser dev tools, decode the JWT from Supabase session:

```javascript
const session = await supabase.auth.getSession();
const payload = JSON.parse(atob(session.data.session.access_token.split('.')[1]));
console.log(payload.org_type);  // Should be 'provider', 'platform_owner', or 'provider_partner'
```

---

## Related Documentation

- [Custom Claims Setup](../authentication/custom-claims-setup.md) - Full JWT hook implementation
- [RBAC Architecture](./rbac-architecture.md) - Role and permission system
- [Frontend Auth Architecture](../authentication/frontend-auth-architecture.md) - Three-mode auth system
