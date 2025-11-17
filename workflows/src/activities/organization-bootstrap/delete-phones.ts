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
import { getSupabaseClient } from '@shared/utils/supabase';
import { emitEvent, buildTags } from '@shared/utils/emit-event';

/**
 * Delete phones compensation activity
 * @param params - Deletion parameters
 * @returns Always true (best-effort)
 */
export async function deletePhones(params: DeletePhonesParams): Promise<boolean> {
  console.log(`[DeletePhones] Starting for organization: ${params.orgId}`);

  try {
    const supabase = getSupabaseClient();
    const tags = buildTags();

    // Query all phones for organization (including soft-deleted)
    const { data: phones, error: queryError } = await supabase
      .from('phones_projection')
      .select('id')
      .eq('organization_id', params.orgId);

    if (queryError) {
      console.error(`[DeletePhones] Query failed: ${queryError.message}`);
      return true; // Best-effort: don't fail workflow
    }

    if (!phones || phones.length === 0) {
      console.log(`[DeletePhones] No phones found for organization ${params.orgId}`);
      return true;
    }

    // Emit phone.deleted event for each phone
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

        console.log(`[DeletePhones] Emitted phone.deleted for ${phone.id}`);
      } catch (eventError) {
        console.error(`[DeletePhones] Failed to emit event for ${phone.id}:`, eventError);
        // Continue with other phones
      }
    }

    console.log(`[DeletePhones] Completed for ${params.orgId} (${phones.length} phones)`);
    return true;

  } catch (error) {
    console.error(`[DeletePhones] Unexpected error for ${params.orgId}:`, error);
    return true; // Best-effort: don't fail workflow
  }
}
