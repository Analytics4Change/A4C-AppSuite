import { makeAutoObservable, runInAction, computed } from 'mobx';
import { CheckboxMetadata, ValidationRule } from '@/components/ui/FocusTrappedCheckboxGroup/metadata-types';
import { FoodConditionsSummaryStrategy } from '@/components/ui/FocusTrappedCheckboxGroup/summary-strategies';

/**
 * ViewModel for managing food conditions selections with dynamic additional inputs
 * Implements business logic for medication food-related instructions
 * Follows the same pattern as DosageTimingViewModel with smart reordering
 */
export class FoodConditionsViewModel {
  checkboxMetadata: CheckboxMetadata[] = [];
  additionalData: Map<string, any> = new Map();
  validationErrors: Map<string, string> = new Map();
  touchedFields: Set<string> = new Set();  // Track which fields have been interacted with
  
  // Reordering state (exposed for announcement handling)
  _hasReorderedOnce = false;
  _hasFocusedOnce = false;
  
  // Configuration for this specific use case
  readonly config = {
    enableReordering: true,  // Food Conditions wants reordering like Dosage Timings
    reorderTrigger: 'onBlur' as const,
    maxVisibleItems: 7,
    summaryStrategy: new FoodConditionsSummaryStrategy()
  };
  
  constructor() {
    makeAutoObservable(this, {
      displayCheckboxes: computed,
      hasSelectedItems: computed
    });
    this.initializeMetadata();
  }
  
  /**
   * Computed property for display order - reorders once after first focus loss
   */
  get displayCheckboxes(): CheckboxMetadata[] {
    // Create deep copies of checkbox objects to ensure React detects changes
    const source = this.checkboxMetadata.map(cb => ({ ...cb }));
    
    // Skip reordering if not enabled
    if (!this.config.enableReordering) {
      return source;
    }
    
    // Only reorder once after first focus loss with selections
    if (!this._hasReorderedOnce || !this.hasSelectedItems) {
      return source;
    }
    
    // Sort by checked status first (selected items first), then by originalIndex
    return source.sort((a, b) => {
      // First sort by checked status (true before false)
      if (a.checked !== b.checked) {
        return a.checked ? -1 : 1;
      }
      // Then sort by originalIndex to maintain original order within each group
      return (a.originalIndex || 0) - (b.originalIndex || 0);
    });
  }
  
  /**
   * Check if any items are selected
   */
  get hasSelectedItems(): boolean {
    return this.checkboxMetadata.some(cb => cb.checked);
  }
  
  /**
   * Mark that the group has been focused
   */
  handleFocusEntered() {
    this._hasFocusedOnce = true;
  }
  
  /**
   * Handle focus lost - trigger reordering if conditions are met
   */
  handleFocusLost() {
    if (this.config.enableReordering && 
        this._hasFocusedOnce && 
        !this._hasReorderedOnce && 
        this.hasSelectedItems) {
      runInAction(() => {
        this._hasReorderedOnce = true;
      });
    }
  }
  
  /**
   * Manually trigger sorting - called when Continue or Cancel is clicked
   */
  triggerSort() {
    if (this.config.enableReordering && this.hasSelectedItems) {
      runInAction(() => {
        this._hasReorderedOnce = true;
        this._hasFocusedOnce = true;
      });
    }
  }
  
  /**
   * Get summary text for a checkbox using the configured strategy
   */
  getSummaryText(checkboxId: string, data: any): string {
    return this.config.summaryStrategy.generateSummary(checkboxId, data);
  }
  
  /**
   * Initialize checkbox metadata with strategies for additional inputs
   */
  private initializeMetadata() {
    this.checkboxMetadata = [
      {
        id: 'empty-stomach',
        label: 'Take On An Empty Stomach (1 Hour Before Or 2 Hours After Food)',
        value: 'empty-stomach',
        checked: false,
        description: 'Must be taken on an empty stomach',
        requiresAdditionalInput: false,
        originalIndex: 0
      },
      {
        id: 'before-meals',
        label: 'Take Before Meals (AC)',
        value: 'before-meals',
        checked: false,
        description: 'Take before eating',
        requiresAdditionalInput: false,
        originalIndex: 1
      },
      {
        id: 'after-meals',
        label: 'Take After Meals (PC)',
        value: 'after-meals',
        checked: false,
        description: 'Take after eating',
        requiresAdditionalInput: false,
        originalIndex: 2
      },
      {
        id: 'with-food',
        label: 'Take With Food',
        value: 'with-food',
        checked: false,
        description: 'Should be taken with food',
        requiresAdditionalInput: false,
        originalIndex: 3
      },
      {
        id: 'full-meal',
        label: 'Take With A Full Meal',
        value: 'full-meal',
        checked: false,
        description: 'Requires a full meal',
        requiresAdditionalInput: false,
        originalIndex: 4
      },
      {
        id: 'light-snack',
        label: 'Take With A Light Snack',
        value: 'light-snack',
        checked: false,
        description: 'Can be taken with a light snack',
        requiresAdditionalInput: false,
        originalIndex: 5
      },
      {
        id: 'full-water',
        label: 'Take With A Full Glass Of Water',
        value: 'full-water',
        checked: false,
        description: 'Must be taken with plenty of water',
        requiresAdditionalInput: false,
        originalIndex: 6
      },
      {
        id: 'morning-water',
        label: 'Take 30 Minutes Before Breakfast With A Full Glass Of Water; Do Not Lie Down For 30 Minutes',
        value: 'morning-water',
        checked: false,
        description: 'Special morning dosing instructions',
        requiresAdditionalInput: false,
        originalIndex: 7
      },
      {
        id: 'same-time',
        label: 'Take At The Same Time Each Day With Or Without Food',
        value: 'same-time',
        checked: false,
        description: 'Consistent daily timing',
        requiresAdditionalInput: false,
        originalIndex: 8
      },
      {
        id: 'consistent-meals',
        label: 'Take Consistently With Regard To Meals',
        value: 'consistent-meals',
        checked: false,
        description: 'Always take the same way relative to meals',
        requiresAdditionalInput: false,
        originalIndex: 9
      },
      {
        id: 'other',
        label: 'Other',
        value: 'other',
        checked: false,
        description: 'Specify other food-related instructions',
        requiresAdditionalInput: true,
        originalIndex: 10,
        additionalInputStrategy: {
          componentType: 'textarea',
          componentProps: {
            placeholder: 'Enter specific food instructions',
            ariaLabel: 'Enter other food-related instructions',
            helpText: 'Specify any other food-related instructions (required)',
            maxLength: 500,
            rows: 2,  // Show 2 lines when unfocused
            autoResize: true  // Expand to show all content when focused
          },
          validationRules: [
            { type: 'required', message: 'Instructions required when Other is selected' },
            { type: 'minLength', min: 3, message: 'Please enter at least 3 characters' }
          ],
          focusManagement: {
            autoFocus: true,
            returnFocusTo: 'checkbox',
            trapFocus: false
          }
        }
      }
    ];
  }
  
  /**
   * Handle checkbox selection change
   */
  handleCheckboxChange(id: string, checked: boolean) {
    runInAction(() => {
      const metadata = this.checkboxMetadata.find(m => m.id === id);
      if (metadata) {
        metadata.checked = checked;
        
        // Clear additional data, validation errors, and touched state if unchecked
        if (!checked) {
          this.additionalData.delete(id);
          this.validationErrors.delete(id);
          this.touchedFields.delete(id);
        }
      }
    });
  }
  
  /**
   * Handle additional data change with validation
   */
  handleAdditionalDataChange(checkboxId: string, data: any) {
    runInAction(() => {
      const metadata = this.checkboxMetadata.find(m => m.id === checkboxId);
      if (!metadata) return;
      
      // Store the data
      if (data === null || data === undefined || data === '') {
        this.additionalData.delete(checkboxId);
      } else {
        this.additionalData.set(checkboxId, data);
      }
      
      // Only validate if the field has been touched OR has a non-empty value
      if (metadata.additionalInputStrategy?.validationRules &&
          (this.touchedFields.has(checkboxId) || data)) {
        const error = this.validateData(data, metadata.additionalInputStrategy.validationRules);
        if (error) {
          this.validationErrors.set(checkboxId, error);
        } else {
          this.validationErrors.delete(checkboxId);
        }
      }
    });
  }
  
  /**
   * Mark a field as touched (user has interacted with it)
   */
  markFieldTouched(checkboxId: string) {
    runInAction(() => {
      this.touchedFields.add(checkboxId);
      // Re-validate now that field is touched
      const metadata = this.checkboxMetadata.find(m => m.id === checkboxId);
      if (metadata?.requiresAdditionalInput && metadata.additionalInputStrategy?.validationRules) {
        const data = this.additionalData.get(checkboxId);
        const error = this.validateData(data, metadata.additionalInputStrategy.validationRules);
        if (error) {
          this.validationErrors.set(checkboxId, error);
        } else {
          this.validationErrors.delete(checkboxId);
        }
      }
    });
  }
  
  /**
   * Validate data against rules
   */
  private validateData(data: any, rules: ValidationRule[]): string | null {
    for (const rule of rules) {
      switch (rule.type) {
        case 'required':
          if (data === null || data === undefined || data === '') {
            return rule.message;
          }
          break;
          
        case 'minLength':
          if (rule.min !== undefined && (!data || String(data).length < rule.min)) {
            return rule.message;
          }
          break;
          
        case 'maxLength':
          if (rule.max !== undefined && data && String(data).length > rule.max) {
            return rule.message;
          }
          break;
          
        case 'pattern':
          if (rule.pattern && !rule.pattern.test(String(data))) {
            return rule.message;
          }
          break;
          
        case 'custom':
          if (rule.validate && !rule.validate(data)) {
            return rule.message;
          }
          break;
      }
    }
    return null;
  }
  
  /**
   * Get the complete food conditions configuration for saving
   */
  getFoodConditionsConfiguration() {
    return this.checkboxMetadata
      .filter(m => m.checked)
      .map(m => ({
        type: m.value,
        label: m.label,
        additionalData: this.additionalData.get(m.id)
      }));
  }
  
  /**
   * Check if configuration is valid
   * This is called before Continue to ensure all required fields are filled
   */
  get isValid(): boolean {
    // At least one condition must be selected
    const hasSelection = this.checkboxMetadata.some(m => m.checked);
    if (!hasSelection) return false;
    
    // All selected items with required additional data must have it
    for (const metadata of this.checkboxMetadata) {
      if (metadata.checked && metadata.requiresAdditionalInput) {
        const data = this.additionalData.get(metadata.id);
        if (!data) {
          // Mark as touched to show validation error
          this.markFieldTouched(metadata.id);
          return false;
        }
        
        // Check for validation errors
        if (this.validationErrors.has(metadata.id)) return false;
      }
    }
    
    return true;
  }
  
  /**
   * Get selected food condition IDs
   */
  get selectedFoodConditionIds(): string[] {
    return this.checkboxMetadata
      .filter(m => m.checked)
      .map(m => m.id);
  }
  
  /**
   * Reset all selections
   */
  reset() {
    runInAction(() => {
      this.checkboxMetadata.forEach(m => {
        m.checked = false;
      });
      this.additionalData.clear();
      this.validationErrors.clear();
      this.touchedFields.clear();
    });
  }
}