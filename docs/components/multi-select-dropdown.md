# MultiSelectDropdown

## Overview

The MultiSelectDropdown component provides a unified multi-selection interface with checkbox-based selection, comprehensive keyboard navigation, and full WCAG 2.1 Level AA compliance. Built specifically for MobX integration, it handles observable arrays correctly and provides an accessible way to select multiple items from a list.

## Props Interface

```typescript
interface MultiSelectDropdownProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  label?: string;
  id: string;
  tabIndex?: number;
  buttonTabIndex?: number;
  maxHeight?: string;
  closeOnSelect?: boolean;
  onClose?: () => void;
}
```

## Usage Examples

### Basic Multi-Selection

```tsx
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { observer } from 'mobx-react-lite';

const CategorySelection = observer(() => {
  const [selectedCategories, setSelectedCategories] = useState([]);
  
  const categories = [
    'Cardiovascular',
    'Neurological', 
    'Gastrointestinal',
    'Respiratory',
    'Endocrine'
  ];

  return (
    <MultiSelectDropdown
      id="category-select"
      label="Therapeutic Categories"
      options={categories}
      selected={selectedCategories}
      onChange={setSelectedCategories}
      placeholder="Select categories..."
    />
  );
});
```

### With MobX ViewModel Integration

```tsx
import { observer } from 'mobx-react-lite';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';

const MedicationCategoryForm = observer(() => {
  const viewModel = useMedicationViewModel();

  return (
    <div className="space-y-4">
      <MultiSelectDropdown
        id="therapeutic-classes"
        label="Therapeutic Classes"
        options={viewModel.availableTherapeuticClasses}
        selected={viewModel.selectedTherapeuticClasses}  // Pass observable directly!
        onChange={(newSelection) => viewModel.setTherapeuticClasses(newSelection)}
        placeholder="Select therapeutic classes..."
        maxHeight="250px"
      />
      
      <MultiSelectDropdown
        id="indications"
        label="Indications"
        options={viewModel.availableIndications}
        selected={viewModel.selectedIndications}
        onChange={(newSelection) => viewModel.setIndications(newSelection)}
        placeholder="Select indications..."
        closeOnSelect={false}
      />
    </div>
  );
});
```

### Form Integration with Validation

```tsx
import { useForm, Controller } from 'react-hook-form';

interface FormData {
  categories: string[];
  tags: string[];
}

function MultiSelectForm() {
  const { control, handleSubmit, formState: { errors } } = useForm<FormData>();

  const onSubmit = (data: FormData) => {
    console.log('Selected categories:', data.categories);
    console.log('Selected tags:', data.tags);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div>
        <Controller
          name="categories"
          control={control}
          rules={{ required: 'Please select at least one category' }}
          render={({ field }) => (
            <MultiSelectDropdown
              id="categories"
              label="Categories"
              options={['Option 1', 'Option 2', 'Option 3']}
              selected={field.value || []}
              onChange={field.onChange}
              placeholder="Select categories..."
            />
          )}
        />
        {errors.categories && (
          <p className="text-sm text-destructive mt-1">
            {errors.categories.message}
          </p>
        )}
      </div>
      
      <button type="submit" className="btn btn-primary">
        Submit
      </button>
    </form>
  );
}
```

### Custom Styling and Behavior

```tsx
function CustomMultiSelect() {
  const [selected, setSelected] = useState(['Default Item']);
  
  return (
    <MultiSelectDropdown
      id="custom-select"
      label="Custom Options"
      options={['Option A', 'Option B', 'Option C', 'Option D']}
      selected={selected}
      onChange={setSelected}
      placeholder="Choose options..."
      maxHeight="200px"
      closeOnSelect={true}  // Close after each selection
      onClose={() => console.log('Dropdown closed')}
      buttonTabIndex={5}  // Custom tab order
    />
  );
}
```

### Dynamic Options Loading

```tsx
const DynamicMultiSelect = observer(() => {
  const [options, setOptions] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadOptions = async () => {
      setLoading(true);
      try {
        const data = await fetchCategoriesAPI();
        setOptions(data.map(item => item.name));
      } catch (error) {
        console.error('Failed to load options:', error);
      } finally {
        setLoading(false);
      }
    };

    loadOptions();
  }, []);

  if (loading) {
    return <div>Loading categories...</div>;
  }

  return (
    <MultiSelectDropdown
      id="dynamic-categories"
      label="Dynamic Categories"
      options={options}
      selected={selected}
      onChange={setSelected}
      placeholder={options.length ? "Select categories..." : "No categories available"}
    />
  );
});
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**: 
  - Tab to focus the dropdown button
  - Enter/Space to open dropdown
  - Arrow keys (↑/↓) to navigate options
  - Tab/Shift+Tab to navigate within dropdown
  - Space to toggle checkbox selection
  - Enter to accept selection and close
  - Escape to cancel and close

- **ARIA Attributes**:
  - `role="button"` on trigger button
  - `aria-expanded` indicates dropdown state
  - `aria-haspopup="listbox"` for dropdown type
  - `aria-controls` links button to listbox
  - `role="listbox"` on options container
  - `aria-multiselectable="true"` for multi-selection
  - `role="option"` on each selectable item
  - `aria-selected` for selection state
  - `aria-label` provides context and selection count

- **Focus Management**:
  - Clear focus indicators on all interactive elements
  - Focus moves logically through options
  - Focus returns to trigger button on close
  - Focus trapping within open dropdown
  - Visual focus indicators meet contrast requirements

### Screen Reader Support

- Button announces selection count and purpose
- Individual options are properly announced
- Selection state changes are communicated
- Keyboard shortcuts are intuitive and announced
- Proper semantic structure with roles and labels

### Best Practices

```tsx
// ✅ Good: Proper MobX integration
<MultiSelectDropdown
  selected={viewModel.selectedItems}  // Pass observable directly
  onChange={(items) => viewModel.setItems(items)}
/>

// ✅ Good: Meaningful labels and IDs
<MultiSelectDropdown
  id="medication-categories"
  label="Medication Categories"
  aria-label="Select therapeutic categories for medication"
/>

// ✅ Good: Proper form integration
<Controller
  name="categories"
  control={control}
  render={({ field }) => (
    <MultiSelectDropdown {...field} />
  )}
/>

// ❌ Avoid: Array spreading breaks MobX reactivity
<MultiSelectDropdown
  selected={[...observableArray]}  // Creates non-observable copy
/>

// ❌ Avoid: Missing required props
<MultiSelectDropdown
  options={items}
  // Missing: id, selected, onChange
/>
```

## Styling

### CSS Classes

#### Button (Trigger)
- **Layout**: Uses Button component with `variant="outline"`
- **Sizing**: `w-full justify-between min-h-[44px]` for touch accessibility
- **State**: Shows selection count with check icon when items selected

#### Dropdown Container
- **Positioning**: `absolute z-50 mt-1 w-full`
- **Theme**: `bg-white border rounded-lg shadow-lg`
- **Scrolling**: `overflow-auto` with configurable `maxHeight`

#### Options
- **Layout**: `flex items-center gap-3 px-3 py-2 rounded`
- **Focus**: `bg-blue-50 outline outline-2 outline-blue-500` for focused item
- **Hover**: `hover:bg-gray-50` for non-focused items
- **Selection**: Checkbox component with proper checked state

### Customization

```tsx
// Custom height and spacing
<MultiSelectDropdown
  maxHeight="400px"
  className="my-custom-dropdown"
/>

// The component automatically handles:
// - Responsive width (always full width of container)
// - Focus indicators that meet WCAG contrast requirements  
// - Hover states for mouse users
// - Selection visual feedback with checkmarks
```

## Implementation Notes

### Design Patterns

- **MobX Integration**: Uses `observer` HOC for reactive updates
- **Controlled Component**: Requires external state management
- **Focus Management**: Comprehensive keyboard navigation
- **Event Handling**: Proper event prevention and bubbling control
- **Accessibility First**: WCAG 2.1 Level AA compliant from the ground up

### MobX Reactivity Considerations

```typescript
// ✅ CORRECT: Pass observable arrays directly
const CategorySelect = observer(() => {
  return (
    <MultiSelectDropdown
      selected={viewModel.selectedCategories}  // Observable array
      onChange={(newSelection) => {
        // Use immutable update in ViewModel
        viewModel.setSelectedCategories(newSelection);
      }}
    />
  );
});

// ❌ WRONG: Array spreading breaks observable chain
const BrokenSelect = observer(() => {
  return (
    <MultiSelectDropdown
      selected={[...viewModel.selectedCategories]}  // Breaks reactivity!
    />
  );
});
```

### Performance Optimizations

- **Callback Memoization**: Uses `useCallback` for stable references
- **Ref Management**: Efficient DOM element references
- **Event Delegation**: Minimal event listeners
- **Conditional Rendering**: Dropdown only renders when open

### Dependencies

- `mobx-react-lite`: For reactive rendering with `observer`
- `lucide-react`: Icons (ChevronDown, ChevronUp, Check)
- `./button`: Button component for trigger
- `./checkbox`: Checkbox component for options
- `./utils`: Utility functions (cn for className merging)

## Testing

### Unit Tests

Located in `src/components/ui/__tests__/multi-select-dropdown.test.tsx`:
- Selection and deselection functionality
- Keyboard navigation through options
- Focus management and trapping
- MobX reactivity with observable arrays
- ARIA attributes and accessibility
- Event handling and prop changes

### E2E Tests

Covered in medication form and category selection tests:
- Full multi-selection workflow
- Keyboard-only interaction testing
- Screen reader compatibility
- Form submission with multi-select data
- Error handling and validation states

### Testing Patterns

```tsx
// Example test for MobX integration
test('should update when observable array changes', () => {
  const viewModel = new TestViewModel();
  const { rerender } = render(
    <Observer>
      {() => (
        <MultiSelectDropdown
          id="test"
          options={['A', 'B', 'C']}
          selected={viewModel.selectedItems}
          onChange={(items) => viewModel.setSelectedItems(items)}
        />
      )}
    </Observer>
  );

  // Change observable and verify UI updates
  act(() => {
    viewModel.setSelectedItems(['A']);
  });

  expect(screen.getByText('1 items selected')).toBeInTheDocument();
});
```

## Related Components

- **SearchableDropdown**: Single selection with search
- **EditableDropdown**: Editable single selection  
- **EnhancedAutocompleteDropdown**: Autocomplete functionality
- **Checkbox**: Individual checkbox for simple toggles
- **Button**: Trigger button styling

## Common Integration Patterns

### Complex Form Fields

```tsx
interface FormFieldGroupProps {
  title: string;
  description?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}

function FormFieldGroup({ 
  title, 
  description, 
  required, 
  error, 
  children 
}: FormFieldGroupProps) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-medium">
          {title}
          {required && <span className="text-destructive ml-1">*</span>}
        </h3>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      
      {children}
      
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// Usage
<FormFieldGroup 
  title="Therapeutic Categories" 
  description="Select all applicable categories"
  required
  error={validationErrors.categories}
>
  <MultiSelectDropdown
    id="categories"
    options={categories}
    selected={selectedCategories}
    onChange={setSelectedCategories}
  />
</FormFieldGroup>
```

### Conditional Logic Based on Selection

```tsx
const ConditionalForm = observer(() => {
  const viewModel = useFormViewModel();
  
  const hasAdvancedCategory = viewModel.selectedCategories.includes('Advanced');
  
  return (
    <div className="space-y-4">
      <MultiSelectDropdown
        id="categories"
        label="Categories"
        options={viewModel.availableCategories}
        selected={viewModel.selectedCategories}
        onChange={(selection) => viewModel.setCategories(selection)}
      />
      
      {hasAdvancedCategory && (
        <MultiSelectDropdown
          id="advanced-options"
          label="Advanced Options"
          options={viewModel.advancedOptions}
          selected={viewModel.selectedAdvancedOptions}
          onChange={(selection) => viewModel.setAdvancedOptions(selection)}
        />
      )}
    </div>
  );
});
```

## Changelog

- **v1.0.0**: Initial implementation with basic multi-selection
- **v1.1.0**: Added comprehensive keyboard navigation
- **v1.2.0**: Enhanced ARIA attributes for WCAG 2.1 Level AA compliance
- **v1.3.0**: Improved MobX integration with proper observable handling
- **v1.4.0**: Added focus management and trap functionality
- **v1.5.0**: Performance optimizations and debugging enhancements
- **v1.6.0**: Enhanced customization options and styling flexibility