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
import { getSupabaseClient } from '@shared/utils/supabase';
import { emitEvent, buildTags } from '@shared/utils/emit-event';

/**
 * Delete addresses compensation activity
 * @param params - Deletion parameters
 * @returns Always true (best-effort)
 */
export async function deleteAddresses(params: DeleteAddressesParams): Promise<boolean> {
  console.log(`[DeleteAddresses] Starting for organization: ${params.orgId}`);

  try {
    const supabase = getSupabaseClient();
    const tags = buildTags();

    // Query all addresses for organization (including soft-deleted)
    const { data: addresses, error: queryError } = await supabase
      .from('addresses_projection')
      .select('id')
      .eq('organization_id', params.orgId);

    if (queryError) {
      console.error(`[DeleteAddresses] Query failed: ${queryError.message}`);
      return true; // Best-effort: don't fail workflow
    }

    if (!addresses || addresses.length === 0) {
      console.log(`[DeleteAddresses] No addresses found for organization ${params.orgId}`);
      return true;
    }

    // Emit address.deleted event for each address
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

        console.log(`[DeleteAddresses] Emitted address.deleted for ${address.id}`);
      } catch (eventError) {
        console.error(`[DeleteAddresses] Failed to emit event for ${address.id}:`, eventError);
        // Continue with other addresses
      }
    }

    console.log(`[DeleteAddresses] Completed for ${params.orgId} (${addresses.length} addresses)`);
    return true;

  } catch (error) {
    console.error(`[DeleteAddresses] Unexpected error for ${params.orgId}:`, error);
    return true; // Best-effort: don't fail workflow
  }
}
