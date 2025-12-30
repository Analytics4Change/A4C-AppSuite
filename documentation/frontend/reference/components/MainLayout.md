---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Primary application layout with header, sidebar, and content areas using React Router Outlet pattern, responsive design, and proper ARIA landmarks.

**When to read**:
- Understanding application layout structure
- Configuring sidebar behavior and navigation
- Implementing responsive mobile layouts
- Adding semantic landmarks for accessibility

**Prerequisites**: None

**Key topics**: `layout`, `sidebar`, `navigation`, `responsive`, `react-router`, `landmarks`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# MainLayout

## Overview

The primary layout component for the application that provides a consistent structure with navigation, header, sidebar, and main content areas. This component implements responsive design patterns and accessibility features while serving as the wrapper for all authenticated pages.

## Props Interface

```typescript
// MainLayout uses React Router's Outlet pattern and doesn't require props
interface MainLayoutProps {
  // No props required - layout is controlled via context and routing
}
```

## Usage Examples

### Basic Layout Usage

```tsx
// In your router configuration
import { createBrowserRouter } from 'react-router-dom';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { MainLayout } from '@/components/layouts/MainLayout';

const router = createBrowserRouter([
  {
    path: '/',
    element: <ProtectedRoute />,
    children: [
      {
        element: <MainLayout />,
        children: [
          {
            path: 'dashboard',
            element: <DashboardPage />
          },
          {
            path: 'medications',
            element: <MedicationsPage />
          },
          {
            path: 'clients',
            element: <ClientsPage />
          }
        ]
      }
    ]
  }
]);
```

### Advanced Usage with Layout Context

```tsx
// Using layout with context for sidebar control
import { MainLayout } from '@/components/layouts/MainLayout';
import { LayoutProvider } from '@/contexts/LayoutContext';

function App() {
  return (
    <LayoutProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ProtectedRoute />}>
            <Route element={<MainLayout />}>
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="medications" element={<MedicationsPage />} />
              <Route path="clients" element={<ClientsPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </LayoutProvider>
  );
}
```

### Customizing Layout Behavior

```tsx
// Accessing layout controls within pages
import { useLayout } from '@/contexts/LayoutContext';

function DashboardPage() {
  const { sidebarOpen, setSidebarOpen, isMobile } = useLayout();

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <div className="dashboard-page">
      {isMobile && (
        <button onClick={toggleSidebar} className="mobile-menu-toggle">
          Toggle Menu
        </button>
      )}
      
      <h1>Dashboard</h1>
      {/* Page content */}
    </div>
  );
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Navigation Structure**:
  - Semantic HTML landmarks (`nav`, `main`, `header`, `aside`)
  - Proper heading hierarchy (h1 → h2 → h3)
  - Skip links for keyboard navigation
  - ARIA navigation landmarks

- **ARIA Attributes**:
  - `role="banner"` for header
  - `role="navigation"` for main navigation
  - `role="main"` for content area
  - `role="complementary"` for sidebar
  - `aria-expanded` for collapsible sidebar
  - `aria-current="page"` for active navigation items

- **Keyboard Navigation**:
  - Tab order: Header → Main Navigation → Content → Sidebar
  - Skip links to bypass repetitive navigation
  - Focus management for mobile menu
  - Escape key closes mobile sidebar

### Screen Reader Support

- Logical reading order and navigation flow
- Navigation landmarks clearly identified
- Page structure communicated effectively
- Dynamic content changes announced

## Styling

### CSS Classes

- `.main-layout`: Primary layout container
- `.main-layout__header`: Header area styling
- `.main-layout__nav`: Main navigation styling
- `.main-layout__sidebar`: Sidebar styling
- `.main-layout__content`: Main content area
- `.main-layout__footer`: Footer area (if present)
- `.main-layout--sidebar-open`: Open sidebar state
- `.main-layout--sidebar-closed`: Closed sidebar state
- `.main-layout--mobile`: Mobile layout modifications

### Responsive Design

```css
/* Desktop layout */
.main-layout {
  display: grid;
  grid-template-areas: 
    "header header"
    "sidebar content";
  grid-template-columns: 250px 1fr;
  grid-template-rows: auto 1fr;
}

/* Mobile layout */
@media (max-width: 768px) {
  .main-layout {
    grid-template-areas: 
      "header"
      "content";
    grid-template-columns: 1fr;
  }
  
  .main-layout__sidebar {
    position: fixed;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
  }
  
  .main-layout--sidebar-open .main-layout__sidebar {
    transform: translateX(0);
  }
}
```

### Glassmorphic Design

The layout implements glassmorphic design principles:

- Semi-transparent backgrounds with backdrop blur
- Subtle border effects
- Layered visual hierarchy
- Smooth transitions and animations

## Implementation Notes

### Design Patterns

- **Layout Wrapper Pattern**: Provides consistent structure for all pages
- **Outlet Pattern**: Uses React Router's Outlet for nested routing
- **Responsive Design**: Mobile-first approach with progressive enhancement
- **Context Integration**: Works with layout context for state management

### Navigation Structure

```typescript
const navItems = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: HomeIcon,
    current: false
  },
  {
    name: 'Medications',
    href: '/medications',
    icon: PillIcon,
    current: false
  },
  {
    name: 'Clients',
    href: '/clients',
    icon: UsersIcon,
    current: false
  }
];
```

### Sidebar Behavior

- **Desktop**: Persistent sidebar with toggle capability
- **Mobile**: Overlay sidebar with touch/swipe gestures
- **State Persistence**: Sidebar state preserved across navigation
- **Focus Management**: Proper focus handling during sidebar transitions

### Dependencies

- React Router v6+ for outlet functionality
- Lucide React for navigation icons
- Layout context for state management
- Authentication context for user information

### Performance Considerations

- Lazy loading of sidebar content
- Efficient re-rendering with React.memo
- Optimized responsive breakpoint handling
- Minimal layout shift during transitions

## Testing

### Unit Tests

Located in `MainLayout.test.tsx`. Covers:

- Layout structure rendering
- Navigation item rendering and interaction
- Responsive behavior simulation
- Accessibility attribute presence
- Sidebar state management

### E2E Tests

Covered in application navigation tests:

- Complete navigation workflows
- Mobile sidebar interaction
- Keyboard navigation through layout
- Screen reader compatibility
- Focus management during navigation

## Related Components

- `ProtectedRoute` - Often wraps MainLayout for authentication
- `Header` - Header component within the layout
- `Sidebar` - Sidebar navigation component
- `Footer` - Footer component (if implemented)

## Layout Variants

### Different Layout Configurations

```tsx
// Full sidebar layout (default)
<MainLayout variant="full-sidebar" />

// Collapsed sidebar layout
<MainLayout variant="collapsed-sidebar" />

// No sidebar layout
<MainLayout variant="no-sidebar" />

// Mobile-optimized layout
<MainLayout variant="mobile-optimized" />
```

### Theme Integration

```tsx
// Layout with theme support
import { useTheme } from '@/contexts/ThemeContext';

function ThemedMainLayout() {
  const { theme } = useTheme();
  
  return (
    <div className={`main-layout main-layout--${theme}`}>
      {/* Layout content */}
    </div>
  );
}
```

## Customization

### Layout Configuration

```typescript
interface LayoutConfig {
  sidebarWidth: number;           // Sidebar width in pixels
  headerHeight: number;           // Header height in pixels
  mobileBreakpoint: number;       // Mobile breakpoint in pixels
  sidebarCollapsible: boolean;    // Allow sidebar collapse
  stickyHeader: boolean;          // Fixed header behavior
  footerEnabled: boolean;         // Show footer
}
```

### Custom Navigation Items

```typescript
// Adding custom navigation items
const customNavItems = [
  ...defaultNavItems,
  {
    name: 'Reports',
    href: '/reports',
    icon: ChartIcon,
    badge: '3',                   // Optional badge
    children: [                   // Optional submenu
      { name: 'Monthly', href: '/reports/monthly' },
      { name: 'Annual', href: '/reports/annual' }
    ]
  }
];
```

## Changelog

- Initial implementation with basic layout structure
- Added responsive design and mobile support
- Enhanced accessibility features and ARIA landmarks
- Implemented glassmorphic design elements
- Added sidebar state management
- Improved keyboard navigation and focus management
- Added support for layout variants and customization
