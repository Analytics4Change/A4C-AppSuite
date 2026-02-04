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

import type {
  BulkAssignmentResult,
  SelectableUser,
  ListUsersForBulkAssignmentParams,
  BulkAssignRoleParams,
  ManageableUser,
  ListUsersForRoleManagementParams,
  SyncRoleAssignmentsParams,
  SyncRoleAssignmentsResult,
} from '@/types/bulk-assignment.types';

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

  // =========================================================================
  // BULK ROLE ASSIGNMENT
  // =========================================================================

  /**
   * Lists users eligible for bulk role assignment
   *
   * Returns users within the organization at the specified scope who can be
   * assigned to the given role. Users already assigned to the role at the
   * same scope are flagged but included (for display purposes).
   *
   * Permission Required: user.role_assign at the specified scope
   *
   * @param params - Parameters including roleId, scopePath, and optional search/pagination
   * @returns Promise resolving to array of selectable users
   *
   * @example
   * const users = await service.listUsersForBulkAssignment({
   *   roleId: 'role-uuid',
   *   scopePath: 'acme.pediatrics',
   *   searchTerm: 'john',
   *   limit: 50,
   * });
   *
   * // Filter out already-assigned users for selection UI
   * const assignable = users.filter(u => !u.isAlreadyAssigned);
   */
  listUsersForBulkAssignment(params: ListUsersForBulkAssignmentParams): Promise<SelectableUser[]>;

  /**
   * Assigns a role to multiple users in a single operation
   *
   * Each successful assignment emits a `user.role.assigned` event.
   * All events from the same bulk operation are linked via correlation_id.
   * Partial failures are allowed - successful assignments are committed
   * even if some users fail.
   *
   * Permission Required: user.role_assign at the specified scope
   *
   * @param params - Parameters including roleId, userIds, scopePath, and optional reason
   * @returns Promise resolving to detailed result with successes and failures
   *
   * @example
   * const result = await service.bulkAssignRole({
   *   roleId: 'role-uuid',
   *   userIds: ['user-1', 'user-2', 'user-3'],
   *   scopePath: 'acme.pediatrics',
   *   reason: 'New hire onboarding batch',
   * });
   *
   * if (result.totalFailed > 0) {
   *   console.log('Partial success:', result.failed);
   * }
   * console.log(`Reference: ${result.correlationId}`);
   */
  bulkAssignRole(params: BulkAssignRoleParams): Promise<BulkAssignmentResult>;

  // =========================================================================
  // UNIFIED ROLE ASSIGNMENT MANAGEMENT
  // Allows both adding and removing role assignments in a single operation
  // =========================================================================

  /**
   * Lists ALL users for role assignment management
   *
   * Unlike listUsersForBulkAssignment which excludes already-assigned users,
   * this returns ALL users with their current assignment status (isAssigned).
   * This enables the unified "Manage User Assignments" UI where users can
   * both add and remove assignments by toggling checkboxes.
   *
   * Permission Required: user.role_assign at the specified scope
   *
   * @param params - Parameters including roleId, scopePath, and optional search/pagination
   * @returns Promise resolving to array of manageable users with assignment status
   *
   * @example
   * const users = await service.listUsersForRoleManagement({
   *   roleId: 'role-uuid',
   *   scopePath: 'acme.pediatrics',
   * });
   *
   * // Initially assigned users should have their checkbox checked
   * users.filter(u => u.isAssigned).forEach(u => {
   *   checkboxStates[u.id] = true;
   * });
   */
  listUsersForRoleManagement(params: ListUsersForRoleManagementParams): Promise<ManageableUser[]>;

  /**
   * Syncs role assignments by adding and removing users in a single operation
   *
   * This is the unified assignment management function that handles both:
   * - Adding users to the role (emits `user.role.assigned` events)
   * - Removing users from the role (emits `user.role.revoked` events)
   *
   * All events are linked via the same correlation_id for traceability.
   * Partial failures are allowed - successful operations are committed
   * even if some fail.
   *
   * Permission Required: user.role_assign at the specified scope
   *
   * @param params - Parameters including roleId, userIdsToAdd, userIdsToRemove, scopePath
   * @returns Promise resolving to detailed result with successes/failures for both operations
   *
   * @example
   * const result = await service.syncRoleAssignments({
   *   roleId: 'role-uuid',
   *   userIdsToAdd: ['user-3', 'user-4'],
   *   userIdsToRemove: ['user-1'],
   *   scopePath: 'acme.pediatrics',
   *   reason: 'Team reorganization',
   * });
   *
   * console.log(`Added: ${result.added.successful.length}`);
   * console.log(`Removed: ${result.removed.successful.length}`);
   * console.log(`Reference: ${result.correlationId}`);
   */
  syncRoleAssignments(params: SyncRoleAssignmentsParams): Promise<SyncRoleAssignmentsResult>;
}
