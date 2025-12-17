/**
 * Redirect URL Validation
 *
 * Validates redirect URLs to prevent open redirect vulnerabilities.
 * Uses VITE_PLATFORM_BASE_DOMAIN as the allowed domain.
 *
 * FAIL-FAST: In production mode, requires VITE_PLATFORM_BASE_DOMAIN to be set.
 */

const isMockMode = import.meta.env.VITE_APP_MODE === 'mock';

/**
 * Get the allowed domain from environment variable.
 *
 * FAIL-FAST: Throws in production if VITE_PLATFORM_BASE_DOMAIN is not set.
 * In mock mode, returns 'localhost' for development convenience.
 *
 * @throws Error if VITE_PLATFORM_BASE_DOMAIN is missing in production mode
 */
function getAllowedDomain(): string {
  const configuredDomain = import.meta.env.VITE_PLATFORM_BASE_DOMAIN;
  if (configuredDomain) return configuredDomain;

  // Mock mode: allow localhost for development
  if (isMockMode) {
    return 'localhost';
  }

  // Production mode: FAIL-FAST - this is a security-critical configuration
  throw new Error(
    'VITE_PLATFORM_BASE_DOMAIN is required for redirect URL validation. ' +
      'Please set this environment variable to prevent open redirect vulnerabilities.'
  );
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
 * FAIL-FAST: Throws in production if VITE_PLATFORM_BASE_DOMAIN is not set.
 * In mock mode, returns null for development convenience.
 *
 * @param slug - Organization slug (subdomain)
 * @param path - Path to append (default: '/dashboard')
 * @returns Full subdomain URL, or null in mock mode if not configured
 * @throws Error if VITE_PLATFORM_BASE_DOMAIN is missing in production mode
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
    // Mock mode: return null (subdomain feature not applicable in dev)
    if (isMockMode) {
      return null;
    }

    // Production mode: FAIL-FAST
    throw new Error(
      'VITE_PLATFORM_BASE_DOMAIN is required to build subdomain URLs. ' +
        'Please set this environment variable.'
    );
  }

  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `https://${slug}.${baseDomain}${normalizedPath}`;
}
