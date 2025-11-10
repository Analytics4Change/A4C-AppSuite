# Frontend Development Guidelines

---
description: |
  React 19 + TypeScript frontend development for A4C-AppSuite medication management application.

  Tech Stack: Radix UI primitives, Tailwind CSS with class-variance-authority, MobX state management,
  WCAG 2.1 Level AA accessibility, Supabase Auth with provider interface pattern.

  Key Patterns: Headless UI with Radix UI (Slot, Dialog, DropdownMenu, etc.), Tailwind styling with
  CVA for variants, MobX reactivity rules (observer HOC, never spread observables), three authentication
  modes (Mock/Integration/Production), focus management without setTimeout, centralized timing config.

  This skill provides navigation to deep-dive resources on Radix UI patterns, Tailwind styling,
  MobX state management, authentication, accessibility standards, testing strategies, and complete examples.
---

## Quick Start

### New Component Checklist
- [ ] Use Radix UI primitives (Dialog, DropdownMenu, Slot, etc.)
- [ ] Style with Tailwind CSS + class-variance-authority (CVA)
- [ ] Wrap with `observer()` HOC if using MobX observables
- [ ] Add ARIA labels for accessibility (aria-label, aria-describedby)
- [ ] Implement keyboard navigation (Tab, Enter, Escape, Arrow keys)
- [ ] Test with screen reader (NVDA/JAWS)
- [ ] Document component purpose, props, usage examples
- [ ] Run `npm run docs:check` to validate documentation

### New Feature Checklist
- [ ] Use `IAuthProvider` interface for authentication
- [ ] Add to centralized timing config (no magic numbers)
- [ ] Implement focus management with `useEffect` (not `setTimeout`)
- [ ] Never spread MobX observable arrays (`.slice()` or `[...toJS(array)]`)
- [ ] Add loading states with accessible announcements
- [ ] Handle errors with user-friendly messages
- [ ] Write unit tests (Vitest) and E2E tests (Playwright)
- [ ] Verify WCAG 2.1 Level AA compliance

## Common Imports

```typescript
// Radix UI Primitives
import { Slot } from "@radix-ui/react-slot";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Select from "@radix-ui/react-select";

// Styling
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// State Management
import { observer } from "mobx-react-lite";
import { makeAutoObservable, runInAction, toJS } from "mobx";

// Authentication
import { useAuth } from "@/providers/AuthProvider";
import type { IAuthProvider, Session } from "@/providers/IAuthProvider";

// React
import { forwardRef, useEffect, useRef, type ComponentPropsWithoutRef } from "react";
```

## Topic Summaries

### 1. Radix UI Patterns
Radix UI provides unstyled, accessible primitives. Use `Slot` for polymorphic components, compound components like `Dialog.Root/Trigger/Content` for modal behavior, and `DropdownMenu` for accessible menus.

**See**: [resources/radix-ui-patterns.md](resources/radix-ui-patterns.md)

### 2. Tailwind CSS + CVA Styling
Tailwind CSS for utility-first styling combined with class-variance-authority (CVA) for variant management. Define base styles, variants, and default variants in `cva()`, then merge with `cn()` utility.

**See**: [resources/tailwind-styling.md](resources/tailwind-styling.md)

### 3. MobX State Management
MobX for reactive state with strict rules: always wrap components with `observer()` HOC, never spread observable arrays (use `.slice()` or `toJS()`), use `runInAction()` for async updates after await.

**See**: [resources/mobx-state-management.md](resources/mobx-state-management.md)

### 4. Authentication Provider Pattern
`IAuthProvider` interface with three modes: Mock (instant dev), Integration (real OAuth), Production (Supabase Auth). Unified `Session` type with JWT claims (org_id, user_role, permissions, scope_path).

**See**: [resources/auth-provider-pattern.md](resources/auth-provider-pattern.md)

### 5. Accessibility Standards (WCAG 2.1 Level AA)
Healthcare compliance requires keyboard navigation, screen reader support, focus management, ARIA labels, color contrast (4.5:1), and error announcements. Test with NVDA/JAWS.

**See**: [resources/accessibility-standards.md](resources/accessibility-standards.md)

### 6. Testing Strategies
Unit tests with Vitest, E2E tests with Playwright, accessibility testing with manual keyboard navigation. Mock MobX stores, test async state transitions, verify focus management.

**See**: [resources/testing-strategies.md](resources/testing-strategies.md)

### 7. Complete Examples
Real-world examples: Button with variants, Dialog modal, DropdownMenu, authenticated form with MobX store, accessible loading states, error handling patterns.

**See**: [resources/complete-examples.md](resources/complete-examples.md)

## Navigation Table

| Resource | Focus | Lines |
|----------|-------|-------|
| [radix-ui-patterns.md](resources/radix-ui-patterns.md) | Slot, Dialog, DropdownMenu, Select, compound components | ~400 |
| [tailwind-styling.md](resources/tailwind-styling.md) | CVA variants, cn() utility, responsive design | ~350 |
| [mobx-state-management.md](resources/mobx-state-management.md) | observer HOC, never spread arrays, runInAction | ~450 |
| [auth-provider-pattern.md](resources/auth-provider-pattern.md) | IAuthProvider interface, three modes, JWT claims | ~400 |
| [accessibility-standards.md](resources/accessibility-standards.md) | WCAG 2.1 Level AA, keyboard nav, screen readers | ~450 |
| [testing-strategies.md](resources/testing-strategies.md) | Vitest, Playwright, accessibility testing | ~400 |
| [complete-examples.md](resources/complete-examples.md) | Button, Dialog, DropdownMenu, auth forms | ~450 |

## Core Principles

### 1. Headless UI with Radix UI
Use Radix UI primitives for accessible, unstyled components. Radix handles keyboard navigation, focus management, ARIA attributes, and screen reader announcements.

```typescript
// Use Radix UI Dialog for modals
<Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
  <Dialog.Trigger asChild>
    <button>Open Modal</button>
  </Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 bg-black/50" />
    <Dialog.Content className="fixed left-1/2 top-1/2 ...">
      <Dialog.Title>Modal Title</Dialog.Title>
      <Dialog.Description>Modal description</Dialog.Description>
      {/* Content */}
      <Dialog.Close asChild>
        <button>Close</button>
      </Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
```

### 2. Tailwind + CVA for Variants
Combine Tailwind utility classes with class-variance-authority for reusable variants.

```typescript
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent"
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-sm",
        lg: "h-10 px-8"
      }
    },
    defaultVariants: { variant: "default", size: "default" }
  }
);

const Button = forwardRef<HTMLButtonElement, ComponentProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  )
);
```

### 3. MobX Reactivity Rules
Always use `observer()` HOC, never spread observable arrays, use `runInAction()` for async updates.

```typescript
// ✅ Correct: Wrap with observer HOC
export const MyComponent = observer(() => {
  const store = useMyStore();
  return <div>{store.items.map(item => <Item key={item.id} {...item} />)}</div>;
});

// ✅ Correct: Never spread observable arrays
const itemsCopy = store.items.slice(); // or [...toJS(store.items)]

// ✅ Correct: Use runInAction for async updates
async fetchData() {
  const response = await api.get('/data');
  runInAction(() => {
    this.data = response.data;
    this.loading = false;
  });
}
```

### 4. IAuthProvider Interface
Use `IAuthProvider` interface for authentication abstraction. All three modes (Mock/Integration/Production) implement the same interface.

```typescript
// Get current user from unified interface
const { session, loading } = useAuth();

if (loading) return <LoadingSpinner />;
if (!session) return <Navigate to="/login" />;

// Session has JWT claims: org_id, user_role, permissions, scope_path
const { user_role, org_id, permissions } = session;
```

### 5. Accessibility First
WCAG 2.1 Level AA compliance is mandatory for healthcare. Add ARIA labels, keyboard navigation, focus management, and screen reader support.

```typescript
// ✅ Correct: Add ARIA labels and keyboard handling
<button
  aria-label="Delete medication"
  aria-describedby="delete-warning"
  onClick={handleDelete}
  onKeyDown={(e) => e.key === 'Enter' && handleDelete()}
>
  <TrashIcon />
</button>
<p id="delete-warning" className="sr-only">
  This action cannot be undone
</p>
```

### 6. Focus Management with useEffect
Use `useEffect` with refs for focus management. Never use `setTimeout` for focus.

```typescript
// ✅ Correct: Use useEffect for focus management
const inputRef = useRef<HTMLInputElement>(null);

useEffect(() => {
  if (isOpen) {
    inputRef.current?.focus();
  }
}, [isOpen]);

return <input ref={inputRef} />;
```

### 7. Centralized Timing Config
All timing values (delays, timeouts, transitions) must use centralized config. No magic numbers.

```typescript
// ✅ Correct: Use centralized timing config
import { TIMING_CONFIG } from '@/config/timing';

const toast = useToast();
toast.show({ message: 'Saved', duration: TIMING_CONFIG.TOAST_DURATION });
```

### 8. Never Spread Observable Arrays
MobX observable arrays lose reactivity when spread. Use `.slice()` or `toJS()` to create copies.

```typescript
// ❌ Wrong: Spreading observable array
const itemsCopy = [...store.items]; // Loses reactivity

// ✅ Correct: Use slice() or toJS()
const itemsCopy = store.items.slice();
const itemsCopy2 = [...toJS(store.items)];
```

### 9. Documentation Requirements
All components must be documented. Run `npm run docs:check` before committing to validate TypeScript interfaces match documentation.

```typescript
/**
 * Button component with variants and sizes
 *
 * @example
 * ```tsx
 * <Button variant="default" size="lg">Click Me</Button>
 * <Button variant="destructive" size="sm">Delete</Button>
 * ```
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(...);
```

### 10. Error Handling with User Feedback
Display user-friendly error messages with accessible announcements.

```typescript
// ✅ Correct: User-friendly error with accessible announcement
try {
  await saveMedication(data);
  toast.success('Medication saved successfully');
} catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to save medication';
  toast.error(message, { 'aria-live': 'assertive' });
}
```

## Modern Component Template

Use this template for new components:

```typescript
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { observer } from "mobx-react-lite";
import { cn } from "@/lib/utils";

/**
 * [Component Name] - [Brief description]
 *
 * @example
 * ```tsx
 * <ComponentName variant="default" size="md">
 *   Content
 * </ComponentName>
 * ```
 */

const componentVariants = cva(
  "base-classes-here",
  {
    variants: {
      variant: {
        default: "default-variant-classes",
        secondary: "secondary-variant-classes"
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-sm",
        lg: "h-10 px-8"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

interface ComponentProps
  extends ComponentPropsWithoutRef<"div">,
    VariantProps<typeof componentVariants> {
  asChild?: boolean;
}

export const ComponentName = observer(
  forwardRef<HTMLDivElement, ComponentProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
      const Comp = asChild ? Slot : "div";
      return (
        <Comp
          className={cn(componentVariants({ variant, size, className }))}
          ref={ref}
          {...props}
        />
      );
    }
  )
);

ComponentName.displayName = "ComponentName";
```

## Anti-Patterns

### Example: Using Wrong UI Library

```typescript
// ❌ Wrong: Material UI (this codebase uses Radix UI)
import { Button } from "@mui/material";

export const MyButton = () => (
  <Button variant="contained" color="primary">
    Click Me
  </Button>
);
```

```typescript
// ✅ Correct: Radix UI with Tailwind + CVA
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md font-medium",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90"
      }
    }
  }
);

export const MyButton = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
```

## Quick Reference

### Radix UI Imports
- `@radix-ui/react-slot` - Polymorphic components
- `@radix-ui/react-dialog` - Modal dialogs
- `@radix-ui/react-dropdown-menu` - Dropdown menus
- `@radix-ui/react-select` - Select dropdowns
- `@radix-ui/react-tooltip` - Tooltips
- `@radix-ui/react-popover` - Popovers

### MobX Rules
- Always use `observer()` HOC
- Never spread observable arrays (use `.slice()`)
- Use `runInAction()` after await in async functions
- Use `makeAutoObservable()` in store constructors

### Accessibility Checklist
- Add `aria-label` or `aria-labelledby` to interactive elements
- Add `aria-describedby` for additional context
- Test keyboard navigation (Tab, Enter, Escape, Arrow keys)
- Test with screen reader (NVDA/JAWS)
- Verify color contrast ratio (4.5:1 minimum)
- Announce dynamic content changes with `aria-live`

### Development Commands
```bash
npm run dev              # Start development server
npm run dev:auth         # Development with real OAuth
npm run dev:integration  # Same as dev:auth
npm run build            # Production build
npm run test             # Unit tests (Vitest)
npm run test:e2e         # E2E tests (Playwright)
npm run lint             # ESLint
npm run docs:check       # Validate documentation
```

## Support

For detailed patterns and examples, navigate to the resource files listed in the Navigation Table above.

For codebase-wide guidance, see `frontend/CLAUDE.md` in the repository root.
