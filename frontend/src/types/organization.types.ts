/**
 * Organization Management Type Definitions
 *
 * MVP Scope:
 * - 1 A4C Admin contact
 * - 1 Billing address
 * - 1 Billing phone
 * - 1 Program
 */

/**
 * Organization form data (ViewModel state + draft storage)
 */
export interface OrganizationFormData {
  // General Information
  type: 'provider' | 'partner';
  name: string;
  displayName: string;
  subdomain: string;
  timeZone: string;

  // Contact Information (MVP: Single A4C Admin)
  adminContact: {
    label: string;
    firstName: string;
    lastName: string;
    email: string;
  };

  // Billing Information (MVP: Single address + phone)
  billingAddress: {
    label: string;
    street1: string;
    street2: string;
    city: string;
    state: string;
    zipCode: string;
  };

  billingPhone: {
    label: string;
    number: string; // Formatted: (xxx) xxx-xxxx
  };

  // Program Information (MVP: Single program)
  program: {
    name: string;
    type: string;
  };

  // Metadata
  status: 'draft' | 'pending' | 'running' | 'completed' | 'failed';
  workflowId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Parameters for starting organization bootstrap workflow
 * Maps to Temporal workflow interface
 */
export interface OrganizationBootstrapParams {
  orgData: {
    name: string;
    type: 'provider' | 'partner';
    parentOrgId?: string; // For partner organizations
    contactEmail: string;
  };
  subdomain: string;
  users: Array<{
    email: string;
    firstName: string;
    lastName: string;
    role: 'provider_admin' | 'organization_member';
  }>;
  dnsPropagationTimeout?: number; // Optional, defaults to 30 minutes in workflow
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
