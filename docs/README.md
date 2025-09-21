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

### State Management
- **MobX 6.13.7** - Reactive state management
- **MobX React Lite 4.1.0** - React bindings for MobX

### UI Framework & Styling
- **Tailwind CSS 4.1.12** - Utility-first CSS framework
- **Radix UI Components** - Accessible, unstyled UI components
  - `@radix-ui/react-checkbox` - Checkbox components
  - `@radix-ui/react-label` - Label components
  - `@radix-ui/react-slot` - Composition utilities
- **Tailwind Merge 3.3.1** - Merge Tailwind classes intelligently
- **Class Variance Authority 0.7.1** - Type-safe component variants
- **Lucide React 0.536.0** - Beautiful icon library

### Form Components
- **React Day Picker 9.8.1** - Advanced date picker component

### Testing Framework
- **Playwright 1.54.2** - End-to-end testing
- **@axe-core/playwright 4.10.2** - Accessibility testing
- **jsdom 26.1.0** - DOM implementation for testing

### Development Tools
- **ESLint 9.32.0** - Code linting and style enforcement
- **TypeScript ESLint** - TypeScript-specific linting rules
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
│   ├── ui/              # Base UI components (buttons, inputs, etc.)
│   ├── focus/           # Focus management components
│   └── __tests__/       # Component tests
├── contexts/            # React contexts
│   └── focus/           # Focus management context and providers
├── hooks/               # Custom React hooks
│   ├── useDropdownBlur.ts     # Dropdown timing management
│   ├── useScrollToElement.ts  # Scroll animation utilities
│   ├── useAutoScroll.ts       # Auto-scroll behavior
│   ├── useDebounce.ts         # Input debouncing
│   └── useViewModel.ts        # MobX integration
├── views/               # Page-level components
│   ├── client/          # Client management views
│   └── medication/      # Medication management views
├── viewModels/          # MobX state management
│   ├── client/          # Client-related state
│   └── medication/      # Medication-related state
├── services/            # API and data services
│   ├── api/             # API interfaces
│   ├── mock/            # Mock implementations
│   └── validation/      # Data validation utilities
├── types/               # TypeScript type definitions
│   └── models/          # Domain model types
├── config/              # Configuration files
│   └── timings.ts       # Centralized timing configuration
├── mocks/               # Mock data for development
└── utils/               # Utility functions

docs/
├── README.md                  # Main documentation (this file)
├── testing-strategies.md      # Testing patterns and strategies
├── ui-patterns.md            # UI architecture and patterns
└── focus-management/         # Focus management documentation

e2e/                     # End-to-end tests
├── medication-entry.spec.ts   # Comprehensive test suite
└── [other test files]         # Specialized test scenarios
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
- **Centralized Timing**: All delays configured in `/src/config/timings.ts`
- **Test-Friendly**: Automatic 0ms delays in test environment
- **Standardized Hooks**: Use `useDropdownBlur` and `useScrollToElement` for common patterns
- **Focus Management**: Use React lifecycle hooks instead of setTimeout for focus changes

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

---

For specific implementation details, refer to the specialized documentation files in this directory or examine the source code with its comprehensive inline documentation.