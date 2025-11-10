# Frontend Accessibility Checker Agent

---
description: |
  Specialized agent for validating React components meet WCAG 2.1 Level AA accessibility standards.
  Checks keyboard navigation, ARIA attributes, focus management, semantic HTML, and screen reader compatibility.
agent_type: validation
context: frontend
estimated_time: 3-8 minutes per component
---

## Purpose

This agent performs comprehensive accessibility validation of React components to ensure compliance with WCAG 2.1 Level AA standards. Critical for healthcare applications where accessibility is legally required and impacts patient safety.

## When to Invoke

**Automatically**:
- Before committing component code to git
- As part of PR review process for frontend changes
- Before deploying frontend to staging/production

**Manually**:
- After creating a new component
- After modifying component interaction patterns
- When reviewing accessibility compliance
- Before conducting formal accessibility audit
- When troubleshooting keyboard navigation or screen reader issues

## Validation Criteria

### 1. Keyboard Navigation (WCAG 2.1.1, 2.1.2 - Level A)

All interactive elements must be keyboard accessible with visible focus indicators.

#### Tab Order and Focus Management

✅ **CORRECT**: Proper tab order and focus indicators
```tsx
import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger, DialogContent } from '@/components/ui/dialog';

function MedicationDialog() {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus management: move focus to close button when dialog opens
  useEffect(() => {
    if (open && closeButtonRef.current) {
      closeButtonRef.current.focus();  // ✅ Proper focus management
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add Medication</Button>  {/* ✅ Interactive, keyboard accessible */}
      </DialogTrigger>
      <DialogContent>
        <h2>Add New Medication</h2>
        <form onSubmit={handleSubmit}>
          <input type="text" placeholder="Medication name" />  {/* ✅ Native form element */}
          <Button type="submit">Save</Button>
          <Button
            ref={closeButtonRef}
            type="button"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

❌ **WRONG**: Missing focus management or non-keyboard-accessible elements
```tsx
function MedicationDialog() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      {/* ❌ div with onClick is not keyboard accessible */}
      <div onClick={() => setOpen(true)}>Add Medication</div>

      {open && (
        <div className="modal">
          <h2>Add New Medication</h2>
          <form>
            <input type="text" />
            <button type="submit">Save</button>
            {/* ❌ No focus management - focus stays on trigger button behind modal */}
          </form>
        </div>
      )}
    </div>
  );
}
```

**Validation Checks**:
- ✅ All interactive elements are keyboard accessible (Button, not div with onClick)
- ✅ Logical tab order (top to bottom, left to right)
- ✅ Focus indicators visible (outline or custom styling)
- ✅ Focus managed when modal/dialog opens (useEffect with .focus())
- ✅ Focus returned to trigger when modal/dialog closes
- ✅ No keyboard traps (user can tab out of all components)

#### Keyboard Event Handlers

✅ **CORRECT**: Proper keyboard event handling
```tsx
import { useState, useRef } from 'react';

function DropdownMenu() {
  const [open, setOpen] = useState(false);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        const nextIndex = (index + 1) % itemRefs.current.length;
        itemRefs.current[nextIndex]?.focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        const prevIndex = (index - 1 + itemRefs.current.length) % itemRefs.current.length;
        itemRefs.current[prevIndex]?.focus();
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Home':
        e.preventDefault();
        itemRefs.current[0]?.focus();
        break;
      case 'End':
        e.preventDefault();
        itemRefs.current[itemRefs.current.length - 1]?.focus();
        break;
    }
  };

  return (
    <div>
      <button onClick={() => setOpen(!open)} aria-expanded={open}>
        Actions
      </button>
      {open && (
        <div role="menu">
          {['Edit', 'Delete', 'Archive'].map((action, i) => (
            <button
              key={action}
              ref={el => itemRefs.current[i] = el}
              role="menuitem"
              onKeyDown={e => handleKeyDown(e, i)}
            >
              {action}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Required Keyboard Shortcuts**:
- `Tab` / `Shift+Tab`: Navigate between interactive elements
- `Enter` / `Space`: Activate buttons and links
- `Escape`: Close dialogs, dropdowns, and modals
- `Arrow Keys`: Navigate within menus, tabs, and lists
- `Home` / `End`: Jump to first/last item in menus and lists

### 2. ARIA Attributes and Roles (WCAG 4.1.2 - Level A)

Use ARIA to communicate component state and relationships to assistive technologies.

#### ARIA Labels and Descriptions

✅ **CORRECT**: Proper ARIA labels for context
```tsx
function MedicationForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form aria-label="Add new medication">
      <div>
        <label htmlFor="med-name">Medication Name</label>  {/* ✅ Explicit label */}
        <input
          id="med-name"
          type="text"
          aria-required="true"  {/* ✅ Communicates required state */}
          aria-invalid={!!error}  {/* ✅ Communicates validation state */}
          aria-describedby={error ? "med-name-error" : undefined}  {/* ✅ Links to error message */}
        />
        {error && (
          <span id="med-name-error" role="alert" aria-live="assertive">
            {error}  {/* ✅ Screen reader announces immediately */}
          </span>
        )}
      </div>

      <button type="submit" aria-busy={loading} disabled={loading}>
        {loading ? 'Saving...' : 'Save Medication'}
      </button>

      {/* ✅ Loading indicator for screen readers */}
      {loading && (
        <div role="status" aria-live="polite">
          <span className="sr-only">Saving medication, please wait...</span>
        </div>
      )}
    </form>
  );
}
```

❌ **WRONG**: Missing or incorrect ARIA
```tsx
function MedicationForm() {
  return (
    <form>
      <div>
        {/* ❌ No label association */}
        <label>Medication Name</label>
        <input type="text" />
      </div>

      {/* ❌ No aria-busy, no loading announcement */}
      <button type="submit">Save Medication</button>

      {/* ❌ Error not announced to screen readers */}
      {error && <span className="error">{error}</span>}
    </form>
  );
}
```

**Required ARIA Attributes**:
- `aria-label` or `aria-labelledby`: All form inputs, buttons without text
- `aria-required`: Required form fields
- `aria-invalid`: Fields with validation errors
- `aria-describedby`: Link inputs to error messages or help text
- `aria-expanded`: Collapsible sections, dropdowns, accordions
- `aria-busy`: Loading states
- `aria-live`: Dynamic content updates (polite or assertive)
- `aria-hidden`: Decorative icons or images

#### ARIA Roles

✅ **CORRECT**: Semantic HTML with ARIA roles where needed
```tsx
function MedicationList({ medications }: { medications: Medication[] }) {
  return (
    <div>
      <h2 id="medications-heading">Your Medications</h2>

      {/* ✅ Semantic list element */}
      <ul aria-labelledby="medications-heading">
        {medications.map(med => (
          <li key={med.id}>
            <article aria-label={`Medication: ${med.name}`}>
              <h3>{med.name}</h3>
              <p>Dosage: {med.dosage}</p>
              <div role="group" aria-label="Actions">
                <button aria-label={`Edit ${med.name}`}>Edit</button>
                <button aria-label={`Delete ${med.name}`}>Delete</button>
              </div>
            </article>
          </li>
        ))}
      </ul>

      {medications.length === 0 && (
        <div role="status" aria-live="polite">
          No medications found.
        </div>
      )}
    </div>
  );
}
```

**Common Roles**:
- `role="button"`: Custom button elements (avoid, use `<button>` instead)
- `role="dialog"`: Modal dialogs
- `role="alert"`: Important error messages (announces immediately)
- `role="status"`: Status updates (announces politely)
- `role="menu"`: Dropdown menus
- `role="menuitem"`: Menu items
- `role="tab"`, `role="tabpanel"`: Tab interfaces
- `role="navigation"`: Navigation landmarks

### 3. Focus Management in Modals and Dialogs (WCAG 2.4.3 - Level A)

Focus must be trapped within modal dialogs and returned to trigger on close.

✅ **CORRECT**: Radix UI Dialog handles focus automatically
```tsx
import { Dialog, DialogTrigger, DialogContent, DialogClose } from '@/components/ui/dialog';

function DeleteMedicationDialog({ medicationName }: { medicationName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive">Delete</Button>
      </DialogTrigger>
      <DialogContent aria-describedby="delete-description">
        <h2>Confirm Deletion</h2>
        <p id="delete-description">
          Are you sure you want to delete {medicationName}? This action cannot be undone.
        </p>
        <div>
          <Button variant="destructive" onClick={handleDelete}>
            Yes, Delete
          </Button>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**Validation Checks**:
- ✅ Focus moves to dialog when opened
- ✅ Tab navigation cycles within dialog (focus trap)
- ✅ Escape key closes dialog
- ✅ Focus returns to trigger button when dialog closes
- ✅ Dialog has `aria-describedby` linking to description
- ✅ Dialog has close button or DialogClose component

### 4. Semantic HTML (WCAG 1.3.1 - Level A)

Use proper HTML elements to convey meaning.

✅ **CORRECT**: Semantic HTML
```tsx
function MedicationCard({ medication }: { medication: Medication }) {
  return (
    <article>  {/* ✅ Semantic: self-contained content */}
      <header>
        <h3>{medication.name}</h3>  {/* ✅ Heading hierarchy */}
      </header>
      <section>
        <h4>Dosage Information</h4>
        <dl>  {/* ✅ Definition list for key-value pairs */}
          <dt>Dosage</dt>
          <dd>{medication.dosage}</dd>
          <dt>Frequency</dt>
          <dd>{medication.frequency}</dd>
        </dl>
      </section>
      <footer>
        <time dateTime={medication.createdAt}>  {/* ✅ Machine-readable time */}
          Added {formatDate(medication.createdAt)}
        </time>
      </footer>
    </article>
  );
}
```

❌ **WRONG**: Divs for everything
```tsx
function MedicationCard({ medication }: { medication: Medication }) {
  return (
    <div>  {/* ❌ No semantic meaning */}
      <div className="title">{medication.name}</div>  {/* ❌ Should be heading */}
      <div>
        <div>Dosage: {medication.dosage}</div>  {/* ❌ Should be dl/dt/dd */}
        <div>Frequency: {medication.frequency}</div>
      </div>
      <div>Added {medication.createdAt}</div>  {/* ❌ Should use <time> */}
    </div>
  );
}
```

**Semantic Elements to Use**:
- `<header>`, `<nav>`, `<main>`, `<footer>`, `<aside>`: Page structure
- `<article>`, `<section>`: Content grouping
- `<h1>` through `<h6>`: Heading hierarchy (don't skip levels)
- `<button>`: Interactive buttons (not `<div onClick>`)
- `<a>`: Links to other pages (not `<button onClick={navigate}>`)
- `<ul>`, `<ol>`, `<li>`: Lists
- `<dl>`, `<dt>`, `<dd>`: Definition lists (key-value pairs)
- `<table>`, `<thead>`, `<tbody>`, `<th>`, `<td>`: Tabular data
- `<form>`, `<label>`, `<input>`, `<select>`, `<textarea>`: Forms
- `<time>`: Dates and times

### 5. Color Contrast (WCAG 1.4.3 - Level AA)

Text must meet minimum contrast ratios: 4.5:1 for normal text, 3:1 for large text (18pt+).

✅ **CORRECT**: Sufficient contrast
```tsx
// Tailwind classes with sufficient contrast
<div className="bg-white text-gray-900">  {/* ✅ 21:1 ratio */}
  <h2 className="text-2xl">Medications</h2>
  <p className="text-gray-700">Manage your prescriptions</p>  {/* ✅ 12.6:1 ratio */}
  <a href="/add" className="text-blue-600 hover:text-blue-800">  {/* ✅ 8.6:1 ratio */}
    Add New
  </a>
</div>

// Error states with sufficient contrast
<span className="text-red-600">  {/* ✅ 7.7:1 ratio on white */}
  Please enter a medication name
</span>
```

❌ **WRONG**: Insufficient contrast
```tsx
<div className="bg-white text-gray-400">  {/* ❌ 3.3:1 ratio - fails AA */}
  <p>This text is too light</p>
</div>

<a href="/add" className="text-blue-300">  {/* ❌ 2.8:1 ratio - fails AA */}
  Add New
</a>

<span className="text-red-300">  {/* ❌ 2.5:1 ratio - fails AA */}
  Error message too light
</span>
```

**Contrast Requirements**:
- Normal text (<18pt): Minimum 4.5:1 ratio
- Large text (≥18pt or ≥14pt bold): Minimum 3:1 ratio
- UI components and graphical objects: Minimum 3:1 ratio
- Check contrast with browser DevTools or online tools

### 6. Screen Reader Compatibility

Content must be properly announced by screen readers.

✅ **CORRECT**: Screen reader friendly
```tsx
function MedicationListItem({ medication }: { medication: Medication }) {
  return (
    <li>
      <div>
        <h3>{medication.name}</h3>
        <p>
          Dosage: {medication.dosage}, Frequency: {medication.frequency}
        </p>

        {/* ✅ Icon with sr-only text for screen readers */}
        <button aria-label={`Edit ${medication.name}`}>
          <PencilIcon aria-hidden="true" />  {/* ✅ Decorative icon hidden */}
          <span className="sr-only">Edit</span>
        </button>

        {/* ✅ Loading state announced */}
        {isDeleting && (
          <span role="status" aria-live="polite" className="sr-only">
            Deleting {medication.name}
          </span>
        )}
      </div>
    </li>
  );
}

// sr-only utility class (in globals.css)
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

**Validation Checks**:
- ✅ Icons have `aria-hidden="true"` or descriptive `aria-label`
- ✅ Image `alt` text describes image content (or `alt=""` for decorative)
- ✅ Loading states use `aria-live` regions
- ✅ Form errors announced with `role="alert"`
- ✅ Skip links for keyboard users (`<a href="#main">Skip to content</a>`)

### 7. Form Validation and Error Messages (WCAG 3.3.1, 3.3.2 - Level A)

Forms must provide clear error messages and validation feedback.

✅ **CORRECT**: Accessible form validation
```tsx
function MedicationForm() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!name) newErrors.name = 'Medication name is required';
    if (!dosage) newErrors.dosage = 'Dosage is required';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      // ✅ Focus first error field
      const firstErrorField = Object.keys(newErrors)[0];
      document.getElementById(firstErrorField)?.focus();
      return;
    }

    // Submit form...
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div>
        <label htmlFor="name">Medication Name *</label>
        <input
          id="name"
          type="text"
          aria-required="true"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "name-error" : undefined}
          onBlur={() => setTouched(prev => ({ ...prev, name: true }))}
        />
        {/* ✅ Error message linked via aria-describedby */}
        {touched.name && errors.name && (
          <span id="name-error" role="alert" aria-live="assertive">
            {errors.name}
          </span>
        )}
      </div>

      <button type="submit">Save Medication</button>
    </form>
  );
}
```

**Validation Checks**:
- ✅ Required fields marked with `aria-required` and `*` in label
- ✅ Validation errors shown near input field
- ✅ Errors linked to inputs with `aria-describedby`
- ✅ Errors announced with `role="alert"` and `aria-live="assertive"`
- ✅ Focus moved to first error field on submit
- ✅ Error messages are specific and actionable

## Review Process

When reviewing a component for accessibility:

1. **Keyboard Navigation**:
   - Tab through all interactive elements
   - Verify focus indicators are visible
   - Check Escape, Enter, Arrow keys work as expected
   - Ensure focus is managed in modals/dialogs

2. **ARIA Attributes**:
   - All form inputs have labels (`htmlFor` + `id` or `aria-label`)
   - Dynamic content uses `aria-live` regions
   - Errors use `role="alert"` and `aria-invalid`
   - Expanded/collapsed states use `aria-expanded`

3. **Semantic HTML**:
   - Headings use `<h1>` through `<h6>` in proper hierarchy
   - Buttons use `<button>`, links use `<a>`
   - Lists use `<ul>`, `<ol>`, `<li>`
   - Forms use `<form>`, `<label>`, `<input>`

4. **Color Contrast**:
   - Check contrast ratios with browser DevTools
   - Verify text meets 4.5:1 (normal) or 3:1 (large)
   - Check focus indicators have 3:1 contrast

5. **Screen Reader Testing**:
   - Test with NVDA (Windows), JAWS (Windows), or VoiceOver (macOS)
   - Verify all content is announced correctly
   - Check icons are hidden or have descriptive text

6. **Form Validation**:
   - Required fields marked and announced
   - Errors linked to inputs and announced
   - Focus moved to first error on submit

## Output Format

**Success**:
```
✅ Accessibility check PASSED: frontend/src/components/MedicationCard.tsx

Checks completed:
- Keyboard Navigation: ✅ All elements keyboard accessible, focus managed
- ARIA Attributes: ✅ Proper labels, roles, and states
- Semantic HTML: ✅ Correct use of headings, lists, and landmarks
- Color Contrast: ✅ All text meets WCAG AA contrast ratios (4.5:1+)
- Screen Reader: ✅ Content properly announced
- Form Validation: N/A (no forms in component)

WCAG 2.1 Level AA: COMPLIANT
```

**Failure**:
```
❌ Accessibility check FAILED: frontend/src/components/MedicationDialog.tsx

Issues found:

[CRITICAL] Keyboard trap in modal (Line 45):
  No way to escape modal with keyboard
  ❌ Escape key handler missing
  ✅ Add: onKeyDown={e => e.key === 'Escape' && onClose()}
  ✅ Or use Radix Dialog which handles this automatically

[CRITICAL] Missing form labels (Line 30):
  <input type="text" placeholder="Medication name" />
  ❌ No label associated with input
  ✅ Add: <label htmlFor="med-name">Medication Name</label>

[IMPORTANT] Insufficient color contrast (Line 52):
  className="text-gray-400"
  ❌ 3.3:1 contrast ratio (fails WCAG AA 4.5:1 requirement)
  ✅ Use: text-gray-700 (12.6:1 ratio) or darker

[IMPORTANT] Icon without alternative text (Line 60):
  <PencilIcon />
  ❌ Screen readers can't describe icon-only button
  ✅ Add: aria-label="Edit medication" or <span className="sr-only">Edit</span>

[WARNING] Non-semantic HTML (Line 25):
  <div onClick={handleClick}>Submit</div>
  ❌ div is not keyboard accessible
  ✅ Use: <button onClick={handleClick}>Submit</button>

WCAG 2.1 Level AA: NOT COMPLIANT
```

## References

- **A4C-AppSuite Component Examples**: `frontend/src/components/ui/` (accessible patterns)
- **Frontend Accessibility Skill**: `.claude/skills/frontend-dev-guidelines/resources/accessibility-standards.md`
- **Frontend CLAUDE.md**: `frontend/CLAUDE.md` (WCAG 2.1 Level AA requirements)
- **Radix UI Documentation**: https://www.radix-ui.com/ (accessible primitives)
- **WCAG 2.1 Guidelines**: https://www.w3.org/WAI/WCAG21/quickref/

## Usage Example

```bash
# Manually invoke agent on a specific component
echo "Check accessibility: frontend/src/components/MedicationCard.tsx"

# Or integrate into pre-commit hook
.claude/hooks/check-accessibility.sh frontend/src/components/MedicationCard.tsx
```

---

**Agent Version**: 1.0.0
**Last Updated**: 2025-11-10
**Maintainer**: A4C-AppSuite Frontend Team
