/**
 * Organization Management Constants
 *
 * Static configuration data for organization creation and management.
 * Used across forms, dropdowns, and validation.
 */

/**
 * United States Time Zones
 * IANA time zone identifiers for the six US time zones
 */
export const US_TIME_ZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii-Aleutian Time (HAT)' }
] as const;

/**
 * Organization Types
 * Determines hierarchy and permissions
 */
export const ORGANIZATION_TYPES = [
  { value: 'provider', label: 'Provider Organization' },
  { value: 'partner', label: 'Partner Organization' }
] as const;

/**
 * Program Types
 * Treatment program categories for substance use disorder services
 */
export const PROGRAM_TYPES = [
  { value: 'residential', label: 'Residential Treatment' },
  { value: 'outpatient', label: 'Outpatient Treatment' },
  { value: 'day_treatment', label: 'Day Treatment' },
  { value: 'iop', label: 'Intensive Outpatient (IOP)' },
  { value: 'php', label: 'Partial Hospitalization (PHP)' },
  { value: 'sober_living', label: 'Sober Living' },
  { value: 'mat', label: 'Medication-Assisted Treatment (MAT)' }
] as const;

/**
 * United States - All 50 States
 * Two-letter postal abbreviations
 */
export const US_STATES = [
  { value: 'AL', label: 'Alabama' },
  { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },
  { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },
  { value: 'DE', label: 'Delaware' },
  { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' }
] as const;

/**
 * Contact Type Labels
 * Used for labeling contact information in forms
 */
export const CONTACT_LABELS = {
  A4C_ADMIN: 'A4C Admin Contact',
  BILLING: 'Billing Contact',
  TECHNICAL: 'Technical Contact',
  PRIMARY: 'Primary Contact'
} as const;

/**
 * Address Type Labels
 * Used for labeling addresses in forms
 */
export const ADDRESS_LABELS = {
  BILLING: 'Billing Address',
  SHIPPING: 'Shipping Address',
  MAIN: 'Main Office',
  BRANCH: 'Branch Office'
} as const;

/**
 * Phone Type Labels
 * Used for labeling phone numbers in forms
 */
export const PHONE_LABELS = {
  BILLING: 'Billing Phone',
  MAIN: 'Main Office',
  TECHNICAL_SUPPORT: 'Technical Support',
  EMERGENCY: 'Emergency Contact'
} as const;

/**
 * Workflow Status Display Names
 * Human-readable names for workflow status values
 */
export const WORKFLOW_STATUS_LABELS = {
  draft: 'Draft',
  pending: 'Pending Submission',
  running: 'Processing',
  completed: 'Completed',
  failed: 'Failed'
} as const;

/**
 * Default form values for new organization creation
 */
export const DEFAULT_ORGANIZATION_FORM = {
  type: 'provider' as const,
  name: '',
  displayName: '',
  subdomain: '',
  timeZone: 'America/New_York',
  adminContact: {
    label: CONTACT_LABELS.A4C_ADMIN,
    firstName: '',
    lastName: '',
    email: ''
  },
  billingAddress: {
    label: ADDRESS_LABELS.BILLING,
    street1: '',
    street2: '',
    city: '',
    state: '',
    zipCode: ''
  },
  billingPhone: {
    label: PHONE_LABELS.BILLING,
    number: ''
  },
  program: {
    name: '',
    type: ''
  },
  status: 'draft' as const
};
