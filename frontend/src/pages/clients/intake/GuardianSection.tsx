/**
 * Guardian Section — Step 3 of client intake form.
 *
 * Fields: legal_custody_status, court_ordered_placement, financial_guarantor_type.
 */

import React from 'react';
import { observer } from 'mobx-react-lite';
import { IntakeFormField } from './IntakeFormField';
import { getFieldProps } from './useFieldProps';
import type { IntakeSectionProps } from './types';
import { LEGAL_CUSTODY_STATUS_LABELS, FINANCIAL_GUARANTOR_TYPE_LABELS } from '@/types/client.types';

const CUSTODY_OPTIONS = Object.entries(LEGAL_CUSTODY_STATUS_LABELS) as ReadonlyArray<
  readonly [string, string]
>;
const GUARANTOR_OPTIONS = Object.entries(FINANCIAL_GUARANTOR_TYPE_LABELS) as ReadonlyArray<
  readonly [string, string]
>;

export const GuardianSection: React.FC<IntakeSectionProps> = observer(({ viewModel }) => {
  const field = (key: string) => getFieldProps(viewModel, key);

  return (
    <div className="space-y-6" data-testid="intake-section-guardian">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Guardian & Custody</h3>
        <p className="text-sm text-gray-500 mt-1">Legal custody and financial responsibility</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const p = field('legal_custody_status');
          return p ? <IntakeFormField {...p} enumOptions={CUSTODY_OPTIONS} /> : null;
        })()}
        {(() => {
          const p = field('financial_guarantor_type');
          return p ? <IntakeFormField {...p} enumOptions={GUARANTOR_OPTIONS} /> : null;
        })()}
      </div>

      {(() => {
        const p = field('court_ordered_placement');
        return p ? <IntakeFormField {...p} /> : null;
      })()}
    </div>
  );
});
