/**
 * Invitation Acceptance ViewModel
 *
 * Manages state and business logic for accepting organization invitations.
 * Uses MobX for reactive state management and dependency injection for services.
 *
 * Features:
 * - Token validation
 * - User credential collection
 * - Account creation (email/password or OAuth)
 * - Error handling and loading states
 * - Constructor injection for testability
 *
 * Dependencies:
 * - IInvitationService: Invitation operations (MockInvitationService | SupabaseInvitationService)
 *
 * Usage:
 * ```typescript
 * const viewModel = new InvitationAcceptanceViewModel();
 * await viewModel.validateToken('invitation-token-from-url');
 * await viewModel.acceptWithEmailPassword('user@example.com', 'password');
 * ```
 */

import { makeAutoObservable, runInAction } from 'mobx';
import type { IInvitationService } from '@/services/invitation/IInvitationService';
import { InvitationServiceFactory } from '@/services/invitation/InvitationServiceFactory';
import type { IAuthProvider } from '@/services/auth/IAuthProvider';
import type {
  InvitationDetails,
  UserCredentials,
  AcceptInvitationResult
} from '@/types';
import type { OAuthProvider, InvitationAuthContext } from '@/types/auth.types';
import { getAuthContextStorage } from '@/services/storage';
import { detectPlatform, getCallbackUrl } from '@/utils/platform';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('viewmodel');

/** Storage key for invitation context during OAuth redirect */
const INVITATION_CONTEXT_KEY = 'invitation_acceptance_context';

/**
 * Authentication method selection for UI state
 */
export type AuthMethodSelection = 'email_password' | 'oauth';

/**
 * Invitation Acceptance ViewModel
 *
 * MVVM pattern with constructor injection for dependency inversion.
 * All external dependencies injected via constructor with factory defaults.
 */
export class InvitationAcceptanceViewModel {
  // Token and Invitation Details
  token: string | null = null;
  invitationDetails: InvitationDetails | null = null;

  // Validation State
  isValidatingToken = false;
  validationError: string | null = null;

  // User Credentials
  authMethodSelection: AuthMethodSelection = 'email_password';
  email = '';
  password = '';
  confirmPassword = '';

  // Acceptance State
  isAccepting = false;
  acceptanceError: string | null = null;
  acceptanceResult: AcceptInvitationResult | null = null;

  // Field Errors
  emailError: string | null = null;
  passwordError: string | null = null;
  confirmPasswordError: string | null = null;

  /**
   * Constructor with dependency injection
   *
   * @param invitationService - Invitation operations (defaults to factory-created instance)
   */
  constructor(
    private invitationService: IInvitationService = InvitationServiceFactory.create()
  ) {
    makeAutoObservable(this);
    log.debug('InvitationAcceptanceViewModel initialized');
  }

  /**
   * Validate invitation token
   *
   * Calls invitation service to validate token and get details.
   * Pre-fills email if available in invitation.
   *
   * @param token - Invitation token from URL
   * @returns True if valid, false if invalid/expired
   */
  async validateToken(token: string): Promise<boolean> {
    runInAction(() => {
      this.token = token;
      this.isValidatingToken = true;
      this.validationError = null;
    });

    try {
      const details = await this.invitationService.validateInvitation(token);

      runInAction(() => {
        this.invitationDetails = details;
        this.isValidatingToken = false;

        // Pre-fill email if available
        if (details.email) {
          this.email = details.email;
        }

        log.info('Invitation token validated', {
          orgName: details.orgName,
          role: details.role
        });
      });

      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to validate invitation';

      runInAction(() => {
        this.isValidatingToken = false;
        this.validationError = errorMessage;
      });

      log.error('Token validation failed', error);

      return false;
    }
  }

  /**
   * Set authentication method selection
   */
  setAuthMethod(method: AuthMethodSelection): void {
    runInAction(() => {
      this.authMethodSelection = method;
      this.clearFieldErrors();
    });
  }

  /**
   * Update email
   */
  setEmail(value: string): void {
    runInAction(() => {
      this.email = value;
      this.emailError = null;
    });
  }

  /**
   * Update password
   */
  setPassword(value: string): void {
    runInAction(() => {
      this.password = value;
      this.passwordError = null;
    });
  }

  /**
   * Update confirm password
   */
  setConfirmPassword(value: string): void {
    runInAction(() => {
      this.confirmPassword = value;
      this.confirmPasswordError = null;
    });
  }

  /**
   * Validate email/password credentials
   */
  validateCredentials(): boolean {
    let isValid = true;

    // Email validation
    if (!this.email.trim()) {
      this.emailError = 'Email is required';
      isValid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) {
      this.emailError = 'Invalid email format';
      isValid = false;
    }

    // Password validation (only for email/password auth)
    if (this.authMethodSelection === 'email_password') {
      if (!this.password) {
        this.passwordError = 'Password is required';
        isValid = false;
      } else if (this.password.length < 8) {
        this.passwordError = 'Password must be at least 8 characters';
        isValid = false;
      }

      // Confirm password validation
      if (this.password !== this.confirmPassword) {
        this.confirmPasswordError = 'Passwords do not match';
        isValid = false;
      }
    }

    return isValid;
  }

  /**
   * Accept invitation with email/password
   *
   * Flow:
   * 1. Validate credentials
   * 2. Call invitation service
   * 3. Service creates user account
   * 4. Service emits UserCreated event
   * 5. PostgreSQL triggers update projections
   * 6. Return redirect URL
   *
   * @returns Acceptance result or null if failed
   */
  async acceptWithEmailPassword(): Promise<AcceptInvitationResult | null> {
    if (!this.token) {
      log.error('Cannot accept invitation without token');
      return null;
    }

    // Validate credentials
    if (!this.validateCredentials()) {
      log.warn('Credential validation failed');
      return null;
    }

    return this.acceptInvitation({
      email: this.email,
      password: this.password
    });
  }

  /**
   * Accept invitation via OAuth provider.
   *
   * Stores invitation context in sessionStorage, then initiates OAuth redirect.
   * The callback (AuthCallback.tsx) will detect the context and complete acceptance.
   *
   * @param provider - OAuth provider (google, github, etc.)
   * @param authProvider - Auth provider instance for initiating OAuth
   *
   * @see documentation/architecture/authentication/oauth-invitation-acceptance.md
   */
  async acceptWithOAuth(provider: OAuthProvider, authProvider: IAuthProvider): Promise<void> {
    if (!this.token) {
      runInAction(() => {
        this.acceptanceError = 'Missing invitation token';
      });
      log.error('Cannot accept invitation without token');
      return;
    }

    // Validate email
    if (!this.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) {
      runInAction(() => {
        this.emailError = 'Valid email is required';
      });
      return;
    }

    const platform = detectPlatform();
    const storage = getAuthContextStorage();

    // Store invitation context BEFORE OAuth redirect
    const invitationContext: InvitationAuthContext = {
      token: this.token,
      email: this.email,
      flow: 'invitation_acceptance',
      authMethod: { type: 'oauth', provider },
      platform,
      createdAt: Date.now(),  // For TTL validation
    };

    try {
      await storage.setItem(INVITATION_CONTEXT_KEY, JSON.stringify(invitationContext));

      log.info('Initiating OAuth for invitation acceptance', {
        provider,
        platform,
        email: this.email,
      });

      // Initiate OAuth redirect - this will leave the page
      await authProvider.loginWithOAuth(provider, {
        redirectTo: getCallbackUrl(platform),
      });
    } catch (error) {
      log.error('Failed to initiate OAuth for invitation', error);
      runInAction(() => {
        this.acceptanceError = `Failed to initiate ${provider} sign-in. Please try again.`;
      });
    }
  }

  /**
   * @deprecated Use acceptWithOAuth() instead
   */
  async acceptWithGoogle(): Promise<AcceptInvitationResult | null> {
    log.warn('acceptWithGoogle is deprecated - use acceptWithOAuth() instead');
    return null;
  }

  /**
   * Accept invitation with credentials
   *
   * @param credentials - User credentials (email/password or OAuth)
   * @returns Acceptance result or null if failed
   */
  private async acceptInvitation(
    credentials: UserCredentials
  ): Promise<AcceptInvitationResult | null> {
    if (!this.token) {
      return null;
    }

    runInAction(() => {
      this.isAccepting = true;
      this.acceptanceError = null;
    });

    try {
      log.info('Accepting invitation', {
        authMethod: this.authMethodSelection,
        email: credentials.email
      });

      const result = await this.invitationService.acceptInvitation(
        this.token,
        credentials
      );

      runInAction(() => {
        this.acceptanceResult = result;
        this.isAccepting = false;
      });

      log.info('Invitation accepted successfully', {
        userId: result.userId,
        orgId: result.orgId
      });

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to accept invitation';

      runInAction(() => {
        this.isAccepting = false;
        this.acceptanceError = errorMessage;
      });

      log.error('Failed to accept invitation', error);

      return null;
    }
  }

  /**
   * Clear all field errors
   */
  private clearFieldErrors(): void {
    this.emailError = null;
    this.passwordError = null;
    this.confirmPasswordError = null;
  }

  /**
   * Reset ViewModel to initial state
   */
  reset(): void {
    runInAction(() => {
      this.token = null;
      this.invitationDetails = null;
      this.isValidatingToken = false;
      this.validationError = null;
      this.authMethodSelection = 'email_password';
      this.email = '';
      this.password = '';
      this.confirmPassword = '';
      this.isAccepting = false;
      this.acceptanceError = null;
      this.acceptanceResult = null;
      this.clearFieldErrors();
    });
  }

  /**
   * Computed: Is token valid
   */
  get isTokenValid(): boolean {
    return this.invitationDetails !== null && this.validationError === null;
  }

  /**
   * Computed: Can submit
   */
  get canSubmit(): boolean {
    return (
      this.isTokenValid &&
      !this.isAccepting &&
      this.email.trim().length > 0
    );
  }

  /**
   * Computed: Redirect URL after acceptance
   */
  get redirectUrl(): string | null {
    return this.acceptanceResult?.redirectUrl || null;
  }
}
