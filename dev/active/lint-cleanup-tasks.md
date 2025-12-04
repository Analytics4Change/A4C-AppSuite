# Tasks: Frontend Lint and Typecheck Cleanup

## Phase 1: Critical Errors (24 errors) ⏸️ PENDING

### 1.1 React Hooks Rule Violations
- [ ] Fix `ImpersonationBanner.tsx` - Move useEffect before early return
- [ ] Fix `ImpersonationModal.tsx` - Move useEffect before early return

### 1.2 Undefined Globals
- [ ] Fix `DevAuthProvider.ts` - 'btoa' not defined (use Buffer.from)
- [ ] Fix `SupabaseAuthProvider.ts` - 'crypto' not defined (use globalThis.crypto)
- [ ] Fix `MedicationManagementViewModel.ts` - 'crypto' not defined
- [ ] Fix `AcceptInvitationPage.tsx` - 'confirm' not defined (use window.confirm)

### 1.3 Case Block Declarations (wrap in braces)
- [ ] Fix `useKeyboardNavigation.ts` - Multiple case blocks
- [ ] Fix `FocusTrappedCheckboxGroup.tsx` - Case blocks
- [ ] Fix `EnhancedFocusTrappedCheckboxGroup.tsx` - Case blocks

### 1.4 Other Errors
- [ ] Fix `types/generated/events.ts` - Remove duplicate 'Address' type
- [ ] Fix `searchable-dropdown.tsx` - Remove unnecessary catch clause
- [ ] Fix `scripts/plugins/base.ts` - Use specific function signature instead of Function type

### 1.5 Verification
- [ ] Run `npm run typecheck` - Must pass
- [ ] Run `npm run lint` - Should show 0 errors

## Phase 2: Source Code Warnings (~80 warnings) ⏸️ PENDING

### 2.1 Unused Imports (prefix with _ or remove)
- [ ] Fix unused imports in `OrganizationCreatePage.tsx`
- [ ] Fix unused imports in `OrganizationFormViewModel.ts`
- [ ] Fix unused imports in view components
- [ ] Fix unused imports in services

### 2.2 Unused Variables
- [ ] Fix unused vars in hooks
- [ ] Fix unused vars in components
- [ ] Fix unused function parameters (prefix with _)

### 2.3 React Hook Dependencies
- [ ] Review and fix useEffect dependency arrays
- [ ] Add eslint-disable comments with justification where needed

### 2.4 Prefer-const
- [ ] Change let to const where values are never reassigned

## Phase 3: E2E Test Warnings (~60 warnings) ⏸️ PENDING

- [ ] Remove unused `expect` imports from test files
- [ ] Remove unused variables in test files
- [ ] Fix unused error catch variables (prefix with _)

## Phase 4: Scripts Warnings (~30 warnings) ⏸️ PENDING

- [ ] Fix documentation scripts
- [ ] Fix CLI command scripts
- [ ] Fix config manager scripts
- [ ] Fix test setup files

## Success Validation Checkpoints

### Immediate Validation
- [ ] All 24 errors resolved
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` shows only warnings

### Feature Complete Validation
- [ ] `npm run lint` exits with code 0
- [ ] All 174 warnings resolved
- [ ] `npm run build` succeeds

## Current Status

**Phase**: Phase 1 - Critical Errors
**Status**: ⏸️ PENDING
**Last Updated**: 2025-12-04
**Next Step**: Start with React Hooks rule violations in ImpersonationBanner.tsx
