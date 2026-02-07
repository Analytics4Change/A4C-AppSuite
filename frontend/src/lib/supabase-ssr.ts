/**
 * Supabase Client with Cookie-Based Session Storage
 *
 * Uses @supabase/ssr for cross-subdomain session sharing.
 * Cookie domain is automatically derived from the current hostname in production,
 * or left unset on localhost (scopes to current hostname only).
 *
 * This enables:
 * 1. Login at a4c.{domain}/login
 * 2. Redirect to {org.slug}.{domain}/dashboard
 * 3. Session persists across all subdomains
 */
import { createBrowserClient } from '@supabase/ssr';
import { isLocalhost, getDeploymentConfig } from '@/config/deployment.config';
import { generateCorrelationId, generateTraceparentHeader } from '@/utils/trace-ids';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Derive the base domain from a hostname.
 *
 * Examples:
 * - "a4c.firstovertheline.com" → "firstovertheline.com"
 * - "poc-test1.firstovertheline.com" → "firstovertheline.com"
 *
 * @param hostname - The full hostname
 * @returns The base domain (last two parts)
 */
function deriveBaseDomain(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }
  return hostname;
}

/**
 * Get cookie domain for cross-subdomain session sharing.
 *
 * Priority:
 * 1. VITE_PLATFORM_BASE_DOMAIN (explicit override)
 * 2. Derived from current hostname (production)
 * 3. undefined (localhost - scopes to current hostname only)
 *
 * @returns Cookie domain prefixed with '.' for subdomain scope, or undefined for localhost
 */
function getCookieDomain(): string | undefined {
  // Localhost: don't set cookie domain (browser default scopes to current hostname)
  if (isLocalhost()) {
    return undefined;
  }

  // Explicit override takes priority
  const configuredDomain = import.meta.env.VITE_PLATFORM_BASE_DOMAIN;
  if (configuredDomain) {
    return `.${configuredDomain}`;
  }

  // Production: derive from current hostname
  if (typeof window !== 'undefined') {
    const baseDomain = deriveBaseDomain(window.location.hostname);
    // Prefix with '.' for subdomain cookie scope
    return `.${baseDomain}`;
  }

  // SSR fallback: no domain (shouldn't happen in practice)
  return undefined;
}

// Validate environment variables
const config = getDeploymentConfig();
if (!supabaseUrl || !supabaseAnonKey) {
  if (config.authProvider === 'supabase') {
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
 * Fetch wrapper that injects tracing headers into every Supabase request.
 * PostgREST pre-request hook extracts these into session variables,
 * which emit_domain_event uses as fallback for event tracing.
 *
 * Note: X-Session-ID is NOT injected here (requires async JWT decode).
 * Session context is available via auth.uid() in the database.
 */
const tracingFetch: typeof fetch = (input, init) => {
  const existingHeaders: Record<string, string> = {};

  // Copy existing headers into a plain object
  if (init?.headers) {
    if (init.headers instanceof globalThis.Headers) {
      init.headers.forEach((value, key) => {
        existingHeaders[key] = value;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [key, value] of init.headers) {
        existingHeaders[key] = value;
      }
    } else {
      Object.assign(existingHeaders, init.headers);
    }
  }

  // Inject tracing headers if not already present
  if (!existingHeaders['X-Correlation-ID'] && !existingHeaders['x-correlation-id']) {
    existingHeaders['X-Correlation-ID'] = generateCorrelationId();
  }
  if (!existingHeaders['traceparent']) {
    existingHeaders['traceparent'] = generateTraceparentHeader();
  }

  return fetch(input, { ...init, headers: existingHeaders });
};

/**
 * Supabase client with cookie-based session storage
 *
 * Uses @supabase/ssr createBrowserClient for automatic cookie management.
 * Session cookies are scoped to the parent domain for cross-subdomain sharing.
 * Injects tracing headers (X-Correlation-ID, traceparent) on every request
 * for automatic HIPAA-compliant event correlation.
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
  global: {
    fetch: tracingFetch,
  },
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
