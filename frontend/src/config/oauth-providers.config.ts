/**
 * OAuth Provider Configuration
 *
 * Defines which OAuth providers are enabled and their display names.
 * This configuration allows easy expansion to additional providers.
 *
 * @see documentation/architecture/authentication/oauth-invitation-acceptance.md
 */

import { OAuthProvider } from '@/types/auth.types';

/**
 * OAuth providers currently enabled for authentication.
 * Add providers here as they are configured in Supabase.
 */
export const ENABLED_OAUTH_PROVIDERS: OAuthProvider[] = ['google'];

/**
 * Display names for OAuth providers.
 * Used in UI buttons and error messages.
 */
export const PROVIDER_DISPLAY_NAMES: Record<OAuthProvider, string> = {
  google: 'Google',
  github: 'GitHub',
  facebook: 'Facebook',
  apple: 'Apple',
  azure: 'Microsoft',
  okta: 'Okta',
  keycloak: 'Enterprise SSO',
};

/**
 * Provider icons (for future use with branded buttons)
 */
export const PROVIDER_ICONS: Record<OAuthProvider, string> = {
  google: 'google',
  github: 'github',
  facebook: 'facebook',
  apple: 'apple',
  azure: 'microsoft',
  okta: 'key', // Generic icon
  keycloak: 'shield', // Generic icon
};

/**
 * Check if a provider is currently enabled.
 *
 * @param provider - OAuth provider to check
 * @returns true if provider is enabled
 */
export function isProviderEnabled(provider: OAuthProvider): boolean {
  return ENABLED_OAUTH_PROVIDERS.includes(provider);
}

/**
 * Get display name for a provider.
 *
 * @param provider - OAuth provider
 * @returns Human-readable display name
 */
export function getProviderDisplayName(provider: OAuthProvider): string {
  return PROVIDER_DISPLAY_NAMES[provider] || provider;
}
