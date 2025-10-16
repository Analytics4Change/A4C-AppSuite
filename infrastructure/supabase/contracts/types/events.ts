/**
 * Domain Event Type Definitions
 * Generated from AsyncAPI specification
 * Source: /A4C-Infrastructure/supabase/contracts/asyncapi/
 */

// ============================================================================
// Base Event Structure
// ============================================================================

export type StreamType = 'client' | 'medication' | 'medication_history' | 'dosage' | 'user' | 'organization' | 'access_grant';

export interface EventMetadata {
  user_id: string;
  organization_id: string;
  reason: string;
  timestamp?: string;
  correlation_id?: string;
  causation_id?: string;
}

export interface DomainEvent<T = any> {
  id: string;
  stream_id: string;
  stream_type: StreamType;
  stream_version: number;
  event_type: string;
  event_data: T;
  event_metadata: EventMetadata;
  created_at: string;
  processed_at?: string | null;
  processing_error?: string | null;
}

// ============================================================================
// Shared Types
// ============================================================================

export interface Address {
  street?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  country?: string;
}

export interface EmergencyContact {
  name?: string;
  relationship?: string;
  phone?: string;
  email?: string;
}

// ============================================================================
// Client Domain Events
// ============================================================================

export type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say';
export type BloodType = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';

export interface ClientRegistrationData {
  organization_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender?: Gender;
  email?: string;
  phone?: string;
  address?: Address;
  emergency_contact?: EmergencyContact;
  allergies?: string[];
  medical_conditions?: string[];
  blood_type?: BloodType;
  insurance_provider?: string;
  insurance_policy_number?: string;
  notes?: string;
}

export interface ClientRegisteredEvent extends DomainEvent<ClientRegistrationData> {
  stream_type: 'client';
  event_type: 'client.registered';
  event_metadata: EventMetadata & {
    reason: string;
  };
}

export type AdmissionType = 'scheduled' | 'emergency' | 'transfer' | 'readmission';

export interface ClientAdmissionData {
  admission_date: string;
  facility_id: string;
  admission_type: AdmissionType;
  referring_provider?: string;
  referring_organization?: string;
  primary_diagnosis?: string;
  secondary_diagnoses?: string[];
  expected_length_of_stay?: number;
  admission_notes?: string;
}

export interface ClientAdmittedEvent extends DomainEvent<ClientAdmissionData> {
  stream_type: 'client';
  event_type: 'client.admitted';
  event_metadata: EventMetadata & {
    reason: string;
  };
}

export interface ClientUpdateData {
  changes: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    address?: Address;
    emergency_contact?: EmergencyContact;
    allergies?: string[];
    medical_conditions?: string[];
    blood_type?: BloodType;
    insurance_provider?: string;
    insurance_policy_number?: string;
    notes?: string;
  };
  previous_values?: Record<string, any>;
}

export interface ClientInformationUpdatedEvent extends DomainEvent<ClientUpdateData> {
  stream_type: 'client';
  event_type: 'client.information_updated';
  event_metadata: EventMetadata & {
    reason: string;
  };
}

export type DischargeType = 'planned' | 'against_medical_advice' | 'transfer' | 'administrative' | 'death';
export type DischargeDisposition =
  | 'home'
  | 'home_with_services'
  | 'skilled_nursing_facility'
  | 'rehabilitation_facility'
  | 'acute_care_hospital'
  | 'psychiatric_hospital'
  | 'hospice'
  | 'deceased'
  | 'left_against_advice'
  | 'other';

export interface ClientDischargeData {
  discharge_date: string;
  discharge_type: DischargeType;
  discharge_disposition: DischargeDisposition;
  follow_up_appointments?: Array<{
    provider?: string;
    date?: string;
    type?: string;
  }>;
  discharge_medications?: string[];
  discharge_instructions?: string;
  discharge_summary?: string;
}

export interface ClientDischargedEvent extends DomainEvent<ClientDischargeData> {
  stream_type: 'client';
  event_type: 'client.discharged';
  event_metadata: EventMetadata & {
    reason: string;
  };
}

// ============================================================================
// Medication Domain Events (Placeholder - extend as needed)
// ============================================================================

export interface MedicationAddedToFormularyEvent extends DomainEvent {
  stream_type: 'medication';
  event_type: 'medication.added_to_formulary';
}

export interface MedicationPrescribedEvent extends DomainEvent {
  stream_type: 'medication_history';
  event_type: 'medication.prescribed';
}

export interface MedicationAdministeredEvent extends DomainEvent {
  stream_type: 'medication_history';
  event_type: 'medication.administered';
}

export interface MedicationSkippedEvent extends DomainEvent {
  stream_type: 'medication_history';
  event_type: 'medication.skipped';
}

export interface MedicationRefusedEvent extends DomainEvent {
  stream_type: 'medication_history';
  event_type: 'medication.refused';
}

export interface MedicationDiscontinuedEvent extends DomainEvent {
  stream_type: 'medication_history';
  event_type: 'medication.discontinued';
}

// ============================================================================
// Organization Domain Events
// ============================================================================

export type OrganizationType = 'platform_owner' | 'provider' | 'provider_partner';

export interface Address {
  street?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  country?: string;
}

export interface OrganizationCreationData {
  name: string;
  display_name?: string;
  slug: string;
  zitadel_org_id?: string;
  type: OrganizationType;
  path: string;
  parent_path?: string;
  tax_number?: string;
  phone_number?: string;
  timezone?: string;
  metadata?: Record<string, any>;
}

export interface OrganizationCreatedEvent extends DomainEvent<OrganizationCreationData> {
  stream_type: 'organization';
  event_type: 'organization.created';
  event_metadata: EventMetadata & {
    reason: string;
  };
}

export interface ProviderBusinessProfile {
  // Billing Information (Provider-specific)
  billing_name?: string;
  billing_tax?: string;
  billing_address?: Address;
  
  // Provider Admin
  administrator_name: string;
  administrator_email: string;
  email_provider?: string;
  
  // Contact Information
  main_phone_number: string;
  additional_phone_number?: string;
  fax_number?: string;
  email: string;
  
  // Program Information (Provider-specific)
  program_name: string;
  service_types?: string[];
}

export interface ProviderPartnerBusinessProfile {
  // Contact Information
  contact_name: string;
  contact_address?: Address;
  contact_email: string;
  contact_phone: string;
  
  // Provider Partner Admin
  administrator_name: string;
  administrator_email: string;
  email_provider?: string;
  
  // Partner-specific metadata
  partner_type?: 'var' | 'family_access' | 'court_system' | 'social_services';
}

export interface OrganizationBusinessProfileData {
  organization_type: 'provider' | 'provider_partner';
  mailing_address?: Address;
  physical_address?: Address;
  provider_profile?: ProviderBusinessProfile;
  partner_profile?: ProviderPartnerBusinessProfile;
}

export interface OrganizationBusinessProfileCreatedEvent extends DomainEvent<OrganizationBusinessProfileData> {
  stream_type: 'organization';
  event_type: 'organization.business_profile.created';
  event_metadata: EventMetadata & {
    reason: string;
  };
}

export type DeactivationType = 'billing_suspension' | 'compliance_violation' | 'voluntary_suspension' | 'maintenance';

export interface OrganizationDeactivationData {
  organization_id: string;
  deactivation_type: DeactivationType;
  effective_date: string;
  cascade_to_children: boolean;
  login_blocked: boolean;
  role_assignment_blocked: boolean;
  existing_users_affected: boolean;
  reactivation_conditions?: string[];
}

export interface OrganizationDeactivatedEvent extends DomainEvent<OrganizationDeactivationData> {
  stream_type: 'organization';
  event_type: 'organization.deactivated';
  event_metadata: EventMetadata & {
    reason: string;
  };
}

export type DeletionStrategy = 'cascade_delete' | 'block_if_children';

export interface OrganizationDeletionData {
  organization_id: string;
  deleted_path: string;
  deletion_strategy: DeletionStrategy;
  cascade_confirmed: boolean;
}

export interface OrganizationDeletedEvent extends DomainEvent<OrganizationDeletionData> {
  stream_type: 'organization';
  event_type: 'organization.deleted';
  event_metadata: EventMetadata & {
    reason: string;
  };
}

// ============================================================================
// Organization Bootstrap Events
// ============================================================================

export interface OrganizationBootstrapInitiationData {
  bootstrap_id: string;
  organization_type: 'provider' | 'provider_partner';
  organization_name: string;
  admin_email: string;
  slug?: string;
  contact_info?: {
    phone_number?: string;
    timezone?: string;
  };
}

export interface OrganizationBootstrapInitiatedEvent extends DomainEvent<OrganizationBootstrapInitiationData> {
  stream_type: 'organization';
  event_type: 'organization.bootstrap.initiated';
}

export interface OrganizationZitadelCreationData {
  bootstrap_id: string;
  zitadel_org_id: string;
  zitadel_user_id: string;
  admin_email: string;
  organization_name: string;
  organization_type: 'provider' | 'provider_partner';
  slug: string;
  invitation_sent?: boolean;
}

export interface OrganizationZitadelCreatedEvent extends DomainEvent<OrganizationZitadelCreationData> {
  stream_type: 'organization';
  event_type: 'organization.zitadel.created';
}

export interface OrganizationBootstrapCompletionData {
  bootstrap_id: string;
  organization_id: string;
  admin_role_assigned: 'provider_admin' | 'partner_admin';
  permissions_granted: number;
  zitadel_org_id: string;
  ltree_path: string;
}

export interface OrganizationBootstrapCompletedEvent extends DomainEvent<OrganizationBootstrapCompletionData> {
  stream_type: 'organization';
  event_type: 'organization.bootstrap.completed';
}

export interface OrganizationBootstrapFailureData {
  bootstrap_id: string;
  failure_stage: 'zitadel_org_creation' | 'zitadel_user_creation' | 'organization_creation' | 'role_assignment' | 'permission_grants';
  error_message: string;
  zitadel_org_id?: string;
  partial_cleanup_required?: boolean;
}

export interface OrganizationBootstrapFailedEvent extends DomainEvent<OrganizationBootstrapFailureData> {
  stream_type: 'organization';
  event_type: 'organization.bootstrap.failed';
}

export interface OrganizationBootstrapCancellationData {
  bootstrap_id: string;
  cleanup_completed: boolean;
  cleanup_actions?: string[];
  original_failure_stage?: string;
}

export interface OrganizationBootstrapCancelledEvent extends DomainEvent<OrganizationBootstrapCancellationData> {
  stream_type: 'organization';
  event_type: 'organization.bootstrap.cancelled';
}

// ============================================================================
// Cross-Tenant Access Grant Events
// ============================================================================

export interface AccessGrantCreationData {
  consultant_org_id: string;
  consultant_user_id?: string;
  provider_org_id: string;
  scope: 'full_org' | 'facility' | 'program' | 'client_specific';
  scope_id?: string;
  authorization_type: 'var_contract' | 'court_order' | 'parental_consent' | 'social_services_assignment' | 'emergency_access';
  legal_reference?: string;
  granted_by: string;
  expires_at?: string;
  permissions?: string[];
  terms?: {
    read_only?: boolean;
    data_retention_days?: number;
    notification_required?: boolean;
  };
}

export interface AccessGrantCreatedEvent extends DomainEvent<AccessGrantCreationData> {
  stream_type: 'access_grant';
  event_type: 'access_grant.created';
}

export interface AccessGrantRevocationData {
  grant_id: string;
  revoked_by: string;
  revocation_reason: 'contract_expired' | 'legal_basis_withdrawn' | 'security_breach' | 'administrative_decision' | 'user_request';
  revocation_details?: string;
  effective_immediately?: boolean;
  grace_period_hours?: number;
}

export interface AccessGrantRevokedEvent extends DomainEvent<AccessGrantRevocationData> {
  stream_type: 'access_grant';
  event_type: 'access_grant.revoked';
}

export interface AccessGrantExpirationData {
  grant_id: string;
  expiration_type: 'time_based' | 'contract_based' | 'automatic_cleanup';
  original_expires_at: string;
  expired_at: string;
  renewal_available?: boolean;
}

export interface AccessGrantExpiredEvent extends DomainEvent<AccessGrantExpirationData> {
  stream_type: 'access_grant';
  event_type: 'access_grant.expired';
}

export interface AccessGrantSuspensionData {
  grant_id: string;
  suspended_by: string;
  suspension_reason: 'investigation' | 'contract_dispute' | 'security_concern' | 'administrative_hold';
  suspension_details?: string;
  expected_resolution_date?: string;
}

export interface AccessGrantSuspendedEvent extends DomainEvent<AccessGrantSuspensionData> {
  stream_type: 'access_grant';
  event_type: 'access_grant.suspended';
}

export interface AccessGrantReactivationData {
  grant_id: string;
  reactivated_by: string;
  resolution_details: string;
  new_expires_at?: string;
  terms_modified?: boolean;
}

export interface AccessGrantReactivatedEvent extends DomainEvent<AccessGrantReactivationData> {
  stream_type: 'access_grant';
  event_type: 'access_grant.reactivated';
}

// ============================================================================
// User Domain Events (Placeholder - extend as needed)
// ============================================================================

export interface UserSyncedFromZitadelEvent extends DomainEvent {
  stream_type: 'user';
  event_type: 'user.synced_from_zitadel';
}

export interface UserOrganizationSwitchedEvent extends DomainEvent {
  stream_type: 'user';
  event_type: 'user.organization_switched';
}

// ============================================================================
// Event Type Union
// ============================================================================

export type AllDomainEvents =
  | ClientRegisteredEvent
  | ClientAdmittedEvent
  | ClientInformationUpdatedEvent
  | ClientDischargedEvent
  | MedicationAddedToFormularyEvent
  | MedicationPrescribedEvent
  | MedicationAdministeredEvent
  | MedicationSkippedEvent
  | MedicationRefusedEvent
  | MedicationDiscontinuedEvent
  | OrganizationCreatedEvent
  | OrganizationBusinessProfileCreatedEvent
  | OrganizationDeactivatedEvent
  | OrganizationDeletedEvent
  | OrganizationBootstrapInitiatedEvent
  | OrganizationZitadelCreatedEvent
  | OrganizationBootstrapCompletedEvent
  | OrganizationBootstrapFailedEvent
  | OrganizationBootstrapCancelledEvent
  | AccessGrantCreatedEvent
  | AccessGrantRevokedEvent
  | AccessGrantExpiredEvent
  | AccessGrantSuspendedEvent
  | AccessGrantReactivatedEvent
  | UserSyncedFromZitadelEvent
  | UserOrganizationSwitchedEvent;
