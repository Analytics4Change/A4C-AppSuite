/**
 * Shared Assignment Management Types
 *
 * Domain-agnostic base types used by both role and schedule
 * assignment management features. Domain-specific types extend these.
 *
 * @see bulk-assignment.types.ts for role-specific extensions
 * @see bulk-assignment.types.ts for schedule-specific extensions
 */

/** Base user in an assignment management context */
export interface BaseManageableUser {
  id: string;
  displayName: string;
  email: string;
  isActive: boolean;
  isAssigned: boolean;
}

/** UI state extension -- adds checkbox tracking */
export interface BaseManageableUserState extends BaseManageableUser {
  isChecked: boolean;
}

/** Failed operation detail */
export interface FailedAssignment {
  userId: string;
  reason: string;
  sqlstate?: string;
}

/** Base sync result shape */
export interface BaseSyncResult {
  added: { successful: string[]; failed: FailedAssignment[] };
  removed: { successful: string[]; failed: FailedAssignment[] };
  correlationId: string;
}

/** Assignment dialog state machine (shared by all entity types) */
export type AssignmentDialogState =
  | 'idle'
  | 'loading'
  | 'managing'
  | 'confirming'
  | 'saving'
  | 'completed'
  | 'error';
