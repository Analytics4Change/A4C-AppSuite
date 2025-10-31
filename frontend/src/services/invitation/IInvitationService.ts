/**
 * Invitation Service Interface
 *
 * Abstracts user invitation operations to enable dependency injection.
 * Handles invitation token validation and acceptance flow.
 *
 * Implementations:
 * - MockInvitationService: localStorage-based simulation for development
 * - SupabaseInvitationService: Production implementation via Supabase Edge Functions
 *
 * Factory Selection:
 * InvitationServiceFactory reads appConfig.userCreation.useMock to select implementation.
 */

import type {
  InvitationDetails,
  UserCredentials,
  AcceptInvitationResult
} from '@/types/organization.types';

/**
 * Invitation service interface for user invitation operations
 */
export interface IInvitationService {
  /**
   * Validate invitation token and get details
   *
   * @param token - Invitation token from URL
   * @returns Invitation details including org name, role, expiration
   * @throws Error if token is invalid or expired
   *
   * Note: Token validation does not modify database
   */
  validateInvitation(token: string): Promise<InvitationDetails>;

  /**
   * Accept invitation and create user account
   *
   * Flow:
   * 1. Validate token again (security check)
   * 2. Create user account via selected auth method
   * 3. Emit UserCreated event
   * 4. Link user to organization
   * 5. Return redirect URL
   *
   * @param token - Invitation token
   * @param credentials - User credentials (email/password or OAuth)
   * @returns Result with userId, orgId, and redirect URL
   * @throws Error if invitation already accepted or credentials invalid
   *
   * Event Emission:
   * - UserCreated: Triggers PostgreSQL projection updates
   * - UserInvitationAccepted: Marks invitation as used
   *
   * IMPORTANT: NO direct database writes. All via events.
   */
  acceptInvitation(
    token: string,
    credentials: UserCredentials
  ): Promise<AcceptInvitationResult>;

  /**
   * Resend invitation email
   *
   * @param invitationId - Invitation identifier
   * @returns True if email sent successfully
   * @throws Error if invitation not found or already accepted
   */
  resendInvitation(invitationId: string): Promise<boolean>;
}
