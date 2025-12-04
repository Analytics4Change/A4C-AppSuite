# Tasks: Frontend Lint and Typecheck Cleanup

## Phase 1: Critical Errors (24 errors) ✅ COMPLETE

### 1.1 React Hooks Rule Violations
- [x] Fix `ImpersonationBanner.tsx` - Move useEffect before early return
- [x] Fix `ImpersonationModal.tsx` - Move useEffect before early return

### 1.2 Undefined Globals
- [x] Fix `DevAuthProvider.ts` - 'btoa' not defined (use Buffer.from)
- [x] Fix `SupabaseAuthProvider.ts` - 'crypto' not defined (use globalThis.crypto)
- [x] Fix `MedicationManagementViewModel.ts` - 'crypto' not defined
- [x] Fix `AcceptInvitationPage.tsx` - 'confirm' not defined (use window.confirm)

### 1.3 Case Block Declarations (wrap in braces)
- [x] Fix `useKeyboardNavigation.ts` - Multiple case blocks
- [x] Fix `FocusTrappedCheckboxGroup.tsx` - Case blocks
- [x] Fix `EnhancedFocusTrappedCheckboxGroup.tsx` - Case blocks

### 1.4 Other Errors
- [x] Fix `types/generated/events.ts` - Remove duplicate 'Address' type
- [x] Fix `searchable-dropdown.tsx` - Remove unnecessary catch clause
- [x] Fix `scripts/plugins/base.ts` - Use specific function signature instead of Function type

### 1.5 Verification
- [x] Run `npm run typecheck` - Must pass
- [x] Run `npm run lint` - Should show 0 errors

## Phase 2: Source Code Warnings (~80 warnings) ✅ COMPLETE

### 2.1 Unused Imports (prefix with _ or remove)
- [x] Fix unused imports in `OrganizationCreatePage.tsx`
- [x] Fix unused imports in `OrganizationFormViewModel.ts`
- [x] Fix unused imports in view components
- [x] Fix unused imports in services

### 2.2 Unused Variables
- [x] Fix unused vars in hooks
- [x] Fix unused vars in components
- [x] Fix unused function parameters (prefix with _)

### 2.3 React Hook Dependencies
- [x] Review and fix useEffect dependency arrays
- [x] Add eslint-disable comments with justification where needed

### 2.4 Prefer-const
- [x] Change let to const where values are never reassigned

## Phase 3: E2E Test Warnings (~60 warnings) ✅ COMPLETE

- [x] Remove unused `expect` imports from test files
- [x] Remove unused variables in test files
- [x] Fix unused error catch variables (prefix with _)

## Phase 4: Scripts Warnings (~30 warnings) ✅ COMPLETE

- [x] Fix documentation scripts
- [x] Fix CLI command scripts
- [x] Fix config manager scripts
- [x] Fix test setup files

## Success Validation Checkpoints

### Immediate Validation
- [x] All 24 errors resolved
- [x] `npm run typecheck` passes
- [x] `npm run lint` shows only warnings

### Feature Complete Validation
- [x] `npm run lint` exits with code 0
- [x] All 174 warnings resolved (reduced to 0)
- [x] `npm run build` succeeds
- [x] GitHub Actions deployment successful

## Current Status

**Phase**: All Phases Complete
**Status**: ✅ COMPLETE
**Last Updated**: 2025-12-04
**Completion**: 198/198 issues resolved (24 errors + 174 warnings -> 0)
**Commit**: `81a2a4a7` - fix(frontend): Complete ESLint lint cleanup - zero warnings
