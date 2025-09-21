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
- **Missing component documentation**: Create documentation in `docs/components.md`
- **Outdated API signatures**: Update function signatures in documentation
- **Removed components still documented**: Remove deprecated documentation

**🟡 Medium Priority Issues**
- **Updated component props**: Update prop descriptions
- **New optional parameters**: Add documentation for new parameters
- **Changed default values**: Update default value documentation

**🔵 Low Priority Issues**
- **Style improvements**: Minor formatting or clarity improvements
- **Additional examples**: Consider adding usage examples

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