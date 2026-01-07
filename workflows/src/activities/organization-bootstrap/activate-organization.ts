/**
 * ActivateOrganizationActivity
 *
 * Marks organization as active after successful provisioning.
 *
 * Flow:
 * 1. Update organization status to 'active'
 * 2. Set activated_at timestamp
 * 3. Emit OrganizationActivated event
 *
 * Idempotency:
 * - Safe to call multiple times
 * - No-op if already active
 * - Event emission idempotent via event_id
 */

import type { ActivateOrganizationParams } from '@shared/types';
import { getSupabaseClient, emitEvent, buildTags, getLogger, buildTracingForEvent } from '@shared/utils';
import { AGGREGATE_TYPES } from '@shared/constants';

const log = getLogger('ActivateOrganization');

/**
 * Activate organization activity
 * @param params - Activation parameters
 * @returns true if activated successfully
 */
export async function activateOrganization(
  params: ActivateOrganizationParams
): Promise<boolean> {
  log.info('Starting organization activation', { orgId: params.orgId });

  const supabase = getSupabaseClient();

  // Check current status (idempotency) via RPC (PostgREST only exposes 'api' schema)
  const { data: orgData, error: checkError } = await supabase
    .schema('api')
    .rpc('get_organization_status', {
      p_org_id: params.orgId
    });

  if (checkError) {
    throw new Error(`Failed to check organization status: ${checkError.message}`);
  }

  const org = orgData && orgData.length > 0 ? orgData[0] : null;

  if (!org) {
    throw new Error(`Organization not found: ${params.orgId}`);
  }

  if (org.is_active) {
    log.info('Organization already active', { orgId: params.orgId });

    // Emit event even if already active (for event replay)
    await emitEvent({
      event_type: 'organization.activated',
      aggregate_type: AGGREGATE_TYPES.ORGANIZATION,
      aggregate_id: params.orgId,
      event_data: {
        org_id: params.orgId,
        activated_at: new Date().toISOString(),
        previous_is_active: org.is_active
      },
      tags: buildTags(),
      ...buildTracingForEvent(params.tracing, 'activateOrganization')
    });

    return true;
  }

  // Update organization status via RPC (PostgREST only exposes 'api' schema)
  const { error: updateError } = await supabase
    .schema('api')
    .rpc('update_organization_status', {
      p_org_id: params.orgId,
      p_is_active: true,
      p_deactivated_at: null
    });

  if (updateError) {
    throw new Error(`Failed to activate organization: ${updateError.message}`);
  }

  log.info('Organization activated', { orgId: params.orgId });

  // Emit OrganizationActivated event
  const activatedAt = new Date().toISOString();
  await emitEvent({
    event_type: 'organization.activated',
    aggregate_type: 'Organization',
    aggregate_id: params.orgId,
    event_data: {
      org_id: params.orgId,
      activated_at: activatedAt,
      previous_is_active: org.is_active
    },
    tags: buildTags(),
    ...buildTracingForEvent(params.tracing, 'activateOrganization')
  });

  log.debug('Emitted organization.activated event', { orgId: params.orgId });

  return true;
}
