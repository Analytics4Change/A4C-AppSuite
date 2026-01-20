/**
 * Environment Variable Validation
 *
 * Validates all VITE_* environment variables at application startup.
 * Uses smart detection instead of explicit mode configuration.
 *
 * Smart Detection:
 * - Supabase credentials present → use real services
 * - Credentials missing → mock mode
 * - VITE_FORCE_MOCK=true → force mock mode
 *
 * Called from main.tsx BEFORE any other initialization.
 */
import { z } from 'zod';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('config');

// =============================================================================
// Utility Transformers
// =============================================================================

/** Transform string 'true'/'false' to boolean, default false */
const booleanString = z
  .string()
  .default('false')
  .transform((v) => v === 'true');

/** Transform string to number with default */
const numberString = (defaultValue: number) =>
  z
    .string()
    .default(String(defaultValue))
    .transform((v) => parseInt(v, 10));

// =============================================================================
// Frontend Environment Schema
// =============================================================================

const frontendEnvSchema = z.object({
  // === Smart Detection Override ===
  // Force mock mode even when Supabase credentials are present
  VITE_FORCE_MOCK: booleanString,

  // === Supabase Configuration ===
  // Optional: presence determines if real services are used
  VITE_SUPABASE_URL: z.string().url().optional(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1).optional(),

  // === Backend API ===
  VITE_BACKEND_API_URL: z.string().url().optional(),

  // === Platform Domain (Optional - auto-derived from hostname in production) ===
  // Can be explicitly set to override auto-detection
  // See: documentation/infrastructure/operations/configuration/ENVIRONMENT_VARIABLES.md
  VITE_PLATFORM_BASE_DOMAIN: z.string().min(1).optional(),

  // === Medication Search ===
  VITE_USE_RXNORM_API: booleanString,
  VITE_USE_RXNORM: booleanString,
  VITE_RXNORM_BASE_URL: z.string().url().default('https://rxnav.nlm.nih.gov/REST'),
  VITE_RXNORM_TIMEOUT: numberString(10000),

  // === Cache Configuration ===
  VITE_CACHE_MEMORY_TTL: numberString(1800000),
  VITE_CACHE_INDEXEDDB_TTL: numberString(86400000),
  VITE_CACHE_MAX_MEMORY_ENTRIES: numberString(100),

  // === Circuit Breaker ===
  VITE_CIRCUIT_FAILURE_THRESHOLD: numberString(5),
  VITE_CIRCUIT_RESET_TIMEOUT: numberString(60000),

  // === Search Configuration ===
  VITE_SEARCH_MIN_LENGTH: numberString(1),
  VITE_SEARCH_MAX_RESULTS: numberString(15),
  VITE_SEARCH_DEBOUNCE_MS: numberString(300),

  // === Mock Auth (development only) ===
  VITE_DEV_USER_ID: z.string().optional(),
  VITE_DEV_USER_EMAIL: z.string().email().optional(),
  VITE_DEV_USER_NAME: z.string().optional(),
  VITE_DEV_USER_ROLE: z.enum(['super_admin', 'provider_admin', 'clinician', 'viewer']).optional(),
  VITE_DEV_ORG_ID: z.string().optional(),
  VITE_DEV_SCOPE_PATH: z.string().optional(),
  VITE_DEV_PERMISSIONS: z.string().optional(),
  VITE_DEV_PROFILE: z.string().optional(),

  // === OAuth Configuration ===
  VITE_GOOGLE_CLIENT_ID: z.string().optional(),
  VITE_FACEBOOK_APP_ID: z.string().optional(),
  VITE_APPLE_CLIENT_ID: z.string().optional(),
  VITE_APPLE_REDIRECT_URI: z.string().url().optional(),

  // === Logging & Debug ===
  VITE_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  VITE_LOG_CATEGORIES: z.string().optional(),
  VITE_DEBUG_MOBX: booleanString,
  VITE_DEBUG_PERFORMANCE: booleanString,
  VITE_DEBUG_LOGS: booleanString,

  // === Deprecated (kept for backward compatibility, no longer used) ===
  // VITE_APP_MODE is replaced by smart detection
  VITE_APP_MODE: z.string().optional(),
});

// =============================================================================
// Validation Function
// =============================================================================

export type FrontendEnv = z.infer<typeof frontendEnvSchema>;

let validatedEnv: FrontendEnv | null = null;

/**
 * Validate environment variables at startup.
 * Throws if required variables are undefined.
 *
 * Call this ONCE at application startup in main.tsx.
 */
export function validateEnvironment(): FrontendEnv {
  if (validatedEnv) {
    return validatedEnv;
  }

  // Build env object from import.meta.env
  const rawEnv = {
    VITE_FORCE_MOCK: import.meta.env.VITE_FORCE_MOCK,
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
    VITE_BACKEND_API_URL: import.meta.env.VITE_BACKEND_API_URL,
    VITE_PLATFORM_BASE_DOMAIN: import.meta.env.VITE_PLATFORM_BASE_DOMAIN,
    VITE_USE_RXNORM_API: import.meta.env.VITE_USE_RXNORM_API,
    VITE_USE_RXNORM: import.meta.env.VITE_USE_RXNORM,
    VITE_RXNORM_BASE_URL: import.meta.env.VITE_RXNORM_BASE_URL,
    VITE_RXNORM_TIMEOUT: import.meta.env.VITE_RXNORM_TIMEOUT,
    VITE_CACHE_MEMORY_TTL: import.meta.env.VITE_CACHE_MEMORY_TTL,
    VITE_CACHE_INDEXEDDB_TTL: import.meta.env.VITE_CACHE_INDEXEDDB_TTL,
    VITE_CACHE_MAX_MEMORY_ENTRIES: import.meta.env.VITE_CACHE_MAX_MEMORY_ENTRIES,
    VITE_CIRCUIT_FAILURE_THRESHOLD: import.meta.env.VITE_CIRCUIT_FAILURE_THRESHOLD,
    VITE_CIRCUIT_RESET_TIMEOUT: import.meta.env.VITE_CIRCUIT_RESET_TIMEOUT,
    VITE_SEARCH_MIN_LENGTH: import.meta.env.VITE_SEARCH_MIN_LENGTH,
    VITE_SEARCH_MAX_RESULTS: import.meta.env.VITE_SEARCH_MAX_RESULTS,
    VITE_SEARCH_DEBOUNCE_MS: import.meta.env.VITE_SEARCH_DEBOUNCE_MS,
    VITE_DEV_USER_ID: import.meta.env.VITE_DEV_USER_ID,
    VITE_DEV_USER_EMAIL: import.meta.env.VITE_DEV_USER_EMAIL,
    VITE_DEV_USER_NAME: import.meta.env.VITE_DEV_USER_NAME,
    VITE_DEV_USER_ROLE: import.meta.env.VITE_DEV_USER_ROLE,
    VITE_DEV_ORG_ID: import.meta.env.VITE_DEV_ORG_ID,
    VITE_DEV_SCOPE_PATH: import.meta.env.VITE_DEV_SCOPE_PATH,
    VITE_DEV_PERMISSIONS: import.meta.env.VITE_DEV_PERMISSIONS,
    VITE_DEV_PROFILE: import.meta.env.VITE_DEV_PROFILE,
    VITE_GOOGLE_CLIENT_ID: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    VITE_FACEBOOK_APP_ID: import.meta.env.VITE_FACEBOOK_APP_ID,
    VITE_APPLE_CLIENT_ID: import.meta.env.VITE_APPLE_CLIENT_ID,
    VITE_APPLE_REDIRECT_URI: import.meta.env.VITE_APPLE_REDIRECT_URI,
    VITE_LOG_LEVEL: import.meta.env.VITE_LOG_LEVEL,
    VITE_LOG_CATEGORIES: import.meta.env.VITE_LOG_CATEGORIES,
    VITE_DEBUG_MOBX: import.meta.env.VITE_DEBUG_MOBX,
    VITE_DEBUG_PERFORMANCE: import.meta.env.VITE_DEBUG_PERFORMANCE,
    VITE_DEBUG_LOGS: import.meta.env.VITE_DEBUG_LOGS,
    VITE_APP_MODE: import.meta.env.VITE_APP_MODE, // Deprecated but kept for compatibility
  };

  // Validate against schema
  const result = frontendEnvSchema.safeParse(rawEnv);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    // Determine effective mode for display
    const hasCredentials = !!rawEnv.VITE_SUPABASE_URL;
    const forceMock = rawEnv.VITE_FORCE_MOCK === 'true';
    const effectiveMode = (hasCredentials && !forceMock) ? 'real' : 'mock';

    const _errorMessage = `
╔══════════════════════════════════════════════════════════════════╗
║                 ENVIRONMENT VALIDATION FAILED                     ║
╠══════════════════════════════════════════════════════════════════╣
║ Detected Mode: ${effectiveMode.padEnd(49)}║
║ Has Credentials: ${String(hasCredentials).padEnd(47)}║
║ Force Mock: ${String(forceMock).padEnd(52)}║
╠══════════════════════════════════════════════════════════════════╣
${errors}
╠══════════════════════════════════════════════════════════════════╣
║ Fix: Check your .env.local file against frontend/.env.example    ║
╚══════════════════════════════════════════════════════════════════╝
`;

    log.error('Environment validation failed', { effectiveMode, errors: result.error.issues });
    throw new Error(`Environment validation failed:\n${errors}`);
  }

  validatedEnv = result.data;

  // Log detected configuration
  const hasCredentials = !!validatedEnv.VITE_SUPABASE_URL;
  const effectiveMode = (hasCredentials && !validatedEnv.VITE_FORCE_MOCK) ? 'real' : 'mock';
  log.info('Environment validated', {
    effectiveMode,
    hasSupabaseCredentials: hasCredentials,
    forceMock: validatedEnv.VITE_FORCE_MOCK,
  });

  return validatedEnv;
}

/**
 * Get validated environment (throws if not yet validated)
 */
export function getEnv(): FrontendEnv {
  if (!validatedEnv) {
    return validateEnvironment();
  }
  return validatedEnv;
}
