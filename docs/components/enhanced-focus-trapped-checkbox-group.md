# EnhancedFocusTrappedCheckboxGroup

## Overview

The EnhancedFocusTrappedCheckboxGroup is a sophisticated, accessible checkbox group component with advanced focus management, dynamic additional inputs, and comprehensive keyboard navigation. It implements a focus trap pattern while maintaining WCAG 2.1 Level AA compliance and provides extensible architecture through strategy patterns for different input types.

## Props Interface

```typescript
interface EnhancedCheckboxGroupProps {
  id: string;
  title: string;
  checkboxes: CheckboxMetadata[];
  onSelectionChange: (id: string, checked: boolean) => void;
  onAdditionalDataChange?: (id: string, data: any) => void;
  onFieldBlur?: (checkboxId: string) => void;
  onContinue: (selectedIds: string[], additionalData: Map<string, any>) => void;
  onCancel: () => void;

  // Display configuration
  showLabel?: boolean;
  maxVisibleItems?: number;

  // Reordering configuration
  enableReordering?: boolean;
  reorderTrigger?: 'onChange' | 'onBlur';
  onFocusLost?: () => void;

  // Summary display
  summaryRenderer?: (checkboxId: string, data: any) => string;

  // Focus management
  baseTabIndex?: number;
  nextTabIndex?: number;

  // ARIA support
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  isRequired?: boolean;
  hasError?: boolean;
  errorMessage?: string;
  helpText?: string;

  // Button customization
  continueButtonText?: string;
  cancelButtonText?: string;
  continueButtonBehavior?: ContinueButtonBehavior;

  // Back navigation
  onBack?: () => void;
  showBackButton?: boolean;
  backButtonText?: string;
  previousTabIndex?: number;
}

interface CheckboxMetadata {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  requiresAdditionalInput?: boolean;
  additionalInputStrategy?: InputStrategy;
}
```

## Usage Examples

### Basic Checkbox Group

```tsx
import { EnhancedFocusTrappedCheckboxGroup } from '@/components/ui/FocusTrappedCheckboxGroup/EnhancedFocusTrappedCheckboxGroup';

function BasicPreferences() {
  const [preferences, setPreferences] = useState([
    { id: 'email', label: 'Email notifications', checked: false },
    { id: 'sms', label: 'SMS notifications', checked: false },
    { id: 'push', label: 'Push notifications', checked: true }
  ]);

  const handleSelectionChange = (id: string, checked: boolean) => {
    setPreferences(prev => 
      prev.map(pref => 
        pref.id === id ? { ...pref, checked } : pref
      )
    );
  };

  const handleContinue = (selectedIds: string[], additionalData: Map<string, any>) => {
    console.log('Selected preferences:', selectedIds);
    console.log('Additional data:', additionalData);
  };

  const handleCancel = () => {
    // Reset all selections
    setPreferences(prev => prev.map(pref => ({ ...pref, checked: false })));
  };

  return (
    <EnhancedFocusTrappedCheckboxGroup
      id="notification-preferences"
      title="Notification Preferences"
      checkboxes={preferences}
      onSelectionChange={handleSelectionChange}
      onContinue={handleContinue}
      onCancel={handleCancel}
      helpText="Select your preferred notification methods"
    />
  );
}
```

### With Dynamic Additional Inputs

```tsx
import { RangeInputStrategy, TimeInputStrategy } from './input-strategies';

function MedicationTimingForm() {
  const [timingOptions, setTimingOptions] = useState([
    { 
      id: 'morning', 
      label: 'Morning dose', 
      checked: false,
      additionalInputStrategy: new TimeInputStrategy({
        placeholder: 'Enter time (e.g., 8:00 AM)',
        validation: (value) => /^([01]?[0-9]|2[0-3]):[0-5][0-9]\s?(AM|PM)?$/i.test(value)
      })
    },
    { 
      id: 'prn', 
      label: 'As needed (PRN)', 
      checked: false,
      requiresAdditionalInput: true,
      additionalInputStrategy: new RangeInputStrategy({
        label: 'Frequency range',
        min: 1,
        max: 6,
        unit: 'times per day',
        validation: (value) => value >= 1 && value <= 6
      })
    },
    { 
      id: 'bedtime', 
      label: 'Bedtime dose', 
      checked: false,
      additionalInputStrategy: new TimeInputStrategy({
        placeholder: 'Enter bedtime (e.g., 10:00 PM)',
        autoFocus: false // Optional input, don't auto-focus
      })
    }
  ]);

  const [additionalData, setAdditionalData] = useState(new Map());

  const handleSelectionChange = (id: string, checked: boolean) => {
    setTimingOptions(prev => 
      prev.map(option => 
        option.id === id ? { ...option, checked } : option
      )
    );
  };

  const handleAdditionalDataChange = (id: string, data: any) => {
    setAdditionalData(prev => {
      const newMap = new Map(prev);
      if (data === null) {
        newMap.delete(id);
      } else {
        newMap.set(id, data);
      }
      return newMap;
    });
  };

  const handleContinue = (selectedIds: string[], additionalData: Map<string, any>) => {
    // Validate required inputs
    const invalidFields = selectedIds.filter(id => {
      const option = timingOptions.find(opt => opt.id === id);
      return option?.requiresAdditionalInput && !additionalData.has(id);
    });

    if (invalidFields.length > 0) {
      console.error('Missing required data for:', invalidFields);
      return;
    }

    console.log('Medication timing:', { selectedIds, additionalData });
  };

  return (
    <EnhancedFocusTrappedCheckboxGroup
      id="medication-timing"
      title="Medication Timing"
      checkboxes={timingOptions}
      onSelectionChange={handleSelectionChange}
      onAdditionalDataChange={handleAdditionalDataChange}
      onContinue={handleContinue}
      onCancel={() => {
        setTimingOptions(prev => prev.map(opt => ({ ...opt, checked: false })));
        setAdditionalData(new Map());
      }}
      helpText="Select when you want to take this medication"
      isRequired
    />
  );
}
```

### With Custom Continue Button Behavior

```tsx
function ConditionalContinueExample() {
  const [options, setOptions] = useState([
    { id: 'option1', label: 'First option', checked: false },
    { id: 'option2', label: 'Second option', checked: false },
    { id: 'option3', label: 'Third option', checked: false }
  ]);

  const continueButtonBehavior = {
    allowSkipSelection: true,
    skipMessage: "You can skip this step if none apply",
    customEnableLogic: (checkboxes: CheckboxMetadata[]) => {
      // Enable if user has made any selection or explicitly wants to skip
      const hasSelection = checkboxes.some(cb => cb.checked);
      return hasSelection || true; // Always enable for skip functionality
    }
  };

  return (
    <EnhancedFocusTrappedCheckboxGroup
      id="optional-preferences"
      title="Optional Preferences (can be skipped)"
      checkboxes={options}
      onSelectionChange={(id, checked) => {
        setOptions(prev => prev.map(opt => 
          opt.id === id ? { ...opt, checked } : opt
        ));
      }}
      onContinue={(selectedIds, additionalData) => {
        if (selectedIds.length === 0) {
          console.log('User chose to skip this step');
        } else {
          console.log('User selected:', selectedIds);
        }
      }}
      onCancel={() => setOptions(prev => prev.map(opt => ({ ...opt, checked: false })))}
      continueButtonBehavior={continueButtonBehavior}
      continueButtonText="Continue or Skip"
    />
  );
}
```

### With Back Navigation

```tsx
function MultiStepForm() {
  const [currentStep, setCurrentStep] = useState(0);
  const [stepData, setStepData] = useState({
    preferences: [],
    settings: [],
    notifications: []
  });

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  if (currentStep === 1) {
    return (
      <EnhancedFocusTrappedCheckboxGroup
        id="step-2-settings"
        title="Application Settings"
        checkboxes={settingsOptions}
        onSelectionChange={handleSettingsChange}
        onContinue={(selectedIds) => {
          setStepData(prev => ({ ...prev, settings: selectedIds }));
          setCurrentStep(2);
        }}
        onCancel={() => setCurrentStep(0)}
        onBack={handleBack}
        showBackButton
        backButtonText="Back to Preferences"
        helpText="Configure your application settings"
      />
    );
  }

  // Render other steps...
}
```

### Large Lists with Scrolling

```tsx
function LargeCategorySelection() {
  const categories = Array.from({ length: 50 }, (_, i) => ({
    id: `category-${i}`,
    label: `Category ${i + 1}`,
    description: `Description for category ${i + 1}`,
    checked: false
  }));

  return (
    <EnhancedFocusTrappedCheckboxGroup
      id="large-category-list"
      title="Select Categories"
      checkboxes={categories}
      maxVisibleItems={7}  // Limit visible items
      onSelectionChange={handleCategoryChange}
      onContinue={handleContinue}
      onCancel={handleCancel}
      helpText="Use arrow keys to navigate, Page Up/Down for quick scrolling"
    />
  );
}
```

### With Custom Summary Renderer

```tsx
function CustomSummaryExample() {
  const customSummaryRenderer = (checkboxId: string, data: any) => {
    switch (checkboxId) {
      case 'morning':
        return `at ${data.time}`;
      case 'prn':
        return `up to ${data.frequency} times daily`;
      case 'with-food':
        return data.mealTiming ? `with ${data.mealTiming}` : 'with meals';
      default:
        return JSON.stringify(data);
    }
  };

  return (
    <EnhancedFocusTrappedCheckboxGroup
      id="custom-summary"
      title="Medication Schedule"
      checkboxes={medicationOptions}
      onSelectionChange={handleSelectionChange}
      onAdditionalDataChange={handleAdditionalDataChange}
      onContinue={handleContinue}
      onCancel={handleCancel}
      summaryRenderer={customSummaryRenderer}
    />
  );
}
```

### Error Handling and Validation

```tsx
function ValidatedCheckboxGroup() {
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const validateSelection = (selectedIds: string[], additionalData: Map<string, any>) => {
    // Must select at least 2 options
    if (selectedIds.length < 2) {
      setHasError(true);
      setErrorMessage('Please select at least 2 options');
      return false;
    }

    // Validate required fields
    const missingRequired = selectedIds.filter(id => {
      const option = options.find(opt => opt.id === id);
      return option?.requiresAdditionalInput && !additionalData.has(id);
    });

    if (missingRequired.length > 0) {
      setHasError(true);
      setErrorMessage('Please complete all required fields');
      return false;
    }

    setHasError(false);
    setErrorMessage('');
    return true;
  };

  const handleFieldBlur = (checkboxId: string) => {
    // Validate individual field on blur
    const option = options.find(opt => opt.id === checkboxId);
    if (option?.checked && option?.requiresAdditionalInput) {
      const hasData = additionalData.has(checkboxId);
      if (!hasData) {
        setHasError(true);
        setErrorMessage(`${option.label} requires additional information`);
      }
    }
  };

  return (
    <EnhancedFocusTrappedCheckboxGroup
      id="validated-group"
      title="Required Selection"
      checkboxes={options}
      onSelectionChange={handleSelectionChange}
      onAdditionalDataChange={handleAdditionalDataChange}
      onFieldBlur={handleFieldBlur}
      onContinue={(selectedIds, additionalData) => {
        if (validateSelection(selectedIds, additionalData)) {
          console.log('Validation passed:', { selectedIds, additionalData });
        }
      }}
      onCancel={handleCancel}
      hasError={hasError}
      errorMessage={errorMessage}
      isRequired
    />
  );
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**: 
  - Tab cycles through: Checkbox Group → Back Button (optional) → Cancel → Continue
  - Within checkbox group: Arrow keys navigate between checkboxes
  - Space toggles checkbox selection
  - Tab navigates to optional additional inputs
  - Enter/Escape to exit additional inputs and return to checkbox
  - Home/End for first/last item in long lists
  - Page Up/Down for quick scrolling in long lists
  - Backspace for back navigation (when available)

- **ARIA Attributes**:
  - `role="group"` on container with proper labeling
  - `aria-labelledby` or `aria-label` for group identification
  - `aria-describedby` for help text and error messages
  - `aria-required` for required groups
  - `aria-invalid` for error states
  - `aria-setsize` and `aria-posinset` for list context
  - Live regions for status announcements

- **Focus Management**:
  - Complete focus trapping within the component
  - Focus restoration after modal interactions
  - Clear focus indicators throughout
  - Focus region tracking prevents conflicts between keyboard handlers

### Screen Reader Support

- Group purpose and instructions announced on entry
- Individual checkbox states and descriptions read
- Additional input requirements communicated
- Selection count and progress updates
- Error messages announced via live regions
- Button state changes communicated

### Focus Region Tracking

The component implements an advanced focus region system:

- **Checkbox Region**: Arrow keys navigate, Space toggles, Tab moves to inputs
- **Input Region**: All keyboard events handled natively by inputs
- **Button Region**: Standard button keyboard behavior

This prevents conflicting keyboard event handlers and provides predictable interaction patterns.

## Implementation Notes

### Design Patterns

- **Strategy Pattern**: Extensible input types via `InputStrategy` interface
- **Focus Intent Pattern**: Tracks user's focus intent to prevent unwanted auto-focus
- **Memoization**: Optimized rendering with `React.memo` for individual items
- **Focus Trapping**: Complete keyboard navigation control within component
- **Region-Based Event Handling**: Separate keyboard handling by focus region

### Performance Optimizations

- **Memoized Components**: Individual checkbox items only re-render when necessary
- **Stable Callbacks**: `useCallback` for all event handlers
- **Efficient Updates**: Immutable state updates with Map data structures
- **Virtual Scrolling**: Smooth scrolling for large lists
- **Performance Monitoring**: Development-time render performance tracking

### Dependencies

- `mobx-react-lite`: Reactive rendering with `observer`
- `@/components/ui/button`: Action buttons
- `@/components/ui/checkbox`: Individual checkbox inputs
- `@/components/ui/label`: Accessible labeling
- `./DynamicAdditionalInput`: Strategy-based additional inputs
- Various strategy implementations and utilities

### Focus Intent Pattern

```typescript
// Focus intent tracking prevents unwanted auto-focus
type FocusIntent = 
  | { type: 'none' }
  | { type: 'checkbox'; checkboxId: string; source: FocusSource }
  | { type: 'input'; checkboxId: string; source: FocusSource }
  | { type: 'returning-to-checkbox'; checkboxId: string; source: FocusSource }
  | { type: 'tab-to-input'; checkboxId: string; source: FocusSource }
  | { type: 'external-blur'; from: 'input' | 'checkbox' };

// Source tracking for different interaction methods
type FocusSource = 'keyboard' | 'mouse';
```

## Testing

### Unit Tests

Located in `src/components/ui/FocusTrappedCheckboxGroup/__tests__/`:
- Focus trap functionality and keyboard navigation
- Dynamic input rendering and interaction
- State management and selection tracking
- Accessibility attributes and ARIA compliance
- Performance and memoization behavior

### E2E Tests

Covered in medication timing and form workflow tests:
- Complete focus trap interaction via keyboard only
- Dynamic input entry and validation
- Multi-step form navigation with back/continue
- Screen reader compatibility
- Complex selection scenarios with additional data

### Testing Patterns

```tsx
// Test focus trapping
test('should trap focus within component', async () => {
  render(
    <EnhancedFocusTrappedCheckboxGroup
      id="test-group"
      title="Test Group"
      checkboxes={testCheckboxes}
      onSelectionChange={mockOnSelectionChange}
      onContinue={mockOnContinue}
      onCancel={mockOnCancel}
    />
  );

  const container = screen.getByRole('group');
  container.focus();

  // Tab should cycle through internal elements only
  await user.keyboard('{Tab}');
  expect(screen.getByRole('button', { name: /cancel/i })).toHaveFocus();

  await user.keyboard('{Tab}');
  expect(screen.getByRole('button', { name: /continue/i })).toHaveFocus();

  await user.keyboard('{Tab}');
  expect(container).toHaveFocus(); // Back to start
});

// Test dynamic inputs
test('should show additional input when checkbox with strategy is checked', async () => {
  const checkboxesWithInput = [
    {
      id: 'test-with-input',
      label: 'Test Checkbox',
      checked: false,
      additionalInputStrategy: new TimeInputStrategy({
        placeholder: 'Enter time'
      })
    }
  ];

  render(
    <EnhancedFocusTrappedCheckboxGroup
      checkboxes={checkboxesWithInput}
      // ... other props
    />
  );

  // Input should not be visible initially
  expect(screen.queryByPlaceholderText('Enter time')).not.toBeInTheDocument();

  // Check the checkbox
  await user.click(screen.getByRole('checkbox'));

  // Input should now be visible
  expect(screen.getByPlaceholderText('Enter time')).toBeInTheDocument();
});
```

## Related Components

- **DynamicAdditionalInput**: Strategy-based additional input rendering
- **Checkbox**: Individual checkbox inputs
- **Button**: Action buttons for navigation
- **Label**: Accessible labeling system
- **MultiSelectDropdown**: Alternative multi-selection interface

## Common Integration Patterns

### Form Wizard Integration

```tsx
interface WizardStepProps {
  onNext: (data: any) => void;
  onBack: () => void;
  onCancel: () => void;
  stepData?: any;
}

function CheckboxWizardStep({ onNext, onBack, onCancel, stepData }: WizardStepProps) {
  const [checkboxes, setCheckboxes] = useState(stepData?.checkboxes || defaultCheckboxes);

  return (
    <EnhancedFocusTrappedCheckboxGroup
      id="wizard-step"
      title={stepData.title}
      checkboxes={checkboxes}
      onSelectionChange={(id, checked) => {
        setCheckboxes(prev => prev.map(cb => 
          cb.id === id ? { ...cb, checked } : cb
        ));
      }}
      onContinue={(selectedIds, additionalData) => {
        onNext({ selectedIds, additionalData, checkboxes });
      }}
      onCancel={onCancel}
      onBack={onBack}
      showBackButton={stepData.showBack}
    />
  );
}
```

### Validation Framework Integration

```tsx
function ValidatedCheckboxGroup() {
  const { errors, validate, clearErrors } = useValidationFramework();

  const customValidation = {
    customEnableLogic: (checkboxes: CheckboxMetadata[]) => {
      const errors = validate(checkboxes);
      return errors.length === 0;
    }
  };

  return (
    <EnhancedFocusTrappedCheckboxGroup
      hasError={errors.length > 0}
      errorMessage={errors[0]?.message}
      continueButtonBehavior={customValidation}
      onFieldBlur={(checkboxId) => {
        validateField(checkboxId);
      }}
      // ... other props
    />
  );
}
```

## Changelog

- **v1.0.0**: Initial implementation with basic focus trapping
- **v1.1.0**: Added dynamic additional input support with strategy pattern
- **v1.2.0**: Enhanced keyboard navigation and accessibility
- **v1.3.0**: Implemented focus intent pattern and region tracking
- **v1.4.0**: Added performance optimizations and memoization
- **v1.5.0**: Enhanced continue button behavior and validation support
- **v1.6.0**: Added back navigation and multi-step form support
- **v1.7.0**: Improved large list handling with virtual scrolling
- **v1.8.0**: Added comprehensive error handling and validation framework