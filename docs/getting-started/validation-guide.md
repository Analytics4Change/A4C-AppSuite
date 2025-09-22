# Documentation Validation Guide

This guide helps developers run documentation validation locally and understand how to fix common issues.

## Quick Start

### Run All Validations

```bash
npm run docs:check
```

### Run Specific Validations

```bash
# Check code-documentation alignment only (fast)
npm run docs:check:quick

# Validate documentation structure
npm run docs:validate

# Lint markdown files
npm run docs:lint

# Auto-fix markdown issues
npm run docs:fix

# Generate metrics dashboard
npm run docs:generate-metrics
```

## Understanding Validation Results

### Code-Documentation Alignment

**Green (✅)**: All documentation is aligned with code
**Yellow (⚠️)**: Minor alignment issues found
**Red (❌)**: Critical alignment issues that need fixing

#### Common Issues and Fixes

**🔴 High Priority Issues**

- **Missing API endpoint documentation**: Add API method documentation to `docs/api/` files
- **Outdated API signatures**: Update function signatures in API documentation
- **Removed APIs still documented**: Remove deprecated API documentation

**🟡 Low Priority Issues**

- **Missing type definitions**: Add type/interface documentation to `docs/api/types.md`
- **Incomplete type descriptions**: Add meaningful descriptions for complex types
- **Missing ViewModel documentation**: Add ViewModel documentation to `docs/architecture/viewmodels.md`

**Component Documentation (Simplified Approach)**

- **Props are documented inline**: Use JSDoc comments directly in component files
- **Example**: `// Dropdown options to display to the user`
- **No external prop documentation required**: Props no longer validated against external docs

**🔵 Low Priority Issues**

- **Style improvements**: Minor formatting or clarity improvements
- **Additional examples**: Consider adding usage examples
- **Missing JSDoc comments**: Add inline code documentation

#### Critical Requirement: Exact Interface Matching

**The validation system requires EXACT matching between TypeScript interfaces and documentation.**

This means:

- **Every prop** in the TypeScript interface must be documented
- **Optional props** must be marked with `?` in documentation exactly as in code
- **Prop types** must match exactly (string, boolean, number, complex types)
- **No extra props** documented that don't exist in the interface
- **No missing props** from the interface

**Example of EXACT matching required:**

TypeScript Interface:

```typescript
interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  onClick: () => void;
}
```

Documentation Must Match Exactly:

```typescript
interface ButtonProps {
  children: React.ReactNode;    // Content to display in button
  variant?: 'primary' | 'secondary' | 'ghost';  // Button styling variant
  disabled?: boolean;           // Whether button is disabled
  onClick: () => void;          // Click handler function
}
```

**Common Matching Errors:**

- Missing optional `?` markers
- Extra props not in interface
- Different type definitions
- Missing required props
- Incorrect prop names or casing

### Structure Validation

Ensures required documentation files exist:

- `docs/architecture/overview.md`
- `docs/getting-started/installation.md`
- Component documentation coverage

### Coverage Metrics

- **90%+ (✅ Excellent)**: Great documentation coverage
- **70-89% (⚠️ Good)**: Acceptable, room for improvement
- **50-69% (❌ Needs Improvement)**: Missing important documentation
- **<50% (🚫 Critical)**: Blocks PR merging

## Fixing Common Issues

### 1. Component Not Documented

**Issue**: `Missing documentation for component: Button`

**Fix**: Add component to `docs/components.md`:

```markdown
### Button Component (`src/components/ui/button.tsx`)

**Props**:
- `variant`: 'primary' | 'secondary' | 'ghost'
- `size`: 'sm' | 'md' | 'lg'
- `onClick`: () => void

**Usage**:
```tsx
<Button variant="primary" onClick={handleClick}>
  Submit
</Button>
```

**Accessibility**: Full keyboard support with ARIA labels

```

### 2. Outdated Function Signature

**Issue**: `Function signature changed: handleSubmit(data) → handleSubmit(data, options)`

**Fix**: Update documentation with new signature:
```markdown
```typescript
handleSubmit(data: FormData, options?: SubmitOptions): Promise<Result>
```

```

### 3. Missing Required Files

**Issue**: `Required documentation file missing: docs/architecture/overview.md`

**Fix**: Create the missing file with appropriate content structure.

### 4. Markdown Linting Errors

**Issue**: Various markdown formatting issues

**Fix**: 
```bash
# Auto-fix most issues
npm run docs:fix

# Check remaining issues
npm run docs:lint
```

## Integration with Development Workflow

### Pre-commit Validation

Add to your development routine:

```bash
# Before committing
npm run docs:check:quick

# If issues found, fix them
npm run docs:fix

# Verify fixes
npm run docs:check:quick
```

### VS Code Integration

**Recommended Extensions**:

- **markdownlint**: Real-time markdown validation
- **Markdown All in One**: Enhanced markdown editing
- **Code Spell Checker**: Catch typos in documentation

### CI/CD Integration

The validation runs automatically on:

- **Pull Requests**: Blocks merge if critical issues found
- **Weekly Schedule**: Creates issues for documentation debt

**Critical Issues (Block PR)**:

- Structure validation failures
- High-priority alignment issues
- Component coverage below 50%

**Warning Issues (Allow PR)**:

- Medium/low priority alignment issues
- Component coverage 50-90%
- Markdown linting warnings

## Troubleshooting

### "Module not found" Errors

```bash
# Reinstall dependencies
npm install
```

### "Permission denied" Errors

```bash
# Fix script permissions
chmod +x scripts/documentation/*.cjs
```

### Validation Takes Too Long

```bash
# Run quick alignment check only
npm run docs:check:quick

# Skip full validation for urgent fixes
# (Issues will be caught in CI)
```

### False Positive Alignment Issues

If the validator reports incorrect issues:

1. Check if component/function actually exists in code
2. Verify file paths in error messages
3. Check for typos in component/function names
4. Report persistent false positives as issues

### Interface Extraction and Documentation

To fix prop documentation issues:

#### Step 1: Extract TypeScript Interface

```bash
# Find the component file
find src -name "ComponentName.tsx" -type f

# Look for the Props interface in the file
grep -A 20 "interface.*Props" src/path/to/ComponentName.tsx
```

#### Step 2: Copy Exact Interface to Documentation

- Copy the interface definition exactly as written in code
- Add meaningful comments for each prop
- Preserve all optional `?` markers
- Keep exact type definitions

#### Step 3: Verify Exact Matching

```bash
# Run validation to check for remaining issues
npm run docs:check:quick

# Look for specific component in results
npm run docs:check:quick | grep "ComponentName"
```

#### Common Interface Extraction Patterns

**React Component Props:**

```typescript
// Look for patterns like:
interface ComponentNameProps {
  // or
type ComponentNameProps = {
  // or  
const ComponentName: React.FC<{
```

**MobX ViewModel Properties:**

```typescript
// Look for observable properties:
@observable
someProperty: string;

// Action methods:
@action
someMethod(param: Type): ReturnType
```

**Type Definitions:**

```typescript
// Look for type exports:
export interface SomeType {
export type SomeType = {
```

## Best Practices

### Writing Component Documentation

1. **Always include props**: List all props with types
2. **Provide usage examples**: Show realistic usage
3. **Document accessibility**: Note keyboard support, ARIA usage
4. **Keep examples current**: Update when component changes

### Maintaining Documentation

1. **Update docs with code changes**: Don't let them drift apart
2. **Run validation locally**: Before pushing changes
3. **Review alignment reports**: Understand what changed
4. **Fix high-priority issues first**: Focus on critical problems

### Team Coordination

1. **Share validation results**: Include in code reviews
2. **Address warnings promptly**: Prevent accumulation of debt
3. **Document decisions**: When validation suggests changes you disagree with

## Getting Help

- **Validation errors**: Check this guide first
- **False positives**: Create an issue with details
- **Feature requests**: Suggest improvements to validation
- **Documentation standards**: See [CLAUDE.md](../../CLAUDE.md)

Remember: The validation system is designed to help maintain high-quality documentation that serves developers well. When in doubt, prioritize clarity and accuracy over perfect validation scores.
