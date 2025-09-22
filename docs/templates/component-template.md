# [ComponentName]

## Overview

Brief description of what this component does and its primary purpose in the application.

## Props Interface

```typescript
interface [ComponentName]Props {
  // List all props with types and descriptions
  prop1: string;    // Description of prop1
  prop2?: boolean;  // Optional prop description
  // ... etc
}
```

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