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
 * Focus source tracking for hybrid interactions
 */
export type FocusSource = 'keyboard' | 'mouse' | 'programmatic';

/**
 * Focus intent for preventing unwanted auto-focus
 */
export type FocusIntent = 
  | { type: 'none' }
  | { type: 'checkbox'; checkboxId: string; source: FocusSource }
  | { type: 'input'; checkboxId: string; source: FocusSource }
  | { type: 'returning-to-checkbox'; checkboxId: string; source: FocusSource }
  | { type: 'external-blur'; from: 'input' | 'checkbox' };

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
  focusIntent?: FocusIntent;
  onFocusHandled: () => void;
  onInputFocus?: () => void;
  onInputBlur?: () => void;
  onIntentionalExit?: (checkboxId: string, save: boolean) => void;
  onNaturalBlur?: (checkboxId: string, relatedTarget: HTMLElement | null) => void;
  onDirectFocus?: (checkboxId: string) => void;
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
  
  // Display configuration (new for reusability)
  showLabel?: boolean; // Show title label above container (default: true)
  maxVisibleItems?: number; // Max items before scrolling (default: 7)
  
  // Reordering configuration (new for reusability)
  enableReordering?: boolean; // Enable smart reordering (default: false)
  reorderTrigger?: 'onBlur' | 'onChange' | 'manual'; // When to trigger reorder (default: 'onBlur')
  onFocusLost?: () => void; // Callback when focus leaves the checkbox group
  
  // Summary display (new for reusability)
  summaryRenderer?: (checkboxId: string, data: any) => string; // Custom summary generation
  
  // Collapsible behavior (deprecated - will be removed)
  isCollapsible?: boolean;
  initialExpanded?: boolean;
  
  // Focus management
  baseTabIndex?: number;
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