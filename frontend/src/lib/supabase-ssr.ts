/**
 * Supabase Client with Cookie-Based Session Storage
 *
 * Uses @supabase/ssr for cross-subdomain session sharing.
 * Cookies are scoped to .{PLATFORM_BASE_DOMAIN} to allow session
 * sharing between a4c.{domain} and org subdomains.
 *
 * This enables:
 * 1. Login at a4c.{domain}/login
 * 2. Redirect to {org.slug}.{domain}/dashboard
 * 3. Session persists across all subdomains
 */
import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const isMockMode = import.meta.env.VITE_APP_MODE === 'mock';
const platformBaseDomain = import.meta.env.VITE_PLATFORM_BASE_DOMAIN;

/**
 * Get cookie domain for cross-subdomain session sharing.
 * Uses VITE_PLATFORM_BASE_DOMAIN as the single source of truth.
 *
 * @returns Cookie domain prefixed with '.' for subdomain scope, or undefined for localhost
 */
function getCookieDomain(): string | undefined {
  // In mock mode or localhost, don't set cookie domain (browser default)
  if (isMockMode) return undefined;

  // Use configured platform base domain (prefixed with '.' for subdomain cookie scope)
  if (platformBaseDomain) {
    return `.${platformBaseDomain}`;
  }

  // Fallback: Auto-detect from hostname (extract parent domain)
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;

    // Don't set cookie domain for localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return undefined;
    }

    // For subdomains like "poc-test1.example.com", extract ".example.com"
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      return `.${parts.slice(-2).join('.')}`;
    }
  }

  return undefined;
}

// Validate environment variables (same logic as original supabase.ts)
if (!supabaseUrl || !supabaseAnonKey) {
  if (!isMockMode) {
    throw new Error(
      'Missing Supabase environment variables. ' +
        'Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in .env.local'
    );
  }
}

// In mock mode without credentials, use placeholder URL to satisfy the client constructor
const effectiveUrl = supabaseUrl || 'https://placeholder.supabase.co';
const effectiveKey = supabaseAnonKey || 'placeholder-key-for-mock-mode';

/**
 * Supabase client with cookie-based session storage
 *
 * Uses @supabase/ssr createBrowserClient for automatic cookie management.
 * Session cookies are scoped to the parent domain for cross-subdomain sharing.
 *
 * @example
 * ```typescript
 * import { supabase } from '@/lib/supabase';
 *
 * // Query data (same API as regular client)
 * const { data, error } = await supabase
 *   .from('organizations_projection')
 *   .select('slug, subdomain_status')
 *   .eq('id', orgId)
 *   .single();
 * ```
 */
export const supabase = createBrowserClient(effectiveUrl, effectiveKey, {
  cookieOptions: {
    domain: getCookieDomain(),
    path: '/',
    sameSite: 'lax',
    // secure is automatically true in production (HTTPS)
  },
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: true, // Critical for OAuth callback handling
    flowType: 'pkce', // Use PKCE flow for enhanced security
  },
});

/**
 * Export cookie domain for debugging/testing
 */
export const cookieDomain = getCookieDomain();
