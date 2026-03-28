/**
 * Supabase Client Field Service
 *
 * Production implementation using api.* schema RPC functions.
 * Follows CQRS pattern: all queries via api schema RPCs.
 */

import { supabase } from '@/lib/supabase';
import { Logger } from '@/utils/logger';
import type {
  FieldDefinition,
  FieldCategory,
  FieldDefinitionChange,
  BatchUpdateResult,
  CreateFieldDefinitionParams,
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
    reason: string
  ): Promise<BatchUpdateResult> {
    log.debug('Batch updating field definitions', { changeCount: changes.length, reason });

    const { data, error } = await supabase.schema('api').rpc('batch_update_field_definitions', {
      p_changes: JSON.stringify(changes),
      p_reason: reason,
    });

    if (error) {
      log.error('Failed to batch update field definitions', { error });
      throw new Error(`Failed to batch update: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    log.info('Batch update complete', { result });
    return result as BatchUpdateResult;
  }

  async createFieldDefinition(params: CreateFieldDefinitionParams): Promise<RpcResult> {
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
      p_validation_rules: params.validation_rules ? JSON.stringify(params.validation_rules) : null,
    });

    if (error) {
      log.error('Failed to create field definition', { error });
      throw new Error(`Failed to create field: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return result as RpcResult;
  }

  async deactivateFieldDefinition(fieldId: string, reason: string): Promise<RpcResult> {
    log.debug('Deactivating field definition', { fieldId, reason });

    const { data, error } = await supabase.schema('api').rpc('deactivate_field_definition', {
      p_field_id: fieldId,
      p_reason: reason,
    });

    if (error) {
      log.error('Failed to deactivate field definition', { error });
      throw new Error(`Failed to deactivate field: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return result as RpcResult;
  }

  async listFieldCategories(): Promise<FieldCategory[]> {
    log.debug('Fetching field categories');

    const { data, error } = await supabase.schema('api').rpc('list_field_categories');

    if (error) {
      log.error('Failed to fetch field categories', { error });
      throw new Error(`Failed to fetch categories: ${error.message}`);
    }

    return (data ?? []) as FieldCategory[];
  }

  async createFieldCategory(name: string, slug: string, sortOrder?: number): Promise<RpcResult> {
    log.debug('Creating field category', { name, slug, sortOrder });

    const { data, error } = await supabase.schema('api').rpc('create_field_category', {
      p_name: name,
      p_slug: slug,
      p_sort_order: sortOrder ?? 0,
    });

    if (error) {
      log.error('Failed to create field category', { error });
      throw new Error(`Failed to create category: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return result as RpcResult;
  }

  async deactivateFieldCategory(categoryId: string, reason: string): Promise<RpcResult> {
    log.debug('Deactivating field category', { categoryId, reason });

    const { data, error } = await supabase.schema('api').rpc('deactivate_field_category', {
      p_category_id: categoryId,
      p_reason: reason,
    });

    if (error) {
      log.error('Failed to deactivate field category', { error });
      throw new Error(`Failed to deactivate category: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return result as RpcResult;
  }
}
