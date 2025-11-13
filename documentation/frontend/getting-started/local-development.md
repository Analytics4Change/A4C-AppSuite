---
status: current
last_updated: 2025-11-13
---

# Local Development Guide

This guide covers local development workflows, debugging, and best practices for the A4C-FrontEnd application.

## Prerequisites

Before starting development, complete the [Installation Guide](./installation.md) to set up your environment.

## Development Workflow

### Starting the Development Server

```bash
cd frontend
npm run dev
```

The application will be available at `http://localhost:5173` with:
- Hot module replacement (HMR) for instant updates
- Development logging enabled
- Mock authentication by default

### Development Modes

The frontend supports three authentication modes for different development needs:

#### 1. Mock Mode (Default)

```bash
npm run dev
```

- Instant authentication without network calls
- Predefined user profiles (super_admin, provider_admin, clinician)
- Complete JWT claims structure for testing
- **Use for**: UI development, component testing

#### 2. Integration Mode

```bash
npm run dev:auth
# or
npm run dev:integration
```

- Real OAuth flows with Google/GitHub
- Real JWT tokens from Supabase development project
- Custom claims from database hooks
- **Use for**: Testing authentication flows, RLS policies

#### 3. Production Mode

Automatically selected in production builds (`npm run build`).

See [Frontend Auth Architecture](../../architecture/authentication/frontend-auth-architecture.md) for complete details.

## Code Quality Checks

### Type Checking

```bash
npm run typecheck
```

Runs TypeScript compiler in check mode (no output files).

### Linting

```bash
npm run lint
```

Runs ESLint with project rules. Fix auto-fixable issues:

```bash
npm run lint -- --fix
```

### Building

```bash
npm run build
```

Creates production build in `dist/`. Always run before committing significant changes.

## Testing

### Unit Tests

```bash
npm run test
```

Runs Vitest unit tests with coverage.

### End-to-End Tests

```bash
# Headless mode
npm run test:e2e

# Interactive UI mode
npm run test:e2e:ui

# Debug mode
npm run test:e2e:debug
```

See [Testing Guide](../testing/TESTING.md) for comprehensive testing strategies.

## Documentation

### Validating Documentation

**REQUIRED before committing**:

```bash
npm run docs:check
```

This validates:
- Documentation structure and format
- Props interfaces match TypeScript
- Component coverage (must be 100%)
- Documentation alignment with source code

### Documentation Standards

All components, ViewModels, and types **must** be documented:

- Use templates from `../documentation/templates/`
- Exact TypeScript interface matching required
- Include usage examples and accessibility details
- Run `npm run docs:check` before submitting PRs

See [Validation Guide](./validation-guide.md) for details.

## Debugging

### MobX State Debugging

Enable MobX monitor during development:

1. Press `Ctrl+Shift+D` to open debug control panel
2. Press `Ctrl+Shift+M` to toggle MobX monitor
3. View observable state in real-time overlay

Or set environment variable:

```bash
VITE_DEBUG_MOBX=true npm run dev
```

### Performance Monitoring

```bash
VITE_DEBUG_PERFORMANCE=true npm run dev
```

Then press `Ctrl+Shift+P` to toggle performance monitor.

### Browser DevTools

Install recommended extensions:
- **React Developer Tools**: Component tree inspection
- **MobX Developer Tools**: State management debugging

## Common Development Tasks

### Creating a New Component

1. Create component file in appropriate directory:
   - UI components: `src/components/ui/`
   - Feature components: `src/components/[feature]/`
   - Page components: `src/pages/[feature]/`

2. Follow accessibility requirements:
   - WCAG 2.1 Level AA compliance
   - Complete keyboard navigation
   - Proper ARIA attributes

3. Create documentation:
   - Use template: `../documentation/templates/component-template.md`
   - Document in: `../documentation/frontend/reference/components/`

4. Run validation:
   ```bash
   npm run docs:check
   ```

### Adding a New ViewModel

1. Create ViewModel in `src/viewModels/[feature]/`

2. Follow MobX patterns:
   - Mark observables with `@observable`
   - Mark actions with `@action`
   - Use `runInAction` for async updates
   - Replace arrays, don't mutate

3. Wrap components with `observer`:
   ```typescript
   import { observer } from 'mobx-react-lite';

   export const MyComponent = observer(() => {
     // Component code
   });
   ```

4. Document the ViewModel (required)

### Working with Services

Services use interface-based dependency injection:

```typescript
// ✅ GOOD - Uses abstraction
import { getAuthProvider } from '@/services/auth/AuthProviderFactory';
const auth = getAuthProvider();

// ❌ BAD - Direct dependency
import { SupabaseAuthProvider } from './SupabaseAuthProvider';
```

See [Frontend Architecture](../architecture/README.md) for patterns.

## Environment Variables

### Development (.env.development)

```env
VITE_APP_MODE=mock
VITE_DEBUG_MOBX=false
VITE_DEBUG_PERFORMANCE=false
```

### Integration Testing (.env.development.integration)

```env
VITE_APP_MODE=production
VITE_SUPABASE_URL=https://your-dev-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-dev-anon-key
```

### Production (.env.production)

```env
VITE_APP_MODE=production
VITE_SUPABASE_URL=https://your-prod-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-prod-anon-key
```

## Performance Optimization

### Timing Configuration

All timing delays are centralized in `/src/config/timings.ts`:

- Automatically set to 0ms in test environment
- Use custom hooks for consistent behavior:
  - `useDropdownBlur` - Dropdown blur delays
  - `useScrollToElement` - Scroll animations
  - `useDebounce` - Value debouncing
  - `useSearchDebounce` - Search-specific debouncing

### MobX Reactivity Best Practices

**Critical Rules**:

1. Always wrap components with `observer`
2. Never spread observable arrays in props
3. Use immutable updates (replacement, not mutation)
4. Use `runInAction` for multiple state updates

**Example**:

```typescript
// ❌ BAD - Breaks reactivity
<Component items={[...observableArray]} />

// ✅ GOOD - Maintains observable chain
<Component items={observableArray} />

// ❌ BAD - Direct mutation
this.items.push(newItem);

// ✅ GOOD - Immutable update
runInAction(() => {
  this.items = [...this.items, newItem];
});
```

## Git Workflow

### Before Committing

1. **Run all checks**:
   ```bash
   npm run typecheck
   npm run lint
   npm run docs:check
   npm run build
   ```

2. **Test your changes**:
   ```bash
   npm run test
   npm run test:e2e
   ```

3. **Stage and commit**:
   ```bash
   git add .
   git commit -m "feat: your change description"
   ```

### Commit Message Format

Follow conventional commits:

```
feat: add new medication search filter
fix: resolve dropdown keyboard navigation
docs: update PhoneInput component documentation
test: add E2E tests for client creation
refactor: simplify authentication provider logic
```

## Troubleshooting

### HMR Not Working

1. Check Vite server is running
2. Clear browser cache
3. Restart development server

### Type Errors After Update

```bash
rm -rf node_modules package-lock.json
npm install
npm run typecheck
```

### Documentation Validation Failing

```bash
npm run docs:check
```

Review errors and ensure:
- All components are documented
- Props interfaces match exactly
- Required sections are present

### MobX Not Reacting

1. Ensure component wrapped with `observer`
2. Check no array spreading in props
3. Verify state updates use immutable patterns
4. Enable MobX debugging: `Ctrl+Shift+M`

## Additional Resources

- [Installation Guide](./installation.md) - Initial setup
- [Validation Guide](./validation-guide.md) - Documentation validation
- [Testing Guide](../testing/TESTING.md) - Testing strategies
- [CLAUDE.md](../../CLAUDE.md) - Claude Code guidance
- [Frontend README](../README.md) - Architecture overview

## Getting Help

- Check existing documentation in `../documentation/frontend/`
- Review component examples in `src/components/`
- Consult architecture docs in `../documentation/architecture/`
- See `CLAUDE.md` for AI assistant guidance

Happy coding! 🚀
