/**
 * Get organization subdomain information for redirect decisions
 *
 * Uses the api.get_organization_by_id RPC function to get subdomain information
 * needed for post-login redirect logic. The RPC function has SECURITY DEFINER
 * which bypasses RLS, avoiding session timing issues with @supabase/ssr.
 */
import { supabase } from '@/lib/supabase';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('organization');

/**
 * Organization subdomain information from projection
 */
export interface OrganizationSubdomainInfo {
  /** Organization's subdomain slug (e.g., "poc-test1") */
  slug: string;
  /** Subdomain provisioning status */
  subdomain_status: 'pending' | 'provisioning' | 'verified' | 'failed';
}

/**
 * Fetches subdomain information for an organization
 *
 * @param orgId - Organization UUID
 * @returns Subdomain info or null if not found/error
 *
 * @example
 * ```typescript
 * const info = await getOrganizationSubdomainInfo(session.claims.org_id);
 * if (info?.subdomain_status === 'verified') {
 *   window.location.href = `https://${info.slug}.${baseDomain}/dashboard`;
 * }
 * ```
 */
/**
 * Response type from api.get_organization_by_id RPC function
 * Only includes the fields we care about for subdomain redirect
 */
interface OrganizationRpcResponse {
  slug: string;
  subdomain_status: string;
}

export async function getOrganizationSubdomainInfo(
  orgId: string
): Promise<OrganizationSubdomainInfo | null> {
  try {
    // Use RPC function with SECURITY DEFINER to bypass RLS
    // This avoids session timing issues where @supabase/ssr may not
    // have the JWT properly set in the Authorization header yet
    const { data, error } = await supabase
      .schema('api')
      .rpc('get_organization_by_id', { p_org_id: orgId })
      .single<OrganizationRpcResponse>();

    if (error) {
      log.error('RPC error', { orgId, error });
      return null;
    }

    if (!data) {
      log.warn('No data for org', { orgId });
      return null;
    }

    // Extract just the fields we need from the full org response
    return {
      slug: data.slug,
      subdomain_status: data.subdomain_status as OrganizationSubdomainInfo['subdomain_status'],
    };
  } catch (err) {
    log.error('Unexpected error', { orgId, error: err });
    return null;
  }
}
