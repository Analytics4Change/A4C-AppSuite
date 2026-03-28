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

/** RPC result envelope */
export interface RpcResult {
  success: boolean;
  field_id?: string;
  category_id?: string;
  error?: string;
}

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
