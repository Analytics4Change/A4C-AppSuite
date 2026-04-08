/**
 * Admission Section — Step 5 of client intake form.
 *
 * Fields: admission_date, admission_type, level_of_care, expected_length_of_stay,
 * initial_risk_level, placement_arrangement.
 */

import React from 'react';
import { observer } from 'mobx-react-lite';
import { IntakeFormField } from './IntakeFormField';
import { getFieldProps } from './useFieldProps';
import type { IntakeSectionProps } from './types';
import { PLACEMENT_ARRANGEMENT_LABELS, INITIAL_RISK_LEVEL_LABELS } from '@/types/client.types';

const ADMISSION_TYPE_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['planned', 'Planned'],
  ['emergency', 'Emergency'],
  ['transfer', 'Transfer'],
  ['readmission', 'Readmission'],
] as const;

const PLACEMENT_OPTIONS = Object.entries(PLACEMENT_ARRANGEMENT_LABELS) as ReadonlyArray<
  readonly [string, string]
>;
const RISK_OPTIONS = Object.entries(INITIAL_RISK_LEVEL_LABELS) as ReadonlyArray<
  readonly [string, string]
>;

export const AdmissionSection: React.FC<IntakeSectionProps> = observer(({ viewModel }) => {
  const field = (key: string) => getFieldProps(viewModel, key);

  return (
    <div className="space-y-6" data-testid="intake-section-admission">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Admission Details</h3>
        <p className="text-sm text-gray-500 mt-1">
          Admission date, type, and placement information
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const p = field('admission_date');
          return p ? <IntakeFormField {...p} /> : null;
        })()}
        {(() => {
          const p = field('admission_type');
          return p ? <IntakeFormField {...p} enumOptions={ADMISSION_TYPE_OPTIONS} /> : null;
        })()}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const p = field('level_of_care');
          return p ? <IntakeFormField {...p} placeholder="e.g., Residential, Outpatient" /> : null;
        })()}
        {(() => {
          const p = field('expected_length_of_stay');
          return p ? <IntakeFormField {...p} placeholder="Days" /> : null;
        })()}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const p = field('initial_risk_level');
          return p ? <IntakeFormField {...p} enumOptions={RISK_OPTIONS} /> : null;
        })()}
        {(() => {
          const p = field('placement_arrangement');
          return p ? <IntakeFormField {...p} enumOptions={PLACEMENT_OPTIONS} /> : null;
        })()}
      </div>
    </div>
  );
});
