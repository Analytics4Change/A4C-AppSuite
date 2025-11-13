---
status: current
last_updated: 2025-01-13
---

# MobX Integration Patterns

## Overview

This document outlines proven patterns for integrating MobX with React in the A4C-FrontEnd application, covering state management architecture, component integration strategies, and advanced reactive patterns.

## Core Integration Patterns

### 1. ViewModel Provider Pattern

Establish a consistent way to provide ViewModels to component trees:

```typescript
// ViewModelContext.tsx
import { createContext, useContext } from 'react';
import { MedicationViewModel } from '@/viewModels/MedicationViewModel';

const MedicationViewModelContext = createContext<MedicationViewModel | null>(null);

export const MedicationViewModelProvider = ({ children }: { children: React.ReactNode }) => {
  const viewModel = useMemo(() => new MedicationViewModel(), []);
  
  useEffect(() => {
    return () => viewModel.dispose();
  }, [viewModel]);
  
  return (
    <MedicationViewModelContext.Provider value={viewModel}>
      {children}
    </MedicationViewModelContext.Provider>
  );
};

export const useMedicationViewModel = () => {
  const viewModel = useContext(MedicationViewModelContext);
  if (!viewModel) {
    throw new Error('useMedicationViewModel must be used within MedicationViewModelProvider');
  }
  return viewModel;
};
```

### 2. Observer Component Pattern

Consistent patterns for creating reactive components:

```typescript
// Basic observer pattern
const MedicationCard = observer(({ medicationId }: { medicationId: string }) => {
  const vm = useMedicationViewModel();
  const medication = vm.getMedication(medicationId);
  
  if (!medication) return null;
  
  return (
    <div className="medication-card">
      <h3>{medication.name}</h3>
      <p>Dosage: {medication.dosage}</p>
      <button onClick={() => vm.selectMedication(medication.id)}>
        Select
      </button>
    </div>
  );
});

// Observer with local state pattern
const MedicationSearchInput = observer(() => {
  const vm = useMedicationViewModel();
  const [localValue, setLocalValue] = useState(vm.searchTerm);
  
  // Debounce pattern with MobX
  useEffect(() => {
    const timer = setTimeout(() => {
      vm.setSearchTerm(localValue);
    }, 300);
    
    return () => clearTimeout(timer);
  }, [localValue, vm]);
  
  return (
    <input
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      placeholder="Search medications..."
    />
  );
});
```

### 3. Computed Selector Pattern

Use computed values for efficient data selection:

```typescript
class MedicationViewModel {
  @observable medications: Medication[] = [];
  @observable searchFilters = {
    term: '',
    category: '',
    dosageForm: ''
  };
  
  // ✅ Computed selector with multiple filters
  @computed
  get filteredMedications() {
    return this.medications.filter(med => {
      const matchesTerm = !this.searchFilters.term || 
        med.name.toLowerCase().includes(this.searchFilters.term.toLowerCase());
      
      const matchesCategory = !this.searchFilters.category || 
        med.category === this.searchFilters.category;
      
      const matchesDosageForm = !this.searchFilters.dosageForm || 
        med.dosageForm === this.searchFilters.dosageForm;
      
      return matchesTerm && matchesCategory && matchesDosageForm;
    });
  }
  
  // ✅ Computed selector with pagination
  @computed
  get paginatedMedications() {
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    return this.filteredMedications.slice(start, end);
  }
  
  // ✅ Computed metadata
  @computed
  get searchMetadata() {
    return {
      totalResults: this.filteredMedications.length,
      currentPage: this.currentPage,
      totalPages: Math.ceil(this.filteredMedications.length / this.pageSize),
      hasNextPage: this.currentPage < Math.ceil(this.filteredMedications.length / this.pageSize),
      hasPreviousPage: this.currentPage > 1
    };
  }
}
```

## Advanced Patterns

### 1. Reaction-Based Side Effects

Use reactions for handling side effects in response to state changes:

```typescript
class MedicationViewModel {
  private disposers: (() => void)[] = [];
  
  constructor() {
    this.setupReactions();
  }
  
  private setupReactions() {
    // Auto-save pattern
    this.disposers.push(
      reaction(
        () => this.selectedMedication,
        (medication) => {
          if (medication) {
            this.saveToLocalStorage('selectedMedication', medication.id);
          }
        },
        { delay: 1000 } // Debounce saves
      )
    );
    
    // Validation reaction
    this.disposers.push(
      reaction(
        () => this.dosageForm,
        (form) => {
          this.validateDosageForm(form);
        }
      )
    );
    
    // Analytics reaction
    this.disposers.push(
      reaction(
        () => this.searchFilters.term,
        (searchTerm) => {
          if (searchTerm.length >= 3) {
            this.analytics.trackSearch(searchTerm);
          }
        },
        { delay: 500 }
      )
    );
  }
  
  dispose() {
    this.disposers.forEach(dispose => dispose());
    this.disposers = [];
  }
}
```

### 2. Command Pattern with Actions

Implement command pattern for complex operations:

```typescript
interface Command {
  execute(): Promise<void>;
  undo(): Promise<void>;
  canUndo(): boolean;
}

class AddMedicationCommand implements Command {
  constructor(
    private viewModel: MedicationViewModel,
    private medication: Medication
  ) {}
  
  async execute() {
    await this.viewModel.addMedication(this.medication);
  }
  
  async undo() {
    await this.viewModel.removeMedication(this.medication.id);
  }
  
  canUndo() {
    return this.viewModel.medications.some(m => m.id === this.medication.id);
  }
}

class CommandManager {
  @observable private history: Command[] = [];
  @observable private currentIndex = -1;
  
  @computed
  get canUndo() {
    return this.currentIndex >= 0;
  }
  
  @computed
  get canRedo() {
    return this.currentIndex < this.history.length - 1;
  }
  
  @action
  async executeCommand(command: Command) {
    await command.execute();
    
    // Remove any commands after current index (redo history)
    this.history = this.history.slice(0, this.currentIndex + 1);
    this.history.push(command);
    this.currentIndex++;
  }
  
  @action
  async undo() {
    if (!this.canUndo) return;
    
    const command = this.history[this.currentIndex];
    await command.undo();
    this.currentIndex--;
  }
}
```

### 3. State Machine Pattern

Implement state machines with MobX for complex workflows:

```typescript
enum PrescriptionState {
  DRAFT = 'draft',
  REVIEWING = 'reviewing',
  APPROVED = 'approved',
  DISPENSED = 'dispensed',
  CANCELLED = 'cancelled'
}

interface StateTransition {
  from: PrescriptionState;
  to: PrescriptionState;
  condition?: () => boolean;
  action?: () => Promise<void>;
}

class PrescriptionStateMachine {
  @observable currentState = PrescriptionState.DRAFT;
  
  private transitions: StateTransition[] = [
    {
      from: PrescriptionState.DRAFT,
      to: PrescriptionState.REVIEWING,
      condition: () => this.isValidForReview(),
      action: () => this.submitForReview()
    },
    {
      from: PrescriptionState.REVIEWING,
      to: PrescriptionState.APPROVED,
      action: () => this.sendApprovalNotification()
    },
    {
      from: PrescriptionState.APPROVED,
      to: PrescriptionState.DISPENSED,
      action: () => this.recordDispensing()
    }
  ];
  
  @computed
  get availableTransitions() {
    return this.transitions
      .filter(t => t.from === this.currentState)
      .filter(t => !t.condition || t.condition());
  }
  
  @action
  async transitionTo(targetState: PrescriptionState) {
    const transition = this.transitions.find(
      t => t.from === this.currentState && t.to === targetState
    );
    
    if (!transition) {
      throw new Error(`Invalid transition from ${this.currentState} to ${targetState}`);
    }
    
    if (transition.condition && !transition.condition()) {
      throw new Error(`Transition condition not met`);
    }
    
    if (transition.action) {
      await transition.action();
    }
    
    this.currentState = targetState;
  }
}
```

## Form Handling Patterns

### 1. Observable Form State

```typescript
class FormViewModel {
  @observable values = new Map<string, any>();
  @observable errors = new Map<string, string>();
  @observable touched = new Set<string>();
  @observable isSubmitting = false;
  
  @action
  setValue(field: string, value: any) {
    this.values.set(field, value);
    this.validateField(field);
  }
  
  @action
  setTouched(field: string) {
    this.touched.add(field);
  }
  
  @computed
  get isValid() {
    return this.errors.size === 0;
  }
  
  @computed
  get formData() {
    return Object.fromEntries(this.values);
  }
  
  @action
  private validateField(field: string) {
    const value = this.values.get(field);
    const validator = this.validators.get(field);
    
    if (validator) {
      const error = validator(value);
      if (error) {
        this.errors.set(field, error);
      } else {
        this.errors.delete(field);
      }
    }
  }
  
  @action
  async submit() {
    if (!this.isValid) return;
    
    this.isSubmitting = true;
    
    try {
      await this.onSubmit(this.formData);
      this.reset();
    } catch (error) {
      this.handleSubmitError(error);
    } finally {
      this.isSubmitting = false;
    }
  }
}
```

### 2. Form Component Integration

```typescript
const FormField = observer(({ 
  name, 
  label, 
  type = 'text',
  viewModel 
}: {
  name: string;
  label: string;
  type?: string;
  viewModel: FormViewModel;
}) => {
  const value = viewModel.values.get(name) || '';
  const error = viewModel.errors.get(name);
  const isTouched = viewModel.touched.has(name);
  
  return (
    <div className="form-field">
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        type={type}
        value={value}
        onChange={(e) => viewModel.setValue(name, e.target.value)}
        onBlur={() => viewModel.setTouched(name)}
        className={error && isTouched ? 'error' : ''}
      />
      {error && isTouched && (
        <span className="error-message">{error}</span>
      )}
    </div>
  );
});
```

## Error Handling Patterns

### 1. Global Error State

```typescript
class ErrorManager {
  @observable errors = new Map<string, AppError>();
  @observable notifications: Notification[] = [];
  
  @action
  addError(id: string, error: AppError) {
    this.errors.set(id, error);
    
    if (error.severity === 'critical') {
      this.addNotification({
        type: 'error',
        message: error.message,
        duration: 0 // Persistent
      });
    }
  }
  
  @action
  clearError(id: string) {
    this.errors.delete(id);
  }
  
  @action
  addNotification(notification: Notification) {
    this.notifications.push({
      ...notification,
      id: Math.random().toString(),
      timestamp: Date.now()
    });
    
    if (notification.duration && notification.duration > 0) {
      setTimeout(() => {
        this.removeNotification(notification.id);
      }, notification.duration);
    }
  }
  
  @computed
  get criticalErrors() {
    return Array.from(this.errors.values())
      .filter(error => error.severity === 'critical');
  }
}
```

## Testing Patterns

### 1. ViewModel Testing Setup

```typescript
// test-utils/viewmodel-setup.ts
export function createTestViewModel<T>(
  ViewModelClass: new (...args: any[]) => T,
  dependencies: any = {}
): T {
  const mockDependencies = {
    api: createMockApi(),
    analytics: createMockAnalytics(),
    storage: createMockStorage(),
    ...dependencies
  };
  
  return new ViewModelClass(mockDependencies);
}

export function observeChanges<T>(
  target: T,
  property: keyof T,
  callback: (newValue: any, oldValue: any) => void
) {
  return reaction(
    () => target[property],
    callback
  );
}
```

### 2. Component Testing with ViewModels

```typescript
// test-utils/render-with-viewmodel.tsx
export function renderWithViewModel<T>(
  component: React.ReactElement,
  viewModel: T,
  ContextProvider: React.ComponentType<any>
) {
  return render(
    <ContextProvider value={viewModel}>
      {component}
    </ContextProvider>
  );
}

// Usage in tests
test('medication card displays correct data', () => {
  const viewModel = createTestViewModel(MedicationViewModel);
  const medication = createMockMedication();
  
  viewModel.addMedication(medication);
  
  renderWithViewModel(
    <MedicationCard medicationId={medication.id} />,
    viewModel,
    MedicationViewModelProvider
  );
  
  expect(screen.getByText(medication.name)).toBeInTheDocument();
});
```

## Best Practices

### 1. Dependency Injection

```typescript
interface ViewModelDependencies {
  api: ApiService;
  analytics: AnalyticsService;
  storage: StorageService;
}

class MedicationViewModel {
  constructor(private deps: ViewModelDependencies) {
    this.setupReactions();
  }
  
  @action
  async loadMedications() {
    const medications = await this.deps.api.getMedications();
    this.medications = medications;
    this.deps.analytics.track('medications_loaded', { count: medications.length });
  }
}

// DI Container
const createMedicationViewModel = () => {
  return new MedicationViewModel({
    api: container.get('ApiService'),
    analytics: container.get('AnalyticsService'),
    storage: container.get('StorageService')
  });
};
```

### 2. Modular State Management

```typescript
// Split large ViewModels into smaller, focused ones
class MedicationSearchViewModel {
  @observable searchTerm = '';
  @observable results: Medication[] = [];
  
  // Search-specific logic only
}

class MedicationSelectionViewModel {
  @observable selectedMedications: Medication[] = [];
  
  // Selection-specific logic only
}

class MedicationFormViewModel {
  @observable dosageForm = new DosageForm();
  
  // Form-specific logic only
}

// Compose ViewModels
class MedicationPageViewModel {
  search = new MedicationSearchViewModel();
  selection = new MedicationSelectionViewModel();
  form = new MedicationFormViewModel();
  
  // Page-level coordination logic
}
```

## Related Documentation

- [ViewModel Testing Strategies](../testing/viewmodel-testing.md)
- [Performance Optimization](../performance/mobx-optimization.md)
- [Architecture Overview](../architecture/overview.md)
- [Component Documentation](../components.md)