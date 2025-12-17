/**
 * Get organization subdomain information for redirect decisions
 *
 * Queries the organizations_projection table to get subdomain information
 * needed for post-login redirect logic.
 */
import { supabase } from '@/lib/supabase';

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
export async function getOrganizationSubdomainInfo(
  orgId: string
): Promise<OrganizationSubdomainInfo | null> {
  try {
    const { data, error } = await supabase
      .from('organizations_projection')
      .select('slug, subdomain_status')
      .eq('id', orgId)
      .single();

    if (error) {
      console.error('[getOrganizationSubdomainInfo] Query error:', error);
      return null;
    }

    if (!data) {
      console.warn('[getOrganizationSubdomainInfo] No data for org:', orgId);
      return null;
    }

    return {
      slug: data.slug,
      subdomain_status: data.subdomain_status,
    };
  } catch (err) {
    console.error('[getOrganizationSubdomainInfo] Unexpected error:', err);
    return null;
  }
}
