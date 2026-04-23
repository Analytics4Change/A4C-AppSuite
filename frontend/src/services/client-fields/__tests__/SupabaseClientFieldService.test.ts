import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseClientFieldService } from '../SupabaseClientFieldService';
import type {
  FieldDefinition,
  FieldCategory,
  BatchUpdateResult,
  CreateFieldDefinitionParams,
  FieldDefinitionResult,
  FieldCategoryResult,
} from '@/types/client-field-settings.types';

// ── Mock @/lib/supabase ──

const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    schema: () => ({ rpc: mockRpc }),
  },
}));

// ── Test fixtures ──

const FIELD_DEFINITION: FieldDefinition = {
  id: 'field-01',
  category_id: 'cat-01',
  category_name: 'Demographics',
  category_slug: 'demographics',
  field_key: 'first_name',
  display_name: 'First Name',
  field_type: 'text',
  is_visible: true,
  is_required: true,
  validation_rules: null,
  is_dimension: false,
  sort_order: 0,
  configurable_label: null,
  conforming_dimension_mapping: null,
  is_active: true,
};

const FIELD_CATEGORY: FieldCategory = {
  id: 'cat-01',
  organization_id: null,
  name: 'Demographics',
  slug: 'demographics',
  sort_order: 1,
  is_system: true,
  is_active: true,
};

const BATCH_UPDATE_RESULT: BatchUpdateResult = {
  success: true,
  updated_count: 2,
  failed: [],
  correlation_id: 'corr-abc-123',
};

const RPC_SUCCESS: FieldDefinitionResult = { success: true, field_id: 'field-01' };

// ── Tests ──

describe('SupabaseClientFieldService', () => {
  let service: SupabaseClientFieldService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SupabaseClientFieldService();
  });

  // ── listFieldDefinitions ──

  describe('listFieldDefinitions', () => {
    it('returns field definitions on success (default: includeInactive=false)', async () => {
      mockRpc.mockResolvedValueOnce({ data: [FIELD_DEFINITION], error: null });

      const result = await service.listFieldDefinitions();

      expect(mockRpc).toHaveBeenCalledWith('list_field_definitions', {
        p_include_inactive: false,
      });
      expect(result).toEqual([FIELD_DEFINITION]);
    });

    it('passes p_include_inactive: true when requested', async () => {
      mockRpc.mockResolvedValueOnce({ data: [FIELD_DEFINITION], error: null });

      await service.listFieldDefinitions(true);

      expect(mockRpc).toHaveBeenCalledWith('list_field_definitions', {
        p_include_inactive: true,
      });
    });

    it('returns empty array when data is null', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: null });

      const result = await service.listFieldDefinitions();

      expect(result).toEqual([]);
    });

    it('throws with descriptive message on error', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'permission denied for schema api' },
      });

      await expect(service.listFieldDefinitions()).rejects.toThrow(
        'Failed to fetch field definitions: permission denied for schema api'
      );
    });
  });

  // ── batchUpdateFieldDefinitions ──

  describe('batchUpdateFieldDefinitions', () => {
    const changes = [
      { field_id: 'field-01', is_visible: false },
      { field_id: 'field-02', is_required: true },
    ];
    const reason = 'Updating visibility for audit compliance';

    it('returns BatchUpdateResult on success with object data', async () => {
      mockRpc.mockResolvedValueOnce({ data: BATCH_UPDATE_RESULT, error: null });

      const result = await service.batchUpdateFieldDefinitions(changes, reason);

      expect(mockRpc).toHaveBeenCalledWith('batch_update_field_definitions', {
        p_changes: changes,
        p_reason: reason,
        p_correlation_id: null,
      });
      expect(result).toEqual(BATCH_UPDATE_RESULT);
    });

    it('parses JSON string data response', async () => {
      mockRpc.mockResolvedValueOnce({
        data: JSON.stringify(BATCH_UPDATE_RESULT),
        error: null,
      });

      const result = await service.batchUpdateFieldDefinitions(changes, reason);

      expect(result).toEqual(BATCH_UPDATE_RESULT);
    });

    it('passes changes as array (no double stringification)', async () => {
      // Regression protection: commit 4849122b removed double JSON
      // serialization — p_changes must be the array itself, not a stringified
      // JSON blob. The Supabase JS client serializes JSONB params on transport.
      mockRpc.mockResolvedValueOnce({ data: BATCH_UPDATE_RESULT, error: null });

      await service.batchUpdateFieldDefinitions(changes, reason);

      const callArgs = mockRpc.mock.calls[0][1];
      expect(callArgs.p_changes).toEqual(changes);
      expect(Array.isArray(callArgs.p_changes)).toBe(true);
      expect(typeof callArgs.p_changes).not.toBe('string');
    });

    it('throws with descriptive message on error', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'batch update failed: field not found' },
      });

      await expect(service.batchUpdateFieldDefinitions(changes, reason)).rejects.toThrow(
        'Failed to batch update: batch update failed: field not found'
      );
    });
  });

  // ── createFieldDefinition ──

  describe('createFieldDefinition', () => {
    it('returns RpcResult on success with all params provided', async () => {
      mockRpc.mockResolvedValueOnce({ data: RPC_SUCCESS, error: null });

      const params: CreateFieldDefinitionParams = {
        field_key: 'custom_notes',
        display_name: 'Custom Notes',
        category_id: 'cat-01',
        field_type: 'text',
        is_visible: true,
        is_required: false,
        is_dimension: false,
        sort_order: 5,
        validation_rules: { maxLength: 500 },
      };

      const result = await service.createFieldDefinition(params);

      expect(mockRpc).toHaveBeenCalledWith('create_field_definition', {
        p_field_key: 'custom_notes',
        p_display_name: 'Custom Notes',
        p_category_id: 'cat-01',
        p_field_type: 'text',
        p_is_visible: true,
        p_is_required: false,
        p_is_dimension: false,
        p_sort_order: 5,
        p_validation_rules: { maxLength: 500 },
        p_correlation_id: null,
      });
      expect(result).toEqual(RPC_SUCCESS);
    });

    it('applies defaults when optional params are omitted', async () => {
      mockRpc.mockResolvedValueOnce({ data: RPC_SUCCESS, error: null });

      const params: CreateFieldDefinitionParams = {
        field_key: 'custom_field',
        display_name: 'Custom Field',
        category_id: 'cat-01',
      };

      await service.createFieldDefinition(params);

      expect(mockRpc).toHaveBeenCalledWith('create_field_definition', {
        p_field_key: 'custom_field',
        p_display_name: 'Custom Field',
        p_category_id: 'cat-01',
        p_field_type: 'text',
        p_is_visible: true,
        p_is_required: false,
        p_is_dimension: false,
        p_sort_order: 0,
        p_validation_rules: null,
        p_correlation_id: null,
      });
    });

    it('sets p_validation_rules to null when not provided', async () => {
      mockRpc.mockResolvedValueOnce({ data: RPC_SUCCESS, error: null });

      await service.createFieldDefinition({
        field_key: 'f',
        display_name: 'F',
        category_id: 'cat-01',
      });

      const callArgs = mockRpc.mock.calls[0][1];
      expect(callArgs.p_validation_rules).toBeNull();
    });

    it('parses JSON string data response', async () => {
      mockRpc.mockResolvedValueOnce({ data: JSON.stringify(RPC_SUCCESS), error: null });

      const result = await service.createFieldDefinition({
        field_key: 'f',
        display_name: 'F',
        category_id: 'cat-01',
      });

      expect(result).toEqual(RPC_SUCCESS);
    });

    it('throws with descriptive message on error', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'duplicate field key' },
      });

      await expect(
        service.createFieldDefinition({
          field_key: 'first_name',
          display_name: 'First Name',
          category_id: 'cat-01',
        })
      ).rejects.toThrow('Failed to create field: duplicate field key');
    });
  });

  // ── deactivateFieldDefinition ──

  describe('deactivateFieldDefinition', () => {
    it('returns RpcResult on success', async () => {
      const rpcResult: FieldDefinitionResult = { success: true, field_id: 'field-01' };
      mockRpc.mockResolvedValueOnce({ data: rpcResult, error: null });

      const result = await service.deactivateFieldDefinition('field-01', 'No longer needed');

      expect(mockRpc).toHaveBeenCalledWith('deactivate_field_definition', {
        p_field_id: 'field-01',
        p_reason: 'No longer needed',
        p_correlation_id: null,
      });
      expect(result).toEqual(rpcResult);
    });

    it('parses JSON string data response', async () => {
      const rpcResult: FieldDefinitionResult = { success: true, field_id: 'field-01' };
      mockRpc.mockResolvedValueOnce({ data: JSON.stringify(rpcResult), error: null });

      const result = await service.deactivateFieldDefinition('field-01', 'reason');

      expect(result).toEqual(rpcResult);
    });

    it('throws with descriptive message on error', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'field is locked and cannot be deactivated' },
      });

      await expect(service.deactivateFieldDefinition('field-01', 'reason')).rejects.toThrow(
        'Failed to deactivate field: field is locked and cannot be deactivated'
      );
    });
  });

  // ── listFieldCategories ──

  describe('listFieldCategories', () => {
    it('returns field categories on success', async () => {
      mockRpc.mockResolvedValueOnce({ data: [FIELD_CATEGORY], error: null });

      const result = await service.listFieldCategories();

      expect(mockRpc).toHaveBeenCalledWith('list_field_categories', {
        p_include_inactive: false,
      });
      expect(result).toEqual([FIELD_CATEGORY]);
    });

    it('returns empty array when data is null', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: null });

      const result = await service.listFieldCategories();

      expect(result).toEqual([]);
    });

    it('throws with descriptive message on error', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'relation does not exist' },
      });

      await expect(service.listFieldCategories()).rejects.toThrow(
        'Failed to fetch categories: relation does not exist'
      );
    });
  });

  // ── createFieldCategory ──

  describe('createFieldCategory', () => {
    it('returns RpcResult on success', async () => {
      const rpcResult: FieldCategoryResult = { success: true, category_id: 'cat-new' };
      mockRpc.mockResolvedValueOnce({ data: rpcResult, error: null });

      const result = await service.createFieldCategory('Housing', 'housing', 3);

      expect(mockRpc).toHaveBeenCalledWith('create_field_category', {
        p_name: 'Housing',
        p_slug: 'housing',
        p_sort_order: 3,
        p_correlation_id: null,
      });
      expect(result).toEqual(rpcResult);
    });

    it('defaults sortOrder to 0 when not provided', async () => {
      mockRpc.mockResolvedValueOnce({ data: { success: true }, error: null });

      await service.createFieldCategory('Housing', 'housing');

      expect(mockRpc).toHaveBeenCalledWith('create_field_category', {
        p_name: 'Housing',
        p_slug: 'housing',
        p_sort_order: 0,
        p_correlation_id: null,
      });
    });

    it('parses JSON string data response', async () => {
      const rpcResult: FieldCategoryResult = { success: true, category_id: 'cat-new' };
      mockRpc.mockResolvedValueOnce({ data: JSON.stringify(rpcResult), error: null });

      const result = await service.createFieldCategory('Housing', 'housing');

      expect(result).toEqual(rpcResult);
    });

    it('throws with descriptive message on error', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'slug already exists' },
      });

      await expect(service.createFieldCategory('Demographics', 'demographics')).rejects.toThrow(
        'Failed to create category: slug already exists'
      );
    });
  });

  // ── deactivateFieldCategory ──

  describe('deactivateFieldCategory', () => {
    it('returns RpcResult on success', async () => {
      const rpcResult: FieldCategoryResult = { success: true, category_id: 'cat-01' };
      mockRpc.mockResolvedValueOnce({ data: rpcResult, error: null });

      const result = await service.deactivateFieldCategory('cat-01', 'Category merged into other');

      expect(mockRpc).toHaveBeenCalledWith('deactivate_field_category', {
        p_category_id: 'cat-01',
        p_reason: 'Category merged into other',
        p_correlation_id: null,
      });
      expect(result).toEqual(rpcResult);
    });

    it('parses JSON string data response', async () => {
      const rpcResult: FieldCategoryResult = { success: true, category_id: 'cat-01' };
      mockRpc.mockResolvedValueOnce({ data: JSON.stringify(rpcResult), error: null });

      const result = await service.deactivateFieldCategory('cat-01', 'reason');

      expect(result).toEqual(rpcResult);
    });

    it('throws with descriptive message on error', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'system categories cannot be deactivated' },
      });

      await expect(service.deactivateFieldCategory('cat-01', 'reason')).rejects.toThrow(
        'Failed to deactivate category: system categories cannot be deactivated'
      );
    });
  });
});
