/**
 * Mock Invitation Service Implementation
 *
 * Development-only invitation service that simulates invitation validation and acceptance.
 * Uses localStorage to persist invitation state and simulate async operations.
 *
 * Features:
 * - Simulates token validation with realistic delays
 * - Generates mock invitation details
 * - Simulates user account creation
 * - Persists invitation state to localStorage
 * - No external dependencies required
 *
 * Storage Keys:
 * - 'mock_invitations': Map<token, InvitationData>
 * - 'mock_accepted_invitations': Set<token>
 */

import type { IInvitationService } from './IInvitationService';
import type {
  InvitationDetails,
  UserCredentials,
  AcceptInvitationResult
} from '@/types/organization.types';

/**
 * Storage keys for mock invitation persistence
 */
const STORAGE_KEYS = {
  INVITATIONS: 'mock_invitations',
  ACCEPTED: 'mock_accepted_invitations'
} as const;

/**
 * Mock invitation data structure
 */
interface MockInvitationData {
  token: string;
  orgName: string;
  orgId: string;
  role: string;
  inviterName: string;
  expiresAt: Date;
  email?: string;
}

/**
 * Mock invitation service for development mode
 *
 * Simulates invitation flow using localStorage.
 * NO database writes - all operations are simulated.
 */
export class MockInvitationService implements IInvitationService {
  /**
   * Validate invitation token and get details
   *
   * Simulates async token validation with delay.
   * Generates realistic mock data if token not in storage.
   *
   * @param token - Invitation token from URL
   * @returns Invitation details
   * @throws Error if token is invalid or expired
   */
  async validateInvitation(token: string): Promise<InvitationDetails> {
    // Simulate network delay
    await this.delay(300);

    // Check if token was accepted
    const accepted = this.getAcceptedInvitations();
    if (accepted.has(token)) {
      throw new Error('Invitation already accepted');
    }

    // Get or generate invitation data
    const invitation = this.getOrCreateInvitation(token);

    // Check expiration
    const now = new Date();
    if (new Date(invitation.expiresAt) < now) {
      throw new Error('Invitation has expired');
    }

    return {
      orgName: invitation.orgName,
      role: invitation.role,
      inviterName: invitation.inviterName,
      expiresAt: new Date(invitation.expiresAt),
      email: invitation.email
    };
  }

  /**
   * Accept invitation and create user account
   *
   * Simulates user creation flow:
   * 1. Validate token
   * 2. Simulate user account creation
   * 3. Mark invitation as accepted
   * 4. Return redirect URL
   *
   * @param token - Invitation token
   * @param credentials - User credentials
   * @returns Acceptance result with redirect URL
   * @throws Error if invitation invalid or already accepted
   */
  async acceptInvitation(
    token: string,
    credentials: UserCredentials
  ): Promise<AcceptInvitationResult> {
    // Validate invitation first
    const invitation = await this.validateInvitation(token);

    // Simulate user creation delay
    await this.delay(1000);

    // Get full invitation data
    const invitationData = this.getOrCreateInvitation(token);

    // Generate mock user ID
    const userId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Mark invitation as accepted
    this.markInvitationAccepted(token);

    // Determine redirect URL based on role
    const redirectUrl = this.getRedirectUrlForRole(invitation.role);

    return {
      userId,
      orgId: invitationData.orgId,
      redirectUrl
    };
  }

  /**
   * Resend invitation email
   *
   * Simulates email resend operation.
   *
   * @param invitationId - Invitation identifier
   * @returns True if successful
   */
  async resendInvitation(invitationId: string): Promise<boolean> {
    // Simulate email sending delay
    await this.delay(500);

    // In mock mode, always succeed
    return true;
  }

  /**
   * Get or create mock invitation data
   */
  private getOrCreateInvitation(token: string): MockInvitationData {
    const invitations = this.loadInvitations();

    let invitation = invitations.get(token);

    if (!invitation) {
      // Generate realistic mock data
      invitation = {
        token,
        orgName: 'Demo Organization',
        orgId: `org-${Date.now()}`,
        role: 'provider_admin',
        inviterName: 'System Administrator',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        email: `user-${Date.now()}@example.com`
      };

      invitations.set(token, invitation);
      this.saveInvitations(invitations);
    }

    return invitation;
  }

  /**
   * Load invitations from localStorage
   */
  private loadInvitations(): Map<string, MockInvitationData> {
    const json = localStorage.getItem(STORAGE_KEYS.INVITATIONS);
    if (!json) {
      return new Map();
    }

    try {
      const data = JSON.parse(json);
      return new Map(Object.entries(data));
    } catch {
      return new Map();
    }
  }

  /**
   * Save invitations to localStorage
   */
  private saveInvitations(invitations: Map<string, MockInvitationData>): void {
    const obj = Object.fromEntries(invitations);
    localStorage.setItem(STORAGE_KEYS.INVITATIONS, JSON.stringify(obj));
  }

  /**
   * Get accepted invitations set
   */
  private getAcceptedInvitations(): Set<string> {
    const json = localStorage.getItem(STORAGE_KEYS.ACCEPTED);
    if (!json) {
      return new Set();
    }

    try {
      return new Set(JSON.parse(json));
    } catch {
      return new Set();
    }
  }

  /**
   * Mark invitation as accepted
   */
  private markInvitationAccepted(token: string): void {
    const accepted = this.getAcceptedInvitations();
    accepted.add(token);
    localStorage.setItem(
      STORAGE_KEYS.ACCEPTED,
      JSON.stringify(Array.from(accepted))
    );
  }

  /**
   * Get redirect URL based on user role
   */
  private getRedirectUrlForRole(role: string): string {
    const roleRedirects: Record<string, string> = {
      provider_admin: '/organizations/dashboard',
      organization_member: '/clients',
      clinician: '/clients',
      viewer: '/dashboard'
    };

    return roleRedirects[role] || '/dashboard';
  }

  /**
   * Delay utility for simulating async operations
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
