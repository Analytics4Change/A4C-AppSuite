/**
 * Client Assignment Type Definitions
 *
 * Types for managing staff-client assignment mappings.
 * Assignments define which clients are assigned to which staff members
 * for notification routing and caseload management.
 *
 * @see infrastructure/supabase/contracts/asyncapi/domains/user.yaml
 * @see api.assign_client_to_user()
 * @see api.list_user_client_assignments()
 */

/** A user-client assignment from the projection table */
export interface UserClientAssignment {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  client_id: string;
  organization_id: string;
  assigned_at: string;
  assigned_until?: string | null;
  notes?: string | null;
  is_active: boolean;
}
