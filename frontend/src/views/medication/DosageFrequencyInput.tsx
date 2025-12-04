import React, { useRef, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { EnhancedFocusTrappedCheckboxGroup } from '@/components/ui/FocusTrappedCheckboxGroup/EnhancedFocusTrappedCheckboxGroup';
import { DosageFrequencyViewModel } from '@/viewModels/medication/DosageFrequencyViewModel';

interface DosageFrequencyInputProps {
  selectedFrequencies: string[];
  onFrequenciesChange: (frequencies: string[]) => void;
  onClose?: () => void;
  errors?: Map<string, string>;
}

/**
 * Enhanced DosageFrequencyInput with support for dynamic additional inputs
 * Uses the DosageFrequencyViewModel for business logic
 * When "As Needed – PRN" is selected, shows an optional text input for notes
 * When "As Needed, Not to Exceed Every X Hours – PRN" is selected, shows a required numeric input
 */
export const DosageFrequencyInput: React.FC<DosageFrequencyInputProps> = observer(({
  selectedFrequencies,
  onFrequenciesChange,
  onClose,
  errors
}) => {
  // Create ViewModel instance
  const viewModelRef = useRef<DosageFrequencyViewModel | null>(null);
  
  if (!viewModelRef.current) {
    viewModelRef.current = new DosageFrequencyViewModel();
  }
  
  const viewModel = viewModelRef.current;
  
  // Sync selected frequencies with ViewModel
  useEffect(() => {
    // Update ViewModel to match props
    selectedFrequencies.forEach(id => {
      const metadata = viewModel.checkboxMetadata.find(m => m.id === id);
      if (metadata && !metadata.checked) {
        viewModel.handleCheckboxChange(id, true);
      }
    });
    
    // Uncheck items not in selectedFrequencies
    viewModel.checkboxMetadata.forEach(metadata => {
      if (!selectedFrequencies.includes(metadata.id) && metadata.checked) {
        viewModel.handleCheckboxChange(metadata.id, false);
      }
    });
  }, [selectedFrequencies, viewModel]);

  const handleSelectionChange = (id: string, checked: boolean) => {
    viewModel.handleCheckboxChange(id, checked);
    
    // Update parent with new selection
    const newSelection = viewModel.checkboxMetadata
      .filter(m => m.checked)
      .map(m => m.id);
    
    onFrequenciesChange(newSelection);
  };

  const handleAdditionalDataChange = (checkboxId: string, data: any) => {
    viewModel.handleAdditionalDataChange(checkboxId, data);
    
    // Log the additional data for debugging
    console.log(`Additional data for ${checkboxId}:`, data);
  };

  const handleFieldBlur = (checkboxId: string) => {
    viewModel.markFieldTouched(checkboxId);
  };

  const handleBack = () => {
    // Preserve current selections (no reset)
    // Focus previous element (Dosage Unit at tabIndex 8)
    const prevElement = document.querySelector('[tabindex="8"]') as HTMLElement;
    prevElement?.focus();
  };

  const handleCancel = () => {
    // Trigger sorting so selected items appear first next time
    viewModel.triggerSort();
    
    viewModel.reset();
    onFrequenciesChange([]);
    onClose?.();
    // Focus next element (Dosage Timings at tabIndex 10)
    const nextElement = document.querySelector('[tabindex="10"]') as HTMLElement;
    nextElement?.focus();
  };

  const handleContinue = (selectedIds: string[], _additionalData: Map<string, unknown>) => {
    // Validate before continuing
    if (!viewModel.isValid) {
      console.warn('Invalid frequency configuration');
      return;
    }
    
    // Get the complete configuration
    const config = viewModel.getFrequencyConfiguration();
    console.log('Dosage frequency configuration:', config);
    
    // Trigger sorting so selected items appear first next time
    viewModel.triggerSort();
    
    // Update parent
    onFrequenciesChange(selectedIds);
    onClose?.();
    
    // Focus should advance to next element (Dosage Timings at tabIndex 10)
    const nextElement = document.querySelector('[tabindex="10"]') as HTMLElement;
    nextElement?.focus();
  };
  
  const handleFocusLost = () => {
    viewModel.handleFocusLost();
    
    // Announce reorder if it happened
    if (viewModel._hasReorderedOnce && viewModel.hasSelectedItems) {
      const announcement = document.getElementById('dosage-frequency-announcements');
      if (announcement) {
        announcement.textContent = 'Selected frequency options have been moved to the top of the list';
      }
    }
  };

  // Combine errors from props and ViewModel
  const hasError = (errors?.has('dosageFrequency') || viewModel.validationErrors.size > 0) ?? false;
  const errorMessage = errors?.get('dosageFrequency') || 
    (viewModel.validationErrors.size > 0 
      ? Array.from(viewModel.validationErrors.values()).join(', ')
      : undefined);

  return (
    <div className="col-span-2">
      <EnhancedFocusTrappedCheckboxGroup
        id="dosage-frequency"
        title="Dosage Frequency"
        checkboxes={viewModel.displayCheckboxes} // Use computed display order
        showLabel={true} // Show title above the container
        enableReordering={viewModel.config.enableReordering}
        maxVisibleItems={viewModel.config.maxVisibleItems}
        summaryRenderer={(id, data) => viewModel.getSummaryText(id, data)}
        onFocusLost={handleFocusLost}
        onSelectionChange={handleSelectionChange}
        onAdditionalDataChange={handleAdditionalDataChange}
        onFieldBlur={handleFieldBlur}
        onCancel={handleCancel}
        onContinue={handleContinue}
        onBack={handleBack}
        showBackButton={true}
        backButtonText="← Back"
        previousTabIndex={8}
        baseTabIndex={9}
        nextTabIndex={10}
        ariaLabel="Select dosage frequency options"
        isRequired={false}
        hasError={hasError}
        errorMessage={errorMessage}
        helpText="Select frequency options. Navigation: Arrows • Select: Space • Back: Backspace/Shift+Tab • Continue: Enter"
      />
    </div>
  );
});