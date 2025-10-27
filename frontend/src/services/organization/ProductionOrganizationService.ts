import { IOrganizationService } from './IOrganizationService';
import { getAuthProvider } from '@/services/auth/AuthProviderFactory';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('main');

/**
 * Production Organization Service
 *
 * Retrieves organization context from Supabase authentication provider.
 * Uses the authenticated user's organization ID from their JWT claims.
 */
export class ProductionOrganizationService implements IOrganizationService {
  constructor() {
    log.info('ProductionOrganizationService initialized (using Supabase Auth)');
  }

  async getCurrentOrganizationId(): Promise<string> {
    const authProvider = getAuthProvider();
    const session = await authProvider.getSession();

    if (!session) {
      throw new Error('No authenticated user - cannot determine organization context');
    }

    if (!session.claims.org_id) {
      throw new Error('User has no organization context');
    }

    return session.claims.org_id;
  }

  async getCurrentOrganizationName(): Promise<string> {
    const authProvider = getAuthProvider();
    const user = await authProvider.getUser();

    if (!user) {
      throw new Error('No authenticated user - cannot determine organization name');
    }

    // Organization name would need to be fetched from database
    // or included in JWT custom claims
    return 'Current Organization';
  }

  async hasOrganizationContext(): Promise<boolean> {
    try {
      const authProvider = getAuthProvider();
      const session = await authProvider.getSession();
      return !!(session?.claims.org_id);
    } catch {
      return false;
    }
  }
}
