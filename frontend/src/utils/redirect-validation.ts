/**
 * Redirect URL Validation
 *
 * Validates redirect URLs to prevent open redirect vulnerabilities.
 * Uses VITE_PLATFORM_BASE_DOMAIN as the allowed domain.
 */

/**
 * Get the allowed domain from environment variable.
 * Falls back to extracting parent domain from current hostname.
 */
function getAllowedDomain(): string {
  const configuredDomain = import.meta.env.VITE_PLATFORM_BASE_DOMAIN;
  if (configuredDomain) return configuredDomain;

  // Fallback: extract parent domain from hostname
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;

    // Localhost is always allowed
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return hostname;
    }

    const parts = hostname.split('.');
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }
  }
  return '';
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
 * Builds a subdomain URL for an organization.
 *
 * @param slug - Organization slug (subdomain)
 * @param path - Path to append (default: '/dashboard')
 * @returns Full subdomain URL or null if base domain not configured
 *
 * @example
 * ```typescript
 * const url = buildSubdomainUrl('poc-test1', '/dashboard');
 * // => "https://poc-test1.firstovertheline.com/dashboard"
 * ```
 */
export function buildSubdomainUrl(slug: string, path: string = '/dashboard'): string | null {
  const baseDomain = import.meta.env.VITE_PLATFORM_BASE_DOMAIN;

  if (!baseDomain) {
    console.warn('[buildSubdomainUrl] VITE_PLATFORM_BASE_DOMAIN not configured');
    return null;
  }

  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `https://${slug}.${baseDomain}${normalizedPath}`;
}
