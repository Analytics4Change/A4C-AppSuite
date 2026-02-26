/**
 * OrganizationDeletionWorkflow
 *
 * Orchestrates the cleanup process after an organization is soft-deleted.
 * Called by the backend API after the delete_organization RPC succeeds
 * (which requires the org to already be deactivated).
 *
 * Flow (5 activities):
 * 1. emitDeletionInitiated → organization.deletion.initiated (audit)
 * 2. revokeInvitations → revoke all pending invitations (×N)
 * 3. removeDNS → remove Cloudflare CNAME record (if subdomain exists)
 * 4. deactivateOrgUsers → ban all org users via Supabase Admin API (×N)
 * 5. emitDeletionCompleted → organization.deletion.completed (audit)
 *
 * Key design decisions:
 * - Child entity data (phones, addresses, contacts, emails) NOT deleted:
 *   org soft-delete already blocks access via RLS/JWT; cross-tenant grant
 *   holders still need child data; legal/compliance retention.
 * - Cross-tenant access grants preserved (all types: VAR, court, etc.)
 * - No saga compensation: deletion is best-effort cleanup, not transactional.
 *   Individual activity failures are logged but don't roll back other steps.
 *
 * Idempotency:
 * - Workflow ID: org-deletion-{organizationId} (unique per org)
 * - Activities are individually idempotent (check-then-act)
 */

import { proxyActivities, log } from '@temporalio/workflow';
import type * as activities from '@activities/organization-deletion';
import type {
  OrganizationDeletionParams,
  OrganizationDeletionResult,
} from '@shared/types';

// Configure activity options
const {
  emitDeletionInitiatedActivity,
  revokeInvitations,
  removeDNS,
  deactivateOrgUsers,
  emitDeletionCompletedActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
  },
});

/**
 * Organization Deletion Workflow
 *
 * @param params - Deletion parameters (orgId, reason, subdomain, initiatedBy, tracing)
 * @returns OrganizationDeletionResult with cleanup summary
 */
export async function organizationDeletionWorkflow(
  params: OrganizationDeletionParams
): Promise<OrganizationDeletionResult> {
  const workflowId = `org-deletion-${params.organizationId}`;

  log.info('Starting OrganizationDeletionWorkflow', {
    organizationId: params.organizationId,
    subdomain: params.subdomain,
    reason: params.reason,
    hasTracing: !!params.tracing,
  });

  const errors: string[] = [];
  let dnsRemoved = false;
  let usersDeactivated = 0;
  let invitationsRevoked = 0;

  // ========================================
  // Step 1: Emit Deletion Initiated Event
  // ========================================
  log.info('Step 1: Emitting deletion initiated event');

  try {
    await emitDeletionInitiatedActivity({
      orgId: params.organizationId,
      workflowId,
      reason: params.reason,
      initiatedBy: params.initiatedBy,
      tracing: params.tracing,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to emit deletion initiated event', { error: errorMsg });
    errors.push(`Failed to emit deletion initiated: ${errorMsg}`);
    // Continue — this is an audit event, not critical for cleanup
  }

  // ========================================
  // Step 2: Revoke Pending Invitations
  // ========================================
  log.info('Step 2: Revoking pending invitations');

  try {
    invitationsRevoked = await revokeInvitations({
      orgId: params.organizationId,
    });
    log.info('Invitations revoked', { count: invitationsRevoked });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to revoke invitations', { error: errorMsg });
    errors.push(`Failed to revoke invitations: ${errorMsg}`);
  }

  // ========================================
  // Step 3: Remove DNS (if subdomain exists)
  // ========================================
  if (params.subdomain) {
    log.info('Step 3: Removing DNS', { subdomain: params.subdomain });

    try {
      dnsRemoved = await removeDNS({
        orgId: params.organizationId,
        subdomain: params.subdomain,
      });
      log.info('DNS removal result', { dnsRemoved });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      log.error('Failed to remove DNS', { error: errorMsg });
      errors.push(`Failed to remove DNS: ${errorMsg}`);
    }
  } else {
    log.info('Step 3: Skipping DNS removal (no subdomain)');
    dnsRemoved = true; // Nothing to remove
  }

  // ========================================
  // Step 4: Deactivate Org Users
  // ========================================
  log.info('Step 4: Deactivating organization users');

  try {
    const deactivateResult = await deactivateOrgUsers({
      orgId: params.organizationId,
      tracing: params.tracing,
    });
    usersDeactivated = deactivateResult.deactivatedCount;

    if (deactivateResult.errors.length > 0) {
      errors.push(...deactivateResult.errors);
    }

    log.info('User deactivation complete', {
      deactivated: usersDeactivated,
      errors: deactivateResult.errors.length,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to deactivate users', { error: errorMsg });
    errors.push(`Failed to deactivate users: ${errorMsg}`);
  }

  // ========================================
  // Step 5: Emit Deletion Completed Event
  // ========================================
  log.info('Step 5: Emitting deletion completed event');

  try {
    await emitDeletionCompletedActivity({
      orgId: params.organizationId,
      workflowId,
      dnsRemoved,
      usersDeactivated,
      invitationsRevoked,
      tracing: params.tracing,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to emit deletion completed event', { error: errorMsg });
    errors.push(`Failed to emit deletion completed: ${errorMsg}`);
  }

  // ========================================
  // Done
  // ========================================
  log.info('OrganizationDeletionWorkflow completed', {
    orgId: params.organizationId,
    dnsRemoved,
    usersDeactivated,
    invitationsRevoked,
    errorCount: errors.length,
  });

  return {
    orgId: params.organizationId,
    dnsRemoved,
    usersDeactivated,
    invitationsRevoked,
    errors: errors.length > 0 ? errors : undefined,
  };
}
