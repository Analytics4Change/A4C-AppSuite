/**
 * Mock Role Service
 *
 * Development/testing implementation of IRoleService.
 * Uses localStorage for persistence across page reloads during development.
 * Provides realistic mock data for roles and permissions.
 *
 * Mock Data:
 * - 4 sample roles with varying permission sets
 * - 20+ permissions across 6 applets
 * - Simulated subset-only delegation enforcement
 *
 * @see IRoleService for interface documentation
 */

import { Logger } from '@/utils/logger';
import type {
  Role,
  RoleWithPermissions,
  Permission,
  RoleFilterOptions,
  CreateRoleRequest,
  UpdateRoleRequest,
  RoleOperationResult,
} from '@/types/role.types';
import type { IRoleService } from './IRoleService';

const log = Logger.getLogger('api');

/** localStorage keys for persisting mock data */
const ROLES_STORAGE_KEY = 'mock_roles';
const ROLE_PERMISSIONS_STORAGE_KEY = 'mock_role_permissions';

/**
 * Generate a mock UUID
 */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * All available permissions (system-wide)
 */
const MOCK_PERMISSIONS: Permission[] = [
  // Organization Management
  { id: 'perm-org-view', name: 'organization.view', applet: 'organization', action: 'view', description: 'View organization details', scopeType: 'org' },
  { id: 'perm-org-update', name: 'organization.update', applet: 'organization', action: 'update', description: 'Update organization settings', scopeType: 'org' },
  { id: 'perm-org-create-ou', name: 'organization.create_ou', applet: 'organization', action: 'create_ou', description: 'Create organizational units', scopeType: 'org' },
  { id: 'perm-org-view-ou', name: 'organization.view_ou', applet: 'organization', action: 'view_ou', description: 'View organizational units', scopeType: 'org' },

  // Client Records
  { id: 'perm-client-create', name: 'client.create', applet: 'client', action: 'create', description: 'Create new client records', scopeType: 'org' },
  { id: 'perm-client-view', name: 'client.view', applet: 'client', action: 'view', description: 'View client records', scopeType: 'client' },
  { id: 'perm-client-update', name: 'client.update', applet: 'client', action: 'update', description: 'Update client records', scopeType: 'client' },
  { id: 'perm-client-delete', name: 'client.delete', applet: 'client', action: 'delete', description: 'Delete client records', scopeType: 'client' },

  // Medication Management
  { id: 'perm-med-create', name: 'medication.create', applet: 'medication', action: 'create', description: 'Create medication prescriptions', scopeType: 'client' },
  { id: 'perm-med-view', name: 'medication.view', applet: 'medication', action: 'view', description: 'View medication records', scopeType: 'client' },
  { id: 'perm-med-update', name: 'medication.update', applet: 'medication', action: 'update', description: 'Update medication prescriptions', scopeType: 'client' },
  { id: 'perm-med-delete', name: 'medication.delete', applet: 'medication', action: 'delete', description: 'Delete medication records', scopeType: 'client' },
  { id: 'perm-med-approve', name: 'medication.approve', applet: 'medication', action: 'approve', description: 'Approve medication prescriptions', scopeType: 'client', requiresMfa: true },

  // User Management
  { id: 'perm-user-create', name: 'user.create', applet: 'user', action: 'create', description: 'Create new users', scopeType: 'org' },
  { id: 'perm-user-view', name: 'user.view', applet: 'user', action: 'view', description: 'View user profiles', scopeType: 'org' },
  { id: 'perm-user-update', name: 'user.update', applet: 'user', action: 'update', description: 'Update user profiles', scopeType: 'org' },
  { id: 'perm-user-deactivate', name: 'user.deactivate', applet: 'user', action: 'deactivate', description: 'Deactivate user accounts', scopeType: 'org' },

  // Role Management
  { id: 'perm-role-create', name: 'role.create', applet: 'role', action: 'create', description: 'Create and manage roles', scopeType: 'org' },
  { id: 'perm-role-view', name: 'role.view', applet: 'role', action: 'view', description: 'View roles and permissions', scopeType: 'org' },
  { id: 'perm-role-assign', name: 'role.assign', applet: 'role', action: 'assign', description: 'Assign roles to users', scopeType: 'org' },

  // Cross-Organization Access
  { id: 'perm-cross-grant', name: 'cross_org.grant', applet: 'cross_org', action: 'grant', description: 'Grant cross-organization access', scopeType: 'org', requiresMfa: true },
  { id: 'perm-cross-view', name: 'cross_org.view', applet: 'cross_org', action: 'view', description: 'View cross-organization grants', scopeType: 'org' },
];

/**
 * Initial mock roles
 */
function getInitialMockRoles(): { roles: Role[]; rolePermissions: Map<string, string[]> } {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const roles: Role[] = [
    {
      id: 'role-org-admin',
      name: 'Organization Admin',
      description: 'Full administrative access to the organization',
      organizationId: 'org-acme-healthcare',
      orgHierarchyScope: 'root.provider.acme_healthcare',
      isActive: true,
      createdAt: lastWeek,
      updatedAt: lastWeek,
      permissionCount: 18,
      userCount: 2,
    },
    {
      id: 'role-clinician',
      name: 'Clinician',
      description: 'Clinical staff with patient care responsibilities',
      organizationId: 'org-acme-healthcare',
      orgHierarchyScope: 'root.provider.acme_healthcare',
      isActive: true,
      createdAt: lastWeek,
      updatedAt: yesterday,
      permissionCount: 8,
      userCount: 15,
    },
    {
      id: 'role-med-viewer',
      name: 'Medication Viewer',
      description: 'Read-only access to medication records',
      organizationId: 'org-acme-healthcare',
      orgHierarchyScope: 'root.provider.acme_healthcare.main_campus',
      isActive: true,
      createdAt: yesterday,
      updatedAt: yesterday,
      permissionCount: 3,
      userCount: 5,
    },
    {
      id: 'role-deprecated',
      name: 'Legacy Admin',
      description: 'Deprecated role - do not use',
      organizationId: 'org-acme-healthcare',
      orgHierarchyScope: 'root.provider.acme_healthcare',
      isActive: false,
      createdAt: lastWeek,
      updatedAt: yesterday,
      permissionCount: 10,
      userCount: 0,
    },
  ];

  const rolePermissions = new Map<string, string[]>([
    ['role-org-admin', MOCK_PERMISSIONS.map((p) => p.id)], // All permissions
    ['role-clinician', [
      'perm-client-view', 'perm-client-update',
      'perm-med-create', 'perm-med-view', 'perm-med-update',
      'perm-org-view', 'perm-org-view-ou',
      'perm-user-view',
    ]],
    ['role-med-viewer', ['perm-med-view', 'perm-client-view', 'perm-org-view']],
    ['role-deprecated', [
      'perm-org-view', 'perm-org-update',
      'perm-client-view', 'perm-client-update',
      'perm-med-view', 'perm-med-update',
      'perm-user-view', 'perm-user-update',
      'perm-role-view', 'perm-role-assign',
    ]],
  ]);

  return { roles, rolePermissions };
}

export class MockRoleService implements IRoleService {
  private roles: Role[];
  private rolePermissions: Map<string, string[]>;

  /** Mock current user's permissions (Provider Admin has all) */
  private currentUserPermissions: string[] = MOCK_PERMISSIONS.map((p) => p.id);

  constructor() {
    const loaded = this.loadFromStorage();
    this.roles = loaded.roles;
    this.rolePermissions = loaded.rolePermissions;
    log.info('MockRoleService initialized', { roleCount: this.roles.length });
  }

  /**
   * Load data from localStorage or initialize with defaults
   */
  private loadFromStorage(): { roles: Role[]; rolePermissions: Map<string, string[]> } {
    try {
      const rolesJson = localStorage.getItem(ROLES_STORAGE_KEY);
      const permsJson = localStorage.getItem(ROLE_PERMISSIONS_STORAGE_KEY);

      if (rolesJson && permsJson) {
        const roles = JSON.parse(rolesJson).map((r: Role) => ({
          ...r,
          createdAt: new Date(r.createdAt),
          updatedAt: new Date(r.updatedAt),
        }));
        const permsObj = JSON.parse(permsJson);
        const rolePermissions = new Map<string, string[]>(Object.entries(permsObj));
        return { roles, rolePermissions };
      }
    } catch (error) {
      log.warn('Failed to load mock roles from localStorage, using defaults', { error });
    }
    return getInitialMockRoles();
  }

  /**
   * Save data to localStorage
   */
  private saveToStorage(): void {
    try {
      localStorage.setItem(ROLES_STORAGE_KEY, JSON.stringify(this.roles));
      const permsObj = Object.fromEntries(this.rolePermissions);
      localStorage.setItem(ROLE_PERMISSIONS_STORAGE_KEY, JSON.stringify(permsObj));
    } catch (error) {
      log.error('Failed to save mock roles to localStorage', { error });
    }
  }

  /**
   * Simulate network delay
   */
  private async simulateDelay(): Promise<void> {
    if (import.meta.env.MODE === 'test') return;
    const delay = Math.random() * 200 + 100;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  async getRoles(filters?: RoleFilterOptions): Promise<Role[]> {
    await this.simulateDelay();
    log.debug('Mock: Fetching roles', { filters });

    let results = [...this.roles];

    if (filters) {
      if (filters.status && filters.status !== 'all') {
        results = results.filter((r) => r.isActive === (filters.status === 'active'));
      }

      if (filters.searchTerm) {
        const searchLower = filters.searchTerm.toLowerCase();
        results = results.filter(
          (r) =>
            r.name.toLowerCase().includes(searchLower) ||
            r.description.toLowerCase().includes(searchLower)
        );
      }
    }

    results.sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    log.info(`Mock: Returning ${results.length} roles`);
    return results;
  }

  async getRoleById(roleId: string): Promise<RoleWithPermissions | null> {
    await this.simulateDelay();
    log.debug('Mock: Fetching role by ID', { roleId });

    const role = this.roles.find((r) => r.id === roleId);
    if (!role) {
      log.debug('Mock: Role not found', { roleId });
      return null;
    }

    const permissionIds = this.rolePermissions.get(roleId) || [];
    const permissions = MOCK_PERMISSIONS.filter((p) => permissionIds.includes(p.id));

    log.info('Mock: Found role', { roleId, name: role.name, permissionCount: permissions.length });
    return {
      ...role,
      permissions,
    };
  }

  async getPermissions(): Promise<Permission[]> {
    await this.simulateDelay();
    log.debug('Mock: Fetching all permissions');
    log.info(`Mock: Returning ${MOCK_PERMISSIONS.length} permissions`);
    return [...MOCK_PERMISSIONS];
  }

  async getUserPermissions(): Promise<string[]> {
    await this.simulateDelay();
    log.debug('Mock: Fetching current user permissions');
    log.info(`Mock: User has ${this.currentUserPermissions.length} permissions`);
    return [...this.currentUserPermissions];
  }

  async createRole(request: CreateRoleRequest): Promise<RoleOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Creating role', { request });

    // Validate name
    if (!request.name || request.name.trim().length === 0) {
      return {
        success: false,
        error: 'Name is required',
        errorDetails: { code: 'VALIDATION_ERROR', message: 'Role name cannot be empty' },
      };
    }

    // Check subset-only delegation
    for (const permId of request.permissionIds) {
      if (!this.currentUserPermissions.includes(permId)) {
        const perm = MOCK_PERMISSIONS.find((p) => p.id === permId);
        return {
          success: false,
          error: 'Cannot grant permission you do not possess',
          errorDetails: {
            code: 'SUBSET_ONLY_VIOLATION',
            message: `Permission ${perm?.name || permId} is not in your granted set`,
          },
        };
      }
    }

    const now = new Date();
    const newRole: Role = {
      id: generateId(),
      name: request.name.trim(),
      description: request.description,
      organizationId: 'org-acme-healthcare',
      orgHierarchyScope: request.orgHierarchyScope || 'root.provider.acme_healthcare',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      permissionCount: request.permissionIds.length,
      userCount: 0,
    };

    this.roles.push(newRole);
    this.rolePermissions.set(newRole.id, [...request.permissionIds]);
    this.saveToStorage();

    log.info('Mock: Created role', { roleId: newRole.id, name: newRole.name });
    return { success: true, role: newRole };
  }

  async updateRole(request: UpdateRoleRequest): Promise<RoleOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Updating role', { request });

    const roleIndex = this.roles.findIndex((r) => r.id === request.id);
    if (roleIndex === -1) {
      return {
        success: false,
        error: 'Role not found',
        errorDetails: { code: 'NOT_FOUND', message: 'Role not found or access denied' },
      };
    }

    const role = this.roles[roleIndex];

    if (!role.isActive) {
      return {
        success: false,
        error: 'Cannot update inactive role',
        errorDetails: { code: 'INACTIVE_ROLE', message: 'Reactivate the role before making changes' },
      };
    }

    // Check subset-only for permission grants
    if (request.permissionIds) {
      const currentPerms = this.rolePermissions.get(role.id) || [];
      const newPerms = request.permissionIds.filter((p) => !currentPerms.includes(p));

      for (const permId of newPerms) {
        if (!this.currentUserPermissions.includes(permId)) {
          const perm = MOCK_PERMISSIONS.find((p) => p.id === permId);
          return {
            success: false,
            error: 'Cannot grant permission you do not possess',
            errorDetails: {
              code: 'SUBSET_ONLY_VIOLATION',
              message: `Permission ${perm?.name || permId} is not in your granted set`,
            },
          };
        }
      }

      this.rolePermissions.set(role.id, [...request.permissionIds]);
      role.permissionCount = request.permissionIds.length;
    }

    if (request.name !== undefined) role.name = request.name.trim();
    if (request.description !== undefined) role.description = request.description;
    role.updatedAt = new Date();

    this.saveToStorage();
    log.info('Mock: Updated role', { roleId: role.id, name: role.name });
    return { success: true };
  }

  async deactivateRole(roleId: string): Promise<RoleOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Deactivating role', { roleId });

    const role = this.roles.find((r) => r.id === roleId);
    if (!role) {
      return {
        success: false,
        error: 'Role not found',
        errorDetails: { code: 'NOT_FOUND', message: 'Role not found or access denied' },
      };
    }

    if (!role.isActive) {
      return {
        success: false,
        error: 'Role already inactive',
        errorDetails: { code: 'ALREADY_INACTIVE', message: 'Role is already deactivated' },
      };
    }

    role.isActive = false;
    role.updatedAt = new Date();
    this.saveToStorage();

    log.info('Mock: Deactivated role', { roleId, name: role.name });
    return { success: true };
  }

  async reactivateRole(roleId: string): Promise<RoleOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Reactivating role', { roleId });

    const role = this.roles.find((r) => r.id === roleId);
    if (!role) {
      return {
        success: false,
        error: 'Role not found',
        errorDetails: { code: 'NOT_FOUND', message: 'Role not found or access denied' },
      };
    }

    if (role.isActive) {
      return {
        success: false,
        error: 'Role already active',
        errorDetails: { code: 'ALREADY_ACTIVE', message: 'Role is already active' },
      };
    }

    role.isActive = true;
    role.updatedAt = new Date();
    this.saveToStorage();

    log.info('Mock: Reactivated role', { roleId, name: role.name });
    return { success: true };
  }

  async deleteRole(roleId: string): Promise<RoleOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Deleting role', { roleId });

    const roleIndex = this.roles.findIndex((r) => r.id === roleId);
    if (roleIndex === -1) {
      return {
        success: false,
        error: 'Role not found',
        errorDetails: { code: 'NOT_FOUND', message: 'Role not found or access denied' },
      };
    }

    const role = this.roles[roleIndex];

    if (role.isActive) {
      return {
        success: false,
        error: 'Role must be deactivated first',
        errorDetails: { code: 'STILL_ACTIVE', message: 'Deactivate role before deletion' },
      };
    }

    if (role.userCount > 0) {
      return {
        success: false,
        error: 'Role has user assignments',
        errorDetails: {
          code: 'HAS_USERS',
          count: role.userCount,
          message: `${role.userCount} users still assigned to this role`,
        },
      };
    }

    this.roles.splice(roleIndex, 1);
    this.rolePermissions.delete(roleId);
    this.saveToStorage();

    log.info('Mock: Deleted role', { roleId, name: role.name });
    return { success: true };
  }

  /**
   * Reset mock data to initial state (useful for testing)
   */
  resetToDefaults(): void {
    const initial = getInitialMockRoles();
    this.roles = initial.roles;
    this.rolePermissions = initial.rolePermissions;
    this.saveToStorage();
    log.info('Mock: Reset roles to defaults');
  }

  /**
   * Clear all mock data
   */
  clearAll(): void {
    this.roles = [];
    this.rolePermissions = new Map();
    this.saveToStorage();
    log.info('Mock: Cleared all roles');
  }

  /**
   * Set current user's permissions (for testing subset-only)
   */
  setCurrentUserPermissions(permissionIds: string[]): void {
    this.currentUserPermissions = [...permissionIds];
    log.info('Mock: Updated current user permissions', { count: permissionIds.length });
  }
}
