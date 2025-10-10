import React, { useRef, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { EnhancedFocusTrappedCheckboxGroup } from '@/components/ui/FocusTrappedCheckboxGroup/EnhancedFocusTrappedCheckboxGroup';
import { DosageTimingViewModel } from '@/viewModels/medication/DosageTimingViewModel';

interface DosageTimingsInputProps {
  selectedTimings: string[];
  selectedFrequencies?: string[]; // New prop to receive frequencies from parent
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
  selectedFrequencies,
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
  
  // Sync selected frequencies with ViewModel for business logic decisions
  useEffect(() => {
    viewModel.setSelectedFrequencies(selectedFrequencies || []);
  }, [selectedFrequencies, viewModel]);

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

  const handleFieldBlur = (checkboxId: string) => {
    viewModel.markFieldTouched(checkboxId);
  };

  const handleBack = () => {
    // Preserve current selections
    // Focus Dosage Frequency at tabIndex 9
    const prevElement = document.querySelector('[tabindex="9"]') as HTMLElement;
    prevElement?.focus();
  };

  const handleCancel = () => {
    // Trigger sorting so selected items appear first next time
    viewModel.triggerSort();
    
    viewModel.reset();
    onTimingsChange([]);
    onClose?.();
    // Focus next element (Food Conditions at tabIndex 11)
    const nextElement = document.querySelector('[tabindex="11"]') as HTMLElement;
    nextElement?.focus();
  };

  const handleContinue = (selectedIds: string[], additionalData: Map<string, any>) => {
    console.log('[DosageTimings] Continue pressed:', { selectedIds, hasPRNSelection });
    
    // Validate using ViewModel business logic (which now considers PRN context)
    if (!viewModel.isValid) {
      console.warn('[DosageTimings] Invalid timing configuration - blocking continue');
      return;
    }
    
    // Get the complete configuration
    const config = viewModel.getTimingConfiguration();
    console.log('[DosageTimings] Configuration:', config);
    
    // Trigger sorting so selected items appear first next time
    viewModel.triggerSort();
    
    // Update parent
    onTimingsChange(selectedIds);
    onClose?.();
    
    console.log('[DosageTimings] Advancing focus to Food Conditions (tabIndex 11)');
    // Focus should advance to next element (Food Conditions at tabIndex 11)
    const nextElement = document.querySelector('[tabindex="11"]') as HTMLElement;
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

  // Check if PRN (as-needed) frequency is selected
  const hasPRNSelection = selectedFrequencies?.some(
    freq => freq === 'prn' || freq === 'prn-max'
  );
  

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
        onFieldBlur={handleFieldBlur}
        onCancel={handleCancel}
        onContinue={handleContinue}
        onBack={handleBack}
        showBackButton={true}
        backButtonText="← Back"
        previousTabIndex={9}
        baseTabIndex={10}
        nextTabIndex={11}
        ariaLabel="Select dosage timing options"
        isRequired={false}
        hasError={hasError}
        errorMessage={errorMessage}
        helpText="Select timing options. Navigation: Arrows • Select: Space • Back: Backspace/Shift+Tab • Continue: Enter"
        continueButtonBehavior={{
          allowSkipSelection: hasPRNSelection,
          skipMessage: hasPRNSelection 
            ? "Timing selection optional for as-needed medications" 
            : undefined
        }}
      />
    </div>
  );
});