import { makeAutoObservable, runInAction, computed } from 'mobx';
import { CheckboxMetadata, ValidationRule } from '@/components/ui/FocusTrappedCheckboxGroup/metadata-types';
import { DosageFrequencySummaryStrategy } from '@/components/ui/FocusTrappedCheckboxGroup/summary-strategies';

/**
 * ViewModel for managing dosage frequency selections with dynamic additional inputs
 * Implements business logic for medication frequency configuration
 * Supports smart reordering and summary generation for consistency with Dosage Timings
 */
export class DosageFrequencyViewModel {
  checkboxMetadata: CheckboxMetadata[] = [];
  additionalData: Map<string, any> = new Map();
  validationErrors: Map<string, string> = new Map();
  touchedFields: Set<string> = new Set();  // Track which fields have been interacted with
  
  // Reordering state (exposed for announcement handling)
  _hasReorderedOnce = false;
  _hasFocusedOnce = false;
  
  // Configuration for this specific use case
  readonly config = {
    enableReordering: true,  // Dosage Frequency wants reordering like Dosage Timings
    reorderTrigger: 'onBlur' as const,
    maxVisibleItems: 10,
    summaryStrategy: new DosageFrequencySummaryStrategy()
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
        id: 'qd',
        label: 'Once Daily – QD',
        value: 'qd',
        checked: false,
        description: 'Medication taken once per day',
        requiresAdditionalInput: false,
        originalIndex: 0
      },
      {
        id: 'bid',
        label: 'Twice Daily – BID',
        value: 'bid',
        checked: false,
        description: 'Medication taken twice per day',
        requiresAdditionalInput: false,
        originalIndex: 1
      },
      {
        id: 'tid',
        label: 'Three Times Daily – TID',
        value: 'tid',
        checked: false,
        description: 'Medication taken three times per day',
        requiresAdditionalInput: false,
        originalIndex: 2
      },
      {
        id: 'qid',
        label: 'Four Times Daily – QID',
        value: 'qid',
        checked: false,
        description: 'Medication taken four times per day',
        requiresAdditionalInput: false,
        originalIndex: 3
      },
      {
        id: 'qwk',
        label: 'Once Weekly – QWK',
        value: 'qwk',
        checked: false,
        description: 'Medication taken once per week',
        requiresAdditionalInput: false,
        originalIndex: 4
      },
      {
        id: 'qmo',
        label: 'Once Monthly – QMO',
        value: 'qmo',
        checked: false,
        description: 'Medication taken once per month',
        requiresAdditionalInput: false,
        originalIndex: 5
      },
      {
        id: 'stat',
        label: 'Immediately – STAT',
        value: 'stat',
        checked: false,
        description: 'Medication to be given immediately',
        requiresAdditionalInput: false,
        originalIndex: 6
      },
      {
        id: 'qod',
        label: 'Every Other Day – QOD',
        value: 'qod',
        checked: false,
        description: 'Medication taken every other day',
        requiresAdditionalInput: false,
        originalIndex: 7
      },
      {
        id: 'prn',
        label: 'As Needed – PRN',
        value: 'prn',
        checked: false,
        description: 'Medication taken as needed',
        requiresAdditionalInput: false,  // Optional input - checkbox can be selected without notes
        originalIndex: 8,
        // Even though not required, we provide the input strategy for optional notes
        additionalInputStrategy: {
          componentType: 'text',
          componentProps: {
            placeholder: 'Optional notes (e.g., for pain, for nausea)',
            ariaLabel: 'Enter optional notes for as-needed medication',
            maxLength: 200
          },
          // No validation rules since it's optional
          validationRules: [],
          focusManagement: {
            autoFocus: true,
            trapFocus: false,
            requiresInput: false  // Optional field - Tab to enter, auto-save on blur
          }
        }
      },
      {
        id: 'prn-max',
        label: 'As Needed, Not to Exceed Every X Hours – PRN',
        value: 'prn-max',
        checked: false,
        description: 'Medication taken as needed with maximum frequency',
        requiresAdditionalInput: true,  // Required input - must specify max hours
        originalIndex: 9,
        additionalInputStrategy: {
          componentType: 'numeric',
          componentProps: {
            min: 1,
            max: 24,
            placeholder: 'Hours',
            suffix: 'hours',
            ariaLabel: 'Maximum frequency in hours'
          },
          validationRules: [
            { type: 'required', message: 'Maximum hours required when this option is selected' },
            { type: 'range', min: 1, max: 24, message: 'Must be between 1 and 24 hours' }
          ],
          focusManagement: {
            autoFocus: true,
            returnFocusTo: 'checkbox',
            trapFocus: false,
            requiresInput: true  // Required field - auto-focus when checkbox selected
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
      // This prevents showing errors immediately when checkbox is first checked
      if (metadata.requiresAdditionalInput && 
          metadata.additionalInputStrategy?.validationRules &&
          (this.touchedFields.has(checkboxId) || data)) {
        const error = this.validateData(data, metadata.additionalInputStrategy.validationRules);
        if (error) {
          this.validationErrors.set(checkboxId, error);
        } else {
          this.validationErrors.delete(checkboxId);
        }
      }
      // For optional fields (like 'prn'), no validation needed
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
          
        case 'range': {
          const numValue = Number(data);
          if (rule.min !== undefined && numValue < rule.min) {
            return rule.message;
          }
          if (rule.max !== undefined && numValue > rule.max) {
            return rule.message;
          }
          break;
        }
          
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
   * Get the complete frequency configuration for saving
   */
  getFrequencyConfiguration() {
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
    // At least one frequency must be selected
    const hasSelection = this.checkboxMetadata.some(m => m.checked);
    if (!hasSelection) return false;
    
    // All selected items with REQUIRED additional data must have it
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
      // Note: 'prn' is optional, so we don't validate it
    }
    
    return true;
  }
  
  /**
   * Get selected frequency IDs
   */
  get selectedFrequencyIds(): string[] {
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