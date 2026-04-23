/**
 * Client Field Configuration Types
 *
 * Types for the /settings/client-fields page.
 * Matches api.list_field_definitions() and api.list_field_categories() return shapes.
 */

/** Field definition as returned by api.list_field_definitions() */
export interface FieldDefinition {
  id: string;
  category_id: string;
  category_name: string;
  category_slug: string;
  field_key: string;
  display_name: string;
  field_type: 'text' | 'number' | 'date' | 'enum' | 'multi_enum' | 'boolean' | 'jsonb';
  is_visible: boolean;
  is_required: boolean;
  validation_rules: Record<string, unknown> | null;
  is_dimension: boolean;
  sort_order: number;
  configurable_label: string | null;
  conforming_dimension_mapping: string | null;
  is_active: boolean;
}

/** Field category as returned by api.list_field_categories() */
export interface FieldCategory {
  id: string;
  organization_id: string | null;
  name: string;
  slug: string;
  sort_order: number;
  is_system: boolean;
  is_active: boolean;
}

/** Partial update payload for a single field in batch_update */
export interface FieldDefinitionChange {
  field_id: string;
  is_visible?: boolean;
  is_required?: boolean;
  configurable_label?: string;
  display_name?: string;
  sort_order?: number;
}

/** Result from api.batch_update_field_definitions() */
export interface BatchUpdateResult {
  success: boolean;
  updated_count: number;
  failed: Array<{ field_id: string; error: string }>;
  correlation_id: string;
}

/** Params for creating a new custom field definition */
export interface CreateFieldDefinitionParams {
  field_key: string;
  display_name: string;
  category_id: string;
  field_type?: string;
  is_visible?: boolean;
  is_required?: boolean;
  is_dimension?: boolean;
  sort_order?: number;
  validation_rules?: Record<string, unknown>;
}

/** Params for updating an existing custom field definition (m4: dedicated type, field_type excluded per m3) */
export interface UpdateFieldDefinitionParams {
  display_name?: string;
  category_id?: string;
  is_required?: boolean;
  validation_rules?: Record<string, unknown> | null;
  reason?: string;
  correlation_id?: string;
}

/**
 * Base envelope for client-field-settings RPC responses.
 *
 * Contract (Pattern A v2 — see adr-rpc-readback-pattern.md):
 *   Postcondition: `success` is always present.
 *   Postcondition: `error` is present iff `success === false`.
 */
export interface FieldRpcEnvelope {
  success: boolean;
  error?: string;
}

/**
 * Response for api.create_field_definition / api.update_field_definition /
 * api.deactivate_field_definition / api.reactivate_field_definition.
 *
 * `field` is populated by `update_field_definition` (Pattern A v2 read-back,
 * list-shape: joined `category_name` / `category_slug`, includes `is_active`).
 * Other RPCs in this group return just `{success, field_id}`.
 */
export interface FieldDefinitionResult extends FieldRpcEnvelope {
  field_id?: string;
  field?: FieldDefinition;
}

/**
 * Response for api.create_field_category / api.update_field_category /
 * api.deactivate_field_category / api.reactivate_field_category.
 *
 * `category` is populated by `update_field_category` (Pattern A v2 read-back,
 * list-shape: includes computed `is_system`). Other RPCs in this group return
 * just `{success, category_id}`.
 *
 * **Invariant**: when `category` is populated by `update_field_category`,
 * `category.is_system` is always `false` — the underlying RPC rejects
 * attempts to update system categories (pre-emit filter
 * `WHERE organization_id = v_org_id`, and system categories have
 * `organization_id = NULL`), so the read-back never returns one. Consumers
 * can treat `is_system` as a stable `false` for entities populated via this
 * RPC. (Migration `20260423154534_client_field_rpc_return_entities.sql`.)
 */
export interface FieldCategoryResult extends FieldRpcEnvelope {
  category_id?: string;
  category?: FieldCategory;
}

/**
 * Response for api.delete_field_definition. On failure (clients still have
 * data), `usage_count` carries the blocking count.
 */
export interface DeleteFieldResult extends FieldRpcEnvelope {
  field_id?: string;
  usage_count?: number;
}

/**
 * Response for api.delete_field_category. On failure (child fields remain),
 * `child_count` + `child_names` carry the blocking details.
 */
export interface DeleteCategoryResult extends FieldRpcEnvelope {
  category_id?: string;
  child_count?: number;
  child_names?: string[];
}

/** User-friendly display labels for field types */
export const FIELD_TYPE_DISPLAY_LABELS: Record<FieldDefinition['field_type'], string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  enum: 'Single-Select',
  multi_enum: 'Multi-Select',
  boolean: 'True / False',
  jsonb: 'Structured',
};

/**
 * Field keys that are locked (mandatory, cannot be hidden or made optional).
 * These correspond to is_locked=true in client_field_definition_templates.
 */
export const LOCKED_FIELD_KEYS = new Set([
  'first_name',
  'last_name',
  'date_of_birth',
  'gender',
  'admission_date',
  'allergies',
  'medical_conditions',
]);

/**
 * All system-seeded field keys from client_field_definition_templates.
 * Used to distinguish system fields (shown in category tabs) from
 * org-created custom fields (shown in the Custom Fields tab).
 */
export const SYSTEM_FIELD_KEYS = new Set([
  // Demographics (19)
  'first_name',
  'last_name',
  'middle_name',
  'preferred_name',
  'date_of_birth',
  'gender',
  'gender_identity',
  'pronouns',
  'race',
  'ethnicity',
  'primary_language',
  'secondary_language',
  'interpreter_needed',
  'marital_status',
  'citizenship_status',
  'photo_url',
  'mrn',
  'external_id',
  'drivers_license',
  // Contact Info (3)
  'client_phones',
  'client_emails',
  'client_addresses',
  // Guardian (3)
  'legal_custody_status',
  'court_ordered_placement',
  'financial_guarantor_type',
  // Referral (4)
  'referral_source_type',
  'referral_organization',
  'referral_date',
  'reason_for_referral',
  // Admission (6)
  'admission_date',
  'admission_type',
  'level_of_care',
  'expected_length_of_stay',
  'initial_risk_level',
  'placement_arrangement',
  // Insurance (2)
  'medicaid_id',
  'medicare_id',
  // Clinical (10 + 7 contact designations)
  'primary_diagnosis',
  'secondary_diagnoses',
  'dsm5_diagnoses',
  'presenting_problem',
  'suicide_risk_status',
  'violence_risk_status',
  'trauma_history_indicator',
  'substance_use_history',
  'developmental_history',
  'previous_treatment_history',
  'assigned_clinician',
  'therapist',
  'psychiatrist',
  'behavioral_analyst',
  'primary_care_physician',
  'prescriber',
  'program_manager',
  // Medical (5)
  'allergies',
  'medical_conditions',
  'immunization_status',
  'dietary_restrictions',
  'special_medical_needs',
  // Legal (6 + 2 contact designations)
  'court_case_number',
  'state_agency',
  'legal_status',
  'mandated_reporting_status',
  'protective_services_involvement',
  'safety_plan_required',
  'probation_officer',
  'caseworker',
  // Discharge (5)
  'discharge_date',
  'discharge_outcome',
  'discharge_reason',
  'discharge_diagnosis',
  'discharge_placement',
  // Education (3)
  'education_status',
  'grade_level',
  'iep_status',
]);
