---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Comprehensive API reference covering UI components (dropdowns, forms, modals), focus management system with 14 modal elements, MobX ViewModel patterns, service layer interfaces, and custom hooks for timing and keyboard navigation.

**When to read**:
- Understanding dropdown component variants and when to use each
- Implementing focus management and modal hierarchy
- Setting up MobX ViewModels with proper observable patterns
- Creating service layer interfaces for testing

**Prerequisites**: None

**Key topics**: `dropdown-components`, `focus-management`, `mobx-viewmodel`, `service-layer`, `accessibility-api`

**Estimated read time**: 25 minutes
<!-- TL;DR-END -->

# API and Component Documentation

Comprehensive reference for components, services, and API patterns in the A4C-FrontEnd application.

## Component Architecture

### UI Component Library

#### Dropdown Components

##### SearchableDropdown
**Purpose**: Real-time searchable selection from large datasets (100+ items)

```typescript
interface SearchableDropdownProps<T> {
  value: string;
  searchResults: T[];
  onSearch: (query: string) => void;
  onSelect: (item: T) => void;
  renderItem: (item: T) => ReactNode;
  placeholder?: string;
  isLoading?: boolean;
  maxHeight?: string;
}

// Usage
<SearchableDropdown
  value={searchValue}
  searchResults={medications}
  onSearch={handleSearch}
  onSelect={handleSelect}
  renderItem={(item) => <div>{item.name}</div>}
  placeholder="Search medications..."
/>
```

##### EditableDropdown
**Purpose**: Small/medium datasets that can be edited after selection

```typescript
interface EditableDropdownProps {
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  tabIndex?: number;
  required?: boolean;
  error?: string;
}

// Usage
<EditableDropdown
  id="dosage-form"
  label="Dosage Form"
  value={selectedForm}
  options={formOptions}
  onChange={setSelectedForm}
  tabIndex={5}
  required
/>
```

##### MultiSelectDropdown
**Purpose**: Multiple item selection with checkboxes

```typescript
interface MultiSelectDropdownProps {
  id: string;
  label: string;
  options: string[];
  selected: string[]; // Must be MobX observable
  onChange: (newSelection: string[]) => void;
  placeholder?: string;
  maxHeight?: string;
  disabled?: boolean;
}

// Usage - CRITICAL: Pass MobX observable directly
<MultiSelectDropdown
  id="categories"
  label="Categories"
  options={['Option 1', 'Option 2']}
  selected={vm.selectedCategories} // Observable array
  onChange={(newSelection) => vm.setCategories(newSelection)}
/>
```

##### EnhancedAutocompleteDropdown
**Purpose**: Type-ahead functionality with custom value support

```typescript
interface EnhancedAutocompleteDropdownProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  onSelect: (value: string) => void;
  allowCustomValue?: boolean;
  placeholder?: string;
  maxHeight?: string;
}

// Usage
<EnhancedAutocompleteDropdown
  options={predefinedOptions}
  value={currentValue}
  onChange={handleInputChange}
  onSelect={handleSelection}
  allowCustomValue={true}
  placeholder="Type to search or enter custom value"
/>
```

#### Form Components

##### EnhancedFocusTrappedCheckboxGroup
**Purpose**: Complex checkbox groups with focus trapping and dynamic inputs

```typescript
interface CheckboxOption {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  metadata?: Record<string, unknown>;
}

interface EnhancedFocusTrappedCheckboxGroupProps {
  id: string;
  title: string;
  checkboxes: CheckboxOption[];
  onSelectionChange: (selectedIds: string[]) => void;
  onAdditionalDataChange?: (data: Record<string, unknown>) => void;
  onContinue: () => void;
  onCancel: () => void;
  strategyType?: 'default' | 'timing' | 'custom';
}

// Usage
<EnhancedFocusTrappedCheckboxGroup
  id="dosage-timings"
  title="Dosage Timings"
  checkboxes={timingOptions}
  onSelectionChange={handleTimingChange}
  onAdditionalDataChange={handleDataChange}
  onContinue={handleContinue}
  onCancel={handleCancel}
  strategyType="timing"
/>
```

### Focus Management System

#### Complete Modal Hierarchy

The application implements a comprehensive modal system with **14 modal-like elements**:

##### Primary Modals
1. **`medication-type-modal`** (App.tsx)
   - Purpose: Initial medication type selection
   - Options: Prescribed Medication, Over-the-Counter, Dietary Supplement

2. **`medication-entry-modal`** (MedicationEntryModalRefactored.tsx)
   - Purpose: Main container for medication entry form
   - Title: "Add New Prescribed Medication"

##### Nested Dropdowns within Medication Entry Modal

3. **`medication-dropdown`** (MedicationSearchSimplified.tsx)
   - Purpose: Search results for medication names

4. **`dosage-category-dropdown`** (DosageFormSimplified.tsx)
   - Purpose: Select dosage form (Tablet, Capsule, etc.)

5. **`form-type-dropdown`** (DosageFormSimplified.tsx)
   - Purpose: Select specific form type based on category

6. **`dosage-unit-dropdown`** (DosageFormSimplified.tsx)
   - Purpose: Select unit for dosage amount (mg, ml, etc.)

7. **`total-unit-dropdown`** (DosageFormSimplified.tsx)
   - Purpose: Select unit for total amount (optional)

8. **`dosage-frequency-dropdown`** (DosageFormSimplified.tsx)
   - Purpose: Select dosage frequency (Daily, Twice daily, etc.)

9. **`dosage-condition-dropdown`** (DosageFormSimplified.tsx)
   - Purpose: Select administration condition (Morning, Evening, Bedtime, etc.)

##### Category and Date Selection

10. **`broad-categories-list`** (CategorySelectionSimplified.tsx)
    - Purpose: Select medication categories (Pain Relief, Cardiovascular, etc.)

11. **`specific-categories-list`** (CategorySelectionSimplified.tsx)
    - Purpose: Select usage categories (Chronic Condition, As Needed, etc.)

12. **`start-date-calendar`** (DateSelectionSimplified.tsx)
    - Purpose: Date picker for medication start date

13. **`discontinue-date-calendar`** (DateSelectionSimplified.tsx)
    - Purpose: Date picker for medication discontinue date (optional)

##### Extended Features

14. **Side Effects Selection Modal** (SideEffectsSelection.tsx)
    - Purpose: Select side effects with search and custom effect addition
    - Note: Includes nested "Other" modal for custom side effects

#### Focus Regions
The component uses explicit focus region tracking:

```typescript
type FocusRegion = 'header' | 'checkbox' | 'input' | 'button';

// Focus region behavior:
// - 'checkbox': Arrow keys navigate, Space toggles
// - 'input': Native input handling  
// - 'button': Standard button behavior
// - 'header': Arrow keys enter checkbox group
```

#### Keyboard Navigation Standards

```typescript
// Required keyboard support for all components:
const KEYBOARD_STANDARDS = {
  navigation: {
    'Tab': 'Forward navigation',
    'Shift+Tab': 'Backward navigation', 
    'ArrowDown': 'Next option in list',
    'ArrowUp': 'Previous option in list',
    'ArrowRight': 'Expand/enter submenu',
    'ArrowLeft': 'Collapse/exit submenu'
  },
  activation: {
    'Enter': 'Submit/confirm action',
    'Space': 'Toggle checkbox/button',
    'Escape': 'Cancel/close operation'
  },
  shortcuts: {
    'Ctrl+S': 'Save (if applicable)',
    'Ctrl+Z': 'Undo (if applicable)'
  }
};
```

### Accessibility API

#### ARIA Attributes

All components must implement required ARIA attributes:

```typescript
interface AccessibilityProps {
  // Required for interactive elements
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  
  // State attributes
  'aria-expanded'?: boolean;
  'aria-selected'?: boolean;
  'aria-disabled'?: boolean;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
  
  // Live regions
  'aria-live'?: 'polite' | 'assertive' | 'off';
  'aria-atomic'?: boolean;
  
  // Modal attributes
  'aria-modal'?: boolean;
  role?: string;
}

// Implementation example
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="modal-title"
  aria-describedby="modal-description"
>
  <h2 id="modal-title">Modal Title</h2>
  <p id="modal-description">Modal description</p>
</div>
```

#### Focus Management API

```typescript
interface FocusManagementAPI {
  // Focus utilities
  getAllFocusableElements(container: Element): Element[];
  sortByTabIndex(elements: Element[]): Element[];
  findPreviousFocusableElement(current: Element, container: Element): Element | null;
  
  // Focus advancement
  useFocusAdvancement(onAdvance: () => void): {
    handleKeyDown: (event: KeyboardEvent) => void;
    selectionMethod: 'keyboard' | 'mouse';
  };
  
  // Focus trapping
  useFocusTrap(isActive: boolean): {
    trapRef: RefObject<HTMLElement>;
    restoreFocus: () => void;
  };
}
```

## State Management API

### MobX ViewModel Pattern

```typescript
import { makeAutoObservable, runInAction } from 'mobx';

class MedicationEntryViewModel {
  selectedMedication: Medication | null = null;
  selectedCategories: string[] = [];
  searchResults: Medication[] = [];
  isLoading = false;

  constructor() {
    makeAutoObservable(this);
  }

  // ✅ CORRECT: Immutable updates
  setSelectedCategories(categories: string[]) {
    runInAction(() => {
      this.selectedCategories = [...categories];
    });
  }

  // ✅ CORRECT: Async actions with runInAction
  async searchMedications(query: string) {
    runInAction(() => {
      this.isLoading = true;
    });

    try {
      const results = await medicationService.search(query);
      runInAction(() => {
        this.searchResults = results;
        this.isLoading = false;
      });
    } catch (error) {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  // ❌ INCORRECT: Direct array mutation
  addCategory(category: string) {
    this.selectedCategories.push(category); // Breaks reactivity
  }
}
```

### Component Integration

```typescript
import { observer } from 'mobx-react-lite';

// ✅ CORRECT: Observer wrapper + direct observable
const CategorySelection = observer(({ viewModel }: { viewModel: MedicationEntryViewModel }) => {
  return (
    <MultiSelectDropdown
      selected={viewModel.selectedCategories} // Direct observable
      onChange={(categories) => viewModel.setSelectedCategories(categories)}
    />
  );
});

// ❌ INCORRECT: Array spreading breaks reactivity  
const CategorySelectionBroken = observer(({ viewModel }: { viewModel: MedicationEntryViewModel }) => {
  return (
    <MultiSelectDropdown
      selected={[...viewModel.selectedCategories]} // Breaks observable chain
      onChange={(categories) => viewModel.setSelectedCategories(categories)}
    />
  );
});
```

## Service Layer API

### API Service Interfaces

```typescript
interface MedicationService {
  search(query: string): Promise<Medication[]>;
  getById(id: string): Promise<Medication>;
  getCategories(): Promise<Category[]>;
  validateDosage(medication: Medication, dosage: Dosage): Promise<ValidationResult>;
}

interface ClientService {
  getClients(): Promise<Client[]>;
  getClientById(id: string): Promise<Client>;
  updateClientMedications(clientId: string, medications: Medication[]): Promise<void>;
}

interface ValidationService {
  validateMedicationEntry(entry: MedicationEntry): ValidationResult;
  validateDosageAmount(amount: number, unit: string): boolean;
  validateDateRange(startDate: Date, endDate?: Date): boolean;
}
```

### Mock Service Implementation

```typescript
class MockMedicationService implements MedicationService {
  private medications: Medication[] = [
    { id: 'MED001', name: 'Aspirin', strength: '325mg', form: 'Tablet' },
    { id: 'MED002', name: 'Lorazepam', strength: '1mg', form: 'Tablet' }
  ];

  async search(query: string): Promise<Medication[]> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 300));
    
    return this.medications.filter(med => 
      med.name.toLowerCase().includes(query.toLowerCase())
    );
  }

  async getById(id: string): Promise<Medication> {
    const medication = this.medications.find(med => med.id === id);
    if (!medication) {
      throw new Error(`Medication with ID ${id} not found`);
    }
    return medication;
  }
}
```

## Custom Hooks API

### Timing Hooks

```typescript
// Centralized timing configuration
interface TimingConfig {
  debounce: {
    search: number;
    input: number;
  };
  dropdown: {
    blurDelay: number;
    animationDuration: number;
  };
  scroll: {
    animationDuration: number;
    offset: number;
  };
}

// Timing hooks
function useDropdownBlur(onBlur: () => void): (event: FocusEvent) => void;
function useScrollToElement(scrollFunction: (id: string) => void): (elementId: string) => void;
function useDebounce<T>(value: T, delay: number): T;
function useSearchDebounce(
  callback: (query: string) => void,
  minLength: number,
  delay: number
): {
  handleSearchChange: (query: string) => void;
  isDebouncing: boolean;
};
```

### Usage Examples

```typescript
// Dropdown blur pattern
const handleBlur = useDropdownBlur(() => setIsOpen(false));

// Scroll animation
const scrollTo = useScrollToElement((id) => {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
});

// Search debouncing
const { handleSearchChange, isDebouncing } = useSearchDebounce(
  (query) => searchMedications(query),
  2, // minimum length
  TIMINGS.debounce.search
);
```

### Focus Management Hooks

```typescript
interface FocusAdvancementHook {
  handleKeyDown: (event: KeyboardEvent) => void;
  selectionMethod: 'keyboard' | 'mouse';
}

function useFocusAdvancement(onAdvance: () => void): FocusAdvancementHook;

function useFocusTrap(isActive: boolean): {
  trapRef: RefObject<HTMLElement>;
  restoreFocus: () => void;
};

// Usage
const { handleKeyDown, selectionMethod } = useFocusAdvancement(() => {
  // Advance to next field
});

const { trapRef, restoreFocus } = useFocusTrap(isModalOpen);
```

## Type Definitions

### Core Domain Types

```typescript
interface Medication {
  id: string;
  name: string;
  strength: string;
  form: string;
  category?: string;
  subcategory?: string;
  contraindications?: string[];
}

interface Dosage {
  amount: number;
  unit: string;
  frequency: string;
  route: string;
  instructions?: string;
}

interface MedicationEntry {
  id: string;
  medication: Medication;
  dosage: Dosage;
  startDate: Date;
  endDate?: Date;
  prescribedBy?: string;
  notes?: string;
}

interface Client {
  id: string;
  name: string;
  dateOfBirth: Date;
  medications: MedicationEntry[];
  allergies?: string[];
  medicalConditions?: string[];
}
```

### Component Prop Types

```typescript
interface BaseComponentProps {
  id: string;
  className?: string;
  'data-testid'?: string;
  'data-modal-id'?: string;
}

interface FormFieldProps extends BaseComponentProps {
  label: string;
  required?: boolean;
  error?: string;
  helpText?: string;
  disabled?: boolean;
}

interface DropdownProps extends FormFieldProps {
  options: string[] | Option[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  placeholder?: string;
  maxHeight?: string;
}
```

### Validation Types

```typescript
interface ValidationRule {
  validate: (value: any) => boolean;
  message: string;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
}

interface FieldValidation {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  custom?: ValidationRule[];
}
```

## Testing API

### Test Utilities

```typescript
interface TestingUtils {
  // Component testing
  renderWithMobX: (component: ReactElement, store?: any) => RenderResult;
  
  // Modal testing  
  waitForModal: (page: Page, modalId: string) => Promise<void>;
  closeModal: (page: Page, method?: 'escape' | 'button') => Promise<void>;
  
  // Form testing
  fillForm: (page: Page, formData: Record<string, string>) => Promise<void>;
  validateFormErrors: (page: Page, expectedErrors: string[]) => Promise<void>;
  
  // Accessibility testing
  runAccessibilityAudit: (page: Page) => Promise<AxeResults>;
  validateKeyboardNavigation: (page: Page, expectedTabOrder: string[]) => Promise<void>;
}
```

### Mock Data Generators

```typescript
interface MockDataGenerators {
  generateMedication: (overrides?: Partial<Medication>) => Medication;
  generateClient: (overrides?: Partial<Client>) => Client;
  generateMedicationEntry: (overrides?: Partial<MedicationEntry>) => MedicationEntry;
  
  // Test data sets
  getMockMedications: (count?: number) => Medication[];
  getMockClients: (count?: number) => Client[];
}

// Usage
const testMedication = generateMedication({
  name: 'Test Medication',
  strength: '100mg'
});

const mockMedications = getMockMedications(50);
```

## Configuration API

### Environment Configuration

```typescript
interface AppConfig {
  apiUrl: string;
  debugMode: boolean;
  enableDiagnostics: boolean;
  accessibility: {
    enforceWCAG: boolean;
    announceChanges: boolean;
    highContrast: boolean;
  };
  timing: TimingConfig;
  logging: LoggingConfig;
}

interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  categories: string[];
  targets: ('console' | 'memory' | 'remote')[];
}
```

### Diagnostics Configuration

```typescript
interface DiagnosticsConfig {
  enableMobXMonitor: boolean;
  enablePerformanceMonitor: boolean;
  enableLogOverlay: boolean;
  enableNetworkMonitor: boolean;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity: number;
  fontSize: 'small' | 'medium' | 'large';
}

// Access via context
const { config, toggleMobXMonitor } = useDiagnostics();
```

This API documentation provides a comprehensive reference for all components, services, and patterns used throughout the A4C-FrontEnd application.