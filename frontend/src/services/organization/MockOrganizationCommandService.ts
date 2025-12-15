/**
 * Mock Organization Command Service
 *
 * Development/testing implementation of IOrganizationCommandService.
 * Logs operations without making network calls.
 */

import { Logger } from '@/utils/logger';
import type { OrganizationUpdateData } from '@/types/organization.types';
import type { IOrganizationCommandService } from './IOrganizationCommandService';

const log = Logger.getLogger('api');

export class MockOrganizationCommandService implements IOrganizationCommandService {
  /**
   * Simulates network delay for realistic testing
   */
  private async simulateDelay(): Promise<void> {
    // Skip delay in test environment
    if (import.meta.env.MODE === 'test') {
      return;
    }
    // 100-300ms delay to simulate network latency
    const delay = Math.random() * 200 + 100;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async updateOrganization(
    orgId: string,
    data: OrganizationUpdateData,
    reason: string
  ): Promise<void> {
    await this.simulateDelay();

    const updatedFields = Object.keys(data).filter(
      key => data[key as keyof OrganizationUpdateData] !== undefined
    );

    log.info('Mock: Organization updated', {
      orgId,
      updatedFields,
      data,
      reason,
      eventType: 'organization.updated',
    });

    // In mock mode, just log the operation
    // Real implementation would emit domain event
  }
}
