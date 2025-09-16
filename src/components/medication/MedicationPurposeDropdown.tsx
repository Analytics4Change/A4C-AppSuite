import React from 'react';
import { observer } from 'mobx-react-lite';
import { Loader2, AlertCircle } from 'lucide-react';
import { EditableDropdown } from '@/components/ui/EditableDropdown';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface MedicationPurposeDropdownProps {
  selectedPurpose: string;
  availablePurposes: string[];
  isLoading: boolean;
  loadFailed: boolean;
  onPurposeChange: (purpose: string) => void;
  tabIndex: number;
  error?: string;
}

/**
 * Dropdown component for selecting medication therapeutic purpose
 * Dynamically loads purposes from RXNorm API based on selected medication
 * Falls back to text input if API fails
 */
export const MedicationPurposeDropdown: React.FC<MedicationPurposeDropdownProps> = observer(({
  selectedPurpose,
  availablePurposes,
  isLoading,
  loadFailed,
  onPurposeChange,
  tabIndex,
  error
}) => {
  // Loading state
  if (isLoading) {
    return (
      <div>
        <Label className="text-sm font-medium text-gray-700">
          Medication Purpose
        </Label>
        <div className="mt-1 flex items-center space-x-2 text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading therapeutic purposes...</span>
        </div>
      </div>
    );
  }

  // API failed or no purposes found - show manual input
  if (loadFailed || availablePurposes.length === 0) {
    return (
      <div>
        <Label htmlFor="medication-purpose" className="text-sm font-medium text-gray-700">
          Medication Purpose
        </Label>
        {loadFailed && (
          <div className="text-xs text-amber-600 flex items-center space-x-1 mt-1 mb-2">
            <AlertCircle className="h-3 w-3" />
            <span>Unable to load purposes from database. Please enter manually.</span>
          </div>
        )}
        <Input
          id="medication-purpose"
          value={selectedPurpose}
          onChange={(e) => onPurposeChange(e.target.value)}
          placeholder="Enter therapeutic purpose..."
          tabIndex={tabIndex}
          className={error ? 'border-red-500' : ''}
          aria-label="Medication therapeutic purpose"
          aria-invalid={!!error}
          aria-describedby={error ? 'purpose-error' : undefined}
        />
        {error && (
          <p id="purpose-error" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  }

  // Normal state - show dropdown with loaded purposes
  return (
    <EditableDropdown
      id="medication-purpose"
      label="Medication Purpose"
      value={selectedPurpose}
      options={availablePurposes}
      placeholder="Select therapeutic purpose..."
      error={error}
      tabIndex={tabIndex}
      targetTabIndex={tabIndex + 1}
      onChange={onPurposeChange}
      filterMode="contains"
      testIdPrefix="medication-purpose"
    />
  );
});

MedicationPurposeDropdown.displayName = 'MedicationPurposeDropdown';