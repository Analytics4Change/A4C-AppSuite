/**
 * Referral Section — Step 4 of client intake form.
 *
 * Fields: referral_source_type, referral_organization, referral_date, reason_for_referral.
 */

import React from 'react';
import { observer } from 'mobx-react-lite';
import { IntakeFormField } from './IntakeFormField';
import { getFieldProps } from './useFieldProps';
import type { IntakeSectionProps } from './types';

const REFERRAL_SOURCE_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['self', 'Self'],
  ['family', 'Family'],
  ['court', 'Court/Judicial'],
  ['child_welfare', 'Child Welfare Agency'],
  ['school', 'School'],
  ['hospital', 'Hospital/Medical'],
  ['mental_health', 'Mental Health Provider'],
  ['juvenile_justice', 'Juvenile Justice'],
  ['community', 'Community Organization'],
  ['other', 'Other'],
] as const;

export const ReferralSection: React.FC<IntakeSectionProps> = observer(({ viewModel }) => {
  const field = (key: string) => getFieldProps(viewModel, key);

  return (
    <div className="space-y-6" data-testid="intake-section-referral">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Referral Information</h3>
        <p className="text-sm text-gray-500 mt-1">How the client was referred to this program</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const p = field('referral_source_type');
          return p ? <IntakeFormField {...p} enumOptions={REFERRAL_SOURCE_OPTIONS} /> : null;
        })()}
        {(() => {
          const p = field('referral_organization');
          return p ? <IntakeFormField {...p} placeholder="Referring organization name" /> : null;
        })()}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const p = field('referral_date');
          return p ? <IntakeFormField {...p} /> : null;
        })()}
      </div>

      {(() => {
        const p = field('reason_for_referral');
        return p ? (
          <IntakeFormField
            {...p}
            fieldType="jsonb"
            placeholder="Describe the reason for referral..."
          />
        ) : null;
      })()}
    </div>
  );
});
