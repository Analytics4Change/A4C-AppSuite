/**
 * Shared Types and Interfaces
 *
 * Central TypeScript type definitions for workflows and activities.
 * All types are exported from this single file for easy imports.
 */

// ========================================
// Workflow Types
// ========================================

/**
 * DNS Retry Configuration
 */
export interface DnsRetryConfig {
  /** Base delay in milliseconds for exponential backoff (default: 10000) */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds (default: 300000) */
  maxDelayMs?: number;
  /** Maximum retry attempts (default: 7) */
  maxAttempts?: number;
}

/**
 * Contact information for organization
 */
export interface ContactInfo {
  firstName: string;
  lastName: string;
  email: string;
  title?: string;
  department?: string;
  type: 'a4c_admin' | 'billing' | 'technical' | 'emergency' | 'stakeholder';
  label: string;
}

/**
 * Address information for organization
 */
export interface AddressInfo {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zipCode: string;
  type: 'physical' | 'mailing' | 'billing';
  label: string;
}

/**
 * Phone information for organization
 */
export interface PhoneInfo {
  number: string;
  extension?: string;
  type: 'mobile' | 'office' | 'fax' | 'emergency';
  label: string;
}

/**
 * Input parameters for OrganizationBootstrapWorkflow
 */
export interface OrganizationBootstrapParams {
  /** Subdomain for the organization (optional - required for providers and VAR partners only) */
  subdomain?: string;

  /** Organization details */
  orgData: {
    name: string;
    type: 'provider' | 'partner';
    parentOrgId?: string;  // Required for partners, optional for providers

    /** Contact information (at least one contact required across all sections) */
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

  /** Users to invite */
  users: Array<{
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  }>;

  /**
   * Optional DNS retry configuration (for testing)
   * Defaults to production values if not specified
   */
  retryConfig?: DnsRetryConfig;
}

/**
 * Result returned from OrganizationBootstrapWorkflow
 */
export interface OrganizationBootstrapResult {
  /** Created organization ID */
  orgId: string;

  /** Full domain name */
  domain: string;

  /** Whether DNS was configured successfully */
  dnsConfigured: boolean;

  /** Number of invitations sent successfully */
  invitationsSent: number;

  /** Any errors that occurred (non-fatal) */
  errors?: string[];
}

/**
 * Internal workflow state tracking
 */
export interface WorkflowState {
  /** Organization ID (set after creation) */
  orgId?: string;

  /** Full domain name (set after DNS configuration) */
  domain?: string;

  /** DNS record ID from Cloudflare (set after DNS configuration) */
  dnsRecordId?: string;

  /** Generated invitations (set after generation) */
  invitations?: Invitation[];

  /** Whether organization was created */
  orgCreated: boolean;

  /** Whether DNS was configured */
  dnsConfigured: boolean;

  /** Whether DNS was skipped (no subdomain required) */
  dnsSkipped: boolean;

  /** Whether invitations were sent */
  invitationsSent: boolean;

  /** Non-fatal errors */
  errors: string[];

  /** Errors during compensation (rollback) */
  compensationErrors: string[];
}

// ========================================
// Activity Types
// ========================================

/**
 * CreateOrganizationActivity parameters
 */
export interface CreateOrganizationParams {
  name: string;
  type: 'provider' | 'partner';
  parentOrgId?: string;
  subdomain?: string;
  contacts: ContactInfo[];
  addresses: AddressInfo[];
  phones: PhoneInfo[];
  partnerType?: 'var' | 'family' | 'court' | 'other';
  referringPartnerId?: string;
}

/**
 * ConfigureDNSActivity parameters
 */
export interface ConfigureDNSParams {
  orgId: string;
  subdomain: string;
  targetDomain: string;  // e.g., 'firstovertheline.com'
}

/**
 * ConfigureDNSActivity result
 */
export interface ConfigureDNSResult {
  /** Full qualified domain name */
  fqdn: string;

  /** DNS record ID from provider (for cleanup) */
  recordId: string;
}

/**
 * VerifyDNSActivity parameters
 */
export interface VerifyDNSParams {
  orgId: string;
  domain: string;
}

/**
 * GenerateInvitationsActivity parameters
 */
export interface GenerateInvitationsParams {
  orgId: string;
  users: Array<{
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  }>;
}

/**
 * Invitation object
 */
export interface Invitation {
  invitationId: string;
  email: string;
  token: string;
  expiresAt: Date;
}

/**
 * SendInvitationEmailsActivity parameters
 */
export interface SendInvitationEmailsParams {
  orgId: string;
  invitations: Invitation[];
  domain: string;
  frontendUrl: string;
}

/**
 * SendInvitationEmailsActivity result
 */
export interface SendInvitationEmailsResult {
  successCount: number;
  failures: Array<{
    email: string;
    error: string;
  }>;
}

/**
 * ActivateOrganizationActivity parameters
 */
export interface ActivateOrganizationParams {
  orgId: string;
}

// ========================================
// Compensation Activity Types
// ========================================

/**
 * RemoveDNSActivity parameters (compensation)
 */
export interface RemoveDNSParams {
  orgId: string;
  subdomain: string;
}

/**
 * DeactivateOrganizationActivity parameters (compensation)
 */
export interface DeactivateOrganizationParams {
  orgId: string;
}

/**
 * RevokeInvitationsActivity parameters (compensation)
 */
export interface RevokeInvitationsParams {
  orgId: string;
}

/**
 * DeleteContactsActivity parameters (compensation)
 */
export interface DeleteContactsParams {
  orgId: string;
}

/**
 * DeleteAddressesActivity parameters (compensation)
 */
export interface DeleteAddressesParams {
  orgId: string;
}

/**
 * DeletePhonesActivity parameters (compensation)
 */
export interface DeletePhonesParams {
  orgId: string;
}

// ========================================
// Provider Interface Types
// ========================================

/**
 * DNS Zone information
 */
export interface DNSZone {
  id: string;
  name: string;
}

/**
 * DNS Record information
 */
export interface DNSRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
}

/**
 * DNS Record filter
 */
export interface DNSRecordFilter {
  name?: string;
  type?: string;
}

/**
 * Parameters for creating a DNS record
 */
export interface CreateDNSRecordParams {
  type: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
}

/**
 * Email parameters
 */
export interface EmailParams {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Email send result
 */
export interface EmailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

// ========================================
// Provider Interfaces
// ========================================

/**
 * DNS Provider Interface
 *
 * Abstraction for DNS operations (Cloudflare, Mock, Logging)
 */
export interface IDNSProvider {
  /**
   * List DNS zones for a domain
   */
  listZones(domain: string): Promise<DNSZone[]>;

  /**
   * List DNS records in a zone
   */
  listRecords(zoneId: string, filter?: DNSRecordFilter): Promise<DNSRecord[]>;

  /**
   * Create a new DNS record
   */
  createRecord(zoneId: string, params: CreateDNSRecordParams): Promise<DNSRecord>;

  /**
   * Delete a DNS record
   */
  deleteRecord(zoneId: string, recordId: string): Promise<void>;
}

/**
 * Email Provider Interface
 *
 * Abstraction for email operations (Resend, SMTP, Mock, Logging)
 */
export interface IEmailProvider {
  /**
   * Send an email
   */
  sendEmail(params: EmailParams): Promise<EmailResult>;

  /**
   * Verify email provider connection
   */
  verifyConnection?(): Promise<boolean>;
}
