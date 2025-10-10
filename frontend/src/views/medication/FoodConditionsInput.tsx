import React, { useRef, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { EnhancedFocusTrappedCheckboxGroup } from '@/components/ui/FocusTrappedCheckboxGroup/EnhancedFocusTrappedCheckboxGroup';
import { FoodConditionsViewModel } from '@/viewModels/medication/FoodConditionsViewModel';

interface FoodConditionsInputProps {
  selectedFoodConditions: string[];
  onFoodConditionsChange: (conditions: string[]) => void;
  onClose?: () => void;
  errors?: Map<string, string>;
}

/**
 * Food Conditions input component with checkbox selection
 * Uses the FoodConditionsViewModel for business logic
 * Supports the "Other" checkbox with mandatory multiline text input
 */
export const FoodConditionsInput: React.FC<FoodConditionsInputProps> = observer(({
  selectedFoodConditions,
  onFoodConditionsChange,
  onClose,
  errors
}) => {
  // Create ViewModel instance
  const viewModelRef = useRef<FoodConditionsViewModel | null>(null);
  
  if (!viewModelRef.current) {
    viewModelRef.current = new FoodConditionsViewModel();
  }
  
  const viewModel = viewModelRef.current;
  
  // Sync selected food conditions with ViewModel
  useEffect(() => {
    // Update ViewModel to match props
    selectedFoodConditions.forEach(id => {
      const metadata = viewModel.checkboxMetadata.find(m => m.id === id);
      if (metadata && !metadata.checked) {
        viewModel.handleCheckboxChange(id, true);
      }
    });
    
    // Uncheck items not in selectedFoodConditions
    viewModel.checkboxMetadata.forEach(metadata => {
      if (!selectedFoodConditions.includes(metadata.id) && metadata.checked) {
        viewModel.handleCheckboxChange(metadata.id, false);
      }
    });
  }, [selectedFoodConditions, viewModel]);

  const handleSelectionChange = (id: string, checked: boolean) => {
    viewModel.handleCheckboxChange(id, checked);
    
    // Update parent with new selection
    const newSelection = viewModel.checkboxMetadata
      .filter(m => m.checked)
      .map(m => m.id);
    onFoodConditionsChange(newSelection);
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
    // Focus Dosage Timings at tabIndex 10
    const prevElement = document.querySelector('[tabindex="10"]') as HTMLElement;
    prevElement?.focus();
  };

  const handleCancel = () => {
    // Trigger sorting so selected items appear first next time
    viewModel.triggerSort();
    
    viewModel.reset();
    onFoodConditionsChange([]);
    onClose?.();
    // Focus next element (Special Restrictions at tabIndex 12)
    const nextElement = document.querySelector('[tabindex="12"]') as HTMLElement;
    nextElement?.focus();
  };

  const handleContinue = (selectedIds: string[], additionalData: Map<string, any>) => {
    // Validate before continuing
    if (!viewModel.isValid) {
      console.warn('Invalid food conditions configuration');
      return;
    }
    
    // Get the complete configuration
    const config = viewModel.getFoodConditionsConfiguration();
    console.log('Food conditions configuration:', config);
    
    // Trigger sorting so selected items appear first next time
    viewModel.triggerSort();
    
    // Update parent
    onFoodConditionsChange(selectedIds);
    onClose?.();
    
    // Focus should advance to next element (Special Restrictions at tabIndex 12)
    const nextElement = document.querySelector('[tabindex="12"]') as HTMLElement;
    nextElement?.focus();
  };
  
  const handleFocusLost = () => {
    viewModel.handleFocusLost();
    
    // Announce reorder if it happened
    if (viewModel._hasReorderedOnce && viewModel.hasSelectedItems) {
      const announcement = document.getElementById('food-conditions-announcements');
      if (announcement) {
        announcement.textContent = 'Selected food condition options have been moved to the top of the list';
      }
    }
  };

  // Combine errors from props and ViewModel
  const hasError = (errors?.has('foodConditions') || viewModel.validationErrors.size > 0) ?? false;
  const errorMessage = errors?.get('foodConditions') || 
    (viewModel.validationErrors.size > 0 
      ? Array.from(viewModel.validationErrors.values()).join(', ')
      : undefined);

  return (
    <div className="col-span-2">
      <EnhancedFocusTrappedCheckboxGroup
        id="food-conditions"
        title="Food Conditions"
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
        previousTabIndex={10}
        baseTabIndex={11}
        nextTabIndex={12}
        ariaLabel="Select food condition options"
        isRequired={false}
        hasError={hasError}
        errorMessage={errorMessage}
        helpText="Select food-related instructions. Navigation: Arrows • Select: Space • Back: Backspace/Shift+Tab • Continue: Enter"
        continueButtonBehavior={{
          allowSkipSelection: true,
          skipMessage: "This section is optional"
        }}
      />
      
      {/* Hidden announcements for screen readers */}
      <div id="food-conditions-announcements" className="sr-only" aria-live="polite" aria-atomic="true" />
    </div>
  );
});