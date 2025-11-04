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
import { getSupabaseClient } from '@shared/utils/supabase';
import { emitEvent, buildTags } from '@shared/utils/emit-event';

/**
 * Activate organization activity
 * @param params - Activation parameters
 * @returns true if activated successfully
 */
export async function activateOrganization(
  params: ActivateOrganizationParams
): Promise<boolean> {
  console.log(`[ActivateOrganization] Starting for org: ${params.orgId}`);

  const supabase = getSupabaseClient();

  // Check current status (idempotency)
  const { data: org, error: checkError } = await supabase
    .from('organizations_projection')
    .select('status')
    .eq('id', params.orgId)
    .single();

  if (checkError) {
    throw new Error(`Failed to check organization status: ${checkError.message}`);
  }

  if (!org) {
    throw new Error(`Organization not found: ${params.orgId}`);
  }

  if (org.status === 'active') {
    console.log(`[ActivateOrganization] Organization already active: ${params.orgId}`);

    // Emit event even if already active (for event replay)
    await emitEvent({
      event_type: 'OrganizationActivated',
      aggregate_type: 'Organization',
      aggregate_id: params.orgId,
      event_data: {
        org_id: params.orgId,
        activated_at: new Date().toISOString(),
        previous_status: org.status
      },
      tags: buildTags()
    });

    return true;
  }

  // Update organization status
  const activatedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('organizations_projection')
    .update({
      status: 'active',
      activated_at: activatedAt
    })
    .eq('id', params.orgId);

  if (updateError) {
    throw new Error(`Failed to activate organization: ${updateError.message}`);
  }

  console.log(`[ActivateOrganization] Organization activated: ${params.orgId}`);

  // Emit OrganizationActivated event
  await emitEvent({
    event_type: 'OrganizationActivated',
    aggregate_type: 'Organization',
    aggregate_id: params.orgId,
    event_data: {
      org_id: params.orgId,
      activated_at: activatedAt,
      previous_status: org.status
    },
    tags: buildTags()
  });

  console.log(`[ActivateOrganization] Emitted OrganizationActivated event for ${params.orgId}`);

  return true;
}
