/**
 * Data-driven role configuration
 * Defines bootstrap roles and their permissions
 */

import { PERMISSIONS } from './permissions.config';

export interface RoleDefinition {
  key: string;
  displayName: string;
  description: string;
  scope: 'global' | 'organization';
  permissions: string[];  // Permission IDs from permissions.config.ts
  canCreateRoles?: boolean;
  canGrantCrossOrg?: boolean;
  canImpersonate?: boolean;
  isSystemRole?: boolean;  // Cannot be deleted
}

/**
 * Global roles that are bootstrapped at the project level
 * These apply across all organizations
 */
export const GLOBAL_ROLES: Record<string, RoleDefinition> = {
  super_admin: {
    key: 'super_admin',
    displayName: 'Super Administrator',
    description: 'Full platform control with ability to manage all providers and settings',
    scope: 'global',
    permissions: [
      // All global permissions
      'provider.create',
      'provider.read',
      'provider.update',
      'provider.delete',
      'provider.clone',
      'client.create',
      'client.read',
      'client.update',
      'client.delete',
      'global_roles.create',
      'cross_org.grant',
      'users.impersonate',
      // Plus all organization permissions when in org context
      // These are granted dynamically based on context
    ],
    canCreateRoles: true,
    canGrantCrossOrg: true,
    canImpersonate: true,
    isSystemRole: true
  },

  partner_onboarder: {
    key: 'partner_onboarder',
    displayName: 'Partner Onboarder',
    description: 'Can create and manage new provider organizations',
    scope: 'global',
    permissions: [
      'provider.create',
      'provider.read',
      'provider.update',
      'provider.clone'
    ],
    canCreateRoles: false,
    canGrantCrossOrg: false,
    canImpersonate: false,
    isSystemRole: true
  }
};

/**
 * Organization role template that is created for each new provider
 * This is the default administrator role for organizations
 */
export const ORGANIZATION_ROLE_TEMPLATE: RoleDefinition = {
  key: 'administrator',
  displayName: 'Administrator',
  description: 'Full control within the organization including role and user management',
  scope: 'organization',
  permissions: [
    // All organization-level permissions
    'medication.create',
    'medication.read',
    'medication.update',
    'medication.delete',
    'medication.create_template',
    'org_client.create',
    'org_client.read',
    'org_client.update',
    'org_client.delete',
    'org_client.transfer',
    'org_roles.create',
    'org_roles.assign',
    'reports.view',
    'reports.create',
    'reports.export',
    'settings.view',
    'settings.manage',
    'users.invite',
    'users.manage',
    'users.deactivate',
    'appointments.create',
    'appointments.read',
    'appointments.update',
    'appointments.delete',
    'assessments.create',
    'assessments.read',
    'assessments.update',
    'assessments.approve',
    'incidents.create',
    'incidents.read',
    'incidents.update',
    'incidents.close',
    'billing.view',
    'billing.manage',
    'billing.export',
    'audit.view',
    'audit.export'
  ],
  canCreateRoles: true,  // Can create org-specific roles
  canGrantCrossOrg: false,
  canImpersonate: false,
  isSystemRole: true  // Cannot be deleted from organizations
};

/**
 * All bootstrap roles (global + org template)
 */
export const BOOTSTRAP_ROLES = {
  ...GLOBAL_ROLES,
  administrator: ORGANIZATION_ROLE_TEMPLATE
};

/**
 * Role hierarchy for permission inheritance
 * Higher levels inherit permissions from lower levels
 */
export const ROLE_HIERARCHY = {
  global: ['super_admin', 'partner_onboarder'],
  organization: ['administrator']  // Custom org roles will be added dynamically
};

/**
 * Get all permissions for a role, including inherited permissions
 */
export function getRolePermissions(roleKey: string): string[] {
  const role = BOOTSTRAP_ROLES[roleKey];
  if (!role) return [];

  const permissions = new Set(role.permissions);

  // Super admin gets all permissions when in org context
  if (roleKey === 'super_admin') {
    // Add all organization-scoped permissions
    Object.values(PERMISSIONS).forEach(permission => {
      if (permission.scope === 'organization') {
        permissions.add(permission.id);
      }
    });
  }

  return Array.from(permissions);
}

/**
 * Check if a role has a specific permission
 */
export function roleHasPermission(roleKey: string, permissionId: string): boolean {
  const permissions = getRolePermissions(roleKey);
  return permissions.includes(permissionId);
}

/**
 * Get roles that can be created by a given role
 */
export function getCreatableRoles(roleKey: string): string[] {
  const role = BOOTSTRAP_ROLES[roleKey];
  if (!role || !role.canCreateRoles) return [];

  if (role.scope === 'global') {
    // Global roles can create other global roles
    return Object.keys(GLOBAL_ROLES).filter(key => key !== roleKey);
  } else {
    // Organization roles can only create custom org roles (not defined here)
    return [];
  }
}

/**
 * Validate role definition
 */
export function validateRoleDefinition(role: RoleDefinition): string[] {
  const errors: string[] = [];

  if (!role.key) {
    errors.push('Role key is required');
  }

  if (!role.displayName) {
    errors.push('Role display name is required');
  }

  if (!role.scope) {
    errors.push('Role scope is required');
  }

  // Validate permissions exist
  role.permissions.forEach(permissionId => {
    if (!PERMISSIONS[permissionId]) {
      errors.push(`Permission '${permissionId}' does not exist`);
    }
  });

  // Validate scope consistency
  const invalidScopePermissions = role.permissions.filter(permissionId => {
    const permission = PERMISSIONS[permissionId];
    return permission && role.scope === 'organization' && permission.scope === 'global';
  });

  if (invalidScopePermissions.length > 0) {
    errors.push(`Organization role cannot have global permissions: ${invalidScopePermissions.join(', ')}`);
  }

  return errors;
}

/**
 * Export role definition for external systems
 */
export function exportRoleDefinition(role: RoleDefinition) {
  return {
    key: role.key,
    displayName: role.displayName,
    group: role.scope === 'global' ? 'global' : `org_${role.key}`,
    permissions: role.permissions,
  };
}

/**
 * Menu items accessible by role
 * Used for dynamic menu rendering
 */
export const ROLE_MENU_ACCESS: Record<string, string[]> = {
  super_admin: [
    '/clients',
    '/providers',
    '/medications',
    '/reports',
    '/settings',
    '/admin'
  ],
  partner_onboarder: [
    '/providers',
    '/reports'
  ],
  administrator: [
    '/clients',
    '/medications',
    '/reports',
    '/settings'
  ]
  // Custom org roles will be added dynamically based on their permissions
};

/**
 * Get menu items for a role based on permissions
 */
export function getMenuItemsForRole(roleKey: string, permissions?: string[]): string[] {
  // Use predefined menu access if available
  if (ROLE_MENU_ACCESS[roleKey]) {
    return ROLE_MENU_ACCESS[roleKey];
  }

  // Otherwise determine based on permissions
  const menuItems: string[] = [];
  const rolePermissions = permissions || getRolePermissions(roleKey);

  // Map permissions to menu items
  if (rolePermissions.some(p => p.startsWith('provider.'))) {
    menuItems.push('/providers');
  }
  if (rolePermissions.some(p => p.startsWith('org_client.') || p.startsWith('client.'))) {
    menuItems.push('/clients');
  }
  if (rolePermissions.some(p => p.startsWith('medication.'))) {
    menuItems.push('/medications');
  }
  if (rolePermissions.some(p => p.startsWith('reports.'))) {
    menuItems.push('/reports');
  }
  if (rolePermissions.some(p => p.startsWith('settings.') || p.startsWith('org_roles.'))) {
    menuItems.push('/settings');
  }
  if (rolePermissions.some(p => p.startsWith('global_roles.'))) {
    menuItems.push('/admin');
  }

  return menuItems;
}