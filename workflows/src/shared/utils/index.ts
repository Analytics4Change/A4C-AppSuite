/**
 * Shared Utilities
 *
 * Exports common utilities for workflows and activities
 */

export { getSupabaseClient, resetSupabaseClient } from './supabase';
export {
  emitEvent,
  getEnvironmentTags,
  buildTags,
  generateSpanId,
  buildTracingForEvent,
  createActivityTracingContext,
} from './emit-event';
export {
  getLogger,
  workflowLog,
  activityLog,
  apiLog,
  workerLog,
  type LogLevel,
} from './logger';

// Type-safe event emission helpers
export {
  // Entity event emitters
  emitContactCreated,
  emitContactUpdated,
  emitContactDeleted,
  emitPhoneCreated,
  emitPhoneUpdated,
  emitPhoneDeleted,
  emitAddressCreated,
  emitAddressUpdated,
  emitAddressDeleted,
  emitEmailCreated,
  emitEmailUpdated,
  emitEmailDeleted,
  // Organization DNS event emitters
  emitSubdomainDnsCreated,
  emitSubdomainVerified,
  emitOrganizationDnsRemoved,
  // Organization bootstrap event emitters
  emitBootstrapFailed,
  emitBootstrapCompleted,
  // Invitation event emitters
  emitInvitationEmailSent,
  // RBAC event emitters
  emitRoleCreated,
  emitRolePermissionGranted,
  // Organization-entity junction emitters
  emitOrganizationContactLinked,
  emitOrganizationContactUnlinked,
  emitOrganizationPhoneLinked,
  emitOrganizationPhoneUnlinked,
  emitOrganizationAddressLinked,
  emitOrganizationAddressUnlinked,
  emitOrganizationEmailLinked,
  emitOrganizationEmailUnlinked,
  // Contact-entity junction emitters
  emitContactPhoneLinked,
  emitContactPhoneUnlinked,
  emitContactAddressLinked,
  emitContactAddressUnlinked,
  emitContactEmailLinked,
  emitContactEmailUnlinked,
  // Type mapping utilities
  mapContactType,
  mapPhoneType,
  mapAddressType,
  mapEmailType,
  // Re-exported enums
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
} from './typed-events';
