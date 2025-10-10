# MobX Performance Optimization

## Overview

This guide provides comprehensive strategies for optimizing MobX performance in the A4C-FrontEnd application, covering reactive state management, component rendering optimization, and memory management best practices.

## Core Optimization Principles

### 1. Minimize Observable Surface Area

Keep only necessary data observable to reduce reactive overhead:

```typescript
class OptimizedViewModel {
  // ✅ Observable data that affects UI
  @observable selectedMedication: Medication | null = null;
  @observable isLoading = false;
  
  // ❌ Avoid making internal state observable
  private internalCounter = 0; // Not observable
  
  // ✅ Use observable for UI-relevant computed values
  @computed get formattedMedication() {
    return this.selectedMedication?.name || 'None selected';
  }
}
```

### 2. Use Computed Values Efficiently

Computed values are cached and only recalculate when dependencies change:

```typescript
class PerformantSearchViewModel {
  @observable searchTerm = '';
  @observable allMedications: Medication[] = [];
  @observable selectedCategories: string[] = [];
  
  // ✅ Efficient computed - only recalculates when dependencies change
  @computed get filteredMedications() {
    if (!this.searchTerm && this.selectedCategories.length === 0) {
      return this.allMedications;
    }
    
    return this.allMedications.filter(med => 
      med.name.toLowerCase().includes(this.searchTerm.toLowerCase()) &&
      (this.selectedCategories.length === 0 || 
       this.selectedCategories.includes(med.category))
    );
  }
  
  // ❌ Avoid expensive operations in computed
  @computed get expensiveComputed() {
    // Don't do complex API calls or heavy computations here
    return this.filteredMedications.map(med => ({
      ...med,
      processedData: this.expensiveProcessing(med) // Move to action
    }));
  }
}
```

## Component Optimization

### 1. Observer Pattern Usage

```typescript
// ✅ Efficient observer usage
const MedicationCard = observer(({ medication }: { medication: Medication }) => {
  // Only re-renders when medication properties change
  return (
    <div>
      <h3>{medication.name}</h3>
      <p>{medication.dosage}</p>
    </div>
  );
});

// ❌ Avoid unnecessary observer wrapping
const StaticComponent = observer(() => {
  // This component doesn't use any observables
  return <div>Static content</div>;
});

// ✅ Better - no observer needed for static content
const StaticComponent = () => {
  return <div>Static content</div>;
};
```

### 2. Component Splitting Strategy

```typescript
// ❌ Large component observing many properties
const LargeMedicationForm = observer(() => {
  const vm = useMedicationViewModel();
  
  return (
    <div>
      <SearchSection 
        searchTerm={vm.searchTerm}
        results={vm.searchResults}
        onSearch={vm.setSearchTerm}
      />
      <FormSection 
        selectedMedication={vm.selectedMedication}
        dosageForm={vm.dosageForm}
        onFormChange={vm.updateForm}
      />
      <ResultsSection 
        prescriptions={vm.prescriptions}
        isLoading={vm.isLoading}
      />
    </div>
  );
});

// ✅ Split into smaller observer components
const SearchSection = observer(({ vm }: { vm: MedicationViewModel }) => (
  <div>
    <input 
      value={vm.searchTerm}
      onChange={e => vm.setSearchTerm(e.target.value)}
    />
    {vm.searchResults.map(result => (
      <SearchResult key={result.id} result={result} />
    ))}
  </div>
));

const FormSection = observer(({ vm }: { vm: MedicationViewModel }) => (
  <form>
    <DosageInput value={vm.dosageForm} onChange={vm.updateForm} />
  </form>
));
```

### 3. Avoiding Unnecessary Re-renders

```typescript
// ✅ Use React.memo for expensive non-observer components
const ExpensiveChart = React.memo(({ data }: { data: ChartData }) => {
  // Expensive rendering logic
  return <ComplexChart data={data} />;
});

// ✅ Optimize observer components with specific dependency tracking
const OptimizedMedicationList = observer(() => {
  const vm = useMedicationViewModel();
  
  // Only observe specific properties needed for this component
  const { filteredMedications, isLoading } = vm;
  
  if (isLoading) return <LoadingSpinner />;
  
  return (
    <div>
      {filteredMedications.map(med => (
        <MedicationCard key={med.id} medication={med} />
      ))}
    </div>
  );
});
```

## ViewModel Optimization

### 1. Efficient Action Patterns

```typescript
class OptimizedMedicationViewModel {
  @observable medications: Medication[] = [];
  @observable searchFilters = new Map<string, string>();
  
  // ✅ Batch multiple state updates
  @action
  updateSearchCriteria(term: string, category: string, dosageForm: string) {
    runInAction(() => {
      this.searchFilters.set('term', term);
      this.searchFilters.set('category', category);
      this.searchFilters.set('dosageForm', dosageForm);
    });
  }
  
  // ✅ Use runInAction for async operations
  @action
  async loadMedications() {
    this.isLoading = true;
    
    try {
      const medications = await this.api.fetchMedications();
      
      runInAction(() => {
        this.medications = medications;
        this.isLoading = false;
      });
    } catch (error) {
      runInAction(() => {
        this.error = error.message;
        this.isLoading = false;
      });
    }
  }
  
  // ❌ Avoid frequent small state updates
  @action
  updateMedicationProperty(id: string, property: string, value: string) {
    // This could cause many re-renders if called frequently
    const medication = this.medications.find(m => m.id === id);
    if (medication) {
      (medication as any)[property] = value;
    }
  }
  
  // ✅ Better - batch property updates
  @action
  updateMedication(id: string, updates: Partial<Medication>) {
    const medication = this.medications.find(m => m.id === id);
    if (medication) {
      Object.assign(medication, updates);
    }
  }
}
```

### 2. Memory Management

```typescript
class MemoryEfficientViewModel {
  @observable private _data = new Map<string, any>();
  private disposers: (() => void)[] = [];
  
  constructor() {
    // Set up reactions with proper disposal
    this.disposers.push(
      reaction(
        () => this.searchTerm,
        this.debouncedSearch,
        { delay: 300 }
      )
    );
  }
  
  // ✅ Implement proper disposal
  dispose() {
    this.disposers.forEach(dispose => dispose());
    this.disposers = [];
    this._data.clear();
  }
  
  // ✅ Use Map for large datasets instead of arrays when appropriate
  @action
  addMedication(medication: Medication) {
    this._data.set(medication.id, medication);
  }
  
  @action
  removeMedication(id: string) {
    this._data.delete(id);
  }
  
  @computed
  get medications() {
    return Array.from(this._data.values());
  }
}
```

## Advanced Optimization Techniques

### 1. Reaction Optimization

```typescript
class ReactiveViewModel {
  @observable searchTerm = '';
  @observable results: SearchResult[] = [];
  
  constructor() {
    // ✅ Use reaction with debouncing for expensive operations
    this.disposers.push(
      reaction(
        () => this.searchTerm,
        this.performSearch,
        { 
          delay: 300,
          fireImmediately: false
        }
      )
    );
    
    // ✅ Use when for conditional reactions
    this.disposers.push(
      when(
        () => this.searchTerm.length >= 3,
        () => this.enableAdvancedSearch()
      )
    );
  }
  
  @action.bound
  private async performSearch(searchTerm: string) {
    if (searchTerm.length < 2) {
      this.results = [];
      return;
    }
    
    const results = await this.searchApi.search(searchTerm);
    runInAction(() => {
      this.results = results;
    });
  }
}
```

### 2. Selective Observation

```typescript
// ✅ Use specific property observation
const MedicationName = observer(({ medication }: { medication: Medication }) => {
  // Only re-renders when medication.name changes
  return <span>{medication.name}</span>;
});

// ✅ Use computed for complex selections
class SelectiveViewModel {
  @observable medications: Medication[] = [];
  
  @computed
  get activeMedicationNames() {
    // Only recalculates when active medications change
    return this.medications
      .filter(med => med.status === 'active')
      .map(med => med.name);
  }
}
```

### 3. Transaction Optimization

```typescript
class TransactionalViewModel {
  @observable items: Item[] = [];
  @observable selectedIds: string[] = [];
  @observable filters = new Map<string, any>();
  
  // ✅ Use transaction for multiple related updates
  @action
  bulkUpdateItems(updates: Array<{ id: string; changes: Partial<Item> }>) {
    transaction(() => {
      updates.forEach(({ id, changes }) => {
        const item = this.items.find(i => i.id === id);
        if (item) {
          Object.assign(item, changes);
        }
      });
    });
  }
  
  // ✅ Use transaction for complex state changes
  @action
  resetToDefaults() {
    transaction(() => {
      this.items = [];
      this.selectedIds = [];
      this.filters.clear();
    });
  }
}
```

## Performance Monitoring

### 1. MobX DevTools Integration

```typescript
// Enable in development
if (process.env.NODE_ENV === 'development') {
  import('mobx-react-devtools').then(({ configureDevtool }) => {
    configureDevtool({
      logEnabled: true,
      updatesEnabled: true,
      logFilter: change => change.type === 'action'
    });
  });
}
```

### 2. Performance Tracking

```typescript
class MonitoredViewModel {
  @observable data: any[] = [];
  
  @action
  async loadData() {
    const startTime = performance.now();
    
    try {
      const result = await this.api.fetchData();
      
      runInAction(() => {
        this.data = result;
      });
      
      const endTime = performance.now();
      console.log(`Data loading took ${endTime - startTime}ms`);
    } catch (error) {
      console.error('Data loading failed:', error);
    }
  }
}
```

## Common Performance Anti-patterns

### 1. Excessive Observables

```typescript
// ❌ Making everything observable
class OverObservedViewModel {
  @observable timestamp = Date.now(); // Probably not needed
  @observable mousePosition = { x: 0, y: 0 }; // Too frequent updates
  @observable internalCounter = 0; // Internal state
}

// ✅ Only observe what affects UI
class EfficientViewModel {
  @observable userVisibleData: any[] = [];
  private internalState = new Map(); // Not observable
}
```

### 2. Expensive Computed Values

```typescript
// ❌ Expensive operations in computed
class InefficientViewModel {
  @observable items: Item[] = [];
  
  @computed
  get processedItems() {
    return this.items.map(item => ({
      ...item,
      expensiveCalculation: this.heavyProcessing(item), // Too expensive
      apiData: this.fetchDataForItem(item.id) // Async not allowed
    }));
  }
}

// ✅ Move expensive operations to actions
class EfficientViewModel {
  @observable items: Item[] = [];
  @observable processedData = new Map<string, ProcessedItem>();
  
  @action
  async processItem(item: Item) {
    const processed = await this.heavyProcessing(item);
    this.processedData.set(item.id, processed);
  }
  
  @computed
  get itemsWithProcessedData() {
    return this.items.map(item => ({
      ...item,
      processed: this.processedData.get(item.id)
    }));
  }
}
```

## Best Practices Summary

1. **Minimize Observable Surface**: Only make UI-relevant data observable
2. **Use Computed Efficiently**: Cache expensive calculations with computed values
3. **Batch State Updates**: Use transactions and runInAction for multiple updates
4. **Split Components**: Create smaller observer components for better granularity
5. **Dispose Properly**: Always clean up reactions and disposers
6. **Monitor Performance**: Use MobX DevTools and performance metrics
7. **Avoid Anti-patterns**: Don't over-observe or put expensive operations in computed

## Related Documentation

- [ViewModel Testing Strategies](../testing/viewmodel-testing.md)
- [MobX Integration Patterns](../strategy/mobx-patterns.md)
- [Architecture Overview](../architecture/overview.md)
- [Component Patterns](../components.md)