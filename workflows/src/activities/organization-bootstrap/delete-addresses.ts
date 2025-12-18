/**
 * DeleteAddressesActivity (Compensation)
 *
 * Deletes all addresses associated with an organization during workflow rollback.
 * Emits address.deleted events for each address (event-driven cascade deletion).
 *
 * Idempotency:
 * - Safe to retry (query + emit events pattern)
 * - Event emission idempotent via event_id
 *
 * Best-Effort:
 * - Always returns true (never fails workflow)
 * - Logs errors but continues
 */

import type { DeleteAddressesParams } from '@shared/types';
import { getSupabaseClient, emitEvent, buildTags, getLogger } from '@shared/utils';

const log = getLogger('DeleteAddresses');

/**
 * Delete addresses compensation activity
 * @param params - Deletion parameters
 * @returns Always true (best-effort)
 */
export async function deleteAddresses(params: DeleteAddressesParams): Promise<boolean> {
  log.info('Starting address deletion', { orgId: params.orgId });

  try {
    const supabase = getSupabaseClient();
    const tags = buildTags();

    // 1. Soft-delete junction records FIRST (prevents orphaned junctions)
    const { data: junctionCount, error: junctionError } = await supabase
      .schema('api')
      .rpc('soft_delete_organization_addresses', {
        p_org_id: params.orgId
      });

    if (junctionError) {
      log.warn('Junction soft-delete failed', { error: junctionError.message });
      // Continue anyway (best-effort)
    } else {
      log.debug('Soft-deleted junction records', { count: junctionCount });
    }

    // 2. Query all addresses for organization via RPC (PostgREST only exposes 'api' schema)
    const { data: addresses, error: queryError } = await supabase
      .schema('api')
      .rpc('get_addresses_by_org', {
        p_org_id: params.orgId
      });

    if (queryError) {
      log.warn('Query failed', { error: queryError.message });
      return true; // Best-effort: don't fail workflow
    }

    if (!addresses || addresses.length === 0) {
      log.info('No addresses found', { orgId: params.orgId });
      return true;
    }

    // 3. Emit address.deleted event for each address (audit trail)
    for (const address of addresses) {
      try {
        await emitEvent({
          event_type: 'address.deleted',
          aggregate_type: 'address',
          aggregate_id: address.id,
          event_data: {
            address_id: address.id,
            organization_id: params.orgId
          },
          tags
        });

        log.debug('Emitted address.deleted', { addressId: address.id });
      } catch (eventError) {
        log.error('Failed to emit event', { addressId: address.id, error: eventError instanceof Error ? eventError.message : String(eventError) });
        // Continue with other addresses
      }
    }

    log.info('Deletion completed', { orgId: params.orgId, count: addresses.length });
    return true;

  } catch (error) {
    log.error('Unexpected error', { orgId: params.orgId, error: error instanceof Error ? error.message : String(error) });
    return true; // Best-effort: don't fail workflow
  }
}
