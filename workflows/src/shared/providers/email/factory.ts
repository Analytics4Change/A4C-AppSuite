/**
 * Email Provider Factory
 *
 * Creates appropriate email provider based on environment configuration.
 * Validates credentials and ensures configuration consistency.
 *
 * Provider Selection Logic:
 * 1. Check EMAIL_PROVIDER override
 * 2. If not set or 'auto', use WORKFLOW_MODE defaults:
 *    - mock → MockEmailProvider
 *    - development → LoggingEmailProvider
 *    - production → ResendEmailProvider (if RESEND_API_KEY set)
 *    - production → SMTPEmailProvider (if SMTP_HOST set)
 * 3. Validate required credentials
 *
 * Usage:
 * ```typescript
 * const emailProvider = createEmailProvider();
 * await emailProvider.sendEmail({
 *   from: 'noreply@firstovertheline.com',
 *   to: 'user@example.com',
 *   subject: 'Welcome',
 *   html: '<h1>Welcome!</h1>'
 * });
 * ```
 */

import type { IEmailProvider } from '../../types';
import type { EmailProviderType, WorkflowMode } from '../../config/validate-config';
import { ResendEmailProvider } from './resend-provider';
import { SMTPEmailProvider } from './smtp-provider';
import { MockEmailProvider } from './mock-provider';
import { LoggingEmailProvider } from './logging-provider';

/**
 * Create email provider based on environment configuration
 * @returns IEmailProvider instance
 * @throws Error if invalid configuration
 */
export function createEmailProvider(): IEmailProvider {
  const mode = (process.env.WORKFLOW_MODE || 'development') as WorkflowMode;
  const emailProviderOverride = process.env.EMAIL_PROVIDER as EmailProviderType | undefined;

  // Determine provider type
  let providerType: EmailProviderType;

  if (emailProviderOverride && emailProviderOverride !== 'auto') {
    // Use explicit override
    providerType = emailProviderOverride;
  } else {
    // Auto-select based on mode
    switch (mode) {
      case 'mock':
        providerType = 'mock';
        break;
      case 'development':
        providerType = 'logging';
        break;
      case 'production':
        // Prefer Resend, fallback to SMTP
        if (process.env.RESEND_API_KEY) {
          providerType = 'resend';
        } else if (process.env.SMTP_HOST) {
          providerType = 'smtp';
        } else {
          providerType = 'resend'; // Will fail with clear error message
        }
        break;
      default:
        providerType = 'logging';
    }
  }

  // Log provider selection
  console.log(`\n[Email Provider Factory]`);
  console.log(`  Mode: ${mode}`);
  if (emailProviderOverride) {
    console.log(`  Override: ${emailProviderOverride}`);
  }
  console.log(`  Selected: ${providerType}Provider\n`);

  // Create provider
  switch (providerType) {
    case 'resend':
      return createResendProvider();

    case 'smtp':
      return createSMTPProvider();

    case 'mock':
      return new MockEmailProvider();

    case 'logging':
      return new LoggingEmailProvider();

    default: {
      // Exhaustive check - providerType is never here
      const _exhaustive: never = providerType;
      throw new Error(
        `Invalid EMAIL_PROVIDER: ${String(_exhaustive)}. ` +
        `Valid options: resend, smtp, mock, logging, auto`
      );
    }
  }
}

/**
 * Create Resend provider with credential validation
 */
function createResendProvider(): ResendEmailProvider {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error(
      'Resend email provider requires RESEND_API_KEY.\n' +
      '\n' +
      'Options:\n' +
      '1. Set RESEND_API_KEY environment variable\n' +
      '2. Use EMAIL_PROVIDER=smtp (with SMTP_HOST, SMTP_USER, SMTP_PASS)\n' +
      '3. Use EMAIL_PROVIDER=logging for development (console logging)\n' +
      '4. Use EMAIL_PROVIDER=mock for testing (in-memory)\n' +
      '\n' +
      'Get API key: https://resend.com/api-keys'
    );
  }

  return new ResendEmailProvider();
}

/**
 * Create SMTP provider with credential validation
 */
function createSMTPProvider(): SMTPEmailProvider {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      'SMTP email provider requires SMTP_HOST, SMTP_USER, and SMTP_PASS.\n' +
      '\n' +
      'Options:\n' +
      '1. Set SMTP_HOST, SMTP_USER, SMTP_PASS environment variables\n' +
      '2. Use EMAIL_PROVIDER=resend (with RESEND_API_KEY)\n' +
      '3. Use EMAIL_PROVIDER=logging for development (console logging)\n' +
      '4. Use EMAIL_PROVIDER=mock for testing (in-memory)\n' +
      '\n' +
      'Example SMTP configuration:\n' +
      '  SMTP_HOST=smtp.gmail.com\n' +
      '  SMTP_PORT=587\n' +
      '  SMTP_USER=your-email@gmail.com\n' +
      '  SMTP_PASS=your-app-password'
    );
  }

  return new SMTPEmailProvider();
}

/**
 * Get email provider type (for logging/debugging)
 */
export function getEmailProviderType(): EmailProviderType {
  const mode = (process.env.WORKFLOW_MODE || 'development') as WorkflowMode;
  const emailProviderOverride = process.env.EMAIL_PROVIDER as EmailProviderType | undefined;

  if (emailProviderOverride && emailProviderOverride !== 'auto') {
    return emailProviderOverride;
  }

  switch (mode) {
    case 'mock': return 'mock';
    case 'development': return 'logging';
    case 'production':
      if (process.env.RESEND_API_KEY) return 'resend';
      if (process.env.SMTP_HOST) return 'smtp';
      return 'resend'; // Default (will error if no credentials)
    default: return 'logging';
  }
}
