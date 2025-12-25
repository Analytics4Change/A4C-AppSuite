/**
 * Role Types Unit Tests
 *
 * Tests for validation functions and helper utilities in role.types.ts
 */

import { describe, it, expect } from 'vitest';
import {
  validateRoleName,
  validateRoleDescription,
  canGrantPermission,
  groupPermissionsByApplet,
  ROLE_VALIDATION,
  APPLET_DISPLAY_NAMES,
  type Permission,
} from './role.types';

describe('validateRoleName', () => {
  describe('valid names', () => {
    it('should accept a simple valid name', () => {
      expect(validateRoleName('Admin')).toBeNull();
    });

    it('should accept a name with numbers', () => {
      expect(validateRoleName('Admin2')).toBeNull();
    });

    it('should accept a name with underscores', () => {
      expect(validateRoleName('provider_admin')).toBeNull();
    });

    it('should accept a name with hyphens', () => {
      expect(validateRoleName('super-admin')).toBeNull();
    });

    it('should accept a name with spaces', () => {
      expect(validateRoleName('Provider Admin')).toBeNull();
    });

    it('should accept a name at max length', () => {
      const maxName = 'A'.repeat(ROLE_VALIDATION.name.maxLength);
      expect(validateRoleName(maxName)).toBeNull();
    });

    it('should accept a single character name', () => {
      expect(validateRoleName('A')).toBeNull();
    });
  });

  describe('invalid names', () => {
    it('should reject an empty name', () => {
      const result = validateRoleName('');
      expect(result).toBe('Role name is required');
    });

    it('should reject a whitespace-only name', () => {
      const result = validateRoleName('   ');
      expect(result).toBe('Role name is required');
    });

    it('should reject a name starting with a number', () => {
      const result = validateRoleName('1Admin');
      expect(result).toBe(ROLE_VALIDATION.name.message);
    });

    it('should reject a name starting with an underscore', () => {
      const result = validateRoleName('_admin');
      expect(result).toBe(ROLE_VALIDATION.name.message);
    });

    it('should reject a name with special characters', () => {
      const result = validateRoleName('Admin@Role');
      expect(result).toBe(ROLE_VALIDATION.name.message);
    });

    it('should reject a name exceeding max length', () => {
      const longName = 'A'.repeat(ROLE_VALIDATION.name.maxLength + 1);
      const result = validateRoleName(longName);
      expect(result).toContain('100 characters or less');
    });

    it('should reject a name with periods', () => {
      const result = validateRoleName('admin.role');
      expect(result).toBe(ROLE_VALIDATION.name.message);
    });
  });
});

describe('validateRoleDescription', () => {
  describe('valid descriptions', () => {
    it('should accept a valid description at minimum length', () => {
      const minDesc = 'A'.repeat(ROLE_VALIDATION.description.minLength);
      expect(validateRoleDescription(minDesc)).toBeNull();
    });

    it('should accept a valid description at maximum length', () => {
      const maxDesc = 'A'.repeat(ROLE_VALIDATION.description.maxLength);
      expect(validateRoleDescription(maxDesc)).toBeNull();
    });

    it('should accept a typical description', () => {
      const desc = 'Administrator role with full access to all system features';
      expect(validateRoleDescription(desc)).toBeNull();
    });
  });

  describe('invalid descriptions', () => {
    it('should reject an empty description', () => {
      const result = validateRoleDescription('');
      expect(result).toBe('Description is required');
    });

    it('should reject a whitespace-only description', () => {
      const result = validateRoleDescription('     ');
      expect(result).toBe('Description is required');
    });

    it('should reject a description shorter than minimum', () => {
      const shortDesc = 'A'.repeat(ROLE_VALIDATION.description.minLength - 1);
      const result = validateRoleDescription(shortDesc);
      expect(result).toContain('at least 10 characters');
    });

    it('should reject a description exceeding maximum length', () => {
      const longDesc = 'A'.repeat(ROLE_VALIDATION.description.maxLength + 1);
      const result = validateRoleDescription(longDesc);
      expect(result).toContain('500 characters or less');
    });
  });
});

describe('canGrantPermission', () => {
  it('should return true when user has the permission', () => {
    const userPermissions = new Set(['perm-1', 'perm-2', 'perm-3']);
    expect(canGrantPermission('perm-2', userPermissions)).toBe(true);
  });

  it('should return false when user does not have the permission', () => {
    const userPermissions = new Set(['perm-1', 'perm-2']);
    expect(canGrantPermission('perm-3', userPermissions)).toBe(false);
  });

  it('should return false for empty permission set', () => {
    const userPermissions = new Set<string>();
    expect(canGrantPermission('perm-1', userPermissions)).toBe(false);
  });

  it('should handle UUID-style permission IDs', () => {
    const userPermissions = new Set(['550e8400-e29b-41d4-a716-446655440000']);
    expect(
      canGrantPermission('550e8400-e29b-41d4-a716-446655440000', userPermissions)
    ).toBe(true);
    expect(
      canGrantPermission('550e8400-e29b-41d4-a716-446655440001', userPermissions)
    ).toBe(false);
  });
});

describe('groupPermissionsByApplet', () => {
  const mockPermissions: Permission[] = [
    {
      id: '1',
      name: 'medication.create',
      applet: 'medication',
      action: 'create',
      description: 'Create medications',
      scopeType: 'org',
    },
    {
      id: '2',
      name: 'medication.view',
      applet: 'medication',
      action: 'view',
      description: 'View medications',
      scopeType: 'org',
    },
    {
      id: '3',
      name: 'client.view',
      applet: 'client',
      action: 'view',
      description: 'View clients',
      scopeType: 'org',
    },
    {
      id: '4',
      name: 'client.create',
      applet: 'client',
      action: 'create',
      description: 'Create clients',
      scopeType: 'org',
    },
    {
      id: '5',
      name: 'unknown_applet.action',
      applet: 'unknown_applet',
      action: 'action',
      description: 'Unknown action',
      scopeType: 'global',
    },
  ];

  it('should group permissions by applet', () => {
    const groups = groupPermissionsByApplet(mockPermissions);

    expect(groups.length).toBe(3);
    expect(groups.map((g) => g.applet).sort()).toEqual([
      'client',
      'medication',
      'unknown_applet',
    ]);
  });

  it('should use display names from APPLET_DISPLAY_NAMES', () => {
    const groups = groupPermissionsByApplet(mockPermissions);

    const medicationGroup = groups.find((g) => g.applet === 'medication');
    const clientGroup = groups.find((g) => g.applet === 'client');

    expect(medicationGroup?.displayName).toBe(APPLET_DISPLAY_NAMES.medication);
    expect(clientGroup?.displayName).toBe(APPLET_DISPLAY_NAMES.client);
  });

  it('should convert unknown applet names to Title Case', () => {
    const groups = groupPermissionsByApplet(mockPermissions);

    const unknownGroup = groups.find((g) => g.applet === 'unknown_applet');
    expect(unknownGroup?.displayName).toBe('Unknown Applet');
  });

  it('should sort permissions within group by action', () => {
    const groups = groupPermissionsByApplet(mockPermissions);

    const medicationGroup = groups.find((g) => g.applet === 'medication');
    expect(medicationGroup?.permissions[0].action).toBe('create');
    expect(medicationGroup?.permissions[1].action).toBe('view');
  });

  it('should sort groups alphabetically by display name', () => {
    const groups = groupPermissionsByApplet(mockPermissions);

    // Client Records comes before Medication Management alphabetically
    expect(groups[0].displayName).toBe('Client Records');
    expect(groups[1].displayName).toBe('Medication Management');
  });

  it('should handle empty permission array', () => {
    const groups = groupPermissionsByApplet([]);
    expect(groups).toEqual([]);
  });

  it('should handle single permission', () => {
    const groups = groupPermissionsByApplet([mockPermissions[0]]);

    expect(groups.length).toBe(1);
    expect(groups[0].applet).toBe('medication');
    expect(groups[0].permissions.length).toBe(1);
  });

  it('should include all permissions in their respective groups', () => {
    const groups = groupPermissionsByApplet(mockPermissions);

    const totalPermissions = groups.reduce(
      (sum, group) => sum + group.permissions.length,
      0
    );
    expect(totalPermissions).toBe(mockPermissions.length);
  });
});
