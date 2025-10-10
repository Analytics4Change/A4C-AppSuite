/**
 * TypeScript interfaces for FocusTrappedCheckboxGroup component
 */

export interface CheckboxItem {
  id: string;
  label: string;
  disabled?: boolean;
  description?: string;
}

export interface FocusTrappedCheckboxGroupProps {
  // Data
  id: string;
  title: string;
  items: CheckboxItem[];
  selectedIds: string[];
  
  // Handlers
  onSelectionChange: (selectedIds: string[]) => void;
  onCancel: () => void;
  onContinue: (selectedIds: string[]) => void;
  
  // UI Options
  isCollapsible?: boolean;
  initialExpanded?: boolean;
  className?: string;
  
  // TabIndex Management
  baseTabIndex: number;     // Starting tabIndex for the component
  nextTabIndex?: number;    // Where to focus after Continue
  
  // Accessibility - Group Level
  ariaLabel?: string;
  ariaLabelledBy?: string;  // ID of element that labels the group
  ariaDescribedBy?: string; // ID of element that describes the group
  
  // Validation & Error Support
  isRequired?: boolean;
  hasError?: boolean;
  errorMessage?: string;
  errorMessageId?: string;  // Custom ID for error message element
  
  // Help Text & Instructions
  helpText?: string;
  helpTextId?: string;       // Custom ID for help text element
  instructionsId?: string;   // ID of external instructions element
}

export interface CheckboxGroupItemProps {
  item: CheckboxItem;
  isSelected: boolean;
  isFocused: boolean;
  onToggle: (id: string) => void;
  onFocus: () => void;
  tabIndex: number;
}

export interface CollapsibleHeaderProps {
  title: string;
  isExpanded: boolean;
  selectedCount: number;
  onToggle: () => void;
  tabIndex?: number;
}