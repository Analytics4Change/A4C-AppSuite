# ViewModels Architecture

## Overview

The A4C-FrontEnd application uses the MVVM (Model-View-ViewModel) pattern with MobX for state management. ViewModels encapsulate business logic, state management, and data transformation, providing a clean separation between UI components and application logic.

## Architecture Principles

### MVVM Pattern Implementation

- **Models**: TypeScript interfaces and classes representing domain entities
- **Views**: React components that observe and render ViewModel state
- **ViewModels**: MobX observables that manage state and business logic

### Design Philosophy

- **Single Responsibility**: Each ViewModel handles one specific domain area
- **Observable State**: All state changes are reactive using MobX observables
- **Separation of Concerns**: Business logic separated from UI components
- **Testability**: ViewModels are easily unit testable in isolation

## Core ViewModels

### MedicationManagementViewModel

**Location**: `src/viewModels/medication/MedicationManagementViewModel.ts`

**Purpose**: Central coordinator for all medication-related operations including search, selection, dosage configuration, and form management.

**Key Responsibilities**:

- Medication search and selection
- Integration with multiple sub-ViewModels
- Form validation and submission
- API integration for medication data
- State coordination across medication workflow

**Observable State**:

```typescript
@observable selectedMedication: Medication | null
@observable searchResults: Medication[]
@observable isLoading: boolean
@observable validationErrors: ValidationErrors
@observable currentStep: MedicationFormStep
```

**Key Actions**:

- `searchMedications(query: string)`: Search for medications
- `selectMedication(medication: Medication)`: Select a medication
- `validateForm()`: Validate current form state
- `submitMedication()`: Submit medication configuration
- `resetForm()`: Reset form to initial state

### DosageTimingViewModel

**Location**: `src/viewModels/medication/DosageTimingViewModel.ts`

**Purpose**: Manages dosage timing configuration including scheduled times, PRN (as needed) settings, and custom timing requirements.

**Key Responsibilities**:

- Dosage timing selection and validation
- PRN medication configuration
- Custom timing schedule creation
- Integration with checkbox group components

**Observable State**:

```typescript
@observable selectedTimings: string[]
@observable additionalTimingData: Record<string, string>
@observable isValidConfiguration: boolean
@observable timingErrors: TimingValidationErrors
```

**Key Actions**:

- `setSelectedTimings(timings: string[])`: Update timing selections
- `setAdditionalData(key: string, value: string)`: Set additional timing data
- `validateTimingConfiguration()`: Validate timing setup
- `generateTimingSchedule()`: Create schedule from configuration

### DosageFrequencyViewModel

**Location**: `src/viewModels/medication/DosageFrequencyViewModel.ts`

**Purpose**: Handles medication frequency configuration including daily frequencies, custom schedules, and interval-based dosing.

**Key Responsibilities**:

- Frequency selection (daily, BID, TID, QID, custom)
- Interval-based dosing configuration
- Schedule validation and conflict resolution
- Integration with timing constraints

**Observable State**:

```typescript
@observable selectedFrequency: DosageFrequency
@observable customInterval: number | null
@observable frequencyUnit: TimeUnit
@observable isValidFrequency: boolean
```

**Key Actions**:

- `setFrequency(frequency: DosageFrequency)`: Set dosage frequency
- `setCustomInterval(interval: number, unit: TimeUnit)`: Configure custom frequency
- `validateFrequency()`: Validate frequency configuration
- `calculateNextDose()`: Calculate next dose timing

### SpecialRestrictionsViewModel

**Location**: `src/viewModels/medication/SpecialRestrictionsViewModel.ts`

**Purpose**: Manages special medication restrictions including controlled substance handling, psychotropic medication requirements, and regulatory compliance.

**Key Responsibilities**:

- Controlled substance classification
- Psychotropic medication handling
- Regulatory compliance checking
- Special handling requirements

**Observable State**:

```typescript
@observable isControlled: boolean | null
@observable controlledSchedule: string | null
@observable isPsychotropic: boolean | null
@observable specialRequirements: SpecialRequirement[]
@observable complianceStatus: ComplianceStatus
```

**Key Actions**:

- `checkMedicationStatus(medication: Medication)`: Verify regulatory status
- `setControlledStatus(isControlled: boolean)`: Set controlled substance status
- `setPsychotropicStatus(isPsychotropic: boolean)`: Set psychotropic status
- `validateCompliance()`: Check regulatory compliance

### FoodConditionsViewModel

**Location**: `src/viewModels/medication/FoodConditionsViewModel.ts`

**Purpose**: Handles food-related medication administration requirements including timing relative to meals, food restrictions, and dietary considerations.

**Key Responsibilities**:

- Food timing configuration (with meals, before meals, after meals)
- Dietary restriction management
- Food interaction warnings
- Nutritional consideration tracking

**Observable State**:

```typescript
@observable foodTiming: FoodTimingOption
@observable dietaryRestrictions: DietaryRestriction[]
@observable foodInteractions: FoodInteraction[]
@observable nutritionalConsiderations: string[]
```

**Key Actions**:

- `setFoodTiming(timing: FoodTimingOption)`: Configure food timing
- `addDietaryRestriction(restriction: DietaryRestriction)`: Add dietary restriction
- `checkFoodInteractions(medication: Medication)`: Check for food interactions
- `validateFoodRequirements()`: Validate food-related requirements

### ClientSelectionViewModel

**Location**: `src/viewModels/client/ClientSelectionViewModel.ts`

**Purpose**: Manages client selection and client-specific medication management including client search, selection, and context management.

**Key Responsibilities**:

- Client search and selection
- Client-specific medication history
- Permission and access control
- Client context management

**Observable State**:

```typescript
@observable selectedClient: Client | null
@observable clientSearchResults: Client[]
@observable clientMedications: Medication[]
@observable accessPermissions: ClientPermissions
@observable isLoadingClient: boolean
```

**Key Actions**:

- `searchClients(query: string)`: Search for clients
- `selectClient(client: Client)`: Select a client
- `loadClientMedications()`: Load client's medication history
- `checkClientPermissions()`: Verify access permissions

## ViewModel Integration Patterns

### Parent-Child ViewModel Relationships

```typescript
// MedicationManagementViewModel coordinates sub-ViewModels
class MedicationManagementViewModel {
  @observable dosageTimingVM: DosageTimingViewModel;
  @observable dosageFrequencyVM: DosageFrequencyViewModel;
  @observable specialRestrictionsVM: SpecialRestrictionsViewModel;
  @observable foodConditionsVM: FoodConditionsViewModel;

  constructor() {
    this.dosageTimingVM = new DosageTimingViewModel();
    this.dosageFrequencyVM = new DosageFrequencyViewModel();
    this.specialRestrictionsVM = new SpecialRestrictionsViewModel();
    this.foodConditionsVM = new FoodConditionsViewModel();
  }
}
```

### Cross-ViewModel Communication

```typescript
// ViewModels can observe each other for coordinated state changes
class MedicationManagementViewModel {
  constructor() {
    // React to timing changes to update frequency constraints
    reaction(
      () => this.dosageTimingVM.selectedTimings,
      (timings) => this.dosageFrequencyVM.updateConstraints(timings)
    );

    // React to medication changes to check restrictions
    reaction(
      () => this.selectedMedication,
      (medication) => {
        if (medication) {
          this.specialRestrictionsVM.checkMedicationStatus(medication);
          this.foodConditionsVM.checkFoodInteractions(medication);
        }
      }
    );
  }
}
```

## MobX Best Practices

### Reactive State Management

```typescript
// Always use @observable for state that should trigger re-renders
class ExampleViewModel {
  @observable counter = 0;
  @observable items: Item[] = [];
  @observable isLoading = false;

  // Use @action for state modifications
  @action
  increment() {
    this.counter++;
  }

  // Use @action for array operations
  @action
  addItem(item: Item) {
    this.items = [...this.items, item]; // Immutable update
  }

  // Use @computed for derived values
  @computed
  get itemCount() {
    return this.items.length;
  }
}
```

### Array Reactivity Guidelines

**Critical Pattern**: Never spread observable arrays in component props

```typescript
// ❌ DON'T DO THIS - Breaks MobX reactivity
<Component items={[...vm.observableArray]} />

// ✅ DO THIS - Maintains observable chain
<Component items={vm.observableArray} />
```

**ViewModel Array Updates**: Always use immutable updates

```typescript
// ❌ Mutation might not trigger reactivity
this.items.push(newItem);

// ✅ Immutable update ensures reactivity
@action
addItem(item: Item) {
  this.items = [...this.items, item];
}
```

### Error Handling in ViewModels

```typescript
class RobustViewModel {
  @observable isLoading = false;
  @observable error: string | null = null;
  @observable data: Data[] = [];

  @action
  async loadData() {
    this.isLoading = true;
    this.error = null;

    try {
      const result = await apiService.getData();
      runInAction(() => {
        this.data = result;
        this.isLoading = false;
      });
    } catch (error) {
      runInAction(() => {
        this.error = error.message;
        this.isLoading = false;
      });
    }
  }
}
```

## Testing ViewModels

### Unit Testing Patterns

```typescript
describe('MedicationManagementViewModel', () => {
  let viewModel: MedicationManagementViewModel;

  beforeEach(() => {
    viewModel = new MedicationManagementViewModel();
  });

  test('should search medications', async () => {
    const mockResults = [{ id: '1', name: 'Aspirin' }];
    jest.spyOn(medicationAPI, 'search').mockResolvedValue(mockResults);

    await viewModel.searchMedications('aspirin');

    expect(viewModel.searchResults).toEqual(mockResults);
    expect(viewModel.isLoading).toBe(false);
  });

  test('should handle search errors', async () => {
    jest.spyOn(medicationAPI, 'search').mockRejectedValue(new Error('API Error'));

    await viewModel.searchMedications('aspirin');

    expect(viewModel.error).toBe('API Error');
    expect(viewModel.searchResults).toEqual([]);
  });
});
```

### Integration Testing

```typescript
// Test ViewModel integration with React components
test('component updates when ViewModel state changes', () => {
  const viewModel = new TestViewModel();
  const { getByText } = render(
    <Provider viewModel={viewModel}>
      <TestComponent />
    </Provider>
  );

  act(() => {
    viewModel.updateCounter();
  });

  expect(getByText('Counter: 1')).toBeInTheDocument();
});
```

## Performance Considerations

### Computed Values

Use `@computed` for expensive calculations that depend on observable state:

```typescript
@computed
get expensiveCalculation() {
  // This will only re-run when dependencies change
  return this.largeDataset
    .filter(item => item.isActive)
    .map(item => ({ ...item, computed: heavyCalculation(item) }));
}
```

### Reaction Management

```typescript
class ViewModel {
  private disposers: IReactionDisposer[] = [];

  constructor() {
    // Store disposers for cleanup
    this.disposers.push(
      reaction(
        () => this.selectedItem,
        (item) => this.loadItemDetails(item)
      )
    );
  }

  dispose() {
    // Clean up reactions to prevent memory leaks
    this.disposers.forEach(dispose => dispose());
    this.disposers = [];
  }
}
```

### Memory Management

- Always dispose of ViewModels when components unmount
- Use `runInAction` for multiple state updates
- Avoid creating new ViewModels on every render
- Consider ViewModel pooling for frequently created instances

## Debugging ViewModels

### MobX Developer Tools

Enable MobX debugging in development:

```typescript
// In development configuration
import { configure } from 'mobx';

if (import.meta.env.DEV) {
  configure({
    enforceActions: 'always',
    computedRequiresReaction: true,
    reactionRequiresObservable: true,
    observableRequiresReaction: true,
    disableErrorBoundaries: true
  });
}
```

### MobX State Inspection

Use the MobXDebugger component for real-time state inspection:

```typescript
// Available in development builds
import { MobXDebugger } from '@/components/debug/MobXDebugger';

function DevelopmentApp() {
  return (
    <div>
      <App />
      {import.meta.env.DEV && <MobXDebugger />}
    </div>
  );
}
```

## Migration and Evolution

### Adding New ViewModels

1. Create ViewModel class with MobX decorators
2. Add unit tests for ViewModel logic
3. Create React components that observe the ViewModel
4. Integrate with existing ViewModel hierarchy if needed
5. Update documentation and type definitions

### Refactoring Existing ViewModels

1. Maintain backward compatibility during transition
2. Use feature flags for gradual rollout
3. Preserve existing API contracts
4. Migrate tests to new ViewModel structure
5. Update component integrations incrementally

## Best Practices Summary

1. **State Management**: Use observable state with immutable updates
2. **Actions**: Wrap state modifications in @action decorators
3. **Computed Values**: Use @computed for derived state
4. **Error Handling**: Always handle async errors gracefully
5. **Testing**: Write comprehensive unit tests for ViewModels
6. **Performance**: Use computed values and proper reaction management
7. **Memory**: Always dispose of ViewModels and reactions
8. **Debugging**: Use MobX developer tools and debugging components

## Related Documentation

- [MobX Integration Patterns](../strategy/mobx-patterns.md)
- [Component Architecture](../components.md)
- [Testing Strategies](../testing/viewmodel-testing.md)
- [Performance Optimization](../performance/mobx-optimization.md)
