/**
 * RoleFormViewModel Unit Tests
 *
 * Tests for role form state, validation, permission selection, and submission.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoleFormViewModel } from '../RoleFormViewModel';
import type { IRoleService } from '@/services/roles/IRoleService';
import type { Permission, RoleWithPermissions } from '@/types/role.types';

// Sample test data
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
  {
    id: 'perm-3',
    name: 'client.view',
    applet: 'client',
    action: 'view',
    description: 'View clients',
    scopeType: 'org',
  },
  {
    id: 'perm-4',
    name: 'client.create',
    applet: 'client',
    action: 'create',
    description: 'Create clients',
    scopeType: 'org',
  },
];

// User has perm-1, perm-2, perm-3 (but NOT perm-4)
const mockUserPermissionIds = ['perm-1', 'perm-2', 'perm-3'];

const mockExistingRole: RoleWithPermissions = {
  id: 'role-1',
  name: 'Existing Role',
  description: 'This is an existing role for editing',
  organizationId: 'org-1',
  orgHierarchyScope: 'root.org1',
  isActive: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  permissionCount: 2,
  userCount: 0,
  permissions: [mockPermissions[0], mockPermissions[1]], // perm-1, perm-2
};

describe('RoleFormViewModel', () => {
  let mockService: IRoleService;

  beforeEach(() => {
    mockService = {
      getRoles: vi.fn().mockResolvedValue([]),
      getRoleById: vi.fn().mockResolvedValue(null),
      getPermissions: vi.fn().mockResolvedValue([...mockPermissions]),
      getUserPermissions: vi.fn().mockResolvedValue([...mockUserPermissionIds]),
      createRole: vi.fn().mockResolvedValue({ success: true, role: mockExistingRole }),
      updateRole: vi.fn().mockResolvedValue({ success: true }),
      deactivateRole: vi.fn().mockResolvedValue({ success: true }),
      reactivateRole: vi.fn().mockResolvedValue({ success: true }),
      deleteRole: vi.fn().mockResolvedValue({ success: true }),
    };
  });

  describe('Initialization', () => {
    describe('create mode', () => {
      it('should initialize with empty form data', () => {
        const vm = new RoleFormViewModel(
          mockService,
          'create',
          mockPermissions,
          mockUserPermissionIds
        );

        expect(vm.mode).toBe('create');
        expect(vm.formData.name).toBe('');
        expect(vm.formData.description).toBe('');
        expect(vm.formData.orgHierarchyScope).toBeNull();
        expect(vm.editingRoleId).toBeNull();
      });

      it('should initialize with no selected permissions', () => {
        const vm = new RoleFormViewModel(
          mockService,
          'create',
          mockPermissions,
          mockUserPermissionIds
        );

        expect(vm.selectedPermissionIds.size).toBe(0);
        expect(vm.selectedPermissionCount).toBe(0);
      });

      it('should not be dirty initially', () => {
        const vm = new RoleFormViewModel(
          mockService,
          'create',
          mockPermissions,
          mockUserPermissionIds
        );

        expect(vm.isDirty).toBe(false);
      });
    });

    describe('edit mode', () => {
      it('should initialize with existing role data', () => {
        const vm = new RoleFormViewModel(
          mockService,
          'edit',
          mockPermissions,
          mockUserPermissionIds,
          mockExistingRole
        );

        expect(vm.mode).toBe('edit');
        expect(vm.formData.name).toBe('Existing Role');
        expect(vm.formData.description).toBe('This is an existing role for editing');
        expect(vm.formData.orgHierarchyScope).toBe('root.org1');
        expect(vm.editingRoleId).toBe('role-1');
      });

      it('should initialize with existing permissions selected', () => {
        const vm = new RoleFormViewModel(
          mockService,
          'edit',
          mockPermissions,
          mockUserPermissionIds,
          mockExistingRole
        );

        expect(vm.selectedPermissionIds.size).toBe(2);
        expect(vm.isPermissionSelected('perm-1')).toBe(true);
        expect(vm.isPermissionSelected('perm-2')).toBe(true);
        expect(vm.isPermissionSelected('perm-3')).toBe(false);
      });

      it('should not be dirty initially', () => {
        const vm = new RoleFormViewModel(
          mockService,
          'edit',
          mockPermissions,
          mockUserPermissionIds,
          mockExistingRole
        );

        expect(vm.isDirty).toBe(false);
      });
    });
  });

  describe('Field Updates', () => {
    let vm: RoleFormViewModel;

    beforeEach(() => {
      vm = new RoleFormViewModel(
        mockService,
        'create',
        mockPermissions,
        mockUserPermissionIds
      );
    });

    it('should update name field', () => {
      vm.updateField('name', 'New Role Name');

      expect(vm.formData.name).toBe('New Role Name');
      expect(vm.touchedFields.has('name')).toBe(true);
    });

    it('should update description field', () => {
      vm.updateField('description', 'This is a new description');

      expect(vm.formData.description).toBe('This is a new description');
      expect(vm.touchedFields.has('description')).toBe(true);
    });

    it('should mark form as dirty after field change', () => {
      expect(vm.isDirty).toBe(false);

      vm.updateField('name', 'Changed Name');

      expect(vm.isDirty).toBe(true);
    });

    it('should clear submission error on field update', () => {
      vm.submissionError = 'Previous error';

      vm.updateField('name', 'New Name');

      expect(vm.submissionError).toBeNull();
    });

    it('should trigger validation on field update', () => {
      vm.updateField('name', '');

      expect(vm.errors.has('name')).toBe(true);
      expect(vm.getFieldError('name')).toContain('required');
    });
  });

  describe('Validation', () => {
    let vm: RoleFormViewModel;

    beforeEach(() => {
      vm = new RoleFormViewModel(
        mockService,
        'create',
        mockPermissions,
        mockUserPermissionIds
      );
    });

    it('should validate name as required', () => {
      vm.touchField('name');

      expect(vm.hasFieldError('name')).toBe(true);
      expect(vm.getFieldError('name')).toContain('required');
    });

    it('should validate description as required', () => {
      vm.touchField('description');

      expect(vm.hasFieldError('description')).toBe(true);
      expect(vm.getFieldError('description')).toContain('required');
    });

    it('should validate description minimum length', () => {
      vm.updateField('description', 'short');

      expect(vm.hasFieldError('description')).toBe(true);
      expect(vm.getFieldError('description')).toContain('at least 10 characters');
    });

    it('should clear error when field becomes valid', () => {
      vm.updateField('name', '');
      expect(vm.hasFieldError('name')).toBe(true);

      vm.updateField('name', 'Valid Name');
      expect(vm.hasFieldError('name')).toBe(false);
    });

    it('should not show error for untouched fields', () => {
      // Field is invalid but not touched
      expect(vm.formData.name).toBe('');
      expect(vm.getFieldError('name')).toBeNull();
      expect(vm.hasFieldError('name')).toBe(false);
    });

    it('should validate all fields and return result', () => {
      expect(vm.isValid).toBe(false);

      vm.updateField('name', 'Valid Role');
      vm.updateField('description', 'A valid description that meets minimum length');

      expect(vm.isValid).toBe(true);
    });

    it('should touch all fields', () => {
      vm.touchAllFields();

      expect(vm.touchedFields.has('name')).toBe(true);
      expect(vm.touchedFields.has('description')).toBe(true);
      expect(vm.touchedFields.has('orgHierarchyScope')).toBe(true);
    });
  });

  describe('Permission Selection', () => {
    let vm: RoleFormViewModel;

    beforeEach(() => {
      vm = new RoleFormViewModel(
        mockService,
        'create',
        mockPermissions,
        mockUserPermissionIds
      );
    });

    describe('subset-only enforcement', () => {
      it('should allow granting permissions user possesses', () => {
        expect(vm.canGrant('perm-1')).toBe(true);
        expect(vm.canGrant('perm-2')).toBe(true);
        expect(vm.canGrant('perm-3')).toBe(true);
      });

      it('should not allow granting permissions user does not possess', () => {
        expect(vm.canGrant('perm-4')).toBe(false);
      });

      it('should not toggle permission user cannot grant', () => {
        vm.togglePermission('perm-4');

        expect(vm.isPermissionSelected('perm-4')).toBe(false);
      });

      it('should not select permission user cannot grant', () => {
        vm.selectPermission('perm-4');

        expect(vm.isPermissionSelected('perm-4')).toBe(false);
      });
    });

    describe('togglePermission', () => {
      it('should select unselected permission', () => {
        vm.togglePermission('perm-1');

        expect(vm.isPermissionSelected('perm-1')).toBe(true);
      });

      it('should deselect selected permission', () => {
        vm.selectPermission('perm-1');
        vm.togglePermission('perm-1');

        expect(vm.isPermissionSelected('perm-1')).toBe(false);
      });

      it('should mark form as dirty', () => {
        vm.togglePermission('perm-1');

        expect(vm.isDirty).toBe(true);
      });

      it('should clear submission error', () => {
        vm.submissionError = 'Previous error';
        vm.togglePermission('perm-1');

        expect(vm.submissionError).toBeNull();
      });
    });

    describe('selectPermission / deselectPermission', () => {
      it('should select a permission', () => {
        vm.selectPermission('perm-1');

        expect(vm.isPermissionSelected('perm-1')).toBe(true);
        expect(vm.selectedPermissionCount).toBe(1);
      });

      it('should deselect a permission', () => {
        vm.selectPermission('perm-1');
        vm.deselectPermission('perm-1');

        expect(vm.isPermissionSelected('perm-1')).toBe(false);
        expect(vm.selectedPermissionCount).toBe(0);
      });
    });

    describe('applet operations', () => {
      it('should select all grantable permissions in applet', () => {
        vm.selectAllInApplet('medication');

        expect(vm.isPermissionSelected('perm-1')).toBe(true);
        expect(vm.isPermissionSelected('perm-2')).toBe(true);
      });

      it('should not select non-grantable permissions in applet', () => {
        // User can grant perm-3 (client.view) but not perm-4 (client.create)
        vm.selectAllInApplet('client');

        expect(vm.isPermissionSelected('perm-3')).toBe(true);
        expect(vm.isPermissionSelected('perm-4')).toBe(false);
      });

      it('should deselect all permissions in applet', () => {
        vm.selectAllInApplet('medication');
        vm.deselectAllInApplet('medication');

        expect(vm.isPermissionSelected('perm-1')).toBe(false);
        expect(vm.isPermissionSelected('perm-2')).toBe(false);
      });

      it('should toggle applet fully on', () => {
        vm.toggleApplet('medication');

        expect(vm.isAppletFullySelected('medication')).toBe(true);
      });

      it('should toggle applet off when fully selected', () => {
        vm.selectAllInApplet('medication');
        vm.toggleApplet('medication');

        expect(vm.isAppletFullySelected('medication')).toBe(false);
        expect(vm.getSelectedCountInApplet('medication')).toBe(0);
      });

      it('should detect partially selected applet', () => {
        vm.selectPermission('perm-1');

        expect(vm.isAppletPartiallySelected('medication')).toBe(true);
        expect(vm.isAppletFullySelected('medication')).toBe(false);
      });

      it('should detect fully selected applet', () => {
        vm.selectPermission('perm-1');
        vm.selectPermission('perm-2');

        expect(vm.isAppletFullySelected('medication')).toBe(true);
        expect(vm.isAppletPartiallySelected('medication')).toBe(false);
      });
    });

    describe('clearAllPermissions', () => {
      it('should clear all selections', () => {
        vm.selectPermission('perm-1');
        vm.selectPermission('perm-2');
        vm.selectPermission('perm-3');

        vm.clearAllPermissions();

        expect(vm.selectedPermissionCount).toBe(0);
      });
    });
  });

  describe('Dirty Tracking', () => {
    it('should detect name change', () => {
      const vm = new RoleFormViewModel(
        mockService,
        'edit',
        mockPermissions,
        mockUserPermissionIds,
        mockExistingRole
      );

      expect(vm.isDirty).toBe(false);
      vm.updateField('name', 'Changed Name');
      expect(vm.isDirty).toBe(true);
    });

    it('should detect description change', () => {
      const vm = new RoleFormViewModel(
        mockService,
        'edit',
        mockPermissions,
        mockUserPermissionIds,
        mockExistingRole
      );

      vm.updateField('description', 'Changed description here');
      expect(vm.isDirty).toBe(true);
    });

    it('should detect permission addition', () => {
      const vm = new RoleFormViewModel(
        mockService,
        'edit',
        mockPermissions,
        mockUserPermissionIds,
        mockExistingRole
      );

      vm.selectPermission('perm-3');
      expect(vm.isDirty).toBe(true);
    });

    it('should detect permission removal', () => {
      const vm = new RoleFormViewModel(
        mockService,
        'edit',
        mockPermissions,
        mockUserPermissionIds,
        mockExistingRole
      );

      vm.deselectPermission('perm-1');
      expect(vm.isDirty).toBe(true);
    });

    it('should not be dirty after changing back to original', () => {
      const vm = new RoleFormViewModel(
        mockService,
        'edit',
        mockPermissions,
        mockUserPermissionIds,
        mockExistingRole
      );

      vm.updateField('name', 'Changed');
      expect(vm.isDirty).toBe(true);

      vm.updateField('name', 'Existing Role');
      expect(vm.isDirty).toBe(false);
    });
  });

  describe('canSubmit', () => {
    let vm: RoleFormViewModel;

    beforeEach(() => {
      vm = new RoleFormViewModel(
        mockService,
        'create',
        mockPermissions,
        mockUserPermissionIds
      );
    });

    it('should be false when not dirty', () => {
      expect(vm.canSubmit).toBe(false);
    });

    it('should be false when form is invalid', () => {
      vm.updateField('name', 'Valid');
      // description is still empty/invalid
      expect(vm.canSubmit).toBe(false);
    });

    it('should be true when dirty and valid', () => {
      vm.updateField('name', 'Valid Role');
      vm.updateField('description', 'A valid description that meets minimum length');

      expect(vm.canSubmit).toBe(true);
    });

    it('should be false when submitting', () => {
      vm.updateField('name', 'Valid Role');
      vm.updateField('description', 'A valid description that meets minimum length');
      vm.isSubmitting = true;

      expect(vm.canSubmit).toBe(false);
    });
  });

  describe('Form Submission', () => {
    describe('create mode', () => {
      let vm: RoleFormViewModel;

      beforeEach(() => {
        vm = new RoleFormViewModel(
          mockService,
          'create',
          mockPermissions,
          mockUserPermissionIds
        );
      });

      it('should submit valid form', async () => {
        vm.updateField('name', 'New Role');
        vm.updateField('description', 'A valid description that meets minimum length');
        vm.selectPermission('perm-1');

        const result = await vm.submit();

        expect(result.success).toBe(true);
        expect(mockService.createRole).toHaveBeenCalledWith({
          name: 'New Role',
          description: 'A valid description that meets minimum length',
          orgHierarchyScope: undefined,
          permissionIds: ['perm-1'],
        });
      });

      it('should not submit invalid form', async () => {
        // Form is empty/invalid
        const result = await vm.submit();

        expect(result.success).toBe(false);
        expect(result.errorDetails?.code).toBe('VALIDATION_ERROR');
        expect(mockService.createRole).not.toHaveBeenCalled();
      });

      it('should set isSubmitting during submission', async () => {
        vm.updateField('name', 'New Role');
        vm.updateField('description', 'A valid description that meets minimum length');

        let wasSubmitting = false;
        vi.mocked(mockService.createRole).mockImplementation(async () => {
          wasSubmitting = vm.isSubmitting;
          return { success: true };
        });

        await vm.submit();

        expect(wasSubmitting).toBe(true);
        expect(vm.isSubmitting).toBe(false);
      });

      it('should update originals on success so form is not dirty', async () => {
        vm.updateField('name', 'New Role');
        vm.updateField('description', 'A valid description that meets minimum length');
        expect(vm.isDirty).toBe(true);

        await vm.submit();

        expect(vm.isDirty).toBe(false);
      });

      it('should handle submission error', async () => {
        vm.updateField('name', 'New Role');
        vm.updateField('description', 'A valid description that meets minimum length');

        vi.mocked(mockService.createRole).mockResolvedValue({
          success: false,
          error: 'Name already exists',
        });

        const result = await vm.submit();

        expect(result.success).toBe(false);
        expect(vm.submissionError).toBe('Name already exists');
      });

      it('should handle submission exception', async () => {
        vm.updateField('name', 'New Role');
        vm.updateField('description', 'A valid description that meets minimum length');

        vi.mocked(mockService.createRole).mockRejectedValue(new Error('Network error'));

        const result = await vm.submit();

        expect(result.success).toBe(false);
        expect(vm.submissionError).toBe('Network error');
        expect(vm.isSubmitting).toBe(false);
      });
    });

    describe('edit mode', () => {
      let vm: RoleFormViewModel;

      beforeEach(() => {
        vm = new RoleFormViewModel(
          mockService,
          'edit',
          mockPermissions,
          mockUserPermissionIds,
          mockExistingRole
        );
      });

      it('should submit updated role', async () => {
        vm.updateField('name', 'Updated Role Name');

        const result = await vm.submit();

        expect(result.success).toBe(true);
        expect(mockService.updateRole).toHaveBeenCalledWith({
          id: 'role-1',
          name: 'Updated Role Name',
          description: 'This is an existing role for editing',
          permissionIds: ['perm-1', 'perm-2'],
        });
      });

      it('should include updated permissions', async () => {
        vm.selectPermission('perm-3');

        const result = await vm.submit();

        expect(result.success).toBe(true);
        expect(mockService.updateRole).toHaveBeenCalledWith(
          expect.objectContaining({
            permissionIds: expect.arrayContaining(['perm-1', 'perm-2', 'perm-3']),
          })
        );
      });
    });
  });

  describe('Form Reset', () => {
    it('should reset to original values', () => {
      const vm = new RoleFormViewModel(
        mockService,
        'edit',
        mockPermissions,
        mockUserPermissionIds,
        mockExistingRole
      );

      vm.updateField('name', 'Changed Name');
      vm.selectPermission('perm-3');
      vm.submissionError = 'Some error';
      vm.touchAllFields();

      vm.reset();

      expect(vm.formData.name).toBe('Existing Role');
      expect(vm.isPermissionSelected('perm-3')).toBe(false);
      expect(vm.errors.size).toBe(0);
      expect(vm.touchedFields.size).toBe(0);
      expect(vm.submissionError).toBeNull();
      expect(vm.isDirty).toBe(false);
    });
  });

  describe('Permission Groups', () => {
    it('should group permissions by applet', () => {
      const vm = new RoleFormViewModel(
        mockService,
        'create',
        mockPermissions,
        mockUserPermissionIds
      );

      const groups = vm.permissionGroups;

      expect(groups.length).toBe(2);
      expect(groups.find((g) => g.applet === 'medication')).toBeDefined();
      expect(groups.find((g) => g.applet === 'client')).toBeDefined();
    });
  });

  describe('setScope', () => {
    it('should set organizational unit scope', () => {
      const vm = new RoleFormViewModel(
        mockService,
        'create',
        mockPermissions,
        mockUserPermissionIds
      );

      vm.setScope('root.org1.facility1');

      expect(vm.formData.orgHierarchyScope).toBe('root.org1.facility1');
    });

    it('should clear scope when set to null', () => {
      const vm = new RoleFormViewModel(
        mockService,
        'create',
        mockPermissions,
        mockUserPermissionIds
      );

      vm.setScope('root.org1');
      vm.setScope(null);

      expect(vm.formData.orgHierarchyScope).toBeNull();
    });
  });
});
