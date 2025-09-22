# Architecture Overview

This document provides a high-level overview of the A4C-FrontEnd architecture.

## System Architecture

The A4C-FrontEnd application follows a modern React architecture with the following key patterns:

### MVVM (Model-View-ViewModel) Pattern

- **Models**: Data types and interfaces (`src/types/`)
- **Views**: React components (`src/components/`, `src/views/`)
- **ViewModels**: MobX state management (`src/viewModels/`)

### Component Architecture

- **UI Components**: Reusable base components (`src/components/ui/`)
- **Feature Components**: Domain-specific components (`src/views/`)
- **Layout Components**: Application structure (`src/components/layouts/`)

### State Management

- **MobX**: Reactive state management for complex business logic
- **React Context**: Cross-component state sharing
- **Local State**: Component-specific state with useState

### Service Layer

- **API Services**: Data access interfaces (`src/services/api/`)
- **Mock Services**: Development and testing implementations (`src/services/mock/`)
- **Validation Services**: Data validation utilities (`src/services/validation/`)

## Technology Stack

- **React 19.1.1**: Modern React with latest features
- **TypeScript 5.9.2**: Type-safe development
- **MobX 6.13.7**: Reactive state management
- **Vite 7.0.6**: Fast build tool and development server
- **Tailwind CSS 4.1.12**: Utility-first styling
- **Playwright 1.54.2**: End-to-end testing

## Design Principles

### Accessibility First

- WCAG 2.1 Level AA compliance
- Full keyboard navigation support
- Screen reader compatibility
- Focus management and ARIA attributes

### Performance Optimization

- Component memoization where appropriate
- Debounced user inputs
- Efficient MobX observable patterns
- Tree-shaking and code splitting

### Developer Experience

- TypeScript strict mode
- Comprehensive testing with Playwright
- Hot module replacement in development
- Automated linting and formatting

## Module Dependencies

```
src/
├── components/     # UI layer
├── views/         # Feature layer
├── viewModels/    # State management layer
├── services/      # Data access layer
├── types/         # Type definitions
├── hooks/         # Custom React hooks
├── utils/         # Utility functions
└── config/        # Application configuration
```

## Data Flow

1. **User Interaction** → Component
2. **Component** → ViewModel (via actions)
3. **ViewModel** → Service (for data operations)
4. **Service** → API/Mock Implementation
5. **API Response** → ViewModel (state update)
6. **ViewModel State Change** → Component Re-render (MobX reactivity)

This architecture ensures separation of concerns, testability, and maintainability while providing excellent user experience and developer productivity.
