---
status: current
last_updated: 2025-01-12
---

# Deployment Mode Refactoring - Complete

**Status**: ✅ Complete
**Completed**: 2025-10-30
**Impact**: Frontend architecture - All services
**Pattern**: Centralized deployment configuration

---

## Executive Summary

Refactored frontend deployment mode configuration from two interdependent environment variables to a single, semantic variable. This eliminates invalid configurations and provides clearer developer intent.

### Before (Invalid Configurations Possible)

```bash
# ✅ Valid combinations
VITE_AUTH_PROVIDER=mock
VITE_USE_MOCK_ORGANIZATION=true

VITE_AUTH_PROVIDER=supabase
VITE_USE_MOCK_ORGANIZATION=false

# ❌ Invalid combinations (technically possible but wrong)
VITE_AUTH_PROVIDER=mock
VITE_USE_MOCK_ORGANIZATION=false

VITE_AUTH_PROVIDER=supabase
VITE_USE_MOCK_ORGANIZATION=true
```

**Problem**: Functional dependency between variables creates 4 possible states (2 invalid).

### After (Clean, Semantic)

```bash
# Two clear deployment modes
VITE_APP_MODE=mock        # All services mocked
VITE_APP_MODE=production  # All services real
```

**Solution**: Single variable maps to coordinated service configurations.

---

## Architectural Changes

### New Configuration Module

**File**: `frontend/src/config/deployment.config.ts`

```typescript
export type AppMode = 'mock' | 'production';

export interface DeploymentConfig {
  authProvider: 'mock' | 'supabase';
  useMockOrganization: boolean;
}

const DEPLOYMENT_CONFIGS: Record<AppMode, DeploymentConfig> = {
  mock: {
    authProvider: 'mock',
    useMockOrganization: true,
  },
  production: {
    authProvider: 'supabase',
    useMockOrganization: false,
  }
};

export function getDeploymentConfig(): DeploymentConfig {
  const mode = (import.meta.env.VITE_APP_MODE as AppMode) ||
               (import.meta.env.PROD ? 'production' : 'mock');

  const config = DEPLOYMENT_CONFIGS[mode];

  if (!config) {
    throw new Error(`Invalid VITE_APP_MODE: "${mode}". Must be 'mock' or 'production'.`);
  }

  console.log(`[Deployment] Mode: ${mode}`, config);
  return config;
}
```

**Benefits**:
- Type-safe deployment modes
- Validation at initialization
- Centralized configuration mapping
- Clear error messages for invalid modes
- Console logging for debugging

---

## Files Modified

### Core Configuration

#### ✅ `frontend/src/config/deployment.config.ts` (NEW)
- Centralized deployment mode configuration
- Type-safe mode definitions
- Validation and error handling

#### ✅ `frontend/src/config/index.ts`
- Added barrel exports for deployment config

### Service Factories

#### ✅ `frontend/src/services/auth/AuthProviderFactory.ts`
- Updated `getAuthProviderType()` to use `getDeploymentConfig().authProvider`
- Removed direct environment variable access
- Updated comments to reference `VITE_APP_MODE`

**Before**:
```typescript
const providerType = import.meta.env.VITE_AUTH_PROVIDER || 'mock';
```

**After**:
```typescript
const { authProvider } = getDeploymentConfig();
return authProvider;
```

#### ✅ `frontend/src/services/ServiceFactory.ts`
- Updated `getOrganizationService()` to use `getDeploymentConfig().useMockOrganization`
- Updated header documentation
- Removed direct environment variable access

**Before**:
```typescript
const useMock = import.meta.env.VITE_USE_MOCK_ORGANIZATION === 'true';
```

**After**:
```typescript
const { useMockOrganization } = getDeploymentConfig();
```

### React Context

#### ✅ `frontend/src/contexts/AuthContext.tsx`
- Updated to use deployment config for provider type
- Updated comments

**Before**:
```typescript
// Line 8: VITE_AUTH_PROVIDER determines which provider to use
providerType: getAuthProviderType()
```

**After**:
```typescript
// Line 8: VITE_APP_MODE determines which provider to use
providerType: getDeploymentConfig().authProvider
```

### Documentation

#### ✅ `frontend/.env.example`
- Removed `VITE_AUTH_PROVIDER` documentation
- Removed `VITE_USE_MOCK_ORGANIZATION` documentation
- Added comprehensive `VITE_APP_MODE` documentation with use cases

**New Documentation**:
```bash
# Application Mode - Controls all service implementations
# Options: "mock" | "production"
#
# mock mode (default for development):
#   - Mock authentication (instant login, no network)
#   - Mock organization service (fake data)
#   Use: npm run dev (or npm run dev:mock)
#
# production mode (integration/production):
#   - Real Supabase Auth (OAuth flows, real JWT)
#   - Real organization service (Edge Functions, Temporal workflows)
#   Use: npm run dev:integration (or npm run dev:auth)
VITE_APP_MODE=mock
```

#### ✅ `frontend/.env.local`
- Removed deprecated variables:
  - `VITE_AUTH_PROVIDER`
  - `VITE_USE_MOCK_ORGANIZATION`
  - `VITE_ZITADEL_SERVICE_USER_ID`
  - `VITE_ZITADEL_SERVICE_KEY_FILE`
  - `VITE_BOOTSTRAP_ADMIN_EMAIL`
  - `VITE_AUTO_BOOTSTRAP_ROLES`
- Added `VITE_APP_MODE=mock`

**Cleaned Configuration**:
```bash
# Deployment Mode
VITE_APP_MODE=mock

# Mock Authentication - Super Admin for RBAC Testing
VITE_DEV_USER_ROLE=super_admin
VITE_DEV_USER_NAME=Dev Super Admin

# Supabase Configuration (for production mode)
VITE_SUPABASE_URL=https://cuvxypuwvbchsngjzdqo.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

#### ✅ `frontend/CLAUDE.md`
- Updated environment configuration examples (lines 317-329)
- Changed from `VITE_AUTH_PROVIDER` to `VITE_APP_MODE`

#### ✅ `frontend/src/services/auth/DevAuthProvider.ts`
- Line 16: Comment changed from `VITE_AUTH_PROVIDER=mock` to `VITE_APP_MODE=mock`

#### ✅ `frontend/src/services/auth/SupabaseAuthProvider.ts`
- Line 17: Comment changed from `VITE_AUTH_PROVIDER=supabase` to `VITE_APP_MODE=production`

### Build Configuration

#### ✅ `frontend/package.json`
- Updated npm scripts to use `VITE_APP_MODE`

**Before**:
```json
"dev:mock": "VITE_AUTH_PROVIDER=mock vite",
"dev:auth": "VITE_AUTH_PROVIDER=supabase vite",
"dev:integration": "VITE_AUTH_PROVIDER=supabase vite"
```

**After**:
```json
"dev": "vite",
"dev:mock": "VITE_APP_MODE=mock vite",
"dev:auth": "VITE_APP_MODE=production vite",
"dev:integration": "VITE_APP_MODE=production vite"
```

---

## Migration Guide

### For Developers

**Old way**:
```bash
# Set two variables
export VITE_AUTH_PROVIDER=mock
export VITE_USE_MOCK_ORGANIZATION=true
npm run dev
```

**New way**:
```bash
# Set one variable
export VITE_APP_MODE=mock
npm run dev

# Or use predefined scripts
npm run dev        # Default (mock mode)
npm run dev:mock   # Explicit mock mode
npm run dev:auth   # Production mode
```

### For CI/CD

**Old `.env.development`**:
```bash
VITE_AUTH_PROVIDER=mock
VITE_USE_MOCK_ORGANIZATION=true
```

**New `.env.development`**:
```bash
VITE_APP_MODE=mock
```

**Old `.env.production`**:
```bash
VITE_AUTH_PROVIDER=supabase
VITE_USE_MOCK_ORGANIZATION=false
```

**New `.env.production`**:
```bash
VITE_APP_MODE=production
```

---

## Benefits Achieved

### 1. Eliminates Invalid Configurations
- **Before**: 4 possible states (2 invalid)
- **After**: 2 possible states (0 invalid)

### 2. Clearer Developer Intent
- `VITE_APP_MODE=mock` clearly communicates "I want everything mocked"
- `VITE_APP_MODE=production` clearly communicates "I want real services"

### 3. Single Source of Truth
- One variable to set instead of two
- No risk of configuration drift

### 4. Better Error Handling
- Validation at initialization
- Clear error messages for invalid modes
- Console logging for debugging

### 5. Follows Database Normalization Principles
- Removes functional dependency
- Single atomic value determines configuration

### 6. Type Safety
- TypeScript enums for mode values
- Compile-time validation

---

## Testing Results

### TypeScript Compilation
```bash
$ npm run typecheck
✅ No errors found
```

### Runtime Validation
```bash
$ VITE_APP_MODE=invalid npm run dev
❌ Error: Invalid VITE_APP_MODE: "invalid". Must be 'mock' or 'production'.
```

### Mock Mode
```bash
$ VITE_APP_MODE=mock npm run dev
[Deployment] Mode: mock { authProvider: 'mock', useMockOrganization: true }
🔧 DevAuthProvider: Initializing mock authentication
Using MockOrganizationService (VITE_APP_MODE=mock)
✅ Works correctly
```

### Production Mode
```bash
$ VITE_APP_MODE=production npm run dev
[Deployment] Mode: production { authProvider: 'supabase', useMockOrganization: false }
🔐 SupabaseAuthProvider: Initializing
Using ProductionOrganizationService (VITE_APP_MODE=production)
✅ Works correctly
```

---

## Future Considerations

### Potential Extensions

1. **Additional Modes**:
   ```typescript
   type AppMode = 'mock' | 'production' | 'staging' | 'test';
   ```

2. **Feature Flags**:
   ```typescript
   interface DeploymentConfig {
     authProvider: 'mock' | 'supabase';
     useMockOrganization: boolean;
     enableTemporal: boolean;  // Add feature flags
     enableNotifications: boolean;
   }
   ```

3. **Environment-Specific Overrides**:
   ```typescript
   // Allow partial overrides in development
   const config = {
     ...DEPLOYMENT_CONFIGS[mode],
     ...getEnvironmentOverrides()
   };
   ```

### Limitations

1. **No Per-Service Control**: Cannot mix mock auth with real organization service
   - **Workaround**: Add additional modes like `'mock-auth-only'` if needed
   - **Current Assessment**: Not needed for current use cases

2. **Binary Choice**: Only two modes supported
   - **Workaround**: Add more modes as needed
   - **Current Assessment**: Two modes sufficient for current needs

---

## Related Work

### Organization Module
This refactoring directly supports the Organization Management module:
- Mock mode uses `MockOrganizationService` + `MockWorkflowClient`
- Production mode uses `ProductionOrganizationService` + Temporal workflows
- See: `.plans/in-progress/organization-management-module.md`

### Authentication Architecture
This refactoring maintains the three-mode authentication system:
- Mock mode still supports dev user profiles
- Production mode still uses real Supabase Auth
- See: `.plans/supabase-auth-integration/frontend-auth-architecture.md`

---

## References

- **Architecture**: Frontend MVVM with dependency injection
- **Pattern**: Centralized configuration with factory pattern
- **Principle**: Database normalization (eliminate functional dependencies)
- **Environment Variables**: Vite environment variable system

---

**Completion Date**: 2025-10-30
**Verified**: TypeScript compilation successful
**Impact**: All frontend services (auth, organization, workflows)
