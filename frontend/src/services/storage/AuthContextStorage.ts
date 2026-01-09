/**
 * Platform-agnostic storage abstraction for auth context.
 * Supports web (sessionStorage), React Native (AsyncStorage/SecureStore).
 *
 * @see documentation/architecture/authentication/oauth-invitation-acceptance.md
 */

/**
 * Storage interface for auth context persistence across OAuth redirects.
 * Implementations provide platform-specific storage mechanisms.
 */
export interface IAuthContextStorage {
  /**
   * Store a value with the given key
   * @param key Storage key
   * @param value String value to store
   */
  setItem(key: string, value: string): Promise<void>;

  /**
   * Retrieve a value by key
   * @param key Storage key
   * @returns Stored value or null if not found
   */
  getItem(key: string): Promise<string | null>;

  /**
   * Remove a value by key
   * @param key Storage key
   */
  removeItem(key: string): Promise<void>;
}

/**
 * Web implementation using sessionStorage.
 * - Survives OAuth redirects within same tab
 * - Automatically cleared when tab closes
 * - Not accessible cross-origin
 */
export class WebAuthContextStorage implements IAuthContextStorage {
  async setItem(key: string, value: string): Promise<void> {
    try {
      sessionStorage.setItem(key, value);
    } catch (error) {
      // Handle QuotaExceededError or SecurityError
      console.error('[WebAuthContextStorage] Failed to set item:', error);
      throw new Error(`Storage error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getItem(key: string): Promise<string | null> {
    try {
      return sessionStorage.getItem(key);
    } catch (error) {
      console.error('[WebAuthContextStorage] Failed to get item:', error);
      return null;
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      sessionStorage.removeItem(key);
    } catch (error) {
      console.error('[WebAuthContextStorage] Failed to remove item:', error);
    }
  }
}

/**
 * Mobile implementation placeholder for React Native.
 * Future implementation will use:
 * - expo-secure-store for sensitive data
 * - @react-native-async-storage/async-storage for non-sensitive data
 */
export class MobileAuthContextStorage implements IAuthContextStorage {
  async setItem(_key: string, _value: string): Promise<void> {
    // TODO: Implement with SecureStore
    // import * as SecureStore from 'expo-secure-store';
    // await SecureStore.setItemAsync(key, value);
    throw new Error('Mobile storage not yet implemented. Please use web browser.');
  }

  async getItem(_key: string): Promise<string | null> {
    // TODO: Implement with SecureStore
    // return await SecureStore.getItemAsync(key);
    throw new Error('Mobile storage not yet implemented. Please use web browser.');
  }

  async removeItem(_key: string): Promise<void> {
    // TODO: Implement with SecureStore
    // await SecureStore.deleteItemAsync(key);
    throw new Error('Mobile storage not yet implemented. Please use web browser.');
  }
}
