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
import { getSupabaseClient, getLogger, emitContactDeleted } from '@shared/utils';

const log = getLogger('DeleteContacts');

/**
 * Delete contacts compensation activity
 * @param params - Deletion parameters
 * @returns Always true (best-effort)
 */
export async function deleteContacts(params: DeleteContactsParams): Promise<boolean> {
  log.info('Starting contact deletion', { orgId: params.orgId });

  try {
    const supabase = getSupabaseClient();

    // 1. Soft-delete junction records FIRST (prevents orphaned junctions)
    const { data: junctionCount, error: junctionError } = await supabase
      .schema('api')
      .rpc('soft_delete_organization_contacts', {
        p_org_id: params.orgId
      });

    if (junctionError) {
      log.warn('Junction soft-delete failed', { error: junctionError.message });
      // Continue anyway (best-effort)
    } else {
      log.debug('Soft-deleted junction records', { count: junctionCount });
    }

    // 2. Query all contacts for organization via RPC (PostgREST only exposes 'api' schema)
    const { data: contacts, error: queryError } = await supabase
      .schema('api')
      .rpc('get_contacts_by_org', {
        p_org_id: params.orgId
      });

    if (queryError) {
      log.warn('Query failed', { error: queryError.message });
      return true; // Best-effort: don't fail workflow
    }

    if (!contacts || contacts.length === 0) {
      log.info('No contacts found', { orgId: params.orgId });
      return true;
    }

    // 3. Emit contact.deleted event for each contact (audit trail)
    // Note: Compensation activities don't have tracing context
    for (const contact of contacts) {
      try {
        await emitContactDeleted(contact.id, {
          contact_id: contact.id,
          organization_id: params.orgId,
          reason: 'Organization bootstrap rollback',
        });

        log.debug('Emitted contact.deleted', { contactId: contact.id });
      } catch (eventError) {
        log.error('Failed to emit event', { contactId: contact.id, error: eventError instanceof Error ? eventError.message : String(eventError) });
        // Continue with other contacts
      }
    }

    log.info('Deletion completed', { orgId: params.orgId, count: contacts.length });
    return true;

  } catch (error) {
    log.error('Unexpected error', { orgId: params.orgId, error: error instanceof Error ? error.message : String(error) });
    return true; // Best-effort: don't fail workflow
  }
}
