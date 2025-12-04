# Context: Frontend Lint and Typecheck Cleanup

## Decision Record

**Date**: 2025-12-04
**Feature**: Frontend Lint Cleanup
**Goal**: Resolve all 198 lint issues (24 errors, 174 warnings) to achieve zero-warning builds.
**Status**: ✅ COMPLETE

### Key Decisions
1. **Priority Order**: Fix errors first (24), then warnings (174) - errors block CI, warnings are noise
2. **Phased Approach**: Group by issue type and location (src/, e2e/, scripts/) for systematic cleanup
3. **Preserve Behavior**: Fixes should not change runtime behavior - only code quality improvements
4. **No Auto-fix for Errors**: Manual review required for errors to avoid introducing bugs
5. **eslint-disable for Intentional Patterns**: Added comments with explanations for legitimate cases - Added 2025-12-04
6. **useMemo for Object Dependencies**: Wrapped object constructions that were causing hook dependency changes - Added 2025-12-04

## Technical Context

### Architecture
This is a codebase-wide cleanup affecting:
- Source code (`src/`) - Production code
- E2E tests (`e2e/`) - Playwright test files
- Scripts (`scripts/`) - Build and documentation tooling
- Unit tests (`tests/`) - Vitest test files

### Issue Categories

#### Errors (24 total) - ALL FIXED
| Category | Count | Files |
|----------|-------|-------|
| React Hooks Rules | 2 | ImpersonationBanner, ImpersonationModal |
| Undefined Globals | 5 | DevAuthProvider, SupabaseAuthProvider, MedicationManagementViewModel, AcceptInvitationPage |
| Case Block Declarations | 14 | useKeyboardNavigation, FocusTrappedCheckboxGroup variants |
| Type Redeclaration | 1 | types/generated/events.ts |
| Unnecessary Catch | 1 | searchable-dropdown.tsx |
| Function Type | 1 | scripts/plugins/base.ts |

#### Warnings (174 total) - ALL FIXED
| Category | Count Fixed |
|----------|-------------|
| Unused Variables/Imports | ~120 |
| React Hook Dependencies | ~20 |
| Prefer-const | ~10 |
| react-refresh/only-export-components | 6 |
| Other | ~18 |

### Dependencies
- ESLint configuration: `.eslintrc.cjs`
- TypeScript: `tsconfig.json`
- Affected files: ~97 across the codebase

## File Structure

### Files Modified (97 total)
Major categories of changes:

#### Source Code (~65 files)
- `src/components/auth/ImpersonationBanner.tsx` - Hooks order fix
- `src/components/auth/ImpersonationModal.tsx` - Hooks order fix, catch block fix
- `src/services/auth/DevAuthProvider.ts` - Unused param prefix
- `src/services/auth/SupabaseAuthProvider.ts` - Removed unused imports, fixed unused vars
- `src/hooks/useDropdownHighlighting.ts` - Reordered reset definition to fix circular dependency
- `src/hooks/useEnterAsTab.ts` - Removed unnecessary ref dependency
- `src/hooks/useKeyboardNavigation.ts` - Removed ref.current from deps array
- `src/components/ui/FocusTrappedCheckboxGroup/EnhancedFocusTrappedCheckboxGroup.tsx` - useMemo for defaultSummaryStrategy
- `src/contexts/AuthContext.tsx` - eslint-disable for hook export pattern
- `src/contexts/DiagnosticsContext.tsx` - eslint-disable for hook export pattern
- `src/contexts/FocusBehaviorContext.tsx` - eslint-disable for hook export patterns

#### E2E Tests (~20 files)
- Fixed unused variables (prefixed with _)
- Removed unused imports
- Changed let to const where appropriate

#### Scripts (~12 files)
- Fixed unused imports in documentation scripts
- Fixed unused parameters in CLI commands
- Fixed plugin base class parameters

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

### eslint-disable for Intentional Patterns - Added 2025-12-04
```typescript
// For mount-only effects that intentionally don't re-run
// eslint-disable-next-line react-hooks/exhaustive-deps -- Mount-only effect for initial setup
}, []);

// For hooks exported with providers (standard context pattern)
// eslint-disable-next-line react-refresh/only-export-components -- Hook exported with provider is standard context pattern
export const useAuth = () => { ... };

// For stable MobX viewmodels
// eslint-disable-next-line react-hooks/exhaustive-deps -- viewModel is a stable MobX store created in useMemo
}, [viewModel.formData, viewModel.isDirty]);
```

### Fixing Circular Hook Dependencies - Added 2025-12-04
```typescript
// Before (error - reset used before defined)
const handleSelect = useCallback(() => {
  reset(); // Error: reset not yet defined
}, [onSelect, reset]);

const reset = useCallback(() => { ... }, []);

// After (fixed - reorder definitions)
const reset = useCallback(() => { ... }, []);

const handleSelect = useCallback(() => {
  reset();
}, [onSelect, reset]);
```

## Important Constraints

1. **No Runtime Changes**: Fixes must not alter application behavior
2. **Typecheck Must Pass**: After each batch of fixes, verify `npm run typecheck`
3. **Tests Must Pass**: E2E test fixes should not break test execution
4. **Commit Frequently**: Small commits for easy rollback if issues arise

## Important Discoveries - Added 2025-12-04

1. **React Hook Dependency Arrays**: Refs (useRef) should not have their `.current` property in dependency arrays - refs are stable and their current property changes don't trigger re-renders

2. **Object Construction in Hooks**: Objects created inside components but used in useCallback dependencies cause the callback to be recreated every render - wrap in useMemo to stabilize

3. **Context Pattern Warning**: ESLint react-refresh rule warns when hooks are exported from the same file as components - this is intentional for context patterns and needs eslint-disable

4. **Circular Dependencies in Hooks**: When useCallback A depends on useCallback B, B must be defined first - order matters for hook definitions

## Reference Materials

- ESLint Rules: https://eslint.org/docs/rules/
- TypeScript ESLint: https://typescript-eslint.io/rules/
- React Hooks Rules: https://react.dev/reference/rules/rules-of-hooks

## Final Results

- **Initial Issues**: 198 (24 errors + 174 warnings)
- **Final Issues**: 0
- **Files Modified**: 97
- **Commit**: `81a2a4a7`
- **CI Status**: ✅ All workflows passed
- **Deployment**: ✅ Successfully deployed to production
