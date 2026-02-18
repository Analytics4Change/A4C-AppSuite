/**
 * Bulk Assignment Type Definitions
 *
 * Types for bulk role assignment operations, enabling administrators
 * to assign multiple users to a role in a single operation.
 *
 * Also contains unified role and schedule assignment management types
 * that extend shared base types from assignment.types.ts.
 *
 * @see assignment.types.ts for shared base types
 * @see documentation/architecture/authorization/rbac-architecture.md
 */

import type {
  BaseManageableUser,
  BaseSyncResult,
  FailedAssignment as BaseFailedAssignment,
} from './assignment.types';

// Re-export shared types for backwards compatibility
export type { AssignmentDialogState, BaseManageableUser, BaseSyncResult } from './assignment.types';

/**
 * Result from a bulk role assignment operation
 *
 * Contains detailed information about successful and failed assignments,
 * allowing partial success handling in the UI.
 */
export interface BulkAssignmentResult {
  /**
   * User IDs that were successfully assigned to the role
   */
  successful: string[];

  /**
   * Users that failed to be assigned, with reasons
   */
  failed: Array<{
    /** UUID of the user that failed */
    userId: string;
    /** Human-readable error message */
    reason: string;
    /** PostgreSQL error state code (e.g., 'P0002', '23505') */
    sqlstate?: string;
  }>;

  /** Total number of users requested for assignment */
  totalRequested: number;

  /** Count of successfully assigned users */
  totalSucceeded: number;

  /** Count of failed assignments */
  totalFailed: number;

  /**
   * Correlation ID linking all events from this bulk operation
   * Use for support tickets and debugging
   */
  correlationId: string;
}

/**
 * A user eligible for bulk role assignment
 *
 * Returned by list_users_for_bulk_assignment() API function.
 * Includes information about current roles and whether already assigned.
 */
export interface SelectableUser {
  /** User UUID */
  id: string;

  /** User's display name */
  displayName: string;

  /** User's email address */
  email: string;

  /** Whether the user is currently active */
  isActive: boolean;

  /**
   * Names of roles currently assigned to this user
   * Used for display context in the selection list
   */
  currentRoles: string[];

  /**
   * Whether this user is already assigned to the target role at the target scope
   * If true, the user should be shown but not selectable (checkbox disabled)
   */
  isAlreadyAssigned: boolean;
}

/**
 * Request parameters for listing users eligible for bulk assignment
 */
export interface ListUsersForBulkAssignmentParams {
  /** UUID of the role being assigned */
  roleId: string;

  /**
   * Ltree scope path for the assignment
   * Example: "acme.pediatrics"
   */
  scopePath: string;

  /**
   * Optional search term to filter users by name or email
   * Case-insensitive substring match
   */
  searchTerm?: string;

  /**
   * Maximum number of users to return (default: 100)
   */
  limit?: number;

  /**
   * Offset for pagination (default: 0)
   */
  offset?: number;
}

/**
 * Request parameters for bulk role assignment
 */
export interface BulkAssignRoleParams {
  /** UUID of the role to assign */
  roleId: string;

  /** Array of user UUIDs to assign the role to */
  userIds: string[];

  /**
   * Ltree scope path for the assignment
   * Example: "acme.pediatrics"
   */
  scopePath: string;

  /**
   * Optional correlation ID to link all events from this operation
   * If not provided, one will be generated server-side
   */
  correlationId?: string;

  /**
   * Optional reason for the bulk assignment (for audit trail)
   * Defaults to "Bulk role assignment" if not provided
   */
  reason?: string;
}

/**
 * Selection state for a user in the bulk assignment UI
 *
 * Extended version of SelectableUser used by the ViewModel
 * to track selection state.
 */
export interface UserSelectionState extends SelectableUser {
  /**
   * Whether the user is currently selected for assignment
   * Controlled by the ViewModel, not from the API
   */
  isSelected: boolean;
}

/**
 * Bulk assignment dialog state
 */
export type BulkAssignmentDialogState =
  | 'idle' // Dialog closed
  | 'selecting' // User is selecting users
  | 'confirming' // User is reviewing before submit
  | 'processing' // Assignment in progress
  | 'completed' // Assignment finished (show results)
  | 'error'; // Fatal error occurred

/**
 * Props for the BulkAssignmentDialog component
 */
export interface BulkAssignmentDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;

  /** Callback when the dialog should close */
  onClose: () => void;

  /** The role being assigned */
  role: {
    id: string;
    name: string;
    description?: string;
  };

  /**
   * Default scope path for the assignment
   * Pre-populated from the role's orgHierarchyScope or user's scope
   */
  defaultScopePath?: string;

  /**
   * Callback after successful assignment
   * Used to refresh the role's assignment list
   */
  onSuccess?: () => void;
}

/**
 * Props for the UserSelectionList component
 */
export interface UserSelectionListProps {
  /** List of users to display */
  users: UserSelectionState[];

  /** Callback when a user's selection state changes */
  onToggleUser: (userId: string) => void;

  /** Callback to select all eligible users */
  onSelectAll: () => void;

  /** Callback to deselect all users */
  onDeselectAll: () => void;

  /** Search term for filtering */
  searchTerm: string;

  /** Callback when search term changes */
  onSearchChange: (term: string) => void;

  /** Whether the list is loading */
  isLoading: boolean;

  /** Whether more users can be loaded */
  hasMore?: boolean;

  /** Callback to load more users */
  onLoadMore?: () => void;
}

/**
 * Props for the AssignmentResultDisplay component
 */
export interface AssignmentResultDisplayProps {
  /** The result from the bulk assignment operation */
  result: BulkAssignmentResult;

  /** Callback to close the result view */
  onClose: () => void;

  /** Callback to retry failed assignments only */
  onRetryFailed?: () => void;
}

// =============================================================================
// UNIFIED ROLE ASSIGNMENT MANAGEMENT TYPES
// Used by the "Manage User Assignments" feature that allows both adding and
// removing role assignments in a single operation.
// =============================================================================

/**
 * Failed assignment/removal details
 * Re-exported from assignment.types.ts for backwards compatibility
 */
export type FailedAssignment = BaseFailedAssignment;

/**
 * Request parameters for listing users for role management
 *
 * Unlike ListUsersForBulkAssignmentParams, this returns ALL users
 * with their current assignment status.
 */
export interface ListUsersForRoleManagementParams {
  /** UUID of the role being managed */
  roleId: string;

  /**
   * Ltree scope path for the assignment
   * Example: "acme.pediatrics"
   */
  scopePath: string;

  /**
   * Optional search term to filter users by name or email
   * Case-insensitive substring match
   */
  searchTerm?: string;

  /**
   * Maximum number of users to return (default: 100)
   */
  limit?: number;

  /**
   * Offset for pagination (default: 0)
   */
  offset?: number;
}

/**
 * A user with their current assignment status for role management
 *
 * Similar to SelectableUser but with isAssigned instead of isAlreadyAssigned,
 * as this is used for the unified management where we show all users.
 */
export interface ManageableUser extends BaseManageableUser {
  /**
   * Names of roles currently assigned to this user
   * Used for display context in the selection list
   */
  currentRoles: string[];
}

/**
 * Request parameters for syncing role assignments (add + remove)
 */
export interface SyncRoleAssignmentsParams {
  /** UUID of the role to manage */
  roleId: string;

  /** Array of user UUIDs to ADD to the role */
  userIdsToAdd: string[];

  /** Array of user UUIDs to REMOVE from the role */
  userIdsToRemove: string[];

  /**
   * Ltree scope path for the assignment
   * Example: "acme.pediatrics"
   */
  scopePath: string;

  /**
   * Optional correlation ID to link all events from this operation
   * If not provided, one will be generated server-side
   */
  correlationId?: string;

  /**
   * Optional reason for the assignment change (for audit trail)
   * Defaults to "Role assignment update" if not provided
   */
  reason?: string;
}

/**
 * Result from the sync role assignments operation
 *
 * Contains detailed information about both additions and removals,
 * allowing partial success handling in the UI.
 */
export type SyncRoleAssignmentsResult = BaseSyncResult;

/**
 * Role assignment management dialog state
 * Alias for shared AssignmentDialogState (backwards compatibility)
 */
export type { AssignmentDialogState as RoleAssignmentDialogState } from './assignment.types';

/**
 * Props for the RoleAssignmentDialog component
 */
export interface RoleAssignmentDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;

  /** Callback when the dialog should close */
  onClose: () => void;

  /** The role being managed */
  role: {
    id: string;
    name: string;
    description?: string;
  };

  /**
   * Scope path for the assignments
   * Pre-populated from the role's orgHierarchyScope or user's scope
   */
  scopePath: string;

  /**
   * Callback after successful save
   * Used to refresh the role's assignment list
   */
  onSuccess?: () => void;
}

// =============================================================================
// SCHEDULE ASSIGNMENT MANAGEMENT TYPES
// Used by the "Manage User Assignments" feature on schedule templates.
// =============================================================================

/**
 * A user with schedule assignment info for management UI
 */
export interface ScheduleManageableUser extends BaseManageableUser {
  /** If user is on a DIFFERENT template, its ID. NULL if unassigned or on this template. */
  currentScheduleId: string | null;
  /** If user is on a DIFFERENT template, its name. NULL otherwise. */
  currentScheduleName: string | null;
}

/** UI state extension for schedule assignment management */
export interface ScheduleManageableUserState extends ScheduleManageableUser {
  isChecked: boolean;
}

/** A user that was auto-transferred from one template to another */
export interface TransferredUser {
  userId: string;
  fromTemplateId: string;
  fromTemplateName: string;
}

/** Result from sync schedule assignments operation */
export interface SyncScheduleAssignmentsResult extends BaseSyncResult {
  transferred: TransferredUser[];
}

/** Request parameters for syncing schedule assignments */
export interface SyncScheduleAssignmentsParams {
  templateId: string;
  userIdsToAdd: string[];
  userIdsToRemove: string[];
  correlationId?: string;
  reason?: string;
}

/** Request parameters for listing users for schedule management */
export interface ListUsersForScheduleManagementParams {
  templateId: string;
  searchTerm?: string;
  limit?: number;
  offset?: number;
}
