import React, { useRef, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { EnhancedFocusTrappedCheckboxGroup } from '@/components/ui/FocusTrappedCheckboxGroup/EnhancedFocusTrappedCheckboxGroup';
import { SpecialRestrictionsViewModel } from '@/viewModels/medication/SpecialRestrictionsViewModel';

interface SpecialRestrictionsInputProps {
  selectedSpecialRestrictions: string[];
  onSpecialRestrictionsChange: (restrictions: string[]) => void;
  onClose?: () => void;
  errors?: Map<string, string>;
}

/**
 * Special Restrictions input component with checkbox selection
 * Uses the SpecialRestrictionsViewModel for business logic
 * Supports the "Other" checkbox with mandatory multiline text input
 * Follows the same pattern as Dosage Timings
 */
export const SpecialRestrictionsInput: React.FC<SpecialRestrictionsInputProps> = observer(({
  selectedSpecialRestrictions,
  onSpecialRestrictionsChange,
  onClose,
  errors
}) => {
  // Create ViewModel instance
  const viewModelRef = useRef<SpecialRestrictionsViewModel | null>(null);
  
  if (!viewModelRef.current) {
    viewModelRef.current = new SpecialRestrictionsViewModel();
  }
  
  const viewModel = viewModelRef.current;
  
  // Sync selected special restrictions with ViewModel
  useEffect(() => {
    // Update ViewModel to match props
    selectedSpecialRestrictions.forEach(id => {
      const metadata = viewModel.checkboxMetadata.find(m => m.id === id);
      if (metadata && !metadata.checked) {
        viewModel.handleCheckboxChange(id, true);
      }
    });
    
    // Uncheck items not in selectedSpecialRestrictions
    viewModel.checkboxMetadata.forEach(metadata => {
      if (!selectedSpecialRestrictions.includes(metadata.id) && metadata.checked) {
        viewModel.handleCheckboxChange(metadata.id, false);
      }
    });
  }, [selectedSpecialRestrictions, viewModel]);

  const handleSelectionChange = (id: string, checked: boolean) => {
    viewModel.handleCheckboxChange(id, checked);
    
    // Update parent with new selection
    const newSelection = viewModel.checkboxMetadata
      .filter(m => m.checked)
      .map(m => m.id);
    onSpecialRestrictionsChange(newSelection);
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
    // Focus Food Conditions at tabIndex 11
    const prevElement = document.querySelector('[tabindex="11"]') as HTMLElement;
    prevElement?.focus();
  };

  const handleCancel = () => {
    // Trigger sorting so selected items appear first next time
    viewModel.triggerSort();
    
    viewModel.reset();
    onSpecialRestrictionsChange([]);
    onClose?.();
    // Focus next element (Date Selection at tabIndex 13)
    const nextElement = document.querySelector('[tabindex="13"]') as HTMLElement;
    nextElement?.focus();
  };

  const handleContinue = (selectedIds: string[], _additionalData: Map<string, unknown>) => {
    // Validate before continuing
    if (!viewModel.isValid) {
      console.warn('Invalid special restrictions configuration');
      return;
    }
    
    // Get the complete configuration
    const config = viewModel.getSpecialRestrictionsConfiguration();
    console.log('Special restrictions configuration:', config);
    
    // Trigger sorting so selected items appear first next time
    viewModel.triggerSort();
    
    // Update parent
    onSpecialRestrictionsChange(selectedIds);
    onClose?.();
    
    // Focus should advance to next element (Date Selection at tabIndex 13)
    const nextElement = document.querySelector('[tabindex="13"]') as HTMLElement;
    nextElement?.focus();
  };
  
  const handleFocusLost = () => {
    viewModel.handleFocusLost();
    
    // Announce reorder if it happened
    if (viewModel._hasReorderedOnce && viewModel.hasSelectedItems) {
      const announcement = document.getElementById('special-restrictions-announcements');
      if (announcement) {
        announcement.textContent = 'Selected restriction options have been moved to the top of the list';
      }
    }
  };

  // Combine errors from props and ViewModel
  const hasError = (errors?.has('specialRestrictions') || viewModel.validationErrors.size > 0) ?? false;
  const errorMessage = errors?.get('specialRestrictions') || 
    (viewModel.validationErrors.size > 0 
      ? Array.from(viewModel.validationErrors.values()).join(', ')
      : undefined);

  return (
    <div className="col-span-2">
      <EnhancedFocusTrappedCheckboxGroup
        id="special-restrictions"
        title="Special Restrictions"
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
        previousTabIndex={11}
        baseTabIndex={12}
        nextTabIndex={13}
        ariaLabel="Select special restriction options"
        isRequired={false}
        hasError={hasError}
        errorMessage={errorMessage}
        helpText="Select special restrictions. Navigation: Arrows • Select: Space • Back: Backspace/Shift+Tab • Continue: Enter"
        continueButtonBehavior={{
          allowSkipSelection: true,
          skipMessage: "This section is optional"
        }}
      />
      
      {/* Hidden announcements for screen readers */}
      <div id="special-restrictions-announcements" className="sr-only" aria-live="polite" aria-atomic="true" />
    </div>
  );
});