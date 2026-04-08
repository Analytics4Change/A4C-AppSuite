/**
 * Demographics Section — Step 1 of client intake form.
 *
 * Fields: first_name, last_name, middle_name, preferred_name, date_of_birth,
 * gender, gender_identity, pronouns, race, ethnicity, primary_language,
 * secondary_language, interpreter_needed, marital_status, citizenship_status,
 * photo_url, mrn, external_id, drivers_license.
 */

import React from 'react';
import { observer } from 'mobx-react-lite';
import { IntakeFormField } from './IntakeFormField';
import { getFieldProps } from './useFieldProps';
import type { IntakeSectionProps } from './types';
import { MARITAL_STATUS_LABELS, CITIZENSHIP_STATUS_OPTIONS } from '@/types/client.types';

/** Gender options — hardcoded per Decision 6 (OMB compliance) */
const GENDER_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['male', 'Male'],
  ['female', 'Female'],
  ['non_binary', 'Non-Binary'],
  ['other', 'Other'],
  ['prefer_not_to_answer', 'Prefer not to answer'],
] as const;

/** Ethnicity options — OMB two-question format */
const ETHNICITY_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['hispanic_latino', 'Hispanic or Latino'],
  ['not_hispanic_latino', 'Not Hispanic or Latino'],
  ['prefer_not_to_answer', 'Prefer not to answer'],
] as const;

/** Race options — OMB categories (multi-select) */
const RACE_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['american_indian_alaska_native', 'American Indian or Alaska Native'],
  ['asian', 'Asian'],
  ['black_african_american', 'Black or African American'],
  ['native_hawaiian_pacific_islander', 'Native Hawaiian or Other Pacific Islander'],
  ['white', 'White'],
  ['other', 'Other'],
  ['prefer_not_to_answer', 'Prefer not to answer'],
] as const;

const MARITAL_OPTIONS = Object.entries(MARITAL_STATUS_LABELS) as ReadonlyArray<
  readonly [string, string]
>;

const CITIZENSHIP_OPTIONS = CITIZENSHIP_STATUS_OPTIONS.map(
  (opt) => [opt, opt] as const
) as ReadonlyArray<readonly [string, string]>;

export const DemographicsSection: React.FC<IntakeSectionProps> = observer(({ viewModel }) => {
  const field = (key: string) => getFieldProps(viewModel, key);

  const textFields = ['first_name', 'last_name', 'middle_name', 'preferred_name'] as const;

  return (
    <div className="space-y-6" data-testid="intake-section-demographics">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Demographics</h3>
        <p className="text-sm text-gray-500 mt-1">Basic identifying information</p>
      </div>

      {/* Name fields — 2-column grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {textFields.map((key) => {
          const props = field(key);
          return props ? <IntakeFormField key={key} {...props} /> : null;
        })}
      </div>

      {/* DOB + Gender row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const p = field('date_of_birth');
          return p ? <IntakeFormField {...p} /> : null;
        })()}
        {(() => {
          const p = field('gender');
          return p ? <IntakeFormField {...p} enumOptions={GENDER_OPTIONS} /> : null;
        })()}
      </div>

      {/* Gender identity + Pronouns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const p = field('gender_identity');
          return p ? <IntakeFormField {...p} placeholder="e.g., Transgender male" /> : null;
        })()}
        {(() => {
          const p = field('pronouns');
          return p ? (
            <IntakeFormField {...p} placeholder="e.g., he/him, she/her, they/them" />
          ) : null;
        })()}
      </div>

      {/* Race (multi-select) + Ethnicity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const p = field('race');
          return p ? <IntakeFormField {...p} multiEnumOptions={RACE_OPTIONS} /> : null;
        })()}
        {(() => {
          const p = field('ethnicity');
          return p ? <IntakeFormField {...p} enumOptions={ETHNICITY_OPTIONS} /> : null;
        })()}
      </div>

      {/* Language fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const p = field('primary_language');
          return p ? <IntakeFormField {...p} placeholder="e.g., English, Spanish" /> : null;
        })()}
        {(() => {
          const p = field('secondary_language');
          return p ? <IntakeFormField {...p} placeholder="e.g., Spanish" /> : null;
        })()}
      </div>

      {/* Interpreter */}
      {(() => {
        const p = field('interpreter_needed');
        return p ? <IntakeFormField {...p} /> : null;
      })()}

      {/* Marital + Citizenship */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const p = field('marital_status');
          return p ? <IntakeFormField {...p} enumOptions={MARITAL_OPTIONS} /> : null;
        })()}
        {(() => {
          const p = field('citizenship_status');
          return p ? <IntakeFormField {...p} enumOptions={CITIZENSHIP_OPTIONS} /> : null;
        })()}
      </div>

      {/* Identifiers */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(() => {
          const p = field('mrn');
          return p ? <IntakeFormField {...p} placeholder="Medical Record Number" /> : null;
        })()}
        {(() => {
          const p = field('external_id');
          return p ? <IntakeFormField {...p} placeholder="External system ID" /> : null;
        })()}
        {(() => {
          const p = field('drivers_license');
          return p ? <IntakeFormField {...p} /> : null;
        })()}
      </div>
    </div>
  );
});
