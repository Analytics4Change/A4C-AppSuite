/**
 * Supabase Role Service
 *
 * Production implementation of IRoleService using Supabase RPC functions.
 * Provides CRUD operations for roles and their permissions within the RBAC system.
 *
 * Security Model:
 * - All operations scoped to user's JWT org_id claim
 * - RLS policies enforce database-level protection
 * - Subset-only delegation enforced in RPC functions
 * - Required permission: role.create
 *
 * RPC Functions (api schema):
 * - get_roles: List roles with filters
 * - get_role_by_id: Get role with permissions
 * - get_permissions: List all available permissions
 * - get_user_permissions: Get current user's permission IDs
 * - create_role: Create role + grant permissions
 * - update_role: Update role + sync permissions
 * - deactivate_role: Freeze role (is_active=false)
 * - reactivate_role: Unfreeze role (is_active=true)
 * - delete_role: Soft delete (deleted_at set)
 *
 * @see infrastructure/supabase/supabase/migrations/20251224220822_role_management_api.sql
 * @see documentation/architecture/authorization/rbac-architecture.md
 */

import { supabase } from '@/lib/supabase';
import { Logger } from '@/utils/logger';
import type { IRoleService } from './IRoleService';
import type {
  Role,
  RoleWithPermissions,
  Permission,
  RoleFilterOptions,
  CreateRoleRequest,
  UpdateRoleRequest,
  RoleOperationResult,
} from '@/types/role.types';

const log = Logger.getLogger('supabase-role-service');

/**
 * Database row type for role list results
 * MUST match: api.get_roles return type
 */
interface RoleRow {
  id: string;
  name: string;
  description: string;
  organization_id: string | null;
  org_hierarchy_scope: string | null;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  permission_count: number;
  user_count: number;
}

/**
 * Database row type for role with permissions
 * MUST match: api.get_role_by_id return type
 */
interface RoleWithPermissionsRow {
  id: string;
  name: string;
  description: string;
  organization_id: string | null;
  org_hierarchy_scope: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  permissions: PermissionJson[];
}

/**
 * Permission JSON structure from RPC
 */
interface PermissionJson {
  id: string;
  name: string;
  applet: string;
  action: string;
  display_name: string | null;
  description: string;
  scope_type: string;
}

/**
 * Database row type for permissions
 * MUST match: api.get_permissions return type
 */
interface PermissionRow {
  id: string;
  name: string;
  applet: string;
  action: string;
  display_name: string | null;
  description: string;
  scope_type: string;
  requires_mfa: boolean;
}

/**
 * Database row type for user permissions
 * MUST match: api.get_user_permissions return type
 */
interface UserPermissionRow {
  permission_id: string;
}

/**
 * JSONB response type for mutation operations
 */
interface MutationResponse {
  success: boolean;
  role?: {
    id: string;
    name: string;
    description: string;
    organizationId: string | null;
    orgHierarchyScope: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
  error?: string;
  errorDetails?: {
    code: string;
    count?: number;
    message: string;
  };
}

export class SupabaseRoleService implements IRoleService {
  constructor() {
    log.info('SupabaseRoleService initialized');
  }

  /**
   * Converts database row to Role type
   */
  private mapRowToRole(row: RoleRow): Role {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      organizationId: row.organization_id,
      orgHierarchyScope: row.org_hierarchy_scope,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      permissionCount: Number(row.permission_count) || 0,
      userCount: Number(row.user_count) || 0,
    };
  }

  /**
   * Converts database row to RoleWithPermissions type
   */
  private mapRowToRoleWithPermissions(row: RoleWithPermissionsRow): RoleWithPermissions {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      organizationId: row.organization_id,
      orgHierarchyScope: row.org_hierarchy_scope,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      permissionCount: row.permissions?.length || 0,
      userCount: 0, // Not included in get_role_by_id
      permissions: (row.permissions || []).map((p) => ({
        id: p.id,
        name: p.name,
        applet: p.applet,
        action: p.action,
        displayName: p.display_name || undefined,
        description: p.description,
        scopeType: p.scope_type as Permission['scopeType'],
      })),
    };
  }

  /**
   * Converts database row to Permission type
   */
  private mapRowToPermission(row: PermissionRow): Permission {
    return {
      id: row.id,
      name: row.name,
      applet: row.applet,
      action: row.action,
      displayName: row.display_name || undefined,
      description: row.description,
      scopeType: row.scope_type as Permission['scopeType'],
      requiresMfa: row.requires_mfa,
    };
  }

  /**
   * Maps error details from RPC response to operation result format
   */
  private mapErrorDetails(
    errorDetails?: MutationResponse['errorDetails']
  ): RoleOperationResult['errorDetails'] {
    if (!errorDetails) return undefined;

    type ErrorCode = NonNullable<RoleOperationResult['errorDetails']>['code'];
    const codeMap: Record<string, ErrorCode> = {
      NOT_FOUND: 'NOT_FOUND',
      ALREADY_ACTIVE: 'ALREADY_ACTIVE',
      ALREADY_INACTIVE: 'ALREADY_INACTIVE',
      HAS_USERS: 'HAS_USERS',
      STILL_ACTIVE: 'STILL_ACTIVE',
      SUBSET_ONLY_VIOLATION: 'SUBSET_ONLY_VIOLATION',
      NO_ORG_CONTEXT: 'NO_ORG_CONTEXT',
      VALIDATION_ERROR: 'VALIDATION_ERROR',
      INACTIVE_ROLE: 'INACTIVE_ROLE',
      PERMISSION_DENIED: 'PERMISSION_DENIED',
    };

    return {
      code: codeMap[errorDetails.code] || 'UNKNOWN',
      count: errorDetails.count,
      message: errorDetails.message,
    };
  }

  /**
   * Retrieves all roles within the user's organization scope
   */
  async getRoles(filters?: RoleFilterOptions): Promise<Role[]> {
    log.debug('getRoles called', { filters });

    try {
      const { data, error } = await supabase.schema('api').rpc('get_roles', {
        p_status: filters?.status || 'all',
        p_search_term: filters?.searchTerm || null,
      });

      if (error) {
        log.error('Error fetching roles', error);
        throw new Error(`Failed to fetch roles: ${error.message}`);
      }

      const rows = (data as RoleRow[]) || [];
      log.debug(`Fetched ${rows.length} roles`);

      return rows.map((row) => this.mapRowToRole(row));
    } catch (err) {
      log.error('Exception in getRoles', err);
      throw err;
    }
  }

  /**
   * Retrieves a single role by ID with its permissions
   */
  async getRoleById(roleId: string): Promise<RoleWithPermissions | null> {
    log.debug('getRoleById called', { roleId });

    try {
      const { data, error } = await supabase.schema('api').rpc('get_role_by_id', {
        p_role_id: roleId,
      });

      if (error) {
        log.error('Error fetching role by ID', error);
        throw new Error(`Failed to fetch role: ${error.message}`);
      }

      const rows = (data as RoleWithPermissionsRow[]) || [];

      if (rows.length === 0) {
        log.debug('Role not found', { roleId });
        return null;
      }

      return this.mapRowToRoleWithPermissions(rows[0]);
    } catch (err) {
      log.error('Exception in getRoleById', err);
      throw err;
    }
  }

  /**
   * Retrieves all available permissions
   */
  async getPermissions(): Promise<Permission[]> {
    log.debug('getPermissions called');

    try {
      const { data, error } = await supabase.schema('api').rpc('get_permissions');

      if (error) {
        log.error('Error fetching permissions', error);
        throw new Error(`Failed to fetch permissions: ${error.message}`);
      }

      const rows = (data as PermissionRow[]) || [];
      log.debug(`Fetched ${rows.length} permissions`);

      return rows.map((row) => this.mapRowToPermission(row));
    } catch (err) {
      log.error('Exception in getPermissions', err);
      throw err;
    }
  }

  /**
   * Retrieves the current user's permission IDs
   */
  async getUserPermissions(): Promise<string[]> {
    log.debug('getUserPermissions called');

    try {
      const { data, error } = await supabase.schema('api').rpc('get_user_permissions');

      if (error) {
        log.error('Error fetching user permissions', error);
        throw new Error(`Failed to fetch user permissions: ${error.message}`);
      }

      const rows = (data as UserPermissionRow[]) || [];
      log.debug(`Fetched ${rows.length} user permission IDs`);

      return rows.map((row) => row.permission_id);
    } catch (err) {
      log.error('Exception in getUserPermissions', err);
      throw err;
    }
  }

  /**
   * Creates a new role with permissions
   */
  async createRole(request: CreateRoleRequest): Promise<RoleOperationResult> {
    const requestId = crypto.randomUUID().slice(0, 8);
    const startTime = Date.now();

    log.info(`[DIAG:createRole:ENTRY] requestId=${requestId}`, {
      name: request.name,
      description: request.description,
      permissionCount: request.permissionIds.length,
      permissionIds: request.permissionIds,
      orgHierarchyScope: request.orgHierarchyScope,
      clonedFromRoleId: request.clonedFromRoleId,
      timestamp: new Date().toISOString(),
    });

    try {
      log.debug(`[DIAG:createRole:RPC_CALL] requestId=${requestId}`);

      const { data, error } = await supabase.schema('api').rpc('create_role', {
        p_name: request.name,
        p_description: request.description,
        p_org_hierarchy_scope: request.orgHierarchyScope || null,
        p_permission_ids: request.permissionIds,
        p_cloned_from_role_id: request.clonedFromRoleId || null,
      });

      const elapsed = Date.now() - startTime;

      if (error) {
        log.error(`[DIAG:createRole:RPC_ERROR] requestId=${requestId} elapsed=${elapsed}ms`, {
          error: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        });
        return {
          success: false,
          error: error.message,
          errorDetails: {
            code: 'UNKNOWN',
            message: error.message,
          },
        };
      }

      const response = data as MutationResponse;

      log.info(`[DIAG:createRole:RPC_RESPONSE] requestId=${requestId} elapsed=${elapsed}ms`, {
        success: response.success,
        roleId: response.role?.id,
        error: response.error,
        errorDetails: response.errorDetails,
      });

      if (!response.success) {
        log.warn(`[DIAG:createRole:EXIT:FAILED] requestId=${requestId}`, { response });
        return {
          success: false,
          error: response.error,
          errorDetails: this.mapErrorDetails(response.errorDetails),
        };
      }

      log.info(`[DIAG:createRole:EXIT:SUCCESS] requestId=${requestId} roleId=${response.role?.id}`);
      return {
        success: true,
        role: response.role
          ? {
              id: response.role.id,
              name: response.role.name,
              description: response.role.description,
              organizationId: response.role.organizationId,
              orgHierarchyScope: response.role.orgHierarchyScope,
              isActive: response.role.isActive,
              createdAt: new Date(response.role.createdAt),
              updatedAt: new Date(response.role.updatedAt),
              permissionCount: request.permissionIds.length,
              userCount: 0,
            }
          : undefined,
      };
    } catch (err) {
      const elapsed = Date.now() - startTime;
      log.error(`[DIAG:createRole:EXCEPTION] requestId=${requestId} elapsed=${elapsed}ms`, err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        errorDetails: {
          code: 'UNKNOWN',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Updates an existing role
   */
  async updateRole(request: UpdateRoleRequest): Promise<RoleOperationResult> {
    log.debug('updateRole called', { request });

    try {
      const { data, error } = await supabase.schema('api').rpc('update_role', {
        p_role_id: request.id,
        p_name: request.name || null,
        p_description: request.description || null,
        p_permission_ids: request.permissionIds || null,
      });

      if (error) {
        log.error('Error updating role', error);
        return {
          success: false,
          error: error.message,
          errorDetails: {
            code: 'UNKNOWN',
            message: error.message,
          },
        };
      }

      const response = data as MutationResponse;

      if (!response.success) {
        log.warn('Update role failed', { response });
        return {
          success: false,
          error: response.error,
          errorDetails: this.mapErrorDetails(response.errorDetails),
        };
      }

      log.info('Role updated', { roleId: request.id });
      return { success: true };
    } catch (err) {
      log.error('Exception in updateRole', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        errorDetails: {
          code: 'UNKNOWN',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Deactivates a role
   */
  async deactivateRole(roleId: string): Promise<RoleOperationResult> {
    log.debug('deactivateRole called', { roleId });

    try {
      const { data, error } = await supabase.schema('api').rpc('deactivate_role', {
        p_role_id: roleId,
      });

      if (error) {
        log.error('Error deactivating role', error);
        return {
          success: false,
          error: error.message,
          errorDetails: {
            code: 'UNKNOWN',
            message: error.message,
          },
        };
      }

      const response = data as MutationResponse;

      if (!response.success) {
        log.warn('Deactivate role failed', { response });
        return {
          success: false,
          error: response.error,
          errorDetails: this.mapErrorDetails(response.errorDetails),
        };
      }

      log.info('Role deactivated', { roleId });
      return { success: true };
    } catch (err) {
      log.error('Exception in deactivateRole', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        errorDetails: {
          code: 'UNKNOWN',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Reactivates a role
   */
  async reactivateRole(roleId: string): Promise<RoleOperationResult> {
    log.debug('reactivateRole called', { roleId });

    try {
      const { data, error } = await supabase.schema('api').rpc('reactivate_role', {
        p_role_id: roleId,
      });

      if (error) {
        log.error('Error reactivating role', error);
        return {
          success: false,
          error: error.message,
          errorDetails: {
            code: 'UNKNOWN',
            message: error.message,
          },
        };
      }

      const response = data as MutationResponse;

      if (!response.success) {
        log.warn('Reactivate role failed', { response });
        return {
          success: false,
          error: response.error,
          errorDetails: this.mapErrorDetails(response.errorDetails),
        };
      }

      log.info('Role reactivated', { roleId });
      return { success: true };
    } catch (err) {
      log.error('Exception in reactivateRole', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        errorDetails: {
          code: 'UNKNOWN',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Soft-deletes a role
   */
  async deleteRole(roleId: string): Promise<RoleOperationResult> {
    log.debug('deleteRole called', { roleId });

    try {
      const { data, error } = await supabase.schema('api').rpc('delete_role', {
        p_role_id: roleId,
      });

      if (error) {
        log.error('Error deleting role', error);
        return {
          success: false,
          error: error.message,
          errorDetails: {
            code: 'UNKNOWN',
            message: error.message,
          },
        };
      }

      const response = data as MutationResponse;

      if (!response.success) {
        log.warn('Delete role failed', { response });
        return {
          success: false,
          error: response.error,
          errorDetails: this.mapErrorDetails(response.errorDetails),
        };
      }

      log.info('Role deleted', { roleId });
      return { success: true };
    } catch (err) {
      log.error('Exception in deleteRole', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        errorDetails: {
          code: 'UNKNOWN',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      };
    }
  }
}
