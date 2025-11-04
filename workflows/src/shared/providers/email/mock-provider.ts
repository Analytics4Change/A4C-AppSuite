/**
 * Mock Email Provider (Unit Testing)
 *
 * In-memory email provider for unit tests and CI/CD pipelines.
 * All operations are local, no network calls, no console output.
 *
 * Use Case:
 * - Unit tests
 * - CI/CD pipelines
 * - Fast test execution
 * - Workflow replay testing
 *
 * Features:
 * - In-memory storage (cleared on restart)
 * - Deterministic behavior
 * - No side effects
 * - Instant response times
 * - Inspection methods for test assertions
 */

import type { IEmailProvider, EmailParams, EmailResult } from '../../types';

interface SentEmail extends EmailParams {
  messageId: string;
  sentAt: Date;
}

export class MockEmailProvider implements IEmailProvider {
  private sentEmails: SentEmail[] = [];
  private messageIdCounter = 1;

  /**
   * Send an email (simulated)
   * @param params - Email parameters
   * @returns Simulated email result
   */
  async sendEmail(params: EmailParams): Promise<EmailResult> {
    const messageId = `mock_${this.messageIdCounter++}_${Date.now()}`;

    // Store email in memory
    this.sentEmails.push({
      ...params,
      messageId,
      sentAt: new Date()
    });

    return {
      messageId,
      accepted: [params.to],
      rejected: []
    };
  }

  /**
   * Verify connection (always succeeds)
   * @returns true
   */
  async verifyConnection(): Promise<boolean> {
    return true;
  }

  /**
   * Get all sent emails (for test assertions)
   * @returns Array of sent emails
   */
  getSentEmails(): SentEmail[] {
    return [...this.sentEmails];
  }

  /**
   * Get sent email by recipient
   * @param to - Recipient email address
   * @returns Sent email or undefined
   */
  getSentEmail(to: string): SentEmail | undefined {
    return this.sentEmails.find(email => email.to === to);
  }

  /**
   * Get sent emails by subject
   * @param subject - Email subject (partial match)
   * @returns Array of matching emails
   */
  getSentEmailsBySubject(subject: string): SentEmail[] {
    return this.sentEmails.filter(email =>
      email.subject.toLowerCase().includes(subject.toLowerCase())
    );
  }

  /**
   * Clear all sent emails (for test cleanup)
   */
  reset(): void {
    this.sentEmails = [];
    this.messageIdCounter = 1;
  }

  /**
   * Get count of sent emails
   * @returns Number of sent emails
   */
  getEmailCount(): number {
    return this.sentEmails.length;
  }
}
