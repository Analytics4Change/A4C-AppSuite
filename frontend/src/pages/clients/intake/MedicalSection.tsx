/**
 * Medical Section — Step 8 of client intake form.
 *
 * Fields: allergies, medical_conditions, immunization_status,
 * dietary_restrictions, special_medical_needs.
 */

import React from 'react';
import { observer } from 'mobx-react-lite';
import { IntakeFormField } from './IntakeFormField';
import { getFieldProps } from './useFieldProps';
import type { IntakeSectionProps } from './types';

export const MedicalSection: React.FC<IntakeSectionProps> = observer(({ viewModel }) => {
  const field = (key: string) => getFieldProps(viewModel, key);

  return (
    <div className="space-y-6" data-testid="intake-section-medical">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Medical Information</h3>
        <p className="text-sm text-gray-500 mt-1">Allergies, conditions, and medical needs</p>
      </div>

      {/* Allergies + Medical Conditions (required, JSONB) */}
      {(() => {
        const p = field('allergies');
        return p ? (
          <IntakeFormField {...p} placeholder='List known allergies (enter "None" if none known)' />
        ) : null;
      })()}

      {(() => {
        const p = field('medical_conditions');
        return p ? (
          <IntakeFormField
            {...p}
            placeholder='List known medical conditions (enter "None" if none known)'
          />
        ) : null;
      })()}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const p = field('immunization_status');
          return p ? <IntakeFormField {...p} placeholder="e.g., Up to date, Unknown" /> : null;
        })()}
        {(() => {
          const p = field('dietary_restrictions');
          return p ? <IntakeFormField {...p} placeholder="e.g., Gluten-free, Halal" /> : null;
        })()}
      </div>

      {(() => {
        const p = field('special_medical_needs');
        return p ? (
          <IntakeFormField
            {...p}
            fieldType="jsonb"
            placeholder="Describe any special medical needs..."
          />
        ) : null;
      })()}
    </div>
  );
});
