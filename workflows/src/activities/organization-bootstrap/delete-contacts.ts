/**
 * DeleteContactsActivity (Compensation)
 *
 * Deletes all contacts associated with an organization during workflow rollback.
 * Emits contact.deleted events for each contact (event-driven cascade deletion).
 *
 * Idempotency:
 * - Safe to retry (query + emit events pattern)
 * - Event emission idempotent via event_id
 *
 * Best-Effort:
 * - Always returns true (never fails workflow)
 * - Logs errors but continues
 */

import type { DeleteContactsParams } from '@shared/types';
import { getSupabaseClient } from '@shared/utils/supabase';
import { emitEvent, buildTags } from '@shared/utils/emit-event';

/**
 * Delete contacts compensation activity
 * @param params - Deletion parameters
 * @returns Always true (best-effort)
 */
export async function deleteContacts(params: DeleteContactsParams): Promise<boolean> {
  console.log(`[DeleteContacts] Starting for organization: ${params.orgId}`);

  try {
    const supabase = getSupabaseClient();
    const tags = buildTags();

    // Query all contacts for organization via RPC (PostgREST only exposes 'api' schema)
    const { data: contacts, error: queryError } = await supabase
      .schema('api')
      .rpc('get_contacts_by_org', {
        p_org_id: params.orgId
      });

    if (queryError) {
      console.error(`[DeleteContacts] Query failed: ${queryError.message}`);
      return true; // Best-effort: don't fail workflow
    }

    if (!contacts || contacts.length === 0) {
      console.log(`[DeleteContacts] No contacts found for organization ${params.orgId}`);
      return true;
    }

    // Emit contact.deleted event for each contact
    for (const contact of contacts) {
      try {
        await emitEvent({
          event_type: 'contact.deleted',
          aggregate_type: 'contact',
          aggregate_id: contact.id,
          event_data: {
            contact_id: contact.id,
            organization_id: params.orgId
          },
          tags
        });

        console.log(`[DeleteContacts] Emitted contact.deleted for ${contact.id}`);
      } catch (eventError) {
        console.error(`[DeleteContacts] Failed to emit event for ${contact.id}:`, eventError);
        // Continue with other contacts
      }
    }

    console.log(`[DeleteContacts] Completed for ${params.orgId} (${contacts.length} contacts)`);
    return true;

  } catch (error) {
    console.error(`[DeleteContacts] Unexpected error for ${params.orgId}:`, error);
    return true; // Best-effort: don't fail workflow
  }
}
