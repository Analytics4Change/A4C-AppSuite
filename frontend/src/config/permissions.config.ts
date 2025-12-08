/**
 * Data-driven permission system configuration
 * All permissions are defined here and stored in the database
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
 * All system permissions
 * These are stored in the database and used for authorization
 */
export const PERMISSIONS: Record<string, Permission> = {
  // ============================================
  // Global Level Permissions (Platform-wide)
  // ============================================

  // Organization Management
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
  'organization.create_ou': {
    id: 'organization.create_ou',
    category: 'Organization Management',
    resource: 'organization',
    action: 'create_ou',
    displayName: 'Create Organizational Unit',
    description: 'Create organizational units (departments, locations, campuses) within hierarchy',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'organization.view': {
    id: 'organization.view',
    category: 'Organization Management',
    resource: 'organization',
    action: 'view',
    displayName: 'View Organizations',
    description: 'View organization information',
    scope: 'global',
    riskLevel: 'low'
  },
  'organization.update': {
    id: 'organization.update',
    category: 'Organization Management',
    resource: 'organization',
    action: 'update',
    displayName: 'Update Organization',
    description: 'Modify organization information',
    scope: 'organization',
    riskLevel: 'medium'
  },
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
  'organization.business_profile_create': {
    id: 'organization.business_profile_create',
    category: 'Organization Management',
    resource: 'organization',
    action: 'business_profile_create',
    displayName: 'Create Business Profile',
    description: 'Create business profiles for organizations',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'organization.business_profile_update': {
    id: 'organization.business_profile_update',
    category: 'Organization Management',
    resource: 'organization',
    action: 'business_profile_update',
    displayName: 'Update Business Profile',
    description: 'Modify business profiles',
    scope: 'organization',
    riskLevel: 'medium'
  },

  // Client Management (Global)
  'client.create': {
    id: 'client.create',
    category: 'Client Management',
    resource: 'client',
    action: 'create',
    displayName: 'Create Client (Global)',
    description: 'Create clients across any provider',
    scope: 'global',
    riskLevel: 'high'
  },
  'client.read': {
    id: 'client.read',
    category: 'Client Management',
    resource: 'client',
    action: 'read',
    displayName: 'View Clients (Global)',
    description: 'View clients across all providers',
    scope: 'global',
    riskLevel: 'medium'
  },
  'client.update': {
    id: 'client.update',
    category: 'Client Management',
    resource: 'client',
    action: 'update',
    displayName: 'Update Client (Global)',
    description: 'Modify client information across providers',
    scope: 'global',
    riskLevel: 'high'
  },
  'client.delete': {
    id: 'client.delete',
    category: 'Client Management',
    resource: 'client',
    action: 'delete',
    displayName: 'Delete Client (Global)',
    description: 'Remove clients from any provider',
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

  // Medication Management
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
  'medication.read': {
    id: 'medication.read',
    category: 'Medication Management',
    resource: 'medication',
    action: 'read',
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

  // Client Management (Organization)
  'org_client.create': {
    id: 'org_client.create',
    category: 'Client Management',
    resource: 'org_client',
    action: 'create',
    displayName: 'Create Client',
    description: 'Add new clients to the organization',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'org_client.read': {
    id: 'org_client.read',
    category: 'Client Management',
    resource: 'org_client',
    action: 'read',
    displayName: 'View Clients',
    description: 'View client information',
    scope: 'organization',
    riskLevel: 'low'
  },
  'org_client.update': {
    id: 'org_client.update',
    category: 'Client Management',
    resource: 'org_client',
    action: 'update',
    displayName: 'Update Client',
    description: 'Modify client information',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'org_client.delete': {
    id: 'org_client.delete',
    category: 'Client Management',
    resource: 'org_client',
    action: 'delete',
    displayName: 'Delete Client',
    description: 'Remove clients from organization',
    scope: 'organization',
    riskLevel: 'high'
  },
  'org_client.transfer': {
    id: 'org_client.transfer',
    category: 'Client Management',
    resource: 'org_client',
    action: 'transfer',
    displayName: 'Transfer Client',
    description: 'Transfer clients between sub-providers',
    scope: 'organization',
    riskLevel: 'medium'
  },

  // Organization Role Management
  'org_roles.create': {
    id: 'org_roles.create',
    category: 'Role Management',
    resource: 'org_roles',
    action: 'create',
    displayName: 'Create Organization Roles',
    description: 'Create custom roles for the organization',
    scope: 'organization',
    riskLevel: 'high'
  },
  'org_roles.assign': {
    id: 'org_roles.assign',
    category: 'Role Management',
    resource: 'org_roles',
    action: 'assign',
    displayName: 'Assign Roles',
    description: 'Assign roles to users within organization',
    scope: 'organization',
    riskLevel: 'medium'
  },

  // Reports
  'reports.view': {
    id: 'reports.view',
    category: 'Reports',
    resource: 'reports',
    action: 'view',
    displayName: 'View Reports',
    description: 'Access organization reports',
    scope: 'organization',
    riskLevel: 'low'
  },
  'reports.create': {
    id: 'reports.create',
    category: 'Reports',
    resource: 'reports',
    action: 'create',
    displayName: 'Create Reports',
    description: 'Generate new reports',
    scope: 'organization',
    riskLevel: 'low'
  },
  'reports.export': {
    id: 'reports.export',
    category: 'Reports',
    resource: 'reports',
    action: 'export',
    displayName: 'Export Reports',
    description: 'Export reports to external formats',
    scope: 'organization',
    riskLevel: 'medium'
  },

  // Settings
  'settings.view': {
    id: 'settings.view',
    category: 'Settings',
    resource: 'settings',
    action: 'view',
    displayName: 'View Settings',
    description: 'View organization settings',
    scope: 'organization',
    riskLevel: 'low'
  },
  'settings.manage': {
    id: 'settings.manage',
    category: 'Settings',
    resource: 'settings',
    action: 'manage',
    displayName: 'Manage Settings',
    description: 'Modify organization settings',
    scope: 'organization',
    riskLevel: 'high'
  },

  // User Management (Organization)
  'users.invite': {
    id: 'users.invite',
    category: 'User Management',
    resource: 'users',
    action: 'invite',
    displayName: 'Invite Users',
    description: 'Invite new users to organization',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'users.manage': {
    id: 'users.manage',
    category: 'User Management',
    resource: 'users',
    action: 'manage',
    displayName: 'Manage Users',
    description: 'Manage user accounts within organization',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'users.deactivate': {
    id: 'users.deactivate',
    category: 'User Management',
    resource: 'users',
    action: 'deactivate',
    displayName: 'Deactivate Users',
    description: 'Deactivate user accounts',
    scope: 'organization',
    riskLevel: 'high'
  },

  // Clinical Operations
  'appointments.create': {
    id: 'appointments.create',
    category: 'Clinical Operations',
    resource: 'appointments',
    action: 'create',
    displayName: 'Create Appointments',
    description: 'Schedule new appointments',
    scope: 'organization',
    riskLevel: 'low'
  },
  'appointments.read': {
    id: 'appointments.read',
    category: 'Clinical Operations',
    resource: 'appointments',
    action: 'read',
    displayName: 'View Appointments',
    description: 'View appointment schedules',
    scope: 'organization',
    riskLevel: 'low'
  },
  'appointments.update': {
    id: 'appointments.update',
    category: 'Clinical Operations',
    resource: 'appointments',
    action: 'update',
    displayName: 'Update Appointments',
    description: 'Modify appointment details',
    scope: 'organization',
    riskLevel: 'low'
  },
  'appointments.delete': {
    id: 'appointments.delete',
    category: 'Clinical Operations',
    resource: 'appointments',
    action: 'delete',
    displayName: 'Cancel Appointments',
    description: 'Cancel scheduled appointments',
    scope: 'organization',
    riskLevel: 'medium'
  },

  // Assessments
  'assessments.create': {
    id: 'assessments.create',
    category: 'Clinical Operations',
    resource: 'assessments',
    action: 'create',
    displayName: 'Create Assessments',
    description: 'Create client assessments',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'assessments.read': {
    id: 'assessments.read',
    category: 'Clinical Operations',
    resource: 'assessments',
    action: 'read',
    displayName: 'View Assessments',
    description: 'View client assessments',
    scope: 'organization',
    riskLevel: 'low'
  },
  'assessments.update': {
    id: 'assessments.update',
    category: 'Clinical Operations',
    resource: 'assessments',
    action: 'update',
    displayName: 'Update Assessments',
    description: 'Modify assessment information',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'assessments.approve': {
    id: 'assessments.approve',
    category: 'Clinical Operations',
    resource: 'assessments',
    action: 'approve',
    displayName: 'Approve Assessments',
    description: 'Approve or reject assessments',
    scope: 'organization',
    riskLevel: 'high'
  },

  // Incidents
  'incidents.create': {
    id: 'incidents.create',
    category: 'Clinical Operations',
    resource: 'incidents',
    action: 'create',
    displayName: 'Report Incidents',
    description: 'Create incident reports',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'incidents.read': {
    id: 'incidents.read',
    category: 'Clinical Operations',
    resource: 'incidents',
    action: 'read',
    displayName: 'View Incidents',
    description: 'View incident reports',
    scope: 'organization',
    riskLevel: 'low'
  },
  'incidents.update': {
    id: 'incidents.update',
    category: 'Clinical Operations',
    resource: 'incidents',
    action: 'update',
    displayName: 'Update Incidents',
    description: 'Modify incident reports',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'incidents.close': {
    id: 'incidents.close',
    category: 'Clinical Operations',
    resource: 'incidents',
    action: 'close',
    displayName: 'Close Incidents',
    description: 'Close or resolve incident reports',
    scope: 'organization',
    riskLevel: 'high'
  },

  // Billing
  'billing.view': {
    id: 'billing.view',
    category: 'Billing',
    resource: 'billing',
    action: 'view',
    displayName: 'View Billing',
    description: 'View billing information',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'billing.manage': {
    id: 'billing.manage',
    category: 'Billing',
    resource: 'billing',
    action: 'manage',
    displayName: 'Manage Billing',
    description: 'Manage billing and payments',
    scope: 'organization',
    riskLevel: 'high'
  },
  'billing.export': {
    id: 'billing.export',
    category: 'Billing',
    resource: 'billing',
    action: 'export',
    displayName: 'Export Billing',
    description: 'Export billing data',
    scope: 'organization',
    riskLevel: 'medium'
  },

  // Audit
  'audit.view': {
    id: 'audit.view',
    category: 'Audit',
    resource: 'audit',
    action: 'view',
    displayName: 'View Audit Logs',
    description: 'View system audit logs',
    scope: 'organization',
    riskLevel: 'medium'
  },
  'audit.export': {
    id: 'audit.export',
    category: 'Audit',
    resource: 'audit',
    action: 'export',
    displayName: 'Export Audit Logs',
    description: 'Export audit log data',
    scope: 'organization',
    riskLevel: 'high'
  }
};

/**
 * Permission groups for easier role assignment
 */
export const PERMISSION_GROUPS: Record<string, PermissionGroup> = {
  'clinical_basic': {
    id: 'clinical_basic',
    displayName: 'Basic Clinical',
    description: 'View and document basic client care',
    permissions: [
      'org_client.read',
      'medication.read',
      'appointments.read',
      'assessments.read',
      'incidents.create',
      'incidents.read'
    ],
    suggestedFor: ['caregiver', 'aide']
  },

  'clinical_full': {
    id: 'clinical_full',
    displayName: 'Full Clinical',
    description: 'Complete clinical management capabilities',
    permissions: [
      'org_client.create',
      'org_client.read',
      'org_client.update',
      'medication.create',
      'medication.read',
      'medication.update',
      'medication.create_template',
      'appointments.create',
      'appointments.read',
      'appointments.update',
      'assessments.create',
      'assessments.read',
      'assessments.update',
      'assessments.approve',
      'incidents.create',
      'incidents.read',
      'incidents.update',
      'incidents.close'
    ],
    suggestedFor: ['nurse', 'nurse_supervisor', 'clinical_director']
  },

  'administrative': {
    id: 'administrative',
    displayName: 'Administrative',
    description: 'Non-clinical administrative functions',
    permissions: [
      'users.invite',
      'users.manage',
      'reports.view',
      'reports.create',
      'reports.export',
      'billing.view',
      'settings.view',
      'audit.view'
    ],
    suggestedFor: ['office_manager', 'billing_specialist']
  },

  'management': {
    id: 'management',
    displayName: 'Management',
    description: 'Full management capabilities',
    permissions: [
      'org_roles.create',
      'org_roles.assign',
      'users.invite',
      'users.manage',
      'users.deactivate',
      'settings.view',
      'settings.manage',
      'reports.view',
      'reports.create',
      'reports.export',
      'billing.view',
      'billing.manage',
      'audit.view',
      'audit.export'
    ],
    suggestedFor: ['administrator', 'director', 'executive']
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