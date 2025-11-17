/**
 * Type Definitions Barrel Export
 *
 * Centralizes exports for cleaner imports throughout the application.
 * Usage: import { OrganizationFormData, WorkflowStatus } from '@/types';
 */

// Organization Management Types
export type {
  OrganizationFormData,
  OrganizationBootstrapParams,
  WorkflowStatus,
  OrganizationBootstrapResult,
  DraftSummary,
  InvitationDetails,
  UserCredentials,
  AcceptInvitationResult,
  Organization,
  OrganizationFilterOptions,
  OrganizationStatistics,
  // Part B Enhanced Types
  ContactFormData,
  AddressFormData,
  PhoneFormData,
  ContactInfo,
  AddressInfo,
  PhoneInfo
} from './organization.types';
