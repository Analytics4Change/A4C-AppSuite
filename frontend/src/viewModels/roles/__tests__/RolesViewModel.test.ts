/**
 * RolesViewModel Unit Tests
 *
 * Tests for role list management, CRUD operations, and state transitions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RolesViewModel } from '../RolesViewModel';
import type { IRoleService } from '@/services/roles/IRoleService';
import type { Role, Permission } from '@/types/role.types';

// Sample test data
const mockRoles: Role[] = [
  {
    id: 'role-1',
    name: 'Admin',
    description: 'Administrator with full access',
    organizationId: 'org-1',
    orgHierarchyScope: 'root.org1',
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    permissionCount: 10,
    userCount: 5,
  },
  {
    id: 'role-2',
    name: 'Viewer',
    description: 'Read-only access to records',
    organizationId: 'org-1',
    orgHierarchyScope: 'root.org1',
    isActive: true,
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-02'),
    permissionCount: 3,
    userCount: 10,
  },
  {
    id: 'role-3',
    name: 'Inactive Role',
    description: 'This role has been deactivated',
    organizationId: 'org-1',
    orgHierarchyScope: 'root.org1',
    isActive: false,
    createdAt: new Date('2024-01-03'),
    updatedAt: new Date('2024-01-03'),
    permissionCount: 5,
    userCount: 0,
  },
];

const mockPermissions: Permission[] = [
  {
    id: 'perm-1',
    name: 'medication.create',
    applet: 'medication',
    action: 'create',
    description: 'Create medications',
    scopeType: 'org',
  },
  {
    id: 'perm-2',
    name: 'medication.view',
    applet: 'medication',
    action: 'view',
    description: 'View medications',
    scopeType: 'org',
  },
];

const mockUserPermissionIds = ['perm-1', 'perm-2'];

describe('RolesViewModel', () => {
  let viewModel: RolesViewModel;
  let mockService: IRoleService;

  beforeEach(() => {
    // Create mock service
    mockService = {
      getRoles: vi.fn().mockResolvedValue([...mockRoles]),
      getRoleById: vi.fn().mockResolvedValue(null),
      getPermissions: vi.fn().mockResolvedValue([...mockPermissions]),
      getUserPermissions: vi.fn().mockResolvedValue([...mockUserPermissionIds]),
      createRole: vi.fn().mockResolvedValue({ success: true, role: mockRoles[0] }),
      updateRole: vi.fn().mockResolvedValue({ success: true }),
      deactivateRole: vi.fn().mockResolvedValue({ success: true }),
      reactivateRole: vi.fn().mockResolvedValue({ success: true }),
      deleteRole: vi.fn().mockResolvedValue({ success: true }),
    };

    viewModel = new RolesViewModel(mockService);
  });

  describe('Initialization', () => {
    it('should initialize with empty roles array', () => {
      expect(viewModel.roles).toEqual([]);
    });

    it('should initialize with no selection', () => {
      expect(viewModel.selectedRoleId).toBeNull();
      expect(viewModel.selectedRole).toBeNull();
    });

    it('should not be loading initially', () => {
      expect(viewModel.isLoading).toBe(false);
    });

    it('should have no error initially', () => {
      expect(viewModel.error).toBeNull();
    });

    it('should have default filters', () => {
      expect(viewModel.filters).toEqual({ status: 'all' });
    });

    it('should initialize with empty permissions arrays', () => {
      expect(viewModel.allPermissions).toEqual([]);
      expect(viewModel.userPermissionIds).toEqual([]);
    });
  });

  describe('Data Loading', () => {
    describe('loadRoles', () => {
      it('should load roles from service', async () => {
        await viewModel.loadRoles();

        expect(mockService.getRoles).toHaveBeenCalledWith({ status: 'all' });
        expect(viewModel.roles).toHaveLength(3);
        expect(viewModel.isLoading).toBe(false);
      });

      it('should set isLoading during load', async () => {
        const loadPromise = viewModel.loadRoles();
        expect(viewModel.isLoading).toBe(true);
        await loadPromise;
        expect(viewModel.isLoading).toBe(false);
      });

      it('should apply filters when provided', async () => {
        await viewModel.loadRoles({ status: 'active', searchTerm: 'admin' });

        expect(mockService.getRoles).toHaveBeenCalledWith({
          status: 'active',
          searchTerm: 'admin',
        });
        expect(viewModel.filters).toEqual({ status: 'active', searchTerm: 'admin' });
      });

      it('should handle load errors', async () => {
        vi.mocked(mockService.getRoles).mockRejectedValue(new Error('Network error'));

        await viewModel.loadRoles();

        expect(viewModel.error).toBe('Network error');
        expect(viewModel.isLoading).toBe(false);
      });

      it('should clear previous error on new load', async () => {
        // First load fails
        mockService.getRoles = vi.fn().mockRejectedValue(new Error('Error'));
        await viewModel.loadRoles();
        expect(viewModel.error).toBeDefined();

        // Second load succeeds
        mockService.getRoles = vi.fn().mockResolvedValue([]);
        await viewModel.loadRoles();
        expect(viewModel.error).toBeNull();
      });
    });

    describe('loadPermissions', () => {
      it('should load permissions from service', async () => {
        await viewModel.loadPermissions();

        expect(mockService.getPermissions).toHaveBeenCalled();
        expect(viewModel.allPermissions).toHaveLength(2);
      });

      it('should not set error state on failure (secondary data)', async () => {
        mockService.getPermissions = vi.fn().mockRejectedValue(new Error('Error'));

        await viewModel.loadPermissions();

        expect(viewModel.error).toBeNull();
      });
    });

    describe('loadUserPermissions', () => {
      it('should load user permissions from service', async () => {
        await viewModel.loadUserPermissions();

        expect(mockService.getUserPermissions).toHaveBeenCalled();
        expect(viewModel.userPermissionIds).toEqual(['perm-1', 'perm-2']);
      });

      it('should not set error state on failure (secondary data)', async () => {
        mockService.getUserPermissions = vi.fn().mockRejectedValue(new Error('Error'));

        await viewModel.loadUserPermissions();

        expect(viewModel.error).toBeNull();
      });
    });

    describe('loadAll', () => {
      it('should load roles, permissions, and user permissions', async () => {
        await viewModel.loadAll();

        expect(mockService.getRoles).toHaveBeenCalled();
        expect(mockService.getPermissions).toHaveBeenCalled();
        expect(mockService.getUserPermissions).toHaveBeenCalled();
        expect(viewModel.roles).toHaveLength(3);
        expect(viewModel.allPermissions).toHaveLength(2);
        expect(viewModel.userPermissionIds).toHaveLength(2);
      });
    });

    describe('refresh', () => {
      it('should reload with current filters', async () => {
        await viewModel.setFilters({ status: 'active' });
        vi.mocked(mockService.getRoles).mockClear();

        await viewModel.refresh();

        expect(mockService.getRoles).toHaveBeenCalledWith({ status: 'active' });
      });
    });
  });

  describe('Selection', () => {
    beforeEach(async () => {
      await viewModel.loadRoles();
    });

    it('should select a role by ID', () => {
      viewModel.selectRole('role-1');

      expect(viewModel.selectedRoleId).toBe('role-1');
      expect(viewModel.selectedRole).not.toBeNull();
      expect(viewModel.selectedRole?.name).toBe('Admin');
    });

    it('should return null for non-existent role ID', () => {
      viewModel.selectRole('non-existent');

      expect(viewModel.selectedRoleId).toBe('non-existent');
      expect(viewModel.selectedRole).toBeNull();
    });

    it('should clear selection', () => {
      viewModel.selectRole('role-1');
      viewModel.clearSelection();

      expect(viewModel.selectedRoleId).toBeNull();
      expect(viewModel.selectedRole).toBeNull();
    });
  });

  describe('Filtering', () => {
    it('should set filters and reload', async () => {
      await viewModel.setFilters({ status: 'active' });

      expect(mockService.getRoles).toHaveBeenCalledWith({ status: 'active' });
      expect(viewModel.filters.status).toBe('active');
    });

    it('should set status filter', async () => {
      await viewModel.setStatusFilter('inactive');

      expect(viewModel.filters.status).toBe('inactive');
    });

    it('should set search filter', async () => {
      await viewModel.setSearchFilter('admin');

      expect(viewModel.filters.searchTerm).toBe('admin');
    });

    it('should clear search filter when empty string', async () => {
      await viewModel.setSearchFilter('admin');
      await viewModel.setSearchFilter('');

      expect(viewModel.filters.searchTerm).toBeUndefined();
    });
  });

  describe('Computed Properties', () => {
    beforeEach(async () => {
      await viewModel.loadRoles();
    });

    describe('canEdit', () => {
      it('should be false when no role selected', () => {
        expect(viewModel.canEdit).toBe(false);
      });

      it('should be true for active role', () => {
        viewModel.selectRole('role-1');
        expect(viewModel.canEdit).toBe(true);
      });

      it('should be false for inactive role', () => {
        viewModel.selectRole('role-3');
        expect(viewModel.canEdit).toBe(false);
      });
    });

    describe('canDeactivate', () => {
      it('should be false when no role selected', () => {
        expect(viewModel.canDeactivate).toBe(false);
      });

      it('should be true for active role', () => {
        viewModel.selectRole('role-1');
        expect(viewModel.canDeactivate).toBe(true);
      });

      it('should be false for inactive role', () => {
        viewModel.selectRole('role-3');
        expect(viewModel.canDeactivate).toBe(false);
      });
    });

    describe('canReactivate', () => {
      it('should be false when no role selected', () => {
        expect(viewModel.canReactivate).toBe(false);
      });

      it('should be false for active role', () => {
        viewModel.selectRole('role-1');
        expect(viewModel.canReactivate).toBe(false);
      });

      it('should be true for inactive role', () => {
        viewModel.selectRole('role-3');
        expect(viewModel.canReactivate).toBe(true);
      });
    });

    describe('canDelete', () => {
      it('should be false when no role selected', () => {
        expect(viewModel.canDelete).toBe(false);
      });

      it('should be false for active role', () => {
        viewModel.selectRole('role-1');
        expect(viewModel.canDelete).toBe(false);
      });

      it('should be false for inactive role with users', () => {
        // role-2 has userCount: 10
        viewModel.selectRole('role-2');
        expect(viewModel.canDelete).toBe(false);
      });

      it('should be true for inactive role with no users', () => {
        viewModel.selectRole('role-3');
        expect(viewModel.canDelete).toBe(true);
      });
    });

    describe('canCreate', () => {
      it('should be true when not loading', () => {
        expect(viewModel.canCreate).toBe(true);
      });

      it('should be false when loading', async () => {
        // Start a load operation but don't await it
        mockService.getRoles = vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
        );
        const loadPromise = viewModel.loadRoles();
        expect(viewModel.canCreate).toBe(false);
        await loadPromise;
      });
    });

    describe('roleCount and activeRoleCount', () => {
      it('should return correct counts', () => {
        expect(viewModel.roleCount).toBe(3);
        expect(viewModel.activeRoleCount).toBe(2);
      });
    });

    describe('userPermissionIdSet', () => {
      it('should return Set of user permission IDs', async () => {
        await viewModel.loadUserPermissions();

        const set = viewModel.userPermissionIdSet;
        expect(set.has('perm-1')).toBe(true);
        expect(set.has('perm-2')).toBe(true);
        expect(set.has('perm-3')).toBe(false);
      });
    });
  });

  describe('CRUD Operations', () => {
    beforeEach(async () => {
      await viewModel.loadRoles();
    });

    describe('createRole', () => {
      it('should create a new role and add to list', async () => {
        const newRole: Role = {
          id: 'role-new',
          name: 'New Role',
          description: 'A newly created role',
          organizationId: 'org-1',
          orgHierarchyScope: 'root.org1',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          permissionCount: 0,
          userCount: 0,
        };

        vi.mocked(mockService.createRole).mockResolvedValue({
          success: true,
          role: newRole,
        });

        const result = await viewModel.createRole({
          name: 'New Role',
          description: 'A newly created role',
          permissionIds: [],
        });

        expect(result.success).toBe(true);
        expect(viewModel.roles).toHaveLength(4);
        expect(viewModel.selectedRoleId).toBe('role-new');
      });

      it('should handle create failure', async () => {
        vi.mocked(mockService.createRole).mockResolvedValue({
          success: false,
          error: 'Name already exists',
          errorDetails: { code: 'VALIDATION_ERROR', message: 'Name already exists' },
        });

        const result = await viewModel.createRole({
          name: 'Existing',
          description: 'This name exists',
          permissionIds: [],
        });

        expect(result.success).toBe(false);
        expect(viewModel.error).toBe('Name already exists');
      });

      it('should handle create exception', async () => {
        vi.mocked(mockService.createRole).mockRejectedValue(new Error('Network error'));

        const result = await viewModel.createRole({
          name: 'Role',
          description: 'Description here',
          permissionIds: [],
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Network error');
        expect(viewModel.error).toBe('Network error');
      });
    });

    describe('updateRole', () => {
      it('should update role and reload list', async () => {
        const result = await viewModel.updateRole({
          id: 'role-1',
          name: 'Updated Admin',
        });

        expect(result.success).toBe(true);
        expect(mockService.updateRole).toHaveBeenCalled();
        expect(mockService.getRoles).toHaveBeenCalled();
      });

      it('should handle update failure', async () => {
        vi.mocked(mockService.updateRole).mockResolvedValue({
          success: false,
          error: 'Role not found',
        });

        const result = await viewModel.updateRole({
          id: 'non-existent',
          name: 'Updated',
        });

        expect(result.success).toBe(false);
        expect(viewModel.error).toBe('Role not found');
      });
    });

    describe('deactivateRole', () => {
      it('should deactivate role and update local state', async () => {
        await viewModel.deactivateRole('role-1');

        const role = viewModel.getRoleById('role-1');
        expect(role?.isActive).toBe(false);
      });

      it('should handle deactivate failure', async () => {
        vi.mocked(mockService.deactivateRole).mockResolvedValue({
          success: false,
          error: 'Already inactive',
          errorDetails: { code: 'ALREADY_INACTIVE', message: 'Already inactive' },
        });

        const result = await viewModel.deactivateRole('role-3');

        expect(result.success).toBe(false);
        expect(viewModel.error).toBe('Already inactive');
      });
    });

    describe('reactivateRole', () => {
      it('should reactivate role and update local state', async () => {
        await viewModel.reactivateRole('role-3');

        const role = viewModel.getRoleById('role-3');
        expect(role?.isActive).toBe(true);
      });

      it('should handle reactivate failure', async () => {
        vi.mocked(mockService.reactivateRole).mockResolvedValue({
          success: false,
          error: 'Already active',
          errorDetails: { code: 'ALREADY_ACTIVE', message: 'Already active' },
        });

        const result = await viewModel.reactivateRole('role-1');

        expect(result.success).toBe(false);
        expect(viewModel.error).toBe('Already active');
      });
    });

    describe('deleteRole', () => {
      it('should delete role and remove from list', async () => {
        const initialCount = viewModel.roleCount;
        viewModel.selectRole('role-3');

        await viewModel.deleteRole('role-3');

        expect(viewModel.roleCount).toBe(initialCount - 1);
        expect(viewModel.getRoleById('role-3')).toBeNull();
        expect(viewModel.selectedRoleId).toBeNull();
      });

      it('should not clear selection if deleted role was not selected', async () => {
        viewModel.selectRole('role-1');

        await viewModel.deleteRole('role-3');

        expect(viewModel.selectedRoleId).toBe('role-1');
      });

      it('should handle delete failure with HAS_USERS error', async () => {
        vi.mocked(mockService.deleteRole).mockResolvedValue({
          success: false,
          error: 'Role has users assigned',
          errorDetails: { code: 'HAS_USERS', count: 5, message: 'Role has 5 users' },
        });

        const result = await viewModel.deleteRole('role-1');

        expect(result.success).toBe(false);
        expect(result.errorDetails?.code).toBe('HAS_USERS');
      });
    });
  });

  describe('Utility Methods', () => {
    beforeEach(async () => {
      await viewModel.loadRoles();
    });

    describe('clearError', () => {
      it('should clear error state', async () => {
        mockService.getRoles = vi.fn().mockRejectedValue(new Error('Error'));
        await viewModel.loadRoles();
        expect(viewModel.error).toBeDefined();

        viewModel.clearError();

        expect(viewModel.error).toBeNull();
      });
    });

    describe('getRoleById', () => {
      it('should return role when found', () => {
        const role = viewModel.getRoleById('role-1');
        expect(role?.name).toBe('Admin');
      });

      it('should return null when not found', () => {
        const role = viewModel.getRoleById('non-existent');
        expect(role).toBeNull();
      });
    });

    describe('getRoleWithPermissions', () => {
      it('should call service to get role with permissions', async () => {
        const roleWithPerms = {
          ...mockRoles[0],
          permissions: mockPermissions,
        };
        vi.mocked(mockService.getRoleById).mockResolvedValue(roleWithPerms);

        const result = await viewModel.getRoleWithPermissions('role-1');

        expect(mockService.getRoleById).toHaveBeenCalledWith('role-1');
        expect(result?.permissions).toHaveLength(2);
      });

      it('should return null on error', async () => {
        vi.mocked(mockService.getRoleById).mockRejectedValue(new Error('Error'));

        const result = await viewModel.getRoleWithPermissions('role-1');

        expect(result).toBeNull();
      });
    });
  });
});
