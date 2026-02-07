/**
 * EmitBootstrapCompletedActivity
 *
 * Emits an organization.bootstrap.completed event when the bootstrap workflow
 * succeeds. The synchronous trigger handler (handle_bootstrap_completed) sets
 * is_active = true on the organizations_projection.
 *
 * Replaces the old activateOrganization activity which made direct RPC calls
 * to update_organization_status (dual write removed per CQRS audit).
 *
 * Events Emitted:
 * - organization.bootstrap.completed: Records bootstrap success with admin role and permissions
 *
 * See: documentation/architecture/workflows/organization-onboarding-workflow.md
 */

import { getLogger, emitBootstrapCompleted } from '@shared/utils';
import type { WorkflowTracingParams } from '@shared/types';
import { AdminRole } from '@shared/types/generated/events';

const log = getLogger('EmitBootstrapCompleted');

/**
 * Parameters for the emit bootstrap completed activity
 */
export interface EmitBootstrapCompletedParams {
  /** Organization ID */
  orgId: string;
  /** Bootstrap workflow run ID for correlation */
  bootstrapId: string;
  /** Admin role assigned during bootstrap (e.g. 'provider_admin') */
  adminRoleAssigned: string;
  /** Number of permissions granted to admin role */
  permissionsGranted: number;
  /** Ltree path for org hierarchy (if set) */
  ltreePath?: string;
  /** Tracing context for correlation */
  tracing?: WorkflowTracingParams;
}

/**
 * Result of the emit bootstrap completed activity
 */
export interface EmitBootstrapCompletedResult {
  /** Event ID of the emitted completion event */
  eventId: string;
}

/**
 * Emit a bootstrap completion event
 *
 * This activity should be called as the final step of the bootstrap workflow
 * (replacing activateOrganization). The synchronous trigger handler sets
 * is_active = true on the projection.
 *
 * @param params - Completion context parameters
 * @returns Result with the emitted event ID
 */
export async function emitBootstrapCompletedActivity(
  params: EmitBootstrapCompletedParams
): Promise<EmitBootstrapCompletedResult> {
  log.info('Emitting bootstrap completed event', {
    orgId: params.orgId,
    bootstrapId: params.bootstrapId,
    adminRoleAssigned: params.adminRoleAssigned,
    permissionsGranted: params.permissionsGranted,
  });

  const eventId = await emitBootstrapCompleted(params.orgId, {
    bootstrap_id: params.bootstrapId,
    organization_id: params.orgId,
    admin_role_assigned: params.adminRoleAssigned as AdminRole,
    permissions_granted: params.permissionsGranted,
    ltree_path: params.ltreePath,
  }, params.tracing);

  log.info('Bootstrap completed event emitted', {
    eventId,
    bootstrapId: params.bootstrapId,
  });

  return { eventId };
}
