/**
 * Mock Organization Command Service
 *
 * Development/testing implementation of IOrganizationCommandService.
 * Logs operations without making network calls.
 */

import { Logger } from '@/utils/logger';
import type {
  OrganizationUpdateData,
  OrganizationOperationResult,
} from '@/types/organization.types';
import type { IOrganizationCommandService } from './IOrganizationCommandService';

const log = Logger.getLogger('api');

export class MockOrganizationCommandService implements IOrganizationCommandService {
  private async simulateDelay(): Promise<void> {
    if (import.meta.env.MODE === 'test') return;
    const delay = Math.random() * 200 + 100;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  async updateOrganization(
    orgId: string,
    data: OrganizationUpdateData,
    reason?: string
  ): Promise<OrganizationOperationResult> {
    await this.simulateDelay();
    log.info('Mock: Organization updated', { orgId, data, reason });
    return { success: true, organization: { id: orgId, ...data } };
  }

  async deactivateOrganization(
    orgId: string,
    reason?: string
  ): Promise<OrganizationOperationResult> {
    await this.simulateDelay();
    log.info('Mock: Organization deactivated', { orgId, reason });
    return {
      success: true,
      organization: {
        id: orgId,
        is_active: false,
        deactivated_at: new Date().toISOString(),
        deactivation_reason: reason ?? 'administrative',
      },
    };
  }

  async reactivateOrganization(orgId: string): Promise<OrganizationOperationResult> {
    await this.simulateDelay();
    log.info('Mock: Organization reactivated', { orgId });
    return {
      success: true,
      organization: { id: orgId, is_active: true, deactivated_at: null, deactivation_reason: null },
    };
  }

  async deleteOrganization(orgId: string, reason?: string): Promise<OrganizationOperationResult> {
    await this.simulateDelay();
    log.info('Mock: Organization deleted', { orgId, reason });
    log.debug('Deletion workflow skipped in mock mode');
    return {
      success: true,
      organization: {
        id: orgId,
        deleted_at: new Date().toISOString(),
        deletion_reason: reason ?? 'soft_delete',
      },
    };
  }
}
