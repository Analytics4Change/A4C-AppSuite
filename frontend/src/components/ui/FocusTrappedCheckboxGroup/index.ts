/**
 * Barrel export for FocusTrappedCheckboxGroup components
 */

// Original component
export { FocusTrappedCheckboxGroup } from './FocusTrappedCheckboxGroup';
export type { 
  CheckboxItem, 
  FocusTrappedCheckboxGroupProps 
} from './types';

// Enhanced components with dynamic input support
export { EnhancedFocusTrappedCheckboxGroup } from './EnhancedFocusTrappedCheckboxGroup';
export { DynamicAdditionalInput } from './DynamicAdditionalInput';
export type {
  CheckboxMetadata,
  AdditionalInputStrategy,
  EnhancedCheckboxGroupProps,
  ValidationRule,
  FocusStrategy,
  DynamicAdditionalInputProps
} from './metadata-types';