/**
 * CreateOrganizationActivity
 *
 * Creates a new organization in the database and emits OrganizationCreated event.
 * Supports two input modes:
 * 1. Legacy mode: contacts/phones/addresses arrays (deprecated)
 * 2. Bootstrap mode: bootstrapContacts/bootstrapPhones/bootstrapEmails/bootstrapAddresses
 *    arrays with temp_id and contact_ref for entity correlation
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
import type { CreateOrganizationParams, CreateOrganizationResult } from '@shared/types';
import {
  getSupabaseClient,
  emitEvent,
  buildTags,
  getLogger,
  buildTracingForEvent,
  // Type-safe event emitters for entities
  emitContactCreated,
  emitPhoneCreated,
  emitAddressCreated,
  emitEmailCreated,
  // Type-safe event emitters for org↔entity junctions
  emitOrganizationContactLinked,
  emitOrganizationPhoneLinked,
  emitOrganizationAddressLinked,
  emitOrganizationEmailLinked,
  // Type-safe event emitters for contact↔entity junctions
  emitContactPhoneLinked,
  emitContactAddressLinked,
  emitContactEmailLinked,
  // Type mapping utilities (for legacy mode)
  mapContactType,
  mapPhoneType,
  mapAddressType,
  mapEmailType,
} from '@shared/utils';

const log = getLogger('CreateOrganization');

/**
 * Create organization activity
 * @param params - Organization creation parameters (includes pre-generated organizationId)
 * @returns Created organization ID and contactsByEmail map for invitation linking
 */
export async function createOrganization(
  params: CreateOrganizationParams
): Promise<CreateOrganizationResult> {
  const displayName = params.subdomain || params.name;
  log.info('Starting organization creation', {
    displayName,
    organizationId: params.organizationId,
    mode: params.bootstrapContacts ? 'bootstrap' : 'legacy'
  });

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
    log.info('Organization already exists', {
      slug: params.subdomain || params.name,
      existingId: existing.id,
      requestedId: params.organizationId
    });
    // Return the requested organizationId to maintain unified ID system
    // This ensures status polling works even on activity retries
    // Note: contactsByEmail is empty because we don't have the contact IDs from a prior run
    // This is acceptable because idempotent retries will skip invitation generation if already done
    return { orgId: params.organizationId, contactsByEmail: {} };
  }

  // Use the pre-generated organization ID from the API
  // This ensures the same ID is used for status polling (stream_id in events)
  const orgId = params.organizationId;

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
    tags,
    ...buildTracingForEvent(params.tracing, 'createOrganization')
  });

  log.debug('Emitted organization.created event', { orgId });

  // Determine which mode to use: bootstrap (with temp_id correlation) or legacy
  let contactsByEmail: Record<string, string>;
  if (params.bootstrapContacts || params.bootstrapPhones || params.bootstrapEmails || params.bootstrapAddresses) {
    contactsByEmail = await createEntitiesWithCorrelation(orgId, params);
  } else {
    contactsByEmail = await createEntitiesLegacy(orgId, params);
  }

  log.info('Successfully created organization with all related entities', {
    orgId,
    contactCount: Object.keys(contactsByEmail).length
  });
  return { orgId, contactsByEmail };
}

/**
 * Create entities using bootstrap mode with temp_id → UUID correlation.
 * This mode supports contact↔entity relationships via contact_ref.
 * @returns Map of contact email → contactId for linking invitations to contacts
 */
async function createEntitiesWithCorrelation(
  orgId: string,
  params: CreateOrganizationParams
): Promise<Record<string, string>> {
  // Build temp_id → real UUID map for contacts
  const contactIdMap = new Map<string, string>();
  // Build email → contactId map for invitation linking
  const contactsByEmail: Record<string, string> = {};

  // 1. Create contacts first (so we can resolve contact_ref later)
  for (const contact of params.bootstrapContacts ?? []) {
    const contactId = uuidv4();
    contactIdMap.set(contact.temp_id, contactId);

    // Track email → contactId mapping for invitation linking
    if (contact.email) {
      contactsByEmail[contact.email.toLowerCase()] = contactId;
    }

    // Type-safe contact.created event
    // Note: ContactCreationData requires email, but bootstrap input allows optional email
    // For contacts without email, we use an empty string (the email entity handles org-level emails)
    await emitContactCreated(contactId, {
      organization_id: orgId,
      label: contact.label,
      type: contact.type,
      first_name: contact.first_name,
      last_name: contact.last_name,
      email: contact.email ?? '',
      title: contact.title,
      department: contact.department,
    }, params.tracing);

    // Type-safe organization.contact.linked junction event
    await emitOrganizationContactLinked(orgId, {
      organization_id: orgId,
      contact_id: contactId,
    }, params.tracing);
  }

  log.debug('Created contacts with correlation', {
    count: contactIdMap.size,
    orgId,
    tempIds: Array.from(contactIdMap.keys()),
    emailCount: Object.keys(contactsByEmail).length
  });

  // 2. Create phones with contact_ref resolution
  const phoneIds: string[] = [];
  for (const phone of params.bootstrapPhones ?? []) {
    const phoneId = uuidv4();
    phoneIds.push(phoneId);

    // Type-safe phone.created event
    await emitPhoneCreated(phoneId, {
      organization_id: orgId,
      label: phone.label,
      type: phone.type,
      number: phone.number,
      extension: phone.extension,
    }, params.tracing);

    // Type-safe organization.phone.linked junction event
    await emitOrganizationPhoneLinked(orgId, {
      organization_id: orgId,
      phone_id: phoneId,
    }, params.tracing);

    // If phone has contact_ref, link to contact
    if (phone.contact_ref) {
      const contactId = contactIdMap.get(phone.contact_ref);
      if (contactId) {
        await emitContactPhoneLinked(contactId, {
          contact_id: contactId,
          phone_id: phoneId,
        }, params.tracing);
        log.debug('Linked phone to contact', { phoneId, contactId, contactRef: phone.contact_ref });
      } else {
        log.warn('Phone contact_ref not found in contact map', {
          phoneId,
          contactRef: phone.contact_ref,
          availableTempIds: Array.from(contactIdMap.keys())
        });
      }
    }
  }

  log.debug('Created phones', { count: phoneIds.length, orgId });

  // 3. Create emails with contact_ref resolution
  const emailIds: string[] = [];
  for (const email of params.bootstrapEmails ?? []) {
    const emailId = uuidv4();
    emailIds.push(emailId);

    // Type-safe email.created event
    await emitEmailCreated(emailId, {
      organization_id: orgId,
      label: email.label,
      type: email.type,
      address: email.address,
    }, params.tracing);

    // Type-safe organization.email.linked junction event
    await emitOrganizationEmailLinked(orgId, {
      organization_id: orgId,
      email_id: emailId,
    }, params.tracing);

    // If email has contact_ref, link to contact
    if (email.contact_ref) {
      const contactId = contactIdMap.get(email.contact_ref);
      if (contactId) {
        await emitContactEmailLinked(contactId, {
          contact_id: contactId,
          email_id: emailId,
        }, params.tracing);
        log.debug('Linked email to contact', { emailId, contactId, contactRef: email.contact_ref });
      } else {
        log.warn('Email contact_ref not found in contact map', {
          emailId,
          contactRef: email.contact_ref,
          availableTempIds: Array.from(contactIdMap.keys())
        });
      }
    }
  }

  log.debug('Created emails', { count: emailIds.length, orgId });

  // 4. Create addresses with contact_ref resolution
  const addressIds: string[] = [];
  for (const address of params.bootstrapAddresses ?? []) {
    const addressId = uuidv4();
    addressIds.push(addressId);

    // Type-safe address.created event
    await emitAddressCreated(addressId, {
      organization_id: orgId,
      label: address.label,
      type: address.type,
      street1: address.street1,
      street2: address.street2,
      city: address.city,
      state: address.state,
      zip_code: address.zip_code,
    }, params.tracing);

    // Type-safe organization.address.linked junction event
    await emitOrganizationAddressLinked(orgId, {
      organization_id: orgId,
      address_id: addressId,
    }, params.tracing);

    // If address has contact_ref, link to contact
    if (address.contact_ref) {
      const contactId = contactIdMap.get(address.contact_ref);
      if (contactId) {
        await emitContactAddressLinked(contactId, {
          contact_id: contactId,
          address_id: addressId,
        }, params.tracing);
        log.debug('Linked address to contact', { addressId, contactId, contactRef: address.contact_ref });
      } else {
        log.warn('Address contact_ref not found in contact map', {
          addressId,
          contactRef: address.contact_ref,
          availableTempIds: Array.from(contactIdMap.keys())
        });
      }
    }
  }

  log.debug('Created addresses', { count: addressIds.length, orgId });

  return contactsByEmail;
}

/**
 * Create entities using legacy mode (no contact correlation).
 * All entities are linked to org only, not to each other.
 * @deprecated Use bootstrap mode with temp_id/contact_ref for new code
 * @returns Map of contact email → contactId for linking invitations to contacts
 */
async function createEntitiesLegacy(
  orgId: string,
  params: CreateOrganizationParams
): Promise<Record<string, string>> {
  // Create contacts and emit events (using type-safe emitters)
  const contactIds: string[] = [];
  // Build email → contactId map for invitation linking
  const contactsByEmail: Record<string, string> = {};

  for (const contact of params.contacts) {
    const contactId = uuidv4();
    contactIds.push(contactId);

    // Track email → contactId mapping for invitation linking
    if (contact.email) {
      contactsByEmail[contact.email.toLowerCase()] = contactId;
    }

    // Type-safe contact.created event
    await emitContactCreated(contactId, {
      organization_id: orgId,
      label: contact.label,
      type: mapContactType(contact.type),
      first_name: contact.firstName,
      last_name: contact.lastName,
      email: contact.email,
      title: contact.title,
      department: contact.department,
    }, params.tracing);

    // Type-safe organization.contact.linked junction event
    await emitOrganizationContactLinked(orgId, {
      organization_id: orgId,
      contact_id: contactId,
    }, params.tracing);
  }

  log.debug('Created contacts (legacy)', {
    count: contactIds.length,
    orgId,
    emailCount: Object.keys(contactsByEmail).length
  });

  // Create addresses and emit events (using type-safe emitters)
  const addressIds: string[] = [];
  for (const address of params.addresses) {
    const addressId = uuidv4();
    addressIds.push(addressId);

    // Type-safe address.created event
    await emitAddressCreated(addressId, {
      organization_id: orgId,
      label: address.label,
      type: mapAddressType(address.type),
      street1: address.street1,
      street2: address.street2,
      city: address.city,
      state: address.state,
      zip_code: address.zipCode,
    }, params.tracing);

    // Type-safe organization.address.linked junction event
    await emitOrganizationAddressLinked(orgId, {
      organization_id: orgId,
      address_id: addressId,
    }, params.tracing);
  }

  log.debug('Created addresses (legacy)', { count: addressIds.length, orgId });

  // Create phones and emit events (using type-safe emitters)
  const phoneIds: string[] = [];
  for (const phone of params.phones) {
    const phoneId = uuidv4();
    phoneIds.push(phoneId);

    // Type-safe phone.created event
    await emitPhoneCreated(phoneId, {
      organization_id: orgId,
      label: phone.label,
      type: mapPhoneType(phone.type),
      number: phone.number,
      extension: phone.extension,
    }, params.tracing);

    // Type-safe organization.phone.linked junction event
    await emitOrganizationPhoneLinked(orgId, {
      organization_id: orgId,
      phone_id: phoneId,
    }, params.tracing);
  }

  log.debug('Created phones (legacy)', { count: phoneIds.length, orgId });

  // Create emails if provided (legacy mode)
  if (params.emails) {
    const emailIds: string[] = [];
    for (const email of params.emails) {
      const emailId = uuidv4();
      emailIds.push(emailId);

      // Type-safe email.created event
      await emitEmailCreated(emailId, {
        organization_id: orgId,
        label: email.label,
        type: mapEmailType(email.type),
        address: email.address,
      }, params.tracing);

      // Type-safe organization.email.linked junction event
      await emitOrganizationEmailLinked(orgId, {
        organization_id: orgId,
        email_id: emailId,
      }, params.tracing);
    }

    log.debug('Created emails (legacy)', { count: emailIds.length, orgId });
  }

  return contactsByEmail;
}
