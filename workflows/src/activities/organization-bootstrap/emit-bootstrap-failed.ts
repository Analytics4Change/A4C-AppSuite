/**
 * EmitBootstrapFailedActivity
 *
 * Emits an organization.bootstrap.failed event when the bootstrap workflow fails.
 * This activity captures failure context for audit and debugging purposes.
 *
 * Called from the workflow's catch block BEFORE running compensation activities,
 * ensuring the failure is recorded even if compensation also fails.
 *
 * Events Emitted:
 * - organization.bootstrap.failed: Records bootstrap failure with stage and error details
 *
 * See: documentation/architecture/workflows/organization-onboarding-workflow.md
 */

import { getLogger, emitBootstrapFailed, BootstrapFailureStage } from '@shared/utils';
import type { WorkflowTracingParams } from '@shared/types';

const log = getLogger('EmitBootstrapFailed');

/**
 * Parameters for the emit bootstrap failed activity
 */
export interface EmitBootstrapFailedParams {
  /** Organization ID (may be undefined if failed before org creation) */
  orgId: string;
  /** Bootstrap workflow run ID for correlation */
  bootstrapId: string;
  /** Stage at which the bootstrap failed */
  failureStage: BootstrapFailureStage;
  /** Human-readable error message */
  errorMessage: string;
  /** Whether partial cleanup is needed (some resources were created) */
  partialCleanupRequired: boolean;
  /** Tracing context for correlation */
  tracing?: WorkflowTracingParams;
}

/**
 * Result of the emit bootstrap failed activity
 */
export interface EmitBootstrapFailedResult {
  /** Event ID of the emitted failure event */
  eventId: string;
}

/**
 * Emit a bootstrap failure event
 *
 * This activity should be called from the workflow catch block to record
 * failures before attempting compensation. The event captures:
 * - Which stage failed (org creation, DNS, admin user, etc.)
 * - The error message for debugging
 * - Whether cleanup is needed
 *
 * @param params - Failure context parameters
 * @returns Result with the emitted event ID
 */
export async function emitBootstrapFailedActivity(
  params: EmitBootstrapFailedParams
): Promise<EmitBootstrapFailedResult> {
  log.info('Emitting bootstrap failure event', {
    orgId: params.orgId,
    bootstrapId: params.bootstrapId,
    failureStage: params.failureStage,
    partialCleanupRequired: params.partialCleanupRequired,
  });

  const eventId = await emitBootstrapFailed(params.orgId, {
    bootstrap_id: params.bootstrapId,
    failure_stage: params.failureStage,
    error_message: params.errorMessage,
    partial_cleanup_required: params.partialCleanupRequired,
  }, params.tracing);

  log.info('Bootstrap failure event emitted', {
    eventId,
    bootstrapId: params.bootstrapId,
  });

  return { eventId };
}
