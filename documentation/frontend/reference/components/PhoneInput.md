---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: US phone number input with automatic (XXX) XXX-XXXX formatting, real-time validation display, and form library integration via controlled component pattern.

**When to read**:
- Implementing phone number fields in forms
- Understanding auto-formatting with cursor preservation
- Building accessible phone inputs with ARIA
- Integrating with react-hook-form

**Prerequisites**: None

**Key topics**: `phone-input`, `formatting`, `validation`, `form-integration`, `accessibility`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# PhoneInput

## Overview

`PhoneInput` is a specialized form input component for US phone numbers with automatic formatting. It formats user input into the standard US phone number format `(XXX) XXX-XXXX` in real-time, providing a polished user experience with built-in validation and error handling.

The component leverages the application's `formatPhone` utility to ensure consistent phone number formatting across the platform. It integrates seamlessly with form validation systems and supports full keyboard navigation and screen reader accessibility.

## Props and Usage

Props are documented inline in the component source code using TypeScript and JSDoc:

```typescript
export interface PhoneInputProps {
  // Unique identifier for the input element
  id: string;

  // Label text displayed above the input
  label: string;

  // Current phone number value (can be formatted or raw digits)
  value: string;

  // Callback invoked with formatted phone number when value changes
  onChange: (value: string) => void;

  // Optional error message to display below input
  error?: string | null;

  // Whether the field is required (adds red asterisk and aria-required)
  required?: boolean;

  // Whether the input is disabled
  disabled?: boolean;

  // Tab order for keyboard navigation
  tabIndex?: number;
}
```

## Usage Examples

### Basic Usage

Simple phone input for organization contact form:

```tsx
import { useState } from 'react';
import { PhoneInput } from '@/components/organization/PhoneInput';

const ContactForm = () => {
  const [phone, setPhone] = useState('');

  return (
    <PhoneInput
      id="contact-phone"
      label="Contact Phone"
      value={phone}
      onChange={setPhone}
      required
    />
  );
};
```

### With Error Handling

Displaying validation errors:

```tsx
import { useState } from 'react';
import { PhoneInput } from '@/components/organization/PhoneInput';
import { validatePhone } from '@/utils/organization-validation';

const OrganizationForm = () => {
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const handlePhoneChange = (value: string) => {
    setPhone(value);

    // Validate on change
    const error = validatePhone(value);
    setPhoneError(error);
  };

  return (
    <PhoneInput
      id="org-phone"
      label="Organization Phone"
      value={phone}
      onChange={handlePhoneChange}
      error={phoneError}
      required
    />
  );
};
```

### Advanced Usage with Form Integration

Using with form libraries and custom tab order:

```tsx
import { useForm } from 'react-hook-form';
import { PhoneInput } from '@/components/organization/PhoneInput';

interface FormData {
  phone: string;
  // ... other fields
}

const ProviderRegistrationForm = () => {
  const {
    watch,
    setValue,
    formState: { errors }
  } = useForm<FormData>();

  const phone = watch('phone');

  return (
    <form>
      <PhoneInput
        id="provider-phone"
        label="Provider Phone Number"
        value={phone}
        onChange={(value) => setValue('phone', value)}
        error={errors.phone?.message}
        required
        tabIndex={5}
      />
    </form>
  );
};
```

### Disabled State

Displaying read-only phone number:

```tsx
<PhoneInput
  id="readonly-phone"
  label="Registered Phone"
  value="(555) 123-4567"
  onChange={() => {}}  // No-op for read-only
  disabled
/>
```

## Accessibility

### WCAG 2.1 Level AA Compliance

The component implements comprehensive accessibility features to ensure usability for all users.

#### Keyboard Navigation

- **Tab**: Moves focus to/from the input field
- **Shift+Tab**: Moves focus backward
- **Backspace**: Deletes characters (respects formatting)
- **Delete**: Removes characters forward
- **Arrow Keys**: Moves cursor within input
- **Home/End**: Moves to start/end of input

#### ARIA Attributes

- **`aria-label`**: Set to the `label` prop value for screen reader identification
- **`aria-required`**: Set to `true` when `required` prop is true
- **`aria-invalid`**: Set to `true` when `error` prop has a value
- **`aria-describedby`**: Points to error message ID when error is present
- **`role="alert"`**: Applied to error message for immediate announcement

#### Focus Management

- **Visible Focus Indicator**: Browser default focus ring maintained
- **Focus Order**: Follows natural DOM order, customizable via `tabIndex`
- **No Focus Traps**: Input can be freely navigated to/from
- **Preserved Cursor Position**: Formatting preserves cursor location during typing

#### Screen Reader Support

- **Label Association**: `<Label htmlFor={id}>` properly associates label with input
- **Required Field Announcement**: Screen readers announce "required" via `aria-required`
- **Error Announcement**: Errors announced immediately via `role="alert"`
- **Input Type**: `type="tel"` triggers numeric keyboard on mobile devices
- **Placeholder Guidance**: Placeholder `(555) 123-4567` provides format example

#### Visual Indicators

- **Required Field**: Red asterisk (*) displayed after label
- **Error State**: Red border applied when error present
- **Error Message**: Red text below input with clear error description
- **Disabled State**: Visual dimming and cursor change when disabled

## Styling

### CSS Classes

#### Container
- `space-y-2` - Vertical spacing between label, input, and error message

#### Label
- Standard `<Label>` component styling
- `.text-red-500` (required asterisk) - High contrast red for visibility
- `.ml-1` (required asterisk) - Small left margin for spacing

#### Input
- Standard `<Input>` component styling
- `.border-red-500` - Red border when error present (overrides default)
- Inherits all Input component classes for consistency

#### Error Message
- `.text-sm` - Smaller text size for error messages
- `.text-red-500` - Red color for error visibility (4.5:1 contrast ratio)

### Customization

The component uses composition of base UI components (`Input`, `Label`) for styling consistency. To customize:

1. **Input Styling**: Modify the `Input` component styles globally
2. **Label Styling**: Modify the `Label` component styles globally
3. **Error Styling**: Adjust the error paragraph classes in source code
4. **Required Indicator**: Change asterisk color/style in source code

For component-specific styling, wrap in a container with custom classes:

```tsx
<div className="my-custom-phone-input">
  <PhoneInput {...props} />
</div>
```

## Implementation Notes

### Design Patterns

- **Controlled Component**: Value and onChange must be provided (no internal state)
- **Auto-Formatting Pattern**: Formats on change AND on blur for robust UX
- **Error Feedback Pattern**: Error displayed below input with proper ARIA association
- **Composition Pattern**: Uses base `Input` and `Label` components for consistency

### Phone Number Formatting

The component uses the `formatPhone` utility from `@/utils/organization-validation`:

**Formatting Logic**:
1. Strips all non-digit characters from input
2. Limits to 10 digits (US phone number)
3. Applies format pattern: `(XXX) XXX-XXXX`
4. Returns formatted string

**Formatting Timing**:
- **On Change**: Formats in real-time as user types
- **On Blur**: Ensures final format is correct when user leaves field

**Example Transformations**:
- Input: `5551234567` → Output: `(555) 123-4567`
- Input: `(555) 123-4567` → Output: `(555) 123-4567` (no change)
- Input: `555.123.4567` → Output: `(555) 123-4567`
- Input: `1-555-123-4567` → Output: `(555) 123-4567` (strips leading 1)

### State Management

- **Parent Controlled**: Component does not manage its own state
- **Value Prop**: Always displays the formatted value from parent
- **onChange Callback**: Parent receives formatted phone number
- **Validation**: Parent responsible for validation logic

### Dependencies

- **UI Components**: `Input`, `Label` from `@/components/ui/`
- **Utilities**: `formatPhone` from `@/utils/organization-validation`
- **React**: `useCallback` for memoized handlers

### Performance Considerations

- **Memoized Callbacks**: `useCallback` prevents unnecessary re-renders
- **Efficient Formatting**: `formatPhone` is optimized for real-time performance
- **Minimal Re-renders**: Only re-renders when props change
- **Max Length**: Hard limit of 14 characters prevents excessive input

### Validation

The component itself does NOT perform validation - it only formats. Validation should be handled by parent component or form library:

**Common Validation Rules**:
- **Required Check**: Ensure value is not empty
- **Format Check**: Verify value matches `(XXX) XXX-XXXX` pattern
- **Digit Count**: Ensure exactly 10 digits present
- **Area Code**: Optionally validate area code is valid US code

**Example Validation Function**:

```typescript
function validatePhone(value: string): string | null {
  if (!value) return 'Phone number is required';

  const digits = value.replace(/\D/g, '');

  if (digits.length !== 10) {
    return 'Phone number must be 10 digits';
  }

  // Optional: Check for invalid area codes
  const areaCode = parseInt(digits.substring(0, 3));
  if (areaCode < 200) {
    return 'Invalid area code';
  }

  return null; // Valid
}
```

## Testing

### Unit Tests

**Location**: `frontend/src/components/organization/__tests__/PhoneInput.test.tsx` (recommended)

**Key Test Cases**:
- ✅ Renders label and input with correct IDs
- ✅ Displays required asterisk when required=true
- ✅ Formats input in real-time during typing
- ✅ Formats on blur if value changes
- ✅ Displays error message when error prop provided
- ✅ Applies error styling when error present
- ✅ Sets ARIA attributes correctly
- ✅ Disabled state prevents input
- ✅ Max length prevents input beyond 14 characters

**Test Example**:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { PhoneInput } from './PhoneInput';

test('formats phone number as user types', () => {
  const handleChange = vi.fn();

  render(
    <PhoneInput
      id="test-phone"
      label="Phone"
      value=""
      onChange={handleChange}
    />
  );

  const input = screen.getByLabelText('Phone');

  // Type raw digits
  fireEvent.change(input, { target: { value: '5551234567' } });

  // Should call onChange with formatted value
  expect(handleChange).toHaveBeenCalledWith('(555) 123-4567');
});

test('displays error message with correct ARIA', () => {
  render(
    <PhoneInput
      id="test-phone"
      label="Phone"
      value=""
      onChange={() => {}}
      error="Invalid phone number"
    />
  );

  const input = screen.getByLabelText('Phone');
  const error = screen.getByRole('alert');

  expect(error).toHaveTextContent('Invalid phone number');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAttribute('aria-describedby', 'test-phone-error');
});
```

### E2E Tests

**Location**: `frontend/e2e/organization-form.spec.ts` (recommended)

**Key User Flows**:
- User types unformatted phone number and sees auto-formatting
- User copies formatted number and pastes into field
- User enters invalid phone (< 10 digits) and sees error
- User tabs to next field and blur formatting applies
- Screen reader announces errors correctly

**Test Example**:

```typescript
test('phone input formats and validates correctly', async ({ page }) => {
  await page.goto('http://localhost:5173/organizations/create');

  const phoneInput = page.locator('#org-phone');

  // Type raw digits
  await phoneInput.fill('5551234567');

  // Should see formatted value
  await expect(phoneInput).toHaveValue('(555) 123-4567');

  // Clear and enter partial number
  await phoneInput.clear();
  await phoneInput.fill('555123');
  await phoneInput.blur();

  // Should see error
  await expect(page.locator('#org-phone-error')).toBeVisible();
  await expect(page.locator('#org-phone-error')).toHaveText(/must be 10 digits/i);
});
```

## Related Components

- **Input** (`/components/ui/input.tsx`) - Base input component used for rendering
- **Label** (`/components/ui/label.tsx`) - Label component for accessibility
- **SubdomainInput** - Similar specialized input for subdomain validation
- **OrganizationForm** - Parent form component that uses PhoneInput
- **ProviderRegistrationForm** - Another user of PhoneInput for provider onboarding

## Utilities

- **formatPhone** (`/utils/organization-validation.ts`) - Phone formatting utility
- **validatePhone** (`/utils/organization-validation.ts`) - Phone validation utility (if exists)

## Common Issues and Solutions

### Issue: Cursor Jumps to End During Typing

**Solution**: The `formatPhone` utility should preserve cursor position. If issue persists, consider using a cursor position preservation pattern:

```typescript
const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const cursorPosition = e.target.selectionStart;
  const formatted = formatPhone(e.target.value);

  onChange(formatted);

  // Restore cursor position (requires ref access)
  requestAnimationFrame(() => {
    if (inputRef.current) {
      inputRef.current.setSelectionRange(cursorPosition, cursorPosition);
    }
  });
};
```

### Issue: Pasted Numbers Not Formatting

**Ensure**: The `formatPhone` utility handles various input formats:
- Strips non-digits
- Handles formats like `555-123-4567`, `555.123.4567`, `+1 (555) 123-4567`

### Issue: Cannot Delete Formatted Characters

**Expected Behavior**: Users can delete any character, but formatting reapplies. This is intentional to maintain consistent format.

## Changelog

- **2025-11-13**: Initial documentation created
- **Component Creation**: Part of organization management module implementation
