# EnhancedAutocompleteDropdown

## Overview

The EnhancedAutocompleteDropdown component provides advanced autocomplete functionality with unified highlighting behavior, intelligent filtering, and comprehensive keyboard navigation. It serves as the foundation for other dropdown components and supports both preset options and custom values with sophisticated visual feedback.

## Props Interface

```typescript
interface EnhancedAutocompleteDropdownProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  onSelect?: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  error?: boolean;
  id?: string;
  tabIndex?: number;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
  autoFocus?: boolean;
  onBlur?: () => void;
  onFocus?: () => void;
  allowCustomValue?: boolean;
  filterStrategy?: 'contains' | 'startsWith';
}
```

## Usage Examples

### Basic Autocomplete

```tsx
import { EnhancedAutocompleteDropdown } from '@/components/ui/EnhancedAutocompleteDropdown';

function MedicationUnitSelector() {
  const [unit, setUnit] = useState('');
  
  const units = [
    'mg', 'g', 'kg',
    'mL', 'L',
    'tablets', 'capsules',
    'drops', 'sprays',
    'patches', 'vials'
  ];

  return (
    <EnhancedAutocompleteDropdown
      id="medication-unit"
      options={units}
      value={unit}
      onChange={setUnit}
      onSelect={(selectedUnit) => {
        setUnit(selectedUnit);
        console.log('Unit selected:', selectedUnit);
      }}
      placeholder="Type or select unit..."
      aria-label="Medication unit"
    />
  );
}
```

### With Form Integration

```tsx
import { useForm, Controller } from 'react-hook-form';

interface DosageForm {
  amount: string;
  unit: string;
  frequency: string;
}

function DosageFormInputs() {
  const { control, handleSubmit, watch, formState: { errors } } = useForm<DosageForm>();

  const units = ['mg', 'g', 'mL', 'tablets'];
  const frequencies = ['Once daily', 'Twice daily', 'Three times daily', 'Four times daily', 'As needed'];

  const onSubmit = (data: DosageForm) => {
    console.log('Dosage data:', data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label htmlFor="amount">Amount</label>
          <Controller
            name="amount"
            control={control}
            rules={{ required: 'Amount is required' }}
            render={({ field }) => (
              <input
                id="amount"
                type="number"
                {...field}
                className="w-full px-3 py-2 border rounded-md"
                placeholder="0"
              />
            )}
          />
          {errors.amount && (
            <p className="text-sm text-red-600">{errors.amount.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="unit">Unit</label>
          <Controller
            name="unit"
            control={control}
            rules={{ required: 'Unit is required' }}
            render={({ field, fieldState }) => (
              <EnhancedAutocompleteDropdown
                id="unit"
                options={units}
                value={field.value || ''}
                onChange={field.onChange}
                onSelect={field.onChange}
                placeholder="Select unit..."
                error={fieldState.invalid}
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.error ? 'unit-error' : undefined}
                allowCustomValue={false}
              />
            )}
          />
          {errors.unit && (
            <p id="unit-error" className="text-sm text-red-600">{errors.unit.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="frequency">Frequency</label>
          <Controller
            name="frequency"
            control={control}
            rules={{ required: 'Frequency is required' }}
            render={({ field }) => (
              <EnhancedAutocompleteDropdown
                id="frequency"
                options={frequencies}
                value={field.value || ''}
                onChange={field.onChange}
                onSelect={field.onChange}
                placeholder="Select frequency..."
                allowCustomValue={true}
              />
            )}
          />
        </div>
      </div>

      <button type="submit" className="btn btn-primary">
        Save Dosage
      </button>
    </form>
  );
}
```

### Custom Value Support

```tsx
function CustomValueExample() {
  const [customFrequency, setCustomFrequency] = useState('');
  
  const standardFrequencies = [
    'Once daily',
    'Twice daily', 
    'Three times daily',
    'Every 4 hours',
    'Every 6 hours',
    'Every 8 hours'
  ];

  const handleFrequencySelect = (frequency: string) => {
    setCustomFrequency(frequency);
    // You could also validate custom values here
    if (!standardFrequencies.includes(frequency)) {
      console.log('Custom frequency entered:', frequency);
    }
  };

  return (
    <div className="space-y-2">
      <label htmlFor="custom-frequency">
        Frequency (standard or custom)
      </label>
      
      <EnhancedAutocompleteDropdown
        id="custom-frequency"
        options={standardFrequencies}
        value={customFrequency}
        onChange={setCustomFrequency}
        onSelect={handleFrequencySelect}
        placeholder="Type custom or select standard..."
        allowCustomValue={true}
        aria-label="Medication frequency"
      />
      
      <p className="text-sm text-gray-600">
        Choose from standard frequencies or type your own (e.g., "Every 12 hours with food")
      </p>
    </div>
  );
}
```

### Filter Strategy Examples

```tsx
function FilteringExamples() {
  const [containsValue, setContainsValue] = useState('');
  const [startsWithValue, setStartsWithValue] = useState('');
  
  const medications = [
    'Lisinopril',
    'Amlodipine',
    'Metformin', 
    'Atorvastatin',
    'Omeprazole',
    'Metoprolol',
    'Simvastatin'
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-2">Contains Filter (Default)</h3>
        <EnhancedAutocompleteDropdown
          id="contains-filter"
          options={medications}
          value={containsValue}
          onChange={setContainsValue}
          filterStrategy="contains"
          placeholder="Type 'met' to find Metformin and Metoprolol..."
          aria-label="Medication search with contains filter"
        />
        <p className="text-sm text-gray-600 mt-1">
          Matches anywhere in the text. "met" finds both "Metformin" and "Metoprolol"
        </p>
      </div>

      <div>
        <h3 className="text-lg font-medium mb-2">Starts With Filter</h3>
        <EnhancedAutocompleteDropdown
          id="startswith-filter"
          options={medications}
          value={startsWithValue}
          onChange={setStartsWithValue}
          filterStrategy="startsWith"
          placeholder="Type 'Met' to find only Metformin and Metoprolol..."
          aria-label="Medication search with starts-with filter"
        />
        <p className="text-sm text-gray-600 mt-1">
          Only matches from the beginning. "Met" finds "Metformin" but not "Omeprazole"
        </p>
      </div>
    </div>
  );
}
```

### Controlled with External State

```tsx
function ControlledAutocomplete() {
  const [selectedMedication, setSelectedMedication] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [isValid, setIsValid] = useState(true);
  
  const medications = ['Aspirin', 'Ibuprofen', 'Acetaminophen'];

  const handleInputChange = (value: string) => {
    setInputValue(value);
    
    // Validate in real-time
    if (value && !medications.some(med => 
      med.toLowerCase().includes(value.toLowerCase())
    )) {
      setIsValid(false);
    } else {
      setIsValid(true);
    }
  };

  const handleSelection = (medication: string) => {
    setSelectedMedication(medication);
    setInputValue(medication);
    setIsValid(true);
    console.log('Selected medication:', medication);
  };

  return (
    <div className="space-y-2">
      <label htmlFor="controlled-med">Medication Name</label>
      
      <EnhancedAutocompleteDropdown
        id="controlled-med"
        options={medications}
        value={inputValue}
        onChange={handleInputChange}
        onSelect={handleSelection}
        placeholder="Start typing medication name..."
        error={!isValid}
        aria-invalid={!isValid}
        aria-describedby={!isValid ? 'med-error' : undefined}
        allowCustomValue={false}
      />
      
      {!isValid && (
        <p id="med-error" role="alert" className="text-sm text-red-600">
          Please select a medication from the list
        </p>
      )}
      
      {selectedMedication && (
        <p className="text-sm text-green-600">
          Selected: {selectedMedication}
        </p>
      )}
    </div>
  );
}
```

### Dynamic Loading with Async Options

```tsx
function AsyncAutocomplete() {
  const [options, setOptions] = useState<string[]>([]);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);

  // Debounced search function
  const searchMedications = useCallback(
    debounce(async (query: string) => {
      if (query.length < 2) {
        setOptions([]);
        return;
      }

      setLoading(true);
      try {
        const results = await medicationAPI.search(query);
        setOptions(results.map(med => med.name));
      } catch (error) {
        console.error('Search failed:', error);
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }, 300),
    []
  );

  const handleInputChange = (newValue: string) => {
    setValue(newValue);
    searchMedications(newValue);
  };

  return (
    <div className="space-y-2">
      <label htmlFor="async-search">
        Medication Search
        {loading && <span className="text-sm text-gray-500 ml-2">(searching...)</span>}
      </label>
      
      <EnhancedAutocompleteDropdown
        id="async-search"
        options={options}
        value={value}
        onChange={handleInputChange}
        onSelect={setValue}
        placeholder="Type at least 2 characters to search..."
        disabled={loading}
        aria-label="Search medications"
      />
      
      <p className="text-sm text-gray-600">
        Search from thousands of medications in our database
      </p>
    </div>
  );
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**: 
  - Tab to focus input field
  - Type to filter and show dropdown
  - Arrow keys (↑/↓) to navigate options
  - Home/End to jump to first/last option
  - Enter to select highlighted option
  - Escape to close dropdown
  - Tab to move to next field (closes dropdown)

- **ARIA Attributes**:
  - `role="combobox"` on input field
  - `aria-expanded` indicates dropdown state
  - `aria-autocomplete="list"` for autocomplete behavior
  - `aria-controls` links input to listbox
  - `aria-activedescendant` identifies focused option
  - `role="listbox"` on options container
  - `role="option"` on each selectable item
  - `aria-selected` for highlighted state

- **Focus Management**:
  - Clear focus indicators on input and options
  - Focus remains on input during navigation
  - Focus restoration after selection
  - Proper focus trapping within dropdown

### Screen Reader Support

- Input purpose and current value announced
- Number of filtered options communicated
- Navigation through options with position feedback
- Selection confirmation announced
- Error states and validation messages read aloud

### Best Practices

```tsx
// ✅ Good: Complete accessibility attributes
<EnhancedAutocompleteDropdown
  id="medication-name"
  aria-label="Medication name"
  aria-required="true"
  aria-describedby="med-help med-error"
  aria-invalid={hasError}
/>

// ✅ Good: Error handling with proper announcements
<EnhancedAutocompleteDropdown
  error={!!errorMessage}
  aria-invalid={!!errorMessage}
  aria-describedby={errorMessage ? 'error-id' : undefined}
/>
{errorMessage && (
  <p id="error-id" role="alert" className="text-red-600">
    {errorMessage}
  </p>
)}

// ✅ Good: Meaningful labels and help text
<label htmlFor="frequency">Dosage Frequency</label>
<EnhancedAutocompleteDropdown
  id="frequency"
  aria-describedby="frequency-help"
/>
<p id="frequency-help" className="text-sm text-gray-600">
  Choose standard frequency or enter custom instructions
</p>

// ❌ Avoid: Missing essential accessibility props
<EnhancedAutocompleteDropdown
  // Missing: id, aria-label, proper labeling
  options={options}
  value={value}
  onChange={onChange}
/>
```

## Styling

### CSS Classes

#### Input Field
- **Base**: `w-full px-3 py-2 pr-10 border rounded-md`
- **Focus**: `focus:outline-none focus:ring-2 focus:ring-blue-500`
- **Error**: `border-red-500` (when error prop is true)
- **Normal**: `border-gray-300`
- **Disabled**: `bg-gray-100 cursor-not-allowed`

#### Dropdown Container
- **Positioning**: `absolute z-50 w-full mt-1`
- **Theme**: `bg-white border border-gray-200 rounded-md shadow-lg`
- **Scrolling**: `max-h-60 overflow-auto`

#### Options (Unified Highlighting)
Uses the unified highlighting system with CSS classes:
- **Typed Match**: `dropdown-item-typed-match` (blue background)
- **Navigation**: `dropdown-item-navigation` (box shadow outline)
- **Both**: `dropdown-item-both` (combined highlighting)
- **None**: `hover:bg-gray-50` (hover only)

### Unified Highlighting System

The component uses the sophisticated highlighting system from `useDropdownHighlighting`:

```css
/* CSS classes from /styles/dropdown-highlighting.css */
.dropdown-item {
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.dropdown-item-typed-match {
  background-color: rgb(219 234 254); /* blue-100 */
}

.dropdown-item-navigation {
  box-shadow: inset 0 0 0 2px rgb(59 130 246); /* blue-500 */
}

.dropdown-item-both {
  background-color: rgb(219 234 254);
  box-shadow: inset 0 0 0 2px rgb(59 130 246);
}
```

### Highlighting Behavior

- **Typing Mode**: Multiple items with blue background for matches
- **Navigation Mode**: Single item with box shadow for arrow selection
- **Combined Mode**: Both highlights when arrow-navigating to typed match
- **Smart Sorting**: StartsWith matches appear before contains matches

## Implementation Notes

### Design Patterns

- **Controlled Component**: Requires external state management
- **Unified Highlighting**: Uses `useDropdownHighlighting` hook
- **Intelligent Filtering**: StartsWith results prioritized over contains
- **Flexible Selection**: Supports both preset and custom values
- **Event Delegation**: Efficient event handling with minimal listeners

### Dependencies

- `lucide-react`: ChevronDown icon for dropdown indicator
- `@/hooks/useDropdownHighlighting`: Unified highlighting behavior
- `@/types/dropdown`: HighlightType enum for highlight states
- `@/styles/dropdown-highlighting.css`: Visual highlighting styles
- `./utils`: Utility functions (cn for className merging)

### Performance Optimizations

- **Debounced Filtering**: Built-in filtering with performance considerations
- **Virtual Scrolling**: Smooth scrolling for highlighted items
- **Efficient Re-renders**: Memoized highlight calculations
- **Smart Event Handling**: Minimal DOM event listeners

### Filter Strategy Implementation

```typescript
// Contains strategy (default)
const filtered = options.filter(option => 
  option.toLowerCase().includes(searchTerm)
);

// StartsWith strategy
const filtered = options.filter(option => 
  option.toLowerCase().startsWith(searchTerm)
);

// Smart sorting (both strategies)
filtered.sort((a, b) => {
  const aStarts = a.toLowerCase().startsWith(searchTerm);
  const bStarts = b.toLowerCase().startsWith(searchTerm);
  if (aStarts && !bStarts) return -1;
  if (!aStarts && bStarts) return 1;
  return 0;
});
```

## Testing

### Unit Tests

Located in `src/components/ui/__tests__/enhanced-autocomplete-dropdown.test.tsx`:
- Input filtering and option display
- Keyboard navigation (arrows, home, end, enter, escape)
- Highlight state management
- Custom value handling
- Error state display
- Accessibility attributes

### E2E Tests

Covered in form and medication entry tests:
- Complete autocomplete workflow
- Keyboard-only interaction
- Screen reader compatibility
- Form validation integration
- Custom value entry scenarios

### Testing Patterns

```tsx
// Test filtering behavior
test('should filter options based on input', async () => {
  const options = ['Apple', 'Banana', 'Orange'];
  render(
    <EnhancedAutocompleteDropdown
      id="test"
      options={options}
      value=""
      onChange={mockOnChange}
    />
  );

  const input = screen.getByRole('combobox');
  await user.type(input, 'ap');
  
  expect(screen.getByText('Apple')).toBeInTheDocument();
  expect(screen.queryByText('Banana')).not.toBeInTheDocument();
});

// Test keyboard navigation
test('should navigate with arrow keys', async () => {
  render(
    <EnhancedAutocompleteDropdown
      id="test"
      options={['Option 1', 'Option 2']}
      value=""
      onChange={mockOnChange}
    />
  );

  const input = screen.getByRole('combobox');
  await user.click(input);
  await user.keyboard('{ArrowDown}');
  
  expect(screen.getByRole('option', { name: 'Option 1' }))
    .toHaveAttribute('aria-selected', 'true');
});
```

## Related Components

- **EditableDropdown**: Uses this component for edit mode
- **SearchableDropdown**: Alternative for large datasets
- **MultiSelectDropdown**: Multi-selection variant
- **Input**: Simple text input alternative

## Common Integration Patterns

### Form Field Wrapper

```tsx
interface AutocompleteFieldProps {
  name: string;
  label: string;
  options: string[];
  required?: boolean;
  helpText?: string;
  allowCustomValue?: boolean;
}

function AutocompleteField({ 
  name, 
  label, 
  options, 
  required, 
  helpText,
  allowCustomValue = false 
}: AutocompleteFieldProps) {
  const { register, formState: { errors } } = useFormContext();
  const error = errors[name]?.message as string;

  return (
    <div className="space-y-2">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      
      <Controller
        name={name}
        rules={{ required: required ? `${label} is required` : false }}
        render={({ field }) => (
          <EnhancedAutocompleteDropdown
            id={name}
            options={options}
            value={field.value || ''}
            onChange={field.onChange}
            onSelect={field.onChange}
            error={!!error}
            aria-invalid={!!error}
            aria-required={required}
            aria-describedby={[
              helpText ? `${name}-help` : null,
              error ? `${name}-error` : null
            ].filter(Boolean).join(' ') || undefined}
            allowCustomValue={allowCustomValue}
          />
        )}
      />
      
      {helpText && (
        <p id={`${name}-help`} className="text-sm text-gray-600">
          {helpText}
        </p>
      )}
      
      {error && (
        <p id={`${name}-error`} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
```

### Multi-Field Coordination

```tsx
function CoordinatedFields() {
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [subcategoryOptions, setSubcategoryOptions] = useState([]);

  useEffect(() => {
    if (category) {
      // Load subcategories when category changes
      const newSubcategories = getSubcategoriesForCategory(category);
      setSubcategoryOptions(newSubcategories);
      
      // Reset subcategory if it's not valid for new category
      if (subcategory && !newSubcategories.includes(subcategory)) {
        setSubcategory('');
      }
    } else {
      setSubcategoryOptions([]);
      setSubcategory('');
    }
  }, [category, subcategory]);

  return (
    <div className="grid grid-cols-2 gap-4">
      <EnhancedAutocompleteDropdown
        id="category"
        options={['Electronics', 'Clothing', 'Books', 'Sports']}
        value={category}
        onChange={setCategory}
        onSelect={setCategory}
        placeholder="Select category..."
        aria-label="Product category"
      />
      
      <EnhancedAutocompleteDropdown
        id="subcategory"
        options={subcategoryOptions}
        value={subcategory}
        onChange={setSubcategory}
        onSelect={setSubcategory}
        placeholder={category ? "Select subcategory..." : "Select category first"}
        disabled={!category}
        aria-label="Product subcategory"
      />
    </div>
  );
}
```

## Changelog

- **v1.0.0**: Initial implementation with basic autocomplete
- **v1.1.0**: Added unified highlighting system integration
- **v1.2.0**: Enhanced keyboard navigation (Home/End keys)
- **v1.3.0**: Improved filtering with smart sorting (startsWith first)
- **v1.4.0**: Added custom value support with allowCustomValue prop
- **v1.5.0**: Enhanced accessibility with comprehensive ARIA support
- **v1.6.0**: Added filter strategy options (contains/startsWith)
- **v1.7.0**: Performance optimizations and refined highlighting behavior