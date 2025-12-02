/**
 * Environment Variable Schema - Workflows Component
 *
 * Zod schema for all environment variables used by the Temporal worker.
 * All env vars are validated through Zod .parse() at worker startup.
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
// Enum Schemas
// =============================================================================

export const workflowModeSchema = z.enum(['mock', 'development', 'production']);
export const dnsProviderSchema = z.enum(['cloudflare', 'mock', 'logging', 'auto']);
export const emailProviderSchema = z.enum(['resend', 'smtp', 'mock', 'logging', 'auto']);

// =============================================================================
// Workflows Environment Schema
// =============================================================================

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
// Inferred Types
// =============================================================================

export type WorkflowsEnv = z.infer<typeof workflowsEnvSchema>;
export type WorkflowMode = z.infer<typeof workflowModeSchema>;
export type DNSProvider = z.infer<typeof dnsProviderSchema>;
export type EmailProvider = z.infer<typeof emailProviderSchema>;

// =============================================================================
// Validation Function
// =============================================================================

let validatedEnv: WorkflowsEnv | null = null;

/**
 * Validate environment variables at startup.
 * Throws immediately if required variables are undefined.
 *
 * Call this ONCE at worker startup after dotenv is loaded.
 */
export function validateWorkflowsEnv(): WorkflowsEnv {
  if (validatedEnv) {
    return validatedEnv;
  }

  const result = workflowsEnvSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    const errorMessage = `
╔══════════════════════════════════════════════════════════════════╗
║              ENVIRONMENT VALIDATION FAILED                        ║
╠══════════════════════════════════════════════════════════════════╣
║ Component: Temporal Worker                                        ║
╠══════════════════════════════════════════════════════════════════╣
${errors}
╠══════════════════════════════════════════════════════════════════╣
║ Fix: Check your .env.local file or Kubernetes ConfigMap/Secret    ║
╚══════════════════════════════════════════════════════════════════╝
`;

    console.error(errorMessage);
    throw new Error(`Environment validation failed:\n${errors}`);
  }

  validatedEnv = result.data;
  return validatedEnv;
}

/**
 * Get validated environment (throws if not yet validated)
 */
export function getWorkflowsEnv(): WorkflowsEnv {
  if (!validatedEnv) {
    return validateWorkflowsEnv();
  }
  return validatedEnv;
}

/**
 * Reset validated env (for testing)
 */
export function resetValidatedEnv(): void {
  validatedEnv = null;
}
