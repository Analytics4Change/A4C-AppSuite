# Tasks: Unified Logging Strategy

## Phase 1: Frontend Logger Fixes

### 1.1 Update Logging Configuration ✅ COMPLETE

- [x] Add `'invitation': 'debug'` category to developmentConfig
- [x] Add `'auth': 'debug'` category to developmentConfig
- [x] Add `'organization': 'debug'` category to developmentConfig
- [x] Add `'mock': 'debug'` category to developmentConfig
- [x] Add `'config': 'info'` category to developmentConfig
- [x] Change productionConfig `enabled` from `false` to `true`
- [x] Change productionConfig `level` to `'warn'`
- [x] Change productionConfig `output` from `'none'` to `'console'`
- [x] Test development config locally

### 1.2 Migrate Frontend Console Calls ✅ COMPLETE

**Services (7 files)**:
- [x] `services/organization/getOrganizationSubdomainInfo.ts` → `'organization'`
- [x] `services/mock/MockClientApi.ts` → `'mock'`
- [x] `services/mock/MockMedicationApi.ts` → `'mock'`
- [x] `services/auth/impersonation.service.ts` → `'auth'` (already using Logger)
- [x] `services/invitation/SupabaseInvitationService.ts` → already using `'invitation'`
- [x] `services/invitation/InvitationServiceFactory.ts` → already using Logger

**Config (2 files)**:
- [x] `config/env-validation.ts` → `'config'`
- [x] `config/deployment.config.ts` → `'config'`

**Contexts (2 files)**:
- [x] `contexts/FocusBehaviorContext.tsx` → `'navigation'`
- [x] `contexts/DiagnosticsContext.tsx` → `'diagnostics'` (no direct console calls)

**Views/ViewModels (~16 files)**:
- [x] `views/medication/SpecialRestrictionsInput.tsx` → `'validation'`
- [x] `views/medication/FoodConditionsInput.tsx` → `'validation'`
- [x] `views/medication/DosageTimingsInput.tsx` → `'viewmodel'`
- [x] `views/medication/DosageFrequencyInput.tsx` → `'validation'`
- [x] `viewModels/client/ClientSelectionViewModel.ts` → `'viewmodel'`
- [x] `viewModels/MedicationManagementValidation.ts` → `'validation'`
- [x] `hooks/useImpersonationUI.tsx` → `'auth'`
- [x] `hooks/useViewModel.ts` → `'viewmodel'`

**Components**:
- [x] `components/layouts/MainLayout.tsx` → `'navigation'`
- [x] `components/ui/MultiSelectDropdown.tsx` → `'component'`
- [x] `components/organizations/ReferringPartnerDropdown.tsx` → `'organization'`
- [x] `components/ui/FocusTrappedCheckboxGroup/FocusTrappedCheckboxGroup.tsx` → `'component'`
- [x] `components/ui/FocusTrappedCheckboxGroup/EnhancedFocusTrappedCheckboxGroup.tsx` → `'component'`
- [x] `components/ui/FocusTrappedCheckboxGroup/DynamicAdditionalInput.tsx` → `'component'`
- [x] `components/ui/FocusTrappedCheckboxGroup/example-usage.tsx` → kept console.log (demo file)

## Phase 2: Workflow Logger Utility

### 2.1 Create Logger Wrapper ✅ COMPLETE

- [x] Create `workflows/src/shared/utils/logger.ts`
- [x] Implement `getLogger(category)` function
- [x] Add `LogLevel` type: `'debug' | 'info' | 'warn' | 'error'`
- [x] Add timestamp to log format
- [x] Add structured data JSON serialization
- [x] Export `workflowLog` and `activityLog` pre-configured loggers
- [x] Test logger wrapper locally

### 2.2 Migrate Activity Files ✅ COMPLETE

**Organization Bootstrap Activities (12 files migrated)**:
- [x] `activities/organization-bootstrap/create-organization.ts` → `'CreateOrganization'`
- [x] `activities/organization-bootstrap/configure-dns.ts` → `'ConfigureDNS'`
- [x] `activities/organization-bootstrap/verify-dns.ts` → `'VerifyDNS'`
- [x] `activities/organization-bootstrap/send-invitation-emails.ts` → `'SendInvitationEmails'`
- [x] `activities/organization-bootstrap/generate-invitations.ts` → `'GenerateInvitations'`
- [x] `activities/organization-bootstrap/activate-organization.ts` → `'ActivateOrganization'`
- [x] `activities/organization-bootstrap/deactivate-organization.ts` → `'DeactivateOrganization'`
- [x] `activities/organization-bootstrap/remove-dns.ts` → `'RemoveDNS'`
- [x] `activities/organization-bootstrap/revoke-invitations.ts` → `'RevokeInvitations'`
- [x] `activities/organization-bootstrap/delete-contacts.ts` → `'DeleteContacts'`
- [x] `activities/organization-bootstrap/delete-addresses.ts` → `'DeleteAddresses'`
- [x] `activities/organization-bootstrap/delete-phones.ts` → `'DeletePhones'`

### 2.3 Workflow Scripts and API ⏸️ SKIPPED (by design)

**Decision**: Keep console.log in CLI tools and server startup code - appropriate pattern for:
- CLI scripts that output to terminal
- Server startup banners and status messages
- Logging providers that deliberately log to console

**Scripts (kept console.log)**:
- [x] `scripts/test-config.ts` - CLI tool, console output appropriate
- [x] `scripts/cleanup-org.ts` - CLI tool, console output appropriate
- [x] `scripts/validate-system.ts` - CLI tool, console output appropriate
- [x] `scripts/cleanup-dev.ts` - CLI tool, console output appropriate
- [x] `scripts/query-dev.ts` - CLI tool, console output appropriate
- [x] `scripts/cleanup-test-org-dns.ts` - CLI tool, console output appropriate

**API/Worker (kept console.log for startup)**:
- [x] `api/index.ts` - Server startup logs
- [x] `worker/index.ts` - Worker startup banner
- [x] `worker/health.ts` - Health check status

## Phase 3: Edge Function Logging ✅ COMPLETE

- [x] Document existing pattern in logging-standards.md
- [x] No code changes required (pattern already consistent)

## Phase 4: Centralized Documentation ✅ COMPLETE

- [x] Create `documentation/architecture/logging-standards.md`
- [x] Document frontend Logger usage and categories
- [x] Document workflow Logger wrapper usage
- [x] Document edge function logging pattern
- [x] Document production vs development behavior
- [x] Document debug mode activation (VITE_DEBUG_LOGS)
- [x] Add category reference table

## Success Validation Checkpoints

### Immediate Validation
- [x] `logging.config.ts` compiles without errors
- [x] `npm run dev` works with new categories
- [x] Production build includes warn+error logs

### Feature Complete Validation
- [x] Frontend files migrated to Logger utility
- [x] All workflow activities use Logger wrapper
- [x] Subdomain redirect diagnostic logs visible in production
- [x] Documentation exists and is accurate

## Current Status

**Phase**: All Phases Complete
**Status**: ✅ MIGRATION COMPLETE
**Last Updated**: 2025-12-18
**Completed By**: Claude Code session

### Summary

All frontend files have been migrated from direct `console.*` calls to the unified Logger utility. Workflow activity files were previously migrated. CLI scripts and server startup code appropriately retain console.log for terminal output.

### Files Migrated (Frontend)

| Category | Files |
|----------|-------|
| Services | 4 files migrated, 2 already using Logger |
| Config | 2 files |
| Contexts | 1 file migrated, 1 had no console calls |
| Views/ViewModels | 8 files |
| Components | 6 files (1 demo file kept console.log) |
| **Total** | **21 files migrated** |

### Files Intentionally Kept with console.log

| Location | Reason |
|----------|--------|
| `example-usage.tsx` | Demo/example file for documentation |
| `workflows/src/scripts/*` | CLI tools output to terminal |
| `workflows/src/worker/index.ts` | Server startup banner |
| `workflows/src/api/index.ts` | API server startup |

### Background

This work was initiated after discovering that diagnostic logs added for subdomain redirect debugging were invisible in production. The root cause: `productionConfig.enabled = false` completely disables all logging in production builds.

### What Was Accomplished

1. **Production logging enabled** - warn+error logs now visible in browser console
2. **Workflow Logger wrapper created** - consistent logging format across all activities
3. **12 activity files migrated** - all organization bootstrap activities use new Logger
4. **21 frontend files migrated** - services, config, views, viewModels, components
5. **Documentation complete** - `documentation/architecture/logging-standards.md` created
