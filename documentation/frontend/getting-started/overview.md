---
status: current
last_updated: 2026-02-10
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: High-level overview of the A4C Frontend architecture, covering React 19 + TypeScript stack, MobX state management, CQRS query patterns, three authentication modes (mock, integration, production), and accessibility-first development approach.

**When to read**:
- Starting frontend development for the first time
- Understanding the overall architecture and technology choices
- Finding the right documentation for specific tasks
- Onboarding new developers to the project

**Prerequisites**: Basic React and TypeScript knowledge

**Key topics**: `react`, `typescript`, `mobx`, `vite`, `tailwind`, `architecture`, `authentication`, `cqrs`, `accessibility`, `getting-started`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# Frontend Getting Started - Overview

Welcome to the A4C Frontend development guide. This document provides a high-level architectural overview and navigation guide for frontend development.

## Architecture Overview

The A4C Frontend is a modern React application built for healthcare professionals to manage client medication profiles with a focus on accessibility, maintainability, and developer experience.

### Technology Stack

#### Core Technologies

- **React 19.1.1**: Latest React with concurrent features
- **TypeScript 5.9.2**: Strict mode enabled for type safety
- **Vite 7.0.6**: Fast build tool with hot module replacement
- **MobX 6.13.7**: Reactive state management with ViewModels
- **Tailwind CSS 4.1.12**: Utility-first styling framework
- **React Router DOM 7.8.2**: Declarative routing

#### UI Components

- **Radix UI Primitives**: Accessible component foundations (@radix-ui)
- **Lucide React**: Icon library
- **Tailwind Animate**: Animation utilities
- **Custom Components**: Unified, accessible UI components

#### Testing & Quality

- **Vitest**: Unit testing framework
- **Playwright 1.54.2**: End-to-end testing with accessibility validation
- **ESLint**: Code linting with TypeScript rules
- **TypeScript Compiler**: Strict type checking

### Application Structure

```
frontend/src/
├── components/          # Reusable UI components
│   ├── ui/             # Base UI primitives (button, input, dropdown)
│   ├── auth/           # Authentication components
│   ├── debug/          # Development debugging tools
│   ├── layouts/        # Layout components
│   └── medication/     # Domain-specific components
├── pages/              # Page-level routing components
│   ├── auth/           # Authentication pages
│   ├── clients/        # Client management pages
│   └── medications/    # Medication management pages
├── views/              # Feature-specific view components
│   ├── client/         # Client-related views
│   └── medication/     # Medication-related views
├── viewModels/         # MobX ViewModels for state management
│   ├── client/         # Client state management
│   └── medication/     # Medication state management
├── services/           # API interfaces and implementations
│   ├── api/            # API interfaces and implementations
│   ├── mock/           # Mock API implementations
│   ├── data/           # Data access services
│   ├── validation/     # Data validation utilities
│   ├── search/         # Search functionality
│   ├── http/           # HTTP client utilities
│   ├── adapters/       # External service adapters
│   └── cache/          # Caching implementations
├── contexts/           # React contexts and providers
├── hooks/              # Custom React hooks
├── config/             # Application configuration
│   ├── timings.ts      # Centralized timing configuration
│   ├── logging.config.ts # Logging system configuration
│   ├── mobx.config.ts  # MobX debugging configuration
│   └── oauth.config.ts # Authentication configuration
├── types/              # TypeScript type definitions
│   ├── models/         # Domain model types
│   └── generated/      # Auto-generated types (event schemas)
├── utils/              # Utility functions
├── data/               # Static data and configurations
├── mocks/              # Mock data for development
└── styles/             # CSS and styling files
```

### Key Architectural Patterns

#### 1. MVVM Pattern

The application follows Model-View-ViewModel architecture:

- **Models**: TypeScript interfaces and domain types (`types/models/`)
- **Views**: React components (`components/`, `pages/`, `views/`)
- **ViewModels**: MobX observables handling business logic (`viewModels/`)

```typescript
// ViewModel handles state and logic
class MedicationViewModel {
  @observable selectedMedication: Medication | null = null;

  @action
  selectMedication(med: Medication) {
    this.selectedMedication = med;
  }
}

// View observes ViewModel
export const MedicationView = observer(({ vm }: { vm: MedicationViewModel }) => {
  return <div>{vm.selectedMedication?.name}</div>;
});
```

#### 2. CQRS Query Pattern

**CRITICAL**: All data queries MUST use RPC functions from the `api` schema.

```typescript
// ✅ CORRECT: RPC function call (CQRS pattern)
const { data, error } = await client
  .schema('api')
  .rpc('list_users', {
    p_org_id: claims.org_id,
    p_status: statusFilter,
    p_search_term: searchTerm,
  });

// ❌ INCORRECT: Direct table query with embedding
const { data } = await client
  .from('users')
  .select('*, user_roles_projection(*)')
  .eq('organization_id', orgId);
```

**Why RPC functions are required**:
- Projections are denormalized read models
- RPC functions encapsulate query logic in database
- Consistent pattern across all services
- Better performance and maintainability

#### 3. Authentication Architecture

The application supports three authentication modes through dependency injection:

##### Mock Mode (Default for Local Development)

```bash
npm run dev  # No credentials needed
```

- Instant authentication without network calls
- Complete JWT claims structure for testing
- Predefined user profiles (super_admin, provider_admin, clinician)
- **Use for**: UI development, component testing

##### Integration Mode (Real Auth Testing)

```bash
npm run dev:auth  # Requires .env.local with Supabase credentials
```

- Real OAuth flows with Google/GitHub
- Real JWT tokens from Supabase
- Custom claims from database hooks
- **Use for**: Testing authentication, OAuth flows, RLS policies

##### Production Mode

Automatically selected in production builds.

**JWT Custom Claims Structure**:

```typescript
interface JWTClaims {
  sub: string;                    // User UUID
  email: string;
  org_id: string;                 // Organization UUID (for RLS)
  org_type: string;               // Organization type
  effective_permissions: Array<{  // Scoped permissions
    p: string;                    // Permission name
    s: string;                    // Scope path (ltree)
  }>;
  claims_version: number;         // Currently 4
  access_blocked?: boolean;
  current_org_unit_id?: string | null;
  current_org_unit_path?: string | null;
}
```

**Provider Interface Pattern**:

All authentication accessed through `IAuthProvider` interface for easy testing and mocking:

```typescript
// ✅ GOOD - Uses abstraction
import { getAuthProvider } from '@/services/auth/AuthProviderFactory';
const auth = getAuthProvider();
const user = await auth.getUser();

// ❌ BAD - Direct dependency
import { SupabaseAuthProvider } from './SupabaseAuthProvider';
```

#### 4. State Management with MobX

MobX provides reactive state management with observables:

**Critical Rules**:

1. Always wrap components with `observer` HOC
2. Never spread observable arrays in props
3. Use immutable updates (replace, don't mutate)
4. Use `runInAction` for multiple state updates

```typescript
// ✅ CORRECT: Pass observable directly
<CategorySelection
  selectedClasses={vm.selectedTherapeuticClasses}
/>

// ❌ INCORRECT: Spreading breaks reactivity
<CategorySelection
  selectedClasses={[...vm.selectedTherapeuticClasses]}
/>

// ✅ CORRECT: Immutable update
runInAction(() => {
  this.items = [...this.items, newItem];
});

// ❌ INCORRECT: Direct mutation
this.items.push(newItem);
```

#### 5. Accessibility-First Development

All components meet **WCAG 2.1 Level AA** compliance:

- Full keyboard navigation required
- Proper ARIA attributes on all interactive elements
- Focus management with tab order
- Screen reader compatibility
- Color contrast ratios: 4.5:1 (normal text), 3:1 (large text)

**Required ARIA Attributes**:
- `role` for non-semantic elements
- `aria-label` or `aria-labelledby` for all interactive elements
- `aria-describedby` for help text
- `aria-expanded` for expandable elements
- `aria-selected` for selectable items
- `aria-disabled` for disabled states
- `aria-invalid` and `aria-errormessage` for form errors

#### 6. Service Session Management

**CRITICAL**: Never cache sessions manually. Always retrieve sessions directly from Supabase:

```typescript
// ✅ CORRECT: Retrieve session from Supabase client
async getUsersPaginated(): Promise<PaginatedResult<UserListItem>> {
  const client = supabaseService.getClient();

  // Get session directly from Supabase
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

// ❌ WRONG: Manual session cache - will fail silently
const session = supabaseService.getCurrentSession();  // Returns NULL!
if (!session?.claims.org_id) {
  return { items: [] };  // Silent failure
}
```

## Development Workflow

### Quick Start Commands

```bash
# Install dependencies
npm install

# Start development server (mock auth)
npm run dev

# Start with real auth
npm run dev:auth

# Build for production
npm run build

# Run type checking
npm run typecheck

# Run linting
npm run lint

# Run tests
npm run test              # Unit tests
npm run test:e2e          # End-to-end tests
npm run test:e2e:ui       # E2E with UI

# Validate documentation
npm run docs:check
```

### Before Committing

```bash
# Run all quality checks
npm run typecheck
npm run lint
npm run docs:check
npm run build
npm run test
```

### Key Development Practices

1. **Component Development**:
   - Create accessible components with WCAG 2.1 AA compliance
   - Document components using templates from `documentation/templates/`
   - Wrap all reactive components with `observer`

2. **ViewModel Development**:
   - Use MobX decorators: `@observable`, `@action`, `@computed`
   - Replace arrays/objects instead of mutating
   - Use `runInAction` for async updates

3. **Service Development**:
   - Implement service interfaces for dependency injection
   - Always use `api.` schema RPC functions for queries
   - Retrieve sessions directly from Supabase client

4. **Testing**:
   - Write unit tests for ViewModels
   - Write E2E tests for complete user flows
   - Test keyboard navigation and accessibility

## Configuration Management

### Centralized Timing Configuration

All timing delays defined in `/src/config/timings.ts`:

- Automatically set to 0ms in test environment
- Search debouncing: 300-500ms
- Dropdown blur delays: 200ms
- Animation timings

**Use custom hooks instead of raw `setTimeout`**:

```typescript
// ✅ GOOD: Use custom hook
import { useDropdownBlur } from '@/hooks/useDropdownBlur';
const handleBlur = useDropdownBlur(setShow);

// ❌ BAD: Raw setTimeout
onBlur={() => setTimeout(() => setShow(false), 200)}
```

### Environment Variables

```bash
# .env.local - Real Supabase auth
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_BACKEND_API_URL=https://api-a4c.firstovertheline.com

# Optional: Force mock mode
# VITE_FORCE_MOCK=true
```

### Logging and Debugging

Configuration-driven logging system in `/src/config/logging.config.ts`:

- **Development**: Full logging enabled
- **Test**: Minimal logging (errors only)
- **Production**: Disabled by default

**Debug Tools**:
- Press `Ctrl+Shift+D` to open debug control panel
- Press `Ctrl+Shift+M` to toggle MobX monitor
- Press `Ctrl+Shift+P` to toggle performance monitor

## Component Patterns

### UI Components Decision Tree

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

### Unified Component Pattern

Create single, reusable components for similar functionality:

- **MultiSelectDropdown**: For all multi-select needs
- **SearchableDropdown**: For large datasets with search
- **EditableDropdown**: For editable selections

**Key Implementation Notes**:
- Pass MobX observables directly (never spread arrays)
- Use proper tabIndex sequencing for keyboard navigation
- Include all required ARIA attributes
- Follow unified highlighting pattern

## Documentation Requirements

### Definition of Done

All code must meet documentation standards before considered complete:

1. **Component Documentation**:
   - Complete Props Interface with exact TypeScript matching
   - Usage examples (basic and advanced)
   - Accessibility compliance details
   - ARIA attributes and keyboard navigation patterns

2. **ViewModel Documentation**:
   - Observable properties with types
   - Action methods with parameters and return types
   - Computed properties and dependencies
   - Usage patterns and integration examples

3. **Validation**:
   - Run `npm run docs:check` before committing
   - Zero high-priority alignment issues required
   - 100% component coverage required

## Navigation Guide

### Getting Started

- **[Installation Guide](./installation.md)** - Set up development environment
- **[Local Development Guide](./local-development.md)** - Development workflow and best practices
- **[Validation Guide](./validation-guide.md)** - Documentation validation and quality checks

### Architecture Documentation

- **[Frontend Auth Architecture](../../architecture/authentication/frontend-auth-architecture.md)** - Complete authentication implementation
- **[RBAC Architecture](../../architecture/authorization/rbac-architecture.md)** - Role-based access control
- **[Multi-Tenancy Architecture](../../architecture/data/multi-tenancy-architecture.md)** - Organization isolation with RLS
- **[Event Sourcing Overview](../../architecture/data/event-sourcing-overview.md)** - CQRS and domain events

### Implementation Guides

- **[Event-Driven Guide](../guides/EVENT-DRIVEN-GUIDE.md)** - CQRS patterns in React
- **[Design Patterns Migration Guide](../guides/DESIGN_PATTERNS_MIGRATION_GUIDE.md)** - Component design patterns
- **[Testing Guide](../testing/TESTING.md)** - Testing strategies and methodologies

### Reference Documentation

- **[Components Reference](../reference/components/)** - Component documentation
- **[ViewModels Reference](../reference/viewmodels/)** - ViewModel documentation
- **[Frontend CLAUDE.md](/home/lars/dev/A4C-AppSuite/frontend/CLAUDE.md)** - Detailed development guidelines
- **[Frontend README](/home/lars/dev/A4C-AppSuite/frontend/README.md)** - Project overview

## Key Features

### Medication Management

- Real-time medication search with debouncing
- Complex dosage configuration (forms, amounts, frequencies)
- Therapeutic category selection with multi-select
- Date management with calendar integration
- Medication history tracking

### Client Management

- Client selection interface
- Client-specific medication tracking
- Client profile management

### Form Infrastructure

- Complex multi-step forms with validation
- Accessible form controls with ARIA labels
- Complete keyboard navigation
- Focus trapping in modals
- Error handling and validation

### Developer Experience

- Hot module replacement in development
- Comprehensive TypeScript coverage
- Zero-configuration development setup
- Automated accessibility testing
- Built-in debugging tools

## Common Issues and Solutions

### MobX Reactivity Not Working

1. Ensure components wrapped with `observer`
2. Check for array spreading breaking observable chain
3. Use immutable updates in ViewModels
4. Enable MobX debugging: `Ctrl+Shift+M`

### Authentication Issues

1. Check environment variables configured correctly
2. Verify Supabase credentials (integration mode)
3. Clear browser cache and localStorage
4. Check JWT claims in session

### Type Errors

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
- All components documented
- Props interfaces match exactly
- Required sections present

## Related Documentation

### Essential Reading

- **[Frontend Auth Architecture](../../architecture/authentication/frontend-auth-architecture.md)** - Complete authentication system
- **[Event-Driven Guide](../guides/EVENT-DRIVEN-GUIDE.md)** - CQRS patterns in React
- **[Design Patterns Migration Guide](../guides/DESIGN_PATTERNS_MIGRATION_GUIDE.md)** - Component patterns

### Additional Resources

- **[Frontend CLAUDE.md](/home/lars/dev/A4C-AppSuite/frontend/CLAUDE.md)** - AI assistant guidance (comprehensive)
- **[Frontend README](/home/lars/dev/A4C-AppSuite/frontend/README.md)** - Project overview
- **[Root CLAUDE.md](/home/lars/dev/A4C-AppSuite/CLAUDE.md)** - Monorepo overview

## Getting Help

- Check existing documentation in `documentation/frontend/`
- Review component examples in `src/components/`
- Consult architecture docs in `documentation/architecture/`
- See `frontend/CLAUDE.md` for detailed development guidance

---

**Next Steps**: Start with the [Installation Guide](./installation.md) to set up your development environment, then proceed to [Local Development Guide](./local-development.md) for workflow details.
