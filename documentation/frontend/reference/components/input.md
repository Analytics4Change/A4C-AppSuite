# Input

## Overview

The Input component provides a styled, accessible text input field with consistent theming and validation states. Built with React forwardRef for seamless integration with form libraries and accessibility tools.

## Props Interface

```typescript
interface InputProps extends React.ComponentProps<"input"> {
  className?: string;
  type?: string;
}
```

The component extends all standard HTML input attributes including:

- `value`, `defaultValue`
- `onChange`, `onBlur`, `onFocus`
- `placeholder`, `disabled`, `required`
- `name`, `id`, `form`
- And all other native input properties

## Usage Examples

### Basic Usage

```tsx
import { Input } from '@/components/ui/input';

function MyForm() {
  const [value, setValue] = useState('');
  
  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="Enter text here"
    />
  );
}
```

### Different Input Types

```tsx
// Text input (default)
<Input type="text" placeholder="Enter your name" />

// Email input with validation
<Input type="email" placeholder="your@email.com" />

// Password input
<Input type="password" placeholder="Enter password" />

// Number input
<Input type="number" placeholder="Enter amount" min="0" max="100" />

// Date input
<Input type="date" />

// File input
<Input type="file" accept=".pdf,.doc,.docx" />
```

### With Form Integration

```tsx
import { useForm } from 'react-hook-form';

function RegistrationForm() {
  const { register, handleSubmit, formState: { errors } } = useForm();

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Input
        {...register('email', { required: 'Email is required' })}
        type="email"
        placeholder="Email address"
        aria-invalid={errors.email ? 'true' : 'false'}
        aria-describedby={errors.email ? 'email-error' : undefined}
      />
      {errors.email && (
        <span id="email-error" role="alert">
          {errors.email.message}
        </span>
      )}
    </form>
  );
}
```

### Controlled vs Uncontrolled

```tsx
// Controlled component
function ControlledInput() {
  const [value, setValue] = useState('');
  
  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

// Uncontrolled component with ref
function UncontrolledInput() {
  const inputRef = useRef<HTMLInputElement>(null);
  
  const handleSubmit = () => {
    console.log(inputRef.current?.value);
  };
  
  return (
    <Input
      ref={inputRef}
      defaultValue="Initial value"
    />
  );
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**:
  - Tab/Shift+Tab for focus navigation
  - Standard text input keyboard interactions
  - Cursor keys for text navigation

- **ARIA Attributes**:
  - `aria-invalid`: Automatically styled for error states
  - `aria-describedby`: For linking to error messages or help text
  - `aria-label` or proper `<label>` association required
  - `aria-required`: For required fields

- **Focus Management**:
  - High contrast focus ring: `focus-visible:ring-[3px]`
  - Focus border color changes: `focus-visible:border-ring`
  - Clear focus indicator that meets contrast requirements

### Screen Reader Support

- Proper label association is essential
- Error states are announced via `aria-invalid`
- Help text should be linked via `aria-describedby`

### Required Accessibility Pattern

```tsx
function AccessibleInput() {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const inputId = 'user-email';
  const errorId = 'user-email-error';
  const helpId = 'user-email-help';

  return (
    <div>
      <label htmlFor={inputId}>
        Email Address *
      </label>
      <Input
        id={inputId}
        type="email"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-required="true"
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={`${helpId}${error ? ` ${errorId}` : ''}`}
      />
      <div id={helpId}>
        We'll use this to send you important updates
      </div>
      {error && (
        <div id={errorId} role="alert" className="text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
```

## Styling

### CSS Classes

The input includes comprehensive styling:

- **Base**: `flex h-9 w-full rounded-md border px-3 py-1 text-base`
- **Background**: `bg-input-background dark:bg-input/30`
- **Border**: `border-input`
- **Focus**: `focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]`
- **Invalid**: `aria-invalid:border-destructive aria-invalid:ring-destructive/20`
- **Disabled**: `disabled:pointer-events-none disabled:opacity-50`
- **Placeholder**: `placeholder:text-muted-foreground`
- **Selection**: `selection:bg-primary selection:text-primary-foreground`

### File Input Styling

Special styling for file inputs:

- `file:inline-flex file:h-7 file:border-0 file:bg-transparent`
- `file:text-sm file:font-medium file:text-foreground`

### Customization

```tsx
// Custom width and styling
<Input className="w-48 font-semibold" />

// Custom error styling
<Input 
  className="border-red-500 ring-red-200" 
  aria-invalid="true" 
/>

// Full width with margin
<Input className="w-full mt-4" />
```

## Implementation Notes

### Design Patterns

- **ForwardRef Pattern**: Properly forwards refs for form library integration
- **Controlled/Uncontrolled**: Supports both patterns seamlessly
- **Validation States**: Built-in styling for error states via `aria-invalid`
- **Theme Integration**: Uses CSS custom properties for consistent theming

### Dependencies

- `./utils`: Utility function for className merging (`cn`)
- React forwardRef for proper ref handling

### Dark Mode Support

- Automatic dark mode background: `dark:bg-input/30`
- Dark mode error states: `dark:aria-invalid:ring-destructive/40`

## Testing

### Unit Tests

Located in `src/components/ui/__tests__/input.test.tsx`:

- Value handling (controlled/uncontrolled)
- Event handling (onChange, onBlur, onFocus)
- Accessibility attributes
- Error state styling
- Ref forwarding

### E2E Tests

Covered in form interaction tests:

- Tab navigation
- Text input and editing
- Form submission
- Validation error handling

## Related Components

- **Label**: Should always be paired for accessibility
- **Button**: Often used together in forms
- **Form**: Container for input groups
- **Textarea**: Alternative for multi-line text
- **Select**: Alternative for option selection

## Common Patterns

### Form Field Pattern

```tsx
interface FormFieldProps {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  error?: string;
  helpText?: string;
}

function FormField({ label, name, type = 'text', required, error, helpText }: FormFieldProps) {
  const inputId = `field-${name}`;
  const errorId = `${inputId}-error`;
  const helpId = `${inputId}-help`;

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label} {required && '*'}
      </label>
      <Input
        id={inputId}
        name={name}
        type={type}
        aria-required={required}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={`${helpId}${error ? ` ${errorId}` : ''}`}
      />
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

## Changelog

- **v1.0.0**: Initial implementation with basic styling
- **v1.1.0**: Added focus ring and validation states
- **v1.2.0**: Enhanced dark mode support and file input styling
- **v1.3.0**: Improved accessibility with aria-invalid styling
