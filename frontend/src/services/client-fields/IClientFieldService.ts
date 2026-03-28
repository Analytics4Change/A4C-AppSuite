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
  RpcResult,
} from '@/types/client-field-settings.types';

export interface IClientFieldService {
  /** List all field definitions for the current org */
  listFieldDefinitions(includeInactive?: boolean): Promise<FieldDefinition[]>;

  /** Batch update multiple field definitions in a single network call */
  batchUpdateFieldDefinitions(
    changes: FieldDefinitionChange[],
    reason: string
  ): Promise<BatchUpdateResult>;

  /** Create a new custom field definition */
  createFieldDefinition(params: CreateFieldDefinitionParams): Promise<RpcResult>;

  /** Deactivate (soft-delete) a field definition */
  deactivateFieldDefinition(fieldId: string, reason: string): Promise<RpcResult>;

  /** List all field categories (system + org-defined) */
  listFieldCategories(): Promise<FieldCategory[]>;

  /** Create a new org-defined category */
  createFieldCategory(name: string, slug: string, sortOrder?: number): Promise<RpcResult>;

  /** Deactivate (soft-delete) an org-defined category */
  deactivateFieldCategory(categoryId: string, reason: string): Promise<RpcResult>;
}
