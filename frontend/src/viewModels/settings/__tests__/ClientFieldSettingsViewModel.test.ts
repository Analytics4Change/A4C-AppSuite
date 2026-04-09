import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClientFieldSettingsViewModel } from '../ClientFieldSettingsViewModel';
import type { IClientFieldService } from '@/services/client-fields/IClientFieldService';
import type {
  FieldDefinition,
  FieldCategory,
  BatchUpdateResult,
} from '@/types/client-field-settings.types';

// ── Test fixtures ──

function makeField(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    id: 'field-01',
    category_id: 'cat-01',
    category_name: 'Demographics',
    category_slug: 'demographics',
    field_key: 'middle_name',
    display_name: 'Middle Name',
    field_type: 'text',
    is_visible: true,
    is_required: false,
    validation_rules: null,
    is_dimension: false,
    sort_order: 1,
    configurable_label: null,
    conforming_dimension_mapping: null,
    is_active: true,
    ...overrides,
  };
}

const LOCKED_FIELD = makeField({
  id: 'field-locked',
  field_key: 'first_name',
  display_name: 'First Name',
  is_required: true,
  sort_order: 0,
});

const CONFIGURABLE_FIELD = makeField({
  id: 'field-cfg',
  field_key: 'middle_name',
  display_name: 'Middle Name',
  sort_order: 1,
});

const CLINICAL_FIELD = makeField({
  id: 'field-clin',
  field_key: 'primary_diagnosis',
  display_name: 'Primary Diagnosis',
  category_id: 'cat-07',
  category_name: 'Clinical',
  category_slug: 'clinical',
  sort_order: 1,
});

const SEED_FIELDS: FieldDefinition[] = [LOCKED_FIELD, CONFIGURABLE_FIELD, CLINICAL_FIELD];

const SEED_CATEGORIES: FieldCategory[] = [
  {
    id: 'cat-01',
    organization_id: null,
    name: 'Demographics',
    slug: 'demographics',
    sort_order: 1,
    is_system: true,
    is_active: true,
  },
  {
    id: 'cat-07',
    organization_id: null,
    name: 'Clinical',
    slug: 'clinical',
    sort_order: 7,
    is_system: true,
    is_active: true,
  },
];

function createMockService(overrides?: Partial<IClientFieldService>): IClientFieldService {
  return {
    listFieldDefinitions: vi.fn().mockResolvedValue(SEED_FIELDS),
    batchUpdateFieldDefinitions: vi.fn().mockResolvedValue({
      success: true,
      updated_count: 1,
      failed: [],
      correlation_id: 'test-corr-id',
    } satisfies BatchUpdateResult),
    createFieldDefinition: vi.fn().mockResolvedValue({ success: true, field_id: 'field-new' }),
    updateFieldDefinition: vi.fn().mockResolvedValue({ success: true, field_id: 'field-cfg' }),
    deactivateFieldDefinition: vi.fn().mockResolvedValue({ success: true, field_id: 'field-cfg' }),
    listFieldCategories: vi.fn().mockResolvedValue(SEED_CATEGORIES),
    createFieldCategory: vi.fn().mockResolvedValue({ success: true, category_id: 'cat-new' }),
    updateFieldCategory: vi.fn().mockResolvedValue({ success: true, category_id: 'cat-01' }),
    deactivateFieldCategory: vi.fn().mockResolvedValue({ success: true, category_id: 'cat-07' }),
    ...overrides,
  };
}

// ── Tests ──

describe('ClientFieldSettingsViewModel', () => {
  let vm: ClientFieldSettingsViewModel;
  let mockService: IClientFieldService;

  beforeEach(() => {
    mockService = createMockService();
    vm = new ClientFieldSettingsViewModel(mockService);
  });

  // ── Default state ──

  describe('default state', () => {
    it('initializes with empty arrays and no errors', () => {
      expect(vm.fieldDefinitions).toEqual([]);
      expect(vm.originalFieldDefinitions).toEqual([]);
      expect(vm.categories).toEqual([]);
      expect(vm.activeTab).toBe('demographics');
      expect(vm.isLoading).toBe(false);
      expect(vm.isSaving).toBe(false);
      expect(vm.loadError).toBeNull();
      expect(vm.saveError).toBeNull();
      expect(vm.saveSuccess).toBe(false);
      expect(vm.reason).toBe('');
    });

    it('has no changes and cannot save', () => {
      expect(vm.hasChanges).toBe(false);
      expect(vm.canSave).toBe(false);
    });

    it('custom field/category creation state is idle', () => {
      expect(vm.isCreatingField).toBe(false);
      expect(vm.createFieldError).toBeNull();
      expect(vm.isCreatingCategory).toBe(false);
      expect(vm.createCategoryError).toBeNull();
    });
  });

  // ── loadData ──

  describe('loadData', () => {
    it('loads field definitions and categories', async () => {
      await vm.loadData('org-123');

      expect(mockService.listFieldDefinitions).toHaveBeenCalled();
      expect(mockService.listFieldCategories).toHaveBeenCalled();
      expect(vm.fieldDefinitions).toHaveLength(3);
      expect(vm.categories).toHaveLength(2);
      expect(vm.isLoading).toBe(false);
      expect(vm.loadError).toBeNull();
    });

    it('deep-copies fields into originalFieldDefinitions', async () => {
      await vm.loadData('org-123');

      expect(vm.originalFieldDefinitions).toEqual(vm.fieldDefinitions);
      // Must be separate objects (deep copy)
      expect(vm.originalFieldDefinitions[0]).not.toBe(vm.fieldDefinitions[0]);
    });

    it('clears reason and saveSuccess on load', async () => {
      vm.setReason('some reason text here');
      await vm.loadData('org-123');

      expect(vm.reason).toBe('');
      expect(vm.saveSuccess).toBe(false);
    });

    it('handles load error', async () => {
      const failService = createMockService({
        listFieldDefinitions: vi.fn().mockRejectedValue(new Error('Network error')),
      });
      vm = new ClientFieldSettingsViewModel(failService);

      await vm.loadData('org-123');

      expect(vm.loadError).toBe('Network error');
      expect(vm.isLoading).toBe(false);
      expect(vm.fieldDefinitions).toEqual([]);
    });

    it('uses generic message for non-Error throws', async () => {
      const failService = createMockService({
        listFieldDefinitions: vi.fn().mockRejectedValue('string error'),
      });
      vm = new ClientFieldSettingsViewModel(failService);

      await vm.loadData('org-123');

      expect(vm.loadError).toBe('Failed to load settings');
    });
  });

  // ── Computed: fieldsByCategory ──

  describe('fieldsByCategory', () => {
    beforeEach(async () => {
      await vm.loadData('org-123');
    });

    it('groups fields by category_slug', () => {
      const map = vm.fieldsByCategory;
      expect(map.get('demographics')).toHaveLength(2);
      expect(map.get('clinical')).toHaveLength(1);
    });

    it('returns empty array for unknown category', () => {
      expect(vm.fieldsByCategory.get('nonexistent')).toBeUndefined();
    });
  });

  // ── Computed: tabList ──

  describe('tabList', () => {
    beforeEach(async () => {
      await vm.loadData('org-123');
    });

    it('includes active categories plus Custom Fields and Categories tabs', () => {
      const tabs = vm.tabList;
      expect(tabs).toHaveLength(4); // 2 categories + custom_fields + categories
      expect(tabs[0]).toEqual({ slug: 'demographics', name: 'Demographics' });
      expect(tabs[1]).toEqual({ slug: 'clinical', name: 'Clinical' });
      expect(tabs[2]).toEqual({ slug: 'custom_fields', name: 'Custom Fields' });
      expect(tabs[3]).toEqual({ slug: 'categories', name: 'Categories' });
    });

    it('excludes inactive categories', async () => {
      const categoriesWithInactive: FieldCategory[] = [
        ...SEED_CATEGORIES,
        {
          id: 'cat-inactive',
          organization_id: 'org-123',
          name: 'Inactive',
          slug: 'inactive',
          sort_order: 99,
          is_system: false,
          is_active: false,
        },
      ];
      const svc = createMockService({
        listFieldCategories: vi.fn().mockResolvedValue(categoriesWithInactive),
      });
      vm = new ClientFieldSettingsViewModel(svc);
      await vm.loadData('org-123');

      const slugs = vm.tabList.map((t) => t.slug);
      expect(slugs).not.toContain('inactive');
    });
  });

  // ── Computed: configurableFieldCount ──

  describe('configurableFieldCount', () => {
    beforeEach(async () => {
      await vm.loadData('org-123');
    });

    it('counts non-locked fields in the active tab', () => {
      vm.setActiveTab('demographics');
      // demographics has 2 fields: first_name (locked) + middle_name (configurable)
      expect(vm.configurableFieldCount).toBe(1);
    });

    it('returns 0 for tab with no fields', () => {
      vm.setActiveTab('custom_fields');
      expect(vm.configurableFieldCount).toBe(0);
    });
  });

  // ── Actions: setActiveTab ──

  describe('setActiveTab', () => {
    it('updates the active tab', () => {
      vm.setActiveTab('clinical');
      expect(vm.activeTab).toBe('clinical');
    });
  });

  // ── Actions: toggleVisible ──

  describe('toggleVisible', () => {
    beforeEach(async () => {
      await vm.loadData('org-123');
    });

    it('toggles is_visible on the target field', () => {
      expect(vm.fieldDefinitions.find((f) => f.id === 'field-cfg')!.is_visible).toBe(true);
      vm.toggleVisible('field-cfg');
      expect(vm.fieldDefinitions.find((f) => f.id === 'field-cfg')!.is_visible).toBe(false);
    });

    it('unchecks is_required when hiding a field', () => {
      // Make field required first
      vm.toggleRequired('field-cfg');
      expect(vm.fieldDefinitions.find((f) => f.id === 'field-cfg')!.is_required).toBe(true);

      // Hide the field
      vm.toggleVisible('field-cfg');
      expect(vm.fieldDefinitions.find((f) => f.id === 'field-cfg')!.is_visible).toBe(false);
      expect(vm.fieldDefinitions.find((f) => f.id === 'field-cfg')!.is_required).toBe(false);
    });

    it('preserves is_required when showing a field', () => {
      // Hide first, then show — required stays false
      vm.toggleVisible('field-cfg'); // hide
      vm.toggleVisible('field-cfg'); // show
      expect(vm.fieldDefinitions.find((f) => f.id === 'field-cfg')!.is_required).toBe(false);
    });

    it('clears saveSuccess', async () => {
      // Simulate a save cycle to set saveSuccess
      vm.toggleVisible('field-cfg');
      vm.setReason('Valid reason text');
      await vm.saveChanges('org-123');
      expect(vm.saveSuccess).toBe(true);

      vm.toggleVisible('field-cfg');
      expect(vm.saveSuccess).toBe(false);
    });

    it('does nothing for unknown field id', () => {
      const before = vm.fieldDefinitions.map((f) => ({ ...f }));
      vm.toggleVisible('nonexistent');
      expect(vm.fieldDefinitions).toEqual(before);
    });
  });

  // ── Actions: toggleRequired ──

  describe('toggleRequired', () => {
    beforeEach(async () => {
      await vm.loadData('org-123');
    });

    it('toggles is_required on the target field', () => {
      vm.toggleRequired('field-cfg');
      expect(vm.fieldDefinitions.find((f) => f.id === 'field-cfg')!.is_required).toBe(true);
      vm.toggleRequired('field-cfg');
      expect(vm.fieldDefinitions.find((f) => f.id === 'field-cfg')!.is_required).toBe(false);
    });
  });

  // ── Actions: setLabel ──

  describe('setLabel', () => {
    beforeEach(async () => {
      await vm.loadData('org-123');
    });

    it('sets configurable_label', () => {
      vm.setLabel('field-cfg', 'Custom Label');
      expect(vm.fieldDefinitions.find((f) => f.id === 'field-cfg')!.configurable_label).toBe(
        'Custom Label'
      );
    });

    it('sets configurable_label to null when empty string', () => {
      vm.setLabel('field-cfg', 'Custom');
      vm.setLabel('field-cfg', '');
      expect(vm.fieldDefinitions.find((f) => f.id === 'field-cfg')!.configurable_label).toBeNull();
    });
  });

  // ── Reason validation ──

  describe('reason validation', () => {
    it('isReasonValid is false for empty', () => {
      expect(vm.isReasonValid).toBe(false);
    });

    it('isReasonValid is false for under 10 chars', () => {
      vm.setReason('short');
      expect(vm.isReasonValid).toBe(false);
    });

    it('isReasonValid is true for 10+ chars', () => {
      vm.setReason('Valid reason text');
      expect(vm.isReasonValid).toBe(true);
    });

    it('isReasonValid trims whitespace', () => {
      vm.setReason('          ');
      expect(vm.isReasonValid).toBe(false);
    });
  });

  // ── Change tracking ──

  describe('changedFields', () => {
    beforeEach(async () => {
      await vm.loadData('org-123');
    });

    it('detects visibility change', () => {
      vm.toggleVisible('field-cfg');
      const changes = vm.changedFields;
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({ field_id: 'field-cfg', is_visible: false });
    });

    it('detects required change', () => {
      vm.toggleRequired('field-cfg');
      const changes = vm.changedFields;
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({ field_id: 'field-cfg', is_required: true });
    });

    it('detects label change', () => {
      vm.setLabel('field-cfg', 'Custom');
      const changes = vm.changedFields;
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({ field_id: 'field-cfg', configurable_label: 'Custom' });
    });

    it('ignores locked fields', () => {
      vm.toggleVisible('field-locked');
      // The toggle still mutates the field, but changedFields skips locked keys
      const changes = vm.changedFields;
      expect(changes).toEqual([]);
    });

    it('detects multiple changes on same field', () => {
      vm.toggleVisible('field-cfg'); // hide (also unchecks required, but was already false)
      vm.setLabel('field-cfg', 'Renamed');
      const changes = vm.changedFields;
      expect(changes).toHaveLength(1);
      expect(changes[0].is_visible).toBe(false);
      expect(changes[0].configurable_label).toBe('Renamed');
    });

    it('returns empty when toggled back to original', () => {
      vm.toggleVisible('field-cfg');
      vm.toggleVisible('field-cfg');
      expect(vm.changedFields).toEqual([]);
    });
  });

  // ── canSave ──

  describe('canSave', () => {
    beforeEach(async () => {
      await vm.loadData('org-123');
    });

    it('is false with no changes', () => {
      vm.setReason('Valid reason text');
      expect(vm.canSave).toBe(false);
    });

    it('is false with changes but no reason', () => {
      vm.toggleVisible('field-cfg');
      expect(vm.canSave).toBe(false);
    });

    it('is true with changes and valid reason', () => {
      vm.toggleVisible('field-cfg');
      vm.setReason('Hiding middle name field');
      expect(vm.canSave).toBe(true);
    });
  });

  // ── saveChanges ──

  describe('saveChanges', () => {
    beforeEach(async () => {
      await vm.loadData('org-123');
      vm.toggleVisible('field-cfg');
      vm.setReason('Hiding middle name field');
    });

    it('saves successfully and reloads', async () => {
      const result = await vm.saveChanges('org-123');

      expect(result).toBe(true);
      expect(mockService.batchUpdateFieldDefinitions).toHaveBeenCalledWith(
        [{ field_id: 'field-cfg', is_visible: false }],
        'Hiding middle name field',
        expect.any(String)
      );
      expect(vm.isSaving).toBe(false);
      expect(vm.saveSuccess).toBe(true);
      expect(vm.reason).toBe('');
      // listFieldDefinitions called twice: initial load + reload after save
      expect(mockService.listFieldDefinitions).toHaveBeenCalledTimes(2);
    });

    it('returns false when canSave is false', async () => {
      const freshVm = new ClientFieldSettingsViewModel(mockService);
      const result = await freshVm.saveChanges('org-123');
      expect(result).toBe(false);
    });

    it('handles batch update failure', async () => {
      const failService = createMockService({
        batchUpdateFieldDefinitions: vi
          .fn()
          .mockResolvedValue({ success: false, updated_count: 0, failed: [], correlation_id: '' }),
      });
      vm = new ClientFieldSettingsViewModel(failService);
      await vm.loadData('org-123');
      vm.toggleVisible('field-cfg');
      vm.setReason('Hiding middle name field');

      const result = await vm.saveChanges('org-123');

      expect(result).toBe(false);
      expect(vm.saveError).toBe('Batch update failed');
      expect(vm.isSaving).toBe(false);
    });

    it('handles network error', async () => {
      const failService = createMockService({
        batchUpdateFieldDefinitions: vi.fn().mockRejectedValue(new Error('Permission denied')),
      });
      vm = new ClientFieldSettingsViewModel(failService);
      await vm.loadData('org-123');
      vm.toggleVisible('field-cfg');
      vm.setReason('Hiding middle name field');

      const result = await vm.saveChanges('org-123');

      expect(result).toBe(false);
      expect(vm.saveError).toBe('Permission denied');
      expect(vm.isSaving).toBe(false);
      expect(vm.saveSuccess).toBe(false);
    });

    it('succeeds with partial failures (some fields fail)', async () => {
      const partialService = createMockService({
        batchUpdateFieldDefinitions: vi.fn().mockResolvedValue({
          success: true,
          updated_count: 0,
          failed: [{ field_id: 'field-cfg', error: 'Field locked' }],
          correlation_id: 'test-corr',
        } satisfies BatchUpdateResult),
      });
      vm = new ClientFieldSettingsViewModel(partialService);
      await vm.loadData('org-123');
      vm.toggleVisible('field-cfg');
      vm.setReason('Hiding middle name field');

      const result = await vm.saveChanges('org-123');

      // The VM treats success=true as success even with partial failures
      expect(result).toBe(true);
      expect(vm.saveSuccess).toBe(true);
    });
  });

  // ── resetChanges ──

  describe('resetChanges', () => {
    beforeEach(async () => {
      await vm.loadData('org-123');
    });

    it('reverts fields to original state', () => {
      vm.toggleVisible('field-cfg');
      vm.setLabel('field-cfg', 'Custom');
      vm.setReason('some reason for change');
      expect(vm.hasChanges).toBe(true);

      vm.resetChanges();

      expect(vm.hasChanges).toBe(false);
      expect(vm.reason).toBe('');
      expect(vm.fieldDefinitions.find((f) => f.id === 'field-cfg')!.is_visible).toBe(true);
      expect(vm.fieldDefinitions.find((f) => f.id === 'field-cfg')!.configurable_label).toBeNull();
    });

    it('clears errors and success', () => {
      vm.resetChanges();
      expect(vm.saveError).toBeNull();
      expect(vm.saveSuccess).toBe(false);
    });

    it('deep-copies original so further edits are independent', () => {
      vm.resetChanges();
      vm.toggleVisible('field-cfg');
      // Original should still show visible
      expect(vm.originalFieldDefinitions.find((f) => f.id === 'field-cfg')!.is_visible).toBe(true);
    });
  });

  // ── Custom field CRUD ──

  describe('createCustomField', () => {
    beforeEach(async () => {
      await vm.loadData('org-123');
    });

    it('creates successfully and reloads', async () => {
      const result = await vm.createCustomField(
        { field_key: 'custom_1', display_name: 'Custom 1', category_id: 'cat-01' },
        'org-123'
      );

      expect(result).toBe(true);
      expect(mockService.createFieldDefinition).toHaveBeenCalledWith(
        {
          field_key: 'custom_1',
          display_name: 'Custom 1',
          category_id: 'cat-01',
        },
        expect.any(String)
      );
      expect(vm.isCreatingField).toBe(false);
      // Reloaded
      expect(mockService.listFieldDefinitions).toHaveBeenCalledTimes(2);
    });

    it('handles service returning failure', async () => {
      const failService = createMockService({
        createFieldDefinition: vi
          .fn()
          .mockResolvedValue({ success: false, error: 'Duplicate key' }),
      });
      vm = new ClientFieldSettingsViewModel(failService);
      await vm.loadData('org-123');

      const result = await vm.createCustomField(
        { field_key: 'dup', display_name: 'Dup', category_id: 'cat-01' },
        'org-123'
      );

      expect(result).toBe(false);
      expect(vm.createFieldError).toBe('Duplicate key');
      expect(vm.isCreatingField).toBe(false);
    });

    it('handles exception', async () => {
      const failService = createMockService({
        createFieldDefinition: vi.fn().mockRejectedValue(new Error('Server error')),
      });
      vm = new ClientFieldSettingsViewModel(failService);
      await vm.loadData('org-123');

      const result = await vm.createCustomField(
        { field_key: 'x', display_name: 'X', category_id: 'cat-01' },
        'org-123'
      );

      expect(result).toBe(false);
      expect(vm.createFieldError).toBe('Server error');
    });
  });

  describe('deactivateCustomField', () => {
    beforeEach(async () => {
      await vm.loadData('org-123');
    });

    it('deactivates and reloads', async () => {
      const result = await vm.deactivateCustomField('field-cfg', 'No longer needed', 'org-123');

      expect(result).toBe(true);
      expect(mockService.deactivateFieldDefinition).toHaveBeenCalledWith(
        'field-cfg',
        'No longer needed',
        expect.any(String)
      );
      expect(mockService.listFieldDefinitions).toHaveBeenCalledTimes(2);
    });

    it('returns false on service failure', async () => {
      const failService = createMockService({
        deactivateFieldDefinition: vi
          .fn()
          .mockResolvedValue({ success: false, error: 'Not found' }),
      });
      vm = new ClientFieldSettingsViewModel(failService);
      await vm.loadData('org-123');

      const result = await vm.deactivateCustomField('field-cfg', 'reason', 'org-123');
      expect(result).toBe(false);
    });

    it('returns false on exception', async () => {
      const failService = createMockService({
        deactivateFieldDefinition: vi.fn().mockRejectedValue(new Error('fail')),
      });
      vm = new ClientFieldSettingsViewModel(failService);
      await vm.loadData('org-123');

      const result = await vm.deactivateCustomField('field-cfg', 'reason', 'org-123');
      expect(result).toBe(false);
    });
  });

  // ── Category CRUD ──

  describe('createCategory', () => {
    beforeEach(async () => {
      await vm.loadData('org-123');
    });

    it('creates successfully and reloads', async () => {
      const result = await vm.createCategory('Custom Cat', 'custom_cat', 'org-123');

      expect(result).toBe(true);
      expect(mockService.createFieldCategory).toHaveBeenCalledWith(
        'Custom Cat',
        'custom_cat',
        undefined,
        expect.any(String)
      );
      expect(vm.isCreatingCategory).toBe(false);
      expect(mockService.listFieldCategories).toHaveBeenCalledTimes(2);
    });

    it('handles service returning failure', async () => {
      const failService = createMockService({
        createFieldCategory: vi
          .fn()
          .mockResolvedValue({ success: false, error: 'Slug already exists' }),
      });
      vm = new ClientFieldSettingsViewModel(failService);
      await vm.loadData('org-123');

      const result = await vm.createCategory('Dup', 'dup', 'org-123');

      expect(result).toBe(false);
      expect(vm.createCategoryError).toBe('Slug already exists');
      expect(vm.isCreatingCategory).toBe(false);
    });

    it('handles exception', async () => {
      const failService = createMockService({
        createFieldCategory: vi.fn().mockRejectedValue(new Error('Network timeout')),
      });
      vm = new ClientFieldSettingsViewModel(failService);
      await vm.loadData('org-123');

      const result = await vm.createCategory('Cat', 'cat', 'org-123');

      expect(result).toBe(false);
      expect(vm.createCategoryError).toBe('Network timeout');
    });
  });

  describe('deactivateCategory', () => {
    beforeEach(async () => {
      await vm.loadData('org-123');
    });

    it('deactivates and reloads', async () => {
      const result = await vm.deactivateCategory('cat-07', 'Removing clinical', 'org-123');

      expect(result).toBe(true);
      expect(mockService.deactivateFieldCategory).toHaveBeenCalledWith(
        'cat-07',
        'Removing clinical',
        expect.any(String)
      );
      expect(mockService.listFieldCategories).toHaveBeenCalledTimes(2);
    });

    it('returns false on service failure', async () => {
      const failService = createMockService({
        deactivateFieldCategory: vi
          .fn()
          .mockResolvedValue({ success: false, error: 'System category' }),
      });
      vm = new ClientFieldSettingsViewModel(failService);
      await vm.loadData('org-123');

      const result = await vm.deactivateCategory('cat-01', 'reason', 'org-123');
      expect(result).toBe(false);
    });

    it('returns false on exception', async () => {
      const failService = createMockService({
        deactivateFieldCategory: vi.fn().mockRejectedValue(new Error('fail')),
      });
      vm = new ClientFieldSettingsViewModel(failService);
      await vm.loadData('org-123');

      const result = await vm.deactivateCategory('cat-01', 'reason', 'org-123');
      expect(result).toBe(false);
    });
  });

  // ── Preserve pending changes across CRUD reloads ──

  describe('preserveChanges', () => {
    it('createCategory preserves pending field definition changes', async () => {
      await vm.loadData('org-123');
      vm.toggleVisible('field-cfg'); // flip middle_name visibility
      vm.setReason('Testing reason for save');
      expect(vm.hasChanges).toBe(true);

      await vm.createCategory('New', 'new', 'org-123');

      // Pending changes should survive the reload
      expect(vm.hasChanges).toBe(true);
      expect(vm.changedFields).toHaveLength(1);
      expect(vm.changedFields[0].field_id).toBe('field-cfg');
      expect(vm.changedFields[0].is_visible).toBe(false);
      expect(vm.reason).toBe('Testing reason for save');
    });

    it('createCustomField preserves pending changes', async () => {
      await vm.loadData('org-123');
      vm.toggleRequired('field-cfg');
      expect(vm.hasChanges).toBe(true);

      await vm.createCustomField(
        {
          field_key: 'custom_test',
          display_name: 'Custom Test',
          field_type: 'text',
          category_id: 'cat-01',
        },
        'org-123'
      );

      expect(vm.hasChanges).toBe(true);
      expect(vm.changedFields[0].is_required).toBe(true);
    });

    it('deactivateCustomField drops changes for deactivated field, preserves others', async () => {
      // After deactivation, mock returns only LOCKED_FIELD and CLINICAL_FIELD
      const svc = createMockService();
      let callCount = 0;
      (svc.listFieldDefinitions as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        // First call: all fields. Second call (after deactivate): field-cfg removed
        if (callCount === 1) return Promise.resolve(SEED_FIELDS);
        return Promise.resolve([LOCKED_FIELD, CLINICAL_FIELD]);
      });
      vm = new ClientFieldSettingsViewModel(svc);
      await vm.loadData('org-123');

      // Toggle both configurable fields
      vm.toggleVisible('field-cfg');
      vm.toggleVisible('field-clin');
      expect(vm.changedFields).toHaveLength(2);

      // Deactivate field-cfg
      await vm.deactivateCustomField('field-cfg', 'no longer needed', 'org-123');

      // field-cfg change dropped (field gone), field-clin change preserved
      expect(vm.changedFields).toHaveLength(1);
      expect(vm.changedFields[0].field_id).toBe('field-clin');
    });

    it('reason is preserved across CRUD reload', async () => {
      await vm.loadData('org-123');
      vm.toggleVisible('field-cfg');
      vm.setReason('Important audit reason');

      await vm.createCategory('Another', 'another', 'org-123');

      expect(vm.reason).toBe('Important audit reason');
    });

    it('saveChanges does NOT preserve pending changes (clean slate)', async () => {
      await vm.loadData('org-123');
      vm.toggleVisible('field-cfg');
      vm.setReason('A valid reason for the change');
      expect(vm.hasChanges).toBe(true);

      await vm.saveChanges('org-123');

      expect(vm.hasChanges).toBe(false);
      expect(vm.reason).toBe('');
      expect(vm.saveSuccess).toBe(true);
    });
  });

  // ── Session correlation ID ──

  describe('sessionCorrelationId', () => {
    it('shares the same correlation ID across CRUD operations and save', async () => {
      await vm.loadData('org-123');

      // First CRUD operation lazily creates the session ID
      await vm.createCategory('Cat1', 'cat1', 'org-123');
      const firstCallArgs = (mockService.createFieldCategory as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const sessionId = firstCallArgs[3]; // correlationId is 4th arg
      expect(sessionId).toBeTruthy();

      // Second CRUD operation reuses the same session ID
      await vm.createCustomField(
        {
          field_key: 'custom_x',
          display_name: 'Custom X',
          field_type: 'text',
          category_id: 'cat-01',
        },
        'org-123'
      );
      const secondCallArgs = (mockService.createFieldDefinition as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const secondId = secondCallArgs[1]; // correlationId is 2nd arg
      expect(secondId).toBe(sessionId);

      // Batch save also uses the same session ID
      vm.toggleVisible('field-cfg');
      vm.setReason('A valid reason for the change');
      await vm.saveChanges('org-123');
      const saveCallArgs = (mockService.batchUpdateFieldDefinitions as ReturnType<typeof vi.fn>)
        .mock.calls[0];
      const saveId = saveCallArgs[2]; // correlationId is 3rd arg
      expect(saveId).toBe(sessionId);
    });

    it('resets after saveChanges succeeds', async () => {
      await vm.loadData('org-123');
      await vm.createCategory('Cat1', 'cat1', 'org-123');

      const firstSessionId = vm.sessionCorrelationId;
      expect(firstSessionId).toBeTruthy();

      vm.toggleVisible('field-cfg');
      vm.setReason('A valid reason for the change');
      await vm.saveChanges('org-123');

      expect(vm.sessionCorrelationId).toBeNull();

      // Next operation gets a new session ID
      await vm.createCategory('Cat2', 'cat2', 'org-123');
      expect(vm.sessionCorrelationId).toBeTruthy();
      expect(vm.sessionCorrelationId).not.toBe(firstSessionId);
    });

    it('resets on resetChanges', async () => {
      await vm.loadData('org-123');
      await vm.createCategory('Cat1', 'cat1', 'org-123');
      expect(vm.sessionCorrelationId).toBeTruthy();

      vm.resetChanges();
      expect(vm.sessionCorrelationId).toBeNull();
    });
  });
});
