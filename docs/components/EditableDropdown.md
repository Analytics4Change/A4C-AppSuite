# EditableDropdown

## Overview

The EditableDropdown component provides a sophisticated dropdown with edit-mode functionality. After selection, it displays the chosen value in a read-only state with an edit button. Clicking either the value or edit button re-opens the autocomplete dropdown for modification. Built with accessibility and keyboard navigation as primary concerns.

## Props Interface

```typescript
interface EditableDropdownProps {
  id: string;                                      // Unique identifier for the dropdown
  label: string;                                   // Accessible label text
  value: string;                                   // Current selected value
  options: string[];                               // Array of available options
  placeholder?: string;                            // Placeholder text when no value selected
  disabled?: boolean;                              // Whether the dropdown is disabled
  disabledMessage?: string;                        // Message to show when disabled
  error?: string;                                  // Error message to display
  tabIndex: number;                                // Tab order position
  targetTabIndex?: number;                         // Tab index to advance to after selection
  onChange: (value: string) => void;               // Callback when value changes
  onDropdownOpen?: (elementId: string) => void;    // Callback when dropdown opens
  filterMode?: 'contains' | 'startsWith';          // How to filter options during search
  testIdPrefix?: string;                           // Prefix for test IDs
  className?: string;                              // Additional CSS classes
  showLabel?: boolean;                             // Whether to show the label
}
```

## Usage Examples

### Basic Editable Dropdown

```tsx
import { EditableDropdown } from '@/components/ui/EditableDropdown';

function DosageFormSelection() {
  const [selectedForm, setSelectedForm] = useState('');
  
  const dosageForms = [
    'Tablet',
    'Capsule', 
    'Liquid',
    'Injection',
    'Topical',
    'Inhaler'
  ];

  return (
    <EditableDropdown
      id="dosage-form"
      label="Dosage Form"
      value={selectedForm}
      options={dosageForms}
      onChange={setSelectedForm}
      placeholder="Select dosage form..."
      tabIndex={3}
    />
  );
}
```

### With Focus Advancement

```tsx
function MedicationForm() {
  const [route, setRoute] = useState('');
  const [strength, setStrength] = useState('');
  
  return (
    <div className="space-y-4">
      <EditableDropdown
        id="route"
        label="Route of Administration"
        value={route}
        options={['Oral', 'IV', 'IM', 'SC', 'Topical']}
        onChange={setRoute}
        tabIndex={5}
        targetTabIndex={6}  // Advances focus to next field
        placeholder="Select route..."
      />
      
      <EditableDropdown
        id="strength"
        label="Strength"
        value={strength}
        options={['5mg', '10mg', '25mg', '50mg', '100mg']}
        onChange={setStrength}
        tabIndex={6}
        placeholder="Select strength..."
      />
    </div>
  );
}
```

### Disabled State with Message

```tsx
function ConditionalDropdown() {
  const [hasCondition, setHasCondition] = useState(false);
  const [selectedOption, setSelectedOption] = useState('');
  
  return (
    <div className="space-y-4">
      <label className="flex items-center">
        <input 
          type="checkbox" 
          checked={hasCondition}
          onChange={(e) => setHasCondition(e.target.checked)}
        />
        Enable advanced options
      </label>
      
      <EditableDropdown
        id="advanced-option"
        label="Advanced Option"
        value={selectedOption}
        options={['Option A', 'Option B', 'Option C']}
        onChange={setSelectedOption}
        tabIndex={8}
        disabled={!hasCondition}
        disabledMessage="Check the box above to enable"
        placeholder="Select option..."
      />
    </div>
  );
}
```

### With Error Handling

```tsx
function ValidatedDropdown() {
  const [selectedValue, setSelectedValue] = useState('');
  const [error, setError] = useState('');
  
  const validate = (value: string) => {
    if (!value) {
      setError('This field is required');
    } else if (!allowedValues.includes(value)) {
      setError('Please select a valid option');
    } else {
      setError('');
    }
  };
  
  const handleChange = (value: string) => {
    setSelectedValue(value);
    validate(value);
  };

  return (
    <EditableDropdown
      id="validated-field"
      label="Required Field"
      value={selectedValue}
      options={allowedValues}
      onChange={handleChange}
      error={error}
      tabIndex={10}
      placeholder="Select value..."
      aria-required="true"
    />
  );
}
```

### Filter Modes

```tsx
function FilterExamples() {
  const [containsValue, setContainsValue] = useState('');
  const [startsWithValue, setStartsWithValue] = useState('');
  
  const medications = [
    'Lisinopril',
    'Amlodipine',
    'Metformin',
    'Simvastatin',
    'Omeprazole'
  ];

  return (
    <div className="space-y-4">
      {/* Default: Contains filtering */}
      <EditableDropdown
        id="contains-filter"
        label="Contains Filter (default)"
        value={containsValue}
        options={medications}
        onChange={setContainsValue}
        filterMode="contains"  // Matches anywhere in string
        tabIndex={12}
        placeholder="Type 'met' to find Metformin..."
      />
      
      {/* Starts with filtering */}
      <EditableDropdown
        id="startswith-filter"
        label="Starts With Filter"
        value={startsWithValue}
        options={medications}
        onChange={setStartsWithValue}
        filterMode="startsWith"  // Only matches from beginning
        tabIndex={13}
        placeholder="Type 'Lis' to find Lisinopril..."
      />
    </div>
  );
}
```

### Custom Styling

```tsx
function CustomStyledDropdown() {
  const [value, setValue] = useState('');
  
  return (
    <EditableDropdown
      id="custom-styled"
      label="Custom Styled"
      value={value}
      options={['Option 1', 'Option 2', 'Option 3']}
      onChange={setValue}
      tabIndex={15}
      className="border-2 border-primary"  // Custom border
      placeholder="Custom styling..."
    />
  );
}
```

### Form Integration

```tsx
import { useForm, Controller } from 'react-hook-form';

interface FormData {
  route: string;
  form: string;
  frequency: string;
}

function MedicationDetailsForm() {
  const { control, handleSubmit, formState: { errors } } = useForm<FormData>();

  const onSubmit = (data: FormData) => {
    console.log('Form data:', data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Controller
        name="route"
        control={control}
        rules={{ required: 'Route is required' }}
        render={({ field, fieldState }) => (
          <EditableDropdown
            id="route"
            label="Route"
            value={field.value || ''}
            options={['Oral', 'IV', 'IM', 'SC']}
            onChange={field.onChange}
            error={fieldState.error?.message}
            tabIndex={1}
            placeholder="Select route..."
          />
        )}
      />
      
      <Controller
        name="form"
        control={control}
        rules={{ required: 'Form is required' }}
        render={({ field, fieldState }) => (
          <EditableDropdown
            id="form"
            label="Form"
            value={field.value || ''}
            options={['Tablet', 'Capsule', 'Liquid']}
            onChange={field.onChange}
            error={fieldState.error?.message}
            tabIndex={2}
            targetTabIndex={3}
            placeholder="Select form..."
          />
        )}
      />
      
      <button type="submit" tabIndex={4}>
        Submit
      </button>
    </form>
  );
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**:
  - Tab to focus the field
  - Enter/Space to enter edit mode when value is displayed
  - All autocomplete keyboard interactions when editing
  - Logical tab order with optional focus advancement

- **ARIA Attributes**:
  - `role="button"` on read-only display state
  - `aria-label` describes current value and edit action
  - `aria-describedby` for error messages
  - `aria-invalid` for error states
  - All EnhancedAutocompleteDropdown ARIA features when editing

- **Focus Management**:
  - Clear focus indicators in both display and edit modes
  - Auto-focus when entering edit mode
  - Focus advancement to next field after selection (optional)
  - Proper focus return after blur

### Screen Reader Support

- Read-only state announces current value and edit instructions
- Edit mode provides full autocomplete screen reader support
- Error messages are announced via role="alert"
- State transitions are clearly communicated

### Best Practices

```tsx
// ✅ Good: Proper labeling and tab order
<EditableDropdown
  id="dosage-form"
  label="Dosage Form"
  tabIndex={3}
  aria-required="true"
/>

// ✅ Good: Focus advancement for form flow
<EditableDropdown
  tabIndex={5}
  targetTabIndex={6}  // Next logical field
/>

// ✅ Good: Error handling
<EditableDropdown
  error={validationError}
  aria-invalid={!!validationError}
/>

// ❌ Avoid: Missing required props
<EditableDropdown
  // Missing: id, label, tabIndex
  value={value}
  options={options}
  onChange={onChange}
/>

// ❌ Avoid: Unclear labels or missing focus management
<EditableDropdown
  label="Field"  // Too generic
  tabIndex={0}   // Should be sequential
/>
```

## Styling

### CSS Classes

#### Read-Only Display State

- **Selected**: `border-blue-500 bg-blue-50 hover:bg-blue-100` (blue theme)
- **Disabled**: `cursor-not-allowed opacity-50 bg-gray-100`
- **Interactive**: `cursor-pointer` with hover effects
- **Layout**: `w-full px-3 py-2 pr-10 border rounded-md`

#### Edit Button

- **Positioning**: `absolute right-1 top-1/2 transform -translate-y-1/2`
- **Styling**: `p-1.5 hover:bg-gray-100 rounded`
- **Icon**: Edit2 icon from Lucide React

#### Edit Mode

- Uses EnhancedAutocompleteDropdown styling
- Inherits all autocomplete visual states
- Custom className applied to underlying input

### Visual States

1. **Empty State**: Shows autocomplete dropdown immediately
2. **Selected State**: Blue-themed read-only display with edit icon
3. **Edit Mode**: Full autocomplete functionality
4. **Disabled State**: Grayed out with disabled message
5. **Error State**: Red border and error message below

### Customization

```tsx
// Custom container styling
<EditableDropdown
  className="border-2 border-green-500"
  // Applied to both read-only and edit states
/>

// Hide label for compact layouts
<EditableDropdown
  showLabel={false}
  // Still maintains accessibility via aria-label
/>
```

## Implementation Notes

### Design Patterns

- **State Management**: Dual-mode (display/edit) with internal state coordination
- **Composition**: Uses EnhancedAutocompleteDropdown for edit functionality
- **Focus Management**: Advanced focus flow with optional target navigation
- **Accessibility First**: Every state change maintains screen reader compatibility

### Dependencies

- `lucide-react`: Edit2 icon for edit button
- `./label`: Label component for field labeling
- `./EnhancedAutocompleteDropdown`: Core autocomplete functionality
- `@/hooks/useFocusAdvancement`: Focus management hook
- `@/utils/logger`: Debug logging system

### Focus Advancement Integration

```typescript
// Using the focus advancement hook
const focusAdvancement = useFocusAdvancement({
  targetTabIndex: targetTabIndex || tabIndex + 1,
  enabled: !!targetTabIndex
});

// Automatic focus advancement after selection
const handleSelect = (selectedValue: string) => {
  onChange(selectedValue);
  setIsEditing(false);
  
  if (targetTabIndex) {
    focusAdvancement.handleSelection(selectedValue, 'keyboard');
  }
};
```

## Testing

### Unit Tests

Located in `src/components/ui/__tests__/editable-dropdown.test.tsx`:

- Display and edit mode transitions
- Keyboard interactions and focus management
- Error state handling and validation
- Focus advancement functionality
- ARIA attributes in different states

### E2E Tests

Covered in medication form tests:

- Complete edit workflow (select, display, edit, reselect)
- Keyboard navigation through forms
- Error handling and recovery
- Focus advancement between fields
- Screen reader interaction patterns

### Testing Patterns

```tsx
// Test mode transitions
test('should enter edit mode when clicked', async () => {
  render(
    <EditableDropdown
      id="test"
      label="Test"
      value="Selected Value"
      options={['Option 1', 'Option 2']}
      onChange={mockOnChange}
      tabIndex={1}
    />
  );

  // Should show read-only state initially
  expect(screen.getByRole('button')).toHaveTextContent('Selected Value');
  
  // Click to enter edit mode
  await user.click(screen.getByRole('button'));
  
  // Should show autocomplete input
  expect(screen.getByRole('combobox')).toBeInTheDocument();
});
```

## Related Components

- **EnhancedAutocompleteDropdown**: Core autocomplete functionality
- **SearchableDropdown**: Large dataset searching
- **MultiSelectDropdown**: Multi-selection interface
- **Label**: Field labeling component
- **Input**: Basic text input alternative

## Common Integration Patterns

### Medication Form Fields

```tsx
function MedicationFormSection() {
  const [formData, setFormData] = useState({
    route: '',
    form: '',
    strength: '',
    frequency: ''
  });

  const updateField = (field: string) => (value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="grid grid-cols-2 gap-4">
      <EditableDropdown
        id="route"
        label="Route"
        value={formData.route}
        options={ROUTES}
        onChange={updateField('route')}
        tabIndex={10}
        targetTabIndex={11}
      />
      
      <EditableDropdown
        id="form"
        label="Form"
        value={formData.form}
        options={FORMS}
        onChange={updateField('form')}
        tabIndex={11}
        targetTabIndex={12}
      />
      
      <EditableDropdown
        id="strength"
        label="Strength"
        value={formData.strength}
        options={STRENGTHS}
        onChange={updateField('strength')}
        tabIndex={12}
        targetTabIndex={13}
      />
      
      <EditableDropdown
        id="frequency"
        label="Frequency"
        value={formData.frequency}
        options={FREQUENCIES}
        onChange={updateField('frequency')}
        tabIndex={13}
        targetTabIndex={14}
      />
    </div>
  );
}
```

### Dynamic Option Loading

```tsx
function DynamicEditableDropdown() {
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [subcategoryOptions, setSubcategoryOptions] = useState([]);

  useEffect(() => {
    if (category) {
      // Load subcategories based on selected category
      loadSubcategories(category).then(setSubcategoryOptions);
      // Reset subcategory when category changes
      setSubcategory('');
    }
  }, [category]);

  return (
    <div className="space-y-4">
      <EditableDropdown
        id="category"
        label="Category"
        value={category}
        options={CATEGORIES}
        onChange={setCategory}
        tabIndex={20}
        targetTabIndex={21}
      />
      
      <EditableDropdown
        id="subcategory"
        label="Subcategory"
        value={subcategory}
        options={subcategoryOptions}
        onChange={setSubcategory}
        tabIndex={21}
        disabled={!category}
        disabledMessage="Select a category first"
      />
    </div>
  );
}
```

## Changelog

- **v1.0.0**: Initial implementation with basic edit functionality
- **v1.1.0**: Added EnhancedAutocompleteDropdown integration
- **v1.2.0**: Enhanced keyboard navigation and focus management
- **v1.3.0**: Added focus advancement with useFocusAdvancement hook
- **v1.4.0**: Improved accessibility with comprehensive ARIA support
- **v1.5.0**: Added filter mode options (contains/startsWith)
- **v1.6.0**: Enhanced visual states and disabled functionality
