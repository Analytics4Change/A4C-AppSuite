/**
 * Orphaned Deletion Monitoring Service
 *
 * Service for monitoring organizations that were soft-deleted but whose
 * cleanup workflow never completed. Platform-owner only.
 *
 * RPC functions:
 * - api.get_orphaned_deletions() - Query orphaned soft-deleted orgs
 * - api.retry_deletion_workflow() - Re-emit deletion event to trigger workflow
 *
 * @see infrastructure/supabase/supabase/migrations/20260310004215_orphaned_deletion_monitoring.sql
 */

import { supabaseService } from '@/services/auth/supabase.service';
import { WorkflowClientFactory } from '@/services/workflow/WorkflowClientFactory';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

export interface OrphanedDeletion {
  id: string;
  name: string;
  slug: string;
  deleted_at: string;
  deletion_reason: string | null;
  hours_since_deletion: number;
  has_initiated_event: boolean;
  has_completed_event: boolean;
}

export interface OrphanedDeletionResult {
  success: boolean;
  data?: OrphanedDeletion[];
  error?: string;
}

export interface RetryResult {
  success: boolean;
  message?: string;
  error?: string;
}

export class OrphanedDeletionService {
  async getOrphanedDeletions(hoursThreshold: number = 24): Promise<OrphanedDeletionResult> {
    try {
      log.info('Fetching orphaned deletions', { hoursThreshold });

      const { data, error } = await supabaseService.apiRpc<OrphanedDeletion[]>(
        'get_orphaned_deletions',
        { p_hours_threshold: hoursThreshold }
      );

      if (error) {
        log.error('Failed to fetch orphaned deletions', error);

        if (
          error.code === '42501' ||
          error.message?.includes('permission denied') ||
          error.message?.includes('Platform privilege')
        ) {
          return {
            success: false,
            error: 'Access denied. Platform administrator access required.',
          };
        }

        return { success: false, error: `Failed to fetch orphaned deletions: ${error.message}` };
      }

      log.info(`Fetched ${data?.length ?? 0} orphaned deletions`);
      return { success: true, data: data ?? [] };
    } catch (error) {
      log.error('Unexpected error fetching orphaned deletions', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async retryDeletionWorkflow(orgId: string): Promise<RetryResult> {
    try {
      log.info('Retrying deletion workflow', { orgId });

      const workflowClient = WorkflowClientFactory.create();
      await workflowClient.startDeletionWorkflow(orgId, 'Manual retry via deletion monitor');

      log.info('Deletion workflow retry triggered', { orgId });
      return { success: true, message: 'Deletion workflow triggered' };
    } catch (error) {
      log.error('Failed to retry deletion workflow', { orgId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const orphanedDeletionService = new OrphanedDeletionService();
