---
status: current
last_updated: 2025-01-13
---

# DynamicAdditionalInput

## Overview

A strategy pattern-based component that dynamically renders different types of additional inputs based on checkbox selection metadata. This component enables the FocusTrappedCheckboxGroup to show context-specific inputs when certain checkboxes are selected.

## Props Interface

```typescript
interface DynamicAdditionalInputProps {
  id: string;                    // Unique identifier for the input
  metadata: any;                 // Metadata defining the input type and configuration
  value: string;                 // Current input value
  onChange: (value: string) => void;  // Value change handler
  onKeyDown?: (event: React.KeyboardEvent) => void;  // Keyboard event handler
  tabIndex?: number;             // Tab index for focus management
}

interface InputMetadata {
  type: 'range-hours' | 'text' | 'number' | 'select';  // Input type
  label: string;                 // Input label
  placeholder?: string;          // Placeholder text
  required?: boolean;            // Required field indicator
  validation?: ValidationRule;   // Validation configuration
  options?: SelectOption[];      // Options for select inputs
}
```

## Usage Examples

### Basic Usage

```tsx
import { DynamicAdditionalInput } from '@/components/ui/FocusTrappedCheckboxGroup/DynamicAdditionalInput';

function ConditionalInput() {
  const [inputValue, setInputValue] = useState('');
  
  const metadata = {
    type: 'range-hours',
    label: 'Hours between doses',
    placeholder: 'e.g., 2-4',
    required: true
  };

  return (
    <DynamicAdditionalInput
      id="conditional-input"
      metadata={metadata}
      value={inputValue}
      onChange={setInputValue}
    />
  );
}
```

### Advanced Usage with Multiple Input Types

```tsx
function ContextualInputs() {
  const [values, setValues] = useState<Record<string, string>>({});
  
  const handleChange = (inputId: string) => (value: string) => {
    setValues(prev => ({ ...prev, [inputId]: value }));
  };

  const inputs = [
    {
      id: 'timing-hours',
      metadata: { type: 'range-hours', label: 'Hours', placeholder: '2-4' },
      value: values['timing-hours'] || ''
    },
    {
      id: 'special-instructions',
      metadata: { type: 'text', label: 'Special Instructions', placeholder: 'Enter instructions' },
      value: values['special-instructions'] || ''
    }
  ];

  return (
    <div>
      {inputs.map(input => (
        <DynamicAdditionalInput
          key={input.id}
          id={input.id}
          metadata={input.metadata}
          value={input.value}
          onChange={handleChange(input.id)}
        />
      ))}
    </div>
  );
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**:
  - Tab/Shift+Tab navigation between dynamic inputs
  - Input-specific keyboard handling (inherited from rendered components)
  - Proper focus flow within parent focus trap

- **ARIA Attributes**:
  - Delegates ARIA implementation to rendered input components
  - Maintains accessibility tree structure
  - Preserves label associations

- **Focus Management**:
  - Seamless integration with parent focus management
  - Focus state preservation during input type changes
  - Proper focus restoration

### Screen Reader Support

- Input purpose and type clearly communicated
- Dynamic content changes announced appropriately
- Error states and validation feedback accessible

## Styling

### CSS Classes

The component applies styling through the rendered input components:

- Inherits styles from specific input types (RangeHoursInput, etc.)
- Maintains consistent visual design
- Supports theme variations

### Dynamic Styling

- Adapts to input type requirements
- Maintains visual consistency across input types
- Supports error and validation states

## Implementation Notes

### Design Patterns

- **Strategy Pattern**: Different input types implement common interface
- **Factory Pattern**: Creates appropriate input based on metadata
- **Controlled Components**: All inputs use controlled component pattern
- **Composition**: Composes different input types dynamically

### Supported Input Types

1. **range-hours**: Hour range inputs (uses RangeHoursInput)
2. **text**: General text inputs
3. **number**: Numeric inputs with validation
4. **select**: Dropdown selection inputs

### Strategy Implementation

```typescript
const inputStrategies = {
  'range-hours': RangeHoursInput,
  'text': TextInput,
  'number': NumberInput,
  'select': SelectInput
};
```

### Metadata Processing

- Validates metadata structure
- Provides default values for optional properties
- Handles type-specific configuration
- Supports extensible input types

### Dependencies

- React 18+
- Specific input component implementations
- Shared validation utilities
- TypeScript for type safety

## Testing

### Unit Tests

Located in component test suite. Covers:

- Input type rendering based on metadata
- Props passing to child components
- Keyboard event delegation
- Dynamic input switching
- Metadata validation

### Integration Tests

Tested within FocusTrappedCheckboxGroup:

- Selection-based input showing/hiding
- Multi-input coordination
- Form submission with dynamic inputs

## Related Components

- `RangeHoursInput` - Strategy implementation for hour ranges
- `FocusTrappedCheckboxGroup` - Parent container using this component
- `EnhancedFocusTrappedCheckboxGroup` - Enhanced version with dynamic inputs

## Extensibility

### Adding New Input Types

```typescript
// 1. Create new input component
const CustomInput = (props) => { /* implementation */ };

// 2. Register in strategy map
const inputStrategies = {
  ...existingStrategies,
  'custom-type': CustomInput
};

// 3. Update metadata type definitions
type InputType = 'range-hours' | 'text' | 'number' | 'select' | 'custom-type';
```

## Changelog

- Initial implementation with strategy pattern
- Added support for multiple input types
- Enhanced metadata validation
- Improved accessibility integration
- Added extensibility for custom input types
