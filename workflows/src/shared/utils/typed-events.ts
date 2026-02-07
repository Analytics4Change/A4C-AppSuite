/**
 * Type-Safe Domain Event Emission
 *
 * This module provides type-safe wrappers around emitEvent for domain events.
 * The types are generated from AsyncAPI contracts to ensure consistency.
 *
 * Usage:
 * ```typescript
 * import { emitContactCreated, emitOrganizationContactLinked } from '@shared/utils/typed-events';
 *
 * // Type-safe event emission - compiler validates event_data structure
 * await emitContactCreated(contactId, {
 *   organization_id: orgId,
 *   label: "Primary Contact",
 *   type: ContactType.ADMINISTRATIVE,
 *   first_name: "John",
 *   last_name: "Doe",
 *   email: "john@example.com"
 * }, tracingParams);
 * ```
 */

import { emitEvent, buildTags, buildTracingForEvent } from './emit-event.js';
import type { WorkflowTracingParams } from '../types/index.js';
import {
  // Enums
  ContactType,
  PhoneType,
  AddressType,
  EmailType,
  DNSRecordType,
  DnsRemovalStatus,
  VerificationMethod,
  VerificationMode,
  RoleScope,
  BootstrapFailureStage,
  // Entity creation data types
  ContactCreationData,
  ContactUpdateData,
  ContactDeletionData,
  PhoneCreationData,
  PhoneUpdateData,
  PhoneDeletionData,
  AddressCreationData,
  AddressUpdateData,
  AddressDeletionData,
  EmailCreationData,
  EmailUpdateData,
  EmailDeletionData,
  // Organization lifecycle data types
  OrganizationActivatedData,
  SubdomainDnsCreatedData,
  SubdomainVerifiedData,
  OrganizationDnsRemovedData,
  OrganizationBootstrapFailureData,
  OrganizationBootstrapCompletionData,
  // Invitation data types
  InvitationEmailSentData,
  // Junction data types
  OrganizationContactLinkData,
  OrganizationContactUnlinkData,
  OrganizationPhoneLinkData,
  OrganizationPhoneUnlinkData,
  OrganizationAddressLinkData,
  OrganizationAddressUnlinkData,
  OrganizationEmailLinkData,
  OrganizationEmailUnlinkData,
  ContactPhoneLinkData,
  ContactPhoneUnlinkData,
  ContactAddressLinkData,
  ContactAddressUnlinkData,
  ContactEmailLinkData,
  ContactEmailUnlinkData,
  // Role event data types (now properly named)
  RoleCreatedData as RoleCreationData,
  RolePermissionGrantedData as RolePermissionGrantData,
} from '../types/generated/events.js';

// Re-export enums for convenience
export {
  ContactType,
  PhoneType,
  AddressType,
  EmailType,
  DNSRecordType,
  DnsRemovalStatus,
  VerificationMethod,
  VerificationMode,
  RoleScope,
  BootstrapFailureStage,
};

// Re-export data types for convenience
export type {
  ContactCreationData,
  PhoneCreationData,
  AddressCreationData,
  EmailCreationData,
  OrganizationActivatedData,
  SubdomainDnsCreatedData,
  SubdomainVerifiedData,
  OrganizationDnsRemovedData,
  OrganizationBootstrapFailureData,
  InvitationEmailSentData,
  OrganizationContactLinkData,
  OrganizationPhoneLinkData,
  OrganizationAddressLinkData,
  OrganizationEmailLinkData,
  ContactPhoneLinkData,
  ContactAddressLinkData,
  ContactEmailLinkData,
  RoleCreationData,
  RolePermissionGrantData,
};

// ============================================================================
// Contact Events
// ============================================================================

/**
 * Emit a contact.created event
 */
export async function emitContactCreated(
  contactId: string,
  data: ContactCreationData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'contact.created',
    aggregate_type: 'contact',
    aggregate_id: contactId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitContactCreated'),
  });
}

/**
 * Emit a contact.updated event
 */
export async function emitContactUpdated(
  contactId: string,
  data: ContactUpdateData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'contact.updated',
    aggregate_type: 'contact',
    aggregate_id: contactId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitContactUpdated'),
  });
}

/**
 * Emit a contact.deleted event
 */
export async function emitContactDeleted(
  contactId: string,
  data: ContactDeletionData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'contact.deleted',
    aggregate_type: 'contact',
    aggregate_id: contactId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitContactDeleted'),
  });
}

// ============================================================================
// Phone Events
// ============================================================================

/**
 * Emit a phone.created event
 */
export async function emitPhoneCreated(
  phoneId: string,
  data: PhoneCreationData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'phone.created',
    aggregate_type: 'phone',
    aggregate_id: phoneId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitPhoneCreated'),
  });
}

/**
 * Emit a phone.updated event
 */
export async function emitPhoneUpdated(
  phoneId: string,
  data: PhoneUpdateData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'phone.updated',
    aggregate_type: 'phone',
    aggregate_id: phoneId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitPhoneUpdated'),
  });
}

/**
 * Emit a phone.deleted event
 */
export async function emitPhoneDeleted(
  phoneId: string,
  data: PhoneDeletionData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'phone.deleted',
    aggregate_type: 'phone',
    aggregate_id: phoneId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitPhoneDeleted'),
  });
}

// ============================================================================
// Address Events
// ============================================================================

/**
 * Emit an address.created event
 */
export async function emitAddressCreated(
  addressId: string,
  data: AddressCreationData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'address.created',
    aggregate_type: 'address',
    aggregate_id: addressId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitAddressCreated'),
  });
}

/**
 * Emit an address.updated event
 */
export async function emitAddressUpdated(
  addressId: string,
  data: AddressUpdateData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'address.updated',
    aggregate_type: 'address',
    aggregate_id: addressId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitAddressUpdated'),
  });
}

/**
 * Emit an address.deleted event
 */
export async function emitAddressDeleted(
  addressId: string,
  data: AddressDeletionData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'address.deleted',
    aggregate_type: 'address',
    aggregate_id: addressId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitAddressDeleted'),
  });
}

// ============================================================================
// Email Events
// ============================================================================

/**
 * Emit an email.created event
 */
export async function emitEmailCreated(
  emailId: string,
  data: EmailCreationData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'email.created',
    aggregate_type: 'email',
    aggregate_id: emailId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitEmailCreated'),
  });
}

/**
 * Emit an email.updated event
 */
export async function emitEmailUpdated(
  emailId: string,
  data: EmailUpdateData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'email.updated',
    aggregate_type: 'email',
    aggregate_id: emailId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitEmailUpdated'),
  });
}

/**
 * Emit an email.deleted event
 */
export async function emitEmailDeleted(
  emailId: string,
  data: EmailDeletionData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'email.deleted',
    aggregate_type: 'email',
    aggregate_id: emailId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitEmailDeleted'),
  });
}

// ============================================================================
// Organization-Entity Junction Events
// ============================================================================

/**
 * Emit an organization.contact.linked event
 */
export async function emitOrganizationContactLinked(
  orgId: string,
  data: OrganizationContactLinkData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'organization.contact.linked',
    aggregate_type: 'junction',
    aggregate_id: orgId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitOrganizationContactLinked'),
  });
}

/**
 * Emit an organization.contact.unlinked event
 */
export async function emitOrganizationContactUnlinked(
  orgId: string,
  data: OrganizationContactUnlinkData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'organization.contact.unlinked',
    aggregate_type: 'junction',
    aggregate_id: orgId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitOrganizationContactUnlinked'),
  });
}

/**
 * Emit an organization.phone.linked event
 */
export async function emitOrganizationPhoneLinked(
  orgId: string,
  data: OrganizationPhoneLinkData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'organization.phone.linked',
    aggregate_type: 'junction',
    aggregate_id: orgId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitOrganizationPhoneLinked'),
  });
}

/**
 * Emit an organization.phone.unlinked event
 */
export async function emitOrganizationPhoneUnlinked(
  orgId: string,
  data: OrganizationPhoneUnlinkData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'organization.phone.unlinked',
    aggregate_type: 'junction',
    aggregate_id: orgId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitOrganizationPhoneUnlinked'),
  });
}

/**
 * Emit an organization.address.linked event
 */
export async function emitOrganizationAddressLinked(
  orgId: string,
  data: OrganizationAddressLinkData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'organization.address.linked',
    aggregate_type: 'junction',
    aggregate_id: orgId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitOrganizationAddressLinked'),
  });
}

/**
 * Emit an organization.address.unlinked event
 */
export async function emitOrganizationAddressUnlinked(
  orgId: string,
  data: OrganizationAddressUnlinkData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'organization.address.unlinked',
    aggregate_type: 'junction',
    aggregate_id: orgId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitOrganizationAddressUnlinked'),
  });
}

/**
 * Emit an organization.email.linked event
 */
export async function emitOrganizationEmailLinked(
  orgId: string,
  data: OrganizationEmailLinkData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'organization.email.linked',
    aggregate_type: 'junction',
    aggregate_id: orgId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitOrganizationEmailLinked'),
  });
}

/**
 * Emit an organization.email.unlinked event
 */
export async function emitOrganizationEmailUnlinked(
  orgId: string,
  data: OrganizationEmailUnlinkData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'organization.email.unlinked',
    aggregate_type: 'junction',
    aggregate_id: orgId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitOrganizationEmailUnlinked'),
  });
}

// ============================================================================
// Contact-Entity Junction Events
// ============================================================================

/**
 * Emit a contact.phone.linked event
 */
export async function emitContactPhoneLinked(
  contactId: string,
  data: ContactPhoneLinkData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'contact.phone.linked',
    aggregate_type: 'junction',
    aggregate_id: contactId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitContactPhoneLinked'),
  });
}

/**
 * Emit a contact.phone.unlinked event
 */
export async function emitContactPhoneUnlinked(
  contactId: string,
  data: ContactPhoneUnlinkData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'contact.phone.unlinked',
    aggregate_type: 'junction',
    aggregate_id: contactId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitContactPhoneUnlinked'),
  });
}

/**
 * Emit a contact.address.linked event
 */
export async function emitContactAddressLinked(
  contactId: string,
  data: ContactAddressLinkData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'contact.address.linked',
    aggregate_type: 'junction',
    aggregate_id: contactId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitContactAddressLinked'),
  });
}

/**
 * Emit a contact.address.unlinked event
 */
export async function emitContactAddressUnlinked(
  contactId: string,
  data: ContactAddressUnlinkData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'contact.address.unlinked',
    aggregate_type: 'junction',
    aggregate_id: contactId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitContactAddressUnlinked'),
  });
}

/**
 * Emit a contact.email.linked event
 */
export async function emitContactEmailLinked(
  contactId: string,
  data: ContactEmailLinkData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'contact.email.linked',
    aggregate_type: 'junction',
    aggregate_id: contactId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitContactEmailLinked'),
  });
}

/**
 * Emit a contact.email.unlinked event
 */
export async function emitContactEmailUnlinked(
  contactId: string,
  data: ContactEmailUnlinkData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'contact.email.unlinked',
    aggregate_type: 'junction',
    aggregate_id: contactId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitContactEmailUnlinked'),
  });
}

// ============================================================================
// Utility: Map Local Types to Event Types
// ============================================================================

/**
 * Map contact type from local enum to AsyncAPI enum
 * Local: 'a4c_admin' | 'billing' | 'technical' | 'emergency' | 'stakeholder'
 * AsyncAPI: ContactType enum
 */
export function mapContactType(localType: string): ContactType {
  const mapping: Record<string, ContactType> = {
    'a4c_admin': ContactType.ADMINISTRATIVE,
    'administrative': ContactType.ADMINISTRATIVE,
    'billing': ContactType.BILLING,
    'technical': ContactType.TECHNICAL,
    'emergency': ContactType.EMERGENCY,
    'stakeholder': ContactType.STAKEHOLDER,
  };
  return mapping[localType] ?? ContactType.STAKEHOLDER;
}

/**
 * Map phone type from local enum to AsyncAPI enum
 * Local: 'mobile' | 'office' | 'fax' | 'emergency'
 * AsyncAPI: PhoneType enum
 */
export function mapPhoneType(localType: string): PhoneType {
  const mapping: Record<string, PhoneType> = {
    'mobile': PhoneType.MOBILE,
    'office': PhoneType.OFFICE,
    'fax': PhoneType.FAX,
    'emergency': PhoneType.EMERGENCY,
  };
  return mapping[localType] ?? PhoneType.OFFICE;
}

/**
 * Map address type from local enum to AsyncAPI enum
 * Local: 'physical' | 'mailing' | 'billing'
 * AsyncAPI: AddressType enum
 */
export function mapAddressType(localType: string): AddressType {
  const mapping: Record<string, AddressType> = {
    'physical': AddressType.PHYSICAL,
    'mailing': AddressType.MAILING,
    'billing': AddressType.BILLING,
  };
  return mapping[localType] ?? AddressType.PHYSICAL;
}

/**
 * Map email type from local enum to AsyncAPI enum
 * AsyncAPI: EmailType enum
 */
export function mapEmailType(localType: string): EmailType {
  const mapping: Record<string, EmailType> = {
    'work': EmailType.WORK,
    'personal': EmailType.PERSONAL,
    'billing': EmailType.BILLING,
    'support': EmailType.SUPPORT,
    'main': EmailType.MAIN,
  };
  return mapping[localType] ?? EmailType.WORK;
}

// ============================================================================
// Organization Lifecycle Events
// ============================================================================

/**
 * Emit an organization.activated event
 */
export async function emitOrganizationActivated(
  orgId: string,
  data: OrganizationActivatedData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'organization.activated',
    aggregate_type: 'organization',
    aggregate_id: orgId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitOrganizationActivated'),
  });
}

// ============================================================================
// Organization DNS Events
// ============================================================================

/**
 * Emit an organization.subdomain.dns_created event
 */
export async function emitSubdomainDnsCreated(
  orgId: string,
  data: SubdomainDnsCreatedData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'organization.subdomain.dns_created',
    aggregate_type: 'organization',
    aggregate_id: orgId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitSubdomainDnsCreated'),
  });
}

/**
 * Emit an organization.subdomain.verified event
 */
export async function emitSubdomainVerified(
  orgId: string,
  data: SubdomainVerifiedData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'organization.subdomain.verified',
    aggregate_type: 'organization',
    aggregate_id: orgId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitSubdomainVerified'),
  });
}

/**
 * Emit an organization.dns.removed event
 */
export async function emitOrganizationDnsRemoved(
  orgId: string,
  data: OrganizationDnsRemovedData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'organization.dns.removed',
    aggregate_type: 'organization',
    aggregate_id: orgId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitOrganizationDnsRemoved'),
  });
}

// ============================================================================
// Invitation Events
// ============================================================================

/**
 * Emit an invitation.email.sent event
 */
export async function emitInvitationEmailSent(
  orgId: string,
  data: InvitationEmailSentData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'invitation.email.sent',
    aggregate_type: 'organization',
    aggregate_id: orgId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitInvitationEmailSent'),
  });
}

// ============================================================================
// RBAC Events (Roles and Permissions)
// ============================================================================

/**
 * Emit a role.created event
 */
export async function emitRoleCreated(
  roleId: string,
  data: RoleCreationData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'role.created',
    aggregate_type: 'role',
    aggregate_id: roleId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitRoleCreated'),
  });
}

/**
 * Emit a role.permission.granted event
 */
export async function emitRolePermissionGranted(
  roleId: string,
  data: RolePermissionGrantData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'role.permission.granted',
    aggregate_type: 'role',
    aggregate_id: roleId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitRolePermissionGranted'),
  });
}

// ============================================================================
// Organization Bootstrap Failure Events
// ============================================================================

/**
 * Emit an organization.bootstrap.failed event
 */
export async function emitBootstrapFailed(
  orgId: string,
  data: OrganizationBootstrapFailureData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'organization.bootstrap.failed',
    aggregate_type: 'organization',
    aggregate_id: orgId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitBootstrapFailed'),
  });
}

/**
 * Emit an organization.bootstrap.completed event
 */
export async function emitBootstrapCompleted(
  orgId: string,
  data: OrganizationBootstrapCompletionData,
  tracing?: WorkflowTracingParams
): Promise<string> {
  const tags = buildTags();
  return emitEvent({
    event_type: 'organization.bootstrap.completed',
    aggregate_type: 'organization',
    aggregate_id: orgId,
    event_data: data as unknown as Record<string, unknown>,
    tags,
    ...buildTracingForEvent(tracing, 'emitBootstrapCompleted'),
  });
}
