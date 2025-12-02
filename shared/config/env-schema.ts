/**
 * Environment Variable Schema - Single Source of Truth
 *
 * This file defines all environment variables used across the A4C-AppSuite monorepo.
 * All env vars are validated through Zod .parse() at application entry points.
 *
 * Behavior:
 * - z.string() = REQUIRED - throws ZodError if undefined
 * - z.string().optional() = OPTIONAL - allows undefined
 * - z.string().default('x') = OPTIONAL with default - undefined becomes 'x'
 */
import { z } from 'zod';

// =============================================================================
// Utility Transformers
// =============================================================================

/**
 * Transform string 'true'/'false' to boolean
 * Defaults to false if undefined
 * NOTE: .default() must come before .transform() since it operates on the input type
 */
export const booleanString = z
  .string()
  .default('false')
  .transform((v) => v === 'true');

/**
 * Transform string to number with default
 * @param defaultValue - Default value if undefined
 * NOTE: .default() must come before .transform() since it operates on the input type
 */
export const numberString = (defaultValue: number) =>
  z
    .string()
    .default(String(defaultValue))
    .transform((v) => parseInt(v, 10));

// =============================================================================
// Frontend Environment Variables (VITE_*)
// =============================================================================

export const frontendEnvSchema = z.object({
  // === Deployment Mode ===
  VITE_APP_MODE: z.enum(['mock', 'integration-auth', 'production']).default('mock'),

  // === Supabase Configuration (REQUIRED in production/integration) ===
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),

  // === Backend API ===
  VITE_BACKEND_API_URL: z.string().url().optional(),

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
 * Mode-aware frontend schema
 * In mock mode, Supabase credentials are optional
 */
export const frontendEnvSchemaForMode = (mode: string) => {
  if (mode === 'mock') {
    return frontendEnvSchema.extend({
      VITE_SUPABASE_URL: z.string().url().optional(),
      VITE_SUPABASE_ANON_KEY: z.string().min(1).optional(),
    });
  }
  return frontendEnvSchema;
};

// =============================================================================
// Workflows Environment Variables
// =============================================================================

export const workflowModeSchema = z.enum(['mock', 'development', 'production']);
export const dnsProviderSchema = z.enum(['cloudflare', 'mock', 'logging', 'auto']);
export const emailProviderSchema = z.enum(['resend', 'smtp', 'mock', 'logging', 'auto']);

export const workflowsEnvSchema = z.object({
  // === Workflow Mode ===
  WORKFLOW_MODE: workflowModeSchema.default('development'),
  DNS_PROVIDER: dnsProviderSchema.optional(),
  EMAIL_PROVIDER: emailProviderSchema.optional(),

  // === Temporal Configuration ===
  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().default('default'),
  TEMPORAL_TASK_QUEUE: z.string().default('bootstrap'),

  // === Supabase Configuration (REQUIRED) ===
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // === Cloudflare (required if DNS_PROVIDER=cloudflare) ===
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ZONE_ID: z.string().optional(),

  // === Resend (required if EMAIL_PROVIDER=resend) ===
  RESEND_API_KEY: z.string().optional(),

  // === SMTP (required if EMAIL_PROVIDER=smtp) ===
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: numberString(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  // === Development Features ===
  TAG_DEV_ENTITIES: booleanString,
  AUTO_CLEANUP: booleanString,

  // === Node.js ===
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  HEALTH_CHECK_PORT: numberString(9090),
  FRONTEND_URL: z.string().url().optional(),
});

// =============================================================================
// Edge Functions Environment Variables
// =============================================================================

export const edgeFunctionEnvSchema = z.object({
  // === Supabase (auto-set by Supabase platform) ===
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // === Backend API ===
  BACKEND_API_URL: z.string().url().default('https://api-a4c.firstovertheline.com'),

  // === Deployment tracking ===
  GIT_COMMIT_SHA: z.string().optional(),
});

// =============================================================================
// Inferred Types
// =============================================================================

export type FrontendEnv = z.infer<typeof frontendEnvSchema>;
export type WorkflowsEnv = z.infer<typeof workflowsEnvSchema>;
export type EdgeFunctionEnv = z.infer<typeof edgeFunctionEnvSchema>;
export type WorkflowMode = z.infer<typeof workflowModeSchema>;
export type DNSProvider = z.infer<typeof dnsProviderSchema>;
export type EmailProvider = z.infer<typeof emailProviderSchema>;

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate environment and return typed result or throw
 * @param schema - Zod schema to validate against
 * @param env - Environment object to validate
 * @param componentName - Name for error messages
 */
export function validateEnv<T extends z.ZodSchema>(
  schema: T,
  env: Record<string, string | undefined>,
  componentName: string
): z.infer<T> {
  const result = schema.safeParse(env);

  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`[${componentName}] Environment validation failed:\n${errors}`);
  }

  return result.data;
}

/**
 * Validate environment with safe result (no throw)
 * @param schema - Zod schema to validate against
 * @param env - Environment object to validate
 */
export function validateEnvSafe<T extends z.ZodSchema>(
  schema: T,
  env: Record<string, string | undefined>
): z.SafeParseReturnType<z.input<T>, z.infer<T>> {
  return schema.safeParse(env);
}
