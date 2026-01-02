/**
 * Environment Variable Schema - Edge Functions
 *
 * Zod schema for all environment variables used by Supabase Edge Functions.
 * All env vars are validated through Zod .parse() at function startup.
 *
 * Behavior:
 * - z.string() = REQUIRED - throws ZodError if undefined
 * - z.string().optional() = OPTIONAL - allows undefined
 * - z.string().default('x') = OPTIONAL with default - undefined becomes 'x'
 *
 * Usage in Edge Functions:
 *   import { validateEdgeFunctionEnv } from '../_shared/env-schema.ts';
 *   const env = validateEdgeFunctionEnv();
 */
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

// =============================================================================
// Edge Function Environment Schema
// =============================================================================

export const edgeFunctionEnvSchema = z.object({
  // === Supabase (auto-set by Supabase platform) ===
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // === Domain Configuration ===
  // PLATFORM_BASE_DOMAIN is the single source of truth for all domain configuration.
  // Other domain-related values are derived from this:
  //   - BACKEND_API_URL  = https://api-a4c.${PLATFORM_BASE_DOMAIN}
  //   - FRONTEND_URL     = https://a4c.${PLATFORM_BASE_DOMAIN}
  //   - Tenant subdomains = {slug}.${PLATFORM_BASE_DOMAIN}
  PLATFORM_BASE_DOMAIN: z.string().default('firstovertheline.com'),

  // === Backend API ===
  // Derived from PLATFORM_BASE_DOMAIN if not explicitly set
  BACKEND_API_URL: z.string().url().optional(),

  // Frontend URL for redirects
  // Derived from PLATFORM_BASE_DOMAIN if not explicitly set
  FRONTEND_URL: z.string().url().optional(),

  // === Deployment tracking ===
  GIT_COMMIT_SHA: z.string().optional(),

  // === Email Provider (Resend) ===
  // Required for invite-user Edge Function
  RESEND_API_KEY: z.string().min(1).optional(),
});

// =============================================================================
// Inferred Type
// =============================================================================

/** Raw type from Zod schema (BACKEND_API_URL and FRONTEND_URL may be undefined) */
type RawEdgeFunctionEnv = z.infer<typeof edgeFunctionEnvSchema>;

/**
 * Validated environment type with guaranteed domain configuration.
 * BACKEND_API_URL and FRONTEND_URL are derived from PLATFORM_BASE_DOMAIN if not set.
 */
export type EdgeFunctionEnv = RawEdgeFunctionEnv & {
  BACKEND_API_URL: string;
  FRONTEND_URL: string;
};

// =============================================================================
// Validation Function
// =============================================================================

/**
 * Validate Edge Function environment variables.
 * Throws immediately if required variables are undefined.
 *
 * After validation, derives BACKEND_API_URL and FRONTEND_URL from
 * PLATFORM_BASE_DOMAIN if not explicitly set.
 *
 * Call this at the start of your Edge Function handler.
 *
 * @param functionName - Name of the function for error messages
 * @returns Validated and typed environment object
 * @throws Error if validation fails
 */
export function validateEdgeFunctionEnv(functionName: string): EdgeFunctionEnv {
  // Build env object from Deno.env.get()
  const inputEnv = {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    PLATFORM_BASE_DOMAIN: Deno.env.get('PLATFORM_BASE_DOMAIN'),
    BACKEND_API_URL: Deno.env.get('BACKEND_API_URL'),
    FRONTEND_URL: Deno.env.get('FRONTEND_URL'),
    GIT_COMMIT_SHA: Deno.env.get('GIT_COMMIT_SHA'),
    RESEND_API_KEY: Deno.env.get('RESEND_API_KEY'),
  };

  const result = edgeFunctionEnvSchema.safeParse(inputEnv);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    const errorMessage = `[${functionName}] Environment validation failed:\n${errors}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }

  // Derive domain configuration from PLATFORM_BASE_DOMAIN
  const rawEnv = result.data;
  const baseDomain = rawEnv.PLATFORM_BASE_DOMAIN;

  // BACKEND_API_URL: Backend API for workflow operations
  const backendApiUrl = rawEnv.BACKEND_API_URL ?? `https://api-a4c.${baseDomain}`;

  // FRONTEND_URL: URL for redirects
  const frontendUrl = rawEnv.FRONTEND_URL ?? `https://a4c.${baseDomain}`;

  // Create validated env with guaranteed domain fields
  const env: EdgeFunctionEnv = {
    ...rawEnv,
    BACKEND_API_URL: backendApiUrl,
    FRONTEND_URL: frontendUrl,
  };

  return env;
}

/**
 * Create a standardized error response for validation failures
 *
 * @param functionName - Name of the function
 * @param version - Deploy version
 * @param details - Error details
 */
export function createEnvErrorResponse(
  functionName: string,
  version: string,
  details: string,
  corsHeaders: Record<string, string>
): Response {
  console.error(`[${functionName} ${version}] Environment validation failed:`, details);
  return new Response(
    JSON.stringify({
      error: 'Server configuration error',
      details: 'Missing required environment variables',
      version,
    }),
    {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

// =============================================================================
// Stage 2: Business Logic Validation Helpers
// =============================================================================
// These check conditional requirements AFTER Zod validates types.
// Call these immediately after validateEdgeFunctionEnv() in each function.
//
// This follows the same two-stage validation pattern used by Workflows:
// - Stage 1: Zod schema validates types and optionality (shared across all functions)
// - Stage 2: Business logic validates conditional requirements (per-function)
//
// See: workflows/src/shared/config/validate-config.ts
// See: documentation/infrastructure/operations/configuration/ENVIRONMENT_VARIABLES.md

/**
 * Result of Stage 2 business logic validation
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate environment for email-sending functions (invite-user, resend-invitation).
 * Stage 2 check: Requires RESEND_API_KEY when sending emails.
 *
 * @param env - Validated environment from Stage 1
 * @param functionName - Name of the function for error messages
 * @returns Validation result with any errors
 *
 * @example
 * ```typescript
 * const emailValidation = validateEmailFunctionEnv(env, 'invite-user');
 * if (!emailValidation.valid) {
 *   return createEnvErrorResponse(FUNCTION_NAME, DEPLOY_VERSION,
 *     emailValidation.errors.join('; '), corsHeaders);
 * }
 * ```
 */
export function validateEmailFunctionEnv(
  env: EdgeFunctionEnv,
  functionName: string
): ValidationResult {
  const errors: string[] = [];

  if (!env.RESEND_API_KEY) {
    errors.push(
      `RESEND_API_KEY is required for ${functionName}. ` +
      'Set it via: supabase secrets set RESEND_API_KEY=re_YOUR_KEY'
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate environment for admin functions (require service role key).
 * Stage 2 check: Requires SUPABASE_SERVICE_ROLE_KEY.
 *
 * @param env - Validated environment from Stage 1
 * @param functionName - Name of the function for error messages
 * @returns Validation result with any errors
 *
 * @example
 * ```typescript
 * const adminValidation = validateAdminFunctionEnv(env, 'invite-user');
 * if (!adminValidation.valid) {
 *   return createEnvErrorResponse(FUNCTION_NAME, DEPLOY_VERSION,
 *     adminValidation.errors.join('; '), corsHeaders);
 * }
 * ```
 */
export function validateAdminFunctionEnv(
  env: EdgeFunctionEnv,
  functionName: string
): ValidationResult {
  const errors: string[] = [];

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    errors.push(
      `SUPABASE_SERVICE_ROLE_KEY is required for ${functionName}. ` +
      'This should be auto-injected by Supabase.'
    );
  }

  return { valid: errors.length === 0, errors };
}
