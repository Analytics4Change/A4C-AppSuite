/**
 * DeletePhonesActivity (Compensation)
 *
 * Deletes all phones associated with an organization during workflow rollback.
 * Emits phone.deleted events for each phone (event-driven cascade deletion).
 *
 * Idempotency:
 * - Safe to retry (query + emit events pattern)
 * - Event emission idempotent via event_id
 *
 * Best-Effort:
 * - Always returns true (never fails workflow)
 * - Logs errors but continues
 */

import type { DeletePhonesParams } from '@shared/types';
import { getSupabaseClient, emitEvent, buildTags, getLogger } from '@shared/utils';

const log = getLogger('DeletePhones');

/**
 * Delete phones compensation activity
 * @param params - Deletion parameters
 * @returns Always true (best-effort)
 */
export async function deletePhones(params: DeletePhonesParams): Promise<boolean> {
  log.info('Starting phone deletion', { orgId: params.orgId });

  try {
    const supabase = getSupabaseClient();
    const tags = buildTags();

    // 1. Soft-delete junction records FIRST (prevents orphaned junctions)
    const { data: junctionCount, error: junctionError } = await supabase
      .schema('api')
      .rpc('soft_delete_organization_phones', {
        p_org_id: params.orgId
      });

    if (junctionError) {
      log.warn('Junction soft-delete failed', { error: junctionError.message });
      // Continue anyway (best-effort)
    } else {
      log.debug('Soft-deleted junction records', { count: junctionCount });
    }

    // 2. Query all phones for organization via RPC (PostgREST only exposes 'api' schema)
    const { data: phones, error: queryError } = await supabase
      .schema('api')
      .rpc('get_phones_by_org', {
        p_org_id: params.orgId
      });

    if (queryError) {
      log.warn('Query failed', { error: queryError.message });
      return true; // Best-effort: don't fail workflow
    }

    if (!phones || phones.length === 0) {
      log.info('No phones found', { orgId: params.orgId });
      return true;
    }

    // 3. Emit phone.deleted event for each phone (audit trail)
    for (const phone of phones) {
      try {
        await emitEvent({
          event_type: 'phone.deleted',
          aggregate_type: 'phone',
          aggregate_id: phone.id,
          event_data: {
            phone_id: phone.id,
            organization_id: params.orgId
          },
          tags
        });

        log.debug('Emitted phone.deleted', { phoneId: phone.id });
      } catch (eventError) {
        log.error('Failed to emit event', { phoneId: phone.id, error: eventError instanceof Error ? eventError.message : String(eventError) });
        // Continue with other phones
      }
    }

    log.info('Deletion completed', { orgId: params.orgId, count: phones.length });
    return true;

  } catch (error) {
    log.error('Unexpected error', { orgId: params.orgId, error: error instanceof Error ? error.message : String(error) });
    return true; // Best-effort: don't fail workflow
  }
}
