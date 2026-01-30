import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DirectCareSettingsViewModel } from '../DirectCareSettingsViewModel';
import type { IDirectCareSettingsService } from '@/services/direct-care/IDirectCareSettingsService';
import type { DirectCareSettings } from '@/types/direct-care-settings.types';

function createMockService(
  overrides?: Partial<IDirectCareSettingsService>
): IDirectCareSettingsService {
  return {
    getSettings: vi.fn().mockResolvedValue({
      enable_staff_client_mapping: false,
      enable_schedule_enforcement: false,
    } satisfies DirectCareSettings),
    updateSettings: vi.fn().mockResolvedValue({
      enable_staff_client_mapping: true,
      enable_schedule_enforcement: false,
    } satisfies DirectCareSettings),
    ...overrides,
  };
}

describe('DirectCareSettingsViewModel', () => {
  let vm: DirectCareSettingsViewModel;
  let mockService: IDirectCareSettingsService;

  beforeEach(() => {
    mockService = createMockService();
    vm = new DirectCareSettingsViewModel(mockService);
  });

  describe('default state', () => {
    it('initializes with null settings', () => {
      expect(vm.settings).toBeNull();
      expect(vm.originalSettings).toBeNull();
      expect(vm.orgId).toBeNull();
    });

    it('initializes with no loading/saving state', () => {
      expect(vm.isLoading).toBe(false);
      expect(vm.isSaving).toBe(false);
      expect(vm.loadError).toBeNull();
      expect(vm.saveError).toBeNull();
      expect(vm.saveSuccess).toBe(false);
    });

    it('has empty reason', () => {
      expect(vm.reason).toBe('');
    });

    it('hasChanges is false', () => {
      expect(vm.hasChanges).toBe(false);
    });

    it('canSave is false', () => {
      expect(vm.canSave).toBe(false);
    });
  });

  describe('loadSettings', () => {
    it('loads settings successfully', async () => {
      await vm.loadSettings('org-123');

      expect(mockService.getSettings).toHaveBeenCalledWith('org-123');
      expect(vm.settings).toEqual({
        enable_staff_client_mapping: false,
        enable_schedule_enforcement: false,
      });
      expect(vm.originalSettings).toEqual({
        enable_staff_client_mapping: false,
        enable_schedule_enforcement: false,
      });
      expect(vm.orgId).toBe('org-123');
      expect(vm.isLoading).toBe(false);
      expect(vm.loadError).toBeNull();
    });

    it('handles load error', async () => {
      const failService = createMockService({
        getSettings: vi.fn().mockRejectedValue(new Error('Network error')),
      });
      vm = new DirectCareSettingsViewModel(failService);

      await vm.loadSettings('org-123');

      expect(vm.loadError).toBe('Network error');
      expect(vm.isLoading).toBe(false);
      expect(vm.settings).toBeNull();
    });

    it('clears reason on load', async () => {
      vm.setReason('some reason text here');
      await vm.loadSettings('org-123');
      expect(vm.reason).toBe('');
    });
  });

  describe('toggle actions', () => {
    beforeEach(async () => {
      await vm.loadSettings('org-123');
    });

    it('toggleStaffClientMapping flips the value', () => {
      expect(vm.settings!.enable_staff_client_mapping).toBe(false);
      vm.toggleStaffClientMapping();
      expect(vm.settings!.enable_staff_client_mapping).toBe(true);
      vm.toggleStaffClientMapping();
      expect(vm.settings!.enable_staff_client_mapping).toBe(false);
    });

    it('toggleScheduleEnforcement flips the value', () => {
      expect(vm.settings!.enable_schedule_enforcement).toBe(false);
      vm.toggleScheduleEnforcement();
      expect(vm.settings!.enable_schedule_enforcement).toBe(true);
    });

    it('does nothing when settings not loaded', () => {
      const freshVm = new DirectCareSettingsViewModel(mockService);
      freshVm.toggleStaffClientMapping();
      expect(freshVm.settings).toBeNull();
    });
  });

  describe('hasChanges', () => {
    beforeEach(async () => {
      await vm.loadSettings('org-123');
    });

    it('is false when no changes', () => {
      expect(vm.hasChanges).toBe(false);
    });

    it('is true after toggle', () => {
      vm.toggleStaffClientMapping();
      expect(vm.hasChanges).toBe(true);
    });

    it('returns to false when toggled back', () => {
      vm.toggleStaffClientMapping();
      vm.toggleStaffClientMapping();
      expect(vm.hasChanges).toBe(false);
    });
  });

  describe('reason validation', () => {
    it('isReasonValid is false for empty', () => {
      expect(vm.isReasonValid).toBe(false);
    });

    it('isReasonValid is false for short text', () => {
      vm.setReason('short');
      expect(vm.isReasonValid).toBe(false);
    });

    it('isReasonValid is true for 10+ characters', () => {
      vm.setReason('This is a valid reason');
      expect(vm.isReasonValid).toBe(true);
    });

    it('isReasonValid trims whitespace', () => {
      vm.setReason('         ');
      expect(vm.isReasonValid).toBe(false);
    });
  });

  describe('canSave', () => {
    beforeEach(async () => {
      await vm.loadSettings('org-123');
    });

    it('is false with no changes', () => {
      vm.setReason('This is a valid reason');
      expect(vm.canSave).toBe(false);
    });

    it('is false with changes but no reason', () => {
      vm.toggleStaffClientMapping();
      expect(vm.canSave).toBe(false);
    });

    it('is true with changes and valid reason', () => {
      vm.toggleStaffClientMapping();
      vm.setReason('Enabling for pilot program');
      expect(vm.canSave).toBe(true);
    });
  });

  describe('saveSettings', () => {
    beforeEach(async () => {
      await vm.loadSettings('org-123');
      vm.toggleStaffClientMapping();
      vm.setReason('Enabling staff-client mapping for pilot');
    });

    it('saves successfully', async () => {
      const result = await vm.saveSettings();

      expect(result).toBe(true);
      expect(mockService.updateSettings).toHaveBeenCalledWith(
        'org-123',
        true,  // staff mapping changed to true
        null,  // schedule enforcement unchanged
        'Enabling staff-client mapping for pilot',
      );
      expect(vm.isSaving).toBe(false);
      expect(vm.saveSuccess).toBe(true);
      expect(vm.reason).toBe('');
    });

    it('reloads after successful save', async () => {
      await vm.saveSettings();

      // getSettings called twice: once on initial load, once after save
      expect(mockService.getSettings).toHaveBeenCalledTimes(2);
    });

    it('handles save error', async () => {
      const failService = createMockService({
        getSettings: vi.fn().mockResolvedValue({
          enable_staff_client_mapping: false,
          enable_schedule_enforcement: false,
        }),
        updateSettings: vi.fn().mockRejectedValue(new Error('Permission denied')),
      });
      vm = new DirectCareSettingsViewModel(failService);
      await vm.loadSettings('org-123');
      vm.toggleStaffClientMapping();
      vm.setReason('Some reason for the change');

      const result = await vm.saveSettings();

      expect(result).toBe(false);
      expect(vm.saveError).toBe('Permission denied');
      expect(vm.isSaving).toBe(false);
      expect(vm.saveSuccess).toBe(false);
    });

    it('returns false when canSave is false', async () => {
      const freshVm = new DirectCareSettingsViewModel(mockService);
      const result = await freshVm.saveSettings();
      expect(result).toBe(false);
    });

    it('only sends changed fields', async () => {
      // Both toggles changed
      vm.toggleScheduleEnforcement();
      await vm.saveSettings();

      expect(mockService.updateSettings).toHaveBeenCalledWith(
        'org-123',
        true,  // staff mapping changed
        true,  // schedule enforcement changed
        'Enabling staff-client mapping for pilot',
      );
    });
  });

  describe('resetChanges', () => {
    beforeEach(async () => {
      await vm.loadSettings('org-123');
    });

    it('reverts settings to original', () => {
      vm.toggleStaffClientMapping();
      vm.setReason('some reason for change');
      expect(vm.hasChanges).toBe(true);

      vm.resetChanges();

      expect(vm.hasChanges).toBe(false);
      expect(vm.settings).toEqual(vm.originalSettings);
      expect(vm.reason).toBe('');
    });

    it('clears errors', () => {
      vm.resetChanges();
      expect(vm.saveError).toBeNull();
      expect(vm.saveSuccess).toBe(false);
    });

    it('does nothing when no original settings', () => {
      const freshVm = new DirectCareSettingsViewModel(mockService);
      freshVm.resetChanges();
      expect(freshVm.settings).toBeNull();
    });
  });
});
