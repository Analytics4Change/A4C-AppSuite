/**
 * SupabaseClientFieldService — helper-mock test pattern (Q2 refactor)
 *
 * Pre-refactor: this file mocked `@/lib/supabase` chain directly (`schema().rpc()`).
 * Post-refactor (PR-B Q2): mocks `supabaseService.apiRpc` / `apiRpcEnvelope` to
 * match the canonical pattern established in PR #56 (PR-A) by
 * `SupabaseUserCommandService.mapping.test.ts` and the PR-A pilot test files.
 *
 * Behavioral changes covered:
 *  - Envelope writes return `ApiEnvelope<T>` directly (no `{data, error}` wrapper)
 *  - PostgREST-level failures throw via `throwIfPostgrestError` (pre-migration
 *    contract preserved); envelope-driven failures still flow through as the
 *    typed result with `success: false`
 *  - JSON-string-data tests are obsoleted — the SDK boundary now parses envelopes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  FieldDefinition,
  FieldCategory,
  BatchUpdateResult,
  CreateFieldDefinitionParams,
  FieldDefinitionResult,
  FieldCategoryResult,
} from '@/types/client-field-settings.types';

// Hoisted spies — see SupabaseUserCommandService.mapping.test.ts for the pattern.
const { mockApiRpc, mockApiRpcEnvelope } = vi.hoisted(() => ({
  mockApiRpc: vi.fn(),
  mockApiRpcEnvelope: vi.fn(),
}));

vi.mock('@/services/auth/supabase.service', () => ({
  supabaseService: {
    apiRpc: mockApiRpc,
    apiRpcEnvelope: mockApiRpcEnvelope,
  },
}));

import { SupabaseClientFieldService } from '../SupabaseClientFieldService';

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

/** PostgREST-level failure envelope (e.g., 401, 42501). */
function postgrestFailure(message: string) {
  return {
    success: false as const,
    error: message,
    postgrestError: { code: '500', message, details: '', hint: '' },
  };
}

// ── Tests ──

describe('SupabaseClientFieldService', () => {
  let service: SupabaseClientFieldService;

  beforeEach(() => {
    mockApiRpc.mockReset();
    mockApiRpcEnvelope.mockReset();
    service = new SupabaseClientFieldService();
  });

  // ── listFieldDefinitions ── (read shape via apiRpc)

  describe('listFieldDefinitions', () => {
    it('returns field definitions on success (default: includeInactive=false)', async () => {
      mockApiRpc.mockResolvedValueOnce({ data: [FIELD_DEFINITION], error: null });

      const result = await service.listFieldDefinitions();

      expect(mockApiRpc).toHaveBeenCalledWith('list_field_definitions', {
        p_include_inactive: false,
      });
      expect(result).toEqual([FIELD_DEFINITION]);
    });

    it('passes p_include_inactive: true when requested', async () => {
      mockApiRpc.mockResolvedValueOnce({ data: [FIELD_DEFINITION], error: null });

      await service.listFieldDefinitions(true);

      expect(mockApiRpc).toHaveBeenCalledWith('list_field_definitions', {
        p_include_inactive: true,
      });
    });

    it('returns empty array when data is null', async () => {
      mockApiRpc.mockResolvedValueOnce({ data: null, error: null });

      const result = await service.listFieldDefinitions();

      expect(result).toEqual([]);
    });

    it('throws with descriptive message on apiRpc error', async () => {
      mockApiRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'permission denied for schema api' },
      });

      await expect(service.listFieldDefinitions()).rejects.toThrow(
        'Failed to fetch field definitions: permission denied for schema api'
      );
    });
  });

  // ── batchUpdateFieldDefinitions ── (envelope shape via apiRpcEnvelope)

  describe('batchUpdateFieldDefinitions', () => {
    const changes = [
      { field_id: 'field-01', is_visible: false },
      { field_id: 'field-02', is_required: true },
    ];
    const reason = 'Updating visibility for audit compliance';

    it('returns BatchUpdateResult on success', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce(BATCH_UPDATE_RESULT);

      const result = await service.batchUpdateFieldDefinitions(changes, reason);

      expect(mockApiRpcEnvelope).toHaveBeenCalledWith('batch_update_field_definitions', {
        p_changes: changes,
        p_reason: reason,
        p_correlation_id: null,
      });
      expect(result).toEqual(BATCH_UPDATE_RESULT);
    });

    it('passes changes as array (no double stringification)', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce(BATCH_UPDATE_RESULT);

      await service.batchUpdateFieldDefinitions(changes, reason);

      const callArgs = mockApiRpcEnvelope.mock.calls[0][1] as { p_changes: unknown };
      expect(callArgs.p_changes).toEqual(changes);
      expect(Array.isArray(callArgs.p_changes)).toBe(true);
      expect(typeof callArgs.p_changes).not.toBe('string');
    });

    it('throws with descriptive message on PostgREST error', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce(
        postgrestFailure('batch update failed: field not found')
      );

      await expect(service.batchUpdateFieldDefinitions(changes, reason)).rejects.toThrow(
        'Failed to batch update: batch update failed: field not found'
      );
    });
  });

  // ── createFieldDefinition ── (envelope shape)

  describe('createFieldDefinition', () => {
    it('returns RpcResult on success with all params provided', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce(RPC_SUCCESS);

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

      expect(mockApiRpcEnvelope).toHaveBeenCalledWith('create_field_definition', {
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
      mockApiRpcEnvelope.mockResolvedValueOnce(RPC_SUCCESS);

      const params: CreateFieldDefinitionParams = {
        field_key: 'custom_field',
        display_name: 'Custom Field',
        category_id: 'cat-01',
      };

      await service.createFieldDefinition(params);

      expect(mockApiRpcEnvelope).toHaveBeenCalledWith('create_field_definition', {
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
      mockApiRpcEnvelope.mockResolvedValueOnce(RPC_SUCCESS);

      await service.createFieldDefinition({
        field_key: 'f',
        display_name: 'F',
        category_id: 'cat-01',
      });

      const callArgs = mockApiRpcEnvelope.mock.calls[0][1] as { p_validation_rules: unknown };
      expect(callArgs.p_validation_rules).toBeNull();
    });

    it('throws with descriptive message on PostgREST error', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce(postgrestFailure('duplicate field key'));

      await expect(
        service.createFieldDefinition({
          field_key: 'first_name',
          display_name: 'First Name',
          category_id: 'cat-01',
        })
      ).rejects.toThrow('Failed to create field: duplicate field key');
    });

    it('returns envelope-failure shape without throwing on handler-driven failure', async () => {
      // Pre-migration: handler-returned `{success: false}` was passed through as the typed
      // result. Post-migration: same behavior — envelope failures (no postgrestError) do
      // NOT throw; the caller pattern-matches on `result.success`.
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'Field key conflict',
        errorDetails: { code: 'DUPLICATE', message: 'm' },
      });

      const result = await service.createFieldDefinition({
        field_key: 'first_name',
        display_name: 'First Name',
        category_id: 'cat-01',
      });

      expect(result.success).toBe(false);
    });
  });

  // ── deactivateFieldDefinition ──

  describe('deactivateFieldDefinition', () => {
    it('returns RpcResult on success', async () => {
      const rpcResult: FieldDefinitionResult = { success: true, field_id: 'field-01' };
      mockApiRpcEnvelope.mockResolvedValueOnce(rpcResult);

      const result = await service.deactivateFieldDefinition('field-01', 'No longer needed');

      expect(mockApiRpcEnvelope).toHaveBeenCalledWith('deactivate_field_definition', {
        p_field_id: 'field-01',
        p_reason: 'No longer needed',
        p_correlation_id: null,
      });
      expect(result).toEqual(rpcResult);
    });

    it('throws with descriptive message on PostgREST error', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce(
        postgrestFailure('field is locked and cannot be deactivated')
      );

      await expect(service.deactivateFieldDefinition('field-01', 'reason')).rejects.toThrow(
        'Failed to deactivate field: field is locked and cannot be deactivated'
      );
    });
  });

  // ── listFieldCategories ──

  describe('listFieldCategories', () => {
    it('returns field categories on success', async () => {
      mockApiRpc.mockResolvedValueOnce({ data: [FIELD_CATEGORY], error: null });

      const result = await service.listFieldCategories();

      expect(mockApiRpc).toHaveBeenCalledWith('list_field_categories', {
        p_include_inactive: false,
      });
      expect(result).toEqual([FIELD_CATEGORY]);
    });

    it('returns empty array when data is null', async () => {
      mockApiRpc.mockResolvedValueOnce({ data: null, error: null });

      const result = await service.listFieldCategories();

      expect(result).toEqual([]);
    });

    it('throws with descriptive message on apiRpc error', async () => {
      mockApiRpc.mockResolvedValueOnce({
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
      mockApiRpcEnvelope.mockResolvedValueOnce(rpcResult);

      const result = await service.createFieldCategory('Housing', 'housing', 3);

      expect(mockApiRpcEnvelope).toHaveBeenCalledWith('create_field_category', {
        p_name: 'Housing',
        p_slug: 'housing',
        p_sort_order: 3,
        p_correlation_id: null,
      });
      expect(result).toEqual(rpcResult);
    });

    it('defaults sortOrder to 0 when not provided', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({ success: true });

      await service.createFieldCategory('Housing', 'housing');

      expect(mockApiRpcEnvelope).toHaveBeenCalledWith('create_field_category', {
        p_name: 'Housing',
        p_slug: 'housing',
        p_sort_order: 0,
        p_correlation_id: null,
      });
    });

    it('throws with descriptive message on PostgREST error', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce(postgrestFailure('slug already exists'));

      await expect(service.createFieldCategory('Demographics', 'demographics')).rejects.toThrow(
        'Failed to create category: slug already exists'
      );
    });
  });

  // ── deactivateFieldCategory ──

  describe('deactivateFieldCategory', () => {
    it('returns RpcResult on success', async () => {
      const rpcResult: FieldCategoryResult = { success: true, category_id: 'cat-01' };
      mockApiRpcEnvelope.mockResolvedValueOnce(rpcResult);

      const result = await service.deactivateFieldCategory('cat-01', 'Category merged into other');

      expect(mockApiRpcEnvelope).toHaveBeenCalledWith('deactivate_field_category', {
        p_category_id: 'cat-01',
        p_reason: 'Category merged into other',
        p_correlation_id: null,
      });
      expect(result).toEqual(rpcResult);
    });

    it('throws with descriptive message on PostgREST error', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce(
        postgrestFailure('system categories cannot be deactivated')
      );

      await expect(service.deactivateFieldCategory('cat-01', 'reason')).rejects.toThrow(
        'Failed to deactivate category: system categories cannot be deactivated'
      );
    });
  });

  // ── getFieldUsageCount ── (envelope shape but returns {success, count} contract)

  describe('getFieldUsageCount', () => {
    it('returns success + count on envelope success', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({ success: true, count: 7 });

      const result = await service.getFieldUsageCount('first_name');

      expect(result).toEqual({ success: true, count: 7 });
    });

    it('returns {success: false, count: 0} on envelope failure (does NOT throw)', async () => {
      // Unlike other envelope methods, get_field_usage_count returns a soft-failure
      // contract for use in UI dialogs (count widgets cannot disrupt the page).
      mockApiRpcEnvelope.mockResolvedValueOnce(postgrestFailure('relation missing'));

      const result = await service.getFieldUsageCount('first_name');

      expect(result).toEqual({ success: false, count: 0 });
    });
  });
});
