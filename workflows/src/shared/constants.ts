/**
 * Shared Constants
 *
 * Centralized constants for consistent values across workflows and activities.
 */

// =============================================================================
// Aggregate Types
// =============================================================================

/**
 * Standard aggregate type identifiers for domain events.
 * Use these constants instead of string literals for consistency.
 *
 * All values are lowercase to match database conventions.
 */
export const AGGREGATE_TYPES = {
  ORGANIZATION: 'organization',
  CONTACT: 'contact',
  ADDRESS: 'address',
  PHONE: 'phone',
  INVITATION: 'invitation',
  JUNCTION: 'junction',
  USER: 'user',
} as const;

export type AggregateType = (typeof AGGREGATE_TYPES)[keyof typeof AGGREGATE_TYPES];

// =============================================================================
// Event Types
// =============================================================================

/**
 * Standard event type identifiers for domain events.
 * Use dot-notation (domain.action) for consistency.
 *
 * These match the AsyncAPI contract definitions in:
 * infrastructure/supabase/contracts/asyncapi/domains/
 */
export const EVENT_TYPES = {
  // Organization lifecycle events
  ORGANIZATION_CREATED: 'organization.created',
  ORGANIZATION_UPDATED: 'organization.updated',
  ORGANIZATION_DELETED: 'organization.deleted',
  ORGANIZATION_DEACTIVATED: 'organization.deactivated',
  ORGANIZATION_REACTIVATED: 'organization.reactivated',

  // Organization bootstrap events
  ORGANIZATION_BOOTSTRAP_INITIATED: 'organization.bootstrap.initiated',
  ORGANIZATION_BOOTSTRAP_WORKFLOW_STARTED: 'organization.bootstrap.workflow_started',
  ORGANIZATION_BOOTSTRAP_COMPLETED: 'organization.bootstrap.completed',
  ORGANIZATION_BOOTSTRAP_FAILED: 'organization.bootstrap.failed',
  ORGANIZATION_BOOTSTRAP_CANCELLED: 'organization.bootstrap.cancelled',

  // Subdomain/DNS events
  ORGANIZATION_SUBDOMAIN_DNS_CREATED: 'organization.subdomain.dns_created',
  ORGANIZATION_SUBDOMAIN_VERIFIED: 'organization.subdomain.verified',
  ORGANIZATION_SUBDOMAIN_VERIFICATION_FAILED: 'organization.subdomain.verification_failed',

  // Invitation lifecycle events
  USER_INVITED: 'user.invited',
  INVITATION_ACCEPTED: 'invitation.accepted',
  INVITATION_REVOKED: 'invitation.revoked',
  INVITATION_EXPIRED: 'invitation.expired',

  // User lifecycle events
  USER_CREATED: 'user.created',
  USER_ROLE_ASSIGNED: 'user.role.assigned',
  USER_ROLE_REVOKED: 'user.role.revoked',

  // Contact/Address/Phone events
  CONTACT_CREATED: 'contact.created',
  ADDRESS_CREATED: 'address.created',
  PHONE_CREATED: 'phone.created',

  // Junction events (linking)
  CONTACT_ADDRESS_LINKED: 'contact.address.linked',
  CONTACT_PHONE_LINKED: 'contact.phone.linked',
  PHONE_ADDRESS_LINKED: 'phone.address.linked',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
