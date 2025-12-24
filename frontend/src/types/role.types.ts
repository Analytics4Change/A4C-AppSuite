/**
 * Role Type Definitions
 *
 * Types for managing roles and their permissions within the RBAC system.
 * Roles define sets of permissions that can be assigned to users within
 * an organizational scope.
 *
 * @see documentation/architecture/authorization/rbac-architecture.md
 * @see infrastructure/supabase/contracts/asyncapi/domains/rbac.yaml
 */

/**
 * Permission scope types that define where a permission can be applied
 */
export type PermissionScopeType = 'global' | 'org' | 'facility' | 'program' | 'client';

/**
 * A single permission definition from the permissions_projection table
 *
 * Permissions are organized by applet (functional module) and action.
 * Example: applet="medication", action="create" => name="medication.create"
 */
export interface Permission {
  /** Unique identifier (UUID) */
  id: string;

  /**
   * Full permission name (auto-generated: applet.action)
   * Example: "medication.create", "client.view", "organization.view_ou"
   */
  name: string;

  /**
   * Functional module this permission belongs to
   * Examples: "medication", "client", "organization", "user", "role"
   */
  applet: string;

  /**
   * Specific action within the applet
   * Examples: "create", "view", "update", "delete", "assign"
   */
  action: string;

  /** Human-readable description of what this permission allows */
  description: string;

  /** Hierarchical scope level for this permission */
  scopeType: PermissionScopeType;

  /** Whether MFA is required to use this permission */
  requiresMfa?: boolean;
}

/**
 * Permissions grouped by applet for UI display
 *
 * Used by PermissionSelector component to display permissions
 * in logical groups with "Select All" functionality per group.
 */
export interface PermissionGroup {
  /** Applet identifier (e.g., "medication", "client") */
  applet: string;

  /**
   * Human-readable display name for the group
   * Example: "Medication Management", "Client Records"
   */
  displayName: string;

  /** Permissions belonging to this applet */
  permissions: Permission[];
}

/**
 * Base role data from the roles_projection table
 *
 * Represents a role definition within an organization's scope.
 * Roles contain sets of permissions that define what actions users can perform.
 */
export interface Role {
  /** Unique identifier (UUID) */
  id: string;

  /**
   * Role name/identifier
   * Examples: "provider_admin", "clinician", "custom_medication_viewer"
   */
  name: string;

  /** Human-readable role description */
  description: string;

  /**
   * Organization this role belongs to
   * NULL only for global super_admin role (platform-level)
   */
  organizationId: string | null;

  /**
   * Ltree path defining the hierarchical scope of this role
   * Example: "root.provider.acme_healthcare.main_campus"
   * NULL only for global super_admin role
   */
  orgHierarchyScope: string | null;

  /** Whether the role is currently active */
  isActive: boolean;

  /** When the role was created */
  createdAt: Date;

  /** When the role was last updated */
  updatedAt: Date;

  /** Number of permissions assigned to this role */
  permissionCount: number;

  /** Number of users assigned to this role */
  userCount: number;
}

/**
 * Role with full permission details loaded
 *
 * Extended role type used when viewing/editing a role,
 * includes the full list of associated permissions.
 */
export interface RoleWithPermissions extends Role {
  /** Full list of permissions assigned to this role */
  permissions: Permission[];
}

/**
 * Request payload for creating a new role
 */
export interface CreateRoleRequest {
  /** Role name (will be validated for uniqueness within org) */
  name: string;

  /** Human-readable role description */
  description: string;

  /**
   * Organizational unit scope for this role (ltree path)
   * If not specified, defaults to user's root organization scope
   */
  orgHierarchyScope?: string;

  /** Permission IDs to grant to this role (subject to subset-only rule) */
  permissionIds: string[];
}

/**
 * Request payload for updating an existing role
 */
export interface UpdateRoleRequest {
  /** ID of the role to update */
  id: string;

  /** Updated role name (optional) */
  name?: string;

  /** Updated description (optional) */
  description?: string;

  /**
   * Updated permission IDs (optional)
   * When provided, replaces all current permissions (grant diff, revoke diff)
   * Subject to subset-only delegation rule
   */
  permissionIds?: string[];
}

/**
 * Result from role operations
 */
export interface RoleOperationResult {
  /** Whether the operation succeeded */
  success: boolean;

  /** The resulting role (if successful, for create operations) */
  role?: Role;

  /** Error message (if failed) */
  error?: string;

  /** Detailed error information (if failed) */
  errorDetails?: {
    /**
     * Error code for programmatic handling
     */
    code:
      | 'NOT_FOUND'
      | 'ALREADY_ACTIVE'
      | 'ALREADY_INACTIVE'
      | 'HAS_USERS'
      | 'STILL_ACTIVE'
      | 'SUBSET_ONLY_VIOLATION'
      | 'NO_ORG_CONTEXT'
      | 'VALIDATION_ERROR'
      | 'INACTIVE_ROLE'
      | 'PERMISSION_DENIED'
      | 'UNKNOWN';
    /** Count of blocking items (e.g., user assignments) */
    count?: number;
    /** Human-readable message */
    message: string;
  };
}

/**
 * Filter options for querying roles
 */
export interface RoleFilterOptions {
  /** Filter by active/inactive status */
  status?: 'active' | 'inactive' | 'all';

  /** Search by name or description (case-insensitive) */
  searchTerm?: string;
}

/**
 * Mapping of applet identifiers to human-readable display names
 *
 * Used by PermissionSelector to show friendly group names.
 * Add new applets here as they are introduced.
 */
export const APPLET_DISPLAY_NAMES: Record<string, string> = {
  organization: 'Organization Management',
  client: 'Client Records',
  medication: 'Medication Management',
  user: 'User Management',
  role: 'Role Management',
  a4c_role: 'A4C Internal Roles',
  global_roles: 'Global Roles',
  cross_org: 'Cross-Organization Access',
  users: 'User Impersonation',
};

/**
 * Helper function to group permissions by applet
 *
 * Transforms a flat array of permissions into groups organized by applet,
 * with display names for UI rendering.
 *
 * @param permissions - Flat array of permissions
 * @returns Array of permission groups sorted alphabetically by applet
 */
export function groupPermissionsByApplet(permissions: Permission[]): PermissionGroup[] {
  const grouped = new Map<string, Permission[]>();

  for (const perm of permissions) {
    const existing = grouped.get(perm.applet) || [];
    existing.push(perm);
    grouped.set(perm.applet, existing);
  }

  return Array.from(grouped.entries())
    .map(([applet, perms]) => ({
      applet,
      displayName: APPLET_DISPLAY_NAMES[applet] || toTitleCase(applet),
      permissions: perms.sort((a, b) => a.action.localeCompare(b.action)),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Convert a snake_case or lowercase string to Title Case
 *
 * @param str - Input string (e.g., "medication" or "cross_org")
 * @returns Title case string (e.g., "Medication" or "Cross Org")
 */
function toTitleCase(str: string): string {
  return str
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Check if a permission is grantable by the current user
 *
 * Used by PermissionSelector to disable checkboxes for permissions
 * the user cannot grant (subset-only delegation rule).
 *
 * @param permissionId - ID of the permission to check
 * @param userPermissionIds - Set of permission IDs the user possesses
 * @returns True if the user can grant this permission
 */
export function canGrantPermission(
  permissionId: string,
  userPermissionIds: Set<string>
): boolean {
  return userPermissionIds.has(permissionId);
}

/**
 * Form data structure for role creation/editing
 *
 * Used by RoleFormViewModel to track form state.
 */
export interface RoleFormData {
  /** Role name */
  name: string;

  /** Role description */
  description: string;

  /** Organizational unit scope (optional, null = org root) */
  orgHierarchyScope: string | null;
}

/**
 * Validation rules for role form fields
 */
export const ROLE_VALIDATION = {
  name: {
    minLength: 1,
    maxLength: 100,
    pattern: /^[a-zA-Z][a-zA-Z0-9_\-\s]*$/,
    message: 'Name must start with a letter and contain only letters, numbers, underscores, hyphens, and spaces',
  },
  description: {
    minLength: 10,
    maxLength: 500,
    message: 'Description must be between 10 and 500 characters',
  },
};

/**
 * Validate a role name
 *
 * @param name - Role name to validate
 * @returns Error message or null if valid
 */
export function validateRoleName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'Role name is required';
  }
  if (trimmed.length < ROLE_VALIDATION.name.minLength) {
    return 'Role name is required';
  }
  if (trimmed.length > ROLE_VALIDATION.name.maxLength) {
    return `Role name must be ${ROLE_VALIDATION.name.maxLength} characters or less`;
  }
  if (!ROLE_VALIDATION.name.pattern.test(trimmed)) {
    return ROLE_VALIDATION.name.message;
  }
  return null;
}

/**
 * Validate a role description
 *
 * @param description - Role description to validate
 * @returns Error message or null if valid
 */
export function validateRoleDescription(description: string): string | null {
  const trimmed = description.trim();
  if (trimmed.length === 0) {
    return 'Description is required';
  }
  if (trimmed.length < ROLE_VALIDATION.description.minLength) {
    return `Description must be at least ${ROLE_VALIDATION.description.minLength} characters`;
  }
  if (trimmed.length > ROLE_VALIDATION.description.maxLength) {
    return `Description must be ${ROLE_VALIDATION.description.maxLength} characters or less`;
  }
  return null;
}
