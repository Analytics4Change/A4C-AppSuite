/**
 * Mock Assignment Service
 *
 * In-memory implementation for local development and testing.
 */

import { Logger } from '@/utils/logger';
import type { UserClientAssignment } from '@/types/client-assignment.types';
import type { IAssignmentService } from './IAssignmentService';

const log = Logger.getLogger('api');

export class MockAssignmentService implements IAssignmentService {
  private assignments: UserClientAssignment[] = [];

  async listAssignments(params: {
    orgId?: string;
    userId?: string;
    clientId?: string;
    activeOnly?: boolean;
  }): Promise<UserClientAssignment[]> {
    log.debug('[Mock] Listing assignments', params);
    await this.simulateDelay();

    return this.assignments.filter((a) => {
      if (params.userId && a.user_id !== params.userId) return false;
      if (params.clientId && a.client_id !== params.clientId) return false;
      if (params.activeOnly !== false && !a.is_active) return false;
      return true;
    });
  }

  async assignClient(params: {
    userId: string;
    clientId: string;
    assignedUntil?: string;
    notes?: string;
    reason?: string;
  }): Promise<{ assignmentId: string }> {
    log.debug('[Mock] Assigning client', { userId: params.userId, clientId: params.clientId });
    await this.simulateDelay();

    const id = globalThis.crypto.randomUUID();
    this.assignments.push({
      id,
      user_id: params.userId,
      user_name: 'Mock User',
      user_email: 'mock@example.com',
      client_id: params.clientId,
      organization_id: 'mock-org',
      assigned_at: new Date().toISOString(),
      assigned_until: params.assignedUntil ?? null,
      notes: params.notes ?? null,
      is_active: true,
    });

    return { assignmentId: id };
  }

  async unassignClient(params: {
    userId: string;
    clientId: string;
    reason?: string;
  }): Promise<void> {
    log.debug('[Mock] Unassigning client', { userId: params.userId, clientId: params.clientId });
    await this.simulateDelay();

    const assignment = this.assignments.find(
      (a) => a.user_id === params.userId && a.client_id === params.clientId && a.is_active
    );
    if (!assignment) throw new Error('Assignment not found');
    assignment.is_active = false;
  }

  private simulateDelay(): Promise<void> {
    const delay = import.meta.env.MODE === 'test' ? 0 : 300;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
