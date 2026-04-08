/**
 * Education Section — Step 10 of client intake form.
 *
 * Fields: education_status, grade_level, iep_status.
 */

import React from 'react';
import { observer } from 'mobx-react-lite';
import { IntakeFormField } from './IntakeFormField';
import { getFieldProps } from './useFieldProps';
import type { IntakeSectionProps } from './types';

const EDUCATION_STATUS_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['enrolled', 'Enrolled'],
  ['not_enrolled', 'Not Enrolled'],
  ['graduated', 'Graduated / GED'],
  ['dropped_out', 'Dropped Out'],
  ['home_schooled', 'Home Schooled'],
  ['suspended', 'Suspended'],
  ['expelled', 'Expelled'],
  ['unknown', 'Unknown'],
] as const;

export const EducationSection: React.FC<IntakeSectionProps> = observer(({ viewModel }) => {
  const field = (key: string) => getFieldProps(viewModel, key);

  return (
    <div className="space-y-6" data-testid="intake-section-education">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Education</h3>
        <p className="text-sm text-gray-500 mt-1">Educational status and accommodations</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const p = field('education_status');
          return p ? <IntakeFormField {...p} enumOptions={EDUCATION_STATUS_OPTIONS} /> : null;
        })()}
        {(() => {
          const p = field('grade_level');
          return p ? <IntakeFormField {...p} placeholder="e.g., 9th Grade, 12th Grade" /> : null;
        })()}
      </div>

      {(() => {
        const p = field('iep_status');
        return p ? <IntakeFormField {...p} /> : null;
      })()}
    </div>
  );
});
