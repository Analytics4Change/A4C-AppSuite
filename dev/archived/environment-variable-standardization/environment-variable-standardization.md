# Environment Variable Standardization Plan

**Status**: Completed
**Started**: 2025-12-02
**Last Updated**: 2025-12-02

## Overview

This plan documents the standardization of environment variable handling across the A4C-AppSuite monorepo using Zod validation at the earliest possible point.

## Requirements

1. **Fail Fast**: All required environment variables validated immediately at startup
2. **Type Safety**: Zod schemas provide runtime validation with TypeScript inference
3. **Clear Errors**: Missing/invalid env vars produce clear error messages
4. **Consistent Patterns**: Same approach across frontend, workflows, and Edge functions

## Implementation Summary

### 1. Frontend (Vite/React)

**Files Created/Modified:**
- `frontend/src/config/env-validation.ts` - Zod schema and validation
- `frontend/src/vite-env.d.ts` - TypeScript definitions for `import.meta.env`
- `frontend/src/main.tsx` - Calls `validateEnv()` before React initialization
- `frontend/src/services/auth/AuthProviderFactory.ts` - Uses `getEnv()` for type-safe access
- `frontend/src/services/auth/SupabaseAuthProvider.ts` - Uses `getEnv()` for type-safe access

**Schema Definition:**
```typescript
// frontend/src/config/env-validation.ts
const frontendEnvSchema = z.object({
  VITE_RXNORM_API_URL: z.string().url().default('https://rxnav.nlm.nih.gov/REST'),
  VITE_SUPABASE_URL: z.string().url().optional(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  VITE_AUTH_MODE: z.enum(['mock', 'integration', 'production']).default('mock'),
  VITE_BACKEND_API_URL: z.string().url().optional(),
});
```

**Mode-Aware Validation:**
- Mock mode: Supabase vars optional (for UI development)
- Integration/Production mode: Supabase vars required

### 2. Workflows (Node.js/Temporal)

**Files Created/Modified:**
- `workflows/src/shared/config/env-schema.ts` - Zod schema definitions
- `workflows/src/shared/config/validate-config.ts` - Validates env then business logic
- `workflows/src/shared/config/index.ts` - Re-exports for clean imports
- `workflows/src/worker/index.ts` - Uses validated env throughout

**Schema Definition:**
```typescript
// workflows/src/shared/config/env-schema.ts
export const workflowsEnvSchema = z.object({
  WORKFLOW_MODE: z.enum(['production', 'development', 'mock']).default('development'),
  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().default('default'),
  TEMPORAL_TASK_QUEUE: z.string().default('bootstrap'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CLOUDFLARE_API_TOKEN: z.string().min(1).optional(),
  CLOUDFLARE_ZONE_ID: z.string().optional(),
  CLOUDFLARE_BASE_DOMAIN: z.string().default('a4c.io'),
  RESEND_API_KEY: z.string().min(1).optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().default('587').transform((v) => parseInt(v, 10)),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  HEALTH_CHECK_PORT: z.string().default('9090').transform((v) => parseInt(v, 10)),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
```

**Business Logic Validation:**
After Zod validates types, additional checks:
- Production mode requires `CLOUDFLARE_API_TOKEN`
- Production mode requires `RESEND_API_KEY` or SMTP credentials

### 3. Edge Functions (Deno/Supabase)

**Files Created/Modified:**
- `infrastructure/supabase/supabase/functions/_shared/env-schema.ts` - Shared Zod validation
- `infrastructure/supabase/supabase/functions/deno.json` - Added Zod import
- `infrastructure/supabase/supabase/functions/organization-bootstrap/index.ts` - Uses Zod validation
- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts` - Uses Zod validation
- `infrastructure/supabase/supabase/functions/validate-invitation/index.ts` - Uses Zod validation
- `infrastructure/supabase/supabase/functions/workflow-status/index.ts` - Uses Zod validation

**Schema Definition:**
```typescript
// infrastructure/supabase/supabase/functions/_shared/env-schema.ts
export const edgeFunctionEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  BACKEND_API_URL: z.string().url().default('https://api-a4c.firstovertheline.com'),
  GIT_COMMIT_SHA: z.string().optional(),
});
```

**Usage Pattern:**
```typescript
import { validateEdgeFunctionEnv, createEnvErrorResponse } from '../_shared/env-schema.ts';

let env;
try {
  env = validateEdgeFunctionEnv('function-name');
} catch (error) {
  return createEnvErrorResponse('function-name', DEPLOY_VERSION, error.message, corsHeaders);
}

// Additional check for functions requiring service role
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  return createEnvErrorResponse('function-name', DEPLOY_VERSION, 'SUPABASE_SERVICE_ROLE_KEY is required', corsHeaders);
}
```

## Key Technical Decisions

### 1. Zod `.default()` Must Precede `.transform()`

**Incorrect:**
```typescript
z.string().transform((v) => parseInt(v, 10)).default('9090')
// Error: default expects number, but '9090' is string
```

**Correct:**
```typescript
z.string().default('9090').transform((v) => parseInt(v, 10))
// default operates on input type (string), transform produces output type (number)
```

### 2. Mode-Aware Validation in Frontend

The frontend has three auth modes:
- `mock` - For UI development without Supabase
- `integration` - For testing with real Supabase
- `production` - Full production mode

Mock mode makes Supabase variables optional to allow rapid UI development.

### 3. Shared Config vs Per-Function Schemas

- **Frontend**: Single `env-validation.ts` with `getEnv()` accessor
- **Workflows**: Shared schema in `shared/config/`, exported from `index.ts`
- **Edge Functions**: Shared `_shared/env-schema.ts` imported by each function

### 4. Error Response Standardization

All Edge functions return consistent error format:
```json
{
  "error": "Server configuration error",
  "details": "Missing required environment variables",
  "version": "v3"
}
```

## Bug Fixes

### Edge Function SERVICE_ROLE_KEY Naming

**Issue**: Edge functions used `SERVICE_ROLE_KEY` instead of `SUPABASE_SERVICE_ROLE_KEY`

**Root Cause**: Inconsistent naming convention between local development and Supabase platform

**Fix**: Standardized to `SUPABASE_SERVICE_ROLE_KEY` which Supabase auto-injects for Edge functions

## Testing

### Frontend
```bash
cd frontend
npm run build  # TypeScript compilation validates env types
npm run dev    # Mock mode - should start without Supabase vars
npm run dev:auth  # Integration mode - requires Supabase vars
```

### Workflows
```bash
cd workflows
npm run build  # TypeScript compilation
npm run test   # Unit tests
```

### Edge Functions
```bash
cd infrastructure/supabase
./local-tests/start-local.sh
./local-tests/deploy-functions.sh
# Test via curl or frontend
./local-tests/stop-local.sh
```

## Future Improvements

1. **Shared Package**: Consider creating `@a4c/config` package if schemas need cross-project sharing
2. **Runtime Schema Generation**: Auto-generate TypeScript types from Zod schemas
3. **Environment Documentation**: Generate env var documentation from schemas
4. **CI Validation**: Add GitHub Actions step to validate env schema coverage

## Related Documentation

- `frontend/CLAUDE.md` - Frontend development guidelines
- `workflows/CLAUDE.md` - Workflow development guidelines
- `infrastructure/CLAUDE.md` - Infrastructure guidelines
- `documentation/infrastructure/guides/supabase/DEPLOYMENT_INSTRUCTIONS.md` - Production deployment
