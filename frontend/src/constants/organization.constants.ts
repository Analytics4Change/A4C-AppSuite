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
  { value: 'provider_partner', label: 'Provider Partner' }
] as const;

/**
 * Partner Types
 * Classification for provider_partner organizations
 */
export const PARTNER_TYPES = [
  { value: 'var', label: 'Value-Added Reseller (VAR)' },
  { value: 'family', label: 'Family Service Organization' },
  { value: 'court', label: 'Court System Partner' },
  { value: 'other', label: 'Other Partner Type' }
] as const;

/**
 * Contact Types
 * Classification for contact records
 * MUST match AsyncAPI ContactType enum (source of truth)
 */
export const CONTACT_TYPES = [
  { value: 'administrative', label: 'Administrative' },
  { value: 'billing', label: 'Billing' },
  { value: 'technical', label: 'Technical' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'stakeholder', label: 'Stakeholder' }
] as const;

/**
 * Address Types
 * Classification for address records
 */
export const ADDRESS_TYPES = [
  { value: 'physical', label: 'Physical' },
  { value: 'mailing', label: 'Mailing' },
  { value: 'billing', label: 'Billing' }
] as const;

/**
 * Phone Types
 * Classification for phone records
 */
export const PHONE_TYPES = [
  { value: 'mobile', label: 'Mobile' },
  { value: 'office', label: 'Office' },
  { value: 'fax', label: 'Fax' },
  { value: 'emergency', label: 'Emergency' }
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
  ADMINISTRATIVE: 'Administrative Contact',
  BILLING: 'Billing Contact',
  TECHNICAL: 'Technical Contact',
  EMERGENCY: 'Emergency Contact',
  STAKEHOLDER: 'Stakeholder Contact',
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
 * Enhanced for Part B with 3-section structure
 */
export const DEFAULT_ORGANIZATION_FORM = {
  // General Information (Organization-level)
  type: 'provider' as const,
  name: '',
  displayName: '',
  subdomain: '',
  timeZone: 'America/New_York',
  referringPartnerId: undefined,
  partnerType: undefined,

  // General Information (Headquarters - NO contact)
  generalAddress: {
    label: 'Headquarters Address',
    type: 'physical' as const,
    street1: '',
    street2: '',
    city: '',
    state: '',
    zipCode: ''
  },
  generalPhone: {
    label: 'Main Office Phone',
    type: 'office' as const,
    number: '',
    extension: ''
  },

  // Billing Information (Conditional for providers)
  billingContact: {
    label: 'Billing Contact',
    type: 'billing' as const,
    firstName: '',
    lastName: '',
    email: '',
    title: '',
    department: ''
  },
  billingAddress: {
    label: 'Billing Address',
    type: 'billing' as const,
    street1: '',
    street2: '',
    city: '',
    state: '',
    zipCode: ''
  },
  billingPhone: {
    label: 'Billing Phone',
    type: 'office' as const,
    number: '',
    extension: ''
  },
  useBillingGeneralAddress: false,
  useBillingGeneralPhone: false,

  // Provider Admin Information (Always visible)
  providerAdminContact: {
    label: 'Provider Admin Contact',
    type: 'administrative' as const,
    firstName: '',
    lastName: '',
    email: '',
    emailConfirmation: '',
    title: '',
    department: ''
  },
  providerAdminAddress: {
    label: 'Provider Admin Address',
    type: 'physical' as const,
    street1: '',
    street2: '',
    city: '',
    state: '',
    zipCode: ''
  },
  providerAdminPhone: {
    label: 'Provider Admin Phone',
    type: 'mobile' as const,
    number: '',
    extension: ''
  },
  useProviderAdminGeneralAddress: false,
  useProviderAdminGeneralPhone: false,

  // Metadata
  status: 'draft' as const
};
