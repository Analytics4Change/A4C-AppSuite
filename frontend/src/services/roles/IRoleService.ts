/**
 * Role Service Interface
 *
 * Provides CRUD operations for managing roles and their permissions within
 * the RBAC system. Roles define sets of permissions that can be assigned
 * to users at specific organizational scopes.
 *
 * Security Model:
 * - All operations are scoped to the user's organization (via JWT org_id)
 * - RLS policies enforce that users can only manage roles within their hierarchy
 * - Subset-only delegation: users can only grant permissions they possess
 * - Production implementation uses Supabase RPC functions
 * - Mock implementation uses localStorage for development
 *
 * Permission Required: role.create
 *
 * @see documentation/architecture/authorization/rbac-architecture.md
 * @see infrastructure/supabase/supabase/migrations/20251224220822_role_management_api.sql
 */

import type {
  Role,
  RoleWithPermissions,
  Permission,
  RoleFilterOptions,
  CreateRoleRequest,
  UpdateRoleRequest,
  RoleOperationResult,
} from '@/types/role.types';

export interface IRoleService {
  /**
   * Retrieves all roles within the user's organization scope
   *
   * Returns roles visible to the current user based on RLS policies.
   * Results include permission and user assignment counts.
   *
   * @param filters - Optional filters for status and search
   * @returns Promise resolving to array of roles
   *
   * @example
   * // Get all active roles
   * const roles = await service.getRoles({ status: 'active' });
   *
   * @example
   * // Search by name
   * const results = await service.getRoles({ searchTerm: 'admin' });
   */
  getRoles(filters?: RoleFilterOptions): Promise<Role[]>;

  /**
   * Retrieves a single role by ID with its associated permissions
   *
   * @param roleId - Role UUID
   * @returns Promise resolving to role with permissions or null if not found
   *
   * @example
   * const role = await service.getRoleById('123e4567-e89b-12d3-a456-426614174000');
   * if (role) {
   *   console.log(role.name, role.permissions.length);
   * }
   */
  getRoleById(roleId: string): Promise<RoleWithPermissions | null>;

  /**
   * Retrieves all available permissions for the permission selector UI
   *
   * Returns all permissions defined in the system, grouped by applet.
   *
   * @returns Promise resolving to array of all permissions
   *
   * @example
   * const permissions = await service.getPermissions();
   * const groups = groupPermissionsByApplet(permissions);
   */
  getPermissions(): Promise<Permission[]>;

  /**
   * Retrieves the current user's permission IDs for subset-only enforcement
   *
   * Used by the UI to disable checkboxes for permissions the user
   * cannot grant (they don't possess them themselves).
   *
   * @returns Promise resolving to array of permission IDs the user has
   *
   * @example
   * const userPermIds = await service.getUserPermissions();
   * const canGrant = userPermIds.includes(permissionId);
   */
  getUserPermissions(): Promise<string[]>;

  /**
   * Creates a new role with optional permissions
   *
   * The role is created within the user's organization scope.
   * Permission grants are subject to subset-only delegation rule.
   *
   * @param request - Role creation parameters
   * @returns Promise resolving to operation result with created role
   *
   * @example
   * const result = await service.createRole({
   *   name: 'Medication Viewer',
   *   description: 'Can view but not modify medication records',
   *   permissionIds: ['perm-uuid-1', 'perm-uuid-2'],
   * });
   *
   * if (!result.success && result.errorDetails?.code === 'SUBSET_ONLY_VIOLATION') {
   *   alert('Cannot grant permissions you do not possess');
   * }
   */
  createRole(request: CreateRoleRequest): Promise<RoleOperationResult>;

  /**
   * Updates an existing role
   *
   * Can update name, description, and permissions. When permissions are
   * provided, they replace the current set (diff is computed server-side).
   * Permission grants are subject to subset-only delegation rule.
   *
   * @param request - Role update parameters
   * @returns Promise resolving to operation result
   *
   * @example
   * const result = await service.updateRole({
   *   id: roleId,
   *   name: 'Updated Role Name',
   *   permissionIds: [...newPermissions],
   * });
   */
  updateRole(request: UpdateRoleRequest): Promise<RoleOperationResult>;

  /**
   * Deactivates (freezes) a role
   *
   * Sets is_active=false. The role remains visible but cannot be assigned
   * to new users. Existing assignments are preserved but frozen.
   * This is reversible via reactivateRole().
   *
   * @param roleId - ID of the role to deactivate
   * @returns Promise resolving to operation result
   *
   * @example
   * const result = await service.deactivateRole(roleId);
   * if (!result.success) {
   *   if (result.errorDetails?.code === 'ALREADY_INACTIVE') {
   *     alert('Role is already deactivated');
   *   }
   * }
   */
  deactivateRole(roleId: string): Promise<RoleOperationResult>;

  /**
   * Reactivates a previously deactivated role
   *
   * Sets is_active=true. The role can be assigned again.
   *
   * @param roleId - ID of the role to reactivate
   * @returns Promise resolving to operation result
   *
   * @example
   * const result = await service.reactivateRole(roleId);
   * if (!result.success) {
   *   if (result.errorDetails?.code === 'ALREADY_ACTIVE') {
   *     alert('Role is already active');
   *   }
   * }
   */
  reactivateRole(roleId: string): Promise<RoleOperationResult>;

  /**
   * Soft-deletes a role
   *
   * Sets deleted_at timestamp, making the role hidden from queries.
   *
   * Prerequisites:
   * - Role must be deactivated (is_active = false)
   * - Role must have no user assignments (HAS_USERS error)
   *
   * @param roleId - ID of the role to delete
   * @returns Promise resolving to operation result
   *
   * @example
   * const result = await service.deleteRole(roleId);
   * if (!result.success) {
   *   if (result.errorDetails?.code === 'HAS_USERS') {
   *     alert(`Cannot delete: ${result.errorDetails.count} users assigned`);
   *   } else if (result.errorDetails?.code === 'STILL_ACTIVE') {
   *     alert('Deactivate role before deletion');
   *   }
   * }
   */
  deleteRole(roleId: string): Promise<RoleOperationResult>;
}
