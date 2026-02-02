/**
 * Assignment Service Interface
 *
 * Defines the contract for managing client-staff assignment mappings.
 *
 * Implementations:
 * - SupabaseAssignmentService: Production (calls api.* RPCs)
 * - MockAssignmentService: Development (in-memory)
 *
 * @see api.assign_client_to_user()
 * @see api.unassign_client_from_user()
 * @see api.list_user_client_assignments()
 */

import type { UserClientAssignment } from '@/types/client-assignment.types';

export interface IAssignmentService {
  listAssignments(params: {
    orgId?: string;
    userId?: string;
    clientId?: string;
    activeOnly?: boolean;
  }): Promise<UserClientAssignment[]>;

  assignClient(params: {
    userId: string;
    clientId: string;
    assignedUntil?: string;
    notes?: string;
    reason?: string;
  }): Promise<{ assignmentId: string }>;

  unassignClient(params: {
    userId: string;
    clientId: string;
    reason?: string;
  }): Promise<void>;
}
