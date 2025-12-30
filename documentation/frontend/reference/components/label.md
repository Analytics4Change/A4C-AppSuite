---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Radix UI-based label component for semantic form control association with disabled state styling and screen reader support.

**When to read**:
- Labeling form controls (inputs, checkboxes, selects)
- Creating accessible required field indicators
- Building reusable form field patterns
- Understanding label-control association best practices

**Prerequisites**: None

**Key topics**: `label`, `radix-ui`, `htmlFor`, `form-association`, `accessibility`

**Estimated read time**: 9 minutes
<!-- TL;DR-END -->

# Label

## Overview

The Label component provides semantic labeling for form controls with enhanced accessibility features. Built on Radix UI's Label primitive, it ensures proper form control association and screen reader support.

## Props Interface

```typescript
interface LabelProps extends React.ComponentProps<typeof LabelPrimitive.Root> {
  className?: string;
  htmlFor?: string;
  children: React.ReactNode;
}
```

The component extends Radix UI's Label primitive, inheriting all native label functionality including:

- `htmlFor`: Associates the label with a form control
- `onClick`: Click handling that focuses associated control
- `onMouseDown`: Mouse interaction handling
- All standard HTML attributes

## Usage Examples

### Basic Usage

```tsx
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

function BasicForm() {
  return (
    <div className="space-y-2">
      <Label htmlFor="email">Email Address</Label>
      <Input id="email" type="email" placeholder="Enter your email" />
    </div>
  );
}
```

### Required Field Indication

```tsx
function RequiredField() {
  return (
    <div className="space-y-2">
      <Label htmlFor="username">
        Username
        <span className="text-destructive ml-1" aria-label="required">*</span>
      </Label>
      <Input id="username" required aria-required="true" />
    </div>
  );
}
```

### With Checkbox

```tsx
import { Checkbox } from '@/components/ui/checkbox';

function CheckboxWithLabel() {
  return (
    <div className="flex items-center space-x-2">
      <Checkbox id="terms" />
      <Label htmlFor="terms">
        I agree to the terms and conditions
      </Label>
    </div>
  );
}
```

### Complex Labels with Additional Content

```tsx
function ComplexLabel() {
  return (
    <div className="space-y-2">
      <Label htmlFor="password" className="flex justify-between">
        <span>Password</span>
        <span className="text-sm text-muted-foreground">
          Min 8 characters
        </span>
      </Label>
      <Input 
        id="password" 
        type="password" 
        minLength={8}
        aria-describedby="password-help"
      />
      <p id="password-help" className="text-sm text-muted-foreground">
        Must contain at least 8 characters with uppercase, lowercase, and numbers
      </p>
    </div>
  );
}
```

### Disabled State

```tsx
function DisabledField() {
  return (
    <div className="space-y-2 group" data-disabled="true">
      <Label htmlFor="disabled-input">
        Disabled Field
      </Label>
      <Input id="disabled-input" disabled />
    </div>
  );
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**:
  - Clicking label focuses the associated form control
  - Supports all standard keyboard interactions via association

- **ARIA Attributes**:
  - Implicit labeling through `htmlFor` attribute
  - Works with screen readers to announce field purpose
  - Supports complex labeling patterns

- **Form Association**:
  - Proper `htmlFor` and `id` relationship required
  - Clicking label activates or focuses associated control
  - Groups related form elements semantically

### Screen Reader Support

- Labels are announced when focusing associated controls
- Required field indicators should include `aria-label` for clarity
- Complex labels work with `aria-describedby` for additional context

### Best Practices

```tsx
// ✅ Good: Proper association
<Label htmlFor="email">Email</Label>
<Input id="email" type="email" />

// ✅ Good: Accessible required indicator
<Label htmlFor="name">
  Name
  <span className="text-destructive" aria-label="required">*</span>
</Label>

// ✅ Good: Complex labeling with description
<Label htmlFor="phone">Phone Number</Label>
<Input 
  id="phone" 
  type="tel" 
  aria-describedby="phone-help"
/>
<div id="phone-help">Include area code (e.g., +1 555-123-4567)</div>

// ❌ Avoid: Missing association
<Label>Email</Label>  // No htmlFor
<Input type="email" /> // No id

// ❌ Avoid: Mismatched association
<Label htmlFor="email">Email</Label>
<Input id="username" type="email" />  // Wrong id
```

## Styling

### CSS Classes

The label includes comprehensive styling for different states:

- **Base**: `flex items-center gap-2 text-sm leading-none font-medium select-none`
- **Disabled Group**: `group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50`
- **Peer Disabled**: `peer-disabled:cursor-not-allowed peer-disabled:opacity-50`

### Layout and Spacing

- **Flex Layout**: `flex items-center gap-2` for icon/text combinations
- **Typography**: `text-sm font-medium` for optimal readability
- **User Selection**: `select-none` prevents accidental text selection

### Customization

```tsx
// Custom styling
<Label className="text-lg font-bold text-primary" htmlFor="title">
  Document Title
</Label>

// With icon
<Label htmlFor="search" className="flex items-center gap-2">
  <SearchIcon className="h-4 w-4" />
  Search Query
</Label>

// Inline layout
<Label className="inline-flex items-baseline gap-1" htmlFor="quantity">
  Quantity:
  <span className="text-muted-foreground">(optional)</span>
</Label>
```

## Implementation Notes

### Design Patterns

- **Semantic HTML**: Uses proper `<label>` element for form association
- **Radix Integration**: Built on Radix UI Label primitive for enhanced functionality
- **Accessibility First**: Designed for screen reader compatibility
- **Flexible Layout**: Flex container supports icons and complex content

### Dependencies

- `@radix-ui/react-label`: Accessibility-enhanced label primitive
- `./utils`: Utility function for className merging

### Client-Side Directive

The component uses the "use client" directive for Next.js compatibility, ensuring proper client-side rendering of interactive elements.

## Testing

### Unit Tests

Located in `src/components/ui/__tests__/label.test.tsx`:

- Form control association
- Click behavior (focusing associated control)
- Disabled state handling
- Custom className application

### E2E Tests

Covered in form interaction tests:

- Label-control association functionality
- Keyboard navigation between labeled controls
- Screen reader compatibility
- Form submission workflows

## Related Components

- **Input**: Primary use case for form field labeling
- **Checkbox**: Toggle control labeling
- **Radio**: Radio button group labeling
- **Select**: Dropdown control labeling
- **Textarea**: Multi-line text field labeling

## Common Patterns

### Form Field Group

```tsx
interface FormFieldProps {
  label: string;
  htmlFor: string;
  required?: boolean;
  helpText?: string;
  error?: string;
  children: React.ReactNode;
}

function FormField({ 
  label, 
  htmlFor, 
  required, 
  helpText, 
  error, 
  children 
}: FormFieldProps) {
  const helpId = `${htmlFor}-help`;
  const errorId = `${htmlFor}-error`;

  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="text-destructive ml-1" aria-label="required">
            *
          </span>
        )}
      </Label>
      
      {React.cloneElement(children as React.ReactElement, {
        id: htmlFor,
        'aria-required': required,
        'aria-invalid': error ? 'true' : 'false',
        'aria-describedby': [
          helpText ? helpId : null,
          error ? errorId : null
        ].filter(Boolean).join(' ') || undefined
      })}
      
      {helpText && (
        <p id={helpId} className="text-sm text-muted-foreground">
          {helpText}
        </p>
      )}
      
      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
```

### Checkbox Group Labeling

```tsx
function CheckboxGroup() {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Notification Preferences</legend>
      
      {['email', 'sms', 'push'].map((type) => (
        <div key={type} className="flex items-center space-x-2">
          <Checkbox id={`notify-${type}`} />
          <Label htmlFor={`notify-${type}`}>
            {type.charAt(0).toUpperCase() + type.slice(1)} notifications
          </Label>
        </div>
      ))}
    </fieldset>
  );
}
```

## Changelog

- **v1.0.0**: Initial implementation with Radix UI Label
- **v1.1.0**: Added disabled state styling with group and peer selectors
- **v1.2.0**: Enhanced flex layout for icon support
- **v1.3.0**: Improved accessibility with better state management
