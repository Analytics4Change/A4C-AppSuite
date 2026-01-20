/**
 * Logging Email Provider (Local Development)
 *
 * Console-logging email provider for local development.
 * Logs all email operations to console without sending real emails.
 *
 * Use Case:
 * - Local development (WORKFLOW_MODE=development)
 * - Debugging workflow logic
 * - Viewing email content that would be sent
 * - No real emails sent
 *
 * Features:
 * - Detailed console output with colors
 * - Shows full email content (from, to, subject, body)
 * - Simulates API responses
 * - No network calls
 */

import type { IEmailProvider, EmailParams, EmailResult } from '../../types';

export class LoggingEmailProvider implements IEmailProvider {
  private messageIdCounter = 1;

  /**
   * Send an email (simulated with console logging)
   * @param params - Email parameters
   * @returns Simulated email result
   */
  sendEmail(params: EmailParams): Promise<EmailResult> {
    const messageId = `simulated_${this.messageIdCounter++}_${Date.now()}`;

    console.log('\n' + '='.repeat(60));
    console.log('📧 Email Provider: sendEmail()');
    console.log('='.repeat(60));
    console.log('\nEmail Details:');
    console.log(`   From: ${params.from}`);
    console.log(`   To: ${params.to}`);
    console.log(`   Subject: ${params.subject}`);
    console.log('\nMode: LOGGING (no real email sent)');

    console.log('\n--- Email Body (HTML) ---');
    if (params.html) {
      // Show first 300 characters of HTML
      const preview = params.html.length > 300
        ? params.html.substring(0, 300) + '...'
        : params.html;
      console.log(preview);
    } else {
      console.log('(No HTML body)');
    }

    if (params.text) {
      console.log('\n--- Email Body (Text) ---');
      const preview = params.text.length > 300
        ? params.text.substring(0, 300) + '...'
        : params.text;
      console.log(preview);
    }

    console.log('\n--- End of Email ---');

    console.log(`\n✅ Email would be sent`);
    console.log(`   Message ID: ${messageId}`);
    console.log('\n💡 In production mode, this would send a real email via Resend or SMTP');
    console.log('='.repeat(60) + '\n');

    return Promise.resolve({
      messageId,
      accepted: [params.to],
      rejected: []
    });
  }

  /**
   * Verify connection (always succeeds)
   * @returns true
   */
  verifyConnection(): Promise<boolean> {
    console.log('\n[Email Provider] Connection verification (logging mode - always succeeds)\n');
    return Promise.resolve(true);
  }
}
