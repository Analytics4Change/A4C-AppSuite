# RangeHoursInput

## Overview

A specialized input component for entering hour ranges (e.g., "2-4 hours") with validation and formatting. Used within the FocusTrappedCheckboxGroup system for collecting additional timing information.

## Props Interface

```typescript
interface RangeHoursInputProps {
  id: string;                    // Unique identifier for the input
  label: string;                 // Label text for the input
  value: string;                 // Current input value
  onChange: (value: string) => void;  // Value change handler
  onKeyDown?: (event: React.KeyboardEvent) => void;  // Keyboard event handler
  placeholder?: string;          // Placeholder text
  disabled?: boolean;            // Disabled state
  error?: string;               // Error message
  tabIndex?: number;            // Tab index for focus management
}
```

## Usage Examples

### Basic Usage

```tsx
import { RangeHoursInput } from '@/components/ui/FocusTrappedCheckboxGroup/RangeHoursInput';

function TimingInput() {
  const [hours, setHours] = useState('');

  return (
    <RangeHoursInput
      id="dosage-hours"
      label="Hours between doses"
      value={hours}
      onChange={setHours}
      placeholder="e.g., 2-4"
    />
  );
}
```

### Advanced Usage with Validation

```tsx
function ValidatedHoursInput() {
  const [hours, setHours] = useState('');
  const [error, setError] = useState('');

  const handleChange = (value: string) => {
    setHours(value);
    
    // Validate range format
    const rangePattern = /^\d+(-\d+)?$/;
    if (value && !rangePattern.test(value)) {
      setError('Please enter a valid hour range (e.g., 2 or 2-4)');
    } else {
      setError('');
    }
  };

  return (
    <RangeHoursInput
      id="validated-hours"
      label="Time between doses"
      value={hours}
      onChange={handleChange}
      error={error}
      placeholder="Enter hours (e.g., 2-4)"
    />
  );
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**:
  - Tab/Shift+Tab for field navigation
  - Arrow keys and typing for input
  - Enter to submit/confirm value

- **ARIA Attributes**:
  - `aria-label` or associated `<label>` element
  - `aria-describedby` for error messages
  - `aria-invalid` when validation fails
  - `aria-required` for required inputs

- **Focus Management**:
  - Clear focus indicators
  - Focus restoration after validation
  - Integration with parent focus trap

### Screen Reader Support

- Input purpose clearly announced
- Error messages associated and announced
- Value changes communicated appropriately
- Label and placeholder text announced

## Styling

### CSS Classes

- `.range-hours-input`: Main input wrapper
- `.range-hours-input__label`: Label styling
- `.range-hours-input__field`: Input field styling
- `.range-hours-input__error`: Error message styling
- `.range-hours-input--disabled`: Disabled state
- `.range-hours-input--error`: Error state styling

### Visual States

- Default state with clear border
- Focus state with enhanced border
- Error state with red border and icon
- Disabled state with reduced opacity

## Implementation Notes

### Design Patterns

- Follows controlled component pattern
- Integrates with DynamicAdditionalInput strategy system
- Implements input validation patterns from CLAUDE.md
- Uses consistent styling with other form inputs

### Validation Features

- Real-time format validation
- Range boundary checking
- User-friendly error messages
- Format suggestions in placeholder

### Input Formatting

- Accepts formats like "2", "2-4", "1-3"
- Validates numeric ranges
- Provides helpful error feedback
- Maintains user input until validation

### Dependencies

- React 18+
- Integration with parent checkbox group system
- Shared validation utilities

## Testing

### Unit Tests

Located alongside component tests. Covers:

- Input value changes
- Validation logic
- Keyboard interaction
- Error state handling
- Focus management

### E2E Tests

Tested as part of medication timing workflows:

- Complete form submission with hour ranges
- Keyboard-only navigation
- Error recovery flows

## Related Components

- `DynamicAdditionalInput` - Strategy container for this input type
- `FocusTrappedCheckboxGroup` - Parent container component
- `EnhancedFocusTrappedCheckboxGroup` - Enhanced version using this input

## Changelog

- Initial implementation for hour range input
- Added validation and error handling
- Enhanced accessibility features
- Improved visual design and focus states
