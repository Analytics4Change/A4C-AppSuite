# Context: Frontend Lint and Typecheck Cleanup

## Decision Record

**Date**: 2025-12-04
**Feature**: Frontend Lint Cleanup
**Goal**: Resolve all 198 lint issues (24 errors, 174 warnings) to achieve zero-warning builds.

### Key Decisions
1. **Priority Order**: Fix errors first (24), then warnings (174) - errors block CI, warnings are noise
2. **Phased Approach**: Group by issue type and location (src/, e2e/, scripts/) for systematic cleanup
3. **Preserve Behavior**: Fixes should not change runtime behavior - only code quality improvements
4. **No Auto-fix for Errors**: Manual review required for errors to avoid introducing bugs

## Technical Context

### Architecture
This is a codebase-wide cleanup affecting:
- Source code (`src/`) - Production code
- E2E tests (`e2e/`) - Playwright test files
- Scripts (`scripts/`) - Build and documentation tooling
- Unit tests (`tests/`) - Vitest test files

### Issue Categories

#### Errors (24 total)
| Category | Count | Files |
|----------|-------|-------|
| React Hooks Rules | 2 | ImpersonationBanner, ImpersonationModal |
| Undefined Globals | 5 | DevAuthProvider, SupabaseAuthProvider, MedicationManagementViewModel, AcceptInvitationPage |
| Case Block Declarations | 14 | useKeyboardNavigation, FocusTrappedCheckboxGroup variants |
| Type Redeclaration | 1 | types/generated/events.ts |
| Unnecessary Catch | 1 | searchable-dropdown.tsx |
| Function Type | 1 | scripts/plugins/base.ts |

#### Warnings (174 total)
| Category | Est. Count |
|----------|------------|
| Unused Variables/Imports | ~120 |
| React Hook Dependencies | ~20 |
| Prefer-const | ~10 |
| Other | ~24 |

### Dependencies
- ESLint configuration: `.eslintrc.cjs`
- TypeScript: `tsconfig.json`
- Affected files: ~85 across the codebase

## File Structure

### Critical Files with Errors
- `src/components/auth/ImpersonationBanner.tsx` - React hooks rule violation
- `src/components/auth/ImpersonationModal.tsx` - React hooks rule violation
- `src/services/auth/DevAuthProvider.ts` - 'btoa' undefined
- `src/services/auth/SupabaseAuthProvider.ts` - 'crypto' undefined
- `src/viewModels/medication/MedicationManagementViewModel.ts` - 'crypto' undefined
- `src/pages/organizations/AcceptInvitationPage.tsx` - 'confirm' undefined
- `src/hooks/useKeyboardNavigation.ts` - Case block declarations
- `src/components/ui/FocusTrappedCheckboxGroup/*.tsx` - Case block declarations
- `src/types/generated/events.ts` - Type redeclaration
- `src/components/ui/searchable-dropdown.tsx` - Unnecessary catch
- `scripts/plugins/base.ts` - Function type too broad

### Files with Most Warnings
- E2E test files (~20 files with unused imports)
- `src/pages/organizations/OrganizationCreatePage.tsx` - Unused imports, hook deps
- Various ViewModel files - Unused imports

## Key Patterns and Conventions

### Fixing Unused Variables
```typescript
// Option 1: Remove if truly unused
// Option 2: Prefix with underscore
const _unusedVar = something;
function fn(_unusedParam: string) { }
```

### Fixing Case Block Declarations
```typescript
// Before (error)
case 'value':
  const x = 1;
  break;

// After (fixed)
case 'value': {
  const x = 1;
  break;
}
```

### Fixing React Hooks Rules
```typescript
// Before (error - hook after early return)
if (condition) return null;
useEffect(() => { }, []);

// After (fixed - hooks before returns)
useEffect(() => { }, []);
if (condition) return null;
```

### Fixing Undefined Globals
```typescript
// For 'btoa' in Node environment
const btoa = (str: string) => Buffer.from(str).toString('base64');
// Or: import { btoa } from 'buffer';

// For 'crypto' in browser
// Already available globally, add to eslint globals or use globalThis.crypto

// For 'confirm' (browser dialog)
// Use window.confirm or add to eslint browser globals
```

## Important Constraints

1. **No Runtime Changes**: Fixes must not alter application behavior
2. **Typecheck Must Pass**: After each batch of fixes, verify `npm run typecheck`
3. **Tests Must Pass**: E2E test fixes should not break test execution
4. **Commit Frequently**: Small commits for easy rollback if issues arise

## Reference Materials

- ESLint Rules: https://eslint.org/docs/rules/
- TypeScript ESLint: https://typescript-eslint.io/rules/
- React Hooks Rules: https://react.dev/reference/rules/rules-of-hooks

## Why This Approach?

### Chosen: Phased cleanup by error type
- **Pro**: Systematic and trackable progress
- **Pro**: Errors first ensures CI can pass sooner
- **Pro**: Grouping similar issues makes fixes consistent

### Rejected: Auto-fix everything
- `--fix` can introduce subtle bugs
- Some fixes need human judgment (unused vars might be intentional)
- Generated files need special handling
