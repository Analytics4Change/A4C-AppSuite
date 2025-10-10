import { IOrganizationService } from './IOrganizationService';
import { zitadelService } from '@/services/auth/zitadel.service';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('main');

/**
 * Production Organization Service
 *
 * Retrieves organization context from Zitadel authentication provider.
 * Uses the authenticated user's organization ID from their Zitadel claims.
 *
 * This is a stub implementation that will be fully fleshed out when
 * subdomain-based multi-tenant provisioning is complete.
 *
 * TODO: Implement full organization provisioning:
 * - Subdomain → Zitadel organization mapping
 * - Organization creation workflow
 * - Organization admin management
 */
export class ProductionOrganizationService implements IOrganizationService {
  constructor() {
    log.info('ProductionOrganizationService initialized');
  }

  async getCurrentOrganizationId(): Promise<string> {
    const user = await zitadelService.getUser();

    if (!user) {
      throw new Error('No authenticated user - cannot determine organization context');
    }

    if (!user.organizationId) {
      throw new Error('User has no organization context');
    }

    // Return Zitadel organization ID (external_id format)
    // This will be resolved to internal UUID by database helper function
    return user.organizationId;
  }

  async getCurrentOrganizationName(): Promise<string> {
    const user = await zitadelService.getUser();

    if (!user) {
      throw new Error('No authenticated user - cannot determine organization name');
    }

    // TODO: Fetch organization details from database
    // For now, try to find organization name in user's organizations array
    const currentOrg = user.organizations?.find(
      (org) => org.id === user.organizationId
    );

    return currentOrg?.name || 'Unknown Organization';
  }

  async hasOrganizationContext(): Promise<boolean> {
    const user = await zitadelService.getUser();
    return !!(user?.organizationId);
  }
}
