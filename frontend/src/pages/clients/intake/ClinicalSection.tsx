/**
 * Clinical Section — Step 7 of client intake form.
 *
 * Fields: primary_diagnosis, secondary_diagnoses, dsm5_diagnoses, presenting_problem,
 * suicide_risk_status, violence_risk_status, trauma_history_indicator,
 * substance_use_history, developmental_history, previous_treatment_history.
 */

import React from 'react';
import { observer } from 'mobx-react-lite';
import { IntakeFormField } from './IntakeFormField';
import { getFieldProps } from './useFieldProps';
import type { IntakeSectionProps } from './types';
import { SUICIDE_RISK_STATUS_LABELS, VIOLENCE_RISK_STATUS_LABELS } from '@/types/client.types';

const SUICIDE_RISK_OPTIONS = Object.entries(SUICIDE_RISK_STATUS_LABELS) as ReadonlyArray<
  readonly [string, string]
>;
const VIOLENCE_RISK_OPTIONS = Object.entries(VIOLENCE_RISK_STATUS_LABELS) as ReadonlyArray<
  readonly [string, string]
>;

export const ClinicalSection: React.FC<IntakeSectionProps> = observer(({ viewModel }) => {
  const field = (key: string) => getFieldProps(viewModel, key);

  return (
    <div className="space-y-6" data-testid="intake-section-clinical">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Clinical Profile</h3>
        <p className="text-sm text-gray-500 mt-1">
          Diagnoses, risk assessments, and clinical history
        </p>
      </div>

      {/* Diagnoses (JSONB free-text for now — future ICD-10 search) */}
      {(() => {
        const p = field('primary_diagnosis');
        return p ? <IntakeFormField {...p} placeholder="Primary diagnosis..." /> : null;
      })()}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const p = field('secondary_diagnoses');
          return p ? <IntakeFormField {...p} placeholder="Secondary diagnoses..." /> : null;
        })()}
        {(() => {
          const p = field('dsm5_diagnoses');
          return p ? <IntakeFormField {...p} placeholder="DSM-5 diagnoses..." /> : null;
        })()}
      </div>

      {/* Presenting Problem */}
      {(() => {
        const p = field('presenting_problem');
        return p ? (
          <IntakeFormField
            {...p}
            fieldType="jsonb"
            placeholder="Describe the presenting problem..."
          />
        ) : null;
      })()}

      {/* Risk Assessments */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const p = field('suicide_risk_status');
          return p ? <IntakeFormField {...p} enumOptions={SUICIDE_RISK_OPTIONS} /> : null;
        })()}
        {(() => {
          const p = field('violence_risk_status');
          return p ? <IntakeFormField {...p} enumOptions={VIOLENCE_RISK_OPTIONS} /> : null;
        })()}
      </div>

      {/* Trauma indicator */}
      {(() => {
        const p = field('trauma_history_indicator');
        return p ? <IntakeFormField {...p} /> : null;
      })()}

      {/* History fields */}
      {(() => {
        const p = field('substance_use_history');
        return p ? (
          <IntakeFormField {...p} fieldType="jsonb" placeholder="Substance use history..." />
        ) : null;
      })()}
      {(() => {
        const p = field('developmental_history');
        return p ? (
          <IntakeFormField {...p} fieldType="jsonb" placeholder="Developmental history..." />
        ) : null;
      })()}
      {(() => {
        const p = field('previous_treatment_history');
        return p ? (
          <IntakeFormField {...p} fieldType="jsonb" placeholder="Previous treatment history..." />
        ) : null;
      })()}
    </div>
  );
});
