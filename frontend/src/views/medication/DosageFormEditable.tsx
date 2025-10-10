import React from 'react';
import { observer } from 'mobx-react-lite';
import { DosageCascadeInputs } from './DosageCascadeInputs';
import { DosageFrequencyInput } from './DosageFrequencyInput';
import { DosageTimingsInput } from './DosageTimingsInput';
import { FoodConditionsInput } from './FoodConditionsInput';
import { SpecialRestrictionsInput } from './SpecialRestrictionsInput';

import { DosageForm } from '@/types/models';

interface DosageFormProps {
  dosageForm: string;  // Broad category (Solid, Liquid, etc.)
  dosageRoute: string;  // Specific route (Tablet, Capsule, etc.)
  dosageAmount: string;
  dosageUnit: string;
  selectedFrequencies: string[];  // Changed from single frequency to multiple frequencies
  selectedTimings: string[];  // Changed from single condition to multiple timings
  selectedFoodConditions: string[];  // Food conditions selections
  selectedSpecialRestrictions: string[];  // Special restrictions selections
  availableDosageForms: DosageForm[];
  availableDosageRoutes: string[];
  availableDosageUnits: string[];
  errors: Map<string, string>;
  onDosageFormChange: (form: string) => void;
  onDosageRouteChange: (dosageRoute: string) => void;
  onDosageAmountChange: (amount: string) => void;
  onDosageUnitChange: (dosageUnit: string) => void;
  onFrequenciesChange: (frequencies: string[]) => void;
  onTimingsChange: (timings: string[]) => void;  // Changed to handle multiple selections
  onFoodConditionsChange: (conditions: string[]) => void;  // Handle food conditions
  onSpecialRestrictionsChange: (restrictions: string[]) => void;  // Handle special restrictions
  onDropdownOpen?: (elementId: string) => void;
}

export const DosageFormEditable = observer((props: DosageFormProps) => {
  const {
    dosageForm,
    dosageRoute,
    dosageAmount,
    dosageUnit,
    selectedFrequencies,
    selectedTimings,
    selectedFoodConditions,
    selectedSpecialRestrictions,
    availableDosageForms,
    availableDosageRoutes,
    availableDosageUnits,
    errors,
    onDosageFormChange,
    onDosageRouteChange,
    onDosageAmountChange,
    onDosageUnitChange,
    onFrequenciesChange,
    onTimingsChange,
    onFoodConditionsChange,
    onSpecialRestrictionsChange,
    onDropdownOpen
  } = props;

  return (
    <div className="space-y-6">
      {/* Cascading Dosage Inputs (Form → Route → Amount → Unit) */}
      <DosageCascadeInputs
        dosageForm={dosageForm}
        dosageRoute={dosageRoute}
        dosageAmount={dosageAmount}
        dosageUnit={dosageUnit}
        availableDosageForms={availableDosageForms}
        availableDosageRoutes={availableDosageRoutes}
        availableDosageUnits={availableDosageUnits}
        errors={errors}
        onDosageFormChange={onDosageFormChange}
        onDosageRouteChange={onDosageRouteChange}
        onDosageAmountChange={onDosageAmountChange}
        onDosageUnitChange={onDosageUnitChange}
        onDropdownOpen={onDropdownOpen}
      />

      {/* Dosage Frequency - Full width with focus trap */}
      <DosageFrequencyInput
        selectedFrequencies={selectedFrequencies}
        onFrequenciesChange={onFrequenciesChange}
        errors={errors}
      />

      {/* Dosage Timings - Full width with focus trap */}
      <DosageTimingsInput
        selectedTimings={selectedTimings}
        selectedFrequencies={selectedFrequencies}
        onTimingsChange={onTimingsChange}
        errors={errors}
      />

      {/* Food Conditions - Full width with focus trap */}
      <FoodConditionsInput
        selectedFoodConditions={selectedFoodConditions}
        onFoodConditionsChange={onFoodConditionsChange}
        errors={errors}
      />

      {/* Special Restrictions - Full width with focus trap */}
      <SpecialRestrictionsInput
        selectedSpecialRestrictions={selectedSpecialRestrictions}
        onSpecialRestrictionsChange={onSpecialRestrictionsChange}
        errors={errors}
      />
    </div>
  );
});