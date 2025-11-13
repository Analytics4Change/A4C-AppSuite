---
status: current
last_updated: 2025-11-13
---

# ReasonInput

## Overview

`ReasonInput` is a feature-rich textarea component designed for capturing audit trail explanations with real-time character count feedback, validation, and optional suggestion templates. It provides users with immediate visual feedback about input length requirements through a progress bar and color-coded character counter.

This component is essential for maintaining audit trails and change tracking across the application. It ensures users provide meaningful context for their actions while preventing overly brief or excessively long explanations. The suggestion system offers quick templates for common scenarios, improving user experience and maintaining consistency in audit entries.

## Props and Usage

Props are documented inline in the component source code using TypeScript:

```typescript
export interface ReasonInputProps {
  // Current reason text value
  value: string;

  // Callback invoked with new value when text changes
  onChange: (value: string) => void;

  // Placeholder text shown when input is empty
  placeholder?: string; // Default: "Explain why this change is being made..."

  // Whether the field is required
  required?: boolean; // Default: true

  // Minimum character length for valid input
  minLength?: number; // Default: 10

  // Maximum character length allowed
  maxLength?: number; // Default: 500

  // Label text displayed above textarea
  label?: string; // Default: "Reason for Change"

  // Help text shown below textarea when no error
  helpText?: string; // Default: "Provide context for audit trail (required)"

  // External error message (overrides internal validation)
  error?: string;

  // Whether the textarea is disabled
  disabled?: boolean; // Default: false

  // Additional CSS classes to apply to container
  className?: string;

  // Whether to show character count display
  showCharacterCount?: boolean; // Default: true

  // Array of suggestion templates for quick selection
  suggestions?: string[]; // Default: []

  // Whether to auto-focus the textarea on mount
  autoFocus?: boolean; // Default: false
}
```

## Usage Examples

### Basic Usage

Simple reason input for medication change:

```tsx
import { useState } from 'react';
import { ReasonInput } from '@/components/ui/ReasonInput';

const MedicationEditForm = () => {
  const [reason, setReason] = useState('');

  return (
    <ReasonInput
      value={reason}
      onChange={setReason}
    />
  );
};
```

### With Suggestions

Providing common reason templates:

```tsx
import { useState } from 'react';
import { ReasonInput } from '@/components/ui/ReasonInput';

const medicationSuggestions = [
  'Dosage adjustment based on patient response',
  'Medication discontinued per physician order',
  'Updated frequency to match new care plan',
  'Correcting data entry error from previous record'
];

const MedicationHistoryForm = () => {
  const [reason, setReason] = useState('');

  return (
    <ReasonInput
      value={reason}
      onChange={setReason}
      label="Reason for Medication Change"
      helpText="This reason will be recorded in the audit log"
      suggestions={medicationSuggestions}
    />
  );
};
```

### Custom Validation

Custom min/max lengths and external error handling:

```tsx
import { useState } from 'react';
import { ReasonInput } from '@/components/ui/ReasonInput';

const ClientDataChangeForm = () => {
  const [reason, setReason] = useState('');
  const [customError, setCustomError] = useState<string>('');

  const validateReason = (value: string) => {
    // Custom validation logic
    if (value.toLowerCase().includes('test')) {
      setCustomError('Reason cannot contain the word "test"');
    } else {
      setCustomError('');
    }
  };

  const handleChange = (value: string) => {
    setReason(value);
    validateReason(value);
  };

  return (
    <ReasonInput
      value={reason}
      onChange={handleChange}
      minLength={20}  // Require more detailed explanation
      maxLength={1000}  // Allow longer explanations
      error={customError}
      required
    />
  );
};
```

### Advanced Usage with Form Integration

Using with react-hook-form:

```tsx
import { useForm, Controller } from 'react-hook-form';
import { ReasonInput } from '@/components/ui/ReasonInput';

interface FormData {
  reason: string;
  // ... other fields
}

const AuditedChangeForm = () => {
  const {
    control,
    formState: { errors }
  } = useForm<FormData>();

  return (
    <form>
      <Controller
        name="reason"
        control={control}
        rules={{
          required: 'Reason is required for audit trail',
          minLength: {
            value: 10,
            message: 'Please provide more detail (at least 10 characters)'
          }
        }}
        render={({ field }) => (
          <ReasonInput
            value={field.value}
            onChange={field.onChange}
            error={errors.reason?.message}
            autoFocus
          />
        )}
      />
    </form>
  );
};
```

### Disabled State

Displaying read-only reason:

```tsx
<ReasonInput
  value="Medication discontinued per physician order (Dr. Smith, 2025-11-13)"
  onChange={() => {}}  // No-op for read-only
  disabled
  label="Change Reason (Read-Only)"
  helpText="This record has been finalized and cannot be edited"
/>
```

## Character Counting and Validation

### Character Count Display

The component shows real-time character count with color-coded feedback:

**Color Coding**:
- **Gray** (`text-gray-400`): No input (0 characters)
- **Amber** (`text-amber-500`): Below minimum (< 10 characters by default)
- **Green** (`text-green-500`): Valid length (≥ minimum, ≤ maximum)
- **Red** (`text-red-500`): Exceeds maximum (> 500 characters by default)

**Display Format**:
- Below minimum: `"15 / 10 min"` (shows progress toward minimum)
- Above minimum: `"150 / 10 min (500 max)"` (shows both minimum met and maximum limit)

### Progress Bar

When input is below minimum length, a visual progress bar appears at the bottom of the textarea:

**Progress Calculation**:
```typescript
const progressPercentage = (characterCount / minLength) * 100;
```

**Visual Design**:
- **Background**: Light gray (`bg-gray-200`)
- **Fill**: Amber (`bg-amber-400`)
- **Animation**: Smooth transition (`duration-300 ease-out`)
- **Position**: Absolute at bottom of textarea
- **Height**: 4px thin bar for subtle feedback

**Behavior**:
- Shows only when: `0 < characterCount < minLength`
- Hides when: No input OR minimum length reached
- Fills from left to right as user types toward minimum

### Internal Validation

The component performs automatic validation and updates error state:

**Validation Rules**:
1. **Too Short**: `characterCount < minLength`
   - Error: `"Reason must be at least {minLength} characters ({remaining} more needed)"`

2. **Too Long**: `characterCount > maxLength`
   - Error: `"Reason must be less than {maxLength} characters"`

3. **Valid**: `minLength ≤ characterCount ≤ maxLength`
   - No error

**Validation Timing**:
- Runs automatically via `useEffect` whenever value changes
- Updates internal error state in real-time
- External error prop overrides internal validation

## Suggestion System

### How Suggestions Work

Suggestions provide quick template selection for common reasons:

**Display Conditions**:
- Shows only when: `suggestions.length > 0` AND `characterCount === 0`
- Hides when: User starts typing OR no suggestions provided

**Visual Design**:
- Small suggestion label: `"Suggestions:"`
- Chip-style buttons with hover states
- Horizontal flex wrap layout
- Gray background with darker gray on hover

**Interaction**:
- Click suggestion button to auto-fill textarea
- Replaces current value entirely
- Dismisses suggestions once text entered

### Suggestion Templates

**Best Practices for Suggestions**:
- Keep suggestions 40-100 characters (complete sentences)
- Provide 3-5 common scenarios
- Make suggestions specific to context
- Ensure suggestions meet minimum length requirement
- Phrase as complete audit trail entries

**Example Suggestion Arrays**:

```typescript
// Medication changes
const medicationSuggestions = [
  'Dosage adjustment based on patient response and updated care plan',
  'Medication discontinued per physician order dated {today}',
  'Correcting data entry error from previous record entry'
];

// Client information changes
const clientInfoSuggestions = [
  'Updated contact information provided by patient during check-in',
  'Correcting administrative error in patient demographics',
  'Patient provided updated insurance information'
];

// Organizational changes
const organizationSuggestions = [
  'Organizational restructuring to improve care delivery efficiency',
  'Updated configuration to align with new regulatory requirements',
  'Correction of setup error identified during quality review'
];
```

## Accessibility

### WCAG 2.1 Level AA Compliance

The component implements comprehensive accessibility features for textarea input with dynamic validation feedback.

#### Keyboard Navigation

- **Tab**: Moves focus to/from the textarea
- **Shift+Tab**: Moves focus backward
- **Enter**: Creates new line within textarea
- **Ctrl+Enter**: Could submit form (handled by parent)
- **Home/End**: Moves cursor to line start/end
- **Page Up/Down**: Scrolls textarea content

#### ARIA Attributes

- **`aria-invalid`**: Set to `true` when error present (internal or external)
- **`aria-describedby`**: Points to:
  - `"reason-error"` when error displayed
  - `"reason-help"` when help text shown (no error)
- **`required` attribute**: Set when `required` prop is true
- **`minLength` attribute**: Set to `minLength` prop value
- **`maxLength` attribute**: Set to `maxLength` prop value (hard limit)

#### Focus Management

- **Visible Focus Indicator**: Blue ring (`ring-2 ring-blue-500 ring-opacity-20`)
- **Focus State**: Tracked via `isFocused` state for conditional styling
- **Auto Focus**: Optional `autoFocus` prop for forms requiring immediate input
- **Smooth Transitions**: 200ms duration for color transitions

#### Screen Reader Support

- **Label Association**: Implicit via wrapping label element
- **Required Field Announcement**: Screen readers announce "required" via HTML attribute
- **Error Announcement**: Error displayed below with icon for visual + auditory feedback
- **Help Text**: Helper text provides guidance via `aria-describedby`
- **Character Count**: Visually displayed but not announced (intentional - avoids noise)
- **Suggestion Buttons**: Standard button elements with text labels

#### Visual Indicators

- **Required Field**: Red asterisk (*) displayed after label
- **Error State**: Red border when error present
- **Error Icon**: Alert icon next to error message for visual emphasis
- **Focus State**: Blue ring around textarea when focused
- **Progress Bar**: Amber bar showing progress toward minimum length
- **Character Count**: Color-coded to indicate validation state
- **Disabled State**: Gray background and not-allowed cursor

## Styling

### CSS Classes

#### Container
- `space-y-2` - Vertical spacing between elements
- Custom `className` prop can add additional styles

#### Label Row
- `flex items-center justify-between` - Label on left, counter on right
- `block text-sm font-medium text-gray-700` - Label styling
- `.text-red-500` (required asterisk) - Red asterisk for required fields

#### Character Count
- `.text-xs` - Extra small text size
- Color classes applied dynamically via `getCharacterCountColor()`

#### Textarea

**Base Styles**:
- `w-full` - Full width
- `rounded-md` - Medium border radius
- `border px-3 py-2` - Border and padding
- `resize-vertical` - Allow vertical resizing only
- `min-h-[80px]` - Minimum height (80px, ~3 rows)
- `rows={3}` - Default to 3 visible rows

**Dynamic Border Colors**:
- Normal: `border-gray-300 hover:border-gray-400`
- Focused: `border-blue-500 ring-2 ring-blue-500 ring-opacity-20`
- Error: `border-red-500 hover:border-red-600`
- Disabled: `bg-gray-50 cursor-not-allowed`

**Transitions**:
- `transition-colors duration-200` - Smooth color transitions

#### Progress Bar
- Container: `absolute bottom-0 left-0 right-0 h-1 bg-gray-200 rounded-b-md overflow-hidden`
- Fill: `h-full bg-amber-400 transition-all duration-300 ease-out`
- Width: Dynamic based on `getProgressPercentage()`

#### Suggestions
- Container: `space-y-1`
- Buttons: `text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors`
- Layout: `flex flex-wrap gap-2`

#### Error Message
- `text-sm text-red-600 flex items-center gap-1`
- Alert icon: `w-4 h-4` SVG

#### Help Text
- `text-sm text-gray-500`

### Customization

To customize styling:

1. **Container**: Pass `className` prop for additional container styles
2. **Textarea**: Modify conditional classes in source code
3. **Progress Bar**: Adjust colors and animation in source code
4. **Suggestions**: Modify button styling in source code

## Implementation Notes

### Design Patterns

- **Controlled Component**: Value and onChange must be provided
- **Internal Validation**: Component manages validation state automatically
- **Focus Tracking**: Uses React state to track focus for styling
- **Progress Feedback**: Visual progress bar for positive reinforcement
- **Suggestion Pattern**: Quick templates for common scenarios

### State Management

- **External State**: `value` controlled by parent component
- **Internal State**:
  - `internalError`: Validation error message
  - `isFocused`: Focus state for conditional styling

- **Error Prioritization**: External `error` prop overrides internal validation
- **Validation**: Runs automatically via `useEffect` on value changes

### Dependencies

- **UI Utilities**: `cn` from `@/lib/utils` for conditional class names
- **React**: `useState`, `useEffect`, `ChangeEvent` types

### Performance Considerations

- **Automatic Validation**: `useEffect` runs on every value change (acceptable for short text)
- **Progress Calculation**: Simple math, negligible performance impact
- **Transition Animations**: CSS transitions handled by browser (GPU-accelerated)
- **Suggestion Rendering**: Minimal - only shown when input empty

### Common Use Cases

**Medication Changes**:
- Dosage adjustments
- Frequency changes
- Discontinuation reasons
- Formulary substitutions

**Client Data Changes**:
- Contact information updates
- Demographic corrections
- Insurance changes
- Care plan modifications

**Administrative Actions**:
- Permission changes
- Configuration updates
- Organizational restructuring
- Data corrections

## Testing

### Unit Tests

**Location**: `frontend/src/components/ui/__tests__/ReasonInput.test.tsx` (recommended)

**Key Test Cases**:
- ✅ Renders label and textarea
- ✅ Shows required asterisk when required=true
- ✅ Displays character count with correct color
- ✅ Shows progress bar when below minimum
- ✅ Hides progress bar when minimum reached
- ✅ Displays internal validation error
- ✅ External error overrides internal validation
- ✅ Renders suggestions when value empty
- ✅ Clicking suggestion fills textarea
- ✅ Suggestions hide when text entered
- ✅ Auto-focus works when autoFocus=true
- ✅ Disabled state prevents input

**Test Example**:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { ReasonInput } from './ReasonInput';

test('shows progress bar when below minimum', () => {
  const handleChange = vi.fn();

  render(
    <ReasonInput
      value="Short"
      onChange={handleChange}
      minLength={10}
    />
  );

  // Find progress bar (amber bg-amber-400)
  const progressBar = screen.getByRole('progressbar', { hidden: true });
  expect(progressBar).toBeInTheDocument();

  // Should be 50% (5 chars / 10 min)
  expect(progressBar).toHaveStyle({ width: '50%' });
});

test('clicking suggestion fills textarea', () => {
  const handleChange = vi.fn();
  const suggestions = ['Suggestion 1', 'Suggestion 2'];

  render(
    <ReasonInput
      value=""
      onChange={handleChange}
      suggestions={suggestions}
    />
  );

  const suggestionBtn = screen.getByText('Suggestion 1');
  fireEvent.click(suggestionBtn);

  expect(handleChange).toHaveBeenCalledWith('Suggestion 1');
});
```

### E2E Tests

**Location**: `frontend/e2e/medication-edit.spec.ts` (recommended)

**Key User Flows**:
- User types reason and sees character count update
- User sees progress bar fill as they approach minimum
- User clicks suggestion and sees textarea auto-fill
- User submits with invalid reason and sees error

**Test Example**:

```typescript
test('reason input validates and shows progress', async ({ page }) => {
  await page.goto('http://localhost:5173/medications/edit/123');

  const reasonTextarea = page.locator('textarea');

  // Type short reason
  await reasonTextarea.fill('Short');

  // Should see amber character count
  await expect(page.locator('.text-amber-500')).toContainText('5 / 10 min');

  // Should see progress bar
  await expect(page.locator('.bg-amber-400')).toBeVisible();

  // Type more to reach minimum
  await reasonTextarea.fill('This is a sufficient reason');

  // Should see green character count
  await expect(page.locator('.text-green-500')).toBeVisible();

  // Progress bar should be hidden
  await expect(page.locator('.bg-amber-400')).not.toBeVisible();
});
```

## Related Components

- **Input** (`/components/ui/input.tsx`) - Base input component
- **Label** (`/components/ui/label.tsx`) - Label component for forms
- **Textarea** (native) - Standard HTML textarea element
- **Form Components** - Used in various forms requiring audit trail

## Utility Functions

- **cn** (`/lib/utils.ts`) - Conditional class name utility (from `clsx` or similar)

## Common Issues and Solutions

### Issue: Progress Bar Not Showing

**Cause**: Character count is 0 or already at/above minimum

**Solution**: Progress bar only shows when `0 < characterCount < minLength`. This is intentional - no need to show progress when empty or complete.

### Issue: Suggestions Not Appearing

**Cause**: Value is not empty, or no suggestions provided

**Solution**: Suggestions only show when `value === ""` and `suggestions.length > 0`. Clear the input to see suggestions.

### Issue: External Error Not Showing

**Cause**: Internal validation error taking precedence

**Solution**: External `error` prop correctly overrides internal error. Verify prop is being passed correctly:

```typescript
const error = externalError || internalError;  // External takes priority
```

### Issue: Max Length Not Enforced

**Cause**: `maxLength` is HTML attribute hard limit

**Solution**: Component uses native `maxLength` attribute which browser enforces. Users cannot type beyond this limit.

## Changelog

- **2025-11-13**: Initial documentation created
- **Component Creation**: Part of audit trail and change tracking implementation
