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
├── components/     # UI layer - Reusable UI components
├── pages/          # Routing layer - Route-level components (auth, clients, medications, orgs)
├── views/          # Presentation layer - Feature-specific view components
├── viewModels/     # State management layer - MobX stores
├── services/       # Data access layer - API clients and business logic
├── types/          # Type definitions - TypeScript interfaces and models
├── hooks/          # Custom React hooks - Reusable stateful logic
├── utils/          # Utility functions - Pure helper functions
├── contexts/       # React contexts - Cross-component state providers
├── constants/      # Application constants - Static configuration values
├── lib/            # Shared libraries - Event bus, utilities
├── mocks/          # Mock data - Development and testing fixtures
├── data/           # Static data - Static application data files
├── config/         # Application configuration - Environment-based config
├── styles/         # Global styles - CSS and theme configuration
├── test/           # Test utilities - Shared testing helpers and setup
└── examples/       # Example components - Reference implementations and demos
```

### Directory Purposes

**Routing vs Presentation Architecture:**
- **pages/**: Route-level components that define what renders at each URL path. These are thin wrappers that connect routes to views.
  - Example: `pages/clients/ClientListPage.tsx` renders at `/clients`
- **views/**: Presentation components that contain the actual UI logic and interact with ViewModels.
  - Example: `views/client/ClientList.tsx` is the actual component with business logic

**State Management:**
- **viewModels/**: MobX observable stores that manage application state
- **contexts/**: React Context providers for cross-component state (auth, theme, etc.)

**Shared Libraries:**
- **lib/**: Shared functionality like event bus, custom utilities
- **hooks/**: Reusable React hooks for stateful logic
- **utils/**: Pure utility functions with no side effects

## Data Flow

1. **User Interaction** → Component
2. **Component** → ViewModel (via actions)
3. **ViewModel** → Service (for data operations)
4. **Service** → API/Mock Implementation
5. **API Response** → ViewModel (state update)
6. **ViewModel State Change** → Component Re-render (MobX reactivity)

This architecture ensures separation of concerns, testability, and maintainability while providing excellent user experience and developer productivity.
