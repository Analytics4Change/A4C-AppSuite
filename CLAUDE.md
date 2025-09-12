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
  - Use sequential tabIndex (1, 2, 3...) for logical flow within components
  - Reserve tabIndex=0 for natural DOM order
  - Use tabIndex=-1 for programmatically focusable elements
  - Never skip numbers in tabIndex sequence
  - Document tabIndex order in complex components
  - Reset tabIndex sequence for each major section/modal

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
│   ├── ui/          # Base UI components (button, input, etc.)
│   │   └── MultiSelectDropdown.tsx  # Unified multi-select component
│   └── debug/       # Debug utilities (dev only)
│       └── MobXDebugger.tsx  # MobX state visualization
├── config/          # Application configuration
│   ├── timings.ts   # Centralized timing configuration
│   └── mobx.config.ts  # MobX debugging configuration
├── contexts/        # React contexts
├── hooks/           # Custom React hooks
├── mocks/           # Mock data for development
├── services/        # API interfaces and implementations
│   ├── api/         # API interfaces
│   └── mock/        # Mock API implementations
├── types/           # TypeScript type definitions
├── utils/           # Utility functions
├── viewModels/      # MobX ViewModels for state management
└── views/           # Feature-specific components
    ├── client/      # Client-related views
    └── medication/  # Medication-related views
```

## Development Guidelines

### Architecture Patterns
- **MVVM Pattern**: ViewModels (MobX) handle business logic, Views (React) handle presentation
- **Composition over Inheritance**: Use component composition for complex UIs
- **Interface-based Services**: All services implement interfaces for easy mocking/testing
- **Unified Component Pattern**: Create single, reusable components for similar functionality (e.g., MultiSelectDropdown for all multi-select needs)

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

#### ✅ ACCEPTABLE Uses:
1. **Dropdown onBlur delays (200ms)**: Industry-standard UX pattern to allow clicking dropdown items without premature closure
2. **DOM update delays for animations**: When waiting for React renders before scrolling (use `useScrollToElement` hook)
3. **Debouncing/Throttling**: 
   - Search input delays (300-500ms typical) - use `useDebounce` or `useSearchDebounce` hooks
   - Form validation delays
   - API call rate limiting
4. **User feedback delays**: Show a message for X seconds then hide
5. **Third-party library workarounds**: When you genuinely need to wait for external code
6. **Event listener setup delays**: Preventing immediate trigger of global listeners (e.g., click-outside handlers that shouldn't fire on the opening click)

#### ❌ AVOID setTimeout for:
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

#### Dropdown Blur Pattern:
```typescript
// ❌ DON'T DO THIS:
onBlur={() => setTimeout(() => setShow(false), 200)}

// ✅ DO THIS:
import { useDropdownBlur } from '@/hooks/useDropdownBlur';
const handleBlur = useDropdownBlur(setShow);
// ...
onBlur={handleBlur}
```

#### Focus Management Pattern:
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

#### Scroll Animation Pattern:
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

#### Search Debouncing Pattern:
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

#### Click-Outside Pattern:
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