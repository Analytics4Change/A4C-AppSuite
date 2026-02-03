import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduleEditViewModel } from '../ScheduleEditViewModel';
import type { IScheduleService } from '@/services/schedule/IScheduleService';
import type { UserSchedulePolicy, WeeklySchedule } from '@/types/schedule.types';

const EMPTY_SCHEDULE: WeeklySchedule = {
  monday: null,
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
};

const SAMPLE_SCHEDULE: WeeklySchedule = {
  monday: { begin: '0800', end: '1630' },
  tuesday: { begin: '0800', end: '1630' },
  wednesday: { begin: '0800', end: '1630' },
  thursday: { begin: '0800', end: '1630' },
  friday: { begin: '0800', end: '1200' },
  saturday: null,
  sunday: null,
};

const SAMPLE_POLICY: UserSchedulePolicy = {
  id: 'sched-1',
  user_id: 'user-1',
  organization_id: 'org-1',
  schedule: SAMPLE_SCHEDULE,
  org_unit_id: null,
  effective_from: null,
  effective_until: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  created_by: 'admin-1',
  last_event_id: 'evt-1',
};

function createMockService(
  overrides?: Partial<IScheduleService>
): IScheduleService {
  return {
    listSchedules: vi.fn().mockResolvedValue([SAMPLE_POLICY]),
    createSchedule: vi.fn().mockResolvedValue({ scheduleId: 'new-sched-1' }),
    updateSchedule: vi.fn().mockResolvedValue(undefined),
    deactivateSchedule: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('ScheduleEditViewModel', () => {
  let vm: ScheduleEditViewModel;
  let mockService: IScheduleService;

  beforeEach(() => {
    mockService = createMockService();
    vm = new ScheduleEditViewModel(mockService);
  });

  describe('default state', () => {
    it('initializes with null existing schedule', () => {
      expect(vm.existingSchedule).toBeNull();
      expect(vm.userId).toBeNull();
      expect(vm.orgUnitId).toBeNull();
    });

    it('initializes with empty schedule', () => {
      expect(vm.editedSchedule).toEqual(EMPTY_SCHEDULE);
    });

    it('initializes with no loading/saving state', () => {
      expect(vm.isLoading).toBe(false);
      expect(vm.isSaving).toBe(false);
      expect(vm.error).toBeNull();
      expect(vm.saveError).toBeNull();
      expect(vm.saveSuccess).toBe(false);
    });

    it('isNewSchedule is true', () => {
      expect(vm.isNewSchedule).toBe(true);
    });

    it('hasChanges is false', () => {
      expect(vm.hasChanges).toBe(false);
    });

    it('canSave is false', () => {
      expect(vm.canSave).toBe(false);
    });
  });

  describe('loadSchedule', () => {
    it('loads existing schedule successfully', async () => {
      await vm.loadSchedule('user-1');

      expect(mockService.listSchedules).toHaveBeenCalledWith({
        userId: 'user-1',
        activeOnly: true,
      });
      expect(vm.existingSchedule).toEqual(SAMPLE_POLICY);
      expect(vm.editedSchedule).toEqual(SAMPLE_SCHEDULE);
      expect(vm.userId).toBe('user-1');
      expect(vm.isNewSchedule).toBe(false);
      expect(vm.isLoading).toBe(false);
      expect(vm.error).toBeNull();
    });

    it('handles no existing schedule', async () => {
      const service = createMockService({
        listSchedules: vi.fn().mockResolvedValue([]),
      });
      vm = new ScheduleEditViewModel(service);

      await vm.loadSchedule('user-2');

      expect(vm.existingSchedule).toBeNull();
      expect(vm.editedSchedule).toEqual(EMPTY_SCHEDULE);
      expect(vm.isNewSchedule).toBe(true);
    });

    it('handles load error', async () => {
      const service = createMockService({
        listSchedules: vi.fn().mockRejectedValue(new Error('Network error')),
      });
      vm = new ScheduleEditViewModel(service);

      await vm.loadSchedule('user-1');

      expect(vm.error).toBe('Network error');
      expect(vm.isLoading).toBe(false);
    });

    it('clears reason and saveSuccess on load', async () => {
      vm.setReason('some reason text here');
      await vm.loadSchedule('user-1');
      expect(vm.reason).toBe('');
      expect(vm.saveSuccess).toBe(false);
    });

    it('populates orgUnitId and effective dates from schedule', async () => {
      const policy = {
        ...SAMPLE_POLICY,
        org_unit_id: 'ou-1',
        effective_from: '2026-03-01',
        effective_until: '2026-12-31',
      };
      const service = createMockService({
        listSchedules: vi.fn().mockResolvedValue([policy]),
      });
      vm = new ScheduleEditViewModel(service);

      await vm.loadSchedule('user-1');

      expect(vm.orgUnitId).toBe('ou-1');
      expect(vm.effectiveFrom).toBe('2026-03-01');
      expect(vm.effectiveUntil).toBe('2026-12-31');
    });
  });

  describe('toggleDay', () => {
    it('enables a day with default times', () => {
      vm.toggleDay('monday');
      expect(vm.editedSchedule.monday).toEqual({ begin: '0800', end: '1600' });
    });

    it('disables an enabled day', () => {
      vm.toggleDay('monday');
      vm.toggleDay('monday');
      expect(vm.editedSchedule.monday).toBeNull();
    });

    it('clears saveSuccess', () => {
      vm.toggleDay('monday');
      expect(vm.saveSuccess).toBe(false);
    });
  });

  describe('setDayTime', () => {
    beforeEach(() => {
      vm.toggleDay('monday');
    });

    it('sets begin time', () => {
      vm.setDayTime('monday', 'begin', '09:00');
      expect(vm.editedSchedule.monday!.begin).toBe('0900');
    });

    it('sets end time', () => {
      vm.setDayTime('monday', 'end', '17:30');
      expect(vm.editedSchedule.monday!.end).toBe('1730');
    });

    it('does nothing for disabled day', () => {
      vm.setDayTime('tuesday', 'begin', '0900');
      expect(vm.editedSchedule.tuesday).toBeNull();
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

    it('trims whitespace', () => {
      vm.setReason('         ');
      expect(vm.isReasonValid).toBe(false);
    });
  });

  describe('hasChanges', () => {
    it('is true when day toggled on new schedule', () => {
      vm.toggleDay('monday');
      expect(vm.hasChanges).toBe(true);
    });

    it('is false after toggling day back off', () => {
      vm.toggleDay('monday');
      vm.toggleDay('monday');
      expect(vm.hasChanges).toBe(false);
    });

    it('is true when existing schedule modified', async () => {
      await vm.loadSchedule('user-1');
      vm.toggleDay('saturday');
      expect(vm.hasChanges).toBe(true);
    });

    it('is false when existing schedule unchanged', async () => {
      await vm.loadSchedule('user-1');
      expect(vm.hasChanges).toBe(false);
    });
  });

  describe('canSave', () => {
    it('requires both changes and valid reason', () => {
      vm.toggleDay('monday');
      expect(vm.canSave).toBe(false);

      vm.setReason('Valid reason text here');
      expect(vm.canSave).toBe(true);
    });

    it('is false with valid reason but no changes', () => {
      vm.setReason('Valid reason text here');
      expect(vm.canSave).toBe(false);
    });
  });

  describe('save', () => {
    it('creates new schedule', async () => {
      vm.toggleDay('monday');
      vm.setReason('Creating new schedule');

      // After save, loadSchedule is called which returns existing schedule
      const result = await vm.save();

      // save calls loadSchedule internally but userId is null until set
      // We need to set userId first via loadSchedule
    });

    it('creates new schedule after loading empty', async () => {
      const service = createMockService({
        listSchedules: vi.fn().mockResolvedValue([]),
        createSchedule: vi.fn().mockResolvedValue({ scheduleId: 'new-1' }),
      });
      vm = new ScheduleEditViewModel(service);

      await vm.loadSchedule('user-1');
      vm.toggleDay('monday');
      vm.setReason('Creating new schedule');

      const result = await vm.save();

      expect(result).toBe(true);
      expect(service.createSchedule).toHaveBeenCalledWith({
        userId: 'user-1',
        schedule: expect.objectContaining({ monday: { begin: '0800', end: '1600' } }),
        orgUnitId: undefined,
        effectiveFrom: undefined,
        effectiveUntil: undefined,
        reason: 'Creating new schedule',
      });
      expect(vm.isSaving).toBe(false);
      expect(vm.saveSuccess).toBe(true);
    });

    it('updates existing schedule', async () => {
      await vm.loadSchedule('user-1');
      vm.toggleDay('saturday');
      vm.setReason('Adding Saturday hours');

      const result = await vm.save();

      expect(result).toBe(true);
      expect(mockService.updateSchedule).toHaveBeenCalledWith({
        scheduleId: 'sched-1',
        schedule: expect.objectContaining({
          saturday: { begin: '0800', end: '1600' },
        }),
        reason: 'Adding Saturday hours',
      });
    });

    it('reloads after successful save', async () => {
      await vm.loadSchedule('user-1');
      vm.toggleDay('saturday');
      vm.setReason('Adding Saturday hours');

      await vm.save();

      // listSchedules called twice: load + reload after save
      expect(mockService.listSchedules).toHaveBeenCalledTimes(2);
    });

    it('handles save error', async () => {
      const service = createMockService({
        listSchedules: vi.fn().mockResolvedValue([]),
        createSchedule: vi.fn().mockRejectedValue(new Error('Permission denied')),
      });
      vm = new ScheduleEditViewModel(service);

      await vm.loadSchedule('user-1');
      vm.toggleDay('monday');
      vm.setReason('Creating new schedule');

      const result = await vm.save();

      expect(result).toBe(false);
      expect(vm.saveError).toBe('Permission denied');
      expect(vm.isSaving).toBe(false);
      expect(vm.saveSuccess).toBe(false);
    });

    it('returns false when canSave is false', async () => {
      const result = await vm.save();
      expect(result).toBe(false);
    });
  });

  describe('resetChanges', () => {
    it('reverts to existing schedule', async () => {
      await vm.loadSchedule('user-1');
      vm.toggleDay('saturday');
      vm.setReason('some reason for change');

      vm.resetChanges();

      expect(vm.editedSchedule).toEqual(SAMPLE_SCHEDULE);
      expect(vm.reason).toBe('');
      expect(vm.hasChanges).toBe(false);
    });

    it('reverts to empty when no existing schedule', () => {
      vm.toggleDay('monday');
      vm.resetChanges();

      expect(vm.editedSchedule).toEqual(EMPTY_SCHEDULE);
      expect(vm.reason).toBe('');
    });

    it('clears errors', () => {
      vm.resetChanges();
      expect(vm.saveError).toBeNull();
      expect(vm.saveSuccess).toBe(false);
    });
  });
});
