# Button

## Overview

The Button component is a foundational UI element that provides consistent styling and behavior for user interactions. Built on Radix UI's Slot component with class-variance-authority for type-safe styling variants.

## Props Interface

```typescript
interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link' | 'glass-disabled';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}
```

## Usage Examples

### Basic Usage

```tsx
import { Button } from '@/components/ui/button';

function MyComponent() {
  return (
    <Button onClick={() => console.log('clicked')}>
      Click me
    </Button>
  );
}
```

### Variants

```tsx
// Default primary button
<Button variant="default">Primary Action</Button>

// Destructive actions
<Button variant="destructive">Delete Item</Button>

// Secondary actions
<Button variant="secondary">Cancel</Button>

// Outline style
<Button variant="outline">Learn More</Button>

// Ghost style (minimal)
<Button variant="ghost">Skip</Button>

// Link style
<Button variant="link">View Details</Button>

// Disabled with glassmorphic effect
<Button variant="glass-disabled" disabled>Processing...</Button>
```

### Sizes

```tsx
// Small button
<Button size="sm">Small</Button>

// Default size
<Button size="default">Default</Button>

// Large button
<Button size="lg">Large</Button>

// Icon-only button
<Button size="icon">
  <IconComponent />
</Button>
```

### As Child Pattern

```tsx
// Render as a Link component
<Button asChild>
  <Link to="/dashboard">Go to Dashboard</Link>
</Button>

// Render as any other component
<Button asChild>
  <motion.button whileHover={{ scale: 1.05 }}>
    Animated Button
  </motion.button>
</Button>
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**:
  - Tab/Shift+Tab for focus navigation
  - Space and Enter keys activate the button
  - Focus is trapped appropriately in modal contexts

- **ARIA Attributes**:
  - Inherits standard button semantics
  - `aria-disabled` automatically applied when disabled
  - Custom `aria-label` can be provided via props
  - `aria-describedby` for additional context

- **Focus Management**:
  - Visible focus ring with high contrast
  - Focus indicators meet WCAG color contrast requirements
  - Focus outline using `focus-visible:ring-ring/50` and `focus-visible:ring-[3px]`

### Screen Reader Support

- Buttons announce their purpose and state clearly
- Disabled state is properly communicated
- Icon-only buttons should include `aria-label` for context

## Styling

### CSS Classes

The button uses CVA (Class Variance Authority) for systematic variant management:

- **Base Classes**: `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all`
- **Focus Classes**: `focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]`
- **Disabled Classes**: `disabled:pointer-events-none disabled:opacity-50`

### Variant Classes

- **default**: `bg-primary text-primary-foreground hover:bg-primary/90`
- **destructive**: `bg-destructive text-white hover:bg-destructive/90`
- **outline**: `border bg-background text-foreground hover:bg-accent`
- **secondary**: `bg-secondary text-secondary-foreground hover:bg-secondary/80`
- **ghost**: `hover:bg-accent hover:text-accent-foreground`
- **link**: `text-primary underline-offset-4 hover:underline`
- **glass-disabled**: `glass-button-disabled` (custom glassmorphic disabled styling)

### Customization

```tsx
// Custom styling with className
<Button className="w-full mt-4 shadow-lg">
  Full Width Button
</Button>

// Combining with Tailwind utilities
<Button variant="outline" className="border-2 border-blue-500">
  Custom Border
</Button>
```

## Implementation Notes

### Design Patterns

- **Composition Pattern**: Uses Radix UI's Slot for flexible rendering
- **Variant Management**: CVA ensures type-safe and consistent styling
- **Accessibility First**: Built-in focus management and ARIA support
- **Performance**: Uses CSS-in-JS patterns optimized for runtime

### Dependencies

- `@radix-ui/react-slot`: Composition primitive
- `class-variance-authority`: Type-safe variant management
- `./utils`: Utility functions for className merging

### Glass-Disabled Variant

The `glass-disabled` variant provides a modern glassmorphic appearance for disabled states, maintaining visual hierarchy while clearly indicating unavailability.

## Testing

### Unit Tests

Located in `src/components/ui/__tests__/button.test.tsx`:

- Variant rendering
- Click event handling
- Accessibility attributes
- Disabled state behavior

### E2E Tests

Covered in keyboard navigation and form interaction tests:

- Tab navigation order
- Click and keyboard activation
- Focus management in complex workflows

## Related Components

- **Input**: Often used together in forms
- **Form**: Container for button groups
- **Dialog**: Trigger and action buttons
- **Card**: Action buttons within content cards

## Changelog

- **v1.0.0**: Initial implementation with Radix UI and CVA
- **v1.1.0**: Added glass-disabled variant for enhanced UX
- **v1.2.0**: Improved focus indicators for WCAG compliance
