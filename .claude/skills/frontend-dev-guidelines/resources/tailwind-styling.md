# Tailwind CSS + CVA Styling

## Overview

A4C-AppSuite uses Tailwind CSS for utility-first styling combined with class-variance-authority (CVA) for managing component variants. This approach provides type-safe, reusable variant systems with excellent developer experience.

**Key Technologies:**
- Tailwind CSS 3.x - Utility-first CSS framework
- class-variance-authority (CVA) - Type-safe variant management
- cn() utility - Class name merging with tailwind-merge

## Common Imports

```typescript
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
```

## CVA Basics

### Creating Variants with cva()

CVA allows you to define base styles and variants in a type-safe way.

```typescript
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
  // Base styles (always applied)
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    // Variants object
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-sm",
        lg: "h-10 px-8",
        icon: "h-9 w-9"
      }
    },
    // Default variant values
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

// Extract TypeScript type from CVA
type ButtonVariants = VariantProps<typeof buttonVariants>;

// Usage in component
interface ButtonProps extends React.ComponentPropsWithoutRef<"button">, ButtonVariants {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);

// Usage examples
<Button variant="default" size="lg">Primary Action</Button>
<Button variant="destructive" size="sm">Delete</Button>
<Button variant="outline">Secondary Action</Button>
<Button variant="ghost" size="icon"><TrashIcon /></Button>
```

### Compound Variants

Compound variants apply styles when multiple variant conditions are met.

```typescript
const alertVariants = cva(
  "relative w-full rounded-lg border p-4",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive: "border-destructive/50 text-destructive dark:border-destructive"
      },
      hasIcon: {
        true: "pl-11",
        false: ""
      }
    },
    compoundVariants: [
      {
        variant: "destructive",
        hasIcon: true,
        className: "pl-11 pr-11" // Special padding when destructive + icon
      }
    ],
    defaultVariants: {
      variant: "default",
      hasIcon: false
    }
  }
);

// Usage
<div className={alertVariants({ variant: "destructive", hasIcon: true })}>
  Alert with icon and special padding
</div>
```

## cn() Utility

The `cn()` utility merges class names intelligently, handling conflicts with tailwind-merge.

```typescript
// lib/utils.ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### Why cn() is Important

```typescript
// ❌ Without cn(): Conflicting classes both apply
<div className="px-4 px-6"> // Both apply, unpredictable result

// ✅ With cn(): Last class wins
<div className={cn("px-4", "px-6")}> // Only px-6 applies

// ✅ Conditional classes
<div className={cn(
  "px-4 py-2",
  isActive && "bg-primary text-white",
  isDisabled && "opacity-50 cursor-not-allowed"
)}>

// ✅ Merging CVA variants with custom classes
<Button className={cn(buttonVariants({ variant, size }), "w-full")} />
```

## Responsive Design

Tailwind uses mobile-first breakpoints: `sm:`, `md:`, `lg:`, `xl:`, `2xl:`.

```typescript
const cardVariants = cva(
  "rounded-lg border p-4",
  {
    variants: {
      layout: {
        stack: "flex flex-col",
        grid: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      }
    }
  }
);

// Responsive padding and text
<div className="px-4 py-2 sm:px-6 sm:py-4 lg:px-8 lg:py-6">
  <h1 className="text-lg sm:text-xl md:text-2xl lg:text-3xl">
    Responsive Heading
  </h1>
</div>

// Responsive grid
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
  {items.map(item => <Card key={item.id} {...item} />)}
</div>
```

## Dark Mode

Use `dark:` prefix for dark mode styles.

```typescript
const cardVariants = cva(
  "rounded-lg border p-6 bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100"
);

// Conditional dark mode colors
<div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
  <h2 className="text-gray-700 dark:text-gray-300">Heading</h2>
  <p className="text-gray-600 dark:text-gray-400">Description</p>
</div>
```

## State-Based Styling

Use `data-[state]`, `hover:`, `focus:`, `active:`, `disabled:` modifiers.

```typescript
// Radix UI data-state selectors
<Dialog.Overlay className="fixed inset-0 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

// Hover, focus, active states
<button className="bg-primary hover:bg-primary/90 focus:ring-2 focus:ring-offset-2 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
  Interactive Button
</button>

// Focus visible (keyboard navigation only)
<button className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
  Keyboard Focus
</button>
```

## Animations

Tailwind provides animation utilities. Use `data-[state]` selectors for Radix UI animations.

```typescript
// Built-in animations
<div className="animate-spin">Loading...</div>
<div className="animate-pulse">Skeleton</div>
<div className="animate-bounce">Notification</div>

// Custom animations with data-state
<Dialog.Content className="fixed left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95" />

// Transition utilities
<div className="transition-all duration-200 ease-in-out hover:scale-105">
  Smooth Transition
</div>
```

## Layout Patterns

### Flexbox

```typescript
// Horizontal layout
<div className="flex items-center gap-4">
  <Icon />
  <span>Text</span>
</div>

// Vertical layout
<div className="flex flex-col gap-2">
  <h2>Title</h2>
  <p>Description</p>
</div>

// Center content
<div className="flex items-center justify-center min-h-screen">
  <LoginForm />
</div>

// Space between
<div className="flex items-center justify-between">
  <h2>Title</h2>
  <button>Action</button>
</div>
```

### Grid

```typescript
// Basic grid
<div className="grid grid-cols-3 gap-4">
  <Card />
  <Card />
  <Card />
</div>

// Responsive grid
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
  {items.map(item => <Card key={item.id} {...item} />)}
</div>

// Grid with different column spans
<div className="grid grid-cols-4 gap-4">
  <div className="col-span-3">Main Content</div>
  <div className="col-span-1">Sidebar</div>
</div>
```

## Spacing Scale

Tailwind uses a consistent spacing scale: `0`, `px`, `0.5`, `1`, `1.5`, `2`, `2.5`, `3`, `3.5`, `4`, `5`, `6`, `7`, `8`, `9`, `10`, `11`, `12`, `14`, `16`, `20`, `24`, `28`, `32`, `36`, `40`, `44`, `48`, `52`, `56`, `60`, `64`, `72`, `80`, `96`.

```typescript
// Padding and margin
<div className="p-4">Padding on all sides</div>
<div className="px-4 py-2">Horizontal and vertical padding</div>
<div className="pt-4 pr-6 pb-4 pl-6">Individual sides</div>

// Gap for flex and grid
<div className="flex gap-4">Consistent gap between children</div>
<div className="grid grid-cols-3 gap-6">Grid with gap</div>

// Negative margins
<div className="-mt-4">Negative top margin</div>
```

## Typography

```typescript
// Font sizes
<h1 className="text-3xl font-bold">Large Heading</h1>
<h2 className="text-2xl font-semibold">Medium Heading</h2>
<p className="text-base">Body text</p>
<small className="text-sm text-muted-foreground">Small text</small>

// Line height and letter spacing
<p className="leading-relaxed tracking-wide">
  Comfortable reading experience
</p>

// Text alignment
<p className="text-left">Left aligned</p>
<p className="text-center">Centered</p>
<p className="text-right">Right aligned</p>

// Truncation
<p className="truncate">Very long text that will be truncated with ellipsis</p>
<p className="line-clamp-3">Text that will be clamped to 3 lines with ellipsis</p>
```

## Color System

Use semantic color tokens from the theme.

```typescript
// Background colors
<div className="bg-background">Default background</div>
<div className="bg-card">Card background</div>
<div className="bg-popover">Popover background</div>
<div className="bg-primary">Primary color</div>
<div className="bg-destructive">Destructive/error color</div>
<div className="bg-muted">Muted background</div>
<div className="bg-accent">Accent background</div>

// Text colors
<p className="text-foreground">Default text</p>
<p className="text-primary">Primary text</p>
<p className="text-destructive">Error text</p>
<p className="text-muted-foreground">Muted text</p>

// Border colors
<div className="border border-input">Input border</div>
<div className="border border-primary">Primary border</div>
```

## Accessibility

Tailwind provides utilities for accessibility.

```typescript
// Screen reader only
<span className="sr-only">Hidden from visual users, read by screen readers</span>

// Focus visible (keyboard navigation)
<button className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
  Keyboard accessible
</button>

// High contrast focus
<a href="/link" className="focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2">
  Link with focus indicator
</a>

// Not screen reader only (opposite of sr-only)
<div className="not-sr-only">Visible content</div>
```

## Common Patterns

### Card Component

```typescript
const cardVariants = cva(
  "rounded-lg border bg-card text-card-foreground shadow-sm",
  {
    variants: {
      padding: {
        none: "",
        sm: "p-4",
        md: "p-6",
        lg: "p-8"
      }
    },
    defaultVariants: {
      padding: "md"
    }
  }
);

interface CardProps extends React.ComponentPropsWithoutRef<"div">, VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, padding, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ padding, className }))} {...props} />
  )
);

// Usage
<Card padding="lg">
  <h2 className="text-xl font-semibold mb-2">Card Title</h2>
  <p className="text-muted-foreground">Card description</p>
</Card>
```

### Badge Component

```typescript
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

// Usage
<Badge variant="default">Active</Badge>
<Badge variant="destructive">Error</Badge>
<Badge variant="outline">Draft</Badge>
```

### Input Component

```typescript
const inputVariants = cva(
  "flex w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-input",
        error: "border-destructive focus-visible:ring-destructive"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

// Usage
<input className={inputVariants({ variant: "default" })} />
<input className={inputVariants({ variant: "error" })} aria-invalid="true" />
```

## Best Practices

1. **Use semantic tokens**: Prefer `bg-primary` over `bg-blue-500` for theme consistency
2. **Mobile-first**: Write base styles for mobile, add `sm:`, `md:`, `lg:` for larger screens
3. **Avoid arbitrary values**: Use Tailwind's scale (`p-4` not `p-[15px]`) for consistency
4. **Use cn() utility**: Always merge class names with `cn()` to handle conflicts
5. **Extract variants with CVA**: Use CVA for reusable component variants, not inline classes
6. **Focus visible**: Use `focus-visible:` for keyboard navigation, not `focus:`
7. **Dark mode**: Add `dark:` variants for all color-related classes

## Pitfalls to Avoid

- Always merge classes with `cn()`, never string concatenation
- Use Tailwind's spacing scale, avoid arbitrary values like `p-[17px]`
- Add responsive variants for multi-column layouts
- Use semantic color tokens (`bg-primary`) not raw colors (`bg-blue-500`)
