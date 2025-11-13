---
status: current
last_updated: 2025-11-13
---

# SubdomainInput

## Overview

`SubdomainInput` is a specialized form input component for validating and formatting organization subdomains. It automatically formats user input to lowercase with hyphens only, displays a live preview of the full domain (e.g., `myorg.a4c.app`), and enforces strict subdomain validation rules.

This component is essential for organization onboarding, ensuring that organization subdomains meet DNS standards, are user-friendly, and are not reserved for system use. It provides immediate feedback to users about the resulting domain URL before submission.

## Props and Usage

Props are documented inline in the component source code using TypeScript and JSDoc:

```typescript
export interface SubdomainInputProps {
  // Unique identifier for the input element
  id: string;

  // Label text displayed above the input
  label: string;

  // Current subdomain value (auto-formatted to lowercase with hyphens)
  value: string;

  // Callback invoked with formatted subdomain when value changes
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

## Subdomain Validation Rules

Subdomains must meet the following criteria:

### Required Rules

1. **Length**: 3-63 characters
2. **Start Character**: Must start with a lowercase letter (a-z)
3. **Allowed Characters**: Lowercase letters (a-z), numbers (0-9), hyphens (-)
4. **No Consecutive Hyphens**: Cannot contain `--`
5. **No Leading/Trailing Hyphens**: Cannot start or end with hyphen
6. **Reserved Subdomains**: Cannot use system-reserved names

### Reserved Subdomains

The following subdomains are reserved and cannot be used:

```typescript
const RESERVED_SUBDOMAINS = [
  'admin', 'api', 'www', 'app', 'mail', 'ftp',
  'smtp', 'pop', 'imap', 'webmail', 'secure',
  'vpn', 'remote', 'cloud', 'support', 'help'
];
```

### Examples

**Valid Subdomains**:
- `myorg` → `myorg.a4c.app` ✅
- `healthcare-clinic` → `healthcare-clinic.a4c.app` ✅
- `org123` → `org123.a4c.app` ✅
- `abc` → `abc.a4c.app` ✅ (minimum 3 characters)

**Invalid Subdomains**:
- `ab` → Too short (< 3 characters) ❌
- `MyOrg` → Contains uppercase (auto-formats to `myorg`) ⚠️
- `-myorg` → Starts with hyphen ❌
- `myorg-` → Ends with hyphen ❌
- `my--org` → Consecutive hyphens ❌
- `1org` → Starts with number ❌
- `admin` → Reserved subdomain ❌
- `my_org` → Underscore not allowed (auto-formats to `myorg`) ⚠️

## Usage Examples

### Basic Usage

Simple subdomain input for organization creation:

```tsx
import { useState } from 'react';
import { SubdomainInput } from '@/components/organization/SubdomainInput';

const OrganizationForm = () => {
  const [subdomain, setSubdomain] = useState('');

  return (
    <SubdomainInput
      id="org-subdomain"
      label="Organization Subdomain"
      value={subdomain}
      onChange={setSubdomain}
      required
    />
  );
};
```

### With Error Handling

Displaying validation errors:

```tsx
import { useState } from 'react';
import { SubdomainInput } from '@/components/organization/SubdomainInput';
import { validateSubdomain } from '@/utils/organization-validation';

const OrganizationCreatePage = () => {
  const [subdomain, setSubdomain] = useState('');
  const [subdomainError, setSubdomainError] = useState<string | null>(null);

  const handleSubdomainChange = (value: string) => {
    setSubdomain(value);

    // Validate on change
    const error = validateSubdomain(value);
    setSubdomainError(error);
  };

  return (
    <SubdomainInput
      id="org-subdomain"
      label="Organization Subdomain"
      value={subdomain}
      onChange={handleSubdomainChange}
      error={subdomainError}
      required
    />
  );
};
```

### Advanced Usage with Reserved Check

Checking for reserved subdomains:

```tsx
import { useState, useEffect } from 'react';
import { SubdomainInput } from '@/components/organization/SubdomainInput';
import {
  validateSubdomain,
  isReservedSubdomain
} from '@/utils/organization-validation';

const ProviderOnboardingForm = () => {
  const [subdomain, setSubdomain] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!subdomain) {
      setError(null);
      return;
    }

    // Validate format
    const formatError = validateSubdomain(subdomain);
    if (formatError) {
      setError(formatError);
      return;
    }

    // Check if reserved
    if (isReservedSubdomain(subdomain)) {
      setError(`"${subdomain}" is a reserved subdomain. Please choose another.`);
      return;
    }

    // Check availability via API (example)
    checkSubdomainAvailability(subdomain)
      .then((available) => {
        if (!available) {
          setError(`"${subdomain}" is already taken. Please choose another.`);
        } else {
          setError(null);
        }
      });
  }, [subdomain]);

  return (
    <SubdomainInput
      id="provider-subdomain"
      label="Provider Subdomain"
      value={subdomain}
      onChange={setSubdomain}
      error={error}
      required
      tabIndex={2}
    />
  );
};
```

### Disabled State with Preview

Displaying read-only subdomain with preview:

```tsx
<SubdomainInput
  id="readonly-subdomain"
  label="Organization Subdomain"
  value="healthcare-clinic"
  onChange={() => {}}  // No-op for read-only
  disabled
/>
```

## Accessibility

### WCAG 2.1 Level AA Compliance

The component implements comprehensive accessibility features for subdomain input and domain preview.

#### Keyboard Navigation

- **Tab**: Moves focus to/from the input field
- **Shift+Tab**: Moves focus backward
- **Backspace**: Deletes characters
- **Delete**: Removes characters forward
- **Arrow Keys**: Moves cursor within input
- **Home/End**: Moves to start/end of input

#### ARIA Attributes

- **`aria-label`**: Set to the `label` prop value for screen reader identification
- **`aria-required`**: Set to `true` when `required` prop is true
- **`aria-invalid`**: Set to `true` when `error` prop has a value
- **`aria-describedby`**: Points to either:
  - Error message ID (`${id}-error`) when error present
  - Preview message ID (`${id}-preview`) when domain preview shown
  - `undefined` when neither error nor preview
- **`role="alert"`**: Applied to error message for immediate announcement

#### Focus Management

- **Visible Focus Indicator**: Browser default focus ring maintained
- **Focus Order**: Follows natural DOM order, customizable via `tabIndex`
- **No Focus Traps**: Input can be freely navigated to/from
- **Preserved Cursor Position**: Auto-formatting does not disrupt cursor

#### Screen Reader Support

- **Label Association**: `<Label htmlFor={id}>` properly associates label with input
- **Required Field Announcement**: Screen readers announce "required" via `aria-required`
- **Error Announcement**: Errors announced immediately via `role="alert"`
- **Domain Preview**: Preview text announced via `aria-describedby` when no error
- **Formatting Guidance**: Helper text below input provides formatting rules
- **Suffix Display**: ".a4c.app" suffix shown visually next to input

#### Visual Indicators

- **Required Field**: Red asterisk (*) displayed after label
- **Error State**: Red border applied when error present
- **Error Message**: Red text below input with clear error description
- **Domain Preview**: Gray text showing full domain when no error
- **Formatting Rules**: Small gray text explaining subdomain requirements
- **Monospace Font**: Input uses monospace font for technical clarity
- **Disabled State**: Visual dimming when disabled

## Styling

### CSS Classes

#### Container
- `space-y-2` - Vertical spacing between label, input, messages

#### Label
- Standard `<Label>` component styling
- `.text-red-500` (required asterisk) - High contrast red for visibility
- `.ml-1` (required asterisk) - Small left margin for spacing

#### Input Container
- `flex items-center gap-2` - Horizontal flex layout with input and suffix

#### Input
- Standard `<Input>` component styling
- `.border-red-500` - Red border when error present
- `.font-mono` - Monospace font for technical subdomain

#### Suffix
- `.text-gray-500` - Gray color for ".a4c.app" suffix

#### Domain Preview
- `#${id}-preview` - Preview message ID for ARIA
- `.text-sm` - Small text size
- `.text-gray-600` - Gray color for secondary text
- `.font-mono` - Monospace font for domain URL

#### Helper Text
- `.text-xs` - Extra small text size for rules
- `.text-gray-500` - Gray color for subtle guidance

#### Error Message
- `.text-sm` - Small text size for error messages
- `.text-red-500` - Red color for error visibility (4.5:1 contrast ratio)

### Customization

The component uses composition of base UI components (`Input`, `Label`) for styling consistency. To customize:

1. **Input Styling**: Modify the `Input` component styles globally
2. **Label Styling**: Modify the `Label` component styles globally
3. **Preview/Helper Text**: Adjust paragraph classes in source code
4. **Suffix Styling**: Modify the suffix span classes in source code

## Implementation Notes

### Design Patterns

- **Controlled Component**: Value and onChange must be provided (no internal state)
- **Auto-Formatting Pattern**: Formats in real-time as user types
- **Preview Feedback**: Shows full domain immediately for user confidence
- **Error Feedback Pattern**: Error displayed below input with proper ARIA association
- **Composition Pattern**: Uses base `Input` and `Label` components for consistency

### Subdomain Formatting

The component uses the `formatSubdomain` utility from `@/utils/organization-validation`:

**Formatting Logic**:
1. Converts to lowercase
2. Removes all characters except letters, numbers, hyphens
3. Removes leading/trailing hyphens
4. Replaces consecutive hyphens with single hyphen
5. Limits to 63 characters (DNS limit)

**Example Transformations**:
- Input: `MyOrg` → Output: `myorg`
- Input: `My Org` → Output: `myorg`
- Input: `my_org` → Output: `myorg`
- Input: `my--org` → Output: `my-org`
- Input: `-myorg-` → Output: `myorg`

### Domain Preview

The full domain preview is constructed from the subdomain value:

```typescript
const fullDomain = value ? `${value}.a4c.app` : '';
```

**Display Rules**:
- Shows when subdomain has value AND no error present
- Hides when error message displayed (error takes priority)
- Uses monospace font for technical URL display
- Announced to screen readers via `aria-describedby`

### State Management

- **Parent Controlled**: Component does not manage its own state
- **Value Prop**: Always displays the formatted value from parent
- **onChange Callback**: Parent receives formatted subdomain
- **Validation**: Parent responsible for validation logic

### Dependencies

- **UI Components**: `Input`, `Label` from `@/components/ui/`
- **Utilities**: `formatSubdomain` from `@/utils/organization-validation`
- **React**: `useCallback` for memoized handler

### Performance Considerations

- **Memoized Callback**: `useCallback` prevents unnecessary re-renders
- **Efficient Formatting**: `formatSubdomain` is optimized for real-time performance
- **Minimal Re-renders**: Only re-renders when props change
- **Max Length**: Hard limit of 63 characters (DNS subdomain limit)

### Validation Integration

The component itself does NOT perform validation - it only formats. Validation should be handled by parent component:

**Recommended Validation Function**:

```typescript
export function validateSubdomain(value: string): string | null {
  if (!value) return 'Subdomain is required';

  if (value.length < 3) return 'Subdomain must be at least 3 characters';

  if (value.length > 63) return 'Subdomain cannot exceed 63 characters';

  if (!/^[a-z]/.test(value)) {
    return 'Subdomain must start with a lowercase letter';
  }

  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    return 'Subdomain can only contain lowercase letters, numbers, and hyphens';
  }

  if (value.includes('--')) {
    return 'Subdomain cannot contain consecutive hyphens';
  }

  if (value.endsWith('-')) {
    return 'Subdomain cannot end with a hyphen';
  }

  return null; // Valid
}

export function isReservedSubdomain(value: string): boolean {
  const RESERVED = [
    'admin', 'api', 'www', 'app', 'mail', 'ftp',
    'smtp', 'pop', 'imap', 'webmail', 'secure',
    'vpn', 'remote', 'cloud', 'support', 'help'
  ];

  return RESERVED.includes(value.toLowerCase());
}
```

## Testing

### Unit Tests

**Location**: `frontend/src/components/organization/__tests__/SubdomainInput.test.tsx` (recommended)

**Key Test Cases**:
- ✅ Renders label and input with correct IDs
- ✅ Displays required asterisk when required=true
- ✅ Formats input to lowercase in real-time
- ✅ Shows domain preview when value present
- ✅ Hides preview when error present
- ✅ Displays error message when error prop provided
- ✅ Shows formatting rules helper text
- ✅ Sets ARIA attributes correctly
- ✅ Disabled state prevents input
- ✅ Max length prevents input beyond 63 characters

**Test Example**:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { SubdomainInput } from './SubdomainInput';

test('formats subdomain to lowercase', () => {
  const handleChange = vi.fn();

  render(
    <SubdomainInput
      id="test-subdomain"
      label="Subdomain"
      value=""
      onChange={handleChange}
    />
  );

  const input = screen.getByLabelText('Subdomain');

  // Type uppercase
  fireEvent.change(input, { target: { value: 'MyOrg' } });

  // Should call onChange with lowercase
  expect(handleChange).toHaveBeenCalledWith('myorg');
});

test('shows domain preview when value present and no error', () => {
  render(
    <SubdomainInput
      id="test-subdomain"
      label="Subdomain"
      value="myorg"
      onChange={() => {}}
    />
  );

  expect(screen.getByText(/Your organization URL:/)).toBeInTheDocument();
  expect(screen.getByText('myorg.a4c.app')).toBeInTheDocument();
});

test('hides preview when error present', () => {
  render(
    <SubdomainInput
      id="test-subdomain"
      label="Subdomain"
      value="ab"
      onChange={() => {}}
      error="Too short"
    />
  );

  expect(screen.queryByText(/Your organization URL:/)).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Too short');
});
```

### E2E Tests

**Location**: `frontend/e2e/organization-creation.spec.ts` (recommended)

**Key User Flows**:
- User types subdomain and sees auto-formatting
- User sees domain preview update in real-time
- User enters invalid subdomain and sees error
- User enters reserved subdomain and sees error
- User submits valid subdomain successfully

**Test Example**:

```typescript
test('subdomain input formats and validates correctly', async ({ page }) => {
  await page.goto('http://localhost:5173/organizations/create');

  const subdomainInput = page.locator('#org-subdomain');

  // Type mixed case
  await subdomainInput.fill('MyOrg');

  // Should see lowercase
  await expect(subdomainInput).toHaveValue('myorg');

  // Should see domain preview
  await expect(page.locator('#org-subdomain-preview')).toContainText('myorg.a4c.app');

  // Clear and enter too-short value
  await subdomainInput.clear();
  await subdomainInput.fill('ab');
  await subdomainInput.blur();

  // Should see error
  await expect(page.locator('#org-subdomain-error')).toBeVisible();
});
```

## Related Components

- **Input** (`/components/ui/input.tsx`) - Base input component used for rendering
- **Label** (`/components/ui/label.tsx`) - Label component for accessibility
- **PhoneInput** - Similar specialized input for phone number formatting
- **OrganizationForm** - Parent form component that uses SubdomainInput
- **ProviderRegistrationForm** - Uses SubdomainInput for provider onboarding

## Utilities

- **formatSubdomain** (`/utils/organization-validation.ts`) - Subdomain formatting utility
- **validateSubdomain** (`/utils/organization-validation.ts`) - Subdomain validation utility
- **isReservedSubdomain** (`/utils/organization-validation.ts`) - Reserved subdomain check

## Common Issues and Solutions

### Issue: Subdomain Not Formatting

**Cause**: `formatSubdomain` utility not working or not imported

**Solution**: Verify utility import and implementation:

```typescript
import { formatSubdomain } from '@/utils/organization-validation';
```

### Issue: Domain Preview Not Showing

**Cause**: Error message present, or value is empty

**Solution**: Preview only shows when `value` is truthy AND `error` is falsy. Check both conditions.

### Issue: Reserved Subdomain Not Blocked

**Cause**: Parent validation not checking reserved list

**Solution**: Implement `isReservedSubdomain` check in parent validation:

```typescript
if (isReservedSubdomain(subdomain)) {
  setError('This subdomain is reserved');
}
```

### Issue: Validation Too Strict/Lenient

**Cause**: Validation rules not matching business requirements

**Solution**: Adjust `validateSubdomain` function to match specific needs while maintaining DNS compliance.

## Changelog

- **2025-11-13**: Initial documentation created
- **Component Creation**: Part of organization management module implementation
