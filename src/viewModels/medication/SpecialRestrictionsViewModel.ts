import { makeAutoObservable, runInAction, computed } from 'mobx';
import { CheckboxMetadata, ValidationRule } from '@/components/ui/FocusTrappedCheckboxGroup/metadata-types';
import { SpecialRestrictionsSummaryStrategy } from '@/components/ui/FocusTrappedCheckboxGroup/summary-strategies';

/**
 * ViewModel for managing special restrictions selections with dynamic additional inputs
 * Implements business logic for medication special restrictions configuration
 * Follows the same pattern as DosageTimingViewModel with smart reordering
 */
export class SpecialRestrictionsViewModel {
  checkboxMetadata: CheckboxMetadata[] = [];
  additionalData: Map<string, any> = new Map();
  validationErrors: Map<string, string> = new Map();
  touchedFields: Set<string> = new Set();  // Track which fields have been interacted with
  
  // Reordering state (exposed for announcement handling)
  _hasReorderedOnce = false;
  _hasFocusedOnce = false;
  
  // Configuration for this specific use case
  readonly config = {
    enableReordering: true,  // Special Restrictions wants reordering like Dosage Timings
    reorderTrigger: 'onBlur' as const,
    maxVisibleItems: 7,
    summaryStrategy: new SpecialRestrictionsSummaryStrategy()
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
        id: 'avoid-alcohol',
        label: 'Avoid Alcohol While Taking This Medication',
        value: 'avoid-alcohol',
        checked: false,
        description: 'Alcohol should be avoided',
        requiresAdditionalInput: false,
        originalIndex: 0
      },
      {
        id: 'avoid-grapefruit',
        label: 'Avoid Grapefruit Or Grapefruit Juice',
        value: 'avoid-grapefruit',
        checked: false,
        description: 'Grapefruit can interact with medication',
        requiresAdditionalInput: false,
        originalIndex: 1
      },
      {
        id: 'avoid-caffeine',
        label: 'Avoid Caffeine While Taking This Medication',
        value: 'avoid-caffeine',
        checked: false,
        description: 'Caffeine should be avoided',
        requiresAdditionalInput: false,
        originalIndex: 2
      },
      {
        id: 'avoid-dairy',
        label: 'Avoid Dairy Within 2 Hours',
        value: 'avoid-dairy',
        checked: false,
        description: 'Dairy products should be avoided within 2 hours',
        requiresAdditionalInput: false,
        originalIndex: 3
      },
      {
        id: 'avoid-high-fat',
        label: 'Avoid High-Fat Meals Around Time Of Dose',
        value: 'avoid-high-fat',
        checked: false,
        description: 'High-fat meals should be avoided',
        requiresAdditionalInput: false,
        originalIndex: 4
      },
      {
        id: 'avoid-high-fiber',
        label: 'Avoid High-Fiber Meals Around Time Of Dose',
        value: 'avoid-high-fiber',
        checked: false,
        description: 'High-fiber meals should be avoided',
        requiresAdditionalInput: false,
        originalIndex: 5
      },
      {
        id: 'avoid-spicy-acidic',
        label: 'Avoid Spicy Or Acidic Foods Around Time Of Dose',
        value: 'avoid-spicy-acidic',
        checked: false,
        description: 'Spicy or acidic foods should be avoided',
        requiresAdditionalInput: false,
        originalIndex: 6
      },
      {
        id: 'other',
        label: 'Other',
        value: 'other',
        checked: false,
        description: 'Specify other special restrictions',
        requiresAdditionalInput: true,
        originalIndex: 7,
        additionalInputStrategy: {
          componentType: 'textarea',
          componentProps: {
            placeholder: 'Enter specific restrictions',
            ariaLabel: 'Enter other special restrictions',
            helpText: 'Specify any other special restrictions (required)',
            maxLength: 500,
            rows: 2,  // Show 2 lines when unfocused
            autoResize: true  // Expand to show all content when focused
          },
          validationRules: [
            { type: 'required', message: 'Restrictions required when Other is selected' },
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
   * Get the complete special restrictions configuration for saving
   */
  getSpecialRestrictionsConfiguration() {
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
    // At least one restriction must be selected
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
   * Get selected special restriction IDs
   */
  get selectedSpecialRestrictionIds(): string[] {
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