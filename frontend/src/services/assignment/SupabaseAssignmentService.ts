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

import { supabase } from '@/lib/supabase';
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

    const { data, error } = await supabase
      .schema('api')
      .rpc('list_user_client_assignments', {
        p_org_id: params.orgId ?? null,
        p_user_id: params.userId ?? null,
        p_client_id: params.clientId ?? null,
        p_active_only: params.activeOnly ?? true,
      });

    if (error) {
      log.error('Failed to list assignments', { error });
      throw new Error(`Failed to list assignments: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;

    if (!result?.success) {
      throw new Error(result?.error ?? 'Failed to list assignments');
    }

    return result.data ?? [];
  }

  async assignClient(params: {
    userId: string;
    clientId: string;
    assignedUntil?: string;
    notes?: string;
    reason?: string;
  }): Promise<{ assignmentId: string }> {
    log.debug('Assigning client', { userId: params.userId, clientId: params.clientId });

    const { data, error } = await supabase
      .schema('api')
      .rpc('assign_client_to_user', {
        p_user_id: params.userId,
        p_client_id: params.clientId,
        p_assigned_until: params.assignedUntil ?? null,
        p_notes: params.notes ?? null,
        p_reason: params.reason ?? null,
      });

    if (error) {
      log.error('Failed to assign client', { error });
      throw new Error(`Failed to assign client: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;

    if (!result?.success) {
      throw new Error(result?.error ?? 'Failed to assign client');
    }

    log.info('Client assigned', { assignmentId: result.assignment_id });
    return { assignmentId: result.assignment_id };
  }

  async unassignClient(params: {
    userId: string;
    clientId: string;
    reason?: string;
  }): Promise<void> {
    log.debug('Unassigning client', { userId: params.userId, clientId: params.clientId });

    const { data, error } = await supabase
      .schema('api')
      .rpc('unassign_client_from_user', {
        p_user_id: params.userId,
        p_client_id: params.clientId,
        p_reason: params.reason ?? null,
      });

    if (error) {
      log.error('Failed to unassign client', { error });
      throw new Error(`Failed to unassign client: ${error.message}`);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;

    if (!result?.success) {
      throw new Error(result?.error ?? 'Failed to unassign client');
    }

    log.info('Client unassigned', { userId: params.userId, clientId: params.clientId });
  }
}
