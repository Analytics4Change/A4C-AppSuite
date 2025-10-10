import React from 'react';
import { observer } from 'mobx-react-lite';
import { Label } from '@/components/ui/label';

interface MedicationAuxiliaryInfoProps {
  isControlled: boolean | null;
  isPsychotropic: boolean | null;
  onControlledChange: (value: boolean) => void;
  onPsychotropicChange: (value: boolean) => void;
}

/**
 * Component for capturing auxiliary medication information
 * - Controlled substance status
 * - Psychotropic medication status
 */
export const MedicationAuxiliaryInfo: React.FC<MedicationAuxiliaryInfoProps> = observer(({
  isControlled,
  isPsychotropic,
  onControlledChange,
  onPsychotropicChange
}) => {
  return (
    <div className="bg-white p-6 rounded-lg border">
      <div className="grid grid-cols-2 gap-6">
        {/* Controlled Substance */}
        <div className="space-y-3">
          <Label className="text-base font-medium">Controlled</Label>
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="radio"
                name="controlled"
                value="true"
                checked={isControlled === true}
                onChange={() => onControlledChange(true)}
                tabIndex={2}
                className="w-4 h-4 text-blue-600 focus:ring-2 focus:ring-blue-500"
                aria-label="Controlled substance - Yes"
              />
              <span className="font-normal">Yes</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="radio"
                name="controlled"
                value="false"
                checked={isControlled === false}
                onChange={() => onControlledChange(false)}
                tabIndex={-1}
                className="w-4 h-4 text-blue-600 focus:ring-2 focus:ring-blue-500"
                aria-label="Controlled substance - No"
              />
              <span className="font-normal">No</span>
            </label>
          </div>
        </div>

        {/* Psychotropic Medication */}
        <div className="space-y-3">
          <Label className="text-base font-medium">Psychotropic</Label>
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="radio"
                name="psychotropic"
                value="true"
                checked={isPsychotropic === true}
                onChange={() => onPsychotropicChange(true)}
                tabIndex={3}
                className="w-4 h-4 text-blue-600 focus:ring-2 focus:ring-blue-500"
                aria-label="Psychotropic medication - Yes"
              />
              <span className="font-normal">Yes</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="radio"
                name="psychotropic"
                value="false"
                checked={isPsychotropic === false}
                onChange={() => onPsychotropicChange(false)}
                tabIndex={-1}
                className="w-4 h-4 text-blue-600 focus:ring-2 focus:ring-blue-500"
                aria-label="Psychotropic medication - No"
              />
              <span className="font-normal">No</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
});