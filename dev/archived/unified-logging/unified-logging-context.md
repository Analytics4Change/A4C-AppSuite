# Context: Unified Logging Strategy

## Decision Record

**Date**: 2025-12-18
**Feature**: Unified Logging Strategy
**Goal**: Align all logging across components to use consistent patterns and enable production debugging
**Status**: ✅ COMPLETE

### Key Decisions

1. **Enable Production Logging**: Change `enabled: false` to `enabled: true` with `level: 'warn'` in production config. This allows warn+error logs to appear in browser console for debugging production issues.

2. **Keep Console for Workflows**: Workflows use `console.log` because Temporal captures stdout for workflow history. A Logger wrapper will standardize the format while keeping console as the output.

3. **Document Edge Functions**: Edge functions already follow a good pattern (`[function-name vX] Message`). No code changes needed, just documentation.

4. **Category-Based Filtering**: Frontend Logger uses categories (`invitation`, `auth`, `api`, etc.) for filtering. Add missing categories rather than creating a new system.

5. **No External Logging Service (Yet)**: Focus on console-based logging first. External services (DataDog, Sentry) can be added later.

6. **Keep console.log for CLI Tools** (Added 2025-12-18): Workflow scripts (test-config.ts, cleanup-*.ts, validate-system.ts) and server startup code (worker/index.ts, api/index.ts) appropriately use console.log for terminal output. This is the correct pattern for command-line tools.

## Technical Context

### Architecture

```
Frontend (Browser)
├── Logger utility (84+ files) → console.* with category filtering
├── Direct console (migrated) → all converted to Logger
└── Configuration: logging.config.ts

Workflows (Temporal Workers)
├── Activity files → Logger wrapper with timestamps
├── CLI scripts → console.log (appropriate for terminal output)
├── Server startup → console.log (appropriate for startup banners)
└── Captured by Temporal for workflow history

Edge Functions (Supabase)
├── Direct console (5 files) → good pattern, documented
└── Captured in Supabase Edge Function logs
```

### Tech Stack

**Frontend Logger**:
- Custom implementation: `frontend/src/utils/logger.ts`
- Configuration: `frontend/src/config/logging.config.ts`
- Singleton pattern with `Logger.getLogger(category)`
- Environment-based config: development, test, production

**Workflow Logging**:
- Logger wrapper: `workflows/src/shared/utils/logger.ts`
- Used by all activity files
- Output captured by Temporal and kubectl

**Edge Function Logging**:
- Raw `console.log()` with version prefix
- Output captured by Supabase

### Dependencies

- Frontend Logger initialized in `frontend/src/main.tsx`
- Workflow logging visible in Temporal UI and kubectl
- Edge function logs in Supabase dashboard

## File Structure

### New Files Created - 2025-12-18

- `workflows/src/shared/utils/logger.ts` - Workflow Logger wrapper (COMPLETE)
  - Implements `getLogger(category)` function
  - Adds timestamps and structured JSON data
  - Exports pre-configured loggers: `workflowLog`, `activityLog`, `apiLog`, `workerLog`
  - Uses console output for Temporal/kubectl visibility

- `documentation/architecture/logging-standards.md` - Centralized documentation (COMPLETE)
  - Documents all three logging mechanisms
  - Category reference table
  - Usage examples for all components
  - Best practices and migration guide

### Files Modified - 2025-12-18

**Frontend Configuration**:
- `frontend/src/config/logging.config.ts` - Added 6 new categories, enabled production logging with `warn` level

**Frontend Services (4 migrated, 2 already using Logger)**:
- `frontend/src/services/organization/getOrganizationSubdomainInfo.ts` → `'organization'`
- `frontend/src/services/mock/MockClientApi.ts` → `'mock'`
- `frontend/src/services/mock/MockMedicationApi.ts` → `'mock'`
- `frontend/src/services/auth/impersonation.service.ts` → `'auth'` (was already using Logger)
- `frontend/src/services/invitation/SupabaseInvitationService.ts` → already using `'invitation'`
- `frontend/src/services/invitation/InvitationServiceFactory.ts` → already using Logger

**Frontend Config**:
- `frontend/src/config/env-validation.ts` → `'config'`
- `frontend/src/config/deployment.config.ts` → `'config'`

**Frontend Contexts**:
- `frontend/src/contexts/FocusBehaviorContext.tsx` → `'navigation'`

**Frontend Views/ViewModels**:
- `frontend/src/views/medication/SpecialRestrictionsInput.tsx` → `'validation'`
- `frontend/src/views/medication/FoodConditionsInput.tsx` → `'validation'`
- `frontend/src/views/medication/DosageTimingsInput.tsx` → `'viewmodel'`
- `frontend/src/views/medication/DosageFrequencyInput.tsx` → `'validation'`
- `frontend/src/viewModels/client/ClientSelectionViewModel.ts` → `'viewmodel'`
- `frontend/src/viewModels/medication/MedicationManagementValidation.ts` → `'validation'`
- `frontend/src/hooks/useImpersonationUI.tsx` → `'auth'`
- `frontend/src/hooks/useViewModel.ts` → `'viewmodel'`

**Frontend Components**:
- `frontend/src/components/layouts/MainLayout.tsx` → `'navigation'`
- `frontend/src/components/ui/MultiSelectDropdown.tsx` → `'component'`
- `frontend/src/components/organizations/ReferringPartnerDropdown.tsx` → `'organization'`
- `frontend/src/components/ui/FocusTrappedCheckboxGroup/FocusTrappedCheckboxGroup.tsx` → `'component'`
- `frontend/src/components/ui/FocusTrappedCheckboxGroup/EnhancedFocusTrappedCheckboxGroup.tsx` → `'component'`
- `frontend/src/components/ui/FocusTrappedCheckboxGroup/DynamicAdditionalInput.tsx` → `'component'`

**Workflows** (12 activity files migrated to Logger wrapper):
- `workflows/src/activities/organization-bootstrap/create-organization.ts`
- `workflows/src/activities/organization-bootstrap/configure-dns.ts`
- `workflows/src/activities/organization-bootstrap/verify-dns.ts`
- `workflows/src/activities/organization-bootstrap/send-invitation-emails.ts`
- `workflows/src/activities/organization-bootstrap/generate-invitations.ts`
- `workflows/src/activities/organization-bootstrap/activate-organization.ts`
- `workflows/src/activities/organization-bootstrap/deactivate-organization.ts`
- `workflows/src/activities/organization-bootstrap/remove-dns.ts`
- `workflows/src/activities/organization-bootstrap/revoke-invitations.ts`
- `workflows/src/activities/organization-bootstrap/delete-contacts.ts`
- `workflows/src/activities/organization-bootstrap/delete-addresses.ts`
- `workflows/src/activities/organization-bootstrap/delete-phones.ts`
- `workflows/src/shared/utils/index.ts` - Added logger exports

### Files Intentionally Kept with console.log

**Demo/Example Files**:
- `frontend/src/components/ui/FocusTrappedCheckboxGroup/example-usage.tsx` - Demo file for documentation

**Workflow CLI Scripts** (appropriate for terminal output):
- `workflows/src/scripts/test-config.ts`
- `workflows/src/scripts/cleanup-org.ts`
- `workflows/src/scripts/validate-system.ts`
- `workflows/src/scripts/cleanup-dev.ts`
- `workflows/src/scripts/query-dev.ts`
- `workflows/src/scripts/cleanup-test-org-dns.ts`

**Workflow Server Startup** (appropriate for startup banners):
- `workflows/src/worker/index.ts`
- `workflows/src/api/index.ts`
- `workflows/src/worker/health.ts`

## Related Components

- **Subdomain Redirect Debugging**: The motivation for this work - diagnostic logs weren't visible in production
- **Temporal Web UI**: Workflow logs visible in timeline
- **Supabase Dashboard**: Edge function logs in Logs section
- **Browser DevTools**: Frontend logs in Console tab

## Key Patterns and Conventions

### Frontend Logger Pattern
```typescript
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('category');

log.debug('Detailed debug info', { data });
log.info('Important information');
log.warn('Warning message');
log.error('Error occurred', error);
```

### Workflow Logger Pattern (Implemented - 2025-12-18)
```typescript
import { getLogger } from '@shared/utils';

const log = getLogger('ActivityName');

log.info('Starting activity', { param1, param2 });
log.debug('Detailed operation', { data });
log.warn('Warning condition', { context });
log.error('Activity failed', { error: err.message });
```

**Output format**:
```
2025-12-18T10:30:00.000Z [ConfigureDNS] INFO  Starting DNS configuration {"subdomain":"test"}
```

### Edge Function Pattern (Existing)
```typescript
const DEPLOY_VERSION = 'v7';

console.log(`[function-name ${DEPLOY_VERSION}] Message`, { data });
console.error(`[function-name ${DEPLOY_VERSION}] Error:`, error);
```

## Reference Materials

- `frontend/CLAUDE.md` - Frontend logging documentation (lines 466-499)
- `documentation/architecture/logging-standards.md` - Centralized logging standards
- `documentation/frontend/README.md` - Logger categories and usage
- `documentation/frontend/reference/components/LogOverlay.md` - Debug overlay

## Important Constraints

1. **Vite Build**: Production builds strip `console.*` via esbuild - Logger must use actual console methods
2. **Temporal Visibility**: Workflow logs must use console to appear in Temporal history
3. **Bundle Size**: Keep Logger lightweight, no heavy dependencies
4. **Backward Compatibility**: Existing log consumers (LogOverlay, etc.) must continue working

## Why This Approach?

**Why not a single Logger for all components?**
- Workflows run in Node.js worker, frontend runs in browser
- Different output targets (console vs structured logs)
- Workflow Logger wrapper provides consistency without coupling

**Why enable production warn+error?**
- Debugging production issues requires visibility
- Only warn+error minimizes performance impact
- Can be disabled via `VITE_DEBUG_LOGS=false` if needed

**Why not external logging service?**
- Console-based logging solves immediate problem
- External services add complexity and cost
- Can be added incrementally later

**Why keep console.log for CLI tools?**
- CLI scripts output to terminal, console.log is the standard pattern
- Server startup banners are traditionally console output
- Logger wrapper adds unnecessary complexity for simple CLI tools

## Audit Summary (Final - 2025-12-18)

| Component | Mechanism | Files | Status |
|-----------|-----------|-------|--------|
| Frontend | Logger utility | 105+ | ✅ Categories added, production enabled, all migrated |
| Workflows | Logger wrapper | 12 | ✅ All activities migrated |
| Workflows | Direct console | 9 | ✅ Intentionally kept (CLI tools, startup) |
| Edge Functions | Direct console | 5 | ✅ Pattern documented |

### Categories in logging.config.ts (Updated 2025-12-18)

**Core functionality**:
- `main`, `mobx`, `navigation`, `component`, `hook`, `viewmodel`, `ui`

**Services and data**:
- `api`, `validation`

**Authentication and authorization**:
- `auth`, `invitation`, `organization`

**Development utilities**:
- `mock`, `config`, `diagnostics`

**Performance and monitoring**:
- `performance`, `default`
