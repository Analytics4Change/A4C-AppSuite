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

  // === Backend API ===
  BACKEND_API_URL: z.string().url().default('https://api-a4c.firstovertheline.com'),

  // === Deployment tracking ===
  GIT_COMMIT_SHA: z.string().optional(),
});

// =============================================================================
// Inferred Type
// =============================================================================

export type EdgeFunctionEnv = z.infer<typeof edgeFunctionEnvSchema>;

// =============================================================================
// Validation Function
// =============================================================================

/**
 * Validate Edge Function environment variables.
 * Throws immediately if required variables are undefined.
 *
 * Call this at the start of your Edge Function handler.
 *
 * @param functionName - Name of the function for error messages
 * @returns Validated and typed environment object
 * @throws Error if validation fails
 */
export function validateEdgeFunctionEnv(functionName: string): EdgeFunctionEnv {
  // Build env object from Deno.env.get()
  const rawEnv = {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    BACKEND_API_URL: Deno.env.get('BACKEND_API_URL'),
    GIT_COMMIT_SHA: Deno.env.get('GIT_COMMIT_SHA'),
  };

  const result = edgeFunctionEnvSchema.safeParse(rawEnv);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    const errorMessage = `[${functionName}] Environment validation failed:\n${errors}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }

  return result.data;
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
