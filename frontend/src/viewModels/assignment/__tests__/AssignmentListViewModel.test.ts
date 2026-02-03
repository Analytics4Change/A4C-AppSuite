import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssignmentListViewModel } from '../AssignmentListViewModel';
import type { IAssignmentService } from '@/services/assignment/IAssignmentService';
import type { IDirectCareSettingsService } from '@/services/direct-care/IDirectCareSettingsService';
import type { UserClientAssignment } from '@/types/client-assignment.types';

const SAMPLE_ASSIGNMENTS: UserClientAssignment[] = [
  {
    id: 'assign-1',
    user_id: 'user-1',
    user_name: 'Jane Doe',
    user_email: 'jane@example.com',
    client_id: 'client-1',
    organization_id: 'org-1',
    assigned_at: '2026-01-15T00:00:00Z',
    is_active: true,
  },
  {
    id: 'assign-2',
    user_id: 'user-2',
    user_name: 'John Smith',
    user_email: 'john@example.com',
    client_id: 'client-2',
    organization_id: 'org-1',
    assigned_at: '2026-01-16T00:00:00Z',
    is_active: true,
  },
];

function createMockAssignmentService(
  overrides?: Partial<IAssignmentService>
): IAssignmentService {
  return {
    listAssignments: vi.fn().mockResolvedValue(SAMPLE_ASSIGNMENTS),
    assignClient: vi.fn().mockResolvedValue({ assignmentId: 'new-assign-1' }),
    unassignClient: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockSettingsService(
  overrides?: Partial<IDirectCareSettingsService>
): IDirectCareSettingsService {
  return {
    getSettings: vi.fn().mockResolvedValue({
      enable_staff_client_mapping: true,
      enable_schedule_enforcement: false,
    }),
    updateSettings: vi.fn().mockResolvedValue({
      enable_staff_client_mapping: true,
      enable_schedule_enforcement: false,
    }),
    ...overrides,
  };
}

describe('AssignmentListViewModel', () => {
  let vm: AssignmentListViewModel;
  let mockAssignService: IAssignmentService;
  let mockSettingsService: IDirectCareSettingsService;

  beforeEach(() => {
    mockAssignService = createMockAssignmentService();
    mockSettingsService = createMockSettingsService();
    vm = new AssignmentListViewModel(mockAssignService, mockSettingsService);
  });

  describe('default state', () => {
    it('initializes with empty assignments', () => {
      expect(vm.assignments).toEqual([]);
    });

    it('initializes with no loading state', () => {
      expect(vm.isLoading).toBe(false);
      expect(vm.error).toBeNull();
    });

    it('initializes with null feature flag', () => {
      expect(vm.featureEnabled).toBeNull();
      expect(vm.featureCheckLoading).toBe(false);
    });

    it('initializes with null filters', () => {
      expect(vm.filterUserId).toBeNull();
      expect(vm.filterClientId).toBeNull();
      expect(vm.showInactive).toBe(false);
    });
  });

  describe('checkFeatureFlag', () => {
    it('sets featureEnabled from settings', async () => {
      await vm.checkFeatureFlag('org-1');

      expect(mockSettingsService.getSettings).toHaveBeenCalledWith('org-1');
      expect(vm.featureEnabled).toBe(true);
      expect(vm.featureCheckLoading).toBe(false);
    });

    it('sets featureEnabled to false when disabled', async () => {
      const settings = createMockSettingsService({
        getSettings: vi.fn().mockResolvedValue({
          enable_staff_client_mapping: false,
          enable_schedule_enforcement: false,
        }),
      });
      vm = new AssignmentListViewModel(mockAssignService, settings);

      await vm.checkFeatureFlag('org-1');

      expect(vm.featureEnabled).toBe(false);
    });

    it('fails open on error (defaults to true)', async () => {
      const settings = createMockSettingsService({
        getSettings: vi.fn().mockRejectedValue(new Error('Network error')),
      });
      vm = new AssignmentListViewModel(mockAssignService, settings);

      await vm.checkFeatureFlag('org-1');

      expect(vm.featureEnabled).toBe(true);
      expect(vm.featureCheckLoading).toBe(false);
    });
  });

  describe('loadAssignments', () => {
    it('loads assignments successfully', async () => {
      await vm.loadAssignments();

      expect(mockAssignService.listAssignments).toHaveBeenCalledWith({
        userId: undefined,
        clientId: undefined,
        activeOnly: true,
      });
      expect(vm.assignments).toEqual(SAMPLE_ASSIGNMENTS);
      expect(vm.isLoading).toBe(false);
      expect(vm.error).toBeNull();
    });

    it('passes filters to service', async () => {
      vm.setFilterUserId('user-1');
      vm.setFilterClientId('client-1');
      vm.setShowInactive(true);

      await vm.loadAssignments();

      expect(mockAssignService.listAssignments).toHaveBeenCalledWith({
        userId: 'user-1',
        clientId: 'client-1',
        activeOnly: false,
      });
    });

    it('handles load error', async () => {
      const service = createMockAssignmentService({
        listAssignments: vi.fn().mockRejectedValue(new Error('Failed')),
      });
      vm = new AssignmentListViewModel(service, mockSettingsService);

      await vm.loadAssignments();

      expect(vm.error).toBe('Failed');
      expect(vm.isLoading).toBe(false);
      expect(vm.assignments).toEqual([]);
    });
  });

  describe('filters', () => {
    it('setFilterUserId updates filter', () => {
      vm.setFilterUserId('user-1');
      expect(vm.filterUserId).toBe('user-1');
    });

    it('setFilterClientId updates filter', () => {
      vm.setFilterClientId('client-1');
      expect(vm.filterClientId).toBe('client-1');
    });

    it('setShowInactive updates filter', () => {
      vm.setShowInactive(true);
      expect(vm.showInactive).toBe(true);
    });

    it('filters can be cleared', () => {
      vm.setFilterUserId('user-1');
      vm.setFilterUserId(null);
      expect(vm.filterUserId).toBeNull();
    });
  });

  describe('assignClient', () => {
    it('assigns and reloads', async () => {
      const result = await vm.assignClient({
        userId: 'user-1',
        clientId: 'client-3',
        notes: 'New assignment',
      });

      expect(result).toBe(true);
      expect(mockAssignService.assignClient).toHaveBeenCalledWith({
        userId: 'user-1',
        clientId: 'client-3',
        notes: 'New assignment',
      });
      // Reloads after assign
      expect(mockAssignService.listAssignments).toHaveBeenCalledTimes(1);
    });

    it('returns false on error', async () => {
      const service = createMockAssignmentService({
        assignClient: vi.fn().mockRejectedValue(new Error('Duplicate')),
      });
      vm = new AssignmentListViewModel(service, mockSettingsService);

      const result = await vm.assignClient({
        userId: 'user-1',
        clientId: 'client-1',
      });

      expect(result).toBe(false);
    });
  });

  describe('unassignClient', () => {
    it('unassigns and reloads', async () => {
      const result = await vm.unassignClient('user-1', 'client-1', 'No longer needed');

      expect(result).toBe(true);
      expect(mockAssignService.unassignClient).toHaveBeenCalledWith({
        userId: 'user-1',
        clientId: 'client-1',
        reason: 'No longer needed',
      });
      expect(mockAssignService.listAssignments).toHaveBeenCalledTimes(1);
    });

    it('returns false on error', async () => {
      const service = createMockAssignmentService({
        unassignClient: vi.fn().mockRejectedValue(new Error('Not found')),
      });
      vm = new AssignmentListViewModel(service, mockSettingsService);

      const result = await vm.unassignClient('user-1', 'client-1', 'reason');

      expect(result).toBe(false);
    });
  });
});
