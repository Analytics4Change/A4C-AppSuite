---
status: current
last_updated: 2025-01-13
---

# MedicationPurposeDropdown

## Overview

The MedicationPurposeDropdown component provides a dynamic dropdown for selecting medication therapeutic purposes. It integrates with RXNorm API to load relevant purposes based on the selected medication and gracefully falls back to a manual text input when the API is unavailable or returns no results.

## Props Interface

```typescript
interface MedicationPurposeDropdownProps {
  selectedPurpose: string;
  availablePurposes: string[];
  isLoading: boolean;
  loadFailed: boolean;
  onPurposeChange: (purpose: string) => void;
  tabIndex: number;
  error?: string;
}
```

## Usage Examples

### Basic Purpose Selection

```tsx
import { MedicationPurposeDropdown } from '@/components/medication/MedicationPurposeDropdown';
import { observer } from 'mobx-react-lite';

const MedicationForm = observer(() => {
  const [selectedPurpose, setSelectedPurpose] = useState('');
  const [availablePurposes, setAvailablePurposes] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const loadPurposes = async (medicationId: string) => {
    setIsLoading(true);
    setLoadFailed(false);
    
    try {
      const purposes = await rxNormAPI.getTherapeuticPurposes(medicationId);
      setAvailablePurposes(purposes);
    } catch (error) {
      console.error('Failed to load purposes:', error);
      setLoadFailed(true);
      setAvailablePurposes([]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <MedicationPurposeDropdown
        selectedPurpose={selectedPurpose}
        availablePurposes={availablePurposes}
        isLoading={isLoading}
        loadFailed={loadFailed}
        onPurposeChange={setSelectedPurpose}
        tabIndex={15}
      />
    </div>
  );
});
```

### With MobX ViewModel Integration

```tsx
import { observer } from 'mobx-react-lite';
import { useMedicationViewModel } from '@/viewModels/MedicationViewModel';

const MedicationPurposeSection = observer(() => {
  const viewModel = useMedicationViewModel();

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">Therapeutic Purpose</h3>
      
      <MedicationPurposeDropdown
        selectedPurpose={viewModel.selectedPurpose}
        availablePurposes={viewModel.availablePurposes}
        isLoading={viewModel.isLoadingPurposes}
        loadFailed={viewModel.purposeLoadFailed}
        onPurposeChange={(purpose) => viewModel.setSelectedPurpose(purpose)}
        tabIndex={20}
        error={viewModel.purposeValidationError}
      />

      {viewModel.selectedPurpose && (
        <div className="mt-2 p-3 bg-blue-50 rounded-md">
          <p className="text-sm text-blue-800">
            Selected purpose: {viewModel.selectedPurpose}
          </p>
        </div>
      )}
    </div>
  );
});
```

### Form Integration with Validation

```tsx
import { useForm, Controller } from 'react-hook-form';

interface MedicationFormData {
  medication: Medication;
  purpose: string;
  dosage: string;
  frequency: string;
}

function MedicationPrescriptionForm() {
  const { control, handleSubmit, watch, formState: { errors } } = useForm<MedicationFormData>();
  const [purposeState, setPurposeState] = useState({
    availablePurposes: [],
    isLoading: false,
    loadFailed: false
  });

  const selectedMedication = watch('medication');

  // Load purposes when medication changes
  useEffect(() => {
    if (selectedMedication) {
      loadTherapeuticPurposes(selectedMedication.id);
    }
  }, [selectedMedication]);

  const loadTherapeuticPurposes = async (medicationId: string) => {
    setPurposeState(prev => ({ ...prev, isLoading: true, loadFailed: false }));
    
    try {
      const purposes = await medicationAPI.getTherapeuticPurposes(medicationId);
      setPurposeState({
        availablePurposes: purposes,
        isLoading: false,
        loadFailed: false
      });
    } catch (error) {
      setPurposeState({
        availablePurposes: [],
        isLoading: false,
        loadFailed: true
      });
    }
  };

  const onSubmit = (data: MedicationFormData) => {
    console.log('Prescription data:', data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Controller
        name="purpose"
        control={control}
        rules={{ 
          required: 'Therapeutic purpose is required',
          minLength: {
            value: 3,
            message: 'Purpose must be at least 3 characters'
          }
        }}
        render={({ field }) => (
          <MedicationPurposeDropdown
            selectedPurpose={field.value || ''}
            availablePurposes={purposeState.availablePurposes}
            isLoading={purposeState.isLoading}
            loadFailed={purposeState.loadFailed}
            onPurposeChange={field.onChange}
            tabIndex={25}
            error={errors.purpose?.message}
          />
        )}
      />

      <button 
        type="submit" 
        disabled={!selectedMedication || purposeState.isLoading}
        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
      >
        Create Prescription
      </button>
    </form>
  );
}
```

### Error Handling and Retry

```tsx
function MedicationPurposeWithRetry() {
  const [purposeState, setPurposeState] = useState({
    selectedPurpose: '',
    availablePurposes: [],
    isLoading: false,
    loadFailed: false,
    retryCount: 0
  });

  const loadPurposes = async (medicationId: string, isRetry = false) => {
    if (isRetry) {
      setPurposeState(prev => ({ 
        ...prev, 
        retryCount: prev.retryCount + 1,
        isLoading: true,
        loadFailed: false 
      }));
    } else {
      setPurposeState(prev => ({ 
        ...prev, 
        isLoading: true, 
        loadFailed: false,
        retryCount: 0 
      }));
    }

    try {
      const purposes = await medicationAPI.getTherapeuticPurposes(medicationId);
      setPurposeState(prev => ({
        ...prev,
        availablePurposes: purposes,
        isLoading: false,
        loadFailed: false
      }));
    } catch (error) {
      console.error('Failed to load purposes:', error);
      setPurposeState(prev => ({
        ...prev,
        isLoading: false,
        loadFailed: true
      }));
    }
  };

  const handleRetry = () => {
    if (selectedMedication && purposeState.retryCount < 3) {
      loadPurposes(selectedMedication.id, true);
    }
  };

  return (
    <div className="space-y-4">
      <MedicationPurposeDropdown
        selectedPurpose={purposeState.selectedPurpose}
        availablePurposes={purposeState.availablePurposes}
        isLoading={purposeState.isLoading}
        loadFailed={purposeState.loadFailed}
        onPurposeChange={(purpose) => 
          setPurposeState(prev => ({ ...prev, selectedPurpose: purpose }))
        }
        tabIndex={30}
      />

      {purposeState.loadFailed && purposeState.retryCount < 3 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">
            Failed to load therapeutic purposes from RXNorm.
          </span>
          <button
            onClick={handleRetry}
            className="text-blue-600 hover:text-blue-800 underline"
          >
            Retry ({purposeState.retryCount}/3)
          </button>
        </div>
      )}

      {purposeState.retryCount >= 3 && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
          <p className="text-sm text-yellow-800">
            Unable to load therapeutic purposes from RXNorm after multiple attempts. 
            Please enter the purpose manually.
          </p>
        </div>
      )}
    </div>
  );
}
```

### Cache Implementation

```tsx
import { useCallback } from 'react';

// Simple cache for therapeutic purposes
const purposeCache = new Map<string, { 
  purposes: string[]; 
  timestamp: number; 
  expiry: number 
}>();

function MedicationPurposeWithCaching() {
  const [purposeState, setPurposeState] = useState({
    selectedPurpose: '',
    availablePurposes: [],
    isLoading: false,
    loadFailed: false
  });

  const loadPurposesWithCache = useCallback(async (medicationId: string) => {
    // Check cache first
    const cached = purposeCache.get(medicationId);
    const now = Date.now();
    
    if (cached && now < cached.expiry) {
      console.log('Using cached purposes for medication:', medicationId);
      setPurposeState(prev => ({
        ...prev,
        availablePurposes: cached.purposes,
        isLoading: false,
        loadFailed: false
      }));
      return;
    }

    // Load from API
    setPurposeState(prev => ({ ...prev, isLoading: true, loadFailed: false }));

    try {
      const purposes = await medicationAPI.getTherapeuticPurposes(medicationId);
      
      // Cache the results (expire in 1 hour)
      purposeCache.set(medicationId, {
        purposes,
        timestamp: now,
        expiry: now + (60 * 60 * 1000)
      });

      setPurposeState(prev => ({
        ...prev,
        availablePurposes: purposes,
        isLoading: false,
        loadFailed: false
      }));
    } catch (error) {
      console.error('Failed to load purposes:', error);
      setPurposeState(prev => ({
        ...prev,
        isLoading: false,
        loadFailed: true
      }));
    }
  }, []);

  return (
    <MedicationPurposeDropdown
      selectedPurpose={purposeState.selectedPurpose}
      availablePurposes={purposeState.availablePurposes}
      isLoading={purposeState.isLoading}
      loadFailed={purposeState.loadFailed}
      onPurposeChange={(purpose) => 
        setPurposeState(prev => ({ ...prev, selectedPurpose: purpose }))
      }
      tabIndex={35}
    />
  );
}
```

### Custom Purpose Categories

```tsx
function CustomPurposeCategories() {
  const [customPurposes] = useState([
    // Common therapeutic categories as fallback
    'Pain management',
    'Infection treatment',
    'Blood pressure control',
    'Diabetes management',
    'Mental health support',
    'Allergy relief',
    'Heart condition treatment',
    'Digestive health',
    'Respiratory support',
    'Preventive care'
  ]);

  const [combinedPurposes, setCombinedPurposes] = useState([]);

  const mergePurposesWithCustom = (apiPurposes: string[]) => {
    // Combine API purposes with custom categories, removing duplicates
    const combined = [...new Set([...apiPurposes, ...customPurposes])];
    setCombinedPurposes(combined.sort());
  };

  useEffect(() => {
    if (availablePurposes.length > 0) {
      mergePurposesWithCustom(availablePurposes);
    } else {
      setCombinedPurposes(customPurposes);
    }
  }, [availablePurposes]);

  return (
    <div className="space-y-4">
      <MedicationPurposeDropdown
        selectedPurpose={selectedPurpose}
        availablePurposes={combinedPurposes}
        isLoading={isLoading}
        loadFailed={loadFailed}
        onPurposeChange={setSelectedPurpose}
        tabIndex={40}
      />

      <div className="text-xs text-gray-500">
        {availablePurposes.length > 0 
          ? `Showing ${availablePurposes.length} RXNorm purposes + ${customPurposes.length} common categories`
          : `Showing ${customPurposes.length} common therapeutic categories`
        }
      </div>
    </div>
  );
}
```

## Component States

### Loading State

Shows an animated loading spinner with descriptive text while fetching therapeutic purposes from the RXNorm API.

```tsx
// Loading state displays:
<div className="flex items-center space-x-2 text-gray-500">
  <Loader2 className="h-4 w-4 animate-spin" />
  <span>Loading therapeutic purposes...</span>
</div>
```

### Success State (Dropdown)

When API call succeeds and returns purposes, displays an EditableDropdown with the available options.

### Fallback State (Manual Input)

When API fails or returns no results, falls back to a manual text input with helpful messaging.

```tsx
// Fallback state includes:
// - Warning icon and explanatory text
// - Manual text input
// - Clear instructions for user
```

### Error State

Displays validation errors when form validation fails or user input is invalid.

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**:
  - Full keyboard access in all states
  - Tab navigation between form elements
  - EditableDropdown keyboard functionality when available
  - Input field accessibility when in fallback mode

- **ARIA Attributes**:
  - Proper labeling for all input states
  - Loading announcements via screen reader
  - Error message association
  - State change notifications

- **Visual Design**:
  - Sufficient color contrast for all text
  - Clear visual indicators for different states
  - Consistent layout across state transitions

### Screen Reader Support

- Loading state progress announced
- Error messages read aloud
- Successful data loading communicated
- Input field purpose clearly described

### Best Practices

```tsx
// ✅ Good: Proper labeling and ARIA
<MedicationPurposeDropdown
  // Props provide proper context
  error={validationError}
  tabIndex={sequentialTabIndex}
/>

// ✅ Good: Loading state announcement
if (isLoading) {
  return (
    <div role="status" aria-live="polite">
      <Loader2 className="animate-spin" />
      <span>Loading therapeutic purposes...</span>
    </div>
  );
}

// ❌ Avoid: Missing error handling
<MedicationPurposeDropdown
  // Missing: error prop for validation feedback
  selectedPurpose={purpose}
  availablePurposes={purposes}
/>
```

## Implementation Notes

### Design Patterns

- **Progressive Enhancement**: Starts with API integration, falls back gracefully
- **State Management**: Clear state tracking for loading, success, and error scenarios
- **Observer Pattern**: Uses MobX observer for reactive updates
- **Composition**: Leverages EditableDropdown and Input components

### Dependencies

- `mobx-react-lite`: Reactive state management with observer
- `lucide-react`: Icons (Loader2, AlertCircle)
- `@/components/ui/EditableDropdown`: Dropdown functionality
- `@/components/ui/input`: Manual input fallback
- `@/components/ui/label`: Accessible labeling

### API Integration

The component is designed to work with RXNorm therapeutic purpose APIs:

```typescript
// Expected API interface
interface RXNormAPI {
  getTherapeuticPurposes(medicationId: string): Promise<string[]>;
}

// Example API response
const purposes = [
  "Treatment of hypertension",
  "Management of angina pectoris", 
  "Prevention of myocardial infarction"
];
```

### Performance Considerations

- **Lazy Loading**: Only loads purposes when medication is selected
- **Caching**: Can be enhanced with purpose caching
- **Debouncing**: Input debouncing in manual mode
- **Error Recovery**: Graceful fallback prevents blocking user workflow

## Testing

### Unit Tests

Located in `src/components/medication/__tests__/MedicationPurposeDropdown.test.tsx`:

- Loading state display and behavior
- Successful API response handling
- Error state and fallback functionality
- Manual input validation
- Accessibility attributes

### E2E Tests

Covered in medication prescription workflow tests:

- Complete purpose selection flow
- API failure recovery scenarios
- Form integration and validation
- Keyboard navigation testing

### Testing Patterns

```tsx
// Test loading state
test('should show loading spinner when loading purposes', () => {
  render(
    <MedicationPurposeDropdown
      isLoading={true}
      availablePurposes={[]}
      loadFailed={false}
      selectedPurpose=""
      onPurposeChange={mockOnChange}
      tabIndex={1}
    />
  );

  expect(screen.getByRole('status')).toBeInTheDocument();
  expect(screen.getByText(/Loading therapeutic purposes/)).toBeInTheDocument();
});

// Test fallback state
test('should show manual input when API fails', () => {
  render(
    <MedicationPurposeDropdown
      isLoading={false}
      availablePurposes={[]}
      loadFailed={true}
      selectedPurpose=""
      onPurposeChange={mockOnChange}
      tabIndex={1}
    />
  );

  expect(screen.getByRole('textbox')).toBeInTheDocument();
  expect(screen.getByText(/Unable to load purposes/)).toBeInTheDocument();
});
```

## Related Components

- **EditableDropdown**: Primary dropdown functionality
- **Input**: Manual input fallback
- **Label**: Accessible labeling
- **MedicationSearchModal**: Medication selection component
- **Loading states**: Other async loading components

## Common Integration Patterns

### ViewModel Integration

```tsx
class MedicationViewModel {
  @observable selectedMedication: Medication | null = null;
  @observable selectedPurpose = '';
  @observable availablePurposes: string[] = [];
  @observable isLoadingPurposes = false;
  @observable purposeLoadFailed = false;

  @action
  async loadTherapeuticPurposes(medicationId: string) {
    this.isLoadingPurposes = true;
    this.purposeLoadFailed = false;
    
    try {
      const purposes = await this.rxNormService.getTherapeuticPurposes(medicationId);
      runInAction(() => {
        this.availablePurposes = purposes;
        this.isLoadingPurposes = false;
      });
    } catch (error) {
      runInAction(() => {
        this.purposeLoadFailed = true;
        this.isLoadingPurposes = false;
      });
    }
  }

  @action
  setSelectedPurpose(purpose: string) {
    this.selectedPurpose = purpose;
  }
}
```

### Form Wizard Integration

```tsx
function PrescriptionWizard() {
  const [currentStep, setCurrentStep] = useState('medication');
  const [formData, setFormData] = useState({
    medication: null,
    purpose: '',
    dosage: '',
    instructions: ''
  });

  if (currentStep === 'purpose') {
    return (
      <MedicationPurposeStep
        medication={formData.medication}
        selectedPurpose={formData.purpose}
        onPurposeSelect={(purpose) => {
          setFormData(prev => ({ ...prev, purpose }));
          setCurrentStep('dosage');
        }}
      />
    );
  }

  // Other steps...
}
```

## Changelog

- **v1.0.0**: Initial implementation with RXNorm API integration
- **v1.1.0**: Added fallback manual input for API failures
- **v1.2.0**: Enhanced error handling and loading states
- **v1.3.0**: Improved accessibility with proper ARIA attributes
- **v1.4.0**: Added caching support for better performance
- **v1.5.0**: Enhanced form validation and error messaging
