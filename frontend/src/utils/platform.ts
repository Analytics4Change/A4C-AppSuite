/**
 * Platform detection utilities for OAuth flows.
 * Supports web browsers and React Native (future).
 *
 * @see documentation/architecture/authentication/oauth-invitation-acceptance.md
 */

/**
 * Supported platforms for OAuth callback handling
 */
export type Platform = 'web' | 'ios' | 'android';

/**
 * Deep link URL scheme for mobile apps
 * Used for OAuth callback in React Native
 */
const MOBILE_DEEP_LINK_SCHEME = 'a4c';

/**
 * Detect the current platform.
 *
 * @returns Platform identifier ('web', 'ios', or 'android')
 */
export function detectPlatform(): Platform {
  // Check for React Native environment
  if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
    // In a real React Native app, we'd use:
    // import { Platform } from 'react-native';
    // return Platform.OS === 'ios' ? 'ios' : 'android';
    //
    // For now, default to 'ios' as placeholder
    // This code path won't be reached in web builds
    return 'ios';
  }

  return 'web';
}

/**
 * Get the OAuth callback URL for the current platform.
 *
 * @param platform - Target platform (defaults to auto-detect)
 * @returns Callback URL appropriate for the platform
 *
 * @example
 * // Web: https://app.example.com/auth/callback
 * // iOS/Android: a4c://auth/callback
 */
export function getCallbackUrl(platform?: Platform): string {
  const targetPlatform = platform || detectPlatform();

  switch (targetPlatform) {
    case 'web':
      return `${window.location.origin}/auth/callback`;

    case 'ios':
    case 'android':
      // Deep link for mobile OAuth callback
      return `${MOBILE_DEEP_LINK_SCHEME}://auth/callback`;

    default: {
      // Exhaustive check - TypeScript will error if a case is missing
      const _exhaustive: never = targetPlatform;
      return _exhaustive;
    }
  }
}

/**
 * Check if running in a mobile environment.
 *
 * @returns true if running in React Native
 */
export function isMobile(): boolean {
  const platform = detectPlatform();
  return platform === 'ios' || platform === 'android';
}
