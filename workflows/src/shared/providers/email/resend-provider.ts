/**
 * Resend Email Provider (Production - Recommended)
 *
 * Real email provider using Resend API (https://resend.com).
 * Modern, reliable email API with excellent deliverability.
 *
 * Requirements:
 * - RESEND_API_KEY environment variable
 * - Verified domain in Resend dashboard
 * - From address must use verified domain
 *
 * Advantages over SMTP:
 * - Simple API (no SMTP protocol complexity)
 * - Better deliverability
 * - Built-in analytics
 * - Generous free tier
 *
 * API Documentation: https://resend.com/docs/api-reference/emails/send-email
 */

import type { IEmailProvider, EmailParams, EmailResult } from '../../types';

interface ResendEmailPayload {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
}

interface ResendResponse {
  id: string;
  from?: string;
  to?: string[];
}

interface ResendErrorResponse {
  statusCode: number;
  message: string;
  name: string;
}

export class ResendEmailProvider implements IEmailProvider {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.resend.com';

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ResendEmailProvider requires RESEND_API_KEY environment variable. ' +
        'Get an API key at https://resend.com/api-keys'
      );
    }
    this.apiKey = apiKey;
  }

  /**
   * Send an email via Resend API
   * @param params - Email parameters (from, to, subject, html, text)
   * @returns Email result with message ID
   */
  async sendEmail(params: EmailParams): Promise<EmailResult> {
    const url = `${this.baseUrl}/emails`;

    const payload: ResendEmailPayload = {
      from: params.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json() as ResendErrorResponse;
        throw new Error(
          `Resend API error: ${errorData.statusCode} - ${errorData.message}`
        );
      }

      const data = await response.json() as ResendResponse;

      return {
        messageId: data.id,
        accepted: data.to || [params.to],
        rejected: []
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to send email via Resend: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Verify Resend API connection
   * @returns true if connection successful
   */
  async verifyConnection(): Promise<boolean> {
    try {
      // Use Resend API keys endpoint to verify
      const response = await fetch(`${this.baseUrl}/api-keys`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}
