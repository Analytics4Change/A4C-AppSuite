import { IOrganizationService } from './IOrganizationService';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('main');

/**
 * Mock Organization Service
 *
 * Provides a fixed mock organization for development before
 * multi-tenant provisioning system is fully implemented.
 *
 * Returns external_id: 'mock-dev-org' which maps to UUID
 * '00000000-0000-0000-0000-000000000001' in the database.
 *
 * @see ../A4C-Infrastructure/supabase/sql/99-seeds/001-mock-dev-organization.sql
 */
export class MockOrganizationService implements IOrganizationService {
  private readonly MOCK_ORG_EXTERNAL_ID = 'mock-dev-org';
  private readonly MOCK_ORG_NAME = 'Mock Development Organization';

  constructor() {
    log.info('MockOrganizationService initialized');
    log.warn('Using mock organization service - not for production use');
  }

  async getCurrentOrganizationId(): Promise<string> {
    return this.MOCK_ORG_EXTERNAL_ID;
  }

  async getCurrentOrganizationName(): Promise<string> {
    return this.MOCK_ORG_NAME;
  }

  async hasOrganizationContext(): Promise<boolean> {
    return true; // Mock always has context
  }
}
