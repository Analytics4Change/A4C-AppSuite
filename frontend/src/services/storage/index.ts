/**
 * Storage service factory for auth context.
 * Provides platform-aware storage implementation.
 *
 * @see documentation/architecture/authentication/oauth-invitation-acceptance.md
 */

import {
  IAuthContextStorage,
  WebAuthContextStorage,
  MobileAuthContextStorage,
} from './AuthContextStorage';
import { detectPlatform } from '@/utils/platform';

// Singleton storage instance
let storageInstance: IAuthContextStorage | null = null;

/**
 * Get the appropriate storage implementation for the current platform.
 * Uses singleton pattern to reuse instance across calls.
 *
 * @returns Platform-appropriate storage implementation
 *
 * @example
 * const storage = getAuthContextStorage();
 * await storage.setItem('invitation_context', JSON.stringify(context));
 * const value = await storage.getItem('invitation_context');
 * await storage.removeItem('invitation_context');
 */
export function getAuthContextStorage(): IAuthContextStorage {
  if (!storageInstance) {
    const platform = detectPlatform();
    storageInstance =
      platform === 'web' ? new WebAuthContextStorage() : new MobileAuthContextStorage();
  }
  return storageInstance;
}

/**
 * Reset the storage singleton (primarily for testing).
 * @internal
 */
export function resetAuthContextStorage(): void {
  storageInstance = null;
}

// Re-export types and implementations for direct usage
export type { IAuthContextStorage } from './AuthContextStorage';
export { WebAuthContextStorage, MobileAuthContextStorage } from './AuthContextStorage';
