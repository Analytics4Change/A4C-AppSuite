# MobX State Management

## Overview

A4C-AppSuite uses MobX for reactive state management. MobX provides simple, scalable state management with automatic dependency tracking and minimal boilerplate.

**Key Concepts:**
- **Observables**: State that triggers reactions when changed
- **Actions**: Functions that modify observable state
- **Computed**: Derived values automatically updated when dependencies change
- **Reactions**: Side effects that run when observables change
- **observer HOC**: React component wrapper that auto-tracks observables

## Common Imports

```typescript
import { makeAutoObservable, runInAction, toJS, observable, computed, action, reaction } from "mobx";
import { observer } from "mobx-react-lite";
```

## Creating Stores

### Basic Store with makeAutoObservable

```typescript
import { makeAutoObservable } from "mobx";

class MedicationStore {
  medications: Medication[] = [];
  loading = false;
  error: string | null = null;

  constructor() {
    // Makes all properties observable and all methods actions automatically
    makeAutoObservable(this);
  }

  // Computed value (automatically cached and updated)
  get activeMedications() {
    return this.medications.filter(med => med.status === "active");
  }

  get medicationCount() {
    return this.medications.length;
  }

  // Action to modify state
  async loadMedications() {
    this.loading = true;
    this.error = null;

    try {
      const response = await api.get<Medication[]>("/medications");

      // Use runInAction for async updates after await
      runInAction(() => {
        this.medications = response.data;
        this.loading = false;
      });
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : "Failed to load medications";
        this.loading = false;
      });
    }
  }

  addMedication(medication: Medication) {
    this.medications.push(medication);
  }

  removeMedication(id: string) {
    this.medications = this.medications.filter(med => med.id !== id);
  }

  updateMedication(id: string, updates: Partial<Medication>) {
    const index = this.medications.findIndex(med => med.id === id);
    if (index !== -1) {
      this.medications[index] = { ...this.medications[index], ...updates };
    }
  }
}

// Create singleton instance
export const medicationStore = new MedicationStore();
```

### Store with Explicit Annotations

```typescript
import { makeObservable, observable, computed, action } from "mobx";

class UserStore {
  user: User | null = null;
  preferences: UserPreferences = {};

  constructor() {
    // Explicit annotations for finer control
    makeObservable(this, {
      user: observable,
      preferences: observable,
      isAuthenticated: computed,
      fullName: computed,
      setUser: action,
      updatePreferences: action
    });
  }

  get isAuthenticated() {
    return this.user !== null;
  }

  get fullName() {
    return this.user ? `${this.user.firstName} ${this.user.lastName}` : "";
  }

  setUser(user: User | null) {
    this.user = user;
  }

  updatePreferences(preferences: Partial<UserPreferences>) {
    this.preferences = { ...this.preferences, ...preferences };
  }
}

export const userStore = new UserStore();
```

## Using Stores in Components

### observer HOC

**CRITICAL**: Always wrap components with `observer()` when accessing MobX observables.

```typescript
import { observer } from "mobx-react-lite";
import { medicationStore } from "@/stores/medicationStore";

// ✅ Correct: Wrapped with observer
export const MedicationList = observer(() => {
  const { medications, loading, error, loadMedications } = medicationStore;

  useEffect(() => {
    loadMedications();
  }, []);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div>
      <h2>Medications ({medications.length})</h2>
      <ul>
        {medications.map(med => (
          <li key={med.id}>{med.name}</li>
        ))}
      </ul>
    </div>
  );
});

// ❌ Wrong: Not wrapped with observer (won't react to changes)
export const MedicationList = () => {
  const { medications } = medicationStore; // Won't update!
  return <div>{medications.length}</div>;
};
```

### Context Pattern for Stores

Use React Context to provide stores to components. Create context, provider, and custom hook for type-safe access.

## Critical MobX Rules

### Never Spread Observable Arrays

**CRITICAL**: Spreading observable arrays loses reactivity. Use `.slice()` or `toJS()` instead.

```typescript
import { toJS } from "mobx";

// ❌ Wrong: Spreading loses reactivity
const itemsCopy = [...store.items]; // Not reactive!

// ✅ Correct: Use slice()
const itemsCopy = store.items.slice();

// ✅ Correct: Use toJS() for deep copy
const itemsCopy = toJS(store.items);

// ✅ Correct: Direct access (reactive)
store.items.map(item => <Item key={item.id} {...item} />)
```

### Use runInAction for Async Updates

**CRITICAL**: All state changes after `await` must be wrapped in `runInAction()`.

```typescript
// ❌ Wrong: State changes after await not wrapped
async loadData() {
  this.loading = true;
  const data = await api.get("/data");
  this.data = data; // Not properly wrapped!
  this.loading = false;
}

// ✅ Correct: Use runInAction after await
async loadData() {
  this.loading = true; // Synchronous, no runInAction needed

  try {
    const response = await api.get("/data");

    runInAction(() => {
      this.data = response.data;
      this.loading = false;
    });
  } catch (error) {
    runInAction(() => {
      this.error = error.message;
      this.loading = false;
    });
  }
}
```

### Don't Destructure Observables

Destructuring breaks reactivity. Access properties directly or use computed values.

```typescript
// ❌ Wrong: Destructuring breaks reactivity
export const UserProfile = observer(() => {
  const { firstName, lastName } = userStore.user; // Not reactive!
  return <div>{firstName} {lastName}</div>;
});

// ✅ Correct: Access directly
export const UserProfile = observer(() => {
  return <div>{userStore.user.firstName} {userStore.user.lastName}</div>;
});

// ✅ Correct: Use computed value in store
class UserStore {
  get fullName() {
    return this.user ? `${this.user.firstName} ${this.user.lastName}` : "";
  }
}

export const UserProfile = observer(() => {
  return <div>{userStore.fullName}</div>;
});
```

## Computed Values

Computed values are automatically cached and only recalculated when dependencies change.

```typescript
class CartStore {
  items: CartItem[] = [];

  constructor() {
    makeAutoObservable(this);
  }

  // Computed values
  get total() {
    return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  get itemCount() {
    return this.items.reduce((sum, item) => sum + item.quantity, 0);
  }

  get hasItems() {
    return this.items.length > 0;
  }

  // Computed with parameters (use regular method)
  getItemQuantity(productId: string) {
    const item = this.items.find(item => item.productId === productId);
    return item?.quantity ?? 0;
  }
}
```

## Reactions

Use `reaction()` to run side effects when specific observables change. Use `autorun()` to run immediately and on any tracked observable change.

## Array Methods

Observable arrays support all standard methods (`push`, `filter`, `map`, etc.) plus MobX-specific methods like `.clear()` and `.replace()`.

## Testing MobX Stores

### Unit Testing Actions

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { MedicationStore } from "./MedicationStore";

describe("MedicationStore", () => {
  let store: MedicationStore;

  beforeEach(() => {
    store = new MedicationStore();
  });

  it("should add medication", () => {
    const medication = { id: "1", name: "Aspirin", dosage: "81mg" };
    store.addMedication(medication);

    expect(store.medications.length).toBe(1);
    expect(store.medications[0]).toEqual(medication);
  });

  it("should remove medication", () => {
    store.addMedication({ id: "1", name: "Aspirin", dosage: "81mg" });
    store.addMedication({ id: "2", name: "Ibuprofen", dosage: "200mg" });

    store.removeMedication("1");

    expect(store.medications.length).toBe(1);
    expect(store.medications[0].id).toBe("2");
  });

  it("should compute active medications", () => {
    store.addMedication({ id: "1", name: "Aspirin", status: "active" });
    store.addMedication({ id: "2", name: "Ibuprofen", status: "inactive" });

    expect(store.activeMedications.length).toBe(1);
    expect(store.activeMedications[0].name).toBe("Aspirin");
  });
});
```

### Testing Components with MobX

```typescript
import { render, screen } from "@testing-library/react";
import { MedicationList } from "./MedicationList";
import { MedicationStore } from "@/stores/MedicationStore";
import { MedicationStoreContext } from "@/stores/context";

describe("MedicationList", () => {
  it("should display medications", () => {
    const store = new MedicationStore();
    store.addMedication({ id: "1", name: "Aspirin", dosage: "81mg" });
    store.addMedication({ id: "2", name: "Ibuprofen", dosage: "200mg" });

    render(
      <MedicationStoreContext.Provider value={store}>
        <MedicationList />
      </MedicationStoreContext.Provider>
    );

    expect(screen.getByText("Aspirin")).toBeInTheDocument();
    expect(screen.getByText("Ibuprofen")).toBeInTheDocument();
  });
});
```

## Common Patterns

### Loading State Pattern

```typescript
class DataStore {
  data: Data[] = [];
  loading = false;
  error: string | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  async fetchData() {
    this.loading = true;
    this.error = null;

    try {
      const response = await api.get("/data");
      runInAction(() => {
        this.data = response.data;
        this.loading = false;
      });
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : "Failed to fetch data";
        this.loading = false;
      });
    }
  }

  reset() {
    this.data = [];
    this.loading = false;
    this.error = null;
  }
}
```

### Form State Pattern

```typescript
class FormStore {
  values: Record<string, any> = {};
  errors: Record<string, string> = {};
  touched: Record<string, boolean> = {};
  submitting = false;

  constructor() {
    makeAutoObservable(this);
  }

  get isValid() {
    return Object.keys(this.errors).length === 0;
  }

  get isDirty() {
    return Object.keys(this.touched).length > 0;
  }

  setValue(field: string, value: any) {
    this.values[field] = value;
    this.touched[field] = true;
    this.validate(field);
  }

  setError(field: string, error: string) {
    this.errors[field] = error;
  }

  clearError(field: string) {
    delete this.errors[field];
  }

  validate(field: string) {
    // Validation logic
    const value = this.values[field];
    if (!value) {
      this.setError(field, "Required");
    } else {
      this.clearError(field);
    }
  }

  async submit() {
    this.submitting = true;

    try {
      await api.post("/submit", this.values);
      runInAction(() => {
        this.reset();
        this.submitting = false;
      });
    } catch (error) {
      runInAction(() => {
        this.submitting = false;
      });
    }
  }

  reset() {
    this.values = {};
    this.errors = {};
    this.touched = {};
  }
}
```

### Pagination Pattern

Track `page`, `pageSize`, `totalItems`, and `loading` as observables. Use computed values for `totalPages`, `hasNextPage`, `hasPreviousPage`.

## Best Practices

1. **Always use observer HOC**: Wrap components that access observables
2. **Use runInAction**: Wrap all async state updates after await
3. **Never spread observables**: Use `.slice()` or `toJS()` instead
4. **Don't destructure observables**: Access properties directly
5. **Use makeAutoObservable**: Simplest way to create stores
6. **Computed for derived state**: Use getters for values derived from observables
7. **Use computed over reactions**: Prefer computed values for derived state
8. **Wrap leaf components**: Apply observer to leaf components for fine-grained updates
9. **Keep stores focused**: One store per domain/feature
