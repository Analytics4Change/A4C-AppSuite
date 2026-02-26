/**
 * EmitDeletionCompletedActivity
 *
 * Emits the organization.deletion.completed domain event to mark the
 * successful completion of the deletion workflow. This event is recorded
 * in the audit trail and the router has a no-op CASE for it.
 *
 * Idempotency:
 * - Safe to call multiple times (event deduplication via event_id)
 */

import type { EmitDeletionCompletedParams } from '@shared/types';
import { emitDeletionCompleted, getLogger } from '@shared/utils';

const log = getLogger('EmitDeletionCompleted');

/**
 * Emit deletion completed event
 * @param params - Activity parameters
 * @returns Event ID
 */
export async function emitDeletionCompletedActivity(
  params: EmitDeletionCompletedParams
): Promise<string> {
  log.info('Emitting organization.deletion.completed event', {
    orgId: params.orgId,
    workflowId: params.workflowId,
    dnsRemoved: params.dnsRemoved,
    usersDeactivated: params.usersDeactivated,
    invitationsRevoked: params.invitationsRevoked,
  });

  const eventId = await emitDeletionCompleted(
    params.orgId,
    {
      organization_id: params.orgId,
      workflow_id: params.workflowId,
      dns_removed: params.dnsRemoved,
      users_deactivated: params.usersDeactivated,
      invitations_revoked: params.invitationsRevoked,
    },
    params.tracing
  );

  log.info('Deletion completed event emitted', { eventId });
  return eventId;
}
