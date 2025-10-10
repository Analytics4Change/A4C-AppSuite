import React from 'react';
import { observer } from 'mobx-react-lite';
import { AlertCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { Label } from '@/components/ui/label';

interface MedicationStatusIndicatorProps {
  // Status values
  isControlled: boolean | null;
  isPsychotropic: boolean | null;
  controlledSchedule?: string;
  psychotropicCategory?: string;
  
  // Loading states
  isCheckingControlled: boolean;
  isCheckingPsychotropic: boolean;
  
  // Error states (when true, show radio buttons)
  controlledCheckFailed: boolean;
  psychotropicCheckFailed: boolean;
  
  // Handlers for manual selection (when in fallback mode)
  onControlledChange: (value: boolean) => void;
  onPsychotropicChange: (value: boolean) => void;
  
  // TabIndex for accessibility
  controlledTabIndex: number;
  psychotropicTabIndex: number;
}

/**
 * Hybrid component that displays automatic medication classification from RXNorm API
 * or falls back to manual radio buttons when API fails.
 * Shows "YES" in bold red font when medication is controlled or psychotropic.
 */
export const MedicationStatusIndicator: React.FC<MedicationStatusIndicatorProps> = observer(({
  isControlled,
  isPsychotropic,
  controlledSchedule,
  psychotropicCategory,
  isCheckingControlled,
  isCheckingPsychotropic,
  controlledCheckFailed,
  psychotropicCheckFailed,
  onControlledChange,
  onPsychotropicChange,
  controlledTabIndex,
  psychotropicTabIndex
}) => {
  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Controlled Status */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-gray-700">
          Controlled Substance
        </Label>
        
        {isCheckingControlled ? (
          // Loading state
          <div className="flex items-center space-x-2 text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Checking status...</span>
          </div>
        ) : controlledCheckFailed ? (
          // Fallback to radio buttons on API failure
          <div className="space-y-2">
            <div className="text-xs text-amber-600 flex items-center space-x-1 mb-2">
              <AlertCircle className="h-3 w-3" />
              <span>Automatic detection unavailable - please select manually</span>
            </div>
            <div className="flex space-x-4">
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="controlled"
                  value="yes"
                  checked={isControlled === true}
                  onChange={() => onControlledChange(true)}
                  tabIndex={controlledTabIndex}
                  className="mr-2 cursor-pointer"
                  aria-label="Controlled substance - Yes"
                />
                <span className="text-sm">Yes</span>
              </label>
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="controlled"
                  value="no"
                  checked={isControlled === false}
                  onChange={() => onControlledChange(false)}
                  tabIndex={controlledTabIndex}
                  className="mr-2 cursor-pointer"
                  aria-label="Controlled substance - No"
                />
                <span className="text-sm">No</span>
              </label>
            </div>
          </div>
        ) : (
          // Automatic detection result
          <div className="flex items-center space-x-2">
            {isControlled ? (
              <>
                <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden="true" />
                <span 
                  className="font-bold text-red-600 text-lg"
                  role="status"
                  aria-label={`Controlled substance: YES${controlledSchedule ? ` - ${controlledSchedule}` : ''}`}
                >
                  YES
                </span>
                {controlledSchedule && (
                  <span className="text-sm text-gray-600">({controlledSchedule})</span>
                )}
              </>
            ) : (
              <span 
                className="text-gray-700"
                role="status"
                aria-label="Controlled substance: No"
              >
                No
              </span>
            )}
            <span className="text-xs text-gray-500 ml-2">(Auto-detected)</span>
          </div>
        )}
      </div>

      {/* Psychotropic Status */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-gray-700">
          Psychotropic Medication
        </Label>
        
        {isCheckingPsychotropic ? (
          // Loading state
          <div className="flex items-center space-x-2 text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Checking status...</span>
          </div>
        ) : psychotropicCheckFailed ? (
          // Fallback to radio buttons on API failure
          <div className="space-y-2">
            <div className="text-xs text-amber-600 flex items-center space-x-1 mb-2">
              <AlertCircle className="h-3 w-3" />
              <span>Automatic detection unavailable - please select manually</span>
            </div>
            <div className="flex space-x-4">
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="psychotropic"
                  value="yes"
                  checked={isPsychotropic === true}
                  onChange={() => onPsychotropicChange(true)}
                  tabIndex={psychotropicTabIndex}
                  className="mr-2 cursor-pointer"
                  aria-label="Psychotropic medication - Yes"
                />
                <span className="text-sm">Yes</span>
              </label>
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="psychotropic"
                  value="no"
                  checked={isPsychotropic === false}
                  onChange={() => onPsychotropicChange(false)}
                  tabIndex={psychotropicTabIndex}
                  className="mr-2 cursor-pointer"
                  aria-label="Psychotropic medication - No"
                />
                <span className="text-sm">No</span>
              </label>
            </div>
          </div>
        ) : (
          // Automatic detection result
          <div className="flex items-center space-x-2">
            {isPsychotropic ? (
              <>
                <AlertCircle className="h-5 w-5 text-red-600" aria-hidden="true" />
                <span 
                  className="font-bold text-red-600 text-lg"
                  role="status"
                  aria-label={`Psychotropic medication: YES${psychotropicCategory ? ` - ${psychotropicCategory}` : ''}`}
                >
                  YES
                </span>
                {psychotropicCategory && (
                  <span className="text-sm text-gray-600">({psychotropicCategory})</span>
                )}
              </>
            ) : (
              <span 
                className="text-gray-700"
                role="status"
                aria-label="Psychotropic medication: No"
              >
                No
              </span>
            )}
            <span className="text-xs text-gray-500 ml-2">(Auto-detected)</span>
          </div>
        )}
      </div>
    </div>
  );
});

MedicationStatusIndicator.displayName = 'MedicationStatusIndicator';