/**
 * Client Management Types
 *
 * Domain model types for client intake, lifecycle, and sub-entity management.
 * Matches api.list_clients(), api.get_client(), and write RPC return shapes.
 * All properties use snake_case matching database columns.
 */

// =============================================================================
// 1. Union Types (matching DB CHECK constraints)
// =============================================================================

export type ClientStatus = 'active' | 'inactive' | 'discharged';

export type ClientDataSource = 'manual' | 'api' | 'import';

export type PhoneType = 'mobile' | 'home' | 'work' | 'fax' | 'other';

export type EmailType = 'personal' | 'work' | 'school' | 'other';

export type AddressType = 'home' | 'mailing' | 'school' | 'placement' | 'other';

export type InsurancePolicyType = 'primary' | 'secondary' | 'medicaid' | 'medicare';

export type PlacementArrangement =
  | 'residential_treatment'
  | 'therapeutic_foster_care'
  | 'group_home'
  | 'foster_care'
  | 'kinship_placement'
  | 'adoptive_placement'
  | 'independent_living'
  | 'home_based'
  | 'detention'
  | 'secure_residential'
  | 'hospital_inpatient'
  | 'shelter'
  | 'other';

export type ContactDesignation =
  | 'clinician'
  | 'therapist'
  | 'psychiatrist'
  | 'behavioral_analyst'
  | 'case_worker'
  | 'guardian'
  | 'emergency_contact'
  | 'program_manager'
  | 'primary_care_physician'
  | 'prescriber'
  | 'probation_officer'
  | 'caseworker';

export type DischargeOutcome = 'successful' | 'unsuccessful';

export type DischargeReason =
  | 'graduated_program'
  | 'achieved_treatment_goals'
  | 'awol'
  | 'ama'
  | 'administrative'
  | 'hospitalization_medical'
  | 'insufficient_progress'
  | 'intermediate_secure_care'
  | 'secure_care'
  | 'ten_day_notice'
  | 'court_ordered'
  | 'deceased'
  | 'transfer'
  | 'medical';

export type DischargePlacement =
  | 'home'
  | 'lower_level_of_care'
  | 'higher_level_of_care'
  | 'secure_care'
  | 'intermediate_secure_care'
  | 'other_program'
  | 'hospitalization'
  | 'incarceration'
  | 'other';

export type LegalCustodyStatus =
  | 'parent_guardian'
  | 'state_child_welfare'
  | 'juvenile_justice'
  | 'guardianship'
  | 'emancipated_minor'
  | 'other';

export type FinancialGuarantorType =
  | 'parent_guardian'
  | 'state_agency'
  | 'juvenile_justice'
  | 'self'
  | 'insurance_only'
  | 'tribal_agency'
  | 'va'
  | 'other';

export type MaritalStatus =
  | 'single'
  | 'married'
  | 'divorced'
  | 'separated'
  | 'widowed'
  | 'domestic_partnership';

export type SuicideRiskStatus = 'low_risk' | 'moderate_risk' | 'high_risk';

export type ViolenceRiskStatus = 'low_risk' | 'moderate_risk' | 'high_risk';

export type InitialRiskLevel = 'low' | 'moderate' | 'high' | 'critical';

// =============================================================================
// 2. Display Label Maps
// =============================================================================

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  discharged: 'Discharged',
};

export const PHONE_TYPE_LABELS: Record<PhoneType, string> = {
  mobile: 'Mobile',
  home: 'Home',
  work: 'Work',
  fax: 'Fax',
  other: 'Other',
};

export const EMAIL_TYPE_LABELS: Record<EmailType, string> = {
  personal: 'Personal',
  work: 'Work',
  school: 'School',
  other: 'Other',
};

export const ADDRESS_TYPE_LABELS: Record<AddressType, string> = {
  home: 'Home',
  mailing: 'Mailing',
  school: 'School',
  placement: 'Placement',
  other: 'Other',
};

export const INSURANCE_POLICY_TYPE_LABELS: Record<InsurancePolicyType, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  medicaid: 'Medicaid',
  medicare: 'Medicare',
};

export const PLACEMENT_ARRANGEMENT_LABELS: Record<PlacementArrangement, string> = {
  residential_treatment: 'Residential Treatment',
  therapeutic_foster_care: 'Therapeutic Foster Care',
  group_home: 'Group Home',
  foster_care: 'Foster Care',
  kinship_placement: 'Kinship Placement',
  adoptive_placement: 'Adoptive Placement',
  independent_living: 'Independent Living',
  home_based: 'Home-Based',
  detention: 'Detention',
  secure_residential: 'Secure Residential',
  hospital_inpatient: 'Hospital Inpatient',
  shelter: 'Shelter',
  other: 'Other',
};

export const CONTACT_DESIGNATION_LABELS: Record<ContactDesignation, string> = {
  clinician: 'Clinician',
  therapist: 'Therapist',
  psychiatrist: 'Psychiatrist',
  behavioral_analyst: 'Behavioral Analyst',
  case_worker: 'Case Worker',
  guardian: 'Guardian',
  emergency_contact: 'Emergency Contact',
  program_manager: 'Program Manager',
  primary_care_physician: 'Primary Care Physician',
  prescriber: 'Prescriber',
  probation_officer: 'Probation Officer',
  caseworker: 'Caseworker',
};

export const DISCHARGE_OUTCOME_LABELS: Record<DischargeOutcome, string> = {
  successful: 'Successful',
  unsuccessful: 'Unsuccessful',
};

export const DISCHARGE_REASON_LABELS: Record<DischargeReason, string> = {
  graduated_program: 'Graduated Program',
  achieved_treatment_goals: 'Achieved Treatment Goals',
  awol: 'AWOL',
  ama: 'Against Medical Advice',
  administrative: 'Administrative',
  hospitalization_medical: 'Hospitalization (Medical)',
  insufficient_progress: 'Insufficient Progress',
  intermediate_secure_care: 'Intermediate Secure Care',
  secure_care: 'Secure Care',
  ten_day_notice: '10-Day Notice',
  court_ordered: 'Court Ordered',
  deceased: 'Deceased',
  transfer: 'Transfer',
  medical: 'Medical',
};

export const DISCHARGE_PLACEMENT_LABELS: Record<DischargePlacement, string> = {
  home: 'Home',
  lower_level_of_care: 'Lower Level of Care',
  higher_level_of_care: 'Higher Level of Care',
  secure_care: 'Secure Care',
  intermediate_secure_care: 'Intermediate Secure Care',
  other_program: 'Other Program',
  hospitalization: 'Hospitalization',
  incarceration: 'Incarceration',
  other: 'Other',
};

export const LEGAL_CUSTODY_STATUS_LABELS: Record<LegalCustodyStatus, string> = {
  parent_guardian: 'Parent/Guardian',
  state_child_welfare: 'State Child Welfare',
  juvenile_justice: 'Juvenile Justice',
  guardianship: 'Guardianship',
  emancipated_minor: 'Emancipated Minor',
  other: 'Other',
};

export const FINANCIAL_GUARANTOR_TYPE_LABELS: Record<FinancialGuarantorType, string> = {
  parent_guardian: 'Parent/Guardian',
  state_agency: 'State Agency',
  juvenile_justice: 'Juvenile Justice',
  self: 'Self',
  insurance_only: 'Insurance Only',
  tribal_agency: 'Tribal Agency',
  va: 'VA',
  other: 'Other',
};

export const MARITAL_STATUS_LABELS: Record<MaritalStatus, string> = {
  single: 'Single',
  married: 'Married',
  divorced: 'Divorced',
  separated: 'Separated',
  widowed: 'Widowed',
  domestic_partnership: 'Domestic Partnership',
};

export const SUICIDE_RISK_STATUS_LABELS: Record<SuicideRiskStatus, string> = {
  low_risk: 'Low Risk',
  moderate_risk: 'Moderate Risk',
  high_risk: 'High Risk',
};

export const VIOLENCE_RISK_STATUS_LABELS: Record<ViolenceRiskStatus, string> = {
  low_risk: 'Low Risk',
  moderate_risk: 'Moderate Risk',
  high_risk: 'High Risk',
};

export const INITIAL_RISK_LEVEL_LABELS: Record<InitialRiskLevel, string> = {
  low: 'Low Risk',
  moderate: 'Moderate Risk',
  high: 'High Risk',
  critical: 'Critical/Imminent Risk',
};

export const CITIZENSHIP_STATUS_OPTIONS = [
  'U.S. Citizen',
  'Lawful Permanent Resident (Green Card Holder)',
  'Nonimmigrant Visa Holder (Temporary Status)',
  'Refugee or Asylee',
  'Other Immigration Status',
  'Prefer not to answer',
] as const;

// =============================================================================
// 3. Sub-Entity Interfaces
// =============================================================================

export interface ClientPhone {
  id: string;
  client_id: string;
  organization_id: string;
  phone_number: string;
  phone_type: PhoneType;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  last_event_id: string | null;
}

export interface ClientEmail {
  id: string;
  client_id: string;
  organization_id: string;
  email: string;
  email_type: EmailType;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  last_event_id: string | null;
}

export interface ClientAddress {
  id: string;
  client_id: string;
  organization_id: string;
  address_type: AddressType;
  street1: string;
  street2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  last_event_id: string | null;
}

export interface ClientInsurancePolicy {
  id: string;
  client_id: string;
  organization_id: string;
  policy_type: InsurancePolicyType;
  payer_name: string;
  policy_number: string | null;
  group_number: string | null;
  subscriber_name: string | null;
  subscriber_relation: string | null;
  coverage_start_date: string | null;
  coverage_end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  last_event_id: string | null;
}

export interface ClientPlacementHistory {
  id: string;
  client_id: string;
  organization_id: string;
  placement_arrangement: PlacementArrangement;
  start_date: string;
  end_date: string | null;
  is_current: boolean;
  reason: string | null;
  created_at: string;
  updated_at: string | null;
  last_event_id: string | null;
  organization_unit_id: string | null;
  organization_unit_name?: string | null;
  /**
   * Current activation state of the placement's OU, derived at read time via
   * LEFT JOIN to organization_units_projection. Null when no OU is assigned or
   * the OU row has been removed. See migration 20260423013804.
   */
  organization_unit_is_active?: boolean | null;
  /**
   * Soft-delete timestamp of the placement's OU (ISO string) if present.
   * Non-null means the OU has been soft-deleted. See migration 20260423013804.
   */
  organization_unit_deleted_at?: string | null;
}

export interface ClientFundingSource {
  id: string;
  client_id: string;
  organization_id: string;
  source_type: string;
  source_name: string;
  reference_number: string | null;
  start_date: string | null;
  end_date: string | null;
  custom_fields: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  last_event_id: string | null;
}

/** Returned by api.get_client lateral join (contact assignment + contact name/email) */
export interface ClientContactAssignment {
  id: string;
  client_id: string;
  contact_id: string;
  organization_id: string;
  designation: ContactDesignation;
  assigned_at: string;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  last_event_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
}

// =============================================================================
// 4. Main Interfaces
// =============================================================================

/** Full client record as returned by api.get_client() */
export interface Client {
  id: string;
  organization_id: string;
  organization_unit_id: string | null;

  // Lifecycle
  status: ClientStatus;
  data_source: ClientDataSource;

  // Demographics
  first_name: string;
  last_name: string;
  middle_name: string | null;
  preferred_name: string | null;
  date_of_birth: string;
  gender: string;
  gender_identity: string | null;
  pronouns: string | null;
  race: string[] | null;
  ethnicity: string | null;
  primary_language: string | null;
  secondary_language: string | null;
  interpreter_needed: boolean | null;
  marital_status: string | null;
  citizenship_status: string | null;
  photo_url: string | null;
  mrn: string | null;
  external_id: string | null;
  drivers_license: string | null;

  // Referral
  referral_source_type: string | null;
  referral_organization: string | null;
  referral_date: string | null;
  reason_for_referral: string | null;

  // Admission
  admission_date: string;
  admission_type: string | null;
  level_of_care: string | null;
  expected_length_of_stay: number | null;
  initial_risk_level: string | null;
  placement_arrangement: string | null;

  // Insurance IDs
  medicaid_id: string | null;
  medicare_id: string | null;

  // Clinical Profile
  primary_diagnosis: Record<string, unknown> | null;
  secondary_diagnoses: Record<string, unknown> | null;
  dsm5_diagnoses: Record<string, unknown> | null;
  presenting_problem: string | null;
  suicide_risk_status: string | null;
  violence_risk_status: string | null;
  trauma_history_indicator: boolean | null;
  substance_use_history: string | null;
  developmental_history: string | null;
  previous_treatment_history: string | null;

  // Medical
  allergies: Record<string, unknown>;
  medical_conditions: Record<string, unknown>;
  immunization_status: string | null;
  dietary_restrictions: string | null;
  special_medical_needs: string | null;

  // Legal
  legal_custody_status: string | null;
  court_ordered_placement: boolean | null;
  financial_guarantor_type: string | null;
  court_case_number: string | null;
  state_agency: string | null;
  legal_status: string | null;
  mandated_reporting_status: boolean | null;
  protective_services_involvement: boolean | null;
  safety_plan_required: boolean | null;

  // Discharge (Decision 78)
  discharge_date: string | null;
  discharge_outcome: DischargeOutcome | null;
  discharge_reason: DischargeReason | null;
  discharge_diagnosis: Record<string, unknown> | null;
  discharge_placement: DischargePlacement | null;

  // Education
  education_status: string | null;
  grade_level: string | null;
  iep_status: boolean | null;

  // Custom fields
  custom_fields: Record<string, unknown>;

  // Audit
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  last_event_id: string | null;

  // Sub-entities (from lateral joins)
  phones: ClientPhone[];
  emails: ClientEmail[];
  addresses: ClientAddress[];
  insurance_policies: ClientInsurancePolicy[];
  placement_history: ClientPlacementHistory[];
  funding_sources: ClientFundingSource[];
  contact_assignments: ClientContactAssignment[];
}

/** Subset returned by api.list_clients() */
export interface ClientListItem {
  id: string;
  first_name: string;
  last_name: string;
  middle_name: string | null;
  preferred_name: string | null;
  date_of_birth: string;
  gender: string;
  status: ClientStatus;
  mrn: string | null;
  external_id: string | null;
  admission_date: string;
  organization_unit_id: string | null;
  placement_arrangement: string | null;
  initial_risk_level: string | null;
  created_at: string;
}

// =============================================================================
// 5. Params Types
// =============================================================================

export interface RegisterClientParams {
  client_data: Record<string, unknown>;
  reason?: string;
  correlation_id?: string;
}

export interface UpdateClientParams {
  changes: Record<string, unknown>;
  reason?: string;
}

export interface AdmitClientParams {
  admission_data?: Record<string, unknown>;
  reason?: string;
}

export interface DischargeClientParams {
  discharge_date: string;
  discharge_outcome: DischargeOutcome;
  discharge_reason: DischargeReason;
  discharge_diagnosis?: Record<string, unknown>;
  discharge_placement?: DischargePlacement;
  reason?: string;
}

export interface AddPhoneParams {
  phone_number: string;
  phone_type?: PhoneType;
  is_primary?: boolean;
  reason?: string;
  correlation_id?: string;
}

export interface UpdatePhoneParams {
  phone_number?: string;
  phone_type?: PhoneType;
  is_primary?: boolean;
  reason?: string;
}

export interface AddEmailParams {
  email: string;
  email_type?: EmailType;
  is_primary?: boolean;
  reason?: string;
  correlation_id?: string;
}

export interface UpdateEmailParams {
  email?: string;
  email_type?: EmailType;
  is_primary?: boolean;
  reason?: string;
}

export interface AddAddressParams {
  address_type?: AddressType;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
  is_primary?: boolean;
  reason?: string;
  correlation_id?: string;
}

export interface UpdateAddressParams {
  address_type?: AddressType;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  is_primary?: boolean;
  reason?: string;
}

export interface AddInsuranceParams {
  policy_type: InsurancePolicyType;
  payer_name: string;
  policy_number?: string;
  group_number?: string;
  subscriber_name?: string;
  subscriber_relation?: string;
  coverage_start_date?: string;
  coverage_end_date?: string;
  reason?: string;
  correlation_id?: string;
}

export interface UpdateInsuranceParams {
  payer_name?: string;
  policy_number?: string;
  group_number?: string;
  subscriber_name?: string;
  subscriber_relation?: string;
  coverage_start_date?: string;
  coverage_end_date?: string;
  reason?: string;
}

export interface ChangePlacementParams {
  placement_arrangement: PlacementArrangement;
  start_date: string;
  reason?: string;
  correlation_id?: string;
  organization_unit_id?: string | null;
}

export interface AddFundingSourceParams {
  source_type: string;
  source_name: string;
  reference_number?: string;
  start_date?: string;
  end_date?: string;
  custom_fields?: Record<string, unknown>;
  reason?: string;
  correlation_id?: string;
}

export interface UpdateFundingSourceParams {
  source_type?: string;
  source_name?: string;
  reference_number?: string;
  start_date?: string;
  end_date?: string;
  custom_fields?: Record<string, unknown>;
  reason?: string;
}

// =============================================================================
// 6. RPC Result Type
// =============================================================================

/**
 * Shape of a single row from `clients_projection`, as returned by RPCs that
 * perform a projection read-back (e.g. `api.update_client` post-Phase 1g-pre,
 * `api.change_client_placement`). All top-level columns of the projection
 * are present; sub-entity arrays (phones, emails, addresses, insurance_policies,
 * placement_history, funding_sources, contact_assignments) are NOT — those
 * require `api.get_client` to assemble the full `Client` aggregate.
 */
export type ClientProjectionRow = Omit<
  Client,
  | 'phones'
  | 'emails'
  | 'addresses'
  | 'insurance_policies'
  | 'placement_history'
  | 'funding_sources'
  | 'contact_assignments'
>;

/**
 * Base envelope for all client-domain RPC responses.
 *
 * Contract (Pattern A v2 — see adr-rpc-readback-pattern.md):
 *   Postcondition: `success` is always present.
 *   Postcondition: `error` is present iff `success === false`.
 *   Invariant: on handler-driven failure, `error` has the prefix
 *              "Event processing failed: " followed by the `processing_error`
 *              text from `domain_events`.
 */
export interface ClientRpcEnvelope {
  success: boolean;
  error?: string;
}

/** Response for api.register_client / api.update_client / api.admit_client / api.discharge_client */
export interface ClientUpdateResult extends ClientRpcEnvelope {
  client_id?: string;
  client?: ClientProjectionRow;
}

/** Response for api.add_client_phone / api.update_client_phone */
export interface ClientPhoneResult extends ClientRpcEnvelope {
  phone_id?: string;
  phone?: ClientPhone;
}

/** Response for api.add_client_email / api.update_client_email */
export interface ClientEmailResult extends ClientRpcEnvelope {
  email_id?: string;
  email?: ClientEmail;
}

/** Response for api.add_client_address / api.update_client_address */
export interface ClientAddressResult extends ClientRpcEnvelope {
  address_id?: string;
  address?: ClientAddress;
}

/** Response for api.add_client_insurance / api.update_client_insurance */
export interface ClientInsuranceResult extends ClientRpcEnvelope {
  policy_id?: string;
  policy?: ClientInsurancePolicy;
}

/** Response for api.add_client_funding_source / api.update_client_funding_source */
export interface ClientFundingResult extends ClientRpcEnvelope {
  funding_source_id?: string;
  funding_source?: ClientFundingSource;
}

/** Response for api.change_client_placement / api.end_client_placement */
export interface ClientPlacementResult extends ClientRpcEnvelope {
  placement_id?: string;
}

/** Response for api.assign_client_contact / api.unassign_client_contact */
export interface ClientAssignmentResult extends ClientRpcEnvelope {
  assignment_id?: string;
}

/**
 * Response for RPCs with no return payload beyond success/error
 * (e.g., remove_client_phone, remove_client_email, remove_client_address,
 *  remove_client_insurance, remove_client_funding_source).
 */
export type ClientVoidResult = ClientRpcEnvelope;
