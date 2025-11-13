---
status: current
last_updated: 2025-01-13
---

# FocusTrappedCheckboxGroup Example Usage

## Overview

This document provides comprehensive examples of how to use the FocusTrappedCheckboxGroup components in real-world scenarios. These examples demonstrate integration patterns, advanced configurations, and best practices.

## Basic Examples

### Simple Timing Selection

```tsx
import { useState } from 'react';
import { FocusTrappedCheckboxGroup } from '@/components/ui/FocusTrappedCheckboxGroup';

function BasicTimingExample() {
  const [selectedTimings, setSelectedTimings] = useState<string[]>([]);
  
  const timingOptions = [
    { id: 'morning', label: 'Morning (6 AM - 12 PM)' },
    { id: 'afternoon', label: 'Afternoon (12 PM - 6 PM)' },
    { id: 'evening', label: 'Evening (6 PM - 10 PM)' },
    { id: 'bedtime', label: 'Bedtime (10 PM - 6 AM)' }
  ];

  const handleContinue = () => {
    console.log('Selected timings:', selectedTimings);
    // Process selection...
  };

  return (
    <FocusTrappedCheckboxGroup
      id="basic-timing"
      title="When should this medication be taken?"
      checkboxes={timingOptions}
      selectedIds={selectedTimings}
      onSelectionChange={setSelectedTimings}
      onContinue={handleContinue}
      helpText="Select all applicable times"
    />
  );
}
```

### Enhanced Version with Additional Inputs

```tsx
import { useState } from 'react';
import { EnhancedFocusTrappedCheckboxGroup } from '@/components/ui/FocusTrappedCheckboxGroup';

function EnhancedTimingExample() {
  const [selectedTimings, setSelectedTimings] = useState<string[]>([]);
  const [additionalData, setAdditionalData] = useState<Record<string, string>>({});
  
  const timingOptions = [
    { 
      id: 'specific-times', 
      label: 'Specific Times',
      metadata: {
        type: 'text',
        label: 'Enter specific times',
        placeholder: 'e.g., 8 AM, 2 PM, 8 PM'
      }
    },
    { 
      id: 'prn', 
      label: 'As Needed (PRN)',
      metadata: {
        type: 'range-hours',
        label: 'Minimum hours between doses',
        placeholder: 'e.g., 4-6'
      }
    },
    { 
      id: 'with-meals', 
      label: 'With Meals'
    },
    { 
      id: 'before-bed', 
      label: 'Before Bedtime'
    }
  ];

  return (
    <EnhancedFocusTrappedCheckboxGroup
      id="enhanced-timing"
      title="Dosage Timing Configuration"
      checkboxes={timingOptions}
      selectedIds={selectedTimings}
      onSelectionChange={setSelectedTimings}
      additionalData={additionalData}
      onAdditionalDataChange={setAdditionalData}
      onContinue={() => {
        console.log('Timing:', selectedTimings);
        console.log('Additional data:', additionalData);
      }}
      helpText="Select timing options and provide additional details where needed"
    />
  );
}
```

## Advanced Integration Examples

### Form Integration with Validation

```tsx
import { useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { MedicationViewModel } from '@/viewModels/medication/MedicationManagementViewModel';

const MedicationTimingForm = observer(() => {
  const [vm] = useState(() => new MedicationViewModel());
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    // Validate selection
    if (vm.selectedTimings.length === 0) {
      setValidationError('Please select at least one timing option');
    } else {
      setValidationError('');
    }
  }, [vm.selectedTimings]);

  const timingOptions = [
    { id: 'daily', label: 'Once Daily' },
    { id: 'bid', label: 'Twice Daily (BID)' },
    { id: 'tid', label: 'Three Times Daily (TID)' },
    { id: 'qid', label: 'Four Times Daily (QID)' },
    { 
      id: 'custom', 
      label: 'Custom Schedule',
      metadata: {
        type: 'text',
        label: 'Describe custom schedule',
        placeholder: 'e.g., Every 8 hours'
      }
    }
  ];

  return (
    <div className="medication-form-section">
      <EnhancedFocusTrappedCheckboxGroup
        id="medication-timing"
        title="Dosage Frequency"
        checkboxes={timingOptions}
        selectedIds={vm.selectedTimings}
        onSelectionChange={vm.setSelectedTimings}
        additionalData={vm.timingAdditionalData}
        onAdditionalDataChange={vm.setTimingAdditionalData}
        onContinue={vm.saveTimingConfiguration}
        onCancel={vm.resetTimingConfiguration}
        errorMessage={validationError}
        helpText="Select how often this medication should be taken"
      />
    </div>
  );
});
```

### Multi-Step Wizard Integration

```tsx
function MedicationWizard() {
  const [currentStep, setCurrentStep] = useState(0);
  const [wizardData, setWizardData] = useState({
    timing: [],
    conditions: [],
    restrictions: []
  });

  const steps = [
    {
      component: TimingStep,
      title: 'Dosage Timing',
      data: wizardData.timing,
      onChange: (data) => setWizardData(prev => ({ ...prev, timing: data }))
    },
    {
      component: ConditionsStep,
      title: 'Food Conditions',
      data: wizardData.conditions,
      onChange: (data) => setWizardData(prev => ({ ...prev, conditions: data }))
    },
    {
      component: RestrictionsStep,
      title: 'Special Restrictions',
      data: wizardData.restrictions,
      onChange: (data) => setWizardData(prev => ({ ...prev, restrictions: data }))
    }
  ];

  const currentStepData = steps[currentStep];
  const Component = currentStepData.component;

  return (
    <div className="wizard-container">
      <div className="wizard-progress">
        Step {currentStep + 1} of {steps.length}: {currentStepData.title}
      </div>
      
      <Component
        data={currentStepData.data}
        onChange={currentStepData.onChange}
        onNext={() => setCurrentStep(prev => Math.min(prev + 1, steps.length - 1))}
        onPrevious={() => setCurrentStep(prev => Math.max(prev - 1, 0))}
        isLastStep={currentStep === steps.length - 1}
      />
    </div>
  );
}

function TimingStep({ data, onChange, onNext, onPrevious, isLastStep }) {
  const timingOptions = [
    { id: 'morning', label: 'Morning' },
    { id: 'afternoon', label: 'Afternoon' },
    { id: 'evening', label: 'Evening' }
  ];

  return (
    <FocusTrappedCheckboxGroup
      id="wizard-timing"
      title="When should this medication be taken?"
      checkboxes={timingOptions}
      selectedIds={data}
      onSelectionChange={onChange}
      onContinue={onNext}
      onCancel={onPrevious}
      helpText={isLastStep ? "Review and confirm your selections" : "Select timing and continue"}
    />
  );
}
```

## Accessibility Examples

### Screen Reader Optimized

```tsx
function AccessibleTimingSelection() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [announcements, setAnnouncements] = useState('');

  const handleSelectionChange = (newSelection: string[]) => {
    setSelectedIds(newSelection);
    
    // Custom announcements for screen readers
    const count = newSelection.length;
    if (count === 0) {
      setAnnouncements('No timing options selected');
    } else if (count === 1) {
      setAnnouncements('1 timing option selected');
    } else {
      setAnnouncements(`${count} timing options selected`);
    }
  };

  const timingOptions = [
    { id: 'morning', label: 'Morning dose' },
    { id: 'evening', label: 'Evening dose' },
    { id: 'prn', label: 'As needed for pain' }
  ];

  return (
    <div>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcements}
      </div>
      
      <FocusTrappedCheckboxGroup
        id="accessible-timing"
        title="Medication Dosage Schedule"
        checkboxes={timingOptions}
        selectedIds={selectedIds}
        onSelectionChange={handleSelectionChange}
        helpText="Use arrow keys to navigate options, space to select"
      />
    </div>
  );
}
```

## Performance Examples

### Large Dataset Optimization

```tsx
import { useMemo } from 'react';

function OptimizedLargeList() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchFilter, setSearchFilter] = useState('');

  // Large dataset simulation
  const allMedications = useMemo(() => 
    Array.from({ length: 1000 }, (_, i) => ({
      id: `med-${i}`,
      label: `Medication ${i + 1}`,
      category: i % 10 === 0 ? 'high-priority' : 'standard'
    }))
  , []);

  // Filtered and memoized options
  const filteredOptions = useMemo(() => {
    return allMedications.filter(med => 
      med.label.toLowerCase().includes(searchFilter.toLowerCase())
    ).slice(0, 50); // Limit for performance
  }, [allMedications, searchFilter]);

  return (
    <div>
      <input
        type="text"
        placeholder="Filter medications..."
        value={searchFilter}
        onChange={(e) => setSearchFilter(e.target.value)}
        className="mb-4 p-2 border rounded"
      />
      
      <FocusTrappedCheckboxGroup
        id="large-medication-list"
        title={`Medications (showing ${filteredOptions.length} of ${allMedications.length})`}
        checkboxes={filteredOptions}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        helpText="Filter to find specific medications"
      />
    </div>
  );
}
```

## Testing Examples

### Component Testing

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { FocusTrappedCheckboxGroup } from '@/components/ui/FocusTrappedCheckboxGroup';

describe('FocusTrappedCheckboxGroup Examples', () => {
  const mockOptions = [
    { id: 'option1', label: 'Option 1' },
    { id: 'option2', label: 'Option 2' }
  ];

  test('basic selection flow', () => {
    const onSelectionChange = jest.fn();
    
    render(
      <FocusTrappedCheckboxGroup
        id="test-group"
        title="Test Options"
        checkboxes={mockOptions}
        selectedIds={[]}
        onSelectionChange={onSelectionChange}
      />
    );

    // Select first option
    fireEvent.click(screen.getByLabelText('Option 1'));
    expect(onSelectionChange).toHaveBeenCalledWith(['option1']);

    // Verify accessibility
    expect(screen.getByRole('group')).toHaveAttribute('aria-labelledby');
  });

  test('keyboard navigation', () => {
    render(
      <FocusTrappedCheckboxGroup
        id="keyboard-test"
        title="Keyboard Test"
        checkboxes={mockOptions}
        selectedIds={[]}
        onSelectionChange={() => {}}
      />
    );

    const firstOption = screen.getByLabelText('Option 1');
    firstOption.focus();

    // Test arrow key navigation
    fireEvent.keyDown(firstOption, { key: 'ArrowDown' });
    expect(screen.getByLabelText('Option 2')).toHaveFocus();
  });
});
```

## Best Practices

### Error Handling

```tsx
function RobustTimingSelection() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const timingOptions = [
    { id: 'morning', label: 'Morning' },
    { id: 'evening', label: 'Evening' }
  ];

  const handleContinue = async () => {
    setIsLoading(true);
    setError('');

    try {
      if (selectedIds.length === 0) {
        throw new Error('Please select at least one timing option');
      }

      await saveMedicationTiming(selectedIds);
      // Success handling...
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <FocusTrappedCheckboxGroup
      id="robust-timing"
      title="Medication Timing"
      checkboxes={timingOptions}
      selectedIds={selectedIds}
      onSelectionChange={setSelectedIds}
      onContinue={handleContinue}
      errorMessage={error}
      helpText={isLoading ? 'Saving...' : 'Select timing options'}
    />
  );
}
```

These examples demonstrate the flexibility and power of the FocusTrappedCheckboxGroup components while maintaining accessibility and performance standards.
