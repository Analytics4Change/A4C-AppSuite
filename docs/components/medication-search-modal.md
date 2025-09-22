# MedicationSearchModal

## Overview

The MedicationSearchModal component provides a modal interface for searching and selecting medications. It features focus trapping, keyboard navigation, and integration with the medication search system. The modal ensures accessibility compliance while providing an intuitive search experience for healthcare professionals.

## Props Interface

```typescript
interface MedicationSearchModalProps {
  isOpen: boolean;
  onSelect: (medication: Medication) => void;
  onCancel: () => void;
  searchResults: Medication[];
  isLoading: boolean;
  onSearch: (query: string) => void;
}
```

## Usage Examples

### Basic Medication Search Modal

```tsx
import { MedicationSearchModal } from '@/components/medication/MedicationSearchModal';
import { useMedicationSearch } from '@/hooks/useMedicationSearch';

function MedicationSelector() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedMedication, setSelectedMedication] = useState<Medication | null>(null);
  
  const { 
    searchResults, 
    isLoading, 
    search, 
    error 
  } = useMedicationSearch();

  const handleMedicationSelect = (medication: Medication) => {
    setSelectedMedication(medication);
    setIsModalOpen(false);
    console.log('Selected medication:', medication);
  };

  const handleCancel = () => {
    setIsModalOpen(false);
  };

  return (
    <div>
      <div className="space-y-2">
        <label htmlFor="medication-display">Selected Medication</label>
        <div className="flex gap-2">
          <input
            id="medication-display"
            type="text"
            readOnly
            value={selectedMedication?.name || ''}
            placeholder="No medication selected"
            className="flex-1 px-3 py-2 border rounded-md bg-gray-50"
          />
          <Button onClick={() => setIsModalOpen(true)}>
            Search Medications
          </Button>
        </div>
      </div>

      <MedicationSearchModal
        isOpen={isModalOpen}
        onSelect={handleMedicationSelect}
        onCancel={handleCancel}
        searchResults={searchResults}
        isLoading={isLoading}
        onSearch={search}
      />

      {selectedMedication && (
        <div className="mt-4 p-4 border rounded-md bg-blue-50">
          <h3 className="font-medium">{selectedMedication.name}</h3>
          <p className="text-sm text-gray-600">
            {selectedMedication.strength} - {selectedMedication.form}
          </p>
          {selectedMedication.manufacturer && (
            <p className="text-sm text-gray-500">
              Manufacturer: {selectedMedication.manufacturer}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
```

### With Form Integration

```tsx
import { useForm, Controller } from 'react-hook-form';

interface PrescriptionForm {
  medication: Medication | null;
  dosage: string;
  frequency: string;
  instructions: string;
}

function PrescriptionFormWithModal() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { control, handleSubmit, setValue, watch, formState: { errors } } = useForm<PrescriptionForm>();
  
  const selectedMedication = watch('medication');

  const handleMedicationSelect = (medication: Medication) => {
    setValue('medication', medication, { shouldValidate: true });
    setIsModalOpen(false);
  };

  const onSubmit = (data: PrescriptionForm) => {
    console.log('Prescription data:', data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-2">
          Medication *
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={selectedMedication?.name || ''}
            placeholder="Click to search for medication"
            className="flex-1 px-3 py-2 border rounded-md bg-gray-50 cursor-pointer"
            onClick={() => setIsModalOpen(true)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsModalOpen(true)}
          >
            Search
          </Button>
        </div>
        {errors.medication && (
          <p className="text-sm text-red-600 mt-1">
            Please select a medication
          </p>
        )}
      </div>

      <Controller
        name="dosage"
        control={control}
        rules={{ required: 'Dosage is required' }}
        render={({ field, fieldState }) => (
          <div>
            <label className="block text-sm font-medium mb-2">
              Dosage *
            </label>
            <input
              {...field}
              type="text"
              placeholder="e.g., 10mg"
              className="w-full px-3 py-2 border rounded-md"
            />
            {fieldState.error && (
              <p className="text-sm text-red-600 mt-1">
                {fieldState.error.message}
              </p>
            )}
          </div>
        )}
      />

      <MedicationSearchModal
        isOpen={isModalOpen}
        onSelect={handleMedicationSelect}
        onCancel={() => setIsModalOpen(false)}
        searchResults={searchResults}
        isLoading={isLoading}
        onSearch={search}
      />

      <div className="flex gap-3">
        <Button type="submit" disabled={!selectedMedication}>
          Create Prescription
        </Button>
        <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
```

### With State Management (MobX)

```tsx
import { observer } from 'mobx-react-lite';
import { useMedicationViewModel } from '@/viewModels/MedicationViewModel';

const MedicationSelectionView = observer(() => {
  const viewModel = useMedicationViewModel();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleMedicationSelect = (medication: Medication) => {
    viewModel.setSelectedMedication(medication);
    setIsModalOpen(false);
  };

  const handleSearch = (query: string) => {
    viewModel.searchMedications(query);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-2">
          Current Medication
        </h2>
        {viewModel.selectedMedication ? (
          <div className="p-4 border rounded-lg">
            <h3 className="font-medium">{viewModel.selectedMedication.name}</h3>
            <p className="text-sm text-gray-600">
              {viewModel.selectedMedication.activeIngredient}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsModalOpen(true)}
              >
                Change Medication
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => viewModel.clearSelectedMedication()}
              >
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg text-center">
            <p className="text-gray-500 mb-2">No medication selected</p>
            <Button onClick={() => setIsModalOpen(true)}>
              Search Medications
            </Button>
          </div>
        )}
      </div>

      <MedicationSearchModal
        isOpen={isModalOpen}
        onSelect={handleMedicationSelect}
        onCancel={() => setIsModalOpen(false)}
        searchResults={viewModel.searchResults}
        isLoading={viewModel.isSearching}
        onSearch={handleSearch}
      />

      {viewModel.searchError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-700">
            Search error: {viewModel.searchError}
          </p>
        </div>
      )}
    </div>
  );
});
```

### Custom Search Behavior

```tsx
function AdvancedMedicationSearch() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [recentSelections, setRecentSelections] = useState<Medication[]>([]);

  const handleSearch = async (query: string) => {
    // Add to search history
    setSearchHistory(prev => {
      const newHistory = [query, ...prev.filter(q => q !== query)].slice(0, 10);
      return newHistory;
    });

    try {
      const results = await medicationAPI.search(query, {
        includeGenerics: true,
        includeBrandNames: true,
        maxResults: 50
      });
      setSearchResults(results);
    } catch (error) {
      console.error('Search failed:', error);
      setSearchError('Failed to search medications');
    }
  };

  const handleMedicationSelect = (medication: Medication) => {
    setSelectedMedication(medication);
    
    // Add to recent selections
    setRecentSelections(prev => {
      const newRecent = [medication, ...prev.filter(m => m.id !== medication.id)].slice(0, 5);
      return newRecent;
    });
    
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-4">
      {/* Recent selections */}
      {recentSelections.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Recent Selections</h3>
          <div className="flex flex-wrap gap-2">
            {recentSelections.map(medication => (
              <button
                key={medication.id}
                onClick={() => handleMedicationSelect(medication)}
                className="px-3 py-1 text-sm bg-blue-100 text-blue-800 rounded-full hover:bg-blue-200"
              >
                {medication.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <Button onClick={() => setIsModalOpen(true)}>
        Search All Medications
      </Button>

      <MedicationSearchModal
        isOpen={isModalOpen}
        onSelect={handleMedicationSelect}
        onCancel={() => setIsModalOpen(false)}
        searchResults={searchResults}
        isLoading={isLoading}
        onSearch={handleSearch}
      />

      {/* Search history */}
      {searchHistory.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Recent Searches</h3>
          <div className="text-sm text-gray-600">
            {searchHistory.slice(0, 5).join(', ')}
          </div>
        </div>
      )}
    </div>
  );
}
```

### Loading and Error States

```tsx
function MedicationSearchWithStates() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { searchResults, isLoading, error, search, clearError } = useMedicationSearch();

  const handleModalOpen = () => {
    clearError(); // Clear any previous errors
    setIsModalOpen(true);
  };

  const handleSearch = async (query: string) => {
    try {
      await search(query);
    } catch (error) {
      // Error handling is managed by the hook
      console.error('Search failed:', error);
    }
  };

  return (
    <div>
      <Button onClick={handleModalOpen}>
        Search Medications
        {isLoading && (
          <span className="ml-2 inline-block animate-spin">⟳</span>
        )}
      </Button>

      <MedicationSearchModal
        isOpen={isModalOpen}
        onSelect={(medication) => {
          setSelectedMedication(medication);
          setIsModalOpen(false);
        }}
        onCancel={() => setIsModalOpen(false)}
        searchResults={searchResults}
        isLoading={isLoading}
        onSearch={handleSearch}
      />

      {error && (
        <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
          <div className="flex justify-between items-start">
            <p className="text-sm text-red-700">{error}</p>
            <button
              onClick={clearError}
              className="text-red-500 hover:text-red-700"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**: 
  - Tab to focus modal elements in logical order
  - Escape key closes modal and returns focus
  - Enter key activates focused elements
  - Full keyboard access to search and selection

- **Focus Management**:
  - Focus trapped within modal when open
  - Focus restored to trigger element when closed
  - Clear focus indicators on all interactive elements
  - Initial focus to search input when modal opens

- **ARIA Attributes**:
  - `role="dialog"` on modal container
  - `aria-modal="true"` for modal behavior
  - `aria-labelledby` for modal title
  - `aria-describedby` for modal description
  - `aria-expanded` on trigger buttons
  - `aria-live` regions for search results

### Screen Reader Support

- Modal purpose announced when opened
- Search progress and results communicated
- Selection confirmation announced
- Error messages read aloud
- Loading states announced

### Best Practices

```tsx
// ✅ Good: Proper modal labeling
<MedicationSearchModal
  aria-labelledby="medication-search-title"
  aria-describedby="medication-search-description"
/>

// ✅ Good: Focus management
const triggerRef = useRef<HTMLButtonElement>(null);
const handleCancel = () => {
  setIsModalOpen(false);
  // Focus returns automatically via useKeyboardNavigation hook
};

// ✅ Good: Error announcements
{error && (
  <div role="alert" className="error-message">
    {error}
  </div>
)}

// ❌ Avoid: Missing modal attributes
<MedicationSearchModal
  // Missing: proper ARIA attributes
  isOpen={isOpen}
/>
```

## Implementation Notes

### Design Patterns

- **Modal Pattern**: Overlay with focus trapping and backdrop
- **Search Pattern**: Real-time search with debouncing
- **Composition**: Uses MedicationSearch component internally
- **Hook Integration**: Leverages useKeyboardNavigation for accessibility

### Dependencies

- `lucide-react`: X icon for close button
- `@/components/ui/button`: Action buttons
- `@/views/medication/MedicationSearchWithSearchableDropdown`: Search functionality
- `@/hooks/useKeyboardNavigation`: Focus management and keyboard navigation
- `@/utils/logger`: Debug logging
- `@/types/models/Medication`: TypeScript types

### Focus Management

The component uses the `useKeyboardNavigation` hook for comprehensive focus management:

```typescript
useKeyboardNavigation({
  containerRef: modalRef,
  enabled: isOpen,
  trapFocus: true,      // Trap focus within modal
  restoreFocus: true,   // Restore focus when modal closes
  onEscape: onCancel,   // ESC key closes modal
  wrapAround: true      // Tab from last element goes to first
});
```

### Performance Considerations

- Modal content only rendered when open
- Search debouncing prevents excessive API calls
- Efficient re-rendering with proper state management
- Cleanup of event listeners when modal closes

## Testing

### Unit Tests

Located in `src/components/medication/__tests__/MedicationSearchModal.test.tsx`:
- Modal open/close functionality
- Focus trapping and restoration
- Search interaction and selection
- Keyboard navigation
- ARIA attributes and accessibility

### E2E Tests

Covered in medication selection and prescription workflow tests:
- Complete medication search and selection flow
- Keyboard-only interaction
- Screen reader compatibility
- Error handling scenarios
- Integration with form systems

### Testing Patterns

```tsx
// Test modal behavior
test('should open modal and focus search input', async () => {
  render(
    <MedicationSearchModal
      isOpen={true}
      onSelect={mockOnSelect}
      onCancel={mockOnCancel}
      searchResults={[]}
      isLoading={false}
      onSearch={mockOnSearch}
    />
  );

  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('searchbox')).toHaveFocus();
});

// Test keyboard navigation
test('should close modal on Escape key', async () => {
  render(<MedicationSearchModal isOpen={true} onCancel={mockOnCancel} />);
  
  await user.keyboard('{Escape}');
  expect(mockOnCancel).toHaveBeenCalled();
});

// Test search functionality
test('should call onSearch when user types', async () => {
  render(<MedicationSearchModal isOpen={true} onSearch={mockOnSearch} />);
  
  const searchInput = screen.getByRole('searchbox');
  await user.type(searchInput, 'aspirin');
  
  expect(mockOnSearch).toHaveBeenCalledWith('aspirin');
});
```

## Related Components

- **MedicationSearchWithSearchableDropdown**: Core search functionality
- **SearchableDropdown**: Dropdown search interface
- **Button**: Modal action buttons
- **Modal/Dialog**: Alternative modal implementations

## Common Integration Patterns

### Prescription Workflow

```tsx
function PrescriptionWorkflow() {
  const [currentStep, setCurrentStep] = useState('medication');
  const [prescriptionData, setPrescriptionData] = useState({
    medication: null,
    dosage: '',
    frequency: '',
    duration: ''
  });

  const handleMedicationSelect = (medication: Medication) => {
    setPrescriptionData(prev => ({ ...prev, medication }));
    setCurrentStep('dosage');
  };

  if (currentStep === 'medication') {
    return (
      <MedicationSearchModal
        isOpen={true}
        onSelect={handleMedicationSelect}
        onCancel={() => setCurrentStep('cancelled')}
        searchResults={searchResults}
        isLoading={isLoading}
        onSearch={handleSearch}
      />
    );
  }

  // Render other steps...
}
```

### Bulk Medication Entry

```tsx
function BulkMedicationEntry() {
  const [medications, setMedications] = useState<Medication[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const addMedication = (medication: Medication) => {
    setMedications(prev => {
      // Avoid duplicates
      if (prev.some(m => m.id === medication.id)) {
        return prev;
      }
      return [...prev, medication];
    });
    setIsModalOpen(false);
  };

  const removeMedication = (medicationId: string) => {
    setMedications(prev => prev.filter(m => m.id !== medicationId));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2>Medication List ({medications.length})</h2>
        <Button onClick={() => setIsModalOpen(true)}>
          Add Medication
        </Button>
      </div>

      <div className="space-y-2">
        {medications.map(medication => (
          <div key={medication.id} className="flex justify-between items-center p-3 border rounded">
            <div>
              <h3 className="font-medium">{medication.name}</h3>
              <p className="text-sm text-gray-600">{medication.strength}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => removeMedication(medication.id)}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      <MedicationSearchModal
        isOpen={isModalOpen}
        onSelect={addMedication}
        onCancel={() => setIsModalOpen(false)}
        searchResults={searchResults}
        isLoading={isLoading}
        onSearch={handleSearch}
      />
    </div>
  );
}
```

## Changelog

- **v1.0.0**: Initial implementation with basic modal and search
- **v1.1.0**: Added keyboard navigation and focus trapping
- **v1.2.0**: Enhanced accessibility with comprehensive ARIA support
- **v1.3.0**: Integrated logging and performance monitoring
- **v1.4.0**: Improved error handling and loading states
- **v1.5.0**: Added search history and recent selections support