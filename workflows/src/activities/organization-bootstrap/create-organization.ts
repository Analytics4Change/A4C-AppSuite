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
  const displayName = params.subdomain || params.name;
  console.log(`[CreateOrganization] Starting for: ${displayName}`);

  const supabase = getSupabaseClient();

  // Check if organization already exists (idempotency)
  // For orgs with subdomains, check slug. For orgs without, check name.
  let existing;

  try {
    if (params.subdomain) {
      const { data, error } = await supabase
        .schema('api')
        .rpc('check_organization_by_slug', {
          p_slug: params.subdomain
        });
      if (error) throw error;
      existing = data && data.length > 0 ? data[0] : null;
    } else {
      const { data, error } = await supabase
        .schema('api')
        .rpc('check_organization_by_name', {
          p_name: params.name
        });
      if (error) throw error;
      existing = data && data.length > 0 ? data[0] : null;
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to check existing organization: ${errorMessage}`);
  }

  if (existing) {
    console.log(`[CreateOrganization] Organization already exists: ${existing.id}`);
    return existing.id;
  }

  // Generate organization ID
  const orgId = uuidv4();

  // Build tags for development entity tracking
  const tags = buildTags();

  // Emit OrganizationCreated event FIRST (event-driven architecture)
  // AsyncAPI contract requires: slug, path (not subdomain, parent_org_id)
  const slug = params.subdomain || params.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const path = params.parentOrgId ? `parent.${slug}` : slug; // TODO: Get actual parent path from DB

  await emitEvent({
    event_type: 'organization.created',
    aggregate_type: 'organization',
    aggregate_id: orgId,
    event_data: {
      name: params.name,
      slug: slug,
      type: params.type,
      path: path,
      partner_type: params.partnerType || null,
      referring_partner_id: params.referringPartnerId || null
    },
    tags
  });

  console.log(`[CreateOrganization] Emitted organization.created event for ${orgId}`);

  // Create contacts and emit events
  const contactIds: string[] = [];
  for (const contact of params.contacts) {
    const contactId = uuidv4();
    contactIds.push(contactId);

    await emitEvent({
      event_type: 'contact.created',
      aggregate_type: 'contact',
      aggregate_id: contactId,
      event_data: {
        organization_id: orgId,
        first_name: contact.firstName,
        last_name: contact.lastName,
        email: contact.email,
        title: contact.title || null,
        department: contact.department || null,
        type: contact.type,
        label: contact.label
      },
      tags
    });

    // Emit organization.contact.linked junction event
    // AsyncAPI contract: stream_type must be 'junction' not 'organization'
    await emitEvent({
      event_type: 'organization.contact.linked',
      aggregate_type: 'junction',
      aggregate_id: orgId,
      event_data: {
        organization_id: orgId,
        contact_id: contactId
      },
      tags
    });
  }

  console.log(`[CreateOrganization] Created ${contactIds.length} contacts for ${orgId}`);

  // Create addresses and emit events
  const addressIds: string[] = [];
  for (const address of params.addresses) {
    const addressId = uuidv4();
    addressIds.push(addressId);

    await emitEvent({
      event_type: 'address.created',
      aggregate_type: 'address',
      aggregate_id: addressId,
      event_data: {
        organization_id: orgId,
        street1: address.street1,
        street2: address.street2 || null,
        city: address.city,
        state: address.state,
        zip_code: address.zipCode,
        type: address.type,
        label: address.label
      },
      tags
    });

    // Emit organization.address.linked junction event
    // AsyncAPI contract: stream_type must be 'junction' not 'organization'
    await emitEvent({
      event_type: 'organization.address.linked',
      aggregate_type: 'junction',
      aggregate_id: orgId,
      event_data: {
        organization_id: orgId,
        address_id: addressId
      },
      tags
    });
  }

  console.log(`[CreateOrganization] Created ${addressIds.length} addresses for ${orgId}`);

  // Create phones and emit events
  const phoneIds: string[] = [];
  for (const phone of params.phones) {
    const phoneId = uuidv4();
    phoneIds.push(phoneId);

    await emitEvent({
      event_type: 'phone.created',
      aggregate_type: 'phone',
      aggregate_id: phoneId,
      event_data: {
        organization_id: orgId,
        number: phone.number,
        extension: phone.extension || null,
        type: phone.type,
        label: phone.label
      },
      tags
    });

    // Emit organization.phone.linked junction event
    // AsyncAPI contract: stream_type must be 'junction' not 'organization'
    await emitEvent({
      event_type: 'organization.phone.linked',
      aggregate_type: 'junction',
      aggregate_id: orgId,
      event_data: {
        organization_id: orgId,
        phone_id: phoneId
      },
      tags
    });
  }

  console.log(`[CreateOrganization] Created ${phoneIds.length} phones for ${orgId}`);
  console.log(`[CreateOrganization] Successfully created organization ${orgId} with all related entities`);

  return orgId;
}
