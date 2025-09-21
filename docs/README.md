# A4C-FrontEnd Documentation

A React-based medication management application for healthcare client management.

## Table of Contents

- [Project Overview](#project-overview)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Available Commands](#available-commands)
- [Current Features](#current-features)
- [Documentation](#documentation)
- [Development Guidelines](#development-guidelines)

## Project Overview

A4C-FrontEnd is a sophisticated healthcare application designed for managing client medication profiles. The application provides a user-friendly interface for healthcare professionals to:

- Manage client profiles and medication history
- Search and select medications with comprehensive drug databases
- Configure detailed dosage forms and administration schedules
- Handle complex medication categorization and validation
- Maintain accessibility compliance and responsive design

The application follows modern React patterns with TypeScript, emphasizing maintainable code architecture and comprehensive testing strategies.

## Tech Stack

### Core Framework
- **React 19.1.1** - Modern React with latest features and improvements
- **TypeScript 5.9.2** - Type-safe development with strict typing
- **Vite 7.0.6** - Fast build tool and development server
- **React Router DOM 7.8.2** - Declarative routing for React applications

### State Management
- **MobX 6.13.7** - Reactive state management
- **MobX React Lite 4.1.0** - React bindings for MobX

### UI Framework & Styling
- **Tailwind CSS 4.1.12** - Utility-first CSS framework with advanced features
- **Radix UI Components** - Accessible, unstyled UI components
  - `@radix-ui/react-checkbox 1.3.2` - Accessible checkbox components
  - `@radix-ui/react-label 2.1.7` - Semantic label components
  - `@radix-ui/react-slot 1.2.3` - Composition and polymorphism utilities
- **Tailwind Merge 3.3.1** - Intelligent Tailwind class merging
- **Class Variance Authority 0.7.1** - Type-safe component variant system
- **Lucide React 0.536.0** - Comprehensive icon library
- **CLSX 2.1.1** - Conditional class name utility
- **Tailwind CSS Animate 1.0.7** - Animation utilities
- **Fuse.js 7.1.0** - Advanced fuzzy search capabilities

### Form Components
- Custom date selection components built with React and Tailwind CSS

### Testing Framework
- **Playwright 1.54.2** - End-to-end testing
- **Accessibility Testing** - Built-in axe-core integration for WCAG compliance validation

### Development Tools
- **ESLint 9.32.0** - Code linting and style enforcement
- **TypeScript ESLint 8.39.0** - TypeScript-specific linting rules
- **Husky 9.1.7** - Git hooks for code quality
- **Knip 5.63.0** - Unused dependency detection
- **Autoprefixer 10.4.21** - CSS vendor prefixing
- **PostCSS 8.5.6** - CSS transformation toolkit

## Getting Started

### Prerequisites

- Node.js (version 18 or higher recommended)
- npm or yarn package manager
- Modern web browser for development

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/lars-tice/A4C-FrontEnd.git
   cd A4C-FrontEnd
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```
   
   The application will be available at `http://localhost:5173` (Vite default port)

4. **Build for production**
   ```bash
   npm run build
   ```

5. **Preview production build**
   ```bash
   npm run preview
   ```

## Project Structure

```
src/
├── components/           # Reusable UI components
│   ├── ui/              # Base UI components (buttons, inputs, dropdowns)
│   │   ├── FocusTrappedCheckboxGroup/  # Complex checkbox component with strategies
│   │   └── __tests__/   # Component unit tests
│   ├── auth/            # Authentication components
│   ├── debug/           # Development debugging tools
│   ├── layouts/         # Layout components
│   └── medication/      # Medication-specific components
├── contexts/            # React contexts and providers
├── hooks/               # Custom React hooks
│   ├── useDropdownBlur.ts     # Dropdown timing management
│   ├── useScrollToElement.ts  # Scroll animation utilities
│   ├── useAutoScroll.ts       # Auto-scroll behavior
│   ├── useDebounce.ts         # Input debouncing
│   ├── useViewModel.ts        # MobX integration
│   ├── useKeyboardNavigation.ts # Keyboard interaction patterns
│   └── __tests__/       # Hook unit tests
├── pages/               # Page-level routing components
│   ├── auth/            # Authentication pages
│   ├── clients/         # Client management pages
│   └── medications/     # Medication management pages
├── views/               # Feature-specific view components
│   ├── client/          # Client management views
│   └── medication/      # Medication management views
├── viewModels/          # MobX state management
│   ├── client/          # Client-related state management
│   └── medication/      # Medication-related state management
├── services/            # API and data services
│   ├── api/             # API interfaces and implementations
│   │   └── interfaces/  # API contract definitions
│   ├── mock/            # Mock API implementations
│   ├── data/            # Data access services
│   ├── validation/      # Data validation utilities
│   ├── search/          # Search functionality
│   ├── http/            # HTTP client utilities
│   ├── adapters/        # External service adapters
│   └── cache/           # Caching implementations
├── types/               # TypeScript type definitions
│   └── models/          # Domain model types
├── config/              # Configuration files
│   ├── timings.ts       # Centralized timing configuration
│   ├── logging.config.ts # Logging system configuration
│   ├── mobx.config.ts   # MobX debugging configuration
│   └── oauth.config.ts  # Authentication configuration
├── data/                # Static data and configurations
│   └── static/          # Static data files
├── mocks/               # Mock data for development
│   └── data/            # Mock datasets
├── styles/              # CSS and styling files
├── constants/           # Application constants
├── utils/               # Utility functions
└── test/                # Test setup and utilities

docs/                    # Project documentation
├── README.md            # Main technical documentation (this file)
├── testing-strategies.md # Testing patterns and strategies
├── ui-patterns.md       # UI architecture and patterns
└── [other docs]/       # Additional specialized documentation

e2e/                     # Playwright end-to-end tests
├── tests/               # Test specifications
└── [config files]      # Test configuration
```

## Available Commands

### Development Commands
```bash
# Start development server
npm run dev

# Start development server on specific port
npm run dev -- --port 3456

# Type checking without emission
npm run typecheck

# Lint code with ESLint
npm run lint

# Build for production
npm run build

# Preview production build
npm run preview
```

### Testing Commands
```bash
# Run Playwright end-to-end tests
npx playwright test

# Run tests with UI interface
npx playwright test --ui

# Run specific test file
npx playwright test medication-entry.spec.ts

# Run tests in headed mode (see browser)
npx playwright test --headed

# Generate test report
npx playwright show-report
```

### Code Quality Commands
```bash
# Install Husky git hooks
npm run prepare

# Find unused dependencies
npx knip

# Check bundle size analysis
# (Custom scripts can be added as needed)
```

## Current Features

### Client Management
- **Client Selection**: Streamlined client selection interface
- **Client Profiles**: Basic client information management
- **Navigation Flow**: Smooth transitions between client and medication views

### Medication Search & Selection
- **Intelligent Search**: Real-time medication search with debounced input
- **Comprehensive Database**: Access to extensive medication databases
- **Search Results**: Dynamic dropdown with selectable medication options
- **Clear Selection**: Easy medication deselection and search reset

### Dosage Configuration
- **Dosage Forms**: Support for multiple medication forms (tablets, liquids, injections)
- **Flexible Dosing**: Configurable dosage amounts and units
- **Administration Frequency**: Various frequency options (daily, weekly, as-needed)
- **Total Amount Tracking**: Calculate and track total medication quantities
- **Condition-based Dosing**: Link medications to specific medical conditions

### Category Management
- **Broad Categories**: High-level medication categorization
- **Specific Categories**: Detailed subcategorization for precise classification
- **Multi-select Support**: Select multiple categories per medication
- **Dynamic Category Lists**: Categories update based on medication selection

### Date Management
- **Start Date Selection**: Configurable medication start dates
- **Discontinue Date**: Optional medication discontinuation scheduling
- **Calendar Integration**: User-friendly date picker interface
- **Date Validation**: Prevent invalid date combinations

### User Experience Features
- **Responsive Design**: Mobile-first responsive layout
- **Accessibility Compliance**: WCAG-compliant interface design
- **Keyboard Navigation**: Full keyboard accessibility support
- **Focus Management**: Intelligent focus handling and tab order
- **Loading States**: Clear feedback during data operations
- **Error Handling**: Comprehensive error messaging and recovery

## Documentation

### Core Documentation
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - CI/CD pipeline and deployment guide
- **[DEVELOPMENT.md](./DEVELOPMENT.md)** - Development setup and cross-platform guidelines
- **[TESTING.md](./TESTING.md)** - Comprehensive testing strategies with Playwright
- **[API.md](./API.md)** - Component and service API reference
- **[UI Patterns](./ui-patterns.md)** - Modal architecture and component patterns

### Implementation Docs
- **[DESIGN_PATTERNS_MIGRATION_GUIDE.md](./DESIGN_PATTERNS_MIGRATION_GUIDE.md)** - Design patterns and migration strategies
- **[FocusTrappedCheckboxGroup_plan.md](./FocusTrappedCheckboxGroup_plan.md)** - Focus management implementation
- **[GHCR_TOKEN_ROTATION.md](./GHCR_TOKEN_ROTATION.md)** - Token management procedures
- **[medication-search-implementation.md](./medication-search-implementation.md)** - Search functionality details
- **[rxnorm-medication-autocomplete.md](./rxnorm-medication-autocomplete.md)** - RxNorm integration

### Additional Resources
- **[CLAUDE.md](../CLAUDE.md)** - Project instructions and development guidelines
- **[Package.json](../package.json)** - Dependencies and script definitions
- **[TypeScript Config](../tsconfig.json)** - TypeScript configuration settings
- **[Vite Config](../vite.config.ts)** - Build tool configuration
- **[Tailwind Config](../tailwind.config.js)** - Styling framework configuration

## Development Guidelines

### Code Organization
- **File Size Standard**: Keep files under 300 lines when possible
- **Component Splitting**: Split large forms into focused subcomponents
- **Composition Pattern**: Use component composition over prop drilling
- **Separation of Concerns**: Keep business logic separate from presentation

### Timing and Async Patterns

#### Centralized Timing Configuration
All timing-related delays are managed through a centralized configuration system:

```typescript
// /src/config/timings.ts
export const TIMINGS = {
  dropdown: {
    blurDelay: 200,        // Allow time to click dropdown items
    openDelay: 0,          // Immediate dropdown opening
  },
  debounce: {
    search: 300,           // Search input debouncing
    validation: 150,       // Form validation delays
  },
  animation: {
    scrollTo: 100,         // Scroll-to-element delays
    fadeIn: 200,           // UI fade animations
  },
  eventSetup: {
    clickOutsideDelay: 0,  // Click-outside handler setup
  }
};
```

#### Test Environment Optimization
- **Automatic zero delays**: All timing values automatically set to 0ms in test environments
- **No fake timers needed**: Tests run at full speed without setTimeout complications
- **Consistent behavior**: Same timing patterns across development and testing

#### Recommended Timing Hooks
```typescript
// Use specialized hooks instead of raw setTimeout
import { useDropdownBlur } from '@/hooks/useDropdownBlur';
import { useScrollToElement } from '@/hooks/useScrollToElement';
import { useDebounce, useSearchDebounce } from '@/hooks/useDebounce';

// Dropdown blur handling
const handleBlur = useDropdownBlur(setShowDropdown);

// Scroll animations
const scrollTo = useScrollToElement(scrollFunction);

// Search debouncing with minimum length
const { handleSearchChange } = useSearchDebounce(
  (query) => performSearch(query),
  2, // minimum length
  TIMINGS.debounce.search
);
```

#### Best Practices
- **Avoid raw setTimeout**: Use centralized timing configuration and specialized hooks
- **Focus management**: Use React lifecycle hooks (useEffect) instead of setTimeout
- **Event handler delays**: Only for legitimate UX patterns (dropdown blur, click-outside prevention)
- **API debouncing**: Use structured debouncing hooks for consistent behavior

### State Management
- **MobX Integration**: Reactive state management for complex data flows
- **ViewModel Pattern**: Separate business logic into dedicated ViewModels
- **Context Usage**: React Context for component tree state sharing
- **Local State**: useState for component-specific state management

### Testing Philosophy
- **E2E First**: Comprehensive end-to-end testing with Playwright
- **Accessibility Testing**: Built-in accessibility validation with axe-core
- **Cross-browser Testing**: Automated testing across multiple browsers  
- **Performance Testing**: Load time and interaction performance validation

#### Accessibility Testing Framework
The application includes comprehensive accessibility testing at multiple levels:

**Automated Testing Integration:**
```typescript
// E2E tests include built-in accessibility audits
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('medication form accessibility', async ({ page }) => {
  await page.goto('/medication-entry');
  
  // Run axe accessibility audit
  const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScanResults.violations).toEqual([]);
});
```

**Manual Testing Checklist:**
- Keyboard-only navigation testing (disable mouse)
- Screen reader compatibility (NVDA, VoiceOver, JAWS)
- Focus indicator visibility across all interactive elements
- Color contrast validation for all text elements
- Form label and error message announcement verification

**CI/CD Integration:**
- Zero accessibility violations as merge requirement
- Automated axe-core scans in pull request validation
- Performance and accessibility budgets enforced

### Accessibility Requirements
- **WCAG Compliance**: Follow WCAG 2.1 AA standards
- **Keyboard Navigation**: Full keyboard accessibility support
- **Screen Reader Support**: Proper ARIA labeling and semantic HTML
- **Focus Management**: Clear focus indicators and logical tab order
- **Color Contrast**: Maintain sufficient color contrast ratios

### Performance Considerations
- **Component Optimization**: Use React.memo for expensive renders
- **Bundle Optimization**: Tree-shaking and code splitting where beneficial
- **Timing Abstractions**: Eliminate setTimeout in test environments
- **Debounced Inputs**: Prevent excessive API calls with proper debouncing

## Debug and Monitoring Tools

### Development Debug System

The application includes comprehensive debugging tools for development:

#### Debug Control Panel
- **Activation**: Press `Ctrl+Shift+D` to toggle the debug control panel
- **Features**:
  - Toggle individual debug monitors on/off
  - Adjust position to any corner of the screen
  - Control opacity (30-100%) for overlay transparency
  - Change font size (small/medium/large)
  - Persistent settings stored in localStorage

#### Available Debug Monitors

##### MobX State Monitor (`Ctrl+Shift+M`)
- **Purpose**: Real-time visualization of MobX observable state
- **Features**:
  - Component render count tracking
  - Observable array contents display
  - Last update timestamp
  - State change visualization
- **Usage**: Automatically appears when enabled via control panel

##### Performance Monitor (`Ctrl+Shift+P`)
- **Purpose**: Track rendering performance and identify optimization opportunities
- **Metrics**: FPS tracking, render time measurement, memory usage monitoring

##### Log Overlay
- **Purpose**: Display application logs directly in the UI
- **Features**: 
  - Filter logs by category
  - Search functionality
  - Clear buffer capability
  - Real-time log streaming

##### Network Monitor
- **Purpose**: Track API calls and responses
- **Features**: Request timing, payload size analysis, HTTP status monitoring

#### Environment Configuration
```bash
# Enable specific monitors on application startup
VITE_DEBUG_MOBX=true
VITE_DEBUG_PERFORMANCE=true
VITE_DEBUG_LOGS=true
```

### Logging System

#### Configuration-Driven Architecture
- **Zero-overhead production builds**: Console statements automatically removed
- **Environment-specific configuration**: Different log levels per environment
- **Category-based logging**: Separate loggers for different application areas

#### Logger Categories
- `main` - Application startup and lifecycle events
- `mobx` - MobX state management and reactive updates
- `viewmodel` - ViewModel business logic operations
- `navigation` - Focus management and keyboard navigation
- `component` - Component lifecycle and rendering events
- `api` - API calls, responses, and error handling
- `validation` - Form validation logic and results
- `diagnostics` - Debug tool controls and operations

#### Usage Pattern
```typescript
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');
log.debug('Component rendered', { props });
log.info('User action completed');
log.warn('Performance threshold exceeded');
log.error('Operation failed', error);
```

### Production Optimization
- All debug tools tree-shaken in production builds
- Console methods removed via Vite's esbuild configuration
- Zero runtime overhead when diagnostics disabled
- Automatic timing delay elimination in test environments

---

For specific implementation details, refer to the specialized documentation files in this directory or examine the source code with its comprehensive inline documentation.