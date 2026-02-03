/**
 * Bulk Assignment Type Definitions
 *
 * Types for bulk role assignment operations, enabling administrators
 * to assign multiple users to a role in a single operation.
 *
 * @see documentation/architecture/authorization/rbac-architecture.md
 * @see infrastructure/supabase/supabase/migrations/20260203190007_bulk_role_assignment.sql
 */

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
  | 'idle'           // Dialog closed
  | 'selecting'      // User is selecting users
  | 'confirming'     // User is reviewing before submit
  | 'processing'     // Assignment in progress
  | 'completed'      // Assignment finished (show results)
  | 'error';         // Fatal error occurred

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
