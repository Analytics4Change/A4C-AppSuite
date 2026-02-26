/**
 * EmitDeletionInitiatedActivity
 *
 * Emits the organization.deletion.initiated domain event to mark the start
 * of the deletion workflow. This event is recorded in the audit trail and
 * the router has a no-op CASE for it (no projection update needed).
 *
 * Idempotency:
 * - Safe to call multiple times (event deduplication via event_id)
 */

import type { EmitDeletionInitiatedParams } from '@shared/types';
import { emitDeletionInitiated, getLogger } from '@shared/utils';

const log = getLogger('EmitDeletionInitiated');

/**
 * Emit deletion initiated event
 * @param params - Activity parameters
 * @returns Event ID
 */
export async function emitDeletionInitiatedActivity(
  params: EmitDeletionInitiatedParams
): Promise<string> {
  log.info('Emitting organization.deletion.initiated event', {
    orgId: params.orgId,
    workflowId: params.workflowId,
  });

  const eventId = await emitDeletionInitiated(
    params.orgId,
    {
      organization_id: params.orgId,
      workflow_id: params.workflowId,
      reason: params.reason,
      initiated_by: params.initiatedBy,
    },
    params.tracing
  );

  log.info('Deletion initiated event emitted', { eventId });
  return eventId;
}
