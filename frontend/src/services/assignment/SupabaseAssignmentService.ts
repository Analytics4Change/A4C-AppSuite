/**
 * Supabase Assignment Service
 *
 * Production implementation using api.* schema RPC functions.
 * Follows CQRS pattern: writes emit events, reads query projections.
 *
 * @see api.assign_client_to_user()
 * @see api.unassign_client_from_user()
 * @see api.list_user_client_assignments()
 */

import { supabaseService } from '@/services/auth/supabase.service';
import { Logger } from '@/utils/logger';
import type { UserClientAssignment } from '@/types/client-assignment.types';
import type { IAssignmentService } from './IAssignmentService';

const log = Logger.getLogger('api');

export class SupabaseAssignmentService implements IAssignmentService {
  async listAssignments(params: {
    orgId?: string;
    userId?: string;
    clientId?: string;
    activeOnly?: boolean;
  }): Promise<UserClientAssignment[]> {
    log.debug('Listing assignments', params);

    // Registry-classified envelope (Pattern A v2 read envelope variant):
    // returns `{success: true, data: UserClientAssignment[]}` on success.
    const env = await supabaseService.apiRpcEnvelope<{ data?: UserClientAssignment[] }>(
      'list_user_client_assignments',
      {
        p_org_id: params.orgId ?? null,
        p_user_id: params.userId ?? null,
        p_client_id: params.clientId ?? null,
        p_active_only: params.activeOnly ?? true,
      }
    );

    if (!env.success) {
      log.error('Failed to list assignments', { error: env.error });
      throw new Error(env.error ?? 'Failed to list assignments');
    }

    return env.data ?? [];
  }

  async assignClient(params: {
    userId: string;
    clientId: string;
    assignedUntil?: string;
    notes?: string;
    reason?: string;
  }): Promise<{ assignmentId: string }> {
    log.debug('Assigning client', { userId: params.userId, clientId: params.clientId });

    const env = await supabaseService.apiRpcEnvelope<{ assignment_id?: string }>(
      'assign_client_to_user',
      {
        p_user_id: params.userId,
        p_client_id: params.clientId,
        p_assigned_until: params.assignedUntil ?? null,
        p_notes: params.notes ?? null,
        p_reason: params.reason ?? null,
      }
    );

    if (!env.success) {
      log.error('Failed to assign client', { error: env.error });
      throw new Error(env.error ?? 'Failed to assign client');
    }

    log.info('Client assigned', { assignmentId: env.assignment_id });
    return { assignmentId: env.assignment_id as string };
  }

  async unassignClient(params: {
    userId: string;
    clientId: string;
    reason?: string;
  }): Promise<void> {
    log.debug('Unassigning client', { userId: params.userId, clientId: params.clientId });

    const env = await supabaseService.apiRpcEnvelope('unassign_client_from_user', {
      p_user_id: params.userId,
      p_client_id: params.clientId,
      p_reason: params.reason ?? null,
    });

    if (!env.success) {
      log.error('Failed to unassign client', { error: env.error });
      throw new Error(env.error ?? 'Failed to unassign client');
    }

    log.info('Client unassigned', { userId: params.userId, clientId: params.clientId });
  }
}
