/**
 * DeleteEmailsActivity (Compensation)
 *
 * Deletes all emails associated with an organization during workflow rollback.
 * Emits email.deleted events for each email (event-driven cascade deletion).
 *
 * Idempotency:
 * - Safe to retry (query + emit events pattern)
 * - Event emission idempotent via event_id
 *
 * Best-Effort:
 * - Always returns true (never fails workflow)
 * - Logs errors but continues
 */

import type { DeleteEmailsParams } from '@shared/types';
import { getSupabaseClient, getLogger, emitEmailDeleted } from '@shared/utils';

const log = getLogger('DeleteEmails');

/**
 * Delete emails compensation activity
 * @param params - Deletion parameters
 * @returns Always true (best-effort)
 */
export async function deleteEmails(params: DeleteEmailsParams): Promise<boolean> {
  log.info('Starting email deletion', { orgId: params.orgId });

  try {
    const supabase = getSupabaseClient();

    // 1. Soft-delete junction records FIRST (prevents orphaned junctions)
    const { data: junctionCount, error: junctionError } = await supabase
      .schema('api')
      .rpc('soft_delete_organization_emails', {
        p_org_id: params.orgId
      });

    if (junctionError) {
      log.warn('Junction soft-delete failed', { error: junctionError.message });
      // Continue anyway (best-effort)
    } else {
      log.debug('Soft-deleted junction records', { count: junctionCount });
    }

    // 2. Query all emails for organization via RPC (PostgREST only exposes 'api' schema)
    const { data: emails, error: queryError } = await supabase
      .schema('api')
      .rpc('get_emails_by_org', {
        p_org_id: params.orgId
      });

    if (queryError) {
      log.warn('Query failed', { error: queryError.message });
      return true; // Best-effort: don't fail workflow
    }

    if (!emails || emails.length === 0) {
      log.info('No emails found', { orgId: params.orgId });
      return true;
    }

    // 3. Emit email.deleted event for each email (audit trail)
    // Note: Compensation activities don't have tracing context
    for (const email of emails) {
      try {
        await emitEmailDeleted(email.id, {
          email_id: email.id,
          organization_id: params.orgId,
          reason: 'Organization bootstrap rollback',
        });

        log.debug('Emitted email.deleted', { emailId: email.id });
      } catch (eventError) {
        log.error('Failed to emit event', { emailId: email.id, error: eventError instanceof Error ? eventError.message : String(eventError) });
        // Continue with other emails
      }
    }

    log.info('Deletion completed', { orgId: params.orgId, count: emails.length });
    return true;

  } catch (error) {
    log.error('Unexpected error', { orgId: params.orgId, error: error instanceof Error ? error.message : String(error) });
    return true; // Best-effort: don't fail workflow
  }
}
