/**
 * Client Field Configuration Service Interface
 *
 * Contract for reading and updating client field definitions and categories.
 * Field definitions control which fields appear on the client intake form
 * and how they behave per organization.
 *
 * Implementations:
 * - SupabaseClientFieldService: Production (calls api.* RPCs)
 * - MockClientFieldService: Development (in-memory)
 *
 * @see api.list_field_definitions()
 * @see api.batch_update_field_definitions()
 * @see api.list_field_categories()
 */

import type {
  FieldDefinition,
  FieldCategory,
  FieldDefinitionChange,
  BatchUpdateResult,
  CreateFieldDefinitionParams,
  UpdateFieldDefinitionParams,
  FieldDefinitionResult,
  FieldCategoryResult,
  DeleteFieldResult,
  DeleteCategoryResult,
} from '@/types/client-field-settings.types';

export interface IClientFieldService {
  /** List all field definitions for the current org */
  listFieldDefinitions(includeInactive?: boolean): Promise<FieldDefinition[]>;

  /** Batch update multiple field definitions in a single network call */
  batchUpdateFieldDefinitions(
    changes: FieldDefinitionChange[],
    reason: string,
    correlationId?: string
  ): Promise<BatchUpdateResult>;

  /**
   * Create a new custom field definition.
   *
   * **Return shape**: `{success, field_id}` on success; `field` is NOT
   * populated — consumers that need the hydrated row should call
   * `listFieldDefinitions()` or wait for a subsequent `updateFieldDefinition`.
   */
  createFieldDefinition(
    params: CreateFieldDefinitionParams,
    correlationId?: string
  ): Promise<FieldDefinitionResult>;

  /**
   * Update an existing custom field definition.
   *
   * **Pattern A v2**: returns the refreshed `field` entity in the success
   * envelope (list-shape, includes joined `category_name` / `category_slug`)
   * so consumers can patch their list in place without a re-fetch.
   */
  updateFieldDefinition(
    fieldId: string,
    params: UpdateFieldDefinitionParams
  ): Promise<FieldDefinitionResult>;

  /**
   * Deactivate (soft-delete) a field definition.
   *
   * **Return shape**: `{success, field_id}` on success; `field` is NOT
   * populated.
   */
  deactivateFieldDefinition(
    fieldId: string,
    reason: string,
    correlationId?: string
  ): Promise<FieldDefinitionResult>;

  /**
   * Reactivate a previously deactivated field definition.
   *
   * **Return shape**: `{success, field_id}` on success; `field` is NOT
   * populated.
   */
  reactivateFieldDefinition(
    fieldId: string,
    reason: string,
    correlationId?: string
  ): Promise<FieldDefinitionResult>;

  /**
   * Permanently delete a field definition.
   * Preconditions (enforced server-side):
   *   - field is inactive
   *   - zero clients have data for the field_key in custom_fields
   * On failure, result.error carries the reason and (for usage) result.usage_count.
   */
  deleteFieldDefinition(
    fieldId: string,
    reason: string,
    correlationId?: string
  ): Promise<DeleteFieldResult>;

  /** List all field categories (system + org-defined) */
  listFieldCategories(includeInactive?: boolean): Promise<FieldCategory[]>;

  /**
   * Create a new org-defined category.
   *
   * **Return shape**: `{success, category_id}` on success; `category` is NOT
   * populated — consumers that need the hydrated row should call
   * `listFieldCategories()` or wait for a subsequent `updateFieldCategory`.
   */
  createFieldCategory(
    name: string,
    slug: string,
    sortOrder?: number,
    correlationId?: string
  ): Promise<FieldCategoryResult>;

  /**
   * Update an org-defined category (name only, slug immutable).
   *
   * **Pattern A v2**: returns the refreshed `category` entity in the success
   * envelope (list-shape, includes computed `is_system`) so consumers can
   * patch their list in place without a re-fetch. See `FieldCategoryResult`
   * for the `is_system` invariant.
   */
  updateFieldCategory(
    categoryId: string,
    name: string,
    reason: string,
    correlationId?: string
  ): Promise<FieldCategoryResult>;

  /**
   * Deactivate (soft-delete) an org-defined category.
   *
   * **Return shape**: `{success, category_id}` on success; `category` is NOT
   * populated.
   */
  deactivateFieldCategory(
    categoryId: string,
    reason: string,
    correlationId?: string
  ): Promise<FieldCategoryResult>;

  /**
   * Reactivate a previously deactivated org-defined category (does not
   * cascade to child fields).
   *
   * **Return shape**: `{success, category_id}` on success; `category` is NOT
   * populated.
   */
  reactivateFieldCategory(
    categoryId: string,
    reason: string,
    correlationId?: string
  ): Promise<FieldCategoryResult>;

  /**
   * Permanently delete an org-defined category.
   * Preconditions (enforced server-side):
   *   - category is inactive
   *   - zero rows in client_field_definitions_projection for this category (active or inactive)
   * On failure, result.error carries the reason and (for children) result.child_count + child_names.
   */
  deleteFieldCategory(
    categoryId: string,
    reason: string,
    correlationId?: string
  ): Promise<DeleteCategoryResult>;

  /** Count clients with data for a custom field (for deactivation/delete confirmation) */
  getFieldUsageCount(fieldKey: string): Promise<{ success: boolean; count: number }>;

  /**
   * Count fields in a category plus their names.
   * Pass includeInactive=true to count active + inactive fields (used by delete-category gate).
   */
  getCategoryFieldCount(
    categoryId: string,
    includeInactive?: boolean
  ): Promise<{ success: boolean; count: number; fields: string[] }>;
}
