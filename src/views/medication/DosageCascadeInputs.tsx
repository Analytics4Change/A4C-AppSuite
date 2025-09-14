import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EditableDropdown } from '@/components/ui/EditableDropdown';
import { dosageForms } from '@/mocks/data/dosages.mock';
import { useEnterAsTab } from '@/hooks/useEnterAsTab';

interface DosageCascadeInputsProps {
  dosageForm: string;
  dosageRoute: string;
  dosageAmount: string;
  dosageUnit: string;
  availableDosageRoutes: string[];
  availableDosageUnits: string[];
  errors: Map<string, string>;
  onDosageFormChange: (form: string) => void;
  onDosageRouteChange: (dosageRoute: string) => void;
  onDosageAmountChange: (amount: string) => void;
  onDosageUnitChange: (dosageUnit: string) => void;
  onDropdownOpen?: (elementId: string) => void;
}

export const DosageCascadeInputs: React.FC<DosageCascadeInputsProps> = ({
  dosageForm,
  dosageRoute,
  dosageAmount,
  dosageUnit,
  availableDosageRoutes,
  availableDosageUnits,
  errors,
  onDosageFormChange,
  onDosageRouteChange,
  onDosageAmountChange,
  onDosageUnitChange,
  onDropdownOpen
}) => {
  // Hook for Enter key navigation in dosage amount field
  const handleDosageAmountEnterKey = useEnterAsTab(7); // Move to Dosage Unit field

  return (
    <>
      {/* First Row: Dosage Form and Dosage Route */}
      <div className="grid grid-cols-2 gap-6">
        {/* Dosage Form */}
        <EditableDropdown
          id="dosage-form"
          label="Dosage Form"
          value={dosageForm}
          options={dosageForms}
          placeholder="Select dosage form..."
          error={errors.get('dosageForm')}
          tabIndex={4}
          targetTabIndex={5}
          onChange={onDosageFormChange}
          onDropdownOpen={onDropdownOpen}
          testIdPrefix="dosage-form"
        />

        {/* Dosage Route */}
        <EditableDropdown
          id="dosage-route"
          label="Dosage Route"
          value={dosageRoute}
          options={availableDosageRoutes}
          placeholder={dosageForm ? "Select route..." : "Select form first"}
          disabled={!dosageForm}
          disabledMessage="(select form first)"
          error={errors.get('dosageRoute')}
          tabIndex={dosageForm ? 5 : -1}
          targetTabIndex={6}
          onChange={onDosageRouteChange}
          onDropdownOpen={onDropdownOpen}
          testIdPrefix="dosage-route"
        />
      </div>

      {/* Second Row: Dosage Amount and Dosage Unit */}
      <div className="grid grid-cols-2 gap-6">
        {/* Dosage Amount */}
        <div>
          <Label htmlFor="dosage-amount" className="text-base font-medium">
            Dosage Amount
          </Label>
          <Input
            id="dosage-amount"
            data-testid="dosage-amount-input"
            type="text"
            value={dosageAmount}
            onChange={(e) => onDosageAmountChange(e.target.value)}
            onKeyDown={handleDosageAmountEnterKey}
            placeholder="Enter dosage amount..."
            className={`mt-2 ${dosageAmount ? 'border-blue-500 bg-blue-50' : ''} ${errors.get('dosageAmount') ? 'border-red-500' : ''}`}
            aria-label="Dosage amount"
            aria-describedby={errors.get('dosageAmount') ? 'dosage-amount-error' : undefined}
            tabIndex={6}
          />
          {errors.get('dosageAmount') && (
            <p id="dosage-amount-error" className="mt-1 text-sm text-red-600" role="alert">
              {errors.get('dosageAmount')}
            </p>
          )}
        </div>

        {/* Dosage Unit */}
        <EditableDropdown
          id="dosage-unit"
          label="Dosage Unit"
          value={dosageUnit}
          options={availableDosageUnits}
          placeholder={dosageRoute ? "Select dosage unit..." : "Select route first"}
          disabled={!dosageRoute}
          disabledMessage="(select route first)"
          error={errors.get('dosageUnit')}
          tabIndex={dosageRoute ? 7 : -1}
          targetTabIndex={8}
          onChange={onDosageUnitChange}
          onDropdownOpen={onDropdownOpen}
          testIdPrefix="dosage-unit"
        />
      </div>
    </>
  );
};