/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Generated from AsyncAPI specification by Modelina
 * Source: infrastructure/supabase/contracts/asyncapi/
 * Generated: 2026-01-13T01:45:17.783Z
 *
 * To regenerate: cd infrastructure/supabase/contracts && npm run generate:types
 *
 * IMPORTANT: These types are the source of truth for domain events.
 * If you need to change event structure, modify the AsyncAPI spec and regenerate.
 */

/* eslint-disable */
/* tslint:disable */

// =============================================================================
// Base Types (from components/schemas.yaml)
// =============================================================================

/**
 * Stream types for domain events.
 * Represents the different aggregates in the system.
 */
export type StreamType =
  | 'user'
  | 'organization'
  | 'organization_unit'
  | 'invitation'
  | 'program'
  | 'platform_admin'
  | 'impersonation'
  | 'role'
  | 'permission'
  | 'contact'
  | 'address'
  | 'phone'
  | 'access_grant'
  | 'medication';  // TODO: Add to AsyncAPI spec when medication domain is implemented

/**
 * Generic domain event structure for querying and displaying events.
 * For type-safe handling of specific events, use the specific event interfaces.
 */
export interface DomainEvent<TData = Record<string, unknown>> {
  'id': string;
  'stream_id': string;
  'stream_type': StreamType;
  'stream_version': number;
  'event_type': string;
  'event_data': TData;
  'event_metadata': EventMetadata;
  'created_at': string;
  'processed_at'?: string | null;
  'processing_error'?: string | null;
}

// =============================================================================
// Enums
// =============================================================================

export enum InvitationRevocationReason {
  WORKFLOW_FAILURE = "workflow_failure",
  MANUAL_REVOCATION = "manual_revocation",
  ORGANIZATION_DEACTIVATED = "organization_deactivated",
}

export enum OrganizationType {
  PLATFORM_OWNER = "platform_owner",
  PROVIDER = "provider",
  PROVIDER_PARTNER = "provider_partner",
}

export enum PartnerType {
  RESERVED_VAR = "var",
  FAMILY = "family",
  COURT = "court",
  OTHER = "other",
}

export enum OrgUpdatableFields {
  RESERVED_NAME = "name",
  DISPLAY_NAME = "display_name",
  TIMEZONE = "timezone",
  IS_ACTIVE = "is_active",
}

export enum DeactivationReason {
  BILLING_SUSPENSION = "billing_suspension",
  COMPLIANCE_VIOLATION = "compliance_violation",
  VOLUNTARY_SUSPENSION = "voluntary_suspension",
  MAINTENANCE = "maintenance",
}

export enum DNSRecordType {
  CNAME = "CNAME",
  A = "A",
}

export enum VerificationMethod {
  DNS_QUORUM = "dns_quorum",
  DEVELOPMENT = "development",
}

export enum VerificationMode {
  PRODUCTION = "production",
  DEVELOPMENT = "development",
  MOCK = "mock",
}

export enum ImpersonationTargetOrgType {
  PROVIDER = "provider",
  PROVIDER_PARTNER = "provider_partner",
}

export enum ContactType {
  ADMINISTRATIVE = "administrative",
  BILLING = "billing",
  TECHNICAL = "technical",
  EMERGENCY = "emergency",
  STAKEHOLDER = "stakeholder",
}

export enum PhoneType {
  MOBILE = "mobile",
  OFFICE = "office",
  FAX = "fax",
  EMERGENCY = "emergency",
}

export enum EmailType {
  WORK = "work",
  PERSONAL = "personal",
  BILLING = "billing",
  SUPPORT = "support",
  MAIN = "main",
}

export enum AddressType {
  PHYSICAL = "physical",
  MAILING = "mailing",
  BILLING = "billing",
}

export enum AdminRole {
  PROVIDER_ADMIN = "provider_admin",
  PARTNER_ADMIN = "partner_admin",
}

export enum BootstrapFailureStage {
  ORGANIZATION_CREATION = "organization_creation",
  DNS_PROVISIONING = "dns_provisioning",
  ADMIN_USER_CREATION = "admin_user_creation",
  ROLE_ASSIGNMENT = "role_assignment",
  PERMISSION_GRANTS = "permission_grants",
  INVITATION_EMAIL = "invitation_email",
}

export enum OUUpdatableFields {
  RESERVED_NAME = "name",
  DISPLAY_NAME = "display_name",
  TIMEZONE = "timezone",
}

export enum SortBy {
  CREATED_AT = "created_at",
  EVENT_TYPE = "event_type",
}

export enum SortOrder {
  ASC = "asc",
  DESC = "desc",
}

export enum ScopeType {
  GLOBAL = "global",
  ORG = "org",
}

export enum GrantScope {
  ORGANIZATION_UNIT = "organization_unit",
  CLIENT_SPECIFIC = "client_specific",
}

export enum GrantAuthorizationType {
  VAR_CONTRACT = "var_contract",
  COURT_ORDER = "court_order",
  FAMILY_PARTICIPATION = "family_participation",
  SOCIAL_SERVICES_ASSIGNMENT = "social_services_assignment",
  EMERGENCY_ACCESS = "emergency_access",
}

export enum DnsRemovalStatus {
  DELETED = "deleted",
  NOT_FOUND = "not_found",
  ERROR = "error",
}

export enum RoleScope {
  GLOBAL = "global",
  ORGANIZATION = "organization",
  UNIT = "unit",
}

// =============================================================================
// Interfaces
// =============================================================================

export type DomainEvents = UserSyncedFromAuthEvent | UserOrgSwitchedEvent | UserDeactivatedEvent | UserReactivatedEvent | UserDeletedEvent | UserInvitedEvent | InvitationRevokedEvent | InvitationAcceptedEvent | InvitationExpiredEvent | InvitationResentEvent | InvitationEmailSentEvent | OrganizationCreatedEvent | OrganizationUpdatedEvent | OrganizationActivatedEvent | OrganizationDeactivatedEvent | OrganizationSubdomainDnsCreatedEvent | OrganizationSubdomainVerifiedEvent | OrganizationDnsRemovedEvent | OrganizationBootstrapInitiatedEvent | OrganizationBootstrapCompletedEvent | OrganizationBootstrapFailedEvent | OrganizationBootstrapCancelledEvent | ProgramCreatedEvent | OrganizationUnitCreatedEvent | OrganizationUnitUpdatedEvent | OrganizationUnitDeactivatedEvent | OrganizationUnitReactivatedEvent | OrganizationUnitDeletedEvent | OrganizationUnitMovedEvent | PlatformAdminFailedEventsViewedEvent | PlatformAdminEventRetryAttemptedEvent | PlatformAdminProcessingStatsViewedEvent | PlatformAdminEventDismissedEvent | PlatformAdminEventUndismissedEvent | EmailCreatedEvent | EmailUpdatedEvent | EmailDeletedEvent | ContactCreatedEvent | ContactUpdatedEvent | ContactDeletedEvent | PhoneCreatedEvent | PhoneUpdatedEvent | PhoneDeletedEvent | AddressCreatedEvent | AddressUpdatedEvent | AddressDeletedEvent | OrganizationContactLinkedEvent | OrganizationContactUnlinkedEvent | OrganizationAddressLinkedEvent | OrganizationAddressUnlinkedEvent | OrganizationPhoneLinkedEvent | OrganizationPhoneUnlinkedEvent | OrganizationEmailLinkedEvent | OrganizationEmailUnlinkedEvent | ContactPhoneLinkedEvent | ContactPhoneUnlinkedEvent | ContactAddressLinkedEvent | ContactAddressUnlinkedEvent | ContactEmailLinkedEvent | ContactEmailUnlinkedEvent | PhoneAddressLinkedEvent | PhoneAddressUnlinkedEvent | PermissionDefinedEvent | RoleCreatedEvent | RolePermissionGrantedEvent | RolePermissionRevokedEvent | RoleUpdatedEvent | RoleDeactivatedEvent | RoleReactivatedEvent | RoleDeletedEvent | UserRoleAssignedEvent | UserRoleRevokedEvent | AccessGrantCreatedEvent | AccessGrantRevokedEvent;

export interface UserSyncedFromAuthEvent {
  'stream_id': string;
  'stream_type': 'user';
  'event_type': 'user.synced_from_auth';
  'event_data': UserSyncedFromAuthData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface UserSyncedFromAuthData {
  'auth_user_id': string;
  'email': string;
  'name'?: string;
  'is_active': boolean;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface EventMetadata {
  'user_id': string;
  'organization_id'?: string;
  'reason': string;
  'user_email'?: string;
  'user_name'?: string;
  'correlation_id'?: string;
  'causation_id'?: string;
  'ip_address'?: string;
  'user_agent'?: string;
  'notes'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface UserOrgSwitchedEvent {
  'stream_id': string;
  'stream_type': 'user';
  'event_type': 'user.organization_switched';
  'event_data': UserOrgSwitchedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface UserOrgSwitchedData {
  'user_id': string;
  'from_organization_id': string;
  'to_organization_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface UserDeactivatedEvent {
  'stream_id': string;
  'stream_type': 'user';
  'event_type': 'user.deactivated';
  'event_data': UserDeactivatedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface UserDeactivatedData {
  'user_id': string;
  'org_id': string;
  'deactivated_at': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface UserReactivatedEvent {
  'stream_id': string;
  'stream_type': 'user';
  'event_type': 'user.reactivated';
  'event_data': UserReactivatedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface UserReactivatedData {
  'user_id': string;
  'org_id': string;
  'reactivated_at': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface UserDeletedEvent {
  'stream_id': string;
  'stream_type': 'user';
  'event_type': 'user.deleted';
  'event_data': UserDeletedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface UserDeletedData {
  'user_id': string;
  'org_id': string;
  'deleted_at': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface UserInvitedEvent {
  'stream_id': string;
  'stream_type': 'user';
  'event_type': 'user.invited';
  'event_data': UserInvitedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface UserInvitedData {
  'invitation_id': string;
  'org_id': string;
  'email': string;
  'first_name': string;
  'last_name': string;
  'roles': RoleAssignment[];
  'token': string;
  'expires_at': string;
  'access_start_date'?: string;
  'access_expiration_date'?: string;
  'notification_preferences'?: NotificationPreferences;
  'additionalProperties'?: Map<string, any>;
}

export interface RoleAssignment {
  'role_id': string;
  'role_name'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface NotificationPreferences {
  'email'?: boolean;
  'sms'?: SmsNotificationPreference;
  'in_app'?: boolean;
  'additionalProperties'?: Map<string, any>;
}

export interface SmsNotificationPreference {
  'enabled'?: boolean;
  'phone_id'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface InvitationRevokedEvent {
  'stream_id': string;
  'stream_type': 'invitation';
  'event_type': 'invitation.revoked';
  'event_data': InvitationRevokedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface InvitationRevokedData {
  'invitation_id': string;
  'org_id': string;
  'email': string;
  'revoked_at': string;
  'reason': InvitationRevocationReason;
  'additionalProperties'?: Map<string, any>;
}

export interface InvitationAcceptedEvent {
  'stream_id': string;
  'stream_type': 'invitation';
  'event_type': 'invitation.accepted';
  'event_data': InvitationAcceptedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface InvitationAcceptedData {
  'invitation_id': string;
  'org_id': string;
  'user_id': string;
  'email': string;
  'roles': RoleAssignment[];
  'accepted_at': string;
  'access_start_date'?: string;
  'access_expiration_date'?: string;
  'notification_preferences'?: NotificationPreferences;
  'additionalProperties'?: Map<string, any>;
}

export interface InvitationExpiredEvent {
  'stream_id': string;
  'stream_type': 'invitation';
  'event_type': 'invitation.expired';
  'event_data': InvitationExpiredData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface InvitationExpiredData {
  'invitation_id': string;
  'org_id': string;
  'email': string;
  'expired_at': string;
  'original_expires_at': string;
  'additionalProperties'?: Map<string, any>;
}

export interface InvitationResentEvent {
  'stream_id': string;
  'stream_type': 'organization';
  'event_type': 'invitation.resent';
  'event_data': InvitationResentData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface InvitationResentData {
  'invitation_id': string;
  'org_id': string;
  'email': string;
  'token': string;
  'expires_at': string;
  'resent_by': string;
  'previous_token'?: string;
  'resend_count'?: number;
  'additionalProperties'?: Map<string, any>;
}

export interface InvitationEmailSentEvent {
  'stream_id': string;
  'stream_type': 'organization';
  'event_type': 'invitation.email.sent';
  'event_data': InvitationEmailSentData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface InvitationEmailSentData {
  'org_id': string;
  'invitation_id': string;
  'email': string;
  'sent_at': string;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationCreatedEvent {
  'stream_id': string;
  'stream_type': 'organization';
  'event_type': 'organization.created';
  'event_data': OrganizationCreationData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationCreationData {
  'name': string;
  'display_name'?: string;
  'slug': string;
  'type': OrganizationType;
  'partner_type'?: PartnerType;
  'referring_partner_id'?: string;
  'path': string;
  'parent_path'?: string;
  'tax_number'?: string;
  'phone_number'?: string;
  'timezone'?: string;
  'metadata'?: Map<string, any>;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationUpdatedEvent {
  'stream_id': string;
  'stream_type': 'organization';
  'event_type': 'organization.updated';
  'event_data': OrganizationUpdateData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationUpdateData {
  'organization_id': string;
  'name'?: string;
  'display_name'?: string;
  'timezone'?: string;
  'is_active'?: boolean;
  'updatable_fields': OrgUpdatableFields[];
  'previous_values'?: Map<string, any>;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationActivatedEvent {
  'stream_id': string;
  'stream_type': 'organization';
  'event_type': 'organization.activated';
  'event_data': OrganizationActivatedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationActivatedData {
  'org_id': string;
  'activated_at': string;
  'previous_is_active'?: boolean;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationDeactivatedEvent {
  'stream_id': string;
  'stream_type': 'organization';
  'event_type': 'organization.deactivated';
  'event_data': OrganizationDeactivationData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationDeactivationData {
  'organization_id': string;
  'deactivation_type': DeactivationReason;
  'effective_date': string;
  'cascade_to_children': boolean;
  'login_blocked': boolean;
  'role_assignment_blocked': boolean;
  'existing_users_affected': boolean;
  'reactivation_conditions'?: string[];
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationSubdomainDnsCreatedEvent {
  'stream_id': string;
  'stream_type': 'organization';
  'event_type': 'organization.subdomain.dns_created';
  'event_data': SubdomainDnsCreatedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface SubdomainDnsCreatedData {
  'subdomain': string;
  'cloudflare_record_id': string;
  'cloudflare_zone_id'?: string;
  'dns_record_type': DNSRecordType;
  'dns_record_value': string;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationSubdomainVerifiedEvent {
  'stream_id': string;
  'stream_type': 'organization';
  'event_type': 'organization.subdomain.verified';
  'event_data': SubdomainVerifiedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface SubdomainVerifiedData {
  'domain': string;
  'verified': boolean;
  'verified_at': string;
  'verification_method'?: VerificationMethod;
  'verification_attempts'?: number;
  'mode'?: VerificationMode;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationDnsRemovedEvent {
  'stream_id': string;
  'stream_type': 'organization';
  'event_type': 'organization.dns.removed';
  'event_data': OrganizationDnsRemovedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationDnsRemovedData {
  'subdomain': string;
  'fqdn': string;
  'record_id'?: string;
  'status': DnsRemovalStatus;
  'error'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationBootstrapInitiatedEvent {
  'stream_id': string;
  'stream_type': 'organization';
  'event_type': 'organization.bootstrap.initiated';
  'event_data': OrganizationBootstrapInitiationData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationBootstrapInitiationData {
  'bootstrap_id': string;
  'organization_type': ImpersonationTargetOrgType;
  'organization_name': string;
  'admin_email': string;
  'slug'?: string;
  'timezone'?: string;
  'contacts'?: BootstrapContactInput[];
  'phones'?: BootstrapPhoneInput[];
  'emails'?: BootstrapEmailInput[];
  'addresses'?: BootstrapAddressInput[];
  'additionalProperties'?: Map<string, any>;
}

export interface BootstrapContactInput {
  'temp_id': string;
  'label': string;
  'type': ContactType;
  'first_name': string;
  'last_name': string;
  'email'?: string;
  'title'?: string;
  'department'?: string;
  'is_primary'?: boolean;
  'additionalProperties'?: Map<string, any>;
}

export interface BootstrapPhoneInput {
  'temp_id': string;
  'contact_ref'?: string;
  'label': string;
  'type': PhoneType;
  'number': string;
  'extension'?: string;
  'is_primary'?: boolean;
  'additionalProperties'?: Map<string, any>;
}

export interface BootstrapEmailInput {
  'temp_id': string;
  'contact_ref'?: string;
  'label': string;
  'type': EmailType;
  'address': string;
  'is_primary'?: boolean;
  'additionalProperties'?: Map<string, any>;
}

export interface BootstrapAddressInput {
  'temp_id': string;
  'contact_ref'?: string;
  'label': string;
  'type': AddressType;
  'street1': string;
  'street2'?: string;
  'city': string;
  'state': string;
  'zip_code': string;
  'country'?: string;
  'is_primary'?: boolean;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationBootstrapCompletedEvent {
  'stream_id': string;
  'stream_type': 'organization';
  'event_type': 'organization.bootstrap.completed';
  'event_data': OrganizationBootstrapCompletionData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationBootstrapCompletionData {
  'bootstrap_id': string;
  'organization_id': string;
  'admin_role_assigned': AdminRole;
  'permissions_granted': number;
  'ltree_path'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationBootstrapFailedEvent {
  'stream_id': string;
  'stream_type': 'organization';
  'event_type': 'organization.bootstrap.failed';
  'event_data': OrganizationBootstrapFailureData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationBootstrapFailureData {
  'bootstrap_id': string;
  'failure_stage': BootstrapFailureStage;
  'error_message': string;
  'partial_cleanup_required'?: boolean;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationBootstrapCancelledEvent {
  'stream_id': string;
  'stream_type': 'organization';
  'event_type': 'organization.bootstrap.cancelled';
  'event_data': OrganizationBootstrapCancellationData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationBootstrapCancellationData {
  'bootstrap_id': string;
  'cleanup_completed': boolean;
  'cleanup_actions'?: string[];
  'original_failure_stage'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface ProgramCreatedEvent {
  'stream_id': string;
  'stream_type': 'organization';
  'event_type': 'program.created';
  'event_data': ProgramCreationData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface ProgramCreationData {
  'program_id': string;
  'organization_id': string;
  'name': string;
  'description'?: string;
  'is_default'?: boolean;
  'settings'?: Map<string, any>;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationUnitCreatedEvent {
  'stream_id': string;
  'stream_type': 'organization_unit';
  'event_type': 'organization_unit.created';
  'event_data': OrganizationUnitCreationData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationUnitCreationData {
  'organization_id': string;
  'name': string;
  'display_name'?: string;
  'slug': string;
  'path': string;
  'parent_path': string;
  'timezone'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationUnitUpdatedEvent {
  'stream_id': string;
  'stream_type': 'organization_unit';
  'event_type': 'organization_unit.updated';
  'event_data': OrganizationUnitUpdateData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationUnitUpdateData {
  'organization_unit_id': string;
  'name'?: string;
  'display_name'?: string;
  'timezone'?: string;
  'updatable_fields': OUUpdatableFields[];
  'previous_values'?: Map<string, any>;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationUnitDeactivatedEvent {
  'stream_id': string;
  'stream_type': 'organization_unit';
  'event_type': 'organization_unit.deactivated';
  'event_data': OrganizationUnitDeactivationData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationUnitDeactivationData {
  'organization_unit_id': string;
  'path': string;
  'cascade_effect'?: 'role_assignment_blocked';
  'descendants_affected'?: boolean;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationUnitReactivatedEvent {
  'stream_id': string;
  'stream_type': 'organization_unit';
  'event_type': 'organization_unit.reactivated';
  'event_data': OrganizationUnitReactivationData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationUnitReactivationData {
  'organization_unit_id': string;
  'path': string;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationUnitDeletedEvent {
  'stream_id': string;
  'stream_type': 'organization_unit';
  'event_type': 'organization_unit.deleted';
  'event_data': OrganizationUnitDeletionData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationUnitDeletionData {
  'organization_unit_id': string;
  'deleted_path': string;
  'had_role_references': boolean;
  'deletion_type'?: 'soft_delete';
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationUnitMovedEvent {
  'stream_id': string;
  'stream_type': 'organization_unit';
  'event_type': 'organization_unit.moved';
  'event_data': OrganizationUnitMoveData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationUnitMoveData {
  'organization_unit_id': string;
  'old_path': string;
  'new_path': string;
  'old_parent_path': string;
  'new_parent_path': string;
  'descendants_moved'?: number;
  'additionalProperties'?: Map<string, any>;
}

export interface PlatformAdminFailedEventsViewedEvent {
  'stream_id': string;
  'stream_type': 'platform_admin';
  'event_type': 'platform.admin.failed_events_viewed';
  'event_data': PlatformAdminFailedEventsViewedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface PlatformAdminFailedEventsViewedData {
  'filters': FailedEventsViewedFilters;
  'additionalProperties'?: Map<string, any>;
}

export interface FailedEventsViewedFilters {
  'limit'?: number;
  'offset'?: number;
  'event_type'?: string;
  'stream_type'?: string;
  'since'?: string;
  'include_dismissed'?: boolean;
  'sort_by'?: SortBy;
  'sort_order'?: SortOrder;
  'additionalProperties'?: Map<string, any>;
}

export interface PlatformAdminEventRetryAttemptedEvent {
  'stream_id': string;
  'stream_type': 'platform_admin';
  'event_type': 'platform.admin.event_retry_attempted';
  'event_data': PlatformAdminEventRetryAttemptedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface PlatformAdminEventRetryAttemptedData {
  'target_event_id': string;
  'target_event_type': string;
  'target_stream_type': string;
  'target_stream_id': string;
  'original_error'?: string;
  'retry_success': boolean;
  'new_error'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface PlatformAdminProcessingStatsViewedEvent {
  'stream_id': string;
  'stream_type': 'platform_admin';
  'event_type': 'platform.admin.processing_stats_viewed';
  'event_data': PlatformAdminProcessingStatsViewedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface PlatformAdminProcessingStatsViewedData {
  'timestamp': string;
  'additionalProperties'?: Map<string, any>;
}

export interface PlatformAdminEventDismissedEvent {
  'stream_id': string;
  'stream_type': 'platform_admin';
  'event_type': 'platform.admin.event_dismissed';
  'event_data': PlatformAdminEventDismissedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface PlatformAdminEventDismissedData {
  'target_event_id': string;
  'target_event_type': string;
  'target_stream_type': string;
  'target_stream_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface PlatformAdminEventUndismissedEvent {
  'stream_id': string;
  'stream_type': 'platform_admin';
  'event_type': 'platform.admin.event_undismissed';
  'event_data': PlatformAdminEventUndismissedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface PlatformAdminEventUndismissedData {
  'target_event_id': string;
  'target_event_type': string;
  'target_stream_type': string;
  'target_stream_id': string;
  'previous_dismissed_by'?: string;
  'previous_dismiss_reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface EmailCreatedEvent {
  'stream_id': string;
  'stream_type': 'email';
  'event_type': 'email.created';
  'event_data': EmailCreationData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface EmailCreationData {
  'organization_id': string;
  'label': string;
  'type': EmailType;
  'address': string;
  'is_primary'?: boolean;
  'is_active'?: boolean;
  'metadata'?: Map<string, any>;
  'additionalProperties'?: Map<string, any>;
}

export interface EmailUpdatedEvent {
  'stream_id': string;
  'stream_type': 'email';
  'event_type': 'email.updated';
  'event_data': EmailUpdateData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface EmailUpdateData {
  'label'?: string;
  'type'?: EmailType;
  'address'?: string;
  'is_primary'?: boolean;
  'is_active'?: boolean;
  'metadata'?: Map<string, any>;
  'additionalProperties'?: Map<string, any>;
}

export interface EmailDeletedEvent {
  'stream_id': string;
  'stream_type': 'email';
  'event_type': 'email.deleted';
  'event_data': EmailDeletionData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface EmailDeletionData {
  'email_id': string;
  'organization_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactCreatedEvent {
  'stream_id': string;
  'stream_type': 'contact';
  'event_type': 'contact.created';
  'event_data': ContactCreationData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactCreationData {
  'organization_id': string;
  'label': string;
  'type': ContactType;
  'first_name': string;
  'last_name': string;
  'email': string;
  'phone'?: string;
  'title'?: string;
  'department'?: string;
  'is_primary'?: boolean;
  'is_active'?: boolean;
  'metadata'?: Map<string, any>;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactUpdatedEvent {
  'stream_id': string;
  'stream_type': 'contact';
  'event_type': 'contact.updated';
  'event_data': ContactUpdateData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactUpdateData {
  'label'?: string;
  'type'?: ContactType;
  'first_name'?: string;
  'last_name'?: string;
  'email'?: string;
  'phone'?: string;
  'title'?: string;
  'department'?: string;
  'is_primary'?: boolean;
  'is_active'?: boolean;
  'metadata'?: Map<string, any>;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactDeletedEvent {
  'stream_id': string;
  'stream_type': 'contact';
  'event_type': 'contact.deleted';
  'event_data': ContactDeletionData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactDeletionData {
  'contact_id': string;
  'organization_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface PhoneCreatedEvent {
  'stream_id': string;
  'stream_type': 'phone';
  'event_type': 'phone.created';
  'event_data': PhoneCreationData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface PhoneCreationData {
  'organization_id': string;
  'label': string;
  'type': PhoneType;
  'number': string;
  'extension'?: string;
  'country_code'?: string;
  'is_primary'?: boolean;
  'is_active'?: boolean;
  'metadata'?: Map<string, any>;
  'additionalProperties'?: Map<string, any>;
}

export interface PhoneUpdatedEvent {
  'stream_id': string;
  'stream_type': 'phone';
  'event_type': 'phone.updated';
  'event_data': PhoneUpdateData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface PhoneUpdateData {
  'label'?: string;
  'type'?: PhoneType;
  'number'?: string;
  'extension'?: string;
  'country_code'?: string;
  'is_primary'?: boolean;
  'is_active'?: boolean;
  'metadata'?: Map<string, any>;
  'additionalProperties'?: Map<string, any>;
}

export interface PhoneDeletedEvent {
  'stream_id': string;
  'stream_type': 'phone';
  'event_type': 'phone.deleted';
  'event_data': PhoneDeletionData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface PhoneDeletionData {
  'phone_id': string;
  'organization_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface AddressCreatedEvent {
  'stream_id': string;
  'stream_type': 'address';
  'event_type': 'address.created';
  'event_data': AddressCreationData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface AddressCreationData {
  'organization_id': string;
  'label': string;
  'type': AddressType;
  'street1': string;
  'street2'?: string;
  'city': string;
  'state': string;
  'zip_code': string;
  'country'?: string;
  'is_primary'?: boolean;
  'is_active'?: boolean;
  'metadata'?: Map<string, any>;
  'additionalProperties'?: Map<string, any>;
}

export interface AddressUpdatedEvent {
  'stream_id': string;
  'stream_type': 'address';
  'event_type': 'address.updated';
  'event_data': AddressUpdateData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface AddressUpdateData {
  'label'?: string;
  'type'?: AddressType;
  'street1'?: string;
  'street2'?: string;
  'city'?: string;
  'state'?: string;
  'zip_code'?: string;
  'country'?: string;
  'is_primary'?: boolean;
  'is_active'?: boolean;
  'metadata'?: Map<string, any>;
  'additionalProperties'?: Map<string, any>;
}

export interface AddressDeletedEvent {
  'stream_id': string;
  'stream_type': 'address';
  'event_type': 'address.deleted';
  'event_data': AddressDeletionData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface AddressDeletionData {
  'address_id': string;
  'organization_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationContactLinkedEvent {
  'stream_id': string;
  'stream_type': 'junction';
  'event_type': 'organization.contact.linked';
  'event_data': OrganizationContactLinkData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationContactLinkData {
  'organization_id': string;
  'contact_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationContactUnlinkedEvent {
  'stream_id': string;
  'stream_type': 'junction';
  'event_type': 'organization.contact.unlinked';
  'event_data': OrganizationContactUnlinkData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationContactUnlinkData {
  'organization_id': string;
  'contact_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationAddressLinkedEvent {
  'stream_id': string;
  'stream_type': 'junction';
  'event_type': 'organization.address.linked';
  'event_data': OrganizationAddressLinkData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationAddressLinkData {
  'organization_id': string;
  'address_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationAddressUnlinkedEvent {
  'stream_id': string;
  'stream_type': 'junction';
  'event_type': 'organization.address.unlinked';
  'event_data': OrganizationAddressUnlinkData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationAddressUnlinkData {
  'organization_id': string;
  'address_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationPhoneLinkedEvent {
  'stream_id': string;
  'stream_type': 'junction';
  'event_type': 'organization.phone.linked';
  'event_data': OrganizationPhoneLinkData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationPhoneLinkData {
  'organization_id': string;
  'phone_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationPhoneUnlinkedEvent {
  'stream_id': string;
  'stream_type': 'junction';
  'event_type': 'organization.phone.unlinked';
  'event_data': OrganizationPhoneUnlinkData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationPhoneUnlinkData {
  'organization_id': string;
  'phone_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationEmailLinkedEvent {
  'stream_id': string;
  'stream_type': 'junction';
  'event_type': 'organization.email.linked';
  'event_data': OrganizationEmailLinkData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationEmailLinkData {
  'organization_id': string;
  'email_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationEmailUnlinkedEvent {
  'stream_id': string;
  'stream_type': 'junction';
  'event_type': 'organization.email.unlinked';
  'event_data': OrganizationEmailUnlinkData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface OrganizationEmailUnlinkData {
  'organization_id': string;
  'email_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactPhoneLinkedEvent {
  'stream_id': string;
  'stream_type': 'junction';
  'event_type': 'contact.phone.linked';
  'event_data': ContactPhoneLinkData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactPhoneLinkData {
  'contact_id': string;
  'phone_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactPhoneUnlinkedEvent {
  'stream_id': string;
  'stream_type': 'junction';
  'event_type': 'contact.phone.unlinked';
  'event_data': ContactPhoneUnlinkData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactPhoneUnlinkData {
  'contact_id': string;
  'phone_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactAddressLinkedEvent {
  'stream_id': string;
  'stream_type': 'junction';
  'event_type': 'contact.address.linked';
  'event_data': ContactAddressLinkData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactAddressLinkData {
  'contact_id': string;
  'address_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactAddressUnlinkedEvent {
  'stream_id': string;
  'stream_type': 'junction';
  'event_type': 'contact.address.unlinked';
  'event_data': ContactAddressUnlinkData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactAddressUnlinkData {
  'contact_id': string;
  'address_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactEmailLinkedEvent {
  'stream_id': string;
  'stream_type': 'junction';
  'event_type': 'contact.email.linked';
  'event_data': ContactEmailLinkData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactEmailLinkData {
  'contact_id': string;
  'email_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactEmailUnlinkedEvent {
  'stream_id': string;
  'stream_type': 'junction';
  'event_type': 'contact.email.unlinked';
  'event_data': ContactEmailUnlinkData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface ContactEmailUnlinkData {
  'contact_id': string;
  'email_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface PhoneAddressLinkedEvent {
  'stream_id': string;
  'stream_type': 'junction';
  'event_type': 'phone.address.linked';
  'event_data': PhoneAddressLinkData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface PhoneAddressLinkData {
  'phone_id': string;
  'address_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface PhoneAddressUnlinkedEvent {
  'stream_id': string;
  'stream_type': 'junction';
  'event_type': 'phone.address.unlinked';
  'event_data': PhoneAddressUnlinkData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface PhoneAddressUnlinkData {
  'phone_id': string;
  'address_id': string;
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface PermissionDefinedEvent {
  'stream_id': string;
  'stream_type': 'permission';
  'event_type': 'permission.defined';
  'event_data': PermissionDefinedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface PermissionDefinedData {
  'applet': string;
  'action': string;
  'description': string;
  'scope_type': ScopeType;
  'requires_mfa': boolean;
  'additionalProperties'?: Map<string, any>;
}

export interface RoleCreatedEvent {
  'stream_id': string;
  'stream_type': 'role';
  'event_type': 'role.created';
  'event_data': RoleCreatedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface RoleCreatedData {
  'name': string;
  'description': string;
  'zitadel_org_id'?: string;
  'org_hierarchy_scope'?: string;
  'display_name'?: string;
  'organization_id'?: string;
  'scope'?: RoleScope;
  'is_system_role'?: boolean;
  'additionalProperties'?: Map<string, any>;
}

export interface RolePermissionGrantedEvent {
  'stream_id': string;
  'stream_type': 'role';
  'event_type': 'role.permission.granted';
  'event_data': RolePermissionGrantedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface RolePermissionGrantedData {
  'permission_id': string;
  'permission_name': string;
  'additionalProperties'?: Map<string, any>;
}

export interface RolePermissionRevokedEvent {
  'stream_id': string;
  'stream_type': 'role';
  'event_type': 'role.permission.revoked';
  'event_data': RolePermissionRevokedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface RolePermissionRevokedData {
  'permission_id': string;
  'permission_name': string;
  'revocation_reason': string;
  'additionalProperties'?: Map<string, any>;
}

export interface RoleUpdatedEvent {
  'stream_id': string;
  'stream_type': 'role';
  'event_type': 'role.updated';
  'event_data': RoleUpdatedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface RoleUpdatedData {
  'name'?: string;
  'description'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface RoleDeactivatedEvent {
  'stream_id': string;
  'stream_type': 'role';
  'event_type': 'role.deactivated';
  'event_data': RoleDeactivatedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface RoleDeactivatedData {
  'reason': string;
  'additionalProperties'?: Map<string, any>;
}

export interface RoleReactivatedEvent {
  'stream_id': string;
  'stream_type': 'role';
  'event_type': 'role.reactivated';
  'event_data': RoleReactivatedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface RoleReactivatedData {
  'reason'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface RoleDeletedEvent {
  'stream_id': string;
  'stream_type': 'role';
  'event_type': 'role.deleted';
  'event_data': RoleDeletedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface RoleDeletedData {
  'reason': string;
  'additionalProperties'?: Map<string, any>;
}

export interface UserRoleAssignedEvent {
  'stream_id': string;
  'stream_type': 'user';
  'event_type': 'user.role.assigned';
  'event_data': UserRoleAssignedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface UserRoleAssignedData {
  'role_id': string;
  'role_name': string;
  'org_id': string;
  'scope_path': string;
  'assigned_by': string;
  'additionalProperties'?: Map<string, any>;
}

export interface UserRoleRevokedEvent {
  'stream_id': string;
  'stream_type': 'user';
  'event_type': 'user.role.revoked';
  'event_data': UserRoleRevokedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface UserRoleRevokedData {
  'role_id': string;
  'role_name': string;
  'org_id': string;
  'revoked_by': string;
  'additionalProperties'?: Map<string, any>;
}

export interface AccessGrantCreatedEvent {
  'stream_id': string;
  'stream_type': 'access_grant';
  'event_type': 'access_grant.created';
  'event_data': AccessGrantCreatedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface AccessGrantCreatedData {
  'consultant_org_id': string;
  'consultant_user_id'?: string;
  'provider_org_id': string;
  'scope': GrantScope;
  'scope_id'?: string;
  'authorization_type': GrantAuthorizationType;
  'legal_reference'?: string;
  'expires_at'?: string;
  'additionalProperties'?: Map<string, any>;
}

export interface AccessGrantRevokedEvent {
  'stream_id': string;
  'stream_type': 'access_grant';
  'event_type': 'access_grant.revoked';
  'event_data': AccessGrantRevokedData;
  'event_metadata': EventMetadata;
  'additionalProperties'?: Map<string, any>;
}

export interface AccessGrantRevokedData {
  'grant_id': string;
  'revoked_by': string;
  'revocation_reason': string;
  'additionalProperties'?: Map<string, any>;
}
