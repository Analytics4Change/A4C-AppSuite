# Testing Strategies

## Overview

A4C-AppSuite uses Vitest for unit testing and Playwright for E2E testing. This document covers testing strategies for React components with MobX, accessibility testing, and async state management.

**Testing Stack:**
- Vitest - Unit and integration tests
- Playwright - E2E browser testing
- React Testing Library - Component testing utilities
- Axe - Accessibility testing

## Common Imports

```typescript
// Vitest
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// React Testing Library
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Playwright
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
```

## Unit Testing with Vitest

### Testing React Components

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./button";

describe("Button", () => {
  it("should render button text", () => {
    render(<Button>Click Me</Button>);
    expect(screen.getByText("Click Me")).toBeInTheDocument();
  });

  it("should apply variant classes", () => {
    render(<Button variant="destructive">Delete</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("bg-destructive");
  });

  it("should handle click events", async () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click</Button>);

    const button = screen.getByRole("button");
    await userEvent.click(button);

    expect(handleClick).toHaveBeenCalledOnce();
  });

  it("should be disabled when disabled prop is true", () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
```

### Testing MobX Stores

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { MedicationStore } from "./MedicationStore";

describe("MedicationStore", () => {
  let store: MedicationStore;

  beforeEach(() => {
    store = new MedicationStore();
  });

  it("should start with empty medications", () => {
    expect(store.medications).toHaveLength(0);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it("should add medication", () => {
    const medication = { id: "1", name: "Aspirin", dosage: "81mg" };
    store.addMedication(medication);

    expect(store.medications).toHaveLength(1);
    expect(store.medications[0]).toEqual(medication);
  });

  it("should remove medication", () => {
    store.addMedication({ id: "1", name: "Aspirin", dosage: "81mg" });
    store.addMedication({ id: "2", name: "Ibuprofen", dosage: "200mg" });

    store.removeMedication("1");

    expect(store.medications).toHaveLength(1);
    expect(store.medications[0].id).toBe("2");
  });

  it("should compute active medications", () => {
    store.addMedication({ id: "1", name: "Aspirin", status: "active" });
    store.addMedication({ id: "2", name: "Ibuprofen", status: "inactive" });
    store.addMedication({ id: "3", name: "Tylenol", status: "active" });

    expect(store.activeMedications).toHaveLength(2);
    expect(store.activeMedications.map(m => m.id)).toEqual(["1", "3"]);
  });
});
```

### Testing Async Actions

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MedicationStore } from "./MedicationStore";
import * as api from "@/lib/api";

// Mock API module
vi.mock("@/lib/api");

describe("MedicationStore async actions", () => {
  let store: MedicationStore;

  beforeEach(() => {
    store = new MedicationStore();
    vi.clearAllMocks();
  });

  it("should load medications successfully", async () => {
    const mockMedications = [
      { id: "1", name: "Aspirin", dosage: "81mg" },
      { id: "2", name: "Ibuprofen", dosage: "200mg" }
    ];

    vi.spyOn(api, "get").mockResolvedValueOnce({ data: mockMedications });

    expect(store.loading).toBe(false);

    const promise = store.loadMedications();
    expect(store.loading).toBe(true);

    await promise;

    expect(store.loading).toBe(false);
    expect(store.medications).toEqual(mockMedications);
    expect(store.error).toBeNull();
  });

  it("should handle load error", async () => {
    const errorMessage = "Network error";
    vi.spyOn(api, "get").mockRejectedValueOnce(new Error(errorMessage));

    await store.loadMedications();

    expect(store.loading).toBe(false);
    expect(store.medications).toHaveLength(0);
    expect(store.error).toBe(errorMessage);
  });
});
```

### Testing Components with MobX

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MedicationList } from "./MedicationList";
import { MedicationStore } from "@/stores/MedicationStore";
import { MedicationStoreContext } from "@/stores/context";

describe("MedicationList", () => {
  let store: MedicationStore;

  beforeEach(() => {
    store = new MedicationStore();
  });

  const renderWithStore = (component: React.ReactNode) => {
    return render(
      <MedicationStoreContext.Provider value={store}>
        {component}
      </MedicationStoreContext.Provider>
    );
  };

  it("should display medications", () => {
    store.addMedication({ id: "1", name: "Aspirin", dosage: "81mg" });
    store.addMedication({ id: "2", name: "Ibuprofen", dosage: "200mg" });

    renderWithStore(<MedicationList />);

    expect(screen.getByText("Aspirin")).toBeInTheDocument();
    expect(screen.getByText("Ibuprofen")).toBeInTheDocument();
  });

  it("should show loading state", () => {
    store.loading = true;

    renderWithStore(<MedicationList />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("should show error message", () => {
    store.error = "Failed to load medications";

    renderWithStore(<MedicationList />);

    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
  });

  it("should handle delete action", async () => {
    store.addMedication({ id: "1", name: "Aspirin", dosage: "81mg" });

    renderWithStore(<MedicationList />);

    const deleteButton = screen.getByRole("button", { name: /delete/i });
    await userEvent.click(deleteButton);

    expect(store.medications).toHaveLength(0);
  });
});
```

## E2E Testing with Playwright

### Basic E2E Test

```typescript
import { test, expect } from "@playwright/test";

test.describe("Medication Management", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:5173/medications");
  });

  test("should display medications list", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /medications/i })).toBeVisible();
    await expect(page.getByRole("list")).toBeVisible();
  });

  test("should add new medication", async ({ page }) => {
    await page.click('button:has-text("Add Medication")');

    await page.fill('input[name="name"]', "Aspirin");
    await page.fill('input[name="dosage"]', "81mg");
    await page.click('button[type="submit"]');

    await expect(page.getByText("Aspirin")).toBeVisible();
  });

  test("should delete medication", async ({ page }) => {
    // Ensure there's at least one medication
    await page.click('button:has-text("Add Medication")');
    await page.fill('input[name="name"]', "Test Med");
    await page.fill('input[name="dosage"]', "100mg");
    await page.click('button[type="submit"]');

    // Delete it
    await page.click('button[aria-label="Delete medication"]');
    await page.click('button:has-text("Confirm")');

    await expect(page.getByText("Test Med")).not.toBeVisible();
  });
});
```

### Testing Authentication

```typescript
import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("should sign in with mock provider", async ({ page }) => {
    await page.goto("http://localhost:5173/login");

    await page.fill('input[type="email"]', "admin@example.com");
    await page.fill('input[type="password"]', "password");
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(/welcome/i)).toBeVisible();
  });

  test("should sign out", async ({ page }) => {
    // Sign in first
    await page.goto("http://localhost:5173/login");
    await page.fill('input[type="email"]', "admin@example.com");
    await page.fill('input[type="password"]', "password");
    await page.click('button[type="submit"]');

    // Sign out
    await page.click('button[aria-label="User menu"]');
    await page.click('button:has-text("Sign Out")');

    await expect(page).toHaveURL(/\/login/);
  });

  test("should redirect to login when not authenticated", async ({ page }) => {
    await page.goto("http://localhost:5173/medications");
    await expect(page).toHaveURL(/\/login/);
  });
});
```

### Testing Accessibility

```typescript
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Accessibility", () => {
  test("should not have accessibility violations", async ({ page }) => {
    await page.goto("http://localhost:5173/medications");

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("keyboard navigation works", async ({ page }) => {
    await page.goto("http://localhost:5173/medications");

    // Tab to first interactive element
    await page.keyboard.press("Tab");
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedElement).toBe("BUTTON");

    // Enter activates button
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();

    // Escape closes dialog
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("screen reader announcements work", async ({ page }) => {
    await page.goto("http://localhost:5173/medications");

    // Check for aria-live regions
    const liveRegion = page.locator('[aria-live]');
    await expect(liveRegion).toBeAttached();

    // Trigger action that should announce
    await page.click('button:has-text("Add Medication")');

    // Check announcement was made
    await expect(page.locator('[aria-live="polite"]')).toHaveText(/medication added/i);
  });
});
```

## Testing Patterns

### Testing Loading States

```typescript
it("should show loading indicator", async () => {
  store.loading = true;
  render(<MedicationList />, { wrapper: StoreProvider });

  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.getByText(/loading/i)).toBeInTheDocument();
});

it("should hide loading after data loads", async () => {
  renderWithStore(<MedicationList />);

  // Start loading
  store.loading = true;
  await waitFor(() => {
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  // Finish loading
  store.loading = false;
  store.medications = [{ id: "1", name: "Aspirin", dosage: "81mg" }];

  await waitFor(() => {
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("Aspirin")).toBeInTheDocument();
  });
});
```

### Testing Error States

```typescript
it("should display error message", () => {
  store.error = "Failed to load medications";
  renderWithStore(<MedicationList />);

  expect(screen.getByRole("alert")).toHaveTextContent(/failed to load/i);
});

it("should allow error retry", async () => {
  const loadMedications = vi.spyOn(store, "loadMedications");
  store.error = "Network error";

  renderWithStore(<MedicationList />);

  const retryButton = screen.getByRole("button", { name: /retry/i });
  await userEvent.click(retryButton);

  expect(loadMedications).toHaveBeenCalled();
});
```

### Testing Forms

Test validation errors by submitting empty forms. Test successful submission by filling fields and checking handleSubmit was called with correct data.

### Testing Modals/Dialogs

```typescript
it("should open and close dialog", async () => {
  render(<MedicationDialog />);

  // Dialog closed initially
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  // Open dialog
  await userEvent.click(screen.getByRole("button", { name: /open/i }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();

  // Close dialog with button
  await userEvent.click(screen.getByRole("button", { name: /close/i }));
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

it("should close dialog with Escape key", async () => {
  render(<MedicationDialog />);

  await userEvent.click(screen.getByRole("button", { name: /open/i }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();

  await userEvent.keyboard("{Escape}");
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
```

## Best Practices

1. **Test behavior, not implementation**: Focus on what users see and do
2. **Use screen.getByRole**: More accessible and resilient than getByTestId
3. **Mock external dependencies**: API calls, localStorage, external services
4. **Test loading and error states**: Don't just test happy path
5. **Use waitFor for async**: Always await async state changes
6. **Test accessibility**: Include axe tests for every page
7. **Test keyboard navigation**: Tab, Enter, Escape, Arrow keys
8. **User-centric queries**: getByRole, getByLabelText, getByText (in that order)
9. **Clean up after tests**: Use beforeEach/afterEach for store resets
10. **E2E for critical flows**: Authentication, data creation, checkout

## Running Tests

```bash
# Unit tests
npm run test                # Run all tests
npm run test:watch          # Watch mode
npm run test:coverage       # Coverage report

# E2E tests
npm run test:e2e            # Run Playwright tests
npm run test:e2e:ui         # Interactive UI mode
npm run test:e2e:debug      # Debug mode

# Accessibility tests
npm run test:a11y           # Run axe tests
```

## Additional Resources

- Vitest Documentation: https://vitest.dev/
- React Testing Library: https://testing-library.com/react
- Playwright Documentation: https://playwright.dev/
- Axe Accessibility Testing: https://www.deque.com/axe/
