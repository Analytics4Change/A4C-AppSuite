/**
 * Legal Section — Step 9 of client intake form.
 *
 * Fields: court_case_number, state_agency, legal_status,
 * mandated_reporting_status, protective_services_involvement, safety_plan_required.
 */

import React from 'react';
import { observer } from 'mobx-react-lite';
import { IntakeFormField } from './IntakeFormField';
import { getFieldProps } from './useFieldProps';
import type { IntakeSectionProps } from './types';

const LEGAL_STATUS_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['active', 'Active'],
  ['pending', 'Pending'],
  ['closed', 'Closed'],
  ['expunged', 'Expunged'],
] as const;

export const LegalSection: React.FC<IntakeSectionProps> = observer(({ viewModel }) => {
  const field = (key: string) => getFieldProps(viewModel, key);

  return (
    <div className="space-y-6" data-testid="intake-section-legal">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Legal & Compliance</h3>
        <p className="text-sm text-gray-500 mt-1">
          Legal status, court involvement, and protective services
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const p = field('court_case_number');
          return p ? <IntakeFormField {...p} placeholder="Court case number" /> : null;
        })()}
        {(() => {
          const p = field('state_agency');
          return p ? <IntakeFormField {...p} placeholder="State agency name" /> : null;
        })()}
      </div>

      {(() => {
        const p = field('legal_status');
        return p ? <IntakeFormField {...p} enumOptions={LEGAL_STATUS_OPTIONS} /> : null;
      })()}

      <div className="space-y-2">
        {(() => {
          const p = field('mandated_reporting_status');
          return p ? <IntakeFormField {...p} /> : null;
        })()}
        {(() => {
          const p = field('protective_services_involvement');
          return p ? <IntakeFormField {...p} /> : null;
        })()}
        {(() => {
          const p = field('safety_plan_required');
          return p ? <IntakeFormField {...p} /> : null;
        })()}
      </div>
    </div>
  );
});
