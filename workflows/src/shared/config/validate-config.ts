/**
 * Configuration Validation
 *
 * Validates environment configuration on worker startup.
 * Prevents invalid provider combinations and missing credentials.
 *
 * Design Philosophy:
 * - ONE primary variable (WORKFLOW_MODE) controls defaults
 * - Optional provider overrides for advanced testing
 * - Clear error messages guide developers to fix issues
 * - Prevents runtime failures due to misconfiguration
 */

export type WorkflowMode = 'mock' | 'development' | 'production';
export type ProviderType = 'cloudflare' | 'mock' | 'logging' | 'auto';
export type EmailProviderType = 'resend' | 'smtp' | 'mock' | 'logging' | 'auto';

interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateConfiguration(): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Required environment variables (always needed)
  const required = [
    'TEMPORAL_ADDRESS',
    'TEMPORAL_NAMESPACE',
    'TEMPORAL_TASK_QUEUE',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];

  for (const envVar of required) {
    if (!process.env[envVar]) {
      errors.push(`Missing required environment variable: ${envVar}`);
    }
  }

  // 2. Validate WORKFLOW_MODE
  const mode = (process.env.WORKFLOW_MODE || 'development') as WorkflowMode;
  const validModes: WorkflowMode[] = ['mock', 'development', 'production'];

  if (!validModes.includes(mode)) {
    errors.push(
      `Invalid WORKFLOW_MODE: ${mode}. Valid options: ${validModes.join(', ')}`
    );
  }

  // 3. Validate DNS_PROVIDER (if specified)
  const dnsProvider = process.env.DNS_PROVIDER as ProviderType | undefined;
  if (dnsProvider) {
    const validDnsProviders: ProviderType[] = ['cloudflare', 'mock', 'logging', 'auto'];
    if (!validDnsProviders.includes(dnsProvider)) {
      errors.push(
        `Invalid DNS_PROVIDER: ${dnsProvider}. Valid options: ${validDnsProviders.join(', ')}`
      );
    }

    // Validate credentials if using cloudflare
    if (dnsProvider === 'cloudflare' && !process.env.CLOUDFLARE_API_TOKEN) {
      errors.push(
        'DNS_PROVIDER=cloudflare requires CLOUDFLARE_API_TOKEN. ' +
        'Either set the token or use DNS_PROVIDER=logging for development.'
      );
    }
  }

  // 4. Validate EMAIL_PROVIDER (if specified)
  const emailProvider = process.env.EMAIL_PROVIDER as EmailProviderType | undefined;
  if (emailProvider) {
    const validEmailProviders: EmailProviderType[] = ['resend', 'smtp', 'mock', 'logging', 'auto'];
    if (!validEmailProviders.includes(emailProvider)) {
      errors.push(
        `Invalid EMAIL_PROVIDER: ${emailProvider}. Valid options: ${validEmailProviders.join(', ')}`
      );
    }

    // Validate credentials if using resend
    if (emailProvider === 'resend' && !process.env.RESEND_API_KEY) {
      errors.push(
        'EMAIL_PROVIDER=resend requires RESEND_API_KEY. ' +
        'Either set the key or use EMAIL_PROVIDER=logging for development.'
      );
    }

    // Validate credentials if using smtp
    if (emailProvider === 'smtp') {
      const smtpRequired = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
      const missing = smtpRequired.filter(v => !process.env[v]);
      if (missing.length > 0) {
        errors.push(
          `EMAIL_PROVIDER=smtp requires: ${missing.join(', ')}. ` +
          'Either set these variables or use EMAIL_PROVIDER=logging for development.'
        );
      }
    }
  }

  // 5. Production mode validation (more strict)
  if (mode === 'production') {
    // Determine final providers (with auto-selection)
    const finalDnsProvider = dnsProvider || 'cloudflare';
    const finalEmailProvider = emailProvider || 'resend';

    // Check DNS credentials
    if (finalDnsProvider === 'cloudflare' && !process.env.CLOUDFLARE_API_TOKEN) {
      errors.push(
        'Production mode requires CLOUDFLARE_API_TOKEN for DNS. ' +
        'Options: (1) Set CLOUDFLARE_API_TOKEN, or (2) Override with DNS_PROVIDER=mock for testing.'
      );
    }

    // Check email credentials
    if (finalEmailProvider === 'resend' && !process.env.RESEND_API_KEY) {
      if (!process.env.SMTP_HOST) {
        errors.push(
          'Production mode requires email configuration. ' +
          'Options: (1) Set RESEND_API_KEY, (2) Set SMTP_HOST/USER/PASS, or (3) Override with EMAIL_PROVIDER=mock for testing.'
        );
      }
    } else if (finalEmailProvider === 'smtp' && !process.env.SMTP_HOST) {
      errors.push(
        'Production mode with EMAIL_PROVIDER=smtp requires SMTP_HOST, SMTP_USER, SMTP_PASS'
      );
    }
  }

  // 6. Warnings for suspicious configurations
  if (mode === 'production' && process.env.TAG_DEV_ENTITIES === 'true') {
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

  if (process.env.AUTO_CLEANUP === 'true' && mode === 'production') {
    warnings.push(
      'AUTO_CLEANUP=true in production mode. ' +
      'Organizations will be automatically deleted after workflow completes! ' +
      'Set AUTO_CLEANUP=false for production.'
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
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
  } else {
    console.log('❌ Configuration has errors:\n');
    result.errors.forEach(err => console.log(`   • ${err}`));
  }

  if (result.warnings.length > 0) {
    console.log('\n⚠️  Warnings:\n');
    result.warnings.forEach(warn => console.log(`   • ${warn}`));
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
  const mode = (process.env.WORKFLOW_MODE || 'development') as WorkflowMode;
  const dnsOverride = process.env.DNS_PROVIDER as ProviderType | undefined;
  const emailOverride = process.env.EMAIL_PROVIDER as EmailProviderType | undefined;

  // Auto-select based on mode if not overridden
  let dnsProvider: ProviderType;
  if (dnsOverride && dnsOverride !== 'auto') {
    dnsProvider = dnsOverride;
  } else {
    switch (mode) {
      case 'mock': dnsProvider = 'mock'; break;
      case 'development': dnsProvider = 'logging'; break;
      case 'production': dnsProvider = 'cloudflare'; break;
      default: dnsProvider = 'logging';
    }
  }

  let emailProvider: EmailProviderType;
  if (emailOverride && emailOverride !== 'auto') {
    emailProvider = emailOverride;
  } else {
    switch (mode) {
      case 'mock': emailProvider = 'mock'; break;
      case 'development': emailProvider = 'logging'; break;
      case 'production': emailProvider = 'resend'; break;
      default: emailProvider = 'logging';
    }
  }

  return {
    dnsProvider,
    emailProvider,
    workflowMode: mode
  };
}
