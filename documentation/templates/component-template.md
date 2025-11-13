---
status: current
last_updated: 2025-01-13
---

# [ComponentName]

## Overview

Brief description of what this component does and its primary purpose in the application.

## Props and Usage

**Props are documented inline in the component source code using JSDoc comments.**

Example of proper inline prop documentation:

```typescript
interface [ComponentName]Props {
  // Dropdown options to display to the user
  options: string[];
  // Currently selected values from the options array
  selected: string[];
  // Callback function called when selection changes
  onChange: (newSelection: string[]) => void;
  // Optional placeholder text shown when no items selected
  placeholder?: string;
  // Unique identifier for the form element
  id: string;
  // Custom CSS classes to apply to the component
  className?: string;
}
```

**Inline Documentation Guidelines:**

- ✅ Add meaningful JSDoc comments for each prop in the TypeScript interface
- ✅ Describe the prop's purpose and expected usage
- ✅ Include examples for complex props when helpful
- ✅ Keep comments concise but informative
- ❌ No external prop documentation files needed

## Usage Examples

### Basic Usage

```tsx
import { [ComponentName] } from '@/components/[path]';

function MyComponent() {
  return (
    <[ComponentName]
      prop1="value"
      prop2={true}
    />
  );
}
```

### Advanced Usage

```tsx
// More complex example showing advanced patterns
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**:
  - Tab/Shift+Tab for navigation
  - Space/Enter for activation
  - Arrow keys for internal navigation (if applicable)

- **ARIA Attributes**:
  - `aria-label`: Descriptive label for screen readers
  - `aria-describedby`: Additional description reference
  - `aria-expanded`: State for expandable elements (if applicable)
  - `aria-disabled`: Disabled state indication

- **Focus Management**:
  - Visible focus indicators
  - Logical tab order
  - Focus trapping (if modal)

### Screen Reader Support

- All interactive elements are properly labeled
- State changes are announced appropriately
- Content structure is semantic

## Styling

### CSS Classes

- `.component-class`: Primary component styling
- `.component-variant`: Variant-specific styling

### Customization

Instructions for customizing appearance and behavior.

## Implementation Notes

### Design Patterns

- Component follows [specific pattern from CLAUDE.md]
- State management approach used
- Performance considerations

### Dependencies

- List any external dependencies
- Internal component dependencies

## Testing

### Unit Tests

Location of unit tests and key scenarios covered.

### E2E Tests

Location of E2E tests and user flows covered.

## Related Components

- Links to related or similar components
- Usage patterns with other components

## Changelog

Notable changes and version history (if applicable).
