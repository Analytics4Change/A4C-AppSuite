import { makeAutoObservable, runInAction } from 'mobx';
import { CheckboxMetadata, ValidationRule } from '@/components/ui/FocusTrappedCheckboxGroup/metadata-types';

/**
 * ViewModel for managing dosage timing selections with dynamic additional inputs
 * Implements business logic for medication timing configuration
 */
export class DosageTimingViewModel {
  checkboxMetadata: CheckboxMetadata[] = [];
  additionalData: Map<string, any> = new Map();
  validationErrors: Map<string, string> = new Map();
  
  constructor() {
    makeAutoObservable(this);
    this.initializeMetadata();
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
            trapFocus: false
          }
        }
      },
      {
        id: 'qam',
        label: 'Every Morning - QAM',
        value: 'qam',
        checked: false,
        description: 'Once daily in the morning',
        requiresAdditionalInput: false
      },
      {
        id: 'qpm',
        label: 'Every Evening - QPM',
        value: 'qpm',
        checked: false,
        description: 'Once daily in the evening',
        requiresAdditionalInput: false
      },
      {
        id: 'qhs',
        label: 'Every Night at Bedtime - QHS',
        value: 'qhs',
        checked: false,
        description: 'Once daily at bedtime',
        requiresAdditionalInput: false
      },
      {
        id: 'specific-times',
        label: 'Specific Times',
        value: 'specific-times',
        checked: false,
        description: 'Set specific times for medication',
        requiresAdditionalInput: true,
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
            trapFocus: false
          }
        }
      },
      {
        id: 'prn',
        label: 'As Needed - PRN',
        value: 'prn',
        checked: false,
        description: 'Take medication as needed',
        requiresAdditionalInput: true,
        additionalInputStrategy: {
          componentType: 'select',
          componentProps: {
            ariaLabel: 'Maximum frequency for as-needed medication',
            helpText: 'Select maximum frequency',
            options: [
              { value: 'q4h', label: 'Every 4 hours as needed' },
              { value: 'q6h', label: 'Every 6 hours as needed' },
              { value: 'q8h', label: 'Every 8 hours as needed' },
              { value: 'q12h', label: 'Every 12 hours as needed' },
              { value: 'daily', label: 'Once daily as needed' }
            ]
          },
          validationRules: [
            { type: 'required', message: 'Please select maximum frequency' }
          ],
          focusManagement: {
            autoFocus: true,
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
        
        // Clear additional data and validation errors if unchecked
        if (!checked) {
          this.additionalData.delete(id);
          this.validationErrors.delete(id);
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
      
      // Validate if rules exist
      if (metadata.additionalInputStrategy?.validationRules) {
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
          
        case 'range':
          const numValue = Number(data);
          if (rule.min !== undefined && numValue < rule.min) {
            return rule.message;
          }
          if (rule.max !== undefined && numValue > rule.max) {
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
   */
  get isValid(): boolean {
    // At least one timing must be selected
    const hasSelection = this.checkboxMetadata.some(m => m.checked);
    if (!hasSelection) return false;
    
    // All selected items with required additional data must have it
    for (const metadata of this.checkboxMetadata) {
      if (metadata.checked && metadata.requiresAdditionalInput) {
        const data = this.additionalData.get(metadata.id);
        if (!data) return false;
        
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
    });
  }
}