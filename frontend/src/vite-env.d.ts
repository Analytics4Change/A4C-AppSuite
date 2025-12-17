/// <reference types="vite/client" />

/**
 * Vite Environment Variables Type Definitions
 *
 * Keep in sync with: shared/config/env-schema.ts
 * See: documentation/infrastructure/operations/configuration/ENVIRONMENT_VARIABLES.md
 *
 * Note: All values are strings at runtime (Vite limitation).
 * Use parseEnvBoolean/parseEnvNumber for type conversion.
 */

interface ImportMetaEnv {
  // === Deployment Mode ===
  /** Application mode: 'mock' | 'integration-auth' | 'production' */
  readonly VITE_APP_MODE?: 'mock' | 'integration-auth' | 'production';

  // === Supabase Configuration ===
  /** Supabase project URL (required in production/integration) */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anonymous key (required in production/integration) */
  readonly VITE_SUPABASE_ANON_KEY?: string;

  // === Backend API ===
  /** Backend API URL for workflow operations */
  readonly VITE_BACKEND_API_URL?: string;

  // === Platform Domain ===
  /**
   * Platform base domain for cross-subdomain session sharing.
   * Used for cookie scoping and redirect URL validation.
   * Required in production/integration modes.
   * Example: 'firstovertheline.com'
   */
  readonly VITE_PLATFORM_BASE_DOMAIN?: string;

  // === Medication Search ===
  /** Use real RXNorm API instead of mock data ('true'/'false') */
  readonly VITE_USE_RXNORM_API?: string;
  /** Alias for VITE_USE_RXNORM_API */
  readonly VITE_USE_RXNORM?: string;
  /** RXNorm API base URL */
  readonly VITE_RXNORM_BASE_URL?: string;
  /** RXNorm API timeout in ms */
  readonly VITE_RXNORM_TIMEOUT?: string;

  // === Cache Configuration ===
  /** Memory cache TTL in ms */
  readonly VITE_CACHE_MEMORY_TTL?: string;
  /** IndexedDB cache TTL in ms */
  readonly VITE_CACHE_INDEXEDDB_TTL?: string;
  /** Max memory cache entries */
  readonly VITE_CACHE_MAX_MEMORY_ENTRIES?: string;

  // === Circuit Breaker ===
  /** Circuit breaker failure threshold */
  readonly VITE_CIRCUIT_FAILURE_THRESHOLD?: string;
  /** Circuit breaker reset timeout in ms */
  readonly VITE_CIRCUIT_RESET_TIMEOUT?: string;

  // === Search Configuration ===
  /** Minimum search string length */
  readonly VITE_SEARCH_MIN_LENGTH?: string;
  /** Maximum search results */
  readonly VITE_SEARCH_MAX_RESULTS?: string;
  /** Search debounce delay in ms */
  readonly VITE_SEARCH_DEBOUNCE_MS?: string;

  // === Mock Auth (development only) ===
  /** Mock user ID */
  readonly VITE_DEV_USER_ID?: string;
  /** Mock user email */
  readonly VITE_DEV_USER_EMAIL?: string;
  /** Mock user name */
  readonly VITE_DEV_USER_NAME?: string;
  /** Mock user role */
  readonly VITE_DEV_USER_ROLE?: 'super_admin' | 'provider_admin' | 'clinician' | 'viewer';
  /** Mock organization ID */
  readonly VITE_DEV_ORG_ID?: string;
  /** Mock scope path */
  readonly VITE_DEV_SCOPE_PATH?: string;
  /** Mock permissions (comma-separated) */
  readonly VITE_DEV_PERMISSIONS?: string;
  /** Mock profile name */
  readonly VITE_DEV_PROFILE?: string;

  // === OAuth Configuration ===
  /** Google OAuth client ID */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** Facebook OAuth app ID */
  readonly VITE_FACEBOOK_APP_ID?: string;
  /** Apple OAuth client ID */
  readonly VITE_APPLE_CLIENT_ID?: string;
  /** Apple OAuth redirect URI */
  readonly VITE_APPLE_REDIRECT_URI?: string;

  // === Logging & Debug ===
  /** Log level override */
  readonly VITE_LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
  /** Log categories (comma-separated) */
  readonly VITE_LOG_CATEGORIES?: string;
  /** Enable MobX debug monitor ('true'/'false') */
  readonly VITE_DEBUG_MOBX?: string;
  /** Enable performance monitor ('true'/'false') */
  readonly VITE_DEBUG_PERFORMANCE?: string;
  /** Enable log overlay ('true'/'false') */
  readonly VITE_DEBUG_LOGS?: string;

  // === Vite Built-in Variables ===
  /** Current mode name */
  readonly MODE: string;
  /** Base URL */
  readonly BASE_URL: string;
  /** Is production build */
  readonly PROD: boolean;
  /** Is development mode */
  readonly DEV: boolean;
  /** Is server-side rendering */
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
