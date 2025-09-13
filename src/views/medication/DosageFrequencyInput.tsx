import React from 'react';
import { EditableDropdown } from '@/components/ui/EditableDropdown';
import { dosageFrequencies } from '@/mocks/data/dosages.mock';

interface DosageFrequencyInputProps {
  frequency: string;
  errors: Map<string, string>;
  onFrequencyChange: (freq: string) => void;
  onDropdownOpen?: (elementId: string) => void;
}

/**
 * Dosage frequency input using the reusable EditableDropdown component
 */
export const DosageFrequencyInput: React.FC<DosageFrequencyInputProps> = ({
  frequency,
  errors,
  onFrequencyChange,
  onDropdownOpen
}) => {
  return (
    <EditableDropdown
      id="dosage-frequency"
      label="Frequency"
      value={frequency}
      options={dosageFrequencies}
      placeholder="Select frequency..."
      error={errors.get('frequency')}
      tabIndex={8}
      targetTabIndex={9}
      onChange={onFrequencyChange}
      onDropdownOpen={onDropdownOpen}
      testIdPrefix="dosage-frequency"
    />
  );
};