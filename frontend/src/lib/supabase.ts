/**
 * Supabase Client Configuration
 *
 * Re-exports cookie-based client for cross-subdomain session support.
 * See supabase-ssr.ts for implementation details.
 *
 * Cookie-based sessions enable:
 * - Session sharing across subdomains (a4c.domain.com <-> org.domain.com)
 * - Centralized login at main domain with redirect to org subdomains
 * - Consistent auth state across the platform
 *
 * @example
 * ```typescript
 * import { supabase } from '@/lib/supabase';
 *
 * // Query data
 * const { data, error } = await supabase
 *   .from('domain_events')
 *   .select('*')
 *   .limit(10);
 * ```
 */
export { supabase, cookieDomain } from './supabase-ssr';
