# Development Guide

Comprehensive guide for developing the A4C-FrontEnd application across multiple environments and platforms.

## Development Setup

### Prerequisites

- **Node.js 18+** (preferably using nvm)
- **npm** package manager
- **Git** version control
- **Modern web browser** (Chrome, Firefox, Safari)

### Quick Start

```bash
# Clone repository
git clone https://github.com/lars-tice/A4C-FrontEnd.git
cd A4C-FrontEnd

# Install exact dependencies
npm ci

# Start development server
npm run dev
# Application runs at http://localhost:5173
```

### Available Commands

```bash
# Development
npm run dev              # Start development server
npm run dev -- --port 3000  # Custom port

# Building
npm run build           # TypeScript check + production build
npm run preview         # Preview production build

# Code Quality
npm run typecheck       # TypeScript compiler checks
npm run lint           # ESLint code linting
npm run prepare        # Install Husky git hooks

# Testing
npm run test:e2e       # End-to-end tests with Playwright
npm run test:e2e:ui    # Tests with UI interface
npm run test:e2e:headed # Tests in headed mode

# Dependency Management
npm run knip           # Find unused dependencies
npm run knip:fix       # Auto-fix unused dependencies
npm run knip:production # Production-only analysis
```

## Cross-Platform Development

### Supported Environments

- **Ubuntu 24.04** with Firefox
- **macOS** with Safari  
- **Windows** with Chrome/Edge

### File Synchronization

**What IS tracked (committed to Git)**:
- Source code (`/src/**/*`)
- Configuration files (`package.json`, `vite.config.ts`, `tsconfig.json`)
- Documentation (`*.md`)
- Tests (`*.test.ts`, `*.spec.ts`)
- Public assets (`/public/**/*`)

**What is NOT tracked (in .gitignore)**:
- Dependencies (`node_modules/`)
- Build output (`dist/`, `build/`)
- Cache files (`.vite/`, `.cache/`)
- Test results (`test-results/`, `playwright-report/`)
- Local configs (`.env.local`)
- IDE settings (`.vscode/settings.json`)

### Environment Switching Workflow

```bash
# When switching between environments
git pull origin main
npm ci                  # Install exact dependencies
rm -rf .vite           # Clear Vite cache
npm run dev            # Start development
```

### Git Configuration

```bash
# Configure line endings (Ubuntu/macOS)
git config --global core.autocrlf input

# Ignore file permission changes
git config core.filemode false

# Set up global gitignore
touch ~/.gitignore_global
git config --global core.excludesfile ~/.gitignore_global
```

**Global .gitignore patterns**:
```gitignore
# macOS
.DS_Store
.AppleDouble

# Linux  
*~
.Trash-*

# IDEs
.vscode/
.idea/
*.swp
```

## Architecture Patterns

### MVVM Pattern

**ViewModels** (MobX) handle business logic, **Views** (React) handle presentation:

```typescript
// ✅ CORRECT: Pass observables directly
<CategorySelection 
  selectedClasses={vm.selectedTherapeuticClasses} 
/>

// ❌ INCORRECT: Spreading breaks reactivity
<CategorySelection 
  selectedClasses={[...vm.selectedTherapeuticClasses]} 
/>
```

### State Management with MobX

**Critical Rules**:
- Always wrap components with `observer` HOC
- Never spread observable arrays in props
- Use immutable updates in ViewModels
- Use `runInAction` for multiple state updates

```typescript
import { observer } from 'mobx-react-lite';
import { runInAction } from 'mobx';

// Component must be wrapped with observer
const MyComponent = observer(() => {
  // Component implementation
});

// ViewModel updates
runInAction(() => {
  this.selectedItems = [...this.selectedItems, newItem];
});
```

### Component Patterns

**When to Use Each Component**:

- **SearchableDropdown**: Large datasets (100+ items) with real-time search
- **EditableDropdown**: Small/medium datasets that can be edited after selection  
- **MultiSelectDropdown**: Multiple item selection with checkboxes
- **EnhancedAutocompleteDropdown**: Type-ahead with unified highlighting

### Timing Abstractions

All timing delays centralized in `/src/config/timings.ts`:

```typescript
// ✅ USE centralized timing
import { TIMINGS } from '@/config/timings';
import { useDropdownBlur } from '@/hooks/useDropdownBlur';

const handleBlur = useDropdownBlur(setShow);

// ❌ AVOID raw setTimeout
setTimeout(() => setShow(false), 200);
```

**Custom timing hooks**:
- `useDropdownBlur` - Dropdown blur delays
- `useScrollToElement` - Scroll animations
- `useDebounce` - Input debouncing
- `useSearchDebounce` - Search-specific debouncing

## Code Quality Standards

### TypeScript Guidelines

- **Strict mode enabled** - avoid `any` types
- **Interface definitions** for all props and complex data
- **Type inference** where possible, explicit types where necessary

### File Organization

- **File size limit**: ~300 lines maximum
- **Component splitting**: Break large forms into focused subcomponents
- **Composition pattern**: Use component composition over prop drilling
- **Separation of concerns**: Business logic separate from presentation

### Accessibility Requirements

**WCAG 2.1 Level AA Compliance**:
- All interactive elements keyboard accessible
- ARIA labels for all form controls
- Focus management with proper tab order
- Screen reader compatibility
- Color contrast ratios: 4.5:1 normal text, 3:1 large text

**Required ARIA attributes**:
```typescript
// Form controls
<input
  aria-label="Medication name"
  aria-required="true"
  aria-invalid={hasError}
  aria-describedby="help-text"
/>

// Modal dialogs  
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="modal-title"
>
```

**Focus management**:
```typescript
// ✅ USE React lifecycle for focus
useEffect(() => {
  if (condition) {
    elementRef.current?.focus();
  }
}, [condition]);

// ❌ AVOID setTimeout for focus
setTimeout(() => element.focus(), 100);
```

## Testing Strategy

### E2E Testing with Playwright

**Test Structure** - 172 test cases across 9 categories:
1. Functional Testing (TC001-TC067)
2. UI/UX Testing (TC068-TC084)  
3. Cross-Browser Testing (TC085-TC094)
4. Mobile Responsive Testing (TC095-TC109)
5. Accessibility Testing (TC110-TC126)
6. Performance Testing (TC127-TC138)
7. Edge Cases Testing (TC139-TC155)
8. Integration Testing (TC156-TC165)
9. Security Testing (TC166-TC172)

**Testing patterns**:
```typescript
// Use data-modal-id for stable selectors
await page.locator('[data-modal-id="add-new-prescribed-medication"]').click();

// Helper class pattern for reusable operations
class MedicationEntryHelper {
  async selectClient(clientId = 'CLIENT001') {
    await this.page.click(`[data-testid="client-${clientId}"]`);
  }
}
```

### Accessibility Testing

Built-in accessibility validation with `@axe-core/playwright`:

```typescript
test('Accessibility compliance', async ({ page }) => {
  await helper.openMedicationModal();
  
  // Automated accessibility scan
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  
  // Manual keyboard testing
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
});
```

## Debugging and Diagnostics

### Debug Control Panel

Press `Ctrl+Shift+D` to access debug controls:

- **MobX Monitor** (`Ctrl+Shift+M`): Visualize reactive state
- **Performance Monitor** (`Ctrl+Shift+P`): Track rendering metrics  
- **Log Overlay**: Display console logs in UI
- **Network Monitor**: Track API calls

### MobX Debugging

**Enable MobX debugging** in `/src/config/mobx.config.ts`:

```typescript
// Check for common reactivity issues:
// 1. Component wrapped with observer?
// 2. Array spreading breaking observable chain?
// 3. Immutable updates in ViewModels?
// 4. Parent components also wrapped with observer?
```

### Logging System

Zero-overhead logging with environment configuration:

```typescript
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');
log.debug('Debug information', { data });
log.info('Important information');
log.warn('Warning message');
log.error('Error occurred', error);
```

## Common Issues and Solutions

### Problem: Components not re-rendering with MobX

**Diagnosis**:
1. Enable MobX debugging
2. Check observer wrapping
3. Look for array spreading
4. Verify immutable updates

### Problem: Files appear modified after git pull

**Solutions**:
```bash
# Line ending differences
git rm --cached -r .
git reset --hard

# Missing .gitignore entries
echo "node_modules/" >> .gitignore
echo ".vite/" >> .gitignore

# File permission changes (Linux/macOS)
git config core.filemode false
```

### Problem: Different package-lock.json across environments

**Solution**: Always use `npm ci` instead of `npm install`

### Problem: Tests pass in one environment, fail in another

**Solutions**:
- Ensure same Node.js version (use `.nvmrc`)
- Clear caches: `rm -rf .vite node_modules && npm ci`
- Check for OS-specific code dependencies

## Performance Optimization

### Component Optimization
- Use `React.memo` for expensive renders
- Implement proper `useMemo` and `useCallback`
- Minimize re-renders with proper dependency arrays

### Bundle Optimization  
- Tree-shaking enabled by default
- Code splitting for large features
- Dynamic imports for heavy dependencies

### Timing Optimization
- All delays configurable via `/src/config/timings.ts`
- Zero delays in test environment
- Debounced inputs prevent excessive API calls

## Environment Variables

Use `.env.local` for local development:

```bash
# .env.local (not committed)
VITE_API_URL=http://localhost:3000
VITE_DEBUG_MODE=true

# .env.example (committed as template)  
VITE_API_URL=your_api_url_here
VITE_DEBUG_MODE=false
```

## Node Version Management

```bash
# Create .nvmrc for consistent Node versions
echo "20.11.0" > .nvmrc

# Use specified version
nvm use

# Install nvm if needed
# Ubuntu: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
# macOS: brew install nvm
```

## Troubleshooting Checklist

When encountering issues:

- [ ] Run `npm ci` for correct dependencies
- [ ] Clear cache: `rm -rf .vite`  
- [ ] Check Node version: `node --version`
- [ ] Verify git config: `git config --list | grep autocrlf`
- [ ] Check uncommitted changes: `git status`
- [ ] Review file permissions and line endings
- [ ] Test in different browser/environment

## Platform-Specific Notes

### Ubuntu 24.04 + Firefox
- File watching works well with default settings
- May need to increase watchers limit:
  ```bash
  echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
  sudo sysctl -p
  ```

### macOS + Safari  
- File watching may be slower on some versions
- Enable Safari Developer menu: Safari → Preferences → Advanced → Show Develop menu
- Consider Chrome/Firefox for better React DevTools support