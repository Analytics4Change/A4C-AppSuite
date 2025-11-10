# Accessibility Standards (WCAG 2.1 Level AA)

## Overview

A4C-AppSuite targets WCAG 2.1 Level AA compliance for healthcare accessibility. This is mandatory for healthcare applications to ensure equitable access for users with disabilities.

**Key Requirements:**
- Keyboard navigation support
- Screen reader compatibility (NVDA, JAWS)
- Focus management
- ARIA labels and landmarks
- Color contrast (4.5:1 minimum)
- Error announcements
- Responsive design for zoom/magnification

## ARIA Attributes

### Essential ARIA Labels

```typescript
// Button with icon only
<button aria-label="Delete medication">
  <TrashIcon />
</button>

// Button with visible text (no aria-label needed)
<button>
  <TrashIcon />
  Delete
</button>

// Link with aria-label for context
<a href="/medications" aria-label="View all medications">
  View All
</a>

// Input with aria-describedby for additional context
<input
  id="dosage"
  aria-label="Medication dosage"
  aria-describedby="dosage-help"
  aria-required="true"
/>
<p id="dosage-help" className="text-sm text-muted-foreground">
  Enter dosage with unit (e.g., 81mg, 200mg)
</p>

// Error state with aria-invalid
<input
  id="email"
  type="email"
  aria-label="Email address"
  aria-invalid={hasError}
  aria-describedby={hasError ? "email-error" : undefined}
/>
{hasError && (
  <p id="email-error" className="text-destructive" role="alert">
    Please enter a valid email address
  </p>
)}
```

### ARIA Live Regions

Use `aria-live` to announce dynamic content changes to screen readers.

```typescript
// Polite announcements (non-urgent)
<div aria-live="polite" aria-atomic="true" className="sr-only">
  {statusMessage}
</div>

// Assertive announcements (urgent, errors)
<div aria-live="assertive" aria-atomic="true" className="sr-only">
  {errorMessage}
</div>

// Toast notifications
export const Toast = ({ message, type }: ToastProps) => (
  <div
    role="status"
    aria-live={type === "error" ? "assertive" : "polite"}
    className="fixed bottom-4 right-4 rounded-md border p-4"
  >
    {message}
  </div>
);

// Loading state announcement
{loading && (
  <div aria-live="polite" aria-busy="true" className="sr-only">
    Loading medications, please wait...
  </div>
)}
```

### ARIA Landmarks

Use semantic HTML and ARIA landmarks for navigation.

```typescript
// Semantic HTML (preferred)
<header>
  <nav aria-label="Main navigation">
    <ul>{/* navigation items */}</ul>
  </nav>
</header>

<main>
  {/* Main content */}
</main>

<aside aria-label="Sidebar">
  {/* Sidebar content */}
</aside>

<footer>
  {/* Footer content */}
</footer>

// ARIA landmarks when semantic HTML isn't possible
<div role="navigation" aria-label="Breadcrumb">
  {/* Breadcrumb navigation */}
</div>

<div role="search">
  <input type="search" aria-label="Search medications" />
</div>

<div role="complementary" aria-label="Related information">
  {/* Sidebar content */}
</div>
```

## Keyboard Navigation

### Focus Management

**CRITICAL**: Use `useEffect` with refs for focus management. Never use `setTimeout`.

```typescript
import { useRef, useEffect } from "react";

// ✅ Correct: Focus management with useEffect
export const Dialog = ({ isOpen }: DialogProps) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      closeButtonRef.current?.focus();
    }
  }, [isOpen]);

  return (
    <div>
      <button ref={closeButtonRef}>Close</button>
    </div>
  );
};

// ❌ Wrong: Using setTimeout for focus
export const Dialog = ({ isOpen }: DialogProps) => {
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        document.getElementById("close-button")?.focus(); // Don't do this!
      }, 100);
    }
  }, [isOpen]);
};
```

### Keyboard Event Handlers

```typescript
// Enter and Space for custom interactive elements
<div
  role="button"
  tabIndex={0}
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  }}
>
  Custom Button
</div>

// Escape to close dialogs/modals
<Dialog.Content
  onKeyDown={(e) => {
    if (e.key === "Escape") {
      onClose();
    }
  }}
>
  {/* Content */}
</Dialog.Content>

// Arrow keys for navigation
<div
  role="listbox"
  onKeyDown={(e) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusNextItem();
        break;
      case "ArrowUp":
        e.preventDefault();
        focusPreviousItem();
        break;
      case "Home":
        e.preventDefault();
        focusFirstItem();
        break;
      case "End":
        e.preventDefault();
        focusLastItem();
        break;
    }
  }}
>
  {/* List items */}
</div>
```

### Tab Order

Tab order follows DOM order by default. Use `tabIndex={-1}` for decorative elements. Add skip-to-content link for keyboard users. Avoid custom tab order (`tabIndex={1}`, `tabIndex={2}`).

## Screen Reader Support

### Screen Reader Only Text

```typescript
// Hide text visually but available to screen readers
<span className="sr-only">Delete medication</span>
<TrashIcon aria-hidden="true" />

// Example: Icon button with screen reader text
<button className="p-2">
  <span className="sr-only">Delete</span>
  <TrashIcon className="h-4 w-4" aria-hidden="true" />
</button>

// Show on focus (skip to content link)
<a
  href="#main"
  className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2"
>
  Skip to main content
</a>
```

### Decorative vs Meaningful Images

```typescript
// Decorative images (hidden from screen readers)
<img src="/decorative.svg" alt="" aria-hidden="true" />
<div className="bg-pattern" aria-hidden="true"></div>

// Meaningful images (alt text required)
<img src="/logo.png" alt="A4C AppSuite Logo" />
<img src="/user-avatar.jpg" alt="Profile picture of John Doe" />

// Complex images (use aria-describedby for long descriptions)
<img
  src="/chart.png"
  alt="Medication adherence chart"
  aria-describedby="chart-description"
/>
<div id="chart-description" className="sr-only">
  Chart showing 85% medication adherence rate over the past 30 days,
  with highest adherence on weekdays and lower adherence on weekends.
</div>
```

### Form Accessibility

Use `<label htmlFor="id">` for all inputs. Use `<fieldset>` and `<legend>` for related groups. Add `aria-required`, `aria-invalid`, and `aria-describedby` for validation.

## Color Contrast

WCAG 2.1 Level AA requires minimum contrast ratios:
- **Normal text**: 4.5:1
- **Large text** (18pt+ or 14pt+ bold): 3:1
- **UI components and graphics**: 3:1

```typescript
// ✅ Good contrast examples
<p className="text-gray-900 dark:text-gray-100">
  High contrast text on white/dark background (>7:1)
</p>

<button className="bg-primary text-primary-foreground">
  Primary button (design system ensures 4.5:1+)
</button>

// ⚠️ Check contrast for custom colors
<button className="bg-blue-400 text-white">
  Check contrast (may not meet 4.5:1)
</button>

// ❌ Poor contrast (fails WCAG)
<p className="text-gray-400">
  Light gray text on white background (~2:1)
</p>
```

**Tools**:
- Chrome DevTools Color Picker (shows contrast ratio)
- WebAIM Contrast Checker: https://webaim.org/resources/contrastchecker/
- Axe DevTools browser extension

## Focus Indicators

Always provide visible focus indicators. Use `focus-visible:` for keyboard-only focus (not mouse clicks). Tailwind pattern: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.

## Error Handling

```typescript
// Error announcements with aria-live
export const FormField = ({ error, ...props }: FormFieldProps) => (
  <div>
    <input
      aria-invalid={!!error}
      aria-describedby={error ? `${props.id}-error` : undefined}
      {...props}
    />
    {error && (
      <p
        id={`${props.id}-error`}
        role="alert"
        aria-live="assertive"
        className="text-destructive text-sm mt-1"
      >
        {error}
      </p>
    )}
  </div>
);

// Form-level error summary
<div role="alert" aria-live="assertive" className="mb-4 p-4 border border-destructive bg-destructive/10">
  <h2 className="text-lg font-semibold mb-2">There are {errors.length} errors:</h2>
  <ul className="list-disc list-inside">
    {errors.map((error, index) => (
      <li key={index}>
        <a href={`#${error.fieldId}`} className="text-destructive underline">
          {error.message}
        </a>
      </li>
    ))}
  </ul>
</div>
```

## Loading States

```typescript
// Loading with aria-busy and announcement
export const LoadingButton = ({ loading, children, ...props }: LoadingButtonProps) => (
  <>
    <button aria-busy={loading} disabled={loading} {...props}>
      {loading ? (
        <>
          <SpinnerIcon className="animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading, please wait...</span>
        </>
      ) : (
        children
      )}
    </button>
    {loading && (
      <div aria-live="polite" className="sr-only">
        Loading, please wait...
      </div>
    )}
  </>
);

// Loading overlay
<div role="status" aria-live="polite" aria-busy="true">
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
    <div className="bg-background p-6 rounded-lg">
      <SpinnerIcon className="animate-spin h-8 w-8" />
      <p className="mt-2">Loading medications...</p>
    </div>
  </div>
  <span className="sr-only">Loading medications, please wait...</span>
</div>
```

## Testing Accessibility

### Manual Testing Checklist

1. **Keyboard Navigation**
   - [ ] Tab through all interactive elements
   - [ ] Shift+Tab navigates backwards
   - [ ] Enter/Space activates buttons
   - [ ] Escape closes modals/dialogs
   - [ ] Arrow keys navigate lists/menus

2. **Screen Reader Testing**
   - [ ] Test with NVDA (Windows, free)
   - [ ] Test with JAWS (Windows, paid)
   - [ ] Test with VoiceOver (Mac, built-in)
   - [ ] All images have alt text
   - [ ] Form labels are announced
   - [ ] Error messages are announced

3. **Focus Management**
   - [ ] Focus indicators are visible
   - [ ] Focus moves logically through page
   - [ ] Focus trapped in modals
   - [ ] Focus returns after closing dialogs

4. **Color Contrast**
   - [ ] Text meets 4.5:1 ratio
   - [ ] Large text meets 3:1 ratio
   - [ ] UI components meet 3:1 ratio
   - [ ] Focus indicators are visible

5. **Zoom/Magnification**
   - [ ] Page usable at 200% zoom
   - [ ] No horizontal scrolling at 200% zoom
   - [ ] Text reflows properly

### Automated Testing

```bash
# Run axe accessibility tests
npm run test:a11y

# Lighthouse accessibility audit
lighthouse https://localhost:5173 --only-categories=accessibility

# Pa11y automated testing
pa11y http://localhost:5173
```

### Playwright Accessibility Testing

```typescript
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("should not have accessibility violations", async ({ page }) => {
  await page.goto("http://localhost:5173/medications");

  const accessibilityScanResults = await new AxeBuilder({ page }).analyze();

  expect(accessibilityScanResults.violations).toEqual([]);
});

test("keyboard navigation works", async ({ page }) => {
  await page.goto("http://localhost:5173/medications");

  // Tab to first button
  await page.keyboard.press("Tab");
  const firstButton = page.locator("button:focus");
  await expect(firstButton).toHaveText("Add Medication");

  // Enter activates button
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();

  // Escape closes dialog
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
```

## Best Practices

1. **Semantic HTML first**: Use `<button>`, `<nav>`, `<main>`, not `<div role="button">`
2. **Radix UI handles a11y**: Radix components have built-in accessibility
3. **Always add aria-label to icon-only buttons**: Screen readers need text
4. **Use focus-visible, not focus**: Only show focus for keyboard users
5. **Announce dynamic changes**: Use `aria-live` for loading/error states
6. **Test with real screen readers**: Automated tools miss 30-40% of issues
7. **Never use setTimeout for focus**: Use `useEffect` with refs
8. **Check color contrast**: Use browser DevTools or online checkers
9. **Support keyboard navigation**: Tab, Enter, Space, Escape, Arrow keys
10. **Error messages with role="alert"**: Ensures screen reader announcement

## Additional Resources

- WCAG 2.1 Guidelines: https://www.w3.org/WAI/WCAG21/quickref/
- ARIA Authoring Practices: https://www.w3.org/WAI/ARIA/apg/
- WebAIM Resources: https://webaim.org/resources/
- Axe DevTools: https://www.deque.com/axe/devtools/
- NVDA Screen Reader: https://www.nvaccess.org/download/
