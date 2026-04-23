---
status: current
last_updated: 2026-04-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Development guidelines for the React/TypeScript frontend — MobX patterns, WCAG 2.1 AA accessibility, logging, timing abstractions, and Definition of Done. Subdirectory CLAUDE.md files cover services, contexts, and UI components.

**When to read**:
- Starting frontend development work
- Implementing accessible components
- Debugging MobX reactivity issues
- Working with timing, logging, or generated event types

**Prerequisites**: Basic React and TypeScript knowledge

**Key topics**: `react`, `typescript`, `mobx`, `accessibility`, `wcag`, `vite`, `tailwind`, `logging`, `timings`

**Estimated read time**: 12 minutes (full), 3 minutes (relevant sections)
<!-- TL;DR-END -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A4C-FrontEnd is a React-based medication management application built with TypeScript and Vite. The application provides healthcare professionals with tools to manage client medications.

## Technology Stack

- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite
- **State Management**: MobX with mobx-react-lite
- **Styling**: Tailwind CSS with tailwindcss-animate
- **UI Components**: Radix UI primitives (`@radix-ui`)
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

## Subdirectory CLAUDE.md Files

For domain-specific rules, see the CLAUDE.md file in the relevant subdirectory:

| Path | Covers |
|------|--------|
| [`src/services/CLAUDE.md`](src/services/CLAUDE.md) | Supabase session retrieval, CQRS query pattern (RPC), correlation IDs |
| [`src/contexts/CLAUDE.md`](src/contexts/CLAUDE.md) | `AuthContext`, `IAuthProvider` DI pattern, JWT custom claims, mock vs real auth |
| [`src/components/ui/CLAUDE.md`](src/components/ui/CLAUDE.md) | Dropdown selection guide, focus-trapped checkbox group, dropdown highlighting |

This file (frontend/CLAUDE.md) covers cross-cutting concerns: accessibility, MobX, logging, timings, testing, DoD.

## Project Structure

```
src/
├── components/       # Reusable UI components
│   ├── ui/          # Base UI components (button, input, dropdown, etc.) — see CLAUDE.md
│   ├── auth/        # Authentication components
│   ├── debug/       # Debug utilities (dev only)
│   ├── layouts/     # Layout components
│   └── medication/  # Medication-specific components
├── pages/           # Page-level routing components
├── views/           # Feature-specific view components
├── viewModels/      # MobX ViewModels for state management
├── services/        # API interfaces and implementations — see CLAUDE.md
├── contexts/        # React contexts and providers — see CLAUDE.md
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
├── utils/           # Utility functions
└── test/            # Test setup and utilities
```

## Accessibility & WCAG Compliance

### WCAG 2.1 Level AA Requirements

- **ALL interactive elements** must meet WCAG 2.1 Level AA standards
- Color contrast ratios: 4.5:1 for normal text, 3:1 for large text
- All functionality available via keyboard
- No keyboard traps (except intentional modal focus traps)
- Provide text alternatives for non-text content
- Make all functionality available from keyboard interface

### Focus Management Standards

- **TabIndex Guidelines**:
  - **Prefer natural DOM order** (no explicit `tabIndex`) whenever possible
  - **Use `tabIndex` only when needed** to override natural order for UX reasons
  - **Sequential numbering**: When using explicit `tabIndex`, use sequential numbers (1, 2, 3...)
  - **Consistent patterns within components**:
    - `tabIndex=0`: Natural DOM order (default)
    - `tabIndex=1,2,3...`: Custom order for improved UX flow
    - `tabIndex=-1`: Programmatically focusable but not in tab sequence
  - **Component-level consistency**: Reset `tabIndex` sequence for each major section/modal
  - **Document complex sequences**: Add comments explaining `tabIndex` choices in complex forms

- **Focus Trapping**:
  - Modals MUST trap focus while open
  - First focusable element receives focus on open
  - Focus returns to trigger element on close
  - Implement circular tab navigation within trap
  - ESC key should close modal and return focus

- **Focus Restoration**:
  - Store reference to active element before modal/overlay
  - Restore focus to previous element on close
  - Use refs and `useEffect`, never `setTimeout`
  - Handle cases where trigger element is removed from DOM

### ARIA Requirements

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

### Keyboard Navigation Requirements

- **Tab Order**:
  - Logical left-to-right, top-to-bottom flow
  - Header → Main Content → Sidebar → Footer
  - Within modals: Header → Content → Footer buttons
- **Focus Indicators**:
  - Visible focus rings on ALL interactive elements
  - High contrast focus indicators (not just browser default)
  - Focus indicator must meet color contrast requirements
- **Common patterns**:
  - ESC to close modals/dropdowns
  - Enter to submit/confirm
  - Space to toggle checkboxes/buttons
  - Arrow keys for navigation within components

### Accessibility Testing

- **Manual**: Test with keyboard only, verify focus indicators always visible, test with NVDA (Windows) and VoiceOver (Mac)
- **Automated**: `@axe-core/playwright` in E2E tests; zero accessibility violations as merge requirement

## Architecture Patterns

- **MVVM**: ViewModels (MobX) handle business logic, Views (React) handle presentation
- **Composition over Inheritance**: Use component composition for complex UIs
- **Interface-based Services**: All services implement interfaces for easy mocking/testing
- **Unified Component Pattern**: Create single, reusable components for similar functionality (e.g., `MultiSelectDropdown` for all multi-select needs)

## State Management with MobX

- Use MobX ViewModels for complex state logic
- Keep component state minimal and UI-focused
- **CRITICAL**: Always wrap components with `observer` HOC from `mobx-react-lite` for reactive components
- **Array Reactivity Rules**:
  - ❌ Never spread observable arrays in props: `<Component items={[...observableArray]} />`
  - ✅ Pass observable arrays directly: `<Component items={observableArray} />`
  - Use immutable updates in ViewModels: `this.array = [...this.array, item]` instead of `this.array.push(item)`
  - Always use `runInAction` for multiple state updates
- **Debugging MobX**: When reactivity issues occur, check:
  1. Component is wrapped with `observer`
  2. No array spreading breaking the observable chain
  3. State mutations are using replacement, not mutation
  4. Parent components in render chain are also wrapped with `observer`

### Common MobX Pitfalls

❌ **Array spreading breaks reactivity** — `<Component items={[...vm.items]} />` creates a new non-observable array.
✅ Pass the observable directly — `<Component items={vm.items} />` maintains the chain.

❌ **Direct array mutation may not trigger updates** — `this.selectedItems.push(newItem)`.
✅ Use immutable updates — `runInAction(() => { this.selectedItems = [...this.selectedItems, newItem]; })`.

## TypeScript Guidelines

- Strict mode is enabled — avoid `any` types
- Define interfaces for all props and complex data structures
- Use type inference where possible, explicit types where necessary

## Generated Event Types

**Source of Truth**: Domain event types are generated from AsyncAPI schemas — NEVER hand-write them.

```typescript
// ✅ GOOD: Import from @/types/events (re-exports from generated)
import { DomainEvent, EventMetadata, StreamType } from '@/types/events';

// ❌ BAD: Hand-written types (file deleted, don't recreate)
import { DomainEvent } from '@/types/event-types';  // DOES NOT EXIST

// ❌ BAD: Direct import from generated (bypasses extensions)
import { DomainEvent } from '@/types/generated/generated-events';
```

**Regenerating Types** (after AsyncAPI changes):
```bash
cd infrastructure/supabase/contracts
npm run generate:types
cp types/generated-events.ts ../../../frontend/src/types/generated/
```

**Key points**:
- All event types in `@/types/generated/generated-events.ts` are auto-generated
- `@/types/events.ts` re-exports from generated and adds app-specific extensions
- `StreamType` enum includes all valid aggregate types (user, organization, etc.)
- `EventMetadata` includes standard fields (`user_id`, `reason`, `organization_id`, etc.)

## Configuration Management

The application uses centralized configuration files for consistent behavior across environments:

- **API Configuration** (`/src/config/medication-search.config.ts`): RXNorm API endpoints, IndexedDB cache configuration
- **Timing Configuration** (`/src/config/timings.ts`): Centralized timing delays, automatic 0ms in test environment
- **Logging Configuration** (`/src/config/logging.config.ts`): Per-environment logging configuration
- **MobX Configuration** (`/src/config/mobx.config.ts`): MobX debugging configuration
- **OAuth Configuration** (`/src/config/oauth.config.ts`): Authentication configuration

### Environment Variables

```env
# API Configuration
VITE_RXNORM_API_URL=https://rxnav.nlm.nih.gov/REST
VITE_API_TIMEOUT=5000

# Cache Configuration
VITE_CACHE_TTL=3600000
VITE_CACHE_MAX_SIZE=50MB

# Debug Configuration
VITE_DEBUG_MOBX=false
VITE_DEBUG_PERFORMANCE=false
VITE_DEBUG_LOGS=false
```

## Search and Development Resources

- For code base searches use the **serena** MCP server
- For deep research use the **exa** MCP server
- For exact code syntax use the **context7** MCP server
- For UI / UX testing use the **playwright** MCP server

## Logging and Diagnostics

### Configuration-Driven Logging System

Zero-overhead logging system that can be configured per environment:

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

**Per-environment defaults** (`/src/config/logging.config.ts`):
- **Development**: Full logging with all categories enabled
- **Test**: Minimal logging (errors only) for fast test execution
- **Production**: Disabled by default, console methods removed during build

**Log categories**: `main`, `mobx`, `viewmodel`, `navigation`, `component`, `api`, `validation`, `diagnostics`

**Output targets**: `console`, `memory`, `remote`, `none`

### Debug Diagnostics System

- **Activation**: `Ctrl+Shift+D` toggles the control panel
- **MobX State Monitor**: `Ctrl+Shift+M` — visualize observable state, render counts
- **Performance Monitor**: `Ctrl+Shift+P` — FPS, render time, memory usage
- **Log Overlay**: Display console logs in the UI with category filtering
- **Network Monitor**: Track API calls, request timing, payload size, status codes

Initial state via env vars: `VITE_DEBUG_MOBX=true`, `VITE_DEBUG_PERFORMANCE=true`, `VITE_DEBUG_LOGS=true`.

```typescript
import { useDiagnostics } from '@/contexts/DiagnosticsContext';

const MyComponent = () => {
  const { config, toggleMobXMonitor } = useDiagnostics();
  if (config.enableMobXMonitor) { /* show debug info */ }
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

- All code files should be approximately 300 lines or less
- Only exceed 300 lines when splitting would negatively affect implementation, testing, readability, or performance
- For complex forms (e.g., medication entry): split form sections into separate components, keep validation logic in services, use composition pattern, share state via props or context — not prop drilling

## Timing and Async Patterns

### Timing Abstractions

Centralized timing configuration ensures testability and maintainability:

- **Configuration**: All timing delays defined in `/src/config/timings.ts`
- **Test Environment**: All delays automatically set to 0ms when `NODE_ENV === 'test'`
- **Custom Hooks**:
  - `useDropdownBlur` — Dropdown blur delays
  - `useScrollToElement` — Scroll animations
  - `useDebounce` — General value debouncing
  - `useSearchDebounce` — Search-specific debouncing with min length

### When `setTimeout` is Acceptable

1. **Dropdown `onBlur` delays (200ms)**: Industry-standard pattern to allow clicking dropdown items
2. **DOM update delays for animations**: When waiting for React renders before scrolling (use `useScrollToElement`)
3. **Debouncing/Throttling**: Search inputs, validation, API rate limiting (use the hooks above)
4. **User feedback delays**: Show a message for X seconds then hide
5. **Third-party library workarounds**: When you genuinely need to wait for external code
6. **Event listener setup delays**: Preventing immediate trigger of global listeners (e.g., click-outside)

### When `setTimeout` is FORBIDDEN

1. **Focus management**: Use `useEffect` with proper dependencies or `autoFocus` instead
2. **State synchronization**: Use React lifecycle hooks
3. **API call sequencing**: Use `async`/`await` or promises
4. **Component mounting**: Use `useEffect` or `useLayoutEffect`

### Example Patterns

**Dropdown Blur**:
```typescript
// ❌ DON'T:
onBlur={() => setTimeout(() => setShow(false), 200)}

// ✅ DO:
import { useDropdownBlur } from '@/hooks/useDropdownBlur';
const handleBlur = useDropdownBlur(setShow);
onBlur={handleBlur}
```

**Focus Management**:
```typescript
// ❌ DON'T:
setTimeout(() => element.focus(), 100);

// ✅ DO:
useEffect(() => { if (condition) element?.focus(); }, [condition]);
// OR for initial focus:
<input autoFocus />
```

**Search Debouncing**:
```typescript
// ✅ DO:
import { useSearchDebounce } from '@/hooks/useDebounce';
const { handleSearchChange } = useSearchDebounce(
  (query) => searchAPI(query),
  2,                          // min length
  TIMINGS.debounce.search,    // centralized timing
);
```

**Click-Outside**:
```typescript
// ✅ DO:
import { TIMINGS } from '@/config/timings';
const timeoutId = setTimeout(() => {
  document.addEventListener('click', handleClickOutside);
}, TIMINGS.eventSetup.clickOutsideDelay);
```

### Focus Management Patterns

- Focus traps should always respect `tabIndex` order
- Always use `useEffect` hooks for focus transitions after state changes
- Never use `setTimeout` for focus changes — use React lifecycle instead
- Consider using the `autoFocus` attribute for initial focus
- Ensure proper cleanup in `useEffect` return functions

## Testing Patterns

### E2E Testing with Playwright

- **Keyboard Navigation Tests**: Always test full keyboard flow for forms
- **Multi-Select Testing**: Verify Space toggles, Enter accepts, Escape cancels
- **Focus Management**: Ensure focus moves predictably through Tab order
- **Accessibility**: Test ARIA attributes and screen reader compatibility

### Debugging MobX Reactivity Issues

When components don't re-render despite state changes:

1. **Enable MobX debugging** in `/src/config/mobx.config.ts`
2. **Add diagnostic logging** to track state changes: `console.log('[Component] Rendering with:', observableArray.slice());`
3. **Use MobXDebugger component** in development to visualize state
4. **Check for array spreading** that breaks observable chain
5. **Verify `observer` wrapping** on all components in render hierarchy

## Definition of Done

### Code Standards

- **TypeScript**: Strict mode compliance, no `any` types
- **Testing**: Unit tests for components, E2E tests for user flows
- **Accessibility**: WCAG 2.1 Level AA compliance with full keyboard navigation
- **Performance**: Optimized rendering, proper memoization for complex components
- **Linting**: ESLint and TypeScript checks must pass

### Documentation

- All components, ViewModels, and types must be fully documented per `documentation/templates/component-template.md`
- Component documentation must exactly match TypeScript interfaces (every prop, type, optional marker)
- Run `npm run docs:check` locally before submitting PRs
- Component coverage must be 100%, zero high-priority alignment issues for merge

### Validation Process

Before marking any task complete:

```bash
npm run docs:check       # Documentation validation
npm run typecheck        # TypeScript checks
npm run lint             # ESLint
npm run build            # Production build
```

Plus accessibility verification:
- Manual keyboard navigation testing
- Screen reader compatibility verification
- ARIA attribute validation

## Documentation Resources

- **[Subdirectory CLAUDE.md files](#subdirectory-claudemd-files)** — Domain-specific rules (services, contexts, UI components)
- **[Agent Navigation Index](../documentation/AGENT-INDEX.md)** — Keyword-based doc navigation for AI agents
- **[Agent Guidelines](../documentation/AGENT-GUIDELINES.md)** — Documentation creation and update rules
- **[Frontend Documentation](../documentation/frontend/)** — All frontend-specific documentation
