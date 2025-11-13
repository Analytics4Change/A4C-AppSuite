---
status: current
last_updated: 2025-11-13
---

# SelectDropdown

## Overview

`SelectDropdown` is a simple, accessible dropdown component for selecting from a predefined list of options. It wraps the native HTML `<select>` element with consistent styling, error handling, and WCAG 2.1 Level AA accessibility compliance.

This component is ideal for forms requiring single selection from static option lists such as time zones, states, organization types, program types, and other enumerated values. For searchable dropdowns or dynamic data, consider using `SearchableDropdown` instead.

## Props and Usage

Props are documented inline in the component source code using TypeScript and JSDoc:

```typescript
export interface SelectOption {
  // Unique value for the option (submitted with form)
  value: string;

  // Display label shown to the user
  label: string;
}

export interface SelectDropdownProps {
  // Unique identifier for the select element
  id: string;

  // Label text displayed above the dropdown
  label: string;

  // Currently selected value (must match an option's value)
  value: string;

  // Array of options to display in the dropdown
  options: readonly SelectOption[] | SelectOption[];

  // Callback invoked with selected value when user makes a selection
  onChange: (value: string) => void;

  // Optional error message to display below dropdown
  error?: string | null;

  // Whether the field is required (adds red asterisk and aria-required)
  required?: boolean;

  // Whether the dropdown is disabled
  disabled?: boolean;

  // Optional placeholder text shown when no value selected
  placeholder?: string;

  // Tab order for keyboard navigation
  tabIndex?: number;
}
```

## Usage Examples

### Basic Usage

Simple dropdown for selecting organization type:

```tsx
import { useState } from 'react';
import { SelectDropdown } from '@/components/organization/SelectDropdown';

const organizationTypeOptions = [
  { value: 'provider', label: 'Healthcare Provider' },
  { value: 'partner', label: 'Partner Organization' },
  { value: 'vendor', label: 'Vendor' }
];

const OrganizationForm = () => {
  const [orgType, setOrgType] = useState('');

  return (
    <SelectDropdown
      id="org-type"
      label="Organization Type"
      value={orgType}
      options={organizationTypeOptions}
      onChange={setOrgType}
      placeholder="Select organization type"
      required
    />
  );
};
```

### With Error Handling

Displaying validation errors:

```tsx
import { useState } from 'react';
import { SelectDropdown, SelectOption } from '@/components/organization/SelectDropdown';

const US_STATES: SelectOption[] = [
  { value: 'AL', label: 'Alabama' },
  { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },
  // ... other states
];

const AddressForm = () => {
  const [state, setState] = useState('');
  const [stateError, setStateError] = useState<string | null>(null);

  const handleStateChange = (value: string) => {
    setState(value);

    // Validate selection
    if (!value) {
      setStateError('State is required');
    } else {
      setStateError(null);
    }
  };

  return (
    <SelectDropdown
      id="state"
      label="State"
      value={state}
      options={US_STATES}
      onChange={handleStateChange}
      error={stateError}
      required
    />
  );
};
```

### Advanced Usage with Form Integration

Using with react-hook-form and custom tab order:

```tsx
import { useForm, Controller } from 'react-hook-form';
import { SelectDropdown, SelectOption } from '@/components/organization/SelectDropdown';

const TIMEZONES: SelectOption[] = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' }
];

interface FormData {
  timezone: string;
  // ... other fields
}

const ProviderSettingsForm = () => {
  const {
    control,
    formState: { errors }
  } = useForm<FormData>();

  return (
    <form>
      <Controller
        name="timezone"
        control={control}
        rules={{ required: 'Timezone is required' }}
        render={({ field }) => (
          <SelectDropdown
            id="timezone"
            label="Timezone"
            value={field.value}
            options={TIMEZONES}
            onChange={field.onChange}
            error={errors.timezone?.message}
            required
            tabIndex={10}
          />
        )}
      />
    </form>
  );
};
```

### Disabled State

Displaying read-only selection:

```tsx
<SelectDropdown
  id="readonly-type"
  label="Organization Type"
  value="provider"
  options={organizationTypeOptions}
  onChange={() => {}}  // No-op for read-only
  disabled
/>
```

### Dynamic Options

Loading options from API or ViewModel:

```tsx
import { observer } from 'mobx-react-lite';
import { SelectDropdown } from '@/components/organization/SelectDropdown';
import { useProgramViewModel } from '@/viewModels/program/useProgramViewModel';

const ProgramSelection = observer(() => {
  const vm = useProgramViewModel();

  // ViewModel provides observable array of programs
  const programOptions = vm.programs.map(program => ({
    value: program.id,
    label: program.name
  }));

  return (
    <SelectDropdown
      id="program"
      label="Select Program"
      value={vm.selectedProgramId}
      options={programOptions}
      onChange={vm.selectProgram}
      placeholder="Choose a program"
    />
  );
});
```

## Accessibility

### WCAG 2.1 Level AA Compliance

The component implements comprehensive accessibility features using native HTML `<select>` element capabilities.

#### Keyboard Navigation

- **Tab**: Moves focus to/from the dropdown
- **Shift+Tab**: Moves focus backward
- **Space/Enter**: Opens the dropdown menu
- **Arrow Up/Down**: Navigates through options
- **Home**: Jumps to first option
- **End**: Jumps to last option
- **Escape**: Closes dropdown without selection
- **Type-ahead**: Typing letters jumps to matching options

#### ARIA Attributes

- **`aria-label`**: Set to the `label` prop value for screen reader identification
- **`aria-required`**: Set to `true` when `required` prop is true
- **`aria-invalid`**: Set to `true` when `error` prop has a value
- **`aria-describedby`**: Points to error message ID when error is present
- **`role="alert"`**: Applied to error message for immediate announcement

#### Focus Management

- **Visible Focus Indicator**: Blue ring (`focus:ring-2 focus:ring-blue-500`)
- **Focus Order**: Follows natural DOM order, customizable via `tabIndex`
- **No Focus Traps**: Dropdown can be freely navigated to/from
- **Native Behavior**: Browser handles dropdown focus automatically

#### Screen Reader Support

- **Label Association**: `<Label htmlFor={id}>` properly associates label with select
- **Required Field Announcement**: Screen readers announce "required" via `aria-required`
- **Error Announcement**: Errors announced immediately via `role="alert"`
- **Option Reading**: Screen readers read option labels during navigation
- **Selection Announcement**: Screen readers announce selected option

#### Visual Indicators

- **Required Field**: Red asterisk (*) displayed after label
- **Error State**: Red border applied when error present
- **Error Message**: Red text below dropdown with clear error description
- **Disabled State**: Reduced opacity (0.5) and "not-allowed" cursor
- **Focus State**: Blue ring for keyboard focus visibility

## Styling

### CSS Classes

#### Container
- `space-y-2` - Vertical spacing between label, dropdown, and error message

#### Label
- Standard `<Label>` component styling
- `.text-red-500` (required asterisk) - High contrast red for visibility
- `.ml-1` (required asterisk) - Small left margin for spacing

#### Select Element

**Base Styles**:
- `w-full` - Full width of container
- `rounded-md` - Medium border radius
- `border` - 1px border
- `px-3 py-2` - Horizontal and vertical padding
- `text-sm` - Small text size
- `shadow-sm` - Subtle shadow

**Focus Styles**:
- `focus:outline-none` - Remove default outline
- `focus:ring-2` - 2px focus ring
- `focus:ring-blue-500` - Blue ring color
- `focus:border-transparent` - Hide border when focused

**Disabled Styles**:
- `disabled:cursor-not-allowed` - Shows disabled cursor
- `disabled:opacity-50` - 50% opacity for visual dimming

**Conditional Styles**:
- `border-red-500` - Red border when error present
- `border-gray-300` - Gray border in normal state

#### Error Message
- `.text-sm` - Smaller text size for error messages
- `.text-red-500` - Red color for error visibility (4.5:1 contrast ratio)

### Customization

To customize styling:

1. **Global Select Styling**: Modify the className in source code
2. **Custom Container**: Wrap component in div with custom classes
3. **Theme Integration**: Update Tailwind config for consistent theming

```tsx
<div className="my-custom-dropdown-wrapper">
  <SelectDropdown {...props} />
</div>
```

## Implementation Notes

### Design Patterns

- **Controlled Component**: Value and onChange must be provided (no internal state)
- **Native HTML Select**: Uses standard `<select>` element for accessibility and browser compatibility
- **Error Feedback Pattern**: Error displayed below dropdown with proper ARIA association
- **Composition Pattern**: Uses base `Label` component for consistency

### State Management

- **Parent Controlled**: Component does not manage its own state
- **Value Prop**: Must match one of the option values
- **onChange Callback**: Parent receives selected value as string
- **Validation**: Parent responsible for validation logic

### Dependencies

- **UI Components**: `Label` from `@/components/ui/label`
- **React**: Standard React library only (no external dropdown libraries)

### Performance Considerations

- **Static Options**: Best for < 100 options (native select performance degrades with many options)
- **No Virtual Scrolling**: Browser handles scrolling natively
- **Minimal Re-renders**: Only re-renders when props change
- **No Event Handlers**: Single onChange handler, no per-option handlers

### Browser Compatibility

- **All Modern Browsers**: Standard HTML `<select>` supported universally
- **Mobile Optimized**: Native mobile pickers automatically invoked
- **No JavaScript Required**: Basic functionality works without JavaScript
- **Progressive Enhancement**: JavaScript adds validation and error handling

### Option Data Structure

Options must be an array of objects with `value` and `label` properties:

```typescript
const options: SelectOption[] = [
  { value: 'key1', label: 'Display Text 1' },
  { value: 'key2', label: 'Display Text 2' }
];
```

**Best Practices**:
- Use descriptive labels (user-facing text)
- Use stable values (backend keys, IDs, enums)
- Keep option count reasonable (< 100 for performance)
- Sort alphabetically or by relevance
- Include placeholder for optional fields

### Placeholder Behavior

When `placeholder` prop provided:
- Displays as first disabled option
- Value is empty string
- Not selectable by user
- Helps indicate field purpose
- Disappears after selection

```typescript
<option value="" disabled>
  {placeholder}
</option>
```

## Testing

### Unit Tests

**Location**: `frontend/src/components/organization/__tests__/SelectDropdown.test.tsx` (recommended)

**Key Test Cases**:
- ✅ Renders label and select with correct IDs
- ✅ Displays required asterisk when required=true
- ✅ Renders all options correctly
- ✅ Calls onChange with selected value
- ✅ Displays error message when error prop provided
- ✅ Applies error styling when error present
- ✅ Sets ARIA attributes correctly
- ✅ Disabled state prevents selection
- ✅ Placeholder option is disabled

**Test Example**:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectDropdown } from './SelectDropdown';

const mockOptions = [
  { value: 'opt1', label: 'Option 1' },
  { value: 'opt2', label: 'Option 2' },
  { value: 'opt3', label: 'Option 3' }
];

test('calls onChange with selected value', () => {
  const handleChange = vi.fn();

  render(
    <SelectDropdown
      id="test-select"
      label="Test Dropdown"
      value=""
      options={mockOptions}
      onChange={handleChange}
    />
  );

  const select = screen.getByLabelText('Test Dropdown');

  // Select option 2
  fireEvent.change(select, { target: { value: 'opt2' } });

  expect(handleChange).toHaveBeenCalledWith('opt2');
});

test('displays error message with correct ARIA', () => {
  render(
    <SelectDropdown
      id="test-select"
      label="Test Dropdown"
      value=""
      options={mockOptions}
      onChange={() => {}}
      error="Please select an option"
    />
  );

  const select = screen.getByLabelText('Test Dropdown');
  const error = screen.getByRole('alert');

  expect(error).toHaveTextContent('Please select an option');
  expect(select).toHaveAttribute('aria-invalid', 'true');
  expect(select).toHaveAttribute('aria-describedby', 'test-select-error');
});
```

### E2E Tests

**Location**: `frontend/e2e/organization-form.spec.ts` (recommended)

**Key User Flows**:
- User selects option from dropdown
- User sees error when required field empty
- Keyboard navigation through options
- Screen reader announces selected option

**Test Example**:

```typescript
test('select dropdown works correctly', async ({ page }) => {
  await page.goto('http://localhost:5173/organizations/create');

  const select = page.locator('#org-type');

  // Select option
  await select.selectOption('provider');

  // Should see selected value
  await expect(select).toHaveValue('provider');

  // Clear selection (if placeholder exists)
  await select.selectOption('');

  // Should see error for required field
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('#org-type-error')).toBeVisible();
});
```

## Related Components

- **Label** (`/components/ui/label.tsx`) - Label component for accessibility
- **EditableDropdown** (`/components/ui/EditableDropdown.tsx`) - Dropdown with edit capability after selection
- **SearchableDropdown** (`/components/ui/searchable-dropdown.tsx`) - For large datasets with search
- **MultiSelectDropdown** (`/components/ui/MultiSelectDropdown.tsx`) - For selecting multiple options
- **EnhancedAutocompleteDropdown** (`/components/ui/EnhancedAutocompleteDropdown.tsx`) - With autocomplete

## When to Use

### Use SelectDropdown When:
- ✅ Small to medium option count (< 100)
- ✅ Static, predefined options
- ✅ Single selection required
- ✅ Native mobile picker desired
- ✅ Simple selection without search

### Use Alternatives When:
- ❌ Large dataset (100+ options) → Use `SearchableDropdown`
- ❌ Need to edit selection → Use `EditableDropdown`
- ❌ Multiple selections → Use `MultiSelectDropdown`
- ❌ Autocomplete needed → Use `EnhancedAutocompleteDropdown`
- ❌ Dynamic filtering → Use `SearchableDropdown`

## Common Issues and Solutions

### Issue: Placeholder Not Showing

**Cause**: Value is not empty string, or placeholder not provided

**Solution**: Ensure initial value is `""` (empty string) and placeholder prop is set

```tsx
const [value, setValue] = useState('');  // ✅ Empty string

<SelectDropdown
  value={value}
  placeholder="Select an option"  // ✅ Placeholder provided
  ...
/>
```

### Issue: onChange Not Firing

**Cause**: Event handler not properly bound

**Solution**: Ensure onChange prop receives a function:

```tsx
// ✅ GOOD
onChange={setValue}
onChange={(value) => setValue(value)}

// ❌ BAD
onChange={setValue()}  // Calls function immediately
```

### Issue: Option Not Displaying

**Cause**: Option value doesn't match selected value exactly

**Solution**: Ensure string equality between value prop and option.value:

```tsx
// Value must match option.value exactly
options = [{ value: 'provider', label: 'Provider' }];
value = 'provider';  // ✅ Exact match
```

## Changelog

- **2025-11-13**: Initial documentation created
- **Component Creation**: Part of organization management module implementation
