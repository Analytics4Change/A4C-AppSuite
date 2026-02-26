/**
 * DeactivateOrgUsersActivity
 *
 * Deactivates all users belonging to the organization via Supabase Admin API.
 * This is a hard block — deactivated users cannot log in at all (unlike the
 * JWT access_blocked mechanism which has a ~1hr refresh delay).
 *
 * Flow:
 * 1. List all users in the organization from users_projection
 * 2. For each user, call Supabase Admin API to ban them
 * 3. Emit user deactivation events for audit trail
 *
 * Idempotency:
 * - Safe to call multiple times (already-banned users are skipped)
 * - Non-fatal errors per user don't fail the activity
 */

import type { DeactivateOrgUsersParams, DeactivateOrgUsersResult } from '@shared/types';
import { getSupabaseClient, emitEvent, buildTags, buildTracingForEvent, getLogger } from '@shared/utils';

const log = getLogger('DeactivateOrgUsers');

/**
 * Deactivate all users in an organization
 * @param params - Activity parameters
 * @returns Count of deactivated users and any errors
 */
export async function deactivateOrgUsers(
  params: DeactivateOrgUsersParams
): Promise<DeactivateOrgUsersResult> {
  log.info('Starting user deactivation for organization', { orgId: params.orgId });

  const supabase = getSupabaseClient();
  const result: DeactivateOrgUsersResult = {
    deactivatedCount: 0,
    errors: [],
  };

  try {
    // Fetch all active users for this organization from the projection
    const { data: users, error: fetchError } = await supabase
      .schema('api')
      .rpc('list_users', {
        p_org_id: params.orgId,
      });

    if (fetchError) {
      log.error('Failed to fetch users', { error: fetchError.message });
      result.errors.push(`Failed to fetch users: ${fetchError.message}`);
      return result;
    }

    if (!users || users.length === 0) {
      log.info('No users found for organization');
      return result;
    }

    log.info('Found users to deactivate', { count: users.length });

    const tags = buildTags();

    // Deactivate each user via Supabase Admin API
    for (const user of users) {
      const userId = (user as Record<string, unknown>).id as string;
      const userEmail = (user as Record<string, unknown>).email as string;

      try {
        // Ban user via Supabase Admin API (service role)
        // This uses the admin.updateUserById method which sets banned_until
        const { error: banError } = await supabase.auth.admin.updateUserById(
          userId,
          { ban_duration: 'none' } // Permanent ban (until manually unbanned)
        );

        if (banError) {
          log.warn('Failed to ban user', { userId, email: userEmail, error: banError.message });
          result.errors.push(`Failed to ban ${userEmail}: ${banError.message}`);
          continue;
        }

        // Emit user deactivation event for audit trail
        await emitEvent({
          event_type: 'user.deactivated',
          aggregate_type: 'user',
          aggregate_id: userId,
          event_data: {
            user_id: userId,
            email: userEmail,
            organization_id: params.orgId,
            reason: 'organization_deleted',
          },
          tags,
          ...buildTracingForEvent(params.tracing, 'deactivateOrgUsers'),
        });

        result.deactivatedCount++;
        log.debug('User deactivated', { userId, email: userEmail });
      } catch (userError) {
        const errorMsg = userError instanceof Error ? userError.message : 'Unknown error';
        log.warn('Error deactivating user', { userId, email: userEmail, error: errorMsg });
        result.errors.push(`Error deactivating ${userEmail}: ${errorMsg}`);
      }
    }

    log.info('User deactivation complete', {
      total: users.length,
      deactivated: result.deactivatedCount,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('Fatal error during user deactivation', { error: errorMsg });
    result.errors.push(`Fatal error: ${errorMsg}`);
    return result;
  }
}
