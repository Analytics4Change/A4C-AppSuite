---
status: current
last_updated: 2025-01-13
---

# DropdownPortal

## Overview

A React portal component that renders dropdown content outside the normal DOM hierarchy to avoid z-index and overflow issues. This component ensures dropdown menus can appear above all other content regardless of their parent container's CSS properties.

## Props Interface

```typescript
interface DropdownPortalProps {
  children: React.ReactNode;  // The dropdown content to render in the portal
  isOpen: boolean;           // Controls whether the portal content is rendered
}
```

## Usage Examples

### Basic Usage

```tsx
import { DropdownPortal } from '@/components/ui/dropdown-portal';

function MyDropdown() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button onClick={() => setIsOpen(!isOpen)}>
        Toggle Dropdown
      </button>
      
      <DropdownPortal isOpen={isOpen}>
        <div className="dropdown-menu">
          <div>Option 1</div>
          <div>Option 2</div>
          <div>Option 3</div>
        </div>
      </DropdownPortal>
    </div>
  );
}
```

### Advanced Usage

```tsx
// Used with complex dropdown components that need to escape container constraints
function ComplexDropdown() {
  return (
    <div className="overflow-hidden relative z-10">
      <SearchableDropdown
        renderPortal={(content, isOpen) => (
          <DropdownPortal isOpen={isOpen}>
            {content}
          </DropdownPortal>
        )}
      />
    </div>
  );
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Portal Accessibility**: Portal content maintains accessibility tree connections
- **Focus Management**: Focus remains properly managed across portal boundary
- **Screen Reader Support**: Portal content is properly announced to assistive technologies

### Implementation Details

- Uses React's `createPortal` to render content at document root
- Preserves React event handling and context across portal boundary
- Maintains proper accessibility relationships

## Styling

### CSS Classes

Portal content inherits styling from its children. The portal itself provides no styling - it's purely a rendering mechanism.

### Positioning

Portal content is rendered at the document root, so positioning should be handled by the child components using fixed or absolute positioning.

## Implementation Notes

### Design Patterns

- Uses React Portal pattern to escape CSS containment
- Conditional rendering based on `isOpen` prop
- Minimal wrapper - delegates all styling and positioning to children

### Dependencies

- React 18+ `createPortal`
- No external dependencies

### Performance Considerations

- Portal creation is lightweight
- Only renders when `isOpen` is true
- No cleanup required - React handles portal lifecycle

## Testing

### Unit Tests

Located in component test files. Key scenarios:

- Portal renders children when open
- Portal doesn't render when closed
- Event handling works across portal boundary

### E2E Tests

Covered in dropdown component tests that use the portal.

## Related Components

- `SearchableDropdown` - Uses DropdownPortal for z-index management
- `MultiSelectDropdown` - Uses DropdownPortal for overflow escape
- `EditableDropdown` - Uses DropdownPortal for proper layering

## Changelog

- Initial implementation for dropdown z-index management
- Added conditional rendering optimization
