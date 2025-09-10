import React from 'react';
import { observer } from 'mobx-react-lite';
import { DosageFormInputsEditable } from './DosageFormInputsEditable';
import { DosageFrequencyInput } from './DosageFrequencyInput';
import { DosageTimingsInput } from './DosageTimingsInput';

interface DosageFormProps {
  dosageForm: string;  // Broad category (Solid, Liquid, etc.)
  dosageRoute: string;  // Specific route (Tablet, Capsule, etc.)
  dosageAmount: string;
  dosageUnit: string;
  frequency: string;
  selectedTimings: string[];  // Changed from single condition to multiple timings
  availableDosageRoutes: string[];
  availableDosageUnits: string[];
  errors: Map<string, string>;
  onDosageFormChange: (form: string) => void;
  onDosageRouteChange: (dosageRoute: string) => void;
  onDosageAmountChange: (amount: string) => void;
  onDosageUnitChange: (dosageUnit: string) => void;
  onFrequencyChange: (freq: string) => void;
  onTimingsChange: (timings: string[]) => void;  // Changed to handle multiple selections
  onDropdownOpen?: (elementId: string) => void;
}

export const DosageFormEditable = observer((props: DosageFormProps) => {
  const {
    dosageForm,
    dosageRoute,
    dosageAmount,
    dosageUnit,
    frequency,
    selectedTimings,
    availableDosageRoutes,
    availableDosageUnits,
    errors,
    onDosageFormChange,
    onDosageRouteChange,
    onDosageAmountChange,
    onDosageUnitChange,
    onFrequencyChange,
    onTimingsChange,
    onDropdownOpen
  } = props;

  return (
    <div className="space-y-6">
      {/* Dosage Form and Dosage Unit Inputs - Using Editable Version */}
      <DosageFormInputsEditable
        dosageForm={dosageForm}
        dosageRoute={dosageRoute}
        dosageAmount={dosageAmount}
        dosageUnit={dosageUnit}
        availableDosageRoutes={availableDosageRoutes}
        availableDosageUnits={availableDosageUnits}
        errors={errors}
        onDosageFormChange={onDosageFormChange}
        onDosageRouteChange={onDosageRouteChange}
        onDosageAmountChange={onDosageAmountChange}
        onDosageUnitChange={onDosageUnitChange}
        onDropdownOpen={onDropdownOpen}
      />

      {/* Dosage Frequency Input */}
      <div className="grid grid-cols-2 gap-6">
        <DosageFrequencyInput
          frequency={frequency}
          errors={errors}
          onFrequencyChange={onFrequencyChange}
          onDropdownOpen={onDropdownOpen}
        />
        <div /> {/* Empty cell for grid alignment */}
      </div>

      {/* Dosage Timings - Full width with focus trap */}
      <DosageTimingsInput
        selectedTimings={selectedTimings}
        onTimingsChange={onTimingsChange}
        errors={errors}
      />
    </div>
  );
});