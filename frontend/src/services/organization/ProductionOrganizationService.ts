import { IOrganizationService } from './IOrganizationService';
import { supabaseService } from '@/services/auth/supabase.service';
import { Logger } from '@/utils/logger';
import { decodeJWT } from '@/utils/jwt';

const log = Logger.getLogger('main');

/**
 * Production Organization Service
 *
 * Retrieves organization context from Supabase authentication provider.
 * Uses the authenticated user's organization ID from their JWT claims.
 *
 * Uses Pattern A: Direct Supabase client session retrieval (RLS-only).
 */
export class ProductionOrganizationService implements IOrganizationService {
  constructor() {
    log.info('ProductionOrganizationService initialized (using Supabase Auth)');
  }

  async getCurrentOrganizationId(): Promise<string> {
    const client = supabaseService.getClient();

    // Get session from Supabase client (already authenticated)
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session) {
      log.error('No authenticated session for getCurrentOrganizationId');
      throw new Error('No authenticated user - cannot determine organization context');
    }

    // Decode JWT to get org_id
    const claims = decodeJWT(session.access_token);
    if (!claims.org_id) {
      log.error('No organization context in JWT claims');
      throw new Error('User has no organization context');
    }

    return claims.org_id;
  }

  async getCurrentOrganizationName(): Promise<string> {
    const client = supabaseService.getClient();

    // Get session from Supabase client (already authenticated)
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session) {
      log.error('No authenticated session for getCurrentOrganizationName');
      throw new Error('No authenticated user - cannot determine organization name');
    }

    // Organization name would need to be fetched from database
    // or included in JWT custom claims
    return 'Current Organization';
  }

  async hasOrganizationContext(): Promise<boolean> {
    try {
      const client = supabaseService.getClient();

      // Get session from Supabase client (already authenticated)
      const {
        data: { session },
      } = await client.auth.getSession();
      if (!session) {
        return false;
      }

      // Decode JWT to get org_id
      const claims = decodeJWT(session.access_token);
      return !!claims.org_id;
    } catch {
      return false;
    }
  }
}
