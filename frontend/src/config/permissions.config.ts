/**
 * Data-driven permission system configuration
 * All permissions are defined here and stored in the database
 *
 * IMPORTANT: This file is aligned to the database permissions_projection table.
 * Do NOT add permissions here that don't exist in the database.
 *
 * Canonical permissions (35 total in database):
 * - Organization Global (7): activate, create, create_root, deactivate, delete, search, suspend
 * - Organization Org (8): view, update, view_ou, create_ou, update_ou, delete_ou, deactivate_ou, reactivate_ou
 * - Permission (3): grant, revoke, view
 * - Client (4): create, view, update, delete
 * - Medication (5): administer, create, view, update, delete
 * - Role (4): create, view, update, delete
 * - User (6): create, view, update, delete, role_assign, role_revoke
 *
 * Frontend-only extensions (not in DB):
 * - client.transfer, medication.create_template, global_roles.create,
 *   cross_org.grant, users.impersonate
 *
 * See: documentation/architecture/authorization/permissions-reference.md
 */

export interface Permission {
  id: string;
  category: string;
  resource: string;
  action: string;
  displayName: string;
  description: string;
  scope: 'global' | 'organization';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface PermissionGroup {
  id: string;
  displayName: string;
  description: string;
  permissions: string[];  // Permission IDs
  suggestedFor: string[]; // Role suggestions
}

/**
 * All system permissions - aligned to database permissions_projection
 * These are stored in the database and used for authorization
 */
export const PERMISSIONS: Record<string, Permission> = {
  // ============================================
  // Global Level Permissions (Platform-wide)
  // ============================================

  // Organization Management (Global)
  'organization.create': {
    id: 'organization.create',
    category: 'Organization Management',
    resource: 'organization',
    action: 'create',
    displayName: 'Create Organization',
    description: 'Create new tenant organizations (bootstrap)',
    scope: 'global',
    riskLevel: 'high'
  },
  // NOTE: organization.create_sub removed - sub-orgs are now organization units
  'organization.deactivate': {
    id: 'organization.deactivate',
    category: 'Organization Management',
    resource: 'organization',
    action: 'deactivate',
    displayName: 'Deactivate Organization',
    description: 'Deactivate organizations',
    scope: 'global',
    riskLevel: 'high'
  },
  'organization.delete': {
    id: 'organization.delete',
    category: 'Organization Management',
    resource: 'organization',
    action: 'delete',
    displayName: 'Delete Organization',
    description: 'Permanently delete organizations',
    scope: 'global',
    riskLevel: 'critical'
  },

  // Role Management (Global)
  'global_roles.create': {
    id: 'global_roles.create',
    category: 'Role Management',
    resource: 'global_roles',
    action: 'create',
    displayName: 'Create Global Roles',
    description: 'Create platform-wide roles',
    scope: 'global',
    riskLevel: 'critical'
  },
  'cross_org.grant': {
    id: 'cross_org.grant',
    category: 'Role Management',
    resource: 'cross_org',
    action: 'grant',
    displayName: 'Grant Cross-Org Access',
    description: 'Grant access across multiple organizations',
    scope: 'global',
    riskLevel: 'critical'
  },

  // User Management (Global)
  'users.impersonate': {
    id: 'users.impersonate',
    category: 'User Management',
    resource: 'users',
    action: 'impersonate',
    displayName: 'Impersonate Users',
    description: 'Temporarily act as another user for support',
    scope: 'global',
    riskLevel: 'critical'
  },

  // ============================================
  // Organization Level Permissions
  // ============================================

  // Organization Management (Org-scoped)
  'organization.view_ou': {
    id: 'organization.view_ou',
    category: 'Organization Management',
    resource: 'organization',
    action: 'view_ou',
    displayName: 'View Hierarchy',
    description: 'View organization unit hierarchy',
    scope: 'organization',
    riskLevel: 'low'
  },
  'organization.create_ou': {
    id: 'organization.create_ou',
    category: 'Organization Management',
    resource: 'organization',
    action: 'create_ou',
    displayName: 'Create Unit',
    description: 'Create organization units within hierarchy',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'organization.update_ou': {
    id: 'organization.update_ou',
    category: 'Organization Management',
    resource: 'organization',
    action: 'update_ou',
    displayName: 'Update Unit',
    description: 'Update organization unit details',
    scope: 'organization',
    riskLevel: 'low'
  },
  'organization.delete_ou': {
    id: 'organization.delete_ou',
    category: 'Organization Management',
    resource: 'organization',
    action: 'delete_ou',
    displayName: 'Delete Unit',
    description: 'Delete organization units',
    scope: 'organization',
    riskLevel: 'high'
  },
  'organization.deactivate_ou': {
    id: 'organization.deactivate_ou',
    category: 'Organization Management',
    resource: 'organization',
    action: 'deactivate_ou',
    displayName: 'Deactivate Unit',
    description: 'Deactivate organization units (cascade to children)',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'organization.reactivate_ou': {
    id: 'organization.reactivate_ou',
    category: 'Organization Management',
    resource: 'organization',
    action: 'reactivate_ou',
    displayName: 'Reactivate Unit',
    description: 'Reactivate organization units (cascade to children)',
    scope: 'organization',
    riskLevel: 'low'
  },
  'organization.view': {
    id: 'organization.view',
    category: 'Organization Management',
    resource: 'organization',
    action: 'view',
    displayName: 'View Settings',
    description: 'View organization settings',
    scope: 'organization',
    riskLevel: 'low'
  },
  'organization.update': {
    id: 'organization.update',
    category: 'Organization Management',
    resource: 'organization',
    action: 'update',
    displayName: 'Update Settings',
    description: 'Update organization settings',
    scope: 'organization',
    riskLevel: 'medium'
  },

  // Client Management (Org-scoped) - aligned to database naming
  'client.create': {
    id: 'client.create',
    category: 'Client Management',
    resource: 'client',
    action: 'create',
    displayName: 'Create Client',
    description: 'Add new clients to the organization',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'client.view': {
    id: 'client.view',
    category: 'Client Management',
    resource: 'client',
    action: 'view',
    displayName: 'View Clients',
    description: 'View client information',
    scope: 'organization',
    riskLevel: 'low'
  },
  'client.update': {
    id: 'client.update',
    category: 'Client Management',
    resource: 'client',
    action: 'update',
    displayName: 'Update Client',
    description: 'Modify client information',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'client.delete': {
    id: 'client.delete',
    category: 'Client Management',
    resource: 'client',
    action: 'delete',
    displayName: 'Delete Client',
    description: 'Remove clients from organization',
    scope: 'organization',
    riskLevel: 'high'
  },
  'client.transfer': {
    id: 'client.transfer',
    category: 'Client Management',
    resource: 'client',
    action: 'transfer',
    displayName: 'Transfer Client',
    description: 'Transfer clients between sub-providers',
    scope: 'organization',
    riskLevel: 'medium'
  },

  // Medication Management (Org-scoped) - aligned to database naming
  'medication.create': {
    id: 'medication.create',
    category: 'Medication Management',
    resource: 'medication',
    action: 'create',
    displayName: 'Create Medication',
    description: 'Add new medications for clients',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'medication.view': {
    id: 'medication.view',
    category: 'Medication Management',
    resource: 'medication',
    action: 'view',
    displayName: 'View Medications',
    description: 'View client medications',
    scope: 'organization',
    riskLevel: 'low'
  },
  'medication.update': {
    id: 'medication.update',
    category: 'Medication Management',
    resource: 'medication',
    action: 'update',
    displayName: 'Update Medication',
    description: 'Modify medication information',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'medication.delete': {
    id: 'medication.delete',
    category: 'Medication Management',
    resource: 'medication',
    action: 'delete',
    displayName: 'Delete Medication',
    description: 'Remove medications',
    scope: 'organization',
    riskLevel: 'high'
  },
  'medication.create_template': {
    id: 'medication.create_template',
    category: 'Medication Management',
    resource: 'medication',
    action: 'create_template',
    displayName: 'Create Medication Template',
    description: 'Create reusable medication templates from existing medications',
    scope: 'organization',
    riskLevel: 'low'
  },

  // Role Management (Org-scoped) - aligned to database naming
  // NOTE: role.assign removed - use user.role_assign instead
  'role.create': {
    id: 'role.create',
    category: 'Role Management',
    resource: 'role',
    action: 'create',
    displayName: 'Create Role',
    description: 'Create custom roles for the organization',
    scope: 'organization',
    riskLevel: 'high'
  },
  'role.view': {
    id: 'role.view',
    category: 'Role Management',
    resource: 'role',
    action: 'view',
    displayName: 'View Roles',
    description: 'View roles within organization',
    scope: 'organization',
    riskLevel: 'low'
  },

  // User Management (Org-scoped) - aligned to database naming
  'user.create': {
    id: 'user.create',
    category: 'User Management',
    resource: 'user',
    action: 'create',
    displayName: 'Create Users',
    description: 'Create new users in the organization',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'user.view': {
    id: 'user.view',
    category: 'User Management',
    resource: 'user',
    action: 'view',
    displayName: 'View Users',
    description: 'View users within organization',
    scope: 'organization',
    riskLevel: 'low'
  },
  'user.update': {
    id: 'user.update',
    category: 'User Management',
    resource: 'user',
    action: 'update',
    displayName: 'Update Users',
    description: 'Modify user information within organization',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'user.role_assign': {
    id: 'user.role_assign',
    category: 'User Management',
    resource: 'user',
    action: 'role_assign',
    displayName: 'Assign Role',
    description: 'Assign roles to users within organization',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'user.role_revoke': {
    id: 'user.role_revoke',
    category: 'User Management',
    resource: 'user',
    action: 'role_revoke',
    displayName: 'Revoke Role',
    description: 'Revoke roles from users within organization',
    scope: 'organization',
    riskLevel: 'medium'
  }
};

/**
 * Permission groups for easier role assignment
 * Updated to use database-aligned permission names
 */
export const PERMISSION_GROUPS: Record<string, PermissionGroup> = {
  'clinical_basic': {
    id: 'clinical_basic',
    displayName: 'Basic Clinical',
    description: 'View and document basic client care',
    permissions: [
      'client.view',
      'medication.view'
    ],
    suggestedFor: ['caregiver', 'viewer']
  },

  'clinical_full': {
    id: 'clinical_full',
    displayName: 'Full Clinical',
    description: 'Complete clinical management capabilities',
    permissions: [
      'client.create',
      'client.view',
      'client.update',
      'medication.create',
      'medication.view',
      'medication.update',
      'medication.create_template'
    ],
    suggestedFor: ['nurse', 'clinician']
  },

  'management': {
    id: 'management',
    displayName: 'Management',
    description: 'Full organization management capabilities',
    permissions: [
      'organization.view_ou',
      'organization.create_ou',
      'organization.update_ou',
      'organization.delete_ou',
      'organization.deactivate_ou',
      'organization.reactivate_ou',
      'organization.view',
      'organization.update',
      'client.create',
      'client.view',
      'client.update',
      'client.delete',
      'medication.create',
      'medication.view',
      'medication.update',
      'medication.delete',
      'role.create',
      'role.view',
      'user.create',
      'user.view',
      'user.update',
      'user.role_assign',
      'user.role_revoke'
    ],
    suggestedFor: ['provider_admin']
  }
};

/**
 * Get permissions by category
 */
export function getPermissionsByCategory(category: string): Permission[] {
  return Object.values(PERMISSIONS).filter(p => p.category === category);
}

/**
 * Get permissions by scope
 */
export function getPermissionsByScope(scope: 'global' | 'organization'): Permission[] {
  return Object.values(PERMISSIONS).filter(p => p.scope === scope);
}

/**
 * Get permissions by resource
 */
export function getPermissionsByResource(resource: string): Permission[] {
  return Object.values(PERMISSIONS).filter(p => p.resource === resource);
}

/**
 * Get all unique categories
 */
export function getCategories(): string[] {
  return [...new Set(Object.values(PERMISSIONS).map(p => p.category))];
}

/**
 * Check if a permission exists
 */
export function hasPermission(permissionId: string, userPermissions: string[]): boolean {
  return userPermissions.includes(permissionId);
}

/**
 * Get permission group permissions
 */
export function getGroupPermissions(groupId: string): Permission[] {
  const group = PERMISSION_GROUPS[groupId];
  if (!group) return [];
  return group.permissions
    .map(id => PERMISSIONS[id])
    .filter(Boolean);
}
