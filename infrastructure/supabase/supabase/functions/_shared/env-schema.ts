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
import { z } from 'zod';

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
