/**
 * Event System Type Definitions
 *
 * This file re-exports types from the generated schema contracts
 * and adds application-specific extensions.
 *
 * Generated types are synced from A4C-Infrastructure/supabase/contracts/types
 */

// Re-export core types from event-types
export type {
  DomainEvent,
  EventMetadata,
  StreamType,
} from './event-types';

// Import types needed for extensions
import type { EventMetadata, StreamType } from './event-types';

// Application-specific type extensions

/**
 * Approval record for events requiring approval
 */
export interface ApprovalRecord {
  approver_id: string;
  approver_name: string;
  approved_at: string;
  role: string;
  notes?: string;
}

/**
 * Extended EventMetadata with app-specific fields
 */
export interface ExtendedEventMetadata extends EventMetadata {
  source?: string; // Source system/component
  approval_chain?: ApprovalRecord[];
  user_email?: string; // Legacy field, prefer using user_id
  user_name?: string; // Legacy field, prefer using user_id
  [key: string]: unknown; // Allow additional metadata
}

/**
 * Medication-related event types
 */
export type MedicationEventType =
  | 'medication.added_to_formulary'
  | 'medication.updated'
  | 'medication.removed_from_formulary'
  | 'medication.prescribed'
  | 'medication.refilled'
  | 'medication.discontinued'
  | 'medication.modified'
  | 'medication.administered'
  | 'medication.skipped'
  | 'medication.refused';

/**
 * Client-related event types
 */
export type ClientEventType =
  | 'client.registered'
  | 'client.admitted'
  | 'client.information_updated'
  | 'client.discharged'
  | 'client.archived';

/**
 * All supported event types
 */
export type EventType = MedicationEventType | ClientEventType;

/**
 * Medication prescribed event data
 * This is what the medication entry form emits
 */
export interface MedicationPrescribedEventData {
  organization_id: string; // External ID or UUID
  client_id: string;
  medication_id: string;
  medication_name?: string; // Stored in metadata for readability

  // Prescription details
  prescription_date: string; // ISO date
  start_date: string; // ISO date
  end_date?: string; // ISO date
  prescriber_name?: string;
  prescriber_npi?: string;
  prescriber_license?: string;

  // Dosage information
  dosage_amount: number;
  dosage_unit: string;
  dosage_form?: string;
  frequency: string | string[]; // Can be array or comma-separated
  timings?: string[]; // ['morning', 'evening', 'bedtime']
  food_conditions?: string[]; // ['with_food', 'without_food']
  special_restrictions?: string[];
  route?: string; // 'oral', 'injection', etc.
  instructions?: string;

  // PRN (as needed)
  is_prn?: boolean;
  prn_reason?: string;

  // Tracking
  refills_authorized?: number;
  pharmacy_name?: string;
  pharmacy_phone?: string;
  rx_number?: string;

  // Inventory
  inventory_quantity?: number;
  inventory_unit?: string;

  // Notes
  notes?: string;
}

/**
 * Client registered event data
 */
export interface ClientRegisteredEventData {
  organization_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string; // ISO date
  gender?: string;
  email?: string;
  phone?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  emergency_contact?: {
    name?: string;
    relationship?: string;
    phone?: string;
  };
  allergies?: string[];
  medical_conditions?: string[];
  blood_type?: string;
  notes?: string;
}

/**
 * Event emission options
 */
export interface EmitEventOptions {
  additionalMetadata?: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
}

/**
 * Event subscription filter
 */
export interface EventFilter {
  streamId?: string;
  streamType?: StreamType;
  eventType?: EventType;
  since?: string; // ISO timestamp
}

/**
 * Event history query options
 */
export interface EventHistoryOptions {
  limit?: number;
  offset?: number;
  orderBy?: 'asc' | 'desc';
  includeProcessed?: boolean;
  includeErrors?: boolean;
}
