/**
 * SMTP Email Provider (Production - Alternative)
 *
 * Traditional SMTP email provider using nodemailer.
 * Works with any SMTP server (Gmail, SendGrid, AWS SES, etc.)
 *
 * Requirements:
 * - SMTP_HOST environment variable (e.g., smtp.gmail.com)
 * - SMTP_PORT environment variable (default: 587)
 * - SMTP_USER environment variable
 * - SMTP_PASS environment variable
 *
 * Use Cases:
 * - Organizations with existing SMTP infrastructure
 * - Self-hosted email servers
 * - Gmail, Outlook, or other SMTP services
 *
 * Note: Resend is recommended for new deployments
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { IEmailProvider, EmailParams, EmailResult } from '../../types';

export class SMTPEmailProvider implements IEmailProvider {
  private transporter: Transporter;

  constructor() {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      throw new Error(
        'SMTPEmailProvider requires SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables.\n' +
        '\n' +
        'Example configuration:\n' +
        '  SMTP_HOST=smtp.gmail.com\n' +
        '  SMTP_PORT=587\n' +
        '  SMTP_USER=your-email@gmail.com\n' +
        '  SMTP_PASS=your-app-password\n' +
        '\n' +
        'For Gmail, use app-specific password: https://myaccount.google.com/apppasswords'
      );
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // true for 465, false for other ports
      auth: {
        user,
        pass
      }
    });
  }

  /**
   * Send an email via SMTP
   * @param params - Email parameters (from, to, subject, html, text)
   * @returns Email result with message ID
   */
  async sendEmail(params: EmailParams): Promise<EmailResult> {
    try {
      const info = await this.transporter.sendMail({
        from: params.from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text
      });

      return {
        messageId: info.messageId,
        accepted: info.accepted as string[],
        rejected: info.rejected as string[]
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to send email via SMTP: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Verify SMTP connection
   * @returns true if connection successful
   */
  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }
}
