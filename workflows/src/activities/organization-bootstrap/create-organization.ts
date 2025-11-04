/**
 * CreateOrganizationActivity
 *
 * Creates a new organization in the database and emits OrganizationCreated event.
 *
 * Idempotency:
 * - Check if organization exists with same subdomain
 * - If exists, return existing organization ID
 * - Event emission idempotent via event_id
 *
 * Tags:
 * - Applies development tags if TAG_DEV_ENTITIES=true
 * - Tags propagate to invitations and other related entities
 */

import { v4 as uuidv4 } from 'uuid';
import type { CreateOrganizationParams } from '@shared/types';
import { getSupabaseClient } from '@shared/utils/supabase';
import { emitEvent, buildTags } from '@shared/utils/emit-event';

/**
 * Create organization activity
 * @param params - Organization creation parameters
 * @returns Created organization ID
 */
export async function createOrganization(
  params: CreateOrganizationParams
): Promise<string> {
  console.log(`[CreateOrganization] Starting for subdomain: ${params.subdomain}`);

  const supabase = getSupabaseClient();

  // Check if organization already exists (idempotency)
  const { data: existing, error: checkError } = await supabase
    .from('organizations_projection')
    .select('id')
    .eq('subdomain', params.subdomain)
    .maybeSingle();

  if (checkError) {
    throw new Error(`Failed to check existing organization: ${checkError.message}`);
  }

  if (existing) {
    console.log(`[CreateOrganization] Organization already exists: ${existing.id}`);
    return existing.id;
  }

  // Generate organization ID
  const orgId = uuidv4();

  // Build tags for development entity tracking
  const tags = buildTags();

  // Create organization record
  const { error: insertError } = await supabase
    .from('organizations_projection')
    .insert({
      id: orgId,
      name: params.name,
      type: params.type,
      parent_org_id: params.parentOrgId,
      contact_email: params.contactEmail,
      subdomain: params.subdomain,
      status: 'provisioning',
      tags
    });

  if (insertError) {
    throw new Error(`Failed to create organization: ${insertError.message}`);
  }

  console.log(`[CreateOrganization] Created organization: ${orgId}`);

  // Emit OrganizationCreated event
  await emitEvent({
    event_type: 'OrganizationCreated',
    aggregate_type: 'Organization',
    aggregate_id: orgId,
    event_data: {
      org_id: orgId,
      name: params.name,
      type: params.type,
      parent_org_id: params.parentOrgId,
      contact_email: params.contactEmail,
      subdomain: params.subdomain,
      status: 'provisioning'
    },
    tags
  });

  console.log(`[CreateOrganization] Emitted OrganizationCreated event for ${orgId}`);

  return orgId;
}
