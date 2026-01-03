/**
 * Redirect URL Validation
 *
 * Validates redirect URLs to prevent open redirect vulnerabilities.
 * Automatically derives the allowed domain from the current hostname in production.
 *
 * Domain Detection:
 * - Production: Derives base domain from window.location.hostname
 *   (e.g., "a4c.firstovertheline.com" → "firstovertheline.com")
 * - Localhost: Returns 'localhost' (subdomain routing disabled)
 * - Override: VITE_PLATFORM_BASE_DOMAIN can explicitly set the domain
 */

import { getDeploymentConfig, isLocalhost } from '@/config/deployment.config';

/**
 * Derive the base domain from a hostname.
 *
 * Examples:
 * - "a4c.firstovertheline.com" → "firstovertheline.com"
 * - "poc-test1.firstovertheline.com" → "firstovertheline.com"
 * - "localhost" → "localhost"
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
 * Get the allowed domain for redirect validation.
 *
 * Priority:
 * 1. VITE_PLATFORM_BASE_DOMAIN (explicit override)
 * 2. Derived from current hostname (production)
 * 3. 'localhost' (when subdomain routing is disabled)
 *
 * @returns The allowed domain for redirect validation
 */
function getAllowedDomain(): string {
  // Explicit override takes priority
  const configuredDomain = import.meta.env.VITE_PLATFORM_BASE_DOMAIN;
  if (configuredDomain) {
    return configuredDomain;
  }

  const config = getDeploymentConfig();

  // Dev modes (subdomain routing disabled): allow localhost
  if (!config.enableSubdomainRouting) {
    return 'localhost';
  }

  // Production: derive from current hostname
  if (typeof window !== 'undefined') {
    return deriveBaseDomain(window.location.hostname);
  }

  // SSR fallback (shouldn't happen in practice for redirects)
  return 'localhost';
}

/**
 * Validates whether a redirect URL is safe to use.
 *
 * Allows:
 * - Relative paths (e.g., "/dashboard", "/organizations/123")
 * - URLs on the configured platform domain
 * - URLs on subdomains of the platform domain
 *
 * Blocks:
 * - External domains
 * - Invalid URLs
 * - Null/undefined values
 *
 * @param url - URL to validate
 * @returns true if URL is safe to redirect to
 *
 * @example
 * ```typescript
 * isValidRedirectUrl('/dashboard');                              // true
 * isValidRedirectUrl('https://poc-test1.example.com/dashboard'); // true (if example.com is configured)
 * isValidRedirectUrl('https://evil.com/phishing');               // false
 * ```
 */
export function isValidRedirectUrl(url: string | null | undefined): boolean {
  if (!url) return false;

  // Allow relative paths (start with /)
  if (url.startsWith('/')) return true;

  // Validate external URLs against allowed domain
  const allowedDomain = getAllowedDomain();
  if (!allowedDomain) return false;

  try {
    const parsed = new URL(url);

    // Must be http or https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    // Check if hostname matches allowed domain or is a subdomain
    return (
      parsed.hostname === allowedDomain ||
      parsed.hostname.endsWith(`.${allowedDomain}`)
    );
  } catch {
    // Invalid URL
    return false;
  }
}

/**
 * Sanitizes a redirect URL, returning null if invalid.
 *
 * @param url - URL to sanitize
 * @returns The URL if valid, null otherwise
 *
 * @example
 * ```typescript
 * const redirect = sanitizeRedirectUrl(searchParams.get('redirect'));
 * if (redirect) {
 *   navigate(redirect);
 * }
 * ```
 */
export function sanitizeRedirectUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return isValidRedirectUrl(url) ? url : null;
}

/**
 * Get the platform base domain for subdomain URL construction.
 *
 * Priority:
 * 1. VITE_PLATFORM_BASE_DOMAIN (explicit override)
 * 2. Derived from current hostname (production)
 *
 * @returns Base domain or null if on localhost
 */
function getPlatformBaseDomain(): string | null {
  // Explicit override
  const configuredDomain = import.meta.env.VITE_PLATFORM_BASE_DOMAIN;
  if (configuredDomain) {
    return configuredDomain;
  }

  // Localhost: subdomain routing not available
  if (isLocalhost()) {
    return null;
  }

  // Derive from current hostname
  if (typeof window !== 'undefined') {
    return deriveBaseDomain(window.location.hostname);
  }

  return null;
}

/**
 * Builds a subdomain URL for an organization.
 *
 * When subdomain routing is disabled (localhost), returns null.
 * In production, derives the base domain from the current hostname.
 *
 * @param slug - Organization slug (subdomain)
 * @param path - Path to append (default: '/dashboard')
 * @returns Full subdomain URL, or null when subdomain routing is disabled
 *
 * @example
 * ```typescript
 * const url = buildSubdomainUrl('poc-test1', '/dashboard');
 * // => "https://poc-test1.firstovertheline.com/dashboard" (production)
 * // => null (localhost/development)
 * ```
 */
export function buildSubdomainUrl(slug: string, path: string = '/dashboard'): string | null {
  const config = getDeploymentConfig();

  // Subdomain routing disabled (localhost or dev mode): return null
  if (!config.enableSubdomainRouting) {
    return null;
  }

  const baseDomain = getPlatformBaseDomain();

  if (!baseDomain) {
    // No base domain available (shouldn't happen if enableSubdomainRouting is true)
    return null;
  }

  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `https://${slug}.${baseDomain}${normalizedPath}`;
}
