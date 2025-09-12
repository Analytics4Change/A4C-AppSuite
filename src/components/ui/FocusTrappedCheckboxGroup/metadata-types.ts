/**
 * Enhanced metadata types for FocusTrappedCheckboxGroup with dynamic input support
 */

/**
 * Strategy for managing focus in dynamic additional inputs
 */
export interface FocusStrategy {
  autoFocus: boolean;
  returnFocusTo?: 'checkbox' | 'continue' | 'cancel';
  trapFocus?: boolean;
}

/**
 * Validation rule for additional input fields
 */
export interface ValidationRule {
  type: 'required' | 'range' | 'pattern' | 'custom';
  message: string;
  min?: number;
  max?: number;
  pattern?: RegExp;
  validate?: (value: any) => boolean;
}

/**
 * Strategy pattern for defining additional input components
 */
export interface AdditionalInputStrategy {
  componentType: 'numeric' | 'text' | 'select' | 'date' | 'time' | 'custom';
  componentProps: Record<string, any>;
  validationRules?: ValidationRule[];
  focusManagement?: FocusStrategy;
}

/**
 * Enhanced checkbox metadata with support for additional inputs
 */
export interface CheckboxMetadata {
  id: string;
  label: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  description?: string;
  
  // Strategy Pattern Extension
  requiresAdditionalInput?: boolean;
  additionalInputStrategy?: AdditionalInputStrategy;
}

/**
 * Props for components that render dynamic additional inputs
 */
export interface DynamicAdditionalInputProps {
  strategy: AdditionalInputStrategy;
  checkboxId: string;
  currentValue?: any;
  onDataChange: (data: any) => void;
  tabIndexBase: number;
  shouldFocus: boolean;
  onFocusHandled: () => void;
  onInputFocus?: () => void;
  onInputBlur?: () => void;
}

/**
 * Enhanced props for FocusTrappedCheckboxGroup with metadata support
 */
export interface EnhancedCheckboxGroupProps {
  id: string;
  title: string;
  checkboxes: CheckboxMetadata[];
  onSelectionChange: (id: string, checked: boolean) => void;
  onAdditionalDataChange?: (checkboxId: string, data: any) => void;
  onContinue: (selectedIds: string[], additionalData: Map<string, any>) => void;
  onCancel: () => void;
  
  // Collapsible behavior
  isCollapsible?: boolean;
  initialExpanded?: boolean;
  
  // Focus management
  baseTabIndex: number;
  nextTabIndex?: number;
  
  // ARIA support
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  isRequired?: boolean;
  hasError?: boolean;
  errorMessage?: string;
  helpText?: string;
  
  // Button customization
  continueButtonText?: string;
  cancelButtonText?: string;
}