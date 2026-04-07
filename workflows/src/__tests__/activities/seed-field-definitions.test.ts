/**
 * SeedFieldDefinitions Activity Tests
 *
 * Tests for seedFieldDefinitions and deleteFieldDefinitions activity functions.
 * Covers idempotency, error handling, event emission, and category mapping.
 */

import { seedFieldDefinitions, deleteFieldDefinitions } from '@activities/organization-bootstrap/seed-field-definitions';

// Mock shared utils — must precede module import resolution
jest.mock('@shared/utils', () => ({
  getSupabaseClient: jest.fn(),
  getLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('@shared/utils/emit-event', () => ({
  emitEvent: jest.fn()
}));

// Import mocked items after jest.mock declarations
import { getSupabaseClient } from '@shared/utils';
import { emitEvent } from '@shared/utils/emit-event';

// --- Supabase mock helpers ---

const mockRpc = jest.fn();
const mockSchema = jest.fn().mockReturnValue({ rpc: mockRpc });
const mockSupabase = { schema: mockSchema };

// --- Fixtures ---

const ORG_ID = 'org-uuid-1234';

const TEMPLATE_A = {
  field_key: 'first_name',
  category_slug: 'demographics',
  display_name: 'First Name',
  field_type: 'text',
  is_visible: true,
  is_required: true,
  is_dimension: false,
  sort_order: 1,
  configurable_label: null,
  conforming_dimension_mapping: null
};

const TEMPLATE_B = {
  field_key: 'dob',
  category_slug: 'demographics',
  display_name: 'Date of Birth',
  field_type: 'date',
  is_visible: true,
  is_required: false,
  is_dimension: false,
  sort_order: 2,
  configurable_label: null,
  conforming_dimension_mapping: null
};

const TEMPLATE_UNKNOWN_CAT = {
  field_key: 'mystery_field',
  category_slug: 'nonexistent-cat',
  display_name: 'Mystery',
  field_type: 'text',
  is_visible: true,
  is_required: false,
  is_dimension: false,
  sort_order: 99,
  configurable_label: null,
  conforming_dimension_mapping: null
};

const CATEGORY_DEMOGRAPHICS = { id: 'cat-uuid-demographics', slug: 'demographics' };
const CATEGORY_CLINICAL = { id: 'cat-uuid-clinical', slug: 'clinical' };

// --- Setup ---

beforeEach(() => {
  jest.clearAllMocks();
  (getSupabaseClient as jest.Mock).mockReturnValue(mockSupabase);

  // Default: schema('api') always returns { rpc }
  mockSchema.mockReturnValue({ rpc: mockRpc });
});

// ============================================================
// seedFieldDefinitions
// ============================================================

describe('seedFieldDefinitions', () => {

  describe('idempotency guard', () => {
    it('returns { alreadySeeded: true, definitionsSeeded: 0 } when check_field_definitions_exist returns true', async () => {
      mockRpc.mockResolvedValueOnce({ data: true, error: null }); // check_field_definitions_exist

      const result = await seedFieldDefinitions({ orgId: ORG_ID });

      expect(result).toEqual({ alreadySeeded: true, definitionsSeeded: 0 });
      // Should not proceed to fetch templates
      expect(mockRpc).toHaveBeenCalledTimes(1);
      expect(emitEvent).not.toHaveBeenCalled();
    });
  });

  describe('empty / null templates', () => {
    it('returns { alreadySeeded: false, definitionsSeeded: 0 } when templates array is empty', async () => {
      mockRpc
        .mockResolvedValueOnce({ data: false, error: null })   // check_field_definitions_exist
        .mockResolvedValueOnce({ data: [], error: null });      // list_field_definition_templates

      const result = await seedFieldDefinitions({ orgId: ORG_ID });

      expect(result).toEqual({ alreadySeeded: false, definitionsSeeded: 0 });
      expect(emitEvent).not.toHaveBeenCalled();
    });

    it('returns { alreadySeeded: false, definitionsSeeded: 0 } when templates is null', async () => {
      mockRpc
        .mockResolvedValueOnce({ data: false, error: null })   // check_field_definitions_exist
        .mockResolvedValueOnce({ data: null, error: null });   // list_field_definition_templates

      const result = await seedFieldDefinitions({ orgId: ORG_ID });

      expect(result).toEqual({ alreadySeeded: false, definitionsSeeded: 0 });
      expect(emitEvent).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('throws when check_field_definitions_exist RPC fails', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'DB connection timeout' } });

      await expect(seedFieldDefinitions({ orgId: ORG_ID })).rejects.toThrow(
        'Failed to check existing field definitions: DB connection timeout'
      );
    });

    it('throws when list_field_definition_templates RPC fails', async () => {
      mockRpc
        .mockResolvedValueOnce({ data: false, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: 'templates table missing' } });

      await expect(seedFieldDefinitions({ orgId: ORG_ID })).rejects.toThrow(
        'Failed to load field definition templates: templates table missing'
      );
    });

    it('throws when list_system_field_categories RPC fails', async () => {
      mockRpc
        .mockResolvedValueOnce({ data: false, error: null })
        .mockResolvedValueOnce({ data: [TEMPLATE_A], error: null })
        .mockResolvedValueOnce({ data: null, error: { message: 'categories unavailable' } });

      await expect(seedFieldDefinitions({ orgId: ORG_ID })).rejects.toThrow(
        'Failed to load field categories: categories unavailable'
      );
    });
  });

  describe('happy path — event emission', () => {
    it('emits one client_field_definition.created event per template (2 templates → 2 events)', async () => {
      const FIXED_FIELD_ID_1 = 'field-uuid-0001';
      const FIXED_FIELD_ID_2 = 'field-uuid-0002';
      const FIXED_CORRELATION_ID = 'corr-uuid-0001';

      // randomUUID: first call → correlationId, subsequent → fieldId per template
      const randomUUIDSpy = jest
        .spyOn(crypto, 'randomUUID')
        .mockReturnValueOnce(FIXED_CORRELATION_ID as `${string}-${string}-${string}-${string}-${string}`)
        .mockReturnValueOnce(FIXED_FIELD_ID_1 as `${string}-${string}-${string}-${string}-${string}`)
        .mockReturnValueOnce(FIXED_FIELD_ID_2 as `${string}-${string}-${string}-${string}-${string}`);

      mockRpc
        .mockResolvedValueOnce({ data: false, error: null })
        .mockResolvedValueOnce({ data: [TEMPLATE_A, TEMPLATE_B], error: null })
        .mockResolvedValueOnce({ data: [CATEGORY_DEMOGRAPHICS, CATEGORY_CLINICAL], error: null });

      (emitEvent as jest.Mock).mockResolvedValue(undefined);

      const result = await seedFieldDefinitions({ orgId: ORG_ID });

      expect(result).toEqual({ alreadySeeded: false, definitionsSeeded: 2 });
      expect(emitEvent).toHaveBeenCalledTimes(2);

      // First event
      expect(emitEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
        event_type: 'client_field_definition.created',
        aggregate_type: 'client_field_definition',
        aggregate_id: FIXED_FIELD_ID_1,
        correlation_id: FIXED_CORRELATION_ID,
        user_id: 'system',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        event_data: expect.objectContaining({
          field_id: FIXED_FIELD_ID_1,
          organization_id: ORG_ID,
          category_id: CATEGORY_DEMOGRAPHICS.id,
          field_key: TEMPLATE_A.field_key,
          display_name: TEMPLATE_A.display_name,
          field_type: TEMPLATE_A.field_type
        })
      }));

      // Second event
      expect(emitEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
        event_type: 'client_field_definition.created',
        aggregate_id: FIXED_FIELD_ID_2,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        event_data: expect.objectContaining({
          field_id: FIXED_FIELD_ID_2,
          field_key: TEMPLATE_B.field_key
        })
      }));

      randomUUIDSpy.mockRestore();
    });

    it('skips templates whose category_slug has no matching category (1 matched + 1 unmatched = 1 event)', async () => {
      mockRpc
        .mockResolvedValueOnce({ data: false, error: null })
        .mockResolvedValueOnce({ data: [TEMPLATE_A, TEMPLATE_UNKNOWN_CAT], error: null })
        .mockResolvedValueOnce({ data: [CATEGORY_DEMOGRAPHICS], error: null });

      (emitEvent as jest.Mock).mockResolvedValue(undefined);

      const result = await seedFieldDefinitions({ orgId: ORG_ID });

      expect(result).toEqual({ alreadySeeded: false, definitionsSeeded: 1 });
      expect(emitEvent).toHaveBeenCalledTimes(1);
      expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        event_data: expect.objectContaining({ field_key: TEMPLATE_A.field_key })
      }));
    });
  });

  describe('correlation ID handling', () => {
    it('uses tracing.correlationId when provided instead of generating a new UUID', async () => {
      const PROVIDED_CORRELATION_ID = 'provided-corr-uuid-9999';
      const randomUUIDSpy = jest.spyOn(crypto, 'randomUUID');

      mockRpc
        .mockResolvedValueOnce({ data: false, error: null })
        .mockResolvedValueOnce({ data: [TEMPLATE_A], error: null })
        .mockResolvedValueOnce({ data: [CATEGORY_DEMOGRAPHICS], error: null });

      (emitEvent as jest.Mock).mockResolvedValue(undefined);

      await seedFieldDefinitions({
        orgId: ORG_ID,
        tracing: {
          correlationId: PROVIDED_CORRELATION_ID,
          sessionId: null,
          traceId: 'aaaabbbbccccdddd0000111122223333',
          parentSpanId: 'aabbccdd00112233'
        }
      });

      // correlationId should come from tracing, not from randomUUID
      expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
        correlation_id: PROVIDED_CORRELATION_ID
      }));

      // randomUUID should only be called for fieldId, not for correlationId
      // (i.e., not called with index 0 for correlationId)
      const uuidCalls = randomUUIDSpy.mock.calls.length;
      // With 1 template, fieldId needs 1 UUID. correlationId should NOT consume one.
      expect(uuidCalls).toBe(1);

      randomUUIDSpy.mockRestore();
    });

    it('generates a UUID for correlationId when tracing is not provided', async () => {
      const GENERATED_CORRELATION_ID = 'generated-corr-uuid-8888';
      const GENERATED_FIELD_ID = 'generated-field-uuid-7777';

      const randomUUIDSpy = jest
        .spyOn(crypto, 'randomUUID')
        .mockReturnValueOnce(GENERATED_CORRELATION_ID as `${string}-${string}-${string}-${string}-${string}`)
        .mockReturnValueOnce(GENERATED_FIELD_ID as `${string}-${string}-${string}-${string}-${string}`);

      mockRpc
        .mockResolvedValueOnce({ data: false, error: null })
        .mockResolvedValueOnce({ data: [TEMPLATE_A], error: null })
        .mockResolvedValueOnce({ data: [CATEGORY_DEMOGRAPHICS], error: null });

      (emitEvent as jest.Mock).mockResolvedValue(undefined);

      await seedFieldDefinitions({ orgId: ORG_ID });

      expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
        correlation_id: GENERATED_CORRELATION_ID
      }));

      randomUUIDSpy.mockRestore();
    });
  });

});

// ============================================================
// deleteFieldDefinitions
// ============================================================

describe('deleteFieldDefinitions', () => {

  it('calls deactivate_all_field_definitions RPC with the correct p_org_id', async () => {
    mockRpc.mockResolvedValueOnce({ data: 42, error: null });

    await deleteFieldDefinitions({ orgId: ORG_ID });

    expect(mockSchema).toHaveBeenCalledWith('api');
    expect(mockRpc).toHaveBeenCalledWith('deactivate_all_field_definitions', { p_org_id: ORG_ID });
  });

  it('throws when deactivate_all_field_definitions RPC fails', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });

    await expect(deleteFieldDefinitions({ orgId: ORG_ID })).rejects.toThrow(
      'Failed to deactivate field definitions: permission denied'
    );
  });

});
