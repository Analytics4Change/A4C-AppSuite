# Implementation Plan: Frontend Lint and Typecheck Cleanup

## Executive Summary

The frontend codebase has accumulated 198 lint issues (24 errors, 174 warnings) across ~85 files. This plan addresses systematic cleanup to achieve zero-warning builds, improving code quality and CI reliability.

## Current State

- **Typecheck**: ✅ Passing
- **Lint Errors**: 24
- **Lint Warnings**: 174
- **Affected Files**: ~85 (src/, e2e/, scripts/, tests/)

## Phase 1: Critical Errors (24 errors)

### 1.1 React Hooks Rule Violations
- `ImpersonationBanner.tsx` - useEffect called conditionally
- `ImpersonationModal.tsx` - useEffect called conditionally
- Fix: Move hooks before early returns

### 1.2 Undefined Globals
- `DevAuthProvider.ts` - 'btoa' not defined (use Buffer or global)
- `MedicationManagementViewModel.ts` - 'crypto' not defined
- `SupabaseAuthProvider.ts` - 'crypto' not defined
- `AcceptInvitationPage.tsx` - 'confirm' not defined
- Fix: Import from appropriate sources or use globalThis

### 1.3 Lexical Declarations in Case Blocks
- `useKeyboardNavigation.ts` - Multiple case block issues
- `FocusTrappedCheckboxGroup.tsx` - Case block issues
- `EnhancedFocusTrappedCheckboxGroup.tsx` - Case block issues
- Fix: Wrap case blocks in braces `case 'x': { const y = ...; break; }`

### 1.4 Type Redeclarations
- `types/generated/events.ts` - 'Address' already defined
- Fix: Remove duplicate type or rename

### 1.5 Unnecessary Catch / Function Types
- `searchable-dropdown.tsx` - Unnecessary catch clause
- `scripts/plugins/base.ts` - Function type too broad
- Fix: Remove catch or rethrow properly; use specific function signature

## Phase 2: Source Code Warnings (~80 warnings)

### 2.1 Unused Variables/Imports
Most common issue - prefix with `_` or remove:
- Unused imports in components
- Unused function parameters
- Unused destructured variables

### 2.2 React Hook Dependencies
- Missing dependencies in useEffect arrays
- Fix: Add missing deps or use eslint-disable with justification

### 2.3 Prefer-const Violations
- Variables that should be const
- Fix: Change let to const

## Phase 3: E2E Test Warnings (~60 warnings)

### 3.1 Unused Imports
- Many test files import `expect` but don't use it
- Fix: Remove unused imports

### 3.2 Unused Variables in Tests
- Test-specific variables declared but not used
- Fix: Remove or prefix with `_`

## Phase 4: Scripts Warnings (~30 warnings)

### 4.1 Script-specific Issues
- Documentation scripts
- CLI commands
- Config managers
- Fix: Apply same patterns as source code

## Success Metrics

### Immediate
- [ ] All 24 errors resolved
- [ ] Typecheck still passing
- [ ] Build still succeeds

### Medium-Term
- [ ] All 174 warnings resolved
- [ ] `npm run lint` exits with code 0
- [ ] CI pipeline passes lint check

### Long-Term
- [ ] Zero-warning policy enforced in CI
- [ ] Pre-commit hooks prevent new issues

## Implementation Schedule

| Phase | Files | Est. Issues |
|-------|-------|-------------|
| Phase 1 | ~15 | 24 errors |
| Phase 2 | ~40 | ~80 warnings |
| Phase 3 | ~20 | ~60 warnings |
| Phase 4 | ~10 | ~30 warnings |

## Risk Mitigation

1. **Breaking Changes**: Run typecheck after each phase
2. **Test Failures**: Run test suite after modifying test files
3. **Batch Commits**: Commit after each sub-phase for easy rollback

## Next Steps After Completion

1. Add lint check to CI pipeline with `--max-warnings 0`
2. Consider adding pre-commit hook for lint
3. Document any intentional eslint-disable comments
