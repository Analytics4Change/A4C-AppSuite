# MedicationStatusIndicator

## Overview

A specialized component that displays the regulatory status of medications, including controlled substance schedules and psychotropic classifications. This component handles both automatic API-based status detection and manual fallback entry when automatic detection fails.

## Props Interface

```typescript
interface MedicationStatusIndicatorProps {
  // Status values
  isControlled: boolean | null;          // Whether medication is a controlled substance
  isPsychotropic: boolean | null;        // Whether medication is psychotropic
  controlledSchedule?: string;           // DEA schedule (I-V) if controlled
  psychotropicCategory?: string;         // Psychotropic category if applicable
  
  // Loading states
  isCheckingControlled: boolean;         // Loading state for controlled status check
  isCheckingPsychotropic: boolean;       // Loading state for psychotropic status check
  
  // Error states (when true, show radio buttons for manual entry)
  controlledCheckFailed: boolean;        // API check failed for controlled status
  psychotropicCheckFailed: boolean;      // API check failed for psychotropic status
  
  // Handlers for manual selection (when in fallback mode)
  onControlledChange: (value: boolean) => void;      // Manual controlled status selection
  onPsychotropicChange: (value: boolean) => void;    // Manual psychotropic status selection
  
  // TabIndex for accessibility
  controlledTabIndex: number;            // Tab index for controlled status controls
  psychotropicTabIndex: number;          // Tab index for psychotropic status controls
}
```

## Usage Examples

### Basic Usage with API Data

```tsx
import { MedicationStatusIndicator } from '@/components/medication/MedicationStatusIndicator';

function MedicationDetails() {
  const [medicationStatus, setMedicationStatus] = useState({
    isControlled: null,
    isPsychotropic: null,
    isCheckingControlled: true,
    isCheckingPsychotropic: true,
    controlledCheckFailed: false,
    psychotropicCheckFailed: false
  });

  // API call to check medication status
  useEffect(() => {
    checkMedicationStatus(medicationId)
      .then(status => {
        setMedicationStatus(prev => ({
          ...prev,
          isControlled: status.isControlled,
          isPsychotropic: status.isPsychotropic,
          controlledSchedule: status.schedule,
          psychotropicCategory: status.category,
          isCheckingControlled: false,
          isCheckingPsychotropic: false
        }));
      })
      .catch(() => {
        setMedicationStatus(prev => ({
          ...prev,
          controlledCheckFailed: true,
          psychotropicCheckFailed: true,
          isCheckingControlled: false,
          isCheckingPsychotropic: false
        }));
      });
  }, [medicationId]);

  return (
    <MedicationStatusIndicator
      isControlled={medicationStatus.isControlled}
      isPsychotropic={medicationStatus.isPsychotropic}
      controlledSchedule={medicationStatus.controlledSchedule}
      psychotropicCategory={medicationStatus.psychotropicCategory}
      isCheckingControlled={medicationStatus.isCheckingControlled}
      isCheckingPsychotropic={medicationStatus.isCheckingPsychotropic}
      controlledCheckFailed={medicationStatus.controlledCheckFailed}
      psychotropicCheckFailed={medicationStatus.psychotropicCheckFailed}
      onControlledChange={(value) => 
        setMedicationStatus(prev => ({ ...prev, isControlled: value }))
      }
      onPsychotropicChange={(value) => 
        setMedicationStatus(prev => ({ ...prev, isPsychotropic: value }))
      }
      controlledTabIndex={10}
      psychotropicTabIndex={11}
    />
  );
}
```

### Advanced Usage with ViewModel Integration

```tsx
import { observer } from 'mobx-react-lite';
import { MedicationManagementViewModel } from '@/viewModels/medication/MedicationManagementViewModel';

const MedicationForm = observer(() => {
  const [vm] = useState(() => new MedicationManagementViewModel());

  return (
    <div className="medication-form">
      <h2>Medication Information</h2>
      
      <MedicationStatusIndicator
        isControlled={vm.selectedMedication?.isControlled ?? null}
        isPsychotropic={vm.selectedMedication?.isPsychotropic ?? null}
        controlledSchedule={vm.selectedMedication?.controlledSchedule}
        psychotropicCategory={vm.selectedMedication?.psychotropicCategory}
        isCheckingControlled={vm.isCheckingMedicationStatus}
        isCheckingPsychotropic={vm.isCheckingMedicationStatus}
        controlledCheckFailed={vm.statusCheckError !== null}
        psychotropicCheckFailed={vm.statusCheckError !== null}
        onControlledChange={vm.setControlledStatus}
        onPsychotropicChange={vm.setPsychotropicStatus}
        controlledTabIndex={vm.getNextTabIndex()}
        psychotropicTabIndex={vm.getNextTabIndex()}
      />
    </div>
  );
});
```

### Error Handling and Fallback Mode

```tsx
function MedicationStatusWithFallback() {
  const [status, setStatus] = useState({
    isControlled: null,
    isPsychotropic: null,
    checkFailed: false,
    isLoading: true
  });

  const handleStatusCheck = async () => {
    try {
      setStatus(prev => ({ ...prev, isLoading: true, checkFailed: false }));
      const result = await medicationAPI.checkStatus(medicationId);
      
      setStatus({
        isControlled: result.isControlled,
        isPsychotropic: result.isPsychotropic,
        checkFailed: false,
        isLoading: false
      });
    } catch (error) {
      setStatus(prev => ({
        ...prev,
        checkFailed: true,
        isLoading: false
      }));
    }
  };

  return (
    <div>
      {status.checkFailed && (
        <div className="fallback-notice" role="alert">
          Unable to automatically determine medication status. 
          Please select manually below.
        </div>
      )}
      
      <MedicationStatusIndicator
        isControlled={status.isControlled}
        isPsychotropic={status.isPsychotropic}
        isCheckingControlled={status.isLoading}
        isCheckingPsychotropic={status.isLoading}
        controlledCheckFailed={status.checkFailed}
        psychotropicCheckFailed={status.checkFailed}
        onControlledChange={(value) => 
          setStatus(prev => ({ ...prev, isControlled: value }))
        }
        onPsychotropicChange={(value) => 
          setStatus(prev => ({ ...prev, isPsychotropic: value }))
        }
        controlledTabIndex={5}
        psychotropicTabIndex={6}
      />
      
      {status.checkFailed && (
        <button onClick={handleStatusCheck} className="retry-button">
          Retry Status Check
        </button>
      )}
    </div>
  );
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**: 
  - Tab/Shift+Tab navigation between status controls
  - Arrow keys for radio button navigation (in fallback mode)
  - Space to select radio button options
  - Proper tabIndex sequencing

- **ARIA Attributes**:
  - `role="group"` for status indicator groups
  - `aria-labelledby` connecting labels to status groups
  - `aria-describedby` for detailed status descriptions
  - `aria-live="polite"` for status updates and loading states
  - `aria-invalid` for validation states
  - `role="radiogroup"` for manual selection controls

- **Focus Management**:
  - Clear focus indicators on all interactive elements
  - Focus preservation during loading states
  - Logical focus flow in fallback mode
  - Focus announcements for status changes

### Screen Reader Support

- Status information clearly announced
- Loading states communicated appropriately
- Error states and fallback mode explained
- Schedule and category information announced
- Manual selection options clearly labeled

## Styling

### CSS Classes

- `.medication-status-indicator`: Main container
- `.status-group`: Individual status group (controlled/psychotropic)
- `.status-group__label`: Status group label
- `.status-group__content`: Status content area
- `.status-value`: Status value display
- `.status-value--positive`: Positive status (controlled/psychotropic)
- `.status-value--negative`: Negative status (not controlled/psychotropic)
- `.status-value--unknown`: Unknown status
- `.status-loading`: Loading state indicator
- `.status-fallback`: Manual selection controls
- `.status-error`: Error state styling
- `.schedule-badge`: DEA schedule badge
- `.category-badge`: Psychotropic category badge

### Status Visual Design

```css
.status-value--positive {
  color: #dc2626;
  background-color: #fef2f2;
  border: 1px solid #fecaca;
  padding: 4px 8px;
  border-radius: 4px;
  font-weight: 600;
}

.status-value--negative {
  color: #16a34a;
  background-color: #f0fdf4;
  border: 1px solid #bbf7d0;
  padding: 4px 8px;
  border-radius: 4px;
}

.schedule-badge {
  background-color: #dc2626;
  color: white;
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 0.75rem;
  font-weight: bold;
}
```

### Loading and Error States

```css
.status-loading {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #6b7280;
}

.status-loading::before {
  content: '';
  width: 16px;
  height: 16px;
  border: 2px solid #e5e7eb;
  border-top: 2px solid #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
```

## Implementation Notes

### Design Patterns

- **Progressive Enhancement**: Shows API results when available, fallback when needed
- **Loading State Management**: Clear loading indicators for each status type
- **Error Recovery**: Graceful degradation to manual entry
- **Accessibility First**: Comprehensive ARIA support and keyboard navigation

### Status Detection Flow

1. **Initial State**: Both statuses start as `null` with loading indicators
2. **API Check**: Simultaneous API calls for controlled and psychotropic status
3. **Success**: Display status with schedule/category information
4. **Failure**: Show manual selection controls with clear error messaging
5. **Manual Entry**: User can override or provide missing information

### Regulatory Compliance

#### Controlled Substances
- **DEA Schedules**: I (highest restriction) through V (lowest restriction)
- **Schedule Information**: Displayed with appropriate warnings and styling
- **Documentation**: Maintains audit trail for controlled substance handling

#### Psychotropic Medications
- **Categories**: Antipsychotics, Antidepressants, Anxiolytics, Mood Stabilizers
- **Monitoring Requirements**: Special handling and monitoring protocols
- **Reporting**: Integration with psychotropic monitoring systems

### Dependencies

- React 18+ for component functionality
- Medication API service for status checks
- Lucide React for status icons
- Tailwind CSS for styling

### Performance Considerations

- Debounced API calls to prevent excessive requests
- Memoized status calculations
- Efficient re-rendering with proper dependencies
- Cached status results where appropriate

## Testing

### Unit Tests

Located in `MedicationStatusIndicator.test.tsx`. Covers:
- Status display for all states (positive, negative, null, loading)
- Manual selection functionality in fallback mode
- Error handling and recovery
- Accessibility attribute presence
- Keyboard navigation behavior

### Integration Tests

- API integration for status checking
- Error scenario handling
- ViewModel integration patterns
- Form submission with status data

### E2E Tests

Covered in medication management workflows:
- Complete medication entry with status checking
- Manual status override scenarios
- Error recovery and retry functionality
- Accessibility compliance verification

## Related Components

- `MedicationSearchModal` - Often contains this status indicator
- `MedicationForm` - Integrates status indicator in medication entry
- `MedicationList` - May display status indicators in list views

## Regulatory Considerations

### Compliance Requirements

- **DEA Regulations**: Proper handling of controlled substance information
- **State Regulations**: Compliance with state-specific requirements
- **HIPAA**: Secure handling of medication status information
- **Audit Trails**: Maintaining records of status determinations and changes

### Data Sources

- **DEA Orange Book**: Official controlled substance schedules
- **FDA Databases**: Medication classification information
- **State Databases**: State-specific regulatory information
- **Pharmacy Systems**: Integration with pharmacy management systems

## Error Handling

### Common Error Scenarios

- **Network Failures**: API unavailable or timeout
- **Invalid Medication**: Medication not found in regulatory databases
- **Ambiguous Results**: Multiple possible classifications
- **Rate Limiting**: API rate limit exceeded

### Error Recovery Strategies

- **Graceful Degradation**: Fall back to manual entry
- **Retry Mechanisms**: Automatic retry with exponential backoff
- **User Feedback**: Clear error messages with next steps
- **Offline Capability**: Cached data for common medications

## Changelog

- Initial implementation with basic status display
- Added controlled substance schedule support
- Enhanced psychotropic category handling
- Implemented manual fallback mode
- Added comprehensive error handling
- Enhanced accessibility features
- Added regulatory compliance features
- Improved loading state management