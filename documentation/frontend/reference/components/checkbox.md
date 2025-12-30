---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Radix UI-based checkbox with checked, unchecked, and indeterminate states. Includes form integration patterns, select-all logic, and comprehensive accessibility support.

**When to read**:
- Implementing checkbox groups or select-all functionality
- Handling indeterminate state for partial selections
- Integrating checkboxes with react-hook-form
- Understanding checkbox accessibility and ARIA attributes

**Prerequisites**: None

**Key topics**: `checkbox`, `radix-ui`, `indeterminate`, `react-hook-form`, `accessibility`

**Estimated read time**: 18 minutes
<!-- TL;DR-END -->

# Checkbox

## Overview

The Checkbox component provides an accessible, customizable checkbox input built on Radix UI's Checkbox primitive. It supports checked, unchecked, and indeterminate states with comprehensive styling for different themes and validation states.

## Props Interface

```typescript
interface CheckboxProps extends React.ComponentProps<typeof CheckboxPrimitive.Root> {
  className?: string;
  checked?: boolean | 'indeterminate';
  onCheckedChange?: (checked: boolean | 'indeterminate') => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  value?: string;
  id?: string;
}
```

The component extends Radix UI's Checkbox primitive, inheriting all native checkbox functionality including:

- `checked`: Controls the checked state (boolean or 'indeterminate')
- `onCheckedChange`: Callback fired when checked state changes
- `disabled`: Disables the checkbox
- `required`: Makes the checkbox required for form validation
- All standard HTML input attributes

## Usage Examples

### Basic Checkbox

```tsx
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

function BasicCheckbox() {
  const [checked, setChecked] = useState(false);

  return (
    <div className="flex items-center space-x-2">
      <Checkbox 
        id="terms" 
        checked={checked}
        onCheckedChange={setChecked}
      />
      <Label htmlFor="terms">
        I agree to the terms and conditions
      </Label>
    </div>
  );
}
```

### Checkbox Group

```tsx
function NotificationPreferences() {
  const [preferences, setPreferences] = useState({
    email: false,
    sms: false,
    push: true
  });

  const handlePreferenceChange = (key: string) => (checked: boolean) => {
    setPreferences(prev => ({
      ...prev,
      [key]: checked
    }));
  };

  return (
    <fieldset className="space-y-4">
      <legend className="text-lg font-medium">Notification Preferences</legend>
      
      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <Checkbox 
            id="email-notifications"
            checked={preferences.email}
            onCheckedChange={handlePreferenceChange('email')}
          />
          <Label htmlFor="email-notifications">
            Email notifications
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox 
            id="sms-notifications"
            checked={preferences.sms}
            onCheckedChange={handlePreferenceChange('sms')}
          />
          <Label htmlFor="sms-notifications">
            SMS notifications
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox 
            id="push-notifications"
            checked={preferences.push}
            onCheckedChange={handlePreferenceChange('push')}
          />
          <Label htmlFor="push-notifications">
            Push notifications
          </Label>
        </div>
      </div>
    </fieldset>
  );
}
```

### Indeterminate State

```tsx
function SelectAllCheckbox() {
  const [items, setItems] = useState([
    { id: 1, name: 'Item 1', selected: false },
    { id: 2, name: 'Item 2', selected: true },
    { id: 3, name: 'Item 3', selected: false }
  ]);

  const selectedItems = items.filter(item => item.selected);
  const allSelected = selectedItems.length === items.length;
  const someSelected = selectedItems.length > 0 && selectedItems.length < items.length;

  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    if (checked === 'indeterminate') return;
    
    setItems(items.map(item => ({
      ...item,
      selected: checked
    })));
  };

  const handleItemChange = (itemId: number) => (checked: boolean) => {
    setItems(items.map(item => 
      item.id === itemId ? { ...item, selected: checked } : item
    ));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2 border-b pb-2">
        <Checkbox
          id="select-all"
          checked={allSelected ? true : someSelected ? 'indeterminate' : false}
          onCheckedChange={handleSelectAll}
        />
        <Label htmlFor="select-all" className="font-medium">
          Select All ({selectedItems.length} of {items.length} selected)
        </Label>
      </div>

      <div className="space-y-2 ml-6">
        {items.map(item => (
          <div key={item.id} className="flex items-center space-x-2">
            <Checkbox
              id={`item-${item.id}`}
              checked={item.selected}
              onCheckedChange={handleItemChange(item.id)}
            />
            <Label htmlFor={`item-${item.id}`}>
              {item.name}
            </Label>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Form Integration

```tsx
import { useForm, Controller } from 'react-hook-form';

interface FormData {
  agreeToTerms: boolean;
  subscribeToNewsletter: boolean;
  acceptMarketing: boolean;
}

function ConsentForm() {
  const { control, handleSubmit, formState: { errors }, watch } = useForm<FormData>({
    defaultValues: {
      agreeToTerms: false,
      subscribeToNewsletter: false,
      acceptMarketing: false
    }
  });

  const agreeToTerms = watch('agreeToTerms');

  const onSubmit = (data: FormData) => {
    console.log('Form data:', data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Consent and Preferences</h2>
        
        <div className="space-y-3">
          <div>
            <div className="flex items-center space-x-2">
              <Controller
                name="agreeToTerms"
                control={control}
                rules={{ required: 'You must agree to the terms and conditions' }}
                render={({ field }) => (
                  <Checkbox
                    id="agree-terms"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <Label htmlFor="agree-terms">
                I agree to the{' '}
                <a href="/terms" className="text-blue-600 underline">
                  terms and conditions
                </a>{' '}
                <span className="text-red-500">*</span>
              </Label>
            </div>
            {errors.agreeToTerms && (
              <p className="text-sm text-red-600 mt-1">
                {errors.agreeToTerms.message}
              </p>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Controller
              name="subscribeToNewsletter"
              control={control}
              render={({ field }) => (
                <Checkbox
                  id="newsletter"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <Label htmlFor="newsletter">
              Subscribe to our newsletter for updates
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Controller
              name="acceptMarketing"
              control={control}
              render={({ field }) => (
                <Checkbox
                  id="marketing"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <Label htmlFor="marketing">
              I consent to receiving marketing communications
            </Label>
          </div>
        </div>
      </div>

      <button 
        type="submit" 
        disabled={!agreeToTerms}
        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
      >
        Continue
      </button>
    </form>
  );
}
```

### Disabled State

```tsx
function DisabledCheckboxes() {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">Feature Availability</h3>
      
      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <Checkbox id="basic-features" checked={true} disabled />
          <Label htmlFor="basic-features" className="text-gray-600">
            Basic features (included in your plan)
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox id="premium-features" checked={false} disabled />
          <Label htmlFor="premium-features" className="text-gray-400">
            Premium features (upgrade required)
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox id="beta-features" checked={'indeterminate'} disabled />
          <Label htmlFor="beta-features" className="text-gray-400">
            Beta features (coming soon)
          </Label>
        </div>
      </div>
    </div>
  );
}
```

### Custom Styling

```tsx
function CustomStyledCheckboxes() {
  const [settings, setSettings] = useState({
    darkMode: false,
    animations: true,
    notifications: false
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2">
        <Checkbox
          id="dark-mode"
          checked={settings.darkMode}
          onCheckedChange={(checked) => 
            setSettings(prev => ({ ...prev, darkMode: checked }))
          }
          className="border-purple-500 data-[state=checked]:bg-purple-600"
        />
        <Label htmlFor="dark-mode" className="text-purple-700">
          Enable Dark Mode
        </Label>
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="animations"
          checked={settings.animations}
          onCheckedChange={(checked) => 
            setSettings(prev => ({ ...prev, animations: checked }))
          }
          className="rounded-full border-green-500 data-[state=checked]:bg-green-600"
        />
        <Label htmlFor="animations" className="text-green-700">
          Enable Animations
        </Label>
      </div>
    </div>
  );
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**:
  - Tab to focus the checkbox
  - Space to toggle checked state
  - Focus indicators clearly visible
  - Logical tab order maintained

- **ARIA Attributes**:
  - `role="checkbox"` (inherited from Radix primitive)
  - `aria-checked` indicates current state (true/false/mixed)
  - `aria-disabled` for disabled state
  - `aria-required` for required checkboxes
  - `aria-invalid` for validation errors
  - `aria-describedby` for error messages or help text

- **Screen Reader Support**:
  - Checkbox purpose announced via associated label
  - State changes (checked/unchecked) announced
  - Indeterminate state announced as "mixed"
  - Group relationships via fieldset/legend

### Best Practices

```tsx
// ✅ Good: Proper labeling with htmlFor
<Checkbox id="notifications" />
<Label htmlFor="notifications">Enable notifications</Label>

// ✅ Good: Fieldset for grouped checkboxes
<fieldset>
  <legend>Notification Preferences</legend>
  <Checkbox id="email" />
  <Label htmlFor="email">Email</Label>
  <Checkbox id="sms" />
  <Label htmlFor="sms">SMS</Label>
</fieldset>

// ✅ Good: Error handling
<Checkbox 
  id="terms"
  aria-required="true"
  aria-invalid={hasError}
  aria-describedby={hasError ? 'terms-error' : undefined}
/>
{hasError && (
  <p id="terms-error" role="alert" className="text-red-600">
    You must accept the terms
  </p>
)}

// ❌ Avoid: Missing label association
<Checkbox /> 
<span>Unlabeled checkbox</span>  // Not associated

// ❌ Avoid: Unclear purpose
<Checkbox id="cb1" />
<Label htmlFor="cb1">Enable</Label>  // Enable what?
```

## Styling

### CSS Classes

The checkbox includes comprehensive state-based styling:

#### Base Styles

- **Layout**: `size-4 shrink-0 rounded-[4px] border shadow-xs`
- **Transitions**: `transition-shadow outline-none`
- **Focus**: `focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]`

#### State Styles

- **Default**: `border bg-input-background dark:bg-input/30`
- **Checked**: `data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary`
- **Disabled**: `disabled:cursor-not-allowed disabled:opacity-50`
- **Invalid**: `aria-invalid:ring-destructive/20 aria-invalid:border-destructive`

#### Indicator

- **Layout**: `flex items-center justify-center text-current`
- **Icon**: CheckIcon from Lucide React at `size-3.5`
- **Transition**: `transition-none` for instant appearance

### Theme Support

The component supports both light and dark themes:

- Light theme: Standard colors with proper contrast
- Dark theme: Adjusted background and border colors
- Invalid states: Red border and ring for errors
- Focus states: Blue ring with proper opacity

### Customization

```tsx
// Custom colors
<Checkbox className="border-purple-500 data-[state=checked]:bg-purple-600" />

// Custom size
<Checkbox className="size-6" />  // Larger checkbox

// Custom border radius
<Checkbox className="rounded-full" />  // Circular checkbox

// Custom focus ring
<Checkbox className="focus-visible:ring-green-500" />
```

## Implementation Notes

### Design Patterns

- **Radix Integration**: Built on Radix UI Checkbox primitive for accessibility
- **Controlled Component**: Supports both controlled and uncontrolled usage
- **Theme Awareness**: Responds to light/dark theme changes
- **State Management**: Handles checked, unchecked, and indeterminate states

### Dependencies

- `@radix-ui/react-checkbox`: Accessibility-enhanced checkbox primitive
- `lucide-react`: CheckIcon for the checked indicator
- `./utils`: Utility function for className merging (cn)

### Client-Side Directive

Uses "use client" directive for Next.js compatibility, ensuring proper client-side rendering of interactive elements.

### State Management

```typescript
// Controlled usage
const [checked, setChecked] = useState(false);
<Checkbox checked={checked} onCheckedChange={setChecked} />

// Uncontrolled usage (internal state)
<Checkbox defaultChecked={false} />

// Indeterminate state
<Checkbox checked="indeterminate" />
```

## Testing

### Unit Tests

Located in `src/components/ui/__tests__/checkbox.test.tsx`:

- Checked/unchecked state changes
- Indeterminate state handling
- Keyboard interaction (Space key)
- Disabled state behavior
- ARIA attributes verification
- Form integration testing

### E2E Tests

Covered in form and preference tests:

- Checkbox selection workflows
- Form submission with checkbox data
- Keyboard navigation through checkbox groups
- Screen reader compatibility
- Multi-step form flows with checkboxes

### Testing Patterns

```tsx
// Test state changes
test('should toggle when clicked', async () => {
  const mockOnChange = jest.fn();
  render(
    <Checkbox 
      checked={false} 
      onCheckedChange={mockOnChange}
      data-testid="checkbox"
    />
  );

  await user.click(screen.getByTestId('checkbox'));
  expect(mockOnChange).toHaveBeenCalledWith(true);
});

// Test keyboard interaction
test('should toggle with Space key', async () => {
  render(<Checkbox data-testid="checkbox" />);
  
  const checkbox = screen.getByTestId('checkbox');
  checkbox.focus();
  await user.keyboard(' ');
  
  expect(checkbox).toHaveAttribute('aria-checked', 'true');
});
```

## Related Components

- **Label**: Essential for checkbox labeling and accessibility
- **MultiSelectDropdown**: Uses checkboxes for option selection
- **FocusTrappedCheckboxGroup**: Advanced checkbox group with focus management
- **Button**: Alternative for toggle actions
- **Switch**: Alternative for on/off states

## Common Patterns

### Checkbox List with Search

```tsx
function FilterableCheckboxList() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  
  const allItems = ['Apple', 'Banana', 'Cherry', 'Date', 'Elderberry'];
  const filteredItems = allItems.filter(item =>
    item.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleItemChange = (item: string) => (checked: boolean) => {
    setSelectedItems(prev => 
      checked 
        ? [...prev, item]
        : prev.filter(i => i !== item)
    );
  };

  return (
    <div className="space-y-4">
      <input
        type="text"
        placeholder="Search items..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="w-full px-3 py-2 border rounded"
      />
      
      <div className="space-y-2 max-h-40 overflow-y-auto">
        {filteredItems.map(item => (
          <div key={item} className="flex items-center space-x-2">
            <Checkbox
              id={`item-${item}`}
              checked={selectedItems.includes(item)}
              onCheckedChange={handleItemChange(item)}
            />
            <Label htmlFor={`item-${item}`}>{item}</Label>
          </div>
        ))}
      </div>
      
      <p className="text-sm text-gray-600">
        {selectedItems.length} of {filteredItems.length} selected
      </p>
    </div>
  );
}
```

### Conditional Checkbox Groups

```tsx
function ConditionalCheckboxes() {
  const [hasCondition, setHasCondition] = useState(false);
  const [subOptions, setSubOptions] = useState<string[]>([]);

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2">
        <Checkbox
          id="enable-advanced"
          checked={hasCondition}
          onCheckedChange={setHasCondition}
        />
        <Label htmlFor="enable-advanced">
          Enable advanced options
        </Label>
      </div>

      {hasCondition && (
        <div className="ml-6 space-y-2 border-l-2 border-gray-200 pl-4">
          {['Option A', 'Option B', 'Option C'].map(option => (
            <div key={option} className="flex items-center space-x-2">
              <Checkbox
                id={`advanced-${option}`}
                checked={subOptions.includes(option)}
                onCheckedChange={(checked) => {
                  setSubOptions(prev =>
                    checked
                      ? [...prev, option]
                      : prev.filter(o => o !== option)
                  );
                }}
              />
              <Label htmlFor={`advanced-${option}`}>
                {option}
              </Label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

## Changelog

- **v1.0.0**: Initial implementation with Radix UI Checkbox primitive
- **v1.1.0**: Added comprehensive state styling (checked, disabled, invalid)
- **v1.2.0**: Enhanced theme support with light/dark mode compatibility
- **v1.3.0**: Improved accessibility with better ARIA attribute support
- **v1.4.0**: Added indeterminate state handling
- **v1.5.0**: Performance optimizations and refined visual states
