/**
 * Domain Event Type Definitions
 * Generated from AsyncAPI specification
 * Source: /A4C-Infrastructure/supabase/contracts/asyncapi/
 */

// ============================================================================
// Base Event Structure
// ============================================================================

export type StreamType = 'client' | 'medication' | 'medication_history' | 'dosage' | 'user' | 'organization';

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
  | UserSyncedFromZitadelEvent
  | UserOrganizationSwitchedEvent;
