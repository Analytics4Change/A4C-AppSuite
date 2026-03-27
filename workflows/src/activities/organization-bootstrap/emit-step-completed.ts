/**
 * EmitBootstrapStepCompletedActivity
 *
 * Emits an organization.bootstrap.step_completed event after each workflow step
 * succeeds. These events are queried by get_bootstrap_status() to build the
 * dynamic progress stages array for the frontend status page.
 *
 * Events Emitted:
 * - organization.bootstrap.step_completed: Records which workflow step completed
 *
 * The event is emitted to the organization's stream_id so the status RPC can
 * find it with a single stream_id query.
 */

import { getLogger, emitBootstrapStepCompleted } from '@shared/utils';
import type { WorkflowTracingParams } from '@shared/types';
import { BootstrapStepKey } from '@shared/types/generated/events';

const log = getLogger('EmitBootstrapStepCompleted');

/**
 * Parameters for the emit bootstrap step completed activity
 */
export interface EmitStepCompletedParams {
  /** Organization ID (stream_id for the event) */
  orgId: string;
  /** Which workflow step completed */
  stepKey: string;
  /** Tracing context for correlation */
  tracing?: WorkflowTracingParams;
}

/**
 * Emit a bootstrap step completion event
 *
 * Called after each workflow step succeeds. The event is a lightweight progress
 * marker — no projection update needed. The get_bootstrap_status() RPC queries
 * these events to build the stages array dynamically.
 *
 * @param params - Step completion context
 */
export async function emitBootstrapStepCompletedActivity(
  params: EmitStepCompletedParams
): Promise<void> {
  log.info('Emitting bootstrap step completed event', {
    orgId: params.orgId,
    stepKey: params.stepKey,
  });

  await emitBootstrapStepCompleted(params.orgId, {
    organization_id: params.orgId,
    step_key: params.stepKey as BootstrapStepKey,
  }, params.tracing);

  log.info('Bootstrap step completed event emitted', {
    orgId: params.orgId,
    stepKey: params.stepKey,
  });
}
