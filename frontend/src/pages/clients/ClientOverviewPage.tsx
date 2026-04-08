/**
 * ClientOverviewPage — Full client record display (read-only).
 *
 * Route: /clients/:clientId (index)
 * Renders the complete client record organized by section:
 * Demographics, Contact Info, Guardian/Custody, Referral, Admission,
 * Insurance, Clinical, Medical, Legal, Education, Discharge (if applicable).
 * Sub-entities (phones, emails, addresses, insurance, placements,
 * funding sources, contact assignments) rendered as card lists.
 */

import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  User,
  Phone,
  Shield,
  FileText,
  Heart,
  Stethoscope,
  Scale,
  GraduationCap,
  ClipboardList,
  Building2,
  DollarSign,
  Users,
  LogOut,
} from 'lucide-react';
import type {
  Client,
  ClientPhone,
  ClientEmail,
  ClientAddress,
  ClientInsurancePolicy,
  ClientPlacementHistory,
  ClientFundingSource,
  ClientContactAssignment,
} from '@/types/client.types';
import {
  CLIENT_STATUS_LABELS,
  PHONE_TYPE_LABELS,
  EMAIL_TYPE_LABELS,
  ADDRESS_TYPE_LABELS,
  INSURANCE_POLICY_TYPE_LABELS,
  PLACEMENT_ARRANGEMENT_LABELS,
  CONTACT_DESIGNATION_LABELS,
  DISCHARGE_OUTCOME_LABELS,
  DISCHARGE_REASON_LABELS,
  DISCHARGE_PLACEMENT_LABELS,
  LEGAL_CUSTODY_STATUS_LABELS,
  FINANCIAL_GUARANTOR_TYPE_LABELS,
  MARITAL_STATUS_LABELS,
  SUICIDE_RISK_STATUS_LABELS,
  VIOLENCE_RISK_STATUS_LABELS,
  INITIAL_RISK_LEVEL_LABELS,
} from '@/types/client.types';

interface ClientContext {
  client: Client;
}

/** Renders a single field row: label + value. Returns null if value is empty. */
const Field: React.FC<{
  label: string;
  value: string | number | boolean | null | undefined;
  testId?: string;
}> = ({ label, value, testId }) => {
  if (value === null || value === undefined || value === '') return null;
  const display = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  return (
    <div data-testid={testId}>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="font-medium text-gray-900">{display}</p>
    </div>
  );
};

/** Formats a date string for display */
const fmtDate = (d: string | null | undefined): string | null => {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
};

/** Resolves a label from a label map, falling back to title-case of the key */
const labelOf = <T extends string>(
  map: Record<T, string>,
  key: string | null | undefined
): string | null => {
  if (!key) return null;
  const label = (map as Record<string, string>)[key];
  if (label) return label;
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

/** Formats a JSONB field for display (stringifies objects, returns string as-is) */
const fmtJson = (val: Record<string, unknown> | string | null | undefined): string | null => {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && Object.keys(val).length === 0) return null;
  return JSON.stringify(val, null, 2);
};

/** Section wrapper with icon + title */
const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  testId: string;
  children: React.ReactNode;
}> = ({ title, icon, testId, children }) => (
  <Card data-testid={testId}>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base font-semibold">
        {icon}
        {title}
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
    </CardContent>
  </Card>
);

/** Empty state for sub-entity lists */
const EmptyList: React.FC<{ label: string }> = ({ label }) => (
  <p className="text-sm text-gray-400 italic col-span-full">No {label} on file</p>
);

// =============================================================================
// Sub-entity card renderers
// =============================================================================

const PhoneCard: React.FC<{ phone: ClientPhone }> = ({ phone }) => (
  <div className="rounded-lg border border-gray-200 p-3 space-y-1" data-testid="client-phone-card">
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">{phone.phone_number}</span>
      {phone.is_primary && (
        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Primary</span>
      )}
    </div>
    <p className="text-xs text-gray-500">{PHONE_TYPE_LABELS[phone.phone_type]}</p>
  </div>
);

const EmailCard: React.FC<{ email: ClientEmail }> = ({ email }) => (
  <div className="rounded-lg border border-gray-200 p-3 space-y-1" data-testid="client-email-card">
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">{email.email}</span>
      {email.is_primary && (
        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Primary</span>
      )}
    </div>
    <p className="text-xs text-gray-500">{EMAIL_TYPE_LABELS[email.email_type]}</p>
  </div>
);

const AddressCard: React.FC<{ address: ClientAddress }> = ({ address }) => (
  <div
    className="rounded-lg border border-gray-200 p-3 space-y-1"
    data-testid="client-address-card"
  >
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">{ADDRESS_TYPE_LABELS[address.address_type]}</span>
      {address.is_primary && (
        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Primary</span>
      )}
    </div>
    <p className="text-xs text-gray-500">
      {address.street1}
      {address.street2 ? `, ${address.street2}` : ''}
    </p>
    <p className="text-xs text-gray-500">
      {address.city}, {address.state} {address.zip}
    </p>
  </div>
);

const InsuranceCard: React.FC<{ policy: ClientInsurancePolicy }> = ({ policy }) => (
  <div
    className="rounded-lg border border-gray-200 p-3 space-y-1"
    data-testid="client-insurance-card"
  >
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">{policy.payer_name}</span>
      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
        {INSURANCE_POLICY_TYPE_LABELS[policy.policy_type]}
      </span>
    </div>
    {policy.policy_number && (
      <p className="text-xs text-gray-500">Policy #: {policy.policy_number}</p>
    )}
    {policy.group_number && <p className="text-xs text-gray-500">Group #: {policy.group_number}</p>}
    {policy.subscriber_name && (
      <p className="text-xs text-gray-500">Subscriber: {policy.subscriber_name}</p>
    )}
    {(policy.coverage_start_date || policy.coverage_end_date) && (
      <p className="text-xs text-gray-500">
        {fmtDate(policy.coverage_start_date)} &ndash;{' '}
        {fmtDate(policy.coverage_end_date) ?? 'Present'}
      </p>
    )}
  </div>
);

const PlacementCard: React.FC<{ placement: ClientPlacementHistory }> = ({ placement }) => (
  <div
    className={`rounded-lg border p-3 space-y-1 ${placement.is_current ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}
    data-testid="client-placement-card"
  >
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">
        {labelOf(PLACEMENT_ARRANGEMENT_LABELS, placement.placement_arrangement)}
      </span>
      {placement.is_current && (
        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
          Current
        </span>
      )}
    </div>
    <p className="text-xs text-gray-500">
      {fmtDate(placement.start_date)} &ndash; {fmtDate(placement.end_date) ?? 'Present'}
    </p>
    {placement.reason && <p className="text-xs text-gray-500">{placement.reason}</p>}
  </div>
);

const FundingCard: React.FC<{ source: ClientFundingSource }> = ({ source }) => (
  <div
    className="rounded-lg border border-gray-200 p-3 space-y-1"
    data-testid="client-funding-card"
  >
    <span className="text-sm font-medium">{source.source_name}</span>
    <p className="text-xs text-gray-500">{source.source_type}</p>
    {source.reference_number && (
      <p className="text-xs text-gray-500">Ref #: {source.reference_number}</p>
    )}
  </div>
);

const ContactCard: React.FC<{ assignment: ClientContactAssignment }> = ({ assignment }) => (
  <div
    className="rounded-lg border border-gray-200 p-3 space-y-1"
    data-testid="client-contact-card"
  >
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">{assignment.contact_name ?? 'Unknown'}</span>
      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
        {labelOf(CONTACT_DESIGNATION_LABELS, assignment.designation)}
      </span>
    </div>
    {assignment.contact_email && (
      <p className="text-xs text-gray-500">{assignment.contact_email}</p>
    )}
  </div>
);

// =============================================================================
// Main Component
// =============================================================================

export const ClientOverviewPage: React.FC = () => {
  const { client } = useOutletContext<ClientContext>();

  const activePhones = client.phones?.filter((p) => p.is_active) ?? [];
  const activeEmails = client.emails?.filter((e) => e.is_active) ?? [];
  const activeAddresses = client.addresses?.filter((a) => a.is_active) ?? [];
  const activeInsurance = client.insurance_policies?.filter((p) => p.is_active) ?? [];
  const activeFunding = client.funding_sources?.filter((f) => f.is_active) ?? [];
  const activeContacts = client.contact_assignments?.filter((c) => c.is_active) ?? [];
  const placements = client.placement_history ?? [];

  return (
    <div className="space-y-6" data-testid="client-overview">
      {/* Status banner for discharged clients */}
      {client.status === 'discharged' && (
        <div
          className="rounded-lg bg-amber-50 border border-amber-200 p-4 flex items-center gap-3"
          role="status"
          data-testid="client-discharged-banner"
        >
          <LogOut size={18} className="text-amber-600" />
          <span className="text-sm font-medium text-amber-800">
            This client was discharged on {fmtDate(client.discharge_date)}.
          </span>
        </div>
      )}

      {/* Demographics */}
      <Section
        title="Demographics"
        icon={<User size={18} className="text-blue-600" />}
        testId="section-demographics"
      >
        <Field label="First Name" value={client.first_name} />
        <Field label="Last Name" value={client.last_name} />
        <Field label="Middle Name" value={client.middle_name} />
        <Field label="Preferred Name" value={client.preferred_name} />
        <Field label="Date of Birth" value={fmtDate(client.date_of_birth)} />
        <Field label="Gender" value={client.gender} />
        <Field label="Gender Identity" value={client.gender_identity} />
        <Field label="Pronouns" value={client.pronouns} />
        <Field label="Race" value={client.race?.join(', ')} />
        <Field label="Ethnicity" value={client.ethnicity} />
        <Field label="Primary Language" value={client.primary_language} />
        <Field label="Secondary Language" value={client.secondary_language} />
        <Field label="Interpreter Needed" value={client.interpreter_needed} />
        <Field
          label="Marital Status"
          value={labelOf(MARITAL_STATUS_LABELS, client.marital_status)}
        />
        <Field label="Citizenship Status" value={client.citizenship_status} />
        <Field label="MRN" value={client.mrn} />
        <Field label="External ID" value={client.external_id} />
        <Field label="Driver's License" value={client.drivers_license} />
        <Field label="Status" value={CLIENT_STATUS_LABELS[client.status]} />
      </Section>

      {/* Contact Info */}
      <Section
        title="Contact Information"
        icon={<Phone size={18} className="text-green-600" />}
        testId="section-contact"
      >
        <div className="col-span-full space-y-4">
          {/* Phones */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Phones</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {activePhones.length > 0 ? (
                activePhones.map((p) => <PhoneCard key={p.id} phone={p} />)
              ) : (
                <EmptyList label="phone numbers" />
              )}
            </div>
          </div>
          {/* Emails */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Emails</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {activeEmails.length > 0 ? (
                activeEmails.map((e) => <EmailCard key={e.id} email={e} />)
              ) : (
                <EmptyList label="email addresses" />
              )}
            </div>
          </div>
          {/* Addresses */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Addresses</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {activeAddresses.length > 0 ? (
                activeAddresses.map((a) => <AddressCard key={a.id} address={a} />)
              ) : (
                <EmptyList label="addresses" />
              )}
            </div>
          </div>
        </div>
      </Section>

      {/* Guardian / Custody */}
      <Section
        title="Guardian / Custody"
        icon={<Shield size={18} className="text-purple-600" />}
        testId="section-guardian"
      >
        <Field
          label="Legal Custody Status"
          value={labelOf(LEGAL_CUSTODY_STATUS_LABELS, client.legal_custody_status)}
        />
        <Field label="Court Ordered Placement" value={client.court_ordered_placement} />
        <Field
          label="Financial Guarantor Type"
          value={labelOf(FINANCIAL_GUARANTOR_TYPE_LABELS, client.financial_guarantor_type)}
        />
      </Section>

      {/* Referral */}
      <Section
        title="Referral"
        icon={<FileText size={18} className="text-indigo-600" />}
        testId="section-referral"
      >
        <Field label="Referral Source Type" value={client.referral_source_type} />
        <Field label="Referral Organization" value={client.referral_organization} />
        <Field label="Referral Date" value={fmtDate(client.referral_date)} />
        <Field label="Reason for Referral" value={client.reason_for_referral} />
      </Section>

      {/* Admission */}
      <Section
        title="Admission"
        icon={<ClipboardList size={18} className="text-teal-600" />}
        testId="section-admission"
      >
        <Field label="Admission Date" value={fmtDate(client.admission_date)} />
        <Field label="Admission Type" value={client.admission_type} />
        <Field label="Level of Care" value={client.level_of_care} />
        <Field
          label="Expected Length of Stay"
          value={client.expected_length_of_stay ? `${client.expected_length_of_stay} days` : null}
        />
        <Field
          label="Initial Risk Level"
          value={labelOf(INITIAL_RISK_LEVEL_LABELS, client.initial_risk_level)}
        />
        <Field
          label="Current Placement"
          value={labelOf(PLACEMENT_ARRANGEMENT_LABELS, client.placement_arrangement)}
        />
      </Section>

      {/* Placement History */}
      {placements.length > 0 && (
        <Section
          title="Placement History"
          icon={<Building2 size={18} className="text-orange-600" />}
          testId="section-placements"
        >
          <div className="col-span-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {placements.map((p) => (
              <PlacementCard key={p.id} placement={p} />
            ))}
          </div>
        </Section>
      )}

      {/* Insurance */}
      <Section
        title="Insurance"
        icon={<DollarSign size={18} className="text-emerald-600" />}
        testId="section-insurance"
      >
        <Field label="Medicaid ID" value={client.medicaid_id} />
        <Field label="Medicare ID" value={client.medicare_id} />
        <div className="col-span-full">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Policies</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {activeInsurance.length > 0 ? (
              activeInsurance.map((p) => <InsuranceCard key={p.id} policy={p} />)
            ) : (
              <EmptyList label="insurance policies" />
            )}
          </div>
        </div>
      </Section>

      {/* Funding Sources */}
      {activeFunding.length > 0 && (
        <Section
          title="Funding Sources"
          icon={<DollarSign size={18} className="text-lime-600" />}
          testId="section-funding"
        >
          <div className="col-span-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {activeFunding.map((f) => (
              <FundingCard key={f.id} source={f} />
            ))}
          </div>
        </Section>
      )}

      {/* Clinical */}
      <Section
        title="Clinical Profile"
        icon={<Heart size={18} className="text-rose-600" />}
        testId="section-clinical"
      >
        <Field label="Primary Diagnosis" value={fmtJson(client.primary_diagnosis)} />
        <Field label="Secondary Diagnoses" value={fmtJson(client.secondary_diagnoses)} />
        <Field label="DSM-5 Diagnoses" value={fmtJson(client.dsm5_diagnoses)} />
        <Field label="Presenting Problem" value={client.presenting_problem} />
        <Field
          label="Suicide Risk Status"
          value={labelOf(SUICIDE_RISK_STATUS_LABELS, client.suicide_risk_status)}
        />
        <Field
          label="Violence Risk Status"
          value={labelOf(VIOLENCE_RISK_STATUS_LABELS, client.violence_risk_status)}
        />
        <Field label="Trauma History Indicator" value={client.trauma_history_indicator} />
        <Field label="Substance Use History" value={client.substance_use_history} />
        <Field label="Developmental History" value={client.developmental_history} />
        <Field label="Previous Treatment History" value={client.previous_treatment_history} />
      </Section>

      {/* Medical */}
      <Section
        title="Medical"
        icon={<Stethoscope size={18} className="text-cyan-600" />}
        testId="section-medical"
      >
        <Field label="Allergies" value={fmtJson(client.allergies)} />
        <Field label="Medical Conditions" value={fmtJson(client.medical_conditions)} />
        <Field label="Immunization Status" value={client.immunization_status} />
        <Field label="Dietary Restrictions" value={client.dietary_restrictions} />
        <Field label="Special Medical Needs" value={client.special_medical_needs} />
      </Section>

      {/* Legal */}
      <Section
        title="Legal"
        icon={<Scale size={18} className="text-gray-600" />}
        testId="section-legal"
      >
        <Field label="Court Case Number" value={client.court_case_number} />
        <Field label="State Agency" value={client.state_agency} />
        <Field label="Legal Status" value={client.legal_status} />
        <Field label="Mandated Reporting" value={client.mandated_reporting_status} />
        <Field
          label="Protective Services Involvement"
          value={client.protective_services_involvement}
        />
        <Field label="Safety Plan Required" value={client.safety_plan_required} />
      </Section>

      {/* Education */}
      <Section
        title="Education"
        icon={<GraduationCap size={18} className="text-amber-600" />}
        testId="section-education"
      >
        <Field label="Education Status" value={client.education_status} />
        <Field label="Grade Level" value={client.grade_level} />
        <Field label="IEP Status" value={client.iep_status} />
      </Section>

      {/* Contact Assignments */}
      <Section
        title="Assigned Contacts"
        icon={<Users size={18} className="text-violet-600" />}
        testId="section-contacts"
      >
        <div className="col-span-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {activeContacts.length > 0 ? (
            activeContacts.map((c) => <ContactCard key={c.id} assignment={c} />)
          ) : (
            <EmptyList label="assigned contacts" />
          )}
        </div>
      </Section>

      {/* Discharge (only shown for discharged clients) */}
      {client.status === 'discharged' && (
        <Section
          title="Discharge"
          icon={<LogOut size={18} className="text-amber-600" />}
          testId="section-discharge"
        >
          <Field label="Discharge Date" value={fmtDate(client.discharge_date)} />
          <Field
            label="Outcome"
            value={labelOf(DISCHARGE_OUTCOME_LABELS, client.discharge_outcome)}
          />
          <Field label="Reason" value={labelOf(DISCHARGE_REASON_LABELS, client.discharge_reason)} />
          <Field
            label="Discharge Placement"
            value={labelOf(DISCHARGE_PLACEMENT_LABELS, client.discharge_placement)}
          />
          <Field label="Discharge Diagnosis" value={fmtJson(client.discharge_diagnosis)} />
        </Section>
      )}
    </div>
  );
};
