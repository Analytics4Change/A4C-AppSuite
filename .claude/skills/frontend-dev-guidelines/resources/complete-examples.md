# Complete Examples

## Overview

This resource provides complete, real-world examples that combine Radix UI, Tailwind CSS + CVA, MobX, authentication, accessibility, and testing patterns.

Each example demonstrates:
- Component implementation with all patterns
- MobX store integration
- Accessibility features
- Testing approach

## Example 1: Medication List with CRUD Operations

### MobX Store

```typescript
// stores/MedicationStore.ts
import { makeAutoObservable, runInAction } from "mobx";

export interface Medication {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  status: "active" | "inactive";
}

export class MedicationStore {
  medications: Medication[] = [];
  loading = false;
  error: string | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  get activeMedications() {
    return this.medications.filter(m => m.status === "active");
  }

  async loadMedications() {
    this.loading = true;
    this.error = null;

    try {
      const response = await api.get<Medication[]>("/medications");
      runInAction(() => {
        this.medications = response.data;
        this.loading = false;
      });
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : "Failed to load";
        this.loading = false;
      });
    }
  }

  addMedication(medication: Medication) {
    this.medications.push(medication);
  }

  updateMedication(id: string, updates: Partial<Medication>) {
    const index = this.medications.findIndex(m => m.id === id);
    if (index !== -1) {
      this.medications[index] = { ...this.medications[index], ...updates };
    }
  }

  removeMedication(id: string) {
    this.medications = this.medications.filter(m => m.id !== id);
  }
}

export const medicationStore = new MedicationStore();
```

### Component with Radix UI

```typescript
// components/MedicationList.tsx
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMedicationStore } from "@/stores/context";
import { Button } from "@/components/ui/button";
import { Trash, Edit } from "lucide-react";

export const MedicationList = observer(() => {
  const store = useMedicationStore();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    store.loadMedications();
  }, [store]);

  if (store.loading) {
    return (
      <div role="status" aria-live="polite" className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        <span className="sr-only">Loading medications...</span>
      </div>
    );
  }

  if (store.error) {
    return (
      <div role="alert" aria-live="assertive" className="p-4 border border-destructive bg-destructive/10 rounded-md">
        <p className="text-destructive font-semibold">Error</p>
        <p>{store.error}</p>
        <Button onClick={() => store.loadMedications()} className="mt-2">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Medications ({store.activeMedications.length})</h2>
        <Button onClick={() => {/* Open add dialog */}}>
          Add Medication
        </Button>
      </div>

      {store.medications.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          No medications found. Add your first medication to get started.
        </p>
      ) : (
        <ul className="space-y-2" role="list">
          {store.medications.map((medication) => (
            <li
              key={medication.id}
              className="flex items-center justify-between p-4 border rounded-md hover:bg-accent"
            >
              <div>
                <h3 className="font-semibold">{medication.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {medication.dosage} • {medication.frequency}
                </p>
                <span
                  className={cn(
                    "inline-block px-2 py-0.5 text-xs rounded-full mt-1",
                    medication.status === "active"
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-800"
                  )}
                >
                  {medication.status}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${medication.name}`}
                  onClick={() => {/* Open edit dialog */}}
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${medication.name}`}
                  onClick={() => setDeleteId(medication.id)}
                >
                  <Trash className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog.Root open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background p-6 rounded-lg shadow-lg max-w-md">
            <Dialog.Title className="text-lg font-semibold mb-2">
              Delete Medication
            </Dialog.Title>
            <Dialog.Description className="text-muted-foreground mb-4">
              Are you sure you want to delete this medication? This action cannot be undone.
            </Dialog.Description>
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="outline">Cancel</Button>
              </Dialog.Close>
              <Button
                variant="destructive"
                onClick={() => {
                  if (deleteId) {
                    store.removeMedication(deleteId);
                    setDeleteId(null);
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
});
```

### Tests

Test loading states, error states, medication display, and delete confirmation. Mock the store and provide via context. Use `userEvent` for interactions.

## Example 2: Protected Route with Authentication

### Protected Component

```typescript
// components/ProtectedPage.tsx
import { observer } from "mobx-react-lite";
import { useAuth } from "@/providers/AuthProvider";
import { Navigate } from "react-router-dom";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredPermission?: string;
  requiredRole?: string;
}

export const ProtectedRoute = observer(({
  children,
  requiredPermission,
  requiredRole
}: ProtectedRouteProps) => {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        <span className="sr-only">Loading...</span>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (requiredPermission && !session.permissions.includes(requiredPermission)) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (requiredRole && session.user_role !== requiredRole) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
});

// Usage in router
<Route
  path="/admin"
  element={
    <ProtectedRoute requiredPermission="admin">
      <AdminDashboard />
    </ProtectedRoute>
  }
/>
```

### Sign-In Form

```typescript
// components/SignInForm.tsx
import { observer } from "mobx-react-lite";
import { useAuth } from "@/providers/AuthProvider";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export const SignInForm = observer(() => {
  const { signIn, signInWithGoogle, loading, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await signIn({ email, password });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold">Sign In</h1>

      {error && (
        <div role="alert" aria-live="assertive" className="p-3 bg-destructive/10 border border-destructive rounded-md">
          <p className="text-destructive text-sm">{error}</p>
        </div>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-2">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          aria-required="true"
          className="w-full px-3 py-2 border rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium mb-2">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          aria-required="true"
          className="w-full px-3 py-2 border rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={loading}
        aria-busy={loading}
      >
        {loading ? "Signing in..." : "Sign In"}
      </Button>

      {signInWithGoogle && (
        <>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with
              </span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={signInWithGoogle}
          >
            Sign in with Google
          </Button>
        </>
      )}
    </form>
  );
});
```

## Example 3: Form with Validation

### Form Store

Form store tracks field values, validation errors, and submission state. Use `makeAutoObservable()`, computed `isValid` getter, and individual validation methods for each field.

### Form Component

Wrap with `observer()`. Create form store with `useMemo`. On submit, validate all fields, check `isValid`, call onSubmit callback. Each field has `aria-required`, `aria-invalid`, `aria-describedby` for accessibility. Errors shown with `role="alert"`.

## Key Patterns Summary

### 1. MobX Integration
- Use `observer()` HOC on components
- Use `makeAutoObservable()` in stores
- Use `runInAction()` for async updates after await
- Never spread observable arrays

### 2. Radix UI
- Use compound components (Dialog.Root, Dialog.Content, etc.)
- Always use Portal for overlays
- Use asChild for polymorphic components

### 3. Accessibility
- Add aria-label to icon-only buttons
- Use aria-live for dynamic announcements
- Add aria-invalid and aria-describedby for form errors
- Provide loading states with role="status"

### 4. Styling
- Use CVA for variant management
- Use cn() utility to merge classes
- Apply focus-visible: for keyboard focus indicators

### 5. Testing
- Test loading, error, and success states
- Test user interactions with userEvent
- Mock MobX stores for isolation
- Test accessibility with axe

## Additional Resources

All patterns are documented in detail in their respective resource files:
- Radix UI: resources/radix-ui-patterns.md
- Tailwind + CVA: resources/tailwind-styling.md
- MobX: resources/mobx-state-management.md
- Authentication: resources/auth-provider-pattern.md
- Accessibility: resources/accessibility-standards.md
- Testing: resources/testing-strategies.md
