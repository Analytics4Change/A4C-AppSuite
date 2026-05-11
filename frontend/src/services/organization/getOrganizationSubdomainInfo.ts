/**
 * Get organization subdomain information for redirect decisions
 *
 * Uses the api.get_organization_by_id RPC function to get subdomain information
 * needed for post-login redirect logic. The RPC function has SECURITY DEFINER
 * which bypasses RLS, avoiding session timing issues with @supabase/ssr.
 */
import { supabaseService } from '@/services/auth/supabase.service';
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
 * Response type from api.get_organization_by_id RPC function
 * Only includes the fields we care about for subdomain redirect
 */
interface OrganizationRpcResponse {
  slug: string;
  subdomain_status: string;
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
 *
 * Refactored 2026-05-11 (PR-C, Q5 Option A): the pre-migration call chained
 * `.single<OrganizationRpcResponse>()` after `.rpc(...)`. The new SDK helpers
 * `apiRpc<T>` / `apiRpcEnvelope<T>` do not expose `.single()`. Replaced with
 * `apiRpc<OrganizationRpcResponse[]>(...)` + `data?.[0] ?? null` because the
 * RPC looks up by UUID primary key (multi-row case is impossible at the DB
 * level). Behavioral equivalence: 0-row case folds to `null` (same as
 * pre-migration); 2+-row case would have errored with PGRST116 but cannot
 * occur for a PK lookup. See plan v2 §"Read-shape with `.single<T>()`".
 */
export async function getOrganizationSubdomainInfo(
  orgId: string
): Promise<OrganizationSubdomainInfo | null> {
  try {
    const { data, error } = await supabaseService.apiRpc<OrganizationRpcResponse[]>(
      'get_organization_by_id',
      { p_org_id: orgId }
    );

    if (error) {
      log.error('RPC error', { orgId, error });
      return null;
    }

    const row = data?.[0] ?? null;
    if (!row) {
      log.warn('No data for org', { orgId });
      return null;
    }

    return {
      slug: row.slug,
      subdomain_status: row.subdomain_status as OrganizationSubdomainInfo['subdomain_status'],
    };
  } catch (err) {
    log.error('Unexpected error', { orgId, error: err });
    return null;
  }
}
