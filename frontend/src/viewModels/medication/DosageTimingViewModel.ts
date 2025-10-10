import { makeAutoObservable, runInAction, computed } from 'mobx';
import { CheckboxMetadata, ValidationRule } from '@/components/ui/FocusTrappedCheckboxGroup/metadata-types';
import { DosageTimingSummaryStrategy } from '@/components/ui/FocusTrappedCheckboxGroup/summary-strategies';
import { RangeHoursInput } from '@/components/ui/FocusTrappedCheckboxGroup/RangeHoursInput';

/**
 * ViewModel for managing dosage timing selections with dynamic additional inputs
 * Implements business logic for medication timing configuration
 * Supports smart reordering and summary generation for reusability
 */
export class DosageTimingViewModel {
  checkboxMetadata: CheckboxMetadata[] = [];
  additionalData: Map<string, any> = new Map();
  validationErrors: Map<string, string> = new Map();
  touchedFields: Set<string> = new Set();  // Track which fields have been interacted with
  selectedFrequencies: string[] = [];  // External context: selected frequency IDs from parent
  
  // Reordering state (exposed for announcement handling)
  _hasReorderedOnce = false;
  _hasFocusedOnce = false;
  
  // Configuration for this specific use case
  readonly config = {
    enableReordering: true,  // Dosage Timings wants reordering
    reorderTrigger: 'onBlur' as const,
    maxVisibleItems: 7,
    summaryStrategy: new DosageTimingSummaryStrategy()
  };
  
  constructor() {
    makeAutoObservable(this, {
      displayCheckboxes: computed,
      hasSelectedItems: computed,
      isValid: computed
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
   * Update selected frequencies context from parent component
   * This allows the ViewModel to make business logic decisions based on frequency selection
   */
  setSelectedFrequencies(frequencies: string[]) {
    runInAction(() => {
      this.selectedFrequencies = frequencies;
    });
  }
  
  /**
   * Check if PRN (as-needed) frequency is selected
   * PRN medications make timing selection optional
   */
  private get hasPRNSelection(): boolean {
    return this.selectedFrequencies.some(
      freq => freq === 'prn' || freq === 'prn-max'
    );
  }
  
  /**
   * Initialize checkbox metadata with strategies for additional inputs
   */
  private initializeMetadata() {
    this.checkboxMetadata = [
      {
        id: 'qxh',
        label: 'Every X Hours - QxH',
        value: 'qxh',
        checked: false,
        description: 'Medication taken at regular hourly intervals',
        requiresAdditionalInput: true,
        originalIndex: 0,
        additionalInputStrategy: {
          componentType: 'numeric',
          componentProps: {
            min: 1,
            max: 24,
            placeholder: 'Hours',
            suffix: 'hours',
            ariaLabel: 'Number of hours between doses',
            helpText: 'Enter how many hours between each dose (1-24)'
          },
          validationRules: [
            { type: 'required', message: 'Hours required when this option is selected' },
            { type: 'range', min: 1, max: 24, message: 'Must be between 1 and 24 hours' }
          ],
          focusManagement: {
            autoFocus: true,
            returnFocusTo: 'checkbox',
            trapFocus: false,
            requiresInput: true  // Required field - auto-focus when checkbox selected
          }
        }
      },
      {
        id: 'qxh-range',
        label: 'Every X to Y Hours',
        value: 'qxh-range',
        checked: false,
        description: 'Medication taken at variable hourly intervals',
        requiresAdditionalInput: true,
        originalIndex: 1,
        additionalInputStrategy: {
          componentType: 'custom',
          componentProps: {
            component: RangeHoursInput,
            minPlaceholder: 'Min',
            maxPlaceholder: 'Max',
            ariaLabel: 'Enter hour range for doses',
            helpText: 'Enter minimum and maximum hours between doses (e.g., 4 to 6 hours)',
            checkboxId: 'qxh-range'
          },
          validationRules: [
            { type: 'required', message: 'Hour range required when this option is selected' },
            { 
              type: 'custom', 
              validate: (data: any) => {
                if (!data || typeof data !== 'object') return false;
                const { min, max } = data;
                if (!min || !max) return false;
                if (min < 1 || min > 24 || max < 1 || max > 24) return false;
                return min <= max;
              },
              message: 'Please enter valid hour range (1-24 hours, min ≤ max)' 
            }
          ],
          focusManagement: {
            autoFocus: true,
            returnFocusTo: 'checkbox',
            trapFocus: false,
            requiresInput: true  // Required field - auto-focus when checkbox selected
          }
        }
      },
      {
        id: 'qam',
        label: 'Every Morning - QAM',
        value: 'qam',
        checked: false,
        description: 'Once daily in the morning',
        requiresAdditionalInput: false,
        originalIndex: 2
      },
      {
        id: 'qpm',
        label: 'Every Evening - QPM',
        value: 'qpm',
        checked: false,
        description: 'Once daily in the evening',
        requiresAdditionalInput: false,
        originalIndex: 3
      },
      {
        id: 'qhs',
        label: 'Every Night at Bedtime - QHS',
        value: 'qhs',
        checked: false,
        description: 'Once daily at bedtime',
        requiresAdditionalInput: false,
        originalIndex: 4
      },
      {
        id: 'specific-times',
        label: 'Specific Times',
        value: 'specific-times',
        checked: false,
        description: 'Set specific times for medication',
        requiresAdditionalInput: true,
        originalIndex: 5,
        additionalInputStrategy: {
          componentType: 'text',
          componentProps: {
            placeholder: 'e.g., 8am, 2pm, 8pm',
            ariaLabel: 'Enter specific times for doses',
            helpText: 'Enter times separated by commas (e.g., 8am, 2pm, 8pm)',
            maxLength: 100
          },
          validationRules: [
            { 
              type: 'required', 
              message: 'Times required when this option is selected' 
            },
            {
              type: 'pattern',
              pattern: /^(\d{1,2}(:\d{2})?\s*(am|pm|AM|PM)?,?\s*)+$/,
              message: 'Please enter valid times (e.g., 8am, 2:30pm)'
            }
          ],
          focusManagement: {
            autoFocus: true,
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
      if (metadata?.additionalInputStrategy?.validationRules) {
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
   * Get the complete timing configuration for saving
   */
  getTimingConfiguration() {
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
   * For PRN medications, timing selection is optional
   */
  get isValid(): boolean {
    // For PRN medications, timing selection is optional - always valid even with no selections
    if (this.hasPRNSelection) {
      // Still validate any selected items have proper additional data
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
      return true;  // PRN medications can have no timing selections
    }
    
    // For non-PRN medications, at least one timing must be selected
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
   * Get selected timing IDs
   */
  get selectedTimingIds(): string[] {
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
      this.selectedFrequencies = [];  // Clear frequency context
    });
  }
}