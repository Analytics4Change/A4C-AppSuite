# Logging Standards

This document defines the unified logging strategy across all A4C-AppSuite components.

## Overview

The application uses three logging mechanisms optimized for each component's runtime:

| Component | Mechanism | Output | Visibility |
|-----------|-----------|--------|------------|
| Frontend | Logger utility | Browser console | DevTools |
| Workflows | Logger wrapper | stdout | Temporal UI, kubectl logs |
| Edge Functions | Direct console | stdout | Supabase dashboard |

## Frontend Logging

### Logger Utility

The frontend uses a centralized Logger utility with category-based filtering.

**Location**: `frontend/src/utils/logger.ts`

**Configuration**: `frontend/src/config/logging.config.ts`

### Usage

```typescript
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('category');

log.debug('Detailed debug information', { data });
log.info('Important information');
log.warn('Warning message');
log.error('Error occurred', error);
```

### Categories

| Category | Purpose |
|----------|---------|
| `main` | Application startup and lifecycle |
| `mobx` | MobX state management and reactions |
| `viewmodel` | ViewModel business logic |
| `navigation` | Focus and keyboard navigation |
| `component` | Component lifecycle and rendering |
| `api` | API calls and responses |
| `validation` | Form validation logic |
| `auth` | Authentication and authorization |
| `invitation` | Organization invitations |
| `organization` | Organization management |
| `mock` | Mock service layer |
| `config` | Configuration and environment |
| `diagnostics` | Debug tool controls |
| `performance` | Performance monitoring |
| `default` | Fallback for uncategorized logs |

### Environment Configurations

**Development** (default):
- All categories enabled
- `debug` level minimum
- Timestamps and location included

**Production** (without `VITE_DEBUG_LOGS`):
- `warn` level minimum (only warn + error visible)
- Critical categories enabled: `auth`, `organization`, `invitation`, `api`, `config`
- Timestamps included, no location

**Production** (with `VITE_DEBUG_LOGS=true`):
- `info` level minimum
- Extended category visibility
- Full debugging capability

### Debug Mode

Enable debug logging in production by setting:

```bash
VITE_DEBUG_LOGS=true
```

## Workflow Logging

### Logger Wrapper

Workflows use a lightweight Logger wrapper that outputs to console for Temporal visibility.

**Location**: `workflows/src/shared/utils/logger.ts`

### Usage

```typescript
import { getLogger } from '@shared/utils';

const log = getLogger('ActivityName');

log.info('Starting activity', { param1, param2 });
log.debug('Detailed operation', { data });
log.warn('Warning condition', { context });
log.error('Activity failed', { error: err.message });
```

### Pre-configured Loggers

```typescript
import { workflowLog, activityLog, apiLog, workerLog } from '@shared/utils';

workflowLog.info('Workflow started');
activityLog.info('Activity completed');
```

### Output Format

```
2025-12-18T10:30:00.000Z [ConfigureDNS] INFO  Starting DNS configuration {"subdomain":"test"}
```

### Log Levels

| Level | Use Case |
|-------|----------|
| `debug` | Detailed debugging information (hidden in production) |
| `info` | Normal operation events |
| `warn` | Warning conditions (not errors but noteworthy) |
| `error` | Error conditions that need attention |

### Environment Configuration

Set minimum log level via environment variable:

```bash
LOG_LEVEL=info  # Options: debug, info, warn, error
```

Default: `info` in production, `debug` otherwise.

## Edge Function Logging

### Pattern

Edge functions use direct console calls with a version prefix:

```typescript
const DEPLOY_VERSION = 'v7';

console.log(`[function-name ${DEPLOY_VERSION}] Message`, { data });
console.error(`[function-name ${DEPLOY_VERSION}] Error:`, error);
```

### Example

```typescript
// infrastructure/supabase/edge-functions/custom-claims-hook/index.ts
const DEPLOY_VERSION = 'v8';

Deno.serve(async (req) => {
  console.log(`[custom-claims-hook ${DEPLOY_VERSION}] Processing request`);

  try {
    // Process request
    console.log(`[custom-claims-hook ${DEPLOY_VERSION}] Claims generated`, { userId });
  } catch (error) {
    console.error(`[custom-claims-hook ${DEPLOY_VERSION}] Error:`, error);
  }
});
```

### Visibility

Edge function logs are visible in:
- Supabase Dashboard → Logs → Edge Functions
- Real-time during function execution

## Best Practices

### DO

1. **Use structured data objects** for context:
   ```typescript
   log.info('User action', { userId, action, timestamp });
   ```

2. **Choose appropriate log levels**:
   - `debug` for detailed debugging
   - `info` for normal operations
   - `warn` for unusual but handled conditions
   - `error` for actual errors

3. **Include relevant context** in error logs:
   ```typescript
   log.error('Database query failed', {
     query: 'get_organization',
     orgId,
     error: err.message
   });
   ```

4. **Use consistent category naming** matching the component or feature.

### DON'T

1. **Don't log sensitive data** (passwords, tokens, PII):
   ```typescript
   // BAD
   log.info('Login attempt', { password });

   // GOOD
   log.info('Login attempt', { email: user.email });
   ```

2. **Don't use direct console calls in frontend** (except Logger internals):
   ```typescript
   // BAD
   console.log('Debug message');

   // GOOD
   const log = Logger.getLogger('myCategory');
   log.debug('Debug message');
   ```

3. **Don't log excessively** in loops:
   ```typescript
   // BAD
   for (const item of items) {
     log.debug('Processing item', { item });
   }

   // GOOD
   log.debug('Processing items', { count: items.length });
   ```

## Troubleshooting

### Frontend Logs Not Visible

1. Check `VITE_DEBUG_LOGS` environment variable
2. Verify category is enabled in `logging.config.ts`
3. Check browser console filters

### Workflow Logs Not Visible

1. Check `LOG_LEVEL` environment variable
2. Verify kubectl connection: `kubectl logs -n temporal -l app=workflow-worker`
3. Check Temporal UI workflow history

### Edge Function Logs Not Visible

1. Check Supabase Dashboard → Logs → Edge Functions
2. Verify function is deployed with latest version
3. Check for function execution errors

## Migration Guide

### Migrating Frontend Console Calls

1. Import Logger:
   ```typescript
   import { Logger } from '@/utils/logger';
   ```

2. Create category logger:
   ```typescript
   const log = Logger.getLogger('yourCategory');
   ```

3. Replace console calls:
   ```typescript
   // Before
   console.log('Message');
   console.error('Error:', error);

   // After
   log.info('Message');
   log.error('Error', { error: error.message });
   ```

### Migrating Workflow Console Calls

1. Import getLogger:
   ```typescript
   import { getLogger } from '@shared/utils';
   ```

2. Create component logger:
   ```typescript
   const log = getLogger('ComponentName');
   ```

3. Replace console calls:
   ```typescript
   // Before
   console.log(`[Component] Message: ${value}`);

   // After
   log.info('Message', { value });
   ```
