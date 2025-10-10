# ViewModel Testing Strategies

## Overview

This document outlines comprehensive testing strategies for MobX ViewModels in the A4C-FrontEnd application, including unit testing patterns, integration testing approaches, and best practices for testing reactive state management.

## Testing Philosophy

ViewModels should be tested in isolation from React components to ensure business logic correctness, state management reliability, and proper reactive behavior.

## Unit Testing ViewModels

### Basic ViewModel Test Setup

```typescript
import { describe, test, expect, beforeEach } from 'vitest';
import { runInAction } from 'mobx';
import { YourViewModel } from '@/viewModels/YourViewModel';

describe('YourViewModel', () => {
  let viewModel: YourViewModel;

  beforeEach(() => {
    viewModel = new YourViewModel();
  });

  test('should initialize with default state', () => {
    expect(viewModel.isLoading).toBe(false);
    expect(viewModel.items).toEqual([]);
    expect(viewModel.error).toBeNull();
  });
});
```

### Testing Actions

```typescript
test('should handle async actions correctly', async () => {
  const mockData = [{ id: 1, name: 'Test Item' }];
  
  // Mock the service call
  vi.spyOn(viewModel.service, 'fetchItems').mockResolvedValue(mockData);
  
  await viewModel.loadItems();
  
  expect(viewModel.isLoading).toBe(false);
  expect(viewModel.items).toEqual(mockData);
  expect(viewModel.error).toBeNull();
});

test('should handle errors in actions', async () => {
  const error = new Error('Failed to load');
  vi.spyOn(viewModel.service, 'fetchItems').mockRejectedValue(error);
  
  await viewModel.loadItems();
  
  expect(viewModel.isLoading).toBe(false);
  expect(viewModel.error).toBe(error.message);
  expect(viewModel.items).toEqual([]);
});
```

### Testing Computed Values

```typescript
test('should compute filtered items correctly', () => {
  runInAction(() => {
    viewModel.items = [
      { id: 1, name: 'Apple', category: 'fruit' },
      { id: 2, name: 'Carrot', category: 'vegetable' },
      { id: 3, name: 'Banana', category: 'fruit' }
    ];
    viewModel.filterCategory = 'fruit';
  });

  expect(viewModel.filteredItems).toHaveLength(2);
  expect(viewModel.filteredItems.map(item => item.name)).toEqual(['Apple', 'Banana']);
});
```

### Testing Reactions

```typescript
import { reaction } from 'mobx';

test('should trigger reactions on state changes', () => {
  const reactionSpy = vi.fn();
  
  // Set up reaction
  const dispose = reaction(
    () => viewModel.selectedItem,
    reactionSpy
  );
  
  runInAction(() => {
    viewModel.selectedItem = { id: 1, name: 'Test' };
  });
  
  expect(reactionSpy).toHaveBeenCalledWith(
    { id: 1, name: 'Test' },
    undefined
  );
  
  dispose();
});
```

## Integration Testing

### Testing ViewModel with Components

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { observer } from 'mobx-react-lite';
import { YourViewModel } from '@/viewModels/YourViewModel';

const TestComponent = observer(({ viewModel }: { viewModel: YourViewModel }) => (
  <div>
    {viewModel.isLoading && <div>Loading...</div>}
    {viewModel.items.map(item => (
      <div key={item.id}>{item.name}</div>
    ))}
  </div>
));

test('should update UI when ViewModel state changes', async () => {
  const viewModel = new YourViewModel();
  render(<TestComponent viewModel={viewModel} />);
  
  expect(screen.getByText('Loading...')).toBeInTheDocument();
  
  await waitFor(() => {
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });
});
```

## Testing Patterns

### Mock External Dependencies

```typescript
// Mock API services
vi.mock('@/services/ApiService', () => ({
  ApiService: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn()
  }
}));

// Mock utility functions
vi.mock('@/utils/helpers', () => ({
  formatDate: vi.fn(date => date.toISOString()),
  validateInput: vi.fn(() => true)
}));
```

### Testing Disposal and Memory Leaks

```typescript
test('should dispose properly and prevent memory leaks', () => {
  const disposeSpy = vi.fn();
  viewModel.disposers = [disposeSpy];
  
  viewModel.dispose();
  
  expect(disposeSpy).toHaveBeenCalled();
  expect(viewModel.disposers).toEqual([]);
});
```

### Testing Error Boundaries with ViewModels

```typescript
test('should handle ViewModel errors in components', () => {
  const errorViewModel = new YourViewModel();
  vi.spyOn(errorViewModel, 'loadItems').mockImplementation(() => {
    throw new Error('ViewModel error');
  });
  
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  
  render(
    <ErrorBoundary>
      <TestComponent viewModel={errorViewModel} />
    </ErrorBoundary>
  );
  
  expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
  consoleSpy.mockRestore();
});
```

## Best Practices

### 1. Test in Isolation

- Test ViewModels independently of React components
- Mock external dependencies (API services, utilities)
- Focus on business logic and state management

### 2. Use runInAction for State Changes

```typescript
test('should update multiple properties atomically', () => {
  runInAction(() => {
    viewModel.property1 = 'value1';
    viewModel.property2 = 'value2';
  });
  
  // Both properties updated in single transaction
  expect(viewModel.property1).toBe('value1');
  expect(viewModel.property2).toBe('value2');
});
```

### 3. Test Observable Arrays Properly

```typescript
test('should handle array operations correctly', () => {
  runInAction(() => {
    viewModel.items.push({ id: 1, name: 'New Item' });
  });
  
  expect(viewModel.items).toHaveLength(1);
  expect(viewModel.items[0]).toEqual({ id: 1, name: 'New Item' });
});
```

### 4. Clean Up After Tests

```typescript
afterEach(() => {
  viewModel.dispose();
  vi.clearAllMocks();
});
```

## Common Pitfalls

### 1. Testing Non-Observable Properties

```typescript
// ❌ Wrong - testing non-observable property
test('should update property', () => {
  viewModel.nonObservableProperty = 'new value';
  // This won't trigger reactions
});

// ✅ Correct - make sure property is observable
test('should update observable property', () => {
  runInAction(() => {
    viewModel.observableProperty = 'new value';
  });
  // This will trigger reactions properly
});
```

### 2. Forgetting to Dispose

```typescript
// ❌ Wrong - memory leak
test('should test ViewModel', () => {
  const vm = new YourViewModel();
  // ... test code
  // Missing disposal
});

// ✅ Correct - proper cleanup
test('should test ViewModel', () => {
  const vm = new YourViewModel();
  // ... test code
  vm.dispose();
});
```

### 3. Not Using Observer for Components

```typescript
// ❌ Wrong - component won't react to changes
const TestComponent = ({ viewModel }) => (
  <div>{viewModel.value}</div>
);

// ✅ Correct - component reacts to observable changes
const TestComponent = observer(({ viewModel }) => (
  <div>{viewModel.value}</div>
));
```

## Testing Tools and Utilities

### Custom Test Utilities

```typescript
// test-utils.ts
export function createMockViewModel(overrides = {}) {
  return {
    isLoading: false,
    items: [],
    error: null,
    loadItems: vi.fn(),
    dispose: vi.fn(),
    ...overrides
  };
}

export function waitForViewModel(viewModel, condition, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const dispose = reaction(
      () => condition(viewModel),
      (result) => {
        if (result) {
          dispose();
          resolve(result);
        }
      }
    );
    
    setTimeout(() => {
      dispose();
      reject(new Error('Timeout waiting for ViewModel condition'));
    }, timeout);
  });
}
```

## Related Documentation

- [MobX Integration Patterns](../strategy/mobx-patterns.md)
- [Component Testing Guide](../TESTING.md)
- [Performance Optimization](../performance/mobx-optimization.md)
- [Architecture Overview](../architecture/overview.md)