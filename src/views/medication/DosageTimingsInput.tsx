import React, { useRef, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { EnhancedFocusTrappedCheckboxGroup } from '@/components/ui/FocusTrappedCheckboxGroup/EnhancedFocusTrappedCheckboxGroup';
import { DosageTimingViewModel } from '@/viewModels/medication/DosageTimingViewModel';

interface DosageTimingsInputProps {
  selectedTimings: string[];
  onTimingsChange: (timings: string[]) => void;
  onClose?: () => void;
  errors?: Map<string, string>;
}

/**
 * Enhanced DosageTimingsInput with support for dynamic additional inputs
 * Uses the DosageTimingViewModel for business logic
 * When "Every X Hours" is selected, shows a numeric input for hours
 * When "Specific Times" is selected, shows a text input for times
 * When "As Needed - PRN" is selected, shows a dropdown for max frequency
 */
export const DosageTimingsInput: React.FC<DosageTimingsInputProps> = observer(({
  selectedTimings,
  onTimingsChange,
  onClose,
  errors
}) => {
  // Create ViewModel instance
  const viewModelRef = useRef<DosageTimingViewModel | null>(null);
  
  if (!viewModelRef.current) {
    viewModelRef.current = new DosageTimingViewModel();
  }
  
  const viewModel = viewModelRef.current;
  
  // Sync selected timings with ViewModel
  useEffect(() => {
    // Update ViewModel to match props
    selectedTimings.forEach(id => {
      const metadata = viewModel.checkboxMetadata.find(m => m.id === id);
      if (metadata && !metadata.checked) {
        viewModel.handleCheckboxChange(id, true);
      }
    });
    
    // Uncheck items not in selectedTimings
    viewModel.checkboxMetadata.forEach(metadata => {
      if (!selectedTimings.includes(metadata.id) && metadata.checked) {
        viewModel.handleCheckboxChange(metadata.id, false);
      }
    });
  }, [selectedTimings, viewModel]);

  const handleSelectionChange = (id: string, checked: boolean) => {
    viewModel.handleCheckboxChange(id, checked);
    
    // Update parent with new selection
    const newSelection = viewModel.checkboxMetadata
      .filter(m => m.checked)
      .map(m => m.id);
    onTimingsChange(newSelection);
  };

  const handleAdditionalDataChange = (checkboxId: string, data: any) => {
    viewModel.handleAdditionalDataChange(checkboxId, data);
    
    // Log the additional data for debugging
    console.log(`Additional data for ${checkboxId}:`, data);
  };

  const handleCancel = () => {
    viewModel.reset();
    onTimingsChange([]);
    onClose?.();
    // Focus next element (Date Selection at tabIndex 10)
    const nextElement = document.querySelector('[tabindex="10"]') as HTMLElement;
    nextElement?.focus();
  };

  const handleContinue = (selectedIds: string[], additionalData: Map<string, any>) => {
    // Validate before continuing
    if (!viewModel.isValid) {
      console.warn('Invalid timing configuration');
      return;
    }
    
    // Get the complete configuration
    const config = viewModel.getTimingConfiguration();
    console.log('Dosage timing configuration:', config);
    
    // Update parent
    onTimingsChange(selectedIds);
    onClose?.();
    
    // Focus should advance to next element (Date Selection at tabIndex 10)
    const nextElement = document.querySelector('[tabindex="10"]') as HTMLElement;
    nextElement?.focus();
  };
  
  const handleFocusLost = () => {
    viewModel.handleFocusLost();
    
    // Announce reorder if it happened
    if (viewModel._hasReorderedOnce && viewModel.hasSelectedItems) {
      const announcement = document.getElementById('dosage-timings-announcements');
      if (announcement) {
        announcement.textContent = 'Selected timing options have been moved to the top of the list';
      }
    }
  };

  // Combine errors from props and ViewModel
  const hasError = (errors?.has('dosageTimings') || viewModel.validationErrors.size > 0) ?? false;
  const errorMessage = errors?.get('dosageTimings') || 
    (viewModel.validationErrors.size > 0 
      ? Array.from(viewModel.validationErrors.values()).join(', ')
      : undefined);

  return (
    <div className="col-span-2">
      <EnhancedFocusTrappedCheckboxGroup
        id="dosage-timings"
        title="Dosage Timings"
        checkboxes={viewModel.displayCheckboxes} // Use computed display order
        showLabel={true} // Show title above the container
        enableReordering={viewModel.config.enableReordering}
        maxVisibleItems={viewModel.config.maxVisibleItems}
        summaryRenderer={(id, data) => viewModel.getSummaryText(id, data)}
        onFocusLost={handleFocusLost}
        onSelectionChange={handleSelectionChange}
        onAdditionalDataChange={handleAdditionalDataChange}
        onCancel={handleCancel}
        onContinue={handleContinue}
        baseTabIndex={9}
        nextTabIndex={10}
        ariaLabel="Select dosage timing options"
        isRequired={false}
        hasError={hasError}
        errorMessage={errorMessage}
        helpText="Select timing options for medication. Some options require additional information."
      />
    </div>
  );
});