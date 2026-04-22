/**
 * Supabase Client Field Service
 *
 * Production implementation using api.* schema RPC functions.
 * Follows CQRS pattern: all queries via api schema RPCs.
 * All write methods accept optional correlationId for audit trail grouping.
 */

import { supabase } from '@/lib/supabase';
import { Logger } from '@/utils/logger';
import type {
  FieldDefinition,
  FieldCategory,
  FieldDefinitionChange,
  BatchUpdateResult,
  CreateFieldDefinitionParams,
  UpdateFieldDefinitionParams,
  RpcResult,
} from '@/types/client-field-settings.types';
import type { IClientFieldService } from './IClientFieldService';

const log = Logger.getLogger('api');

export class SupabaseClientFieldService implements IClientFieldService {
  async listFieldDefinitions(includeInactive = false): Promise<FieldDefinition[]> {
    log.debug('Fetching field definitions', { includeInactive });

    const { data, error } = await supabase
      .schema('api')
      .rpc('list_field_definitions', { p_include_inactive: includeInactive });

    if (error) {
      log.error('Failed to fetch field definitions', { error });
      throw new Error(`Failed to fetch field definitions: ${error.message}`);
    }

    return (data ?? []) as FieldDefinition[];
  }

  async batchUpdateFieldDefinitions(
    changes: FieldDefinitionChange[],
    reason: string,
    correlationId?: string
  ): Promise<BatchUpdateResult> {
    log.debug('Batch updating field definitions', { changeCount: changes.length, reason });

    const { data, error } = await supabase.schema('api').rpc('batch_update_field_definitions', {
      p_changes: changes,
      p_reason: reason,
      p_correlation_id: correlationId ?? null,
    });

    if (error) {
      log.error('Failed to batch update field definitions', { error });
      throw new Error(`Failed to batch update: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    log.info('Batch update complete', { result });
    return result as BatchUpdateResult;
  }

  async createFieldDefinition(
    params: CreateFieldDefinitionParams,
    correlationId?: string
  ): Promise<RpcResult> {
    log.debug('Creating field definition', { params });

    const { data, error } = await supabase.schema('api').rpc('create_field_definition', {
      p_field_key: params.field_key,
      p_display_name: params.display_name,
      p_category_id: params.category_id,
      p_field_type: params.field_type ?? 'text',
      p_is_visible: params.is_visible ?? true,
      p_is_required: params.is_required ?? false,
      p_is_dimension: params.is_dimension ?? false,
      p_sort_order: params.sort_order ?? 0,
      p_validation_rules: params.validation_rules ?? null,
      p_correlation_id: correlationId ?? null,
    });

    if (error) {
      log.error('Failed to create field definition', { error });
      throw new Error(`Failed to create field: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return result as RpcResult;
  }

  async updateFieldDefinition(
    fieldId: string,
    params: UpdateFieldDefinitionParams
  ): Promise<RpcResult> {
    log.debug('Updating field definition', { fieldId, params });

    const { data, error } = await supabase.schema('api').rpc('update_field_definition', {
      p_field_id: fieldId,
      p_display_name: params.display_name ?? null,
      p_category_id: params.category_id ?? null,
      p_is_required: params.is_required ?? null,
      p_validation_rules: params.validation_rules ?? null,
      p_reason: params.reason ?? 'Field definition updated',
      p_correlation_id: params.correlation_id ?? null,
    });

    if (error) {
      log.error('Failed to update field definition', { error });
      throw new Error(`Failed to update field: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return result as RpcResult;
  }

  async deactivateFieldDefinition(
    fieldId: string,
    reason: string,
    correlationId?: string
  ): Promise<RpcResult> {
    log.debug('Deactivating field definition', { fieldId, reason });

    const { data, error } = await supabase.schema('api').rpc('deactivate_field_definition', {
      p_field_id: fieldId,
      p_reason: reason,
      p_correlation_id: correlationId ?? null,
    });

    if (error) {
      log.error('Failed to deactivate field definition', { error });
      throw new Error(`Failed to deactivate field: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return result as RpcResult;
  }

  async reactivateFieldDefinition(
    fieldId: string,
    reason: string,
    correlationId?: string
  ): Promise<RpcResult> {
    log.debug('Reactivating field definition', { fieldId, reason });

    const { data, error } = await supabase.schema('api').rpc('reactivate_field_definition', {
      p_field_id: fieldId,
      p_reason: reason,
      p_correlation_id: correlationId ?? null,
    });

    if (error) {
      log.error('Failed to reactivate field definition', { error });
      throw new Error(`Failed to reactivate field: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return result as RpcResult;
  }

  async deleteFieldDefinition(
    fieldId: string,
    reason: string,
    correlationId?: string
  ): Promise<RpcResult> {
    log.debug('Deleting field definition', { fieldId, reason });

    const { data, error } = await supabase.schema('api').rpc('delete_field_definition', {
      p_field_id: fieldId,
      p_reason: reason,
      p_correlation_id: correlationId ?? null,
    });

    if (error) {
      log.error('Failed to delete field definition', { error });
      throw new Error(`Failed to delete field: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return result as RpcResult;
  }

  async listFieldCategories(includeInactive = false): Promise<FieldCategory[]> {
    log.debug('Fetching field categories', { includeInactive });

    const { data, error } = await supabase.schema('api').rpc('list_field_categories', {
      p_include_inactive: includeInactive,
    });

    if (error) {
      log.error('Failed to fetch field categories', { error });
      throw new Error(`Failed to fetch categories: ${error.message}`);
    }

    return (data ?? []) as FieldCategory[];
  }

  async createFieldCategory(
    name: string,
    slug: string,
    sortOrder?: number,
    correlationId?: string
  ): Promise<RpcResult> {
    log.debug('Creating field category', { name, slug, sortOrder });

    const { data, error } = await supabase.schema('api').rpc('create_field_category', {
      p_name: name,
      p_slug: slug,
      p_sort_order: sortOrder ?? 0,
      p_correlation_id: correlationId ?? null,
    });

    if (error) {
      log.error('Failed to create field category', { error });
      throw new Error(`Failed to create category: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return result as RpcResult;
  }

  async updateFieldCategory(
    categoryId: string,
    name: string,
    reason: string,
    correlationId?: string
  ): Promise<RpcResult> {
    log.debug('Updating field category', { categoryId, name, reason });

    const { data, error } = await supabase.schema('api').rpc('update_field_category', {
      p_category_id: categoryId,
      p_name: name,
      p_reason: reason,
      p_correlation_id: correlationId ?? null,
    });

    if (error) {
      log.error('Failed to update field category', { error });
      throw new Error(`Failed to update category: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return result as RpcResult;
  }

  async deactivateFieldCategory(
    categoryId: string,
    reason: string,
    correlationId?: string
  ): Promise<RpcResult> {
    log.debug('Deactivating field category', { categoryId, reason });

    const { data, error } = await supabase.schema('api').rpc('deactivate_field_category', {
      p_category_id: categoryId,
      p_reason: reason,
      p_correlation_id: correlationId ?? null,
    });

    if (error) {
      log.error('Failed to deactivate field category', { error });
      throw new Error(`Failed to deactivate category: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return result as RpcResult;
  }

  async reactivateFieldCategory(
    categoryId: string,
    reason: string,
    correlationId?: string
  ): Promise<RpcResult> {
    log.debug('Reactivating field category', { categoryId, reason });

    const { data, error } = await supabase.schema('api').rpc('reactivate_field_category', {
      p_category_id: categoryId,
      p_reason: reason,
      p_correlation_id: correlationId ?? null,
    });

    if (error) {
      log.error('Failed to reactivate field category', { error });
      throw new Error(`Failed to reactivate category: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return result as RpcResult;
  }

  async deleteFieldCategory(
    categoryId: string,
    reason: string,
    correlationId?: string
  ): Promise<RpcResult> {
    log.debug('Deleting field category', { categoryId, reason });

    const { data, error } = await supabase.schema('api').rpc('delete_field_category', {
      p_category_id: categoryId,
      p_reason: reason,
      p_correlation_id: correlationId ?? null,
    });

    if (error) {
      log.error('Failed to delete field category', { error });
      throw new Error(`Failed to delete category: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return result as RpcResult;
  }

  async getFieldUsageCount(fieldKey: string): Promise<{ success: boolean; count: number }> {
    log.debug('Getting field usage count', { fieldKey });

    const { data, error } = await supabase.schema('api').rpc('get_field_usage_count', {
      p_field_key: fieldKey,
    });

    if (error) {
      log.error('Failed to get field usage count', { error });
      return { success: false, count: 0 };
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return { success: true, count: result?.count ?? 0 };
  }

  async getCategoryFieldCount(
    categoryId: string,
    includeInactive = false
  ): Promise<{ success: boolean; count: number; fields: string[] }> {
    log.debug('Getting category field count', { categoryId, includeInactive });

    const { data, error } = await supabase.schema('api').rpc('get_category_field_count', {
      p_category_id: categoryId,
      p_include_inactive: includeInactive,
    });

    if (error) {
      log.error('Failed to get category field count', { error });
      return { success: false, count: 0, fields: [] };
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return { success: true, count: result?.count ?? 0, fields: result?.fields ?? [] };
  }
}
