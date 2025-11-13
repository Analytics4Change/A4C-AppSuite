---
status: current
last_updated: 2025-01-13
---

# Installation Guide

This guide will help you set up the A4C-FrontEnd development environment.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js 18+**: Download from [nodejs.org](https://nodejs.org/)
- **npm**: Comes with Node.js (use latest version)
- **Git**: For version control
- **Modern web browser**: Chrome, Firefox, Safari, or Edge

## Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/Analytics4Change/A4C-FrontEnd.git
cd A4C-FrontEnd
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required dependencies including:

- React 19.1.1 and React DOM
- TypeScript 5.9.2
- MobX 6.13.7 for state management
- Vite 7.0.6 for development and building
- Tailwind CSS 4.1.12 for styling
- Playwright 1.54.2 for testing

### 3. Start Development Server

```bash
npm run dev
```

The application will be available at: <http://localhost:5173>

### 4. Verify Installation

To verify everything is working correctly:

1. **Check the application loads** in your browser
2. **Run type checking**: `npm run typecheck`
3. **Run linting**: `npm run lint`
4. **Run tests**: `npm run test:e2e`

## Development Environment Setup

### VSCode Extensions (Recommended)

- **TypeScript**: Built-in support
- **ESLint**: Code linting
- **Prettier**: Code formatting
- **Tailwind CSS IntelliSense**: CSS class suggestions
- **MobX DevTools**: State debugging

### Browser DevTools

- **React Developer Tools**: Component inspection
- **MobX Developer Tools**: State management debugging

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run typecheck` | Run TypeScript checks |
| `npm run lint` | Run ESLint |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run test:e2e:ui` | Run tests with UI |

## Environment Configuration

### Development Environment

No additional configuration needed. The application will run with:

- Hot module replacement enabled
- Development logging active
- Mock services for API calls

### Production Build

```bash
npm run build
npm run preview
```

The production build includes:

- Optimized bundle size
- Tree-shaking for unused code
- Minification and compression

## Troubleshooting

### Common Issues

**Port already in use:**

```bash
npm run dev -- --port 3000
```

**Type errors:**

```bash
npm run typecheck
```

**Dependency issues:**

```bash
rm -rf node_modules package-lock.json
npm install
```

**Testing issues:**

```bash
npx playwright install
```

### Getting Help

- Check the [README.md](../../README.md) for general information
- Review [DEVELOPMENT.md](../DEVELOPMENT.md) for development guidelines
- See [TESTING.md](../TESTING.md) for testing strategies

## Next Steps

After successful installation:

1. **Explore the codebase** starting with `src/main.tsx`
2. **Review the component library** in `src/components/ui/`
3. **Understand state management** in `src/viewModels/`
4. **Check out the testing examples** in `e2e/`
5. **Read the development guidelines** in the docs folder

Welcome to A4C-FrontEnd development! 🚀
