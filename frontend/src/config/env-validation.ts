/**
 * Environment Variable Validation
 *
 * Validates all VITE_* environment variables at application startup.
 * Throws immediately if required variables are missing (undefined causes failure).
 *
 * Called from main.tsx BEFORE any other initialization.
 */
import { z } from 'zod';

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
  // === Deployment Mode ===
  VITE_APP_MODE: z.enum(['mock', 'integration-auth', 'production']).default('mock'),

  // === Supabase Configuration ===
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),

  // === Backend API ===
  VITE_BACKEND_API_URL: z.string().url().optional(),

  // === Platform Domain (required for cross-subdomain session sharing) ===
  // Single source of truth for cookie scoping and redirect URL validation
  // See: documentation/infrastructure/operations/configuration/ENVIRONMENT_VARIABLES.md
  VITE_PLATFORM_BASE_DOMAIN: z.string().min(1),

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
});

/**
 * Mode-aware schema that makes Supabase optional in mock mode
 */
const getSchemaForMode = (mode: string) => {
  if (mode === 'mock') {
    return frontendEnvSchema.extend({
      VITE_SUPABASE_URL: z.string().url().optional(),
      VITE_SUPABASE_ANON_KEY: z.string().min(1).optional(),
      VITE_PLATFORM_BASE_DOMAIN: z.string().min(1).optional(),
    });
  }
  return frontendEnvSchema;
};

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

  // Get mode first (with fallback to mock)
  const mode = import.meta.env.VITE_APP_MODE || 'mock';

  // Build env object from import.meta.env
  const rawEnv = {
    VITE_APP_MODE: import.meta.env.VITE_APP_MODE,
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
  };

  // Validate against mode-appropriate schema
  const schema = getSchemaForMode(mode);
  const result = schema.safeParse(rawEnv);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    const errorMessage = `
╔══════════════════════════════════════════════════════════════════╗
║                 ENVIRONMENT VALIDATION FAILED                     ║
╠══════════════════════════════════════════════════════════════════╣
║ Mode: ${mode.padEnd(57)}║
╠══════════════════════════════════════════════════════════════════╣
${errors}
╠══════════════════════════════════════════════════════════════════╣
║ Fix: Check your .env.local file against frontend/.env.example    ║
╚══════════════════════════════════════════════════════════════════╝
`;

    console.error(errorMessage);
    throw new Error(`Environment validation failed:\n${errors}`);
  }

  // Type assertion is safe here because:
  // - In mock mode, Supabase fields are optional (won't be accessed)
  // - In production/integration mode, validation ensures they exist
  validatedEnv = result.data as FrontendEnv;
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
