/**
 * Organization Management Type Definitions
 *
 * Enhanced Scope (Part B):
 * - General Information: Organization-level address + phone (NO contact)
 * - Billing Information: Contact + Address + Phone (conditional for providers)
 * - Provider Admin Information: Contact + Address + Phone (always visible)
 * - Referring Partner relationship tracking
 * - Partner type classification
 */

/**
 * Contact form data with label and type classification
 */
export interface ContactFormData {
  label: string;
  type: 'billing' | 'technical' | 'emergency' | 'a4c_admin';
  firstName: string;
  lastName: string;
  email: string;
  title?: string;
  department?: string;
}

/**
 * Address form data with label and type classification
 */
export interface AddressFormData {
  label: string;
  type: 'physical' | 'mailing' | 'billing';
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zipCode: string;
}

/**
 * Phone form data with label and type classification
 */
export interface PhoneFormData {
  label: string;
  type: 'mobile' | 'office' | 'fax' | 'emergency';
  number: string; // Formatted: (xxx) xxx-xxxx
  extension?: string;
}

/**
 * Organization form data (ViewModel state + draft storage)
 * Enhanced for Part B with 3-section structure
 */
export interface OrganizationFormData {
  // General Information (Organization-level)
  type: 'provider' | 'provider_partner';
  name: string;
  displayName: string;
  subdomain: string;
  timeZone: string;
  referringPartnerId?: string; // VAR partner who referred this org
  partnerType?: 'var' | 'family' | 'court' | 'other'; // Required if type is 'provider_partner'

  // General Information (Headquarters - NO contact)
  generalAddress: AddressFormData;
  generalPhone: PhoneFormData;

  // Billing Information (Conditional for providers)
  billingContact: ContactFormData;
  billingAddress: AddressFormData;
  billingPhone: PhoneFormData;
  useBillingGeneralAddress: boolean; // "Use General Information" checkbox
  useBillingGeneralPhone: boolean; // "Use General Information" checkbox

  // Provider Admin Information (Always visible)
  providerAdminContact: ContactFormData;
  providerAdminAddress: AddressFormData;
  providerAdminPhone: PhoneFormData;
  useProviderAdminGeneralAddress: boolean; // "Use General Information" checkbox
  useProviderAdminGeneralPhone: boolean; // "Use General Information" checkbox

  // Metadata
  status: 'draft' | 'pending' | 'running' | 'completed' | 'failed';
  workflowId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Contact info for workflow (matches Phase 3 backend)
 */
export interface ContactInfo {
  firstName: string;
  lastName: string;
  email: string;
  title?: string;
  department?: string;
  type: string; // contact_type enum value
  label: string;
}

/**
 * Address info for workflow (matches Phase 3 backend)
 */
export interface AddressInfo {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zipCode: string;
  type: string; // address_type enum value
  label: string;
}

/**
 * Phone info for workflow (matches Phase 3 backend)
 */
export interface PhoneInfo {
  number: string;
  extension?: string;
  type: string; // phone_type enum value
  label: string;
}

/**
 * Parameters for starting organization bootstrap workflow
 * Maps to Temporal workflow interface (matches workflows/src/shared/types/index.ts)
 */
export interface OrganizationBootstrapParams {
  /** Subdomain for the organization (optional - required for providers and VAR partners only) */
  subdomain?: string;

  /** Organization details */
  orgData: {
    name: string;
    type: 'provider' | 'partner';
    parentOrgId?: string; // Required for partners, optional for providers

    /** Contact information (at least one contact required) */
    contacts: ContactInfo[];

    /** Address information (required) */
    addresses: AddressInfo[];

    /** Phone information (required) */
    phones: PhoneInfo[];

    /** Partner type (required when type='partner') */
    partnerType?: 'var' | 'family' | 'court' | 'other';

    /** Referring partner organization ID (optional) */
    referringPartnerId?: string;
  };

  /** Users to invite (derived from provider admin contact) */
  users: Array<{
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  }>;

  /** Optional DNS retry configuration (for testing) */
  retryConfig?: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    maxAttempts?: number;
  };
}

/**
 * Workflow status response from Temporal
 */
export interface WorkflowStatus {
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  progress: Array<{
    step: string;
    completed: boolean;
    error?: string;
  }>;
  result?: OrganizationBootstrapResult;
}

/**
 * Result returned when workflow completes successfully
 */
export interface OrganizationBootstrapResult {
  orgId: string;
  organizationName?: string; // Organization name for display purposes
  subdomain?: string; // Subdomain used for the organization
  domain: string;
  dnsConfigured: boolean;
  adminUser?: {
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  }; // Admin user details created during bootstrap
  invitationsSent: number;
  createdAt?: string; // ISO timestamp when organization was created
  errors?: string[];
}

/**
 * Draft summary for list view
 */
export interface DraftSummary {
  draftId: string;
  organizationName: string;
  subdomain: string;
  lastSaved: Date;
}

/**
 * Invitation details returned from token validation
 */
export interface InvitationDetails {
  orgName: string;
  role: string;
  inviterName: string;
  expiresAt: Date;
  email?: string; // Pre-fill email if available
}

/**
 * User credentials for invitation acceptance
 */
export interface UserCredentials {
  email: string;
  password?: string; // For email/password auth
  oauth?: 'google'; // For OAuth auth (Google only in MVP)
}

/**
 * Result from accepting invitation
 */
export interface AcceptInvitationResult {
  userId: string;
  orgId: string;
  redirectUrl: string;
}

/**
 * Organization projection data (read from database)
 * Updated for Phase 1.4-1.6 schema enhancements
 */
export interface Organization {
  id: string; // Primary key (changed from org_id for consistency)
  name: string;
  display_name: string;
  type: 'platform_owner' | 'provider' | 'provider_partner'; // Updated enum
  domain: string;
  subdomain: string;
  time_zone: string;
  is_active: boolean;
  parent_org_id?: string;
  path: string; // Ltree path for hierarchy
  partner_type?: 'var' | 'family' | 'court' | 'other'; // NEW: Partner classification
  referring_partner_id?: string; // NEW: VAR partner who referred this organization
  created_at: Date;
  updated_at: Date;
}

/**
 * Organization filter options for query API
 * Used by OrganizationQueryService for filtering organizations
 */
export interface OrganizationFilterOptions {
  type?: 'platform_owner' | 'provider' | 'provider_partner' | 'all'; // Updated enum
  status?: 'active' | 'inactive' | 'all';
  partnerType?: 'var' | 'family' | 'court' | 'other'; // NEW: Filter by partner type
  searchTerm?: string; // Search by name or subdomain
}

/**
 * Organization statistics for dashboard
 */
export interface OrganizationStatistics {
  totalUsers: number;
  activePrograms: number;
  totalClients?: number;
  activeStaff?: number;
}
