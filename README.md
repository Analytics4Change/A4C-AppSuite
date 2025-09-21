# A4C-FrontEnd

A React-based medication management application for healthcare professionals, deployed with modern CI/CD practices.

🌐 **Live Application**: [https://a4c.firstovertheline.com](https://a4c.firstovertheline.com)

## Overview

A4C-FrontEnd is a sophisticated healthcare application designed for managing client medication profiles. The application provides healthcare professionals with tools to:

- Manage client profiles and medication history
- Search and select medications with comprehensive drug databases
- Configure detailed dosage forms and administration schedules
- Handle complex medication categorization and validation
- Maintain WCAG 2.1 AA accessibility compliance

## Technology Stack

- **React 19.1.1** with TypeScript 5.9.2
- **Vite 7.0.6** for fast development and building
- **MobX 6.13.7** for reactive state management
- **Tailwind CSS 4.1.12** with Radix UI components
- **Playwright 1.54.2** for E2E testing with accessibility validation

## Quick Start

### Prerequisites

- Node.js 18+ 
- npm package manager

### Local Development

```bash
# Clone and install
git clone https://github.com/lars-tice/A4C-FrontEnd.git
cd A4C-FrontEnd
npm install

# Start development server
npm run dev
# Application runs at http://localhost:5173

# Build for production
npm run build

# Run type checking
npm run typecheck

# Run linting
npm run lint
```

### Testing

```bash
# Run E2E tests
npm run test:e2e

# Run tests with UI
npm run test:e2e:ui

# Run tests in headed mode
npm run test:e2e:headed
```

## Architecture

### Project Structure

```
src/
├── components/           # Reusable UI components
│   ├── ui/              # Base components (button, input, dropdown)
│   └── debug/           # Development debugging tools
├── contexts/            # React contexts and providers
├── hooks/               # Custom React hooks
├── views/               # Feature-specific components
│   ├── client/          # Client management
│   └── medication/      # Medication management
├── viewModels/          # MobX state management
├── services/            # API interfaces and implementations
├── types/               # TypeScript definitions
├── config/              # Application configuration
└── utils/               # Utility functions
```

### Key Patterns

- **MVVM Architecture**: MobX ViewModels handle business logic, React Views handle presentation
- **Accessibility First**: WCAG 2.1 AA compliance with comprehensive keyboard navigation
- **Component Composition**: Unified components like `MultiSelectDropdown` for consistency
- **Test-Driven Development**: E2E testing with Playwright and accessibility validation

## Deployment

### CI/CD Pipeline

The application uses GitHub Actions for automated deployment:

- **Build**: TypeScript compilation, React build, Docker containerization
- **Deploy**: Automated deployment to k3s cluster via Cloudflare Tunnel
- **Health Checks**: Automated verification of deployment success

### Infrastructure

- **Container Registry**: GitHub Container Registry (GHCR)
- **Orchestration**: k3s Kubernetes cluster
- **Access**: Cloudflare Tunnel for secure external access
- **Authentication**: Machine user (`analytics4change-ghcr-bot`) for automated deployments

### Manual Deployment

```bash
# Build and push container
docker build -t ghcr.io/analytics4change/a4c-frontend:latest .
docker push ghcr.io/analytics4change/a4c-frontend:latest

# Deploy to k3s
kubectl apply -f k8s/deployment.yaml
kubectl rollout status deployment/a4c-frontend
```

## Development Guidelines

### State Management

```typescript
// ✅ CORRECT: Pass MobX observables directly
<CategorySelection 
  selectedClasses={vm.selectedTherapeuticClasses} 
/>

// ❌ INCORRECT: Spreading breaks reactivity
<CategorySelection 
  selectedClasses={[...vm.selectedTherapeuticClasses]} 
/>
```

### Accessibility Requirements

- All interactive elements must be keyboard accessible
- ARIA labels required for all form controls
- Focus management with proper tab order
- Screen reader compatibility tested

### Timing Patterns

```typescript
// ✅ Use centralized timing configuration
import { TIMINGS } from '@/config/timings';
import { useDropdownBlur } from '@/hooks/useDropdownBlur';

// ❌ Avoid raw setTimeout for UI interactions
setTimeout(() => setShow(false), 200); // DON'T DO THIS
```

## Key Features

### Medication Management
- Real-time medication search with debouncing
- Complex dosage configuration (forms, amounts, frequencies)
- Therapeutic category selection with multi-select support
- Date management with calendar integration

### User Experience
- Responsive mobile-first design
- Full keyboard navigation support
- Loading states and error handling
- Multi-step form management

### Developer Experience
- Hot module replacement in development
- Comprehensive TypeScript coverage
- Automated accessibility testing
- Zero-configuration deployment pipeline

## Debugging

### Development Tools

Press `Ctrl+Shift+D` to access the debug control panel:

- **MobX Monitor** (`Ctrl+Shift+M`): Visualize reactive state
- **Performance Monitor** (`Ctrl+Shift+P`): Track rendering metrics
- **Accessibility Audits**: Built-in axe-core validation

### Common Issues

**MobX Reactivity Not Working:**
1. Ensure components are wrapped with `observer`
2. Check for array spreading breaking observable chain
3. Use immutable updates in ViewModels
4. Verify parent components are also wrapped with `observer`

## Documentation

- **[Technical Documentation](./docs/README.md)** - Comprehensive technical details
- **[Testing Strategies](./docs/testing-strategies.md)** - Testing patterns and methodologies
- **[UI Patterns](./docs/ui-patterns.md)** - Component architecture guidelines
- **[CLAUDE.md](./CLAUDE.md)** - AI assistant project instructions

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Quality

- TypeScript strict mode enabled
- ESLint with TypeScript rules
- Husky git hooks for quality gates
- Automated dependency vulnerability scanning

## Production Monitoring

The live application includes:

- Health check endpoints for monitoring
- Performance tracking and optimization
- Error boundary implementation
- Accessibility compliance validation

---

**Repository**: [GitHub](https://github.com/lars-tice/A4C-FrontEnd)  
**Live Application**: [https://a4c.firstovertheline.com](https://a4c.firstovertheline.com)  
**License**: ISC