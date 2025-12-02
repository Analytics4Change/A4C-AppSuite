/**
 * Configuration Validation
 *
 * Validates environment configuration on worker startup.
 * Uses Zod for schema validation, plus additional business logic checks.
 *
 * Design Philosophy:
 * - Zod validates types and required fields FIRST (fail-fast)
 * - Business logic validates provider combinations SECOND
 * - Clear error messages guide developers to fix issues
 * - Prevents runtime failures due to misconfiguration
 */
import {
  validateWorkflowsEnv,
  getWorkflowsEnv,
  type WorkflowsEnv,
  type WorkflowMode,
  type DNSProvider,
  type EmailProvider,
} from './env-schema';

// Re-export types for backward compatibility
export type { WorkflowMode };
export type ProviderType = DNSProvider;
export type EmailProviderType = EmailProvider;

interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate business logic (provider combinations, credentials)
 * Called AFTER Zod schema validation
 */
function validateBusinessLogic(env: WorkflowsEnv): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const mode = env.WORKFLOW_MODE;
  const dnsProvider = env.DNS_PROVIDER;
  const emailProvider = env.EMAIL_PROVIDER;

  // 1. Validate DNS credentials if using cloudflare
  if (dnsProvider === 'cloudflare' && !env.CLOUDFLARE_API_TOKEN) {
    errors.push(
      'DNS_PROVIDER=cloudflare requires CLOUDFLARE_API_TOKEN. ' +
        'Either set the token or use DNS_PROVIDER=logging for development.'
    );
  }

  // 2. Validate Email credentials
  if (emailProvider === 'resend' && !env.RESEND_API_KEY) {
    errors.push(
      'EMAIL_PROVIDER=resend requires RESEND_API_KEY. ' +
        'Either set the key or use EMAIL_PROVIDER=logging for development.'
    );
  }

  if (emailProvider === 'smtp') {
    const smtpMissing: string[] = [];
    if (!env.SMTP_HOST) smtpMissing.push('SMTP_HOST');
    if (!env.SMTP_USER) smtpMissing.push('SMTP_USER');
    if (!env.SMTP_PASS) smtpMissing.push('SMTP_PASS');
    if (smtpMissing.length > 0) {
      errors.push(
        `EMAIL_PROVIDER=smtp requires: ${smtpMissing.join(', ')}. ` +
          'Either set these variables or use EMAIL_PROVIDER=logging for development.'
      );
    }
  }

  // 3. Production mode validation (more strict)
  if (mode === 'production') {
    // Determine final providers (with auto-selection)
    const finalDnsProvider = dnsProvider || 'cloudflare';
    const finalEmailProvider = emailProvider || 'resend';

    // Check DNS credentials
    if (finalDnsProvider === 'cloudflare' && !env.CLOUDFLARE_API_TOKEN) {
      errors.push(
        'Production mode requires CLOUDFLARE_API_TOKEN for DNS. ' +
          'Options: (1) Set CLOUDFLARE_API_TOKEN, or (2) Override with DNS_PROVIDER=mock for testing.'
      );
    }

    // Check email credentials
    if (finalEmailProvider === 'resend' && !env.RESEND_API_KEY) {
      if (!env.SMTP_HOST) {
        errors.push(
          'Production mode requires email configuration. ' +
            'Options: (1) Set RESEND_API_KEY, (2) Set SMTP_HOST/USER/PASS, or (3) Override with EMAIL_PROVIDER=mock for testing.'
        );
      }
    } else if (finalEmailProvider === 'smtp' && !env.SMTP_HOST) {
      errors.push(
        'Production mode with EMAIL_PROVIDER=smtp requires SMTP_HOST, SMTP_USER, SMTP_PASS'
      );
    }
  }

  // 4. Warnings for suspicious configurations
  if (mode === 'production' && env.TAG_DEV_ENTITIES) {
    warnings.push(
      'TAG_DEV_ENTITIES=true in production mode. ' +
        'Production entities will be tagged as development! ' +
        'Set TAG_DEV_ENTITIES=false for production.'
    );
  }

  if (mode === 'development' && dnsProvider === 'cloudflare' && !emailProvider) {
    warnings.push(
      'DNS_PROVIDER=cloudflare but EMAIL_PROVIDER not set. ' +
        'Will use logging email provider (no real emails sent).'
    );
  }

  if (mode === 'development' && emailProvider === 'resend' && !dnsProvider) {
    warnings.push(
      'EMAIL_PROVIDER=resend but DNS_PROVIDER not set. ' +
        'Will use logging DNS provider (no real DNS records created).'
    );
  }

  if (env.AUTO_CLEANUP && mode === 'production') {
    warnings.push(
      'AUTO_CLEANUP=true in production mode. ' +
        'Organizations will be automatically deleted after workflow completes! ' +
        'Set AUTO_CLEANUP=false for production.'
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Full configuration validation:
 * 1. Zod schema validation (types, required fields)
 * 2. Business logic validation (provider combinations, credentials)
 */
export function validateConfiguration(): ConfigValidationResult {
  try {
    // Step 1: Zod validation (throws on failure)
    const env = validateWorkflowsEnv();

    // Step 2: Business logic validation
    return validateBusinessLogic(env);
  } catch (error) {
    // Zod validation failed - extract error messages
    if (error instanceof Error) {
      return {
        valid: false,
        errors: [error.message],
        warnings: [],
      };
    }
    return {
      valid: false,
      errors: ['Unknown configuration error'],
      warnings: [],
    };
  }
}

/**
 * Log configuration validation results and throw on errors
 */
export function logConfigurationStatus(): void {
  const result = validateConfiguration();

  console.log('\n' + '='.repeat(60));
  console.log('Configuration Validation');
  console.log('='.repeat(60));

  if (result.valid) {
    console.log('✅ Configuration is valid');

    // Log resolved configuration
    const env = getWorkflowsEnv();
    const resolved = getResolvedProviders();
    console.log('\nResolved Configuration:');
    console.log(`  Workflow Mode: ${env.WORKFLOW_MODE}`);
    console.log(`  DNS Provider: ${resolved.dnsProvider}`);
    console.log(`  Email Provider: ${resolved.emailProvider}`);
  } else {
    console.log('❌ Configuration has errors:\n');
    result.errors.forEach((err) => console.log(`   • ${err}`));
  }

  if (result.warnings.length > 0) {
    console.log('\n⚠️  Warnings:\n');
    result.warnings.forEach((warn) => console.log(`   • ${warn}`));
  }

  console.log('='.repeat(60) + '\n');

  if (!result.valid) {
    throw new Error(
      'Invalid configuration. Please fix the errors above and restart the worker.'
    );
  }
}

/**
 * Get resolved provider names (after auto-selection)
 */
export function getResolvedProviders(): {
  dnsProvider: ProviderType;
  emailProvider: EmailProviderType;
  workflowMode: WorkflowMode;
} {
  const env = getWorkflowsEnv();
  const mode = env.WORKFLOW_MODE;
  const dnsOverride = env.DNS_PROVIDER;
  const emailOverride = env.EMAIL_PROVIDER;

  // Auto-select based on mode if not overridden
  let dnsProvider: ProviderType;
  if (dnsOverride && dnsOverride !== 'auto') {
    dnsProvider = dnsOverride;
  } else {
    switch (mode) {
      case 'mock':
        dnsProvider = 'mock';
        break;
      case 'development':
        dnsProvider = 'logging';
        break;
      case 'production':
        dnsProvider = 'cloudflare';
        break;
      default:
        dnsProvider = 'logging';
    }
  }

  let emailProvider: EmailProviderType;
  if (emailOverride && emailOverride !== 'auto') {
    emailProvider = emailOverride;
  } else {
    switch (mode) {
      case 'mock':
        emailProvider = 'mock';
        break;
      case 'development':
        emailProvider = 'logging';
        break;
      case 'production':
        emailProvider = 'resend';
        break;
      default:
        emailProvider = 'logging';
    }
  }

  return {
    dnsProvider,
    emailProvider,
    workflowMode: mode,
  };
}
