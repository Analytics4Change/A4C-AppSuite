---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Development guidelines for the React/TypeScript frontend including authentication modes, MobX patterns, WCAG accessibility standards, and component architecture.

**When to read**:
- Starting frontend development work
- Working with authentication or JWT claims
- Implementing accessible components
- Debugging MobX reactivity issues
- Using dropdown/form components

**Prerequisites**: Basic React and TypeScript knowledge

**Key topics**: `react`, `typescript`, `mobx`, `accessibility`, `wcag`, `authentication`, `jwt-claims`, `components`, `vite`, `tailwind`

**Estimated read time**: 25 minutes (full), 5 minutes (relevant sections)
<!-- TL;DR-END -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A4C-FrontEnd is a React-based medication management application built with TypeScript and Vite. The application provides healthcare professionals with tools to manage client medications, including search, dosage configuration, and prescription tracking.

## Technology Stack

- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite
- **State Management**: MobX with mobx-react-lite
- **Styling**: Tailwind CSS with tailwindcss-animate
- **UI Components**: Radix UI primitives (@radix-ui)
- **Icons**: Lucide React
- **Testing**: Vitest (unit), Playwright (E2E)
- **Code Quality**: ESLint, TypeScript strict mode

## Available Commands

```bash
npm run dev        # Start development server (default port 5173)
npm run build      # TypeScript check + production build
npm run preview    # Preview production build
npm run typecheck  # Run TypeScript compiler checks
npm run lint       # Run ESLint
```

## Current Features

### Medication Management

- **Medication Search**: Real-time search with debouncing
- **Dosage Configuration**:
  - Form categories (Solid, Liquid, etc.)
  - Dosage amounts and units
  - Frequency and condition settings
  - Total amount tracking
- **Date Management**: Start and discontinue date selection with calendar
- **Category Selection**: Broad and specific medication categorization

### Client Management

- Client selection interface
- Client-specific medication tracking

### Form Infrastructure

- Complex multi-step forms with validation
- Accessible form controls with ARIA labels
- **Keyboard Navigation Standards**:
  - Full keyboard support required for all interactive elements
  - Tab/Shift+Tab for field navigation
  - Arrow keys for option selection in dropdowns
  - Space key to toggle checkboxes and radio buttons
  - Enter key to submit forms or accept selections
  - Escape key to cancel operations or close dropdowns
- Focus trapping in modals
- **Multi-Select Dropdown Pattern**:
  - Use unified `MultiSelectDropdown` component for consistency
  - Maintains focus context for keyboard navigation
  - Supports WCAG 2.1 Level AA compliance
  - Handles both keyboard and mouse interactions seamlessly

### Accessibility & WCAG Compliance

#### WCAG 2.1 Level AA Requirements

- **ALL interactive elements** must meet WCAG 2.1 Level AA standards
- Color contrast ratios: 4.5:1 for normal text, 3:1 for large text
- All functionality available via keyboard
- No keyboard traps (except intentional modal focus traps)
- Provide text alternatives for non-text content
- Make all functionality available from keyboard interface

#### Focus Management Standards

- **TabIndex Guidelines**:
  - **Prefer natural DOM order** (no explicit tabIndex) whenever possible
  - **Use tabIndex only when needed** to override natural order for UX reasons
  - **Sequential numbering**: When using explicit tabIndex, use sequential numbers (1, 2, 3...)
  - **Consistent patterns within components**:
    - tabIndex=0: Natural DOM order (default)
    - tabIndex=1,2,3...: Custom order for improved UX flow
    - tabIndex=-1: Programmatically focusable but not in tab sequence
  - **Component-level consistency**: Reset tabIndex sequence for each major section/modal
  - **Document complex sequences**: Add comments explaining tabIndex choices in complex forms

- **Focus Trapping**:
  - Modals MUST trap focus while open
  - First focusable element receives focus on open
  - Focus returns to trigger element on close
  - Implement circular tab navigation within trap
  - ESC key should close modal and return focus

- **Focus Restoration**:
  - Store reference to active element before modal/overlay
  - Restore focus to previous element on close
  - Use refs and useEffect, never setTimeout
  - Handle cases where trigger element is removed from DOM

#### ARIA Requirements

- **Required ARIA attributes for all components**:
  - `role` for non-semantic elements (dialog, navigation, main, etc.)
  - `aria-label` or `aria-labelledby` for ALL interactive elements
  - `aria-describedby` for additional help text or descriptions
  - `aria-expanded` for expandable elements (dropdowns, accordions)
  - `aria-selected` for selectable items in lists
  - `aria-disabled` for disabled states (not just disabled attribute)
  - `aria-live` for dynamic content updates
  - `aria-modal="true"` for modal dialogs
  - `aria-current` for current page/step indicators

- **Form Controls MUST include**:
  - `aria-required="true"` for required fields
  - `aria-invalid="true"` for fields with errors
  - `aria-errormessage` pointing to error message ID
  - `aria-describedby` for help text
  - Proper `<label>` association or `aria-label`

- **Modal/Dialog Requirements**:
  - `role="dialog"`
  - `aria-modal="true"`
  - `aria-labelledby` pointing to dialog title
  - `aria-describedby` for dialog description if present

#### Keyboard Navigation Requirements

- **Tab Order**:
  - Logical left-to-right, top-to-bottom flow
  - Header → Main Content → Sidebar → Footer
  - Within modals: Header → Content → Footer buttons
- **Focus Indicators**:
  - Visible focus rings on ALL interactive elements
  - High contrast focus indicators (not just browser default)
  - Focus indicator must meet color contrast requirements
- **Keyboard Shortcuts**:
  - Document all shortcuts in component comments
  - Avoid conflicts with browser/OS shortcuts
  - Provide alternative access methods
  - Common patterns:
    - ESC to close modals/dropdowns
    - Enter to submit/confirm
    - Space to toggle checkboxes/buttons
    - Arrow keys for navigation within components

#### Testing Requirements

- **Manual Testing**:
  - Test with keyboard only (unplug mouse)
  - Tab through entire application
  - Verify all functionality accessible via keyboard
  - Check focus indicators are always visible
- **Screen Reader Testing**:
  - Test with NVDA (Windows)
  - Test with VoiceOver (Mac)
  - Verify all content is announced properly
  - Check form labels and errors are announced
- **Automated Testing**:
  - Use axe DevTools for accessibility audits
  - Include `@axe-core/playwright` in E2E tests
  - Run accessibility tests in CI pipeline
  - Zero accessibility violations as merge requirement

## Project Structure

```
src/
├── components/       # Reusable UI components
│   ├── ui/          # Base UI components (button, input, dropdown, etc.)
│   │   ├── FocusTrappedCheckboxGroup/  # Complex checkbox group component
│   │   └── MultiSelectDropdown.tsx    # Unified multi-select component
│   ├── auth/        # Authentication components
│   ├── debug/       # Debug utilities (dev only)
│   ├── layouts/     # Layout components
│   └── medication/  # Medication-specific components
├── pages/           # Page-level routing components
│   ├── auth/        # Authentication pages
│   ├── clients/     # Client management pages
│   └── medications/ # Medication management pages
├── views/           # Feature-specific view components
│   ├── client/      # Client-related views
│   └── medication/  # Medication-related views
├── viewModels/      # MobX ViewModels for state management
│   ├── client/      # Client-related state management
│   └── medication/  # Medication-related state management
├── services/        # API interfaces and implementations
│   ├── api/         # API interfaces and implementations
│   ├── mock/        # Mock API implementations
│   ├── data/        # Data access services
│   ├── validation/  # Data validation utilities
│   ├── search/      # Search functionality
│   ├── http/        # HTTP client utilities
│   ├── adapters/    # External service adapters
│   └── cache/       # Caching implementations
├── contexts/        # React contexts and providers
├── hooks/           # Custom React hooks
├── config/          # Application configuration
│   ├── timings.ts   # Centralized timing configuration
│   ├── logging.config.ts # Logging system configuration
│   ├── mobx.config.ts    # MobX debugging configuration
│   └── oauth.config.ts   # Authentication configuration
├── data/            # Static data and configurations
├── mocks/           # Mock data for development
├── styles/          # CSS and styling files
├── constants/       # Application constants
├── types/           # TypeScript type definitions
│   └── models/      # Domain model types
├── utils/           # Utility functions
└── test/            # Test setup and utilities
```

## Development Guidelines

### Architecture Patterns

- **MVVM Pattern**: ViewModels (MobX) handle business logic, Views (React) handle presentation
- **Composition over Inheritance**: Use component composition for complex UIs
- **Interface-based Services**: All services implement interfaces for easy mocking/testing
- **Unified Component Pattern**: Create single, reusable components for similar functionality (e.g., MultiSelectDropdown for all multi-select needs)

### Service Session Management

> **⚠️ CRITICAL: Never Cache Sessions Manually**
>
> Supabase manages session state automatically after login. Services that manually cache sessions
> will fail silently when the cache is stale or never populated. This has caused critical bugs
> including empty data lists where all queries silently returned zero results.

**ALWAYS** retrieve sessions directly from Supabase's auth client in every service method that needs authentication context:

```typescript
// ✅ CORRECT: Retrieve session from Supabase client
async getUsersPaginated(): Promise<PaginatedResult<UserListItem>> {
  const client = supabaseService.getClient();

  // Get session directly from Supabase - it manages auth state automatically
  const { data: { session } } = await client.auth.getSession();
  if (!session) {
    log.error('No authenticated session');
    return { items: [], totalCount: 0 };
  }

  // Decode JWT to extract custom claims
  const claims = this.decodeJWT(session.access_token);
  if (!claims.org_id) {
    log.error('No organization context in JWT claims');
    return { items: [], totalCount: 0 };
  }

  // Use claims.org_id for RLS-compatible queries
}

// Helper method for JWT decoding
private decodeJWT(token: string): DecodedJWTClaims {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(globalThis.atob(payload));
  } catch {
    return {};
  }
}
```

**NEVER** use manual session caching or custom session storage:

```typescript
// ❌ WRONG: Manual session cache - this will FAIL SILENTLY
const session = supabaseService.getCurrentSession();  // Returns NULL!
if (!session?.claims.org_id) {
  return { items: [] };  // Silent failure - empty list returned
}
```

**Why manual caching fails:**
1. Custom session caches require explicit population (calling `updateSession()`)
2. If the cache is never populated, all service methods silently fail
3. Supabase already manages session state automatically - don't duplicate it
4. The Supabase client's `auth.getSession()` always returns the current valid session

**When you need JWT claims** (org_id, permissions, role, scope_path):
- Call `client.auth.getSession()` to get the session
- Decode the `access_token` to extract custom claims
- Use the same `decodeJWT()` pattern shown above

### CQRS Query Pattern

> **⚠️ CRITICAL: All Data Queries MUST Use RPC Functions**
>
> NEVER use direct table queries with PostgREST embedding across projection tables.
> This violates CQRS pattern and has caused critical bugs including 406 errors.

**ALWAYS** use `api.` schema RPC functions for data queries:

```typescript
// ✅ CORRECT: RPC function call (CQRS pattern)
const { data, error } = await client
  .schema('api')
  .rpc('list_users', {
    p_org_id: claims.org_id,
    p_status: statusFilter,
    p_search_term: searchTerm,
  });

// ✅ CORRECT: Other RPC examples
await client.schema('api').rpc('get_roles', { p_org_id: orgId });
await client.schema('api').rpc('get_organizations', {});
await client.schema('api').rpc('get_organization_units', { p_org_id: orgId });
```

**NEVER** use direct table queries with PostgREST embedding:

```typescript
// ❌ WRONG: Direct table query with embedding - VIOLATES CQRS
const { data } = await client
  .from('users')
  .select(`
    id, email, name,
    user_roles_projection!inner (
      role_id,
      roles_projection (id, name)
    )
  `)
  .eq('user_roles_projection.organization_id', orgId);
```

**Why RPC functions are required:**
1. Projections are denormalized read models - joins should happen at event processing time, not query time
2. PostgREST embedding across projections re-normalizes data, defeating CQRS benefits
3. RPC functions encapsulate query logic in the database (single source of truth, testable, versionable)
4. RPC functions can handle complex filtering, sorting, and pagination efficiently
5. Consistent pattern across all services for maintainability

**Services using this pattern:**
- `SupabaseUserQueryService` → `api.list_users()`
- `SupabaseRoleService` → `api.get_roles()`, `api.get_role_by_id()`
- `SupabaseOrganizationQueryService` → `api.get_organizations()`, `api.get_organization_by_id()`
- `SupabaseOrganizationUnitService` → `api.get_organization_units()`

### Authentication Architecture

**Status**: ✅ Supabase Auth with smart detection (Updated 2025-01-02)

The application uses **dependency injection** with smart environment detection to automatically determine the authentication mode.

#### Smart Detection

The authentication mode is automatically detected based on runtime conditions:

| Scenario | Credentials | Hostname | Result |
|----------|-------------|----------|--------|
| `npm run dev` | Present | localhost | Real auth, NO subdomain redirect |
| `npm run dev` | Missing | localhost | Mock auth, NO subdomain redirect |
| `npm run dev:mock` | Present | localhost | Mock auth (forced), NO subdomain redirect |
| Production build | Present | *.example.com | Real auth, subdomain redirect enabled |

#### Two Authentication Modes

1. **Mock Mode**
   - Instant authentication without network calls
   - Complete JWT claims structure for testing
   - Configurable user profiles (super_admin, provider_admin, etc.)
   - **Triggered by**: No Supabase credentials OR `VITE_FORCE_MOCK=true`
   - Use: `npm run dev` (without credentials) or `npm run dev:mock`

2. **Real Mode** (Supabase)
   - Real OAuth flows with Google/GitHub
   - Real JWT tokens from Supabase
   - Custom claims from database hooks
   - Enterprise SSO support (SAML 2.0)
   - **Triggered by**: Supabase credentials present (and not forcing mock)

#### Provider Interface Pattern

All authentication is accessed through the `IAuthProvider` interface:

```typescript
// ✅ GOOD - Uses abstraction
import { getAuthProvider } from '@/services/auth/AuthProviderFactory';
const auth = getAuthProvider();
const user = await auth.getUser();

// ❌ BAD - Direct dependency
import { SupabaseAuthProvider } from './SupabaseAuthProvider';
```

**Key Files**:
- `src/services/auth/IAuthProvider.ts` - Interface definition
- `src/services/auth/DevAuthProvider.ts` - Mock provider
- `src/services/auth/SupabaseAuthProvider.ts` - Real provider
- `src/services/auth/AuthProviderFactory.ts` - Provider selection
- `src/contexts/AuthContext.tsx` - React context wrapper
- `src/config/dev-auth.config.ts` - Mock user configuration

#### JWT Custom Claims

The application uses custom JWT claims for multi-tenant isolation and RBAC:

```typescript
interface JWTClaims {
  sub: string;              // User UUID
  email: string;
  org_id: string;          // Organization UUID (for RLS)
  user_role: UserRole;     // User's role
  permissions: string[];   // Permission strings
  scope_path: string;      // Hierarchical scope (ltree)
}
```

**Usage in Components**:

```typescript
import { useAuth } from '@/contexts/AuthContext';

const MyComponent = () => {
  const { session, hasPermission } = useAuth();

  // Access claims
  const orgId = session?.claims.org_id;
  const role = session?.claims.user_role;
  const permissions = session?.claims.permissions;

  // Check permission
  const canCreate = await hasPermission('medication.create');

  return (
    <div>
      <p>Organization: {orgId}</p>
      <p>Role: {role}</p>
    </div>
  );
};
```

#### Environment Configuration

Authentication mode is **automatically detected** - no `VITE_APP_MODE` needed:

```bash
# .env.local - Real auth (credentials present = real mode)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_BACKEND_API_URL=https://api-a4c.example.com

# Optional: Force mock mode even with credentials
# VITE_FORCE_MOCK=true
```

**Key behaviors:**
- Credentials present → Real Supabase auth
- Credentials missing → Mock auth
- Localhost → Subdomain routing disabled (stays on localhost:5173)
- Production hostname → Subdomain routing enabled

#### Testing with Authentication

**Unit Tests** (with mock auth):

```typescript
import { DevAuthProvider } from '@/services/auth/DevAuthProvider';
import { PREDEFINED_PROFILES } from '@/config/dev-auth.config';

const mockAuth = new DevAuthProvider({
  profile: PREDEFINED_PROFILES.provider_admin
});

render(
  <AuthProvider authProvider={mockAuth}>
    <MyComponent />
  </AuthProvider>
);
```

**E2E Tests** (mock mode):

```typescript
test('user can login with any credentials', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.fill('#email', 'test@example.com');
  await page.fill('#password', 'any-password');
  await page.click('button[type="submit"]');

  // Mock auth provides instant authentication
  await expect(page).toHaveURL(/\/clients/);
});
```

**For complete authentication architecture**: See `../documentation/architecture/authentication/frontend-auth-architecture.md`

### State Management with MobX

- Use MobX ViewModels for complex state logic
- Keep component state minimal and UI-focused
- **CRITICAL**: Always wrap components with `observer` HOC from mobx-react-lite for reactive components
- **Array Reactivity Rules**:
  - Never spread observable arrays in props: `<Component items={[...observableArray]} />` ❌
  - Pass observable arrays directly: `<Component items={observableArray} />` ✅
  - Use immutable updates in ViewModels: `this.array = [...this.array, item]` instead of `this.array.push(item)`
  - Always use `runInAction` for multiple state updates
- **Debugging MobX**: When reactivity issues occur, check:
  1. Component is wrapped with `observer`
  2. No array spreading breaking the observable chain
  3. State mutations are using replacement, not mutation
  4. Parent components in render chain are also wrapped with `observer`

### TypeScript Guidelines

- Strict mode is enabled - avoid `any` types
- Define interfaces for all props and complex data structures
- Use type inference where possible, explicit types where necessary

## Configuration Management

### Application Configuration

The application uses centralized configuration files for consistent behavior across environments:

#### API Configuration (`/src/config/medication-search.config.ts`)

- **API_CONFIG**: RXNorm API endpoints and request parameters
  - Base URL for RXNorm services
  - API keys and authentication settings
  - Rate limiting and retry configurations
  - Request timeout and cache settings

- **INDEXED_DB_CONFIG**: Local caching and storage configuration
  - Database name and version
  - Object store configurations
  - Cache retention policies
  - Storage quota management

#### Timing Configuration (`/src/config/timings.ts`)

- Centralized timing delays for consistent UX
- Automatic test environment optimization (0ms delays)
- Search debouncing delays
- Animation and transition timings

#### Environment Variables

```env
# API Configuration
VITE_RXNORM_API_URL=https://rxnav.nlm.nih.gov/REST
VITE_API_TIMEOUT=5000

# Backend API (required for workflow operations in production/integration modes)
# The Backend API runs inside k8s cluster and proxies requests to Temporal
VITE_BACKEND_API_URL=https://api-a4c.firstovertheline.com

# Cache Configuration
VITE_CACHE_TTL=3600000
VITE_CACHE_MAX_SIZE=50MB

# Debug Configuration
VITE_DEBUG_MOBX=false
VITE_DEBUG_PERFORMANCE=false
VITE_DEBUG_LOGS=false
```

## Search and Development Resources

- For code base searches use the serena mcp server
- For deep research use the exa mcp server
- For exact code syntax use the context7 mcp server
- For UI / UX testing use the playwright mcp server

## Logging and Diagnostics

### Configuration-Driven Logging System

The application uses a zero-overhead logging system that can be configured per environment:

#### Logger Usage

```typescript
import { Logger } from '@/utils/logger';

// Get a category-specific logger
const log = Logger.getLogger('viewmodel');

// Use appropriate log levels
log.debug('Detailed debug information', { data });
log.info('Important information');
log.warn('Warning message');
log.error('Error occurred', error);
```

#### Configuration (`/src/config/logging.config.ts`)

- **Development**: Full logging with all categories enabled
- **Test**: Minimal logging (errors only) for fast test execution
- **Production**: Disabled by default, console methods removed during build

#### Log Categories

- `main` - Application startup and lifecycle
- `mobx` - MobX state management and reactions
- `viewmodel` - ViewModel business logic
- `navigation` - Focus and keyboard navigation
- `component` - Component lifecycle and rendering
- `api` - API calls and responses
- `validation` - Form validation logic
- `diagnostics` - Debug tool controls

#### Output Targets

- `console` - Standard console output (preserves E2E test compatibility)
- `memory` - In-memory buffer for debugging
- `remote` - Placeholder for remote logging services
- `none` - No output (complete silence)

### Debug Diagnostics System

The application includes a comprehensive diagnostics system for development:

#### Debug Control Panel

- **Activation**: Press `Ctrl+Shift+D` to toggle the control panel
- **Features**:
  - Toggle individual debug monitors
  - Adjust position (4 corners)
  - Control opacity (30-100%)
  - Change font size (small/medium/large)
  - Persistent settings via localStorage

#### Available Debug Monitors

##### MobX State Monitor

- **Keyboard Shortcut**: `Ctrl+Shift+M`
- **Purpose**: Visualize MobX observable state in real-time
- **Shows**:
  - Component render count
  - Selected arrays and their contents
  - Last update timestamp
- **Usage**: Automatically appears when enabled via control panel

##### Performance Monitor

- **Keyboard Shortcut**: `Ctrl+Shift+P`
- **Purpose**: Track rendering performance and optimization opportunities
- **Metrics**: FPS, render time, memory usage

##### Log Overlay

- **Purpose**: Display console logs directly in the UI
- **Features**: Filter by category, search, clear buffer

##### Network Monitor

- **Purpose**: Track API calls and responses
- **Shows**: Request timing, payload size, status codes

#### Environment Variables for Initial State

```bash
# Enable specific monitors on startup
VITE_DEBUG_MOBX=true
VITE_DEBUG_PERFORMANCE=true
VITE_DEBUG_LOGS=true
```

#### DiagnosticsContext Usage

```typescript
import { useDiagnostics } from '@/contexts/DiagnosticsContext';

const MyComponent = () => {
  const { config, toggleMobXMonitor } = useDiagnostics();
  
  // Check if monitor is enabled
  if (config.enableMobXMonitor) {
    // Show debug information
  }
};
```

### Production Build Optimization

- All `console.*` statements automatically removed via Vite's esbuild
- Debug components tree-shaken when not imported
- Logger checks `import.meta.env.PROD` at initialization
- Zero runtime overhead when diagnostics disabled

### Testing Considerations

- Logger uses actual console methods to maintain E2E test compatibility
- All timing delays set to 0ms in test environment
- Debug monitors automatically disabled in tests
- Use `Logger.clearBuffer()` in test setup for clean state

## Code Organization Guidelines

### File Size Standards

- All code files should be approximately 300 lines or less
- Only exceed 300 lines when splitting would negatively affect:
  - Implementation complexity
  - Testing complexity
  - Readability
  - Performance

### Component Structure for Large Forms

When dealing with complex forms (like medication entry):

1. Split form sections into separate components (e.g., DosageFormInputs, TotalAmountInputs)
2. Keep validation logic in separate files or services
3. Use composition pattern in main component
4. Share state via props or context, not prop drilling

## Timing and Async Patterns

### Timing Abstractions

The codebase uses centralized timing configuration to ensure testability and maintainability:

- **Configuration**: All timing delays are defined in `/src/config/timings.ts`
- **Test Environment**: All delays automatically set to 0ms when `NODE_ENV === 'test'`
- **Custom Hooks**:
  - `useDropdownBlur` - Dropdown blur delays
  - `useScrollToElement` - Scroll animations
  - `useDebounce` - General value debouncing
  - `useSearchDebounce` - Search-specific debouncing with min length

### Best Practices for setTimeout

#### ✅ ACCEPTABLE Uses

1. **Dropdown onBlur delays (200ms)**: Industry-standard UX pattern to allow clicking dropdown items without premature closure
2. **DOM update delays for animations**: When waiting for React renders before scrolling (use `useScrollToElement` hook)
3. **Debouncing/Throttling**:
   - Search input delays (300-500ms typical) - use `useDebounce` or `useSearchDebounce` hooks
   - Form validation delays
   - API call rate limiting
4. **User feedback delays**: Show a message for X seconds then hide
5. **Third-party library workarounds**: When you genuinely need to wait for external code
6. **Event listener setup delays**: Preventing immediate trigger of global listeners (e.g., click-outside handlers that shouldn't fire on the opening click)

#### ❌ AVOID setTimeout for

1. **Focus management**: Use `useEffect` with proper dependencies or `autoFocus` attribute instead
2. **State synchronization**: Use React lifecycle hooks
3. **API call sequencing**: Use async/await or promises
4. **Component mounting**: Use useEffect or useLayoutEffect

### Focus Management Patterns

- Focus traps should always respect tabIndex order
- Always use `useEffect` hooks for focus transitions after state changes
- Never use setTimeout for focus changes - use React lifecycle instead
- Consider using the `autoFocus` attribute for initial focus
- Ensure proper cleanup in useEffect return functions

### Example Patterns

#### Dropdown Blur Pattern

```typescript
// ❌ DON'T DO THIS:
onBlur={() => setTimeout(() => setShow(false), 200)}

// ✅ DO THIS:
import { useDropdownBlur } from '@/hooks/useDropdownBlur';
const handleBlur = useDropdownBlur(setShow);
// ...
onBlur={handleBlur}
```

#### Focus Management Pattern

```typescript
// ❌ DON'T DO THIS:
setTimeout(() => element.focus(), 100);

// ✅ DO THIS:
useEffect(() => {
  if (condition) {
    element?.focus();
  }
}, [condition]);

// OR for initial focus:
<input autoFocus />
```

#### Scroll Animation Pattern

```typescript
// ❌ DON'T DO THIS:
setTimeout(() => {
  document.getElementById(id)?.scrollIntoView();
}, 100);

// ✅ DO THIS:
import { useScrollToElement } from '@/hooks/useScrollToElement';
const scrollTo = useScrollToElement(scrollFunction);
scrollTo(elementId);
```

#### Search Debouncing Pattern

```typescript
// ❌ DON'T DO THIS:
const timeoutRef = useRef();
const handleSearch = (value) => {
  clearTimeout(timeoutRef.current);
  timeoutRef.current = setTimeout(() => {
    searchAPI(value);
  }, 500);
};

// ✅ DO THIS:
import { useSearchDebounce } from '@/hooks/useDebounce';
const { handleSearchChange } = useSearchDebounce(
  (query) => searchAPI(query),
  2, // min length
  TIMINGS.debounce.search // centralized timing
);
```

#### Click-Outside Pattern

```typescript
// ❌ DON'T DO THIS:
setTimeout(() => {
  document.addEventListener('click', handleClickOutside);
}, 0);

// ✅ DO THIS:
import { TIMINGS } from '@/config/timings';
const timeoutId = setTimeout(() => {
  document.addEventListener('click', handleClickOutside);
}, TIMINGS.eventSetup.clickOutsideDelay);
```

### Testing Considerations

- All timing delays should be injectable or configurable
- Use centralized timing configuration that sets to 0ms in test environment
- Tests should run instantly without fake timers when properly abstracted
- This eliminates flaky tests and improves test execution speed

## Testing Patterns

### E2E Testing with Playwright

- **Keyboard Navigation Tests**: Always test full keyboard flow for forms
- **Multi-Select Testing**: Verify Space key toggles, Enter accepts, Escape cancels
- **Focus Management**: Ensure focus moves predictably through Tab order
- **Accessibility**: Test ARIA attributes and screen reader compatibility

### Debugging MobX Reactivity Issues

When components don't re-render despite state changes:

1. **Enable MobX debugging** in `/src/config/mobx.config.ts`
2. **Add diagnostic logging** to track state changes:

   ```typescript
   console.log('[Component] Rendering with:', observableArray.slice());
   ```

3. **Use MobXDebugger component** in development to visualize state
4. **Check for array spreading** that breaks observable chain
5. **Verify observer wrapping** on all components in render hierarchy

### Common Pitfalls and Solutions

#### ❌ Problem: Array spreading breaks reactivity

```typescript
// BAD - Creates new non-observable array
<CategorySelection 
  selectedClasses={[...vm.selectedTherapeuticClasses]} 
/>
```

#### ✅ Solution: Pass observable directly

```typescript
// GOOD - Maintains observable chain
<CategorySelection 
  selectedClasses={vm.selectedTherapeuticClasses} 
/>
```

#### ❌ Problem: Direct array mutation doesn't trigger updates

```typescript
// BAD - MobX might not detect the change
this.selectedItems.push(newItem);
```

#### ✅ Solution: Use immutable updates

```typescript
// GOOD - Creates new array reference
runInAction(() => {
  this.selectedItems = [...this.selectedItems, newItem];
});
```

## Component Patterns

### UI Components Guide

#### When to Use Each Component

##### **SearchableDropdown** (`/components/ui/searchable-dropdown.tsx`)

**Use when:** You need a searchable selection from a large dataset (100+ items)

- Real-time search with debouncing
- Async data loading support
- Highlighted search matches with unified behavior
- Clear selection capability
**Example use cases:** Medication search, client search, diagnosis lookup

```typescript
<SearchableDropdown
  value={searchValue}
  searchResults={results}
  onSearch={handleSearch}
  onSelect={handleSelect}
  renderItem={(item) => <div>{item.name}</div>}
/>
```

##### **EditableDropdown** (`/components/ui/EditableDropdown.tsx`)

**Use when:** You need a dropdown that can be edited after selection

- Small to medium option sets (< 100 items)
- Edit mode for changing selections
- Uses EnhancedAutocompleteDropdown internally for unified highlighting
**Example use cases:** Dosage form, route, unit, frequency selection

```typescript
<EditableDropdown
  id="dosage-form"
  label="Dosage Form"
  value={selectedForm}
  options={formOptions}
  onChange={setSelectedForm}
  tabIndex={5}
/>
```

##### **EnhancedAutocompleteDropdown** (`/components/ui/EnhancedAutocompleteDropdown.tsx`)

**Use when:** You need autocomplete with unified highlighting behavior

- Type-ahead functionality
- Distinct typing vs navigation modes
- Custom value support optional
**Example use cases:** Form fields with predefined options but allow custom input

```typescript
<EnhancedAutocompleteDropdown
  options={options}
  value={value}
  onChange={handleChange}
  onSelect={handleSelect}
  allowCustomValue={true}
/>
```

##### **MultiSelectDropdown** (`/components/ui/MultiSelectDropdown.tsx`)

**Use when:** Users need to select multiple items from a list

- Checkbox-based multi-selection
- Selected items summary display
- Full keyboard navigation support
**Example use cases:** Category selection, tag assignment, permission settings

```typescript
<MultiSelectDropdown
  id="categories"
  label="Categories"
  options={['Option 1', 'Option 2']}
  selected={observableSelectedArray}  // Pass observable directly!
  onChange={(newSelection) => vm.setSelection(newSelection)}
/>
```

##### **EnhancedFocusTrappedCheckboxGroup** (`/components/ui/FocusTrappedCheckboxGroup/`)

**Use when:** You need a group of checkboxes with complex interactions

- Focus trapping within the group
- Dynamic additional inputs based on selection
- Validation rules and metadata support
- Strategy pattern for extensible input types
**Example use cases:** Dosage timings, multi-condition selections

**Focus Region Tracking:**
The component uses a focus region state system to properly handle keyboard events:

- **Focus Regions**: `'header' | 'checkbox' | 'input' | 'button'`
- **Keyboard Handling by Region**:
  - `'checkbox'`: Arrow keys navigate, Space toggles selection
  - `'input'`: All keyboard events handled natively by input
  - `'button'`: Standard button keyboard behavior
  - `'header'`: Arrow keys can enter checkbox group
- **Benefits**:
  - Works with any custom component via strategy pattern
  - No fragile DOM inspection or event target checking
  - Clear separation of keyboard handling concerns
  - Easier debugging with explicit focus region state

```typescript
<EnhancedFocusTrappedCheckboxGroup
  id="dosage-timings"
  title="Dosage Timings"
  checkboxes={timingOptions}
  onSelectionChange={handleTimingChange}
  onAdditionalDataChange={handleDataChange}
  onContinue={handleContinue}
  onCancel={handleCancel}
/>
```

##### **Basic UI Components**

- **Button** (`button.tsx`): Standard button with variants (primary, secondary, ghost)
- **Input** (`input.tsx`): Basic text input with error states
- **Label** (`label.tsx`): Form labels with proper accessibility
- **Card** (`card.tsx`): Content containers with header/body structure
- **Checkbox** (`checkbox.tsx`): Individual checkbox for simple toggles

#### Dropdown Highlighting Behavior

All dropdown components use the unified highlighting system:

- **Typing Mode**: Multiple blue highlights for items starting with typed text
- **Navigation Mode**: Single box-shadow highlight for arrow-selected item
- **Combined Mode**: Both highlights when navigating to a typed match

The highlighting is powered by:

- `useDropdownHighlighting` hook for state management
- `/styles/dropdown-highlighting.css` for consistent styling
- `HighlightType` enum for clear state representation

#### Component Selection Decision Tree

```
Need dropdown selection?
├── Multiple items? → MultiSelectDropdown
├── Large dataset (100+)? → SearchableDropdown
├── Need to edit after selection? → EditableDropdown
├── Need autocomplete? → EnhancedAutocompleteDropdown
└── Simple list? → Native <select> with styling

Need checkboxes?
├── Group with complex logic? → EnhancedFocusTrappedCheckboxGroup
└── Simple toggle? → Checkbox

Need text input?
├── With dropdown? → See dropdown selection above
└── Plain text? → Input
```

### Key Implementation Notes

- Always pass MobX observables directly (never spread arrays)
- Use proper tabIndex sequencing for keyboard navigation
- Include all required ARIA attributes for accessibility
- Follow the unified highlighting pattern for consistency
- Use centralized timing configuration for delays

## Definition of Done

### Code Quality Requirements

All code must meet the following standards before being considered complete:

#### Documentation Compliance

- **ALL components, ViewModels, and types must be fully documented** in compliance with our documentation strategy
- **Component documentation** must include:
  - Complete Props Interface with exact TypeScript interface matching
  - All props documented with types and descriptions
  - Usage examples (basic and advanced)
  - Accessibility compliance details (WCAG 2.1 Level AA)
  - ARIA attributes and keyboard navigation patterns
- **ViewModel documentation** must include:
  - All observable properties with types
  - Action methods with parameters and return types
  - Computed properties and their dependencies
  - Usage patterns and integration examples
- **Type documentation** must include:
  - Interface properties with descriptions
  - Union types with all possible values
  - Generic constraints and usage examples

#### Documentation Standards

- **Templates**: Use standardized templates located at `../documentation/templates/`
  - `../documentation/templates/component-template.md` for React components
  - Additional templates for ViewModels and types as needed
- **Exact Interface Matching**: Documentation must exactly match TypeScript interfaces
  - Every prop, property, and method must be documented
  - Types must match exactly (no missing optional markers, etc.)
  - Descriptions must be clear and accurate
- **Validation**: All documentation must pass automated validation
  - Run `npm run docs:check` locally before submitting PRs
  - Zero high-priority alignment issues required for merge
  - Component coverage must be 100%

#### Code Standards

- **TypeScript**: Strict mode compliance, no `any` types
- **Testing**: Unit tests for components, E2E tests for user flows
- **Accessibility**: WCAG 2.1 Level AA compliance with full keyboard navigation
- **Performance**: Optimized rendering, proper memoization for complex components
- **Linting**: ESLint and TypeScript checks must pass

#### Git Standards

- **Commits**: Clear, descriptive commit messages
- **PRs**: Include documentation validation results
- **Branches**: Feature branches from main, clean history preferred

### Validation Process

Before marking any task as complete:

1. **Run Documentation Validation**:

   ```bash
   npm run docs:check
   ```

2. **Verify Zero Critical Issues**:
   - No missing component documentation
   - No prop/interface mismatches
   - 100% component coverage

3. **Run Code Quality Checks**:

   ```bash
   npm run typecheck
   npm run lint
   npm run build
   ```

4. **Test Accessibility**:
   - Manual keyboard navigation testing
   - Screen reader compatibility verification
   - ARIA attribute validation

**Remember**: Documentation is not optional—it's a core requirement for maintainable, professional code. The validation system ensures our documentation stays current and accurate as the codebase evolves.

## Documentation Resources

- **[Agent Navigation Index](../documentation/AGENT-INDEX.md)** - Keyword-based doc navigation for AI agents
- **[Agent Guidelines](../documentation/AGENT-GUIDELINES.md)** - Documentation creation and update rules
- **[Frontend Documentation](../documentation/frontend/)** - All frontend-specific documentation
