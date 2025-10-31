import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InvitationAcceptanceViewModel } from '../InvitationAcceptanceViewModel';
import type { IInvitationService } from '@/services/invitation/IInvitationService';

describe('InvitationAcceptanceViewModel', () => {
  let viewModel: InvitationAcceptanceViewModel;
  let mockInvitationService: IInvitationService;

  beforeEach(() => {
    // Mock invitation service
    mockInvitationService = {
      validateToken: vi.fn().mockResolvedValue({
        valid: true,
        email: 'john@example.com',
        organizationName: 'Test Organization',
        organizationId: 'org-123',
        expiresAt: new Date(Date.now() + 86400000).toISOString(), // 24 hours from now
        expired: false,
        alreadyAccepted: false,
      }),
      acceptInvitation: vi.fn().mockResolvedValue({
        success: true,
        userId: 'user-123',
        organizationId: 'org-123',
        redirectUrl: '/organizations/org-123/dashboard',
      }),
    };

    // Create view model with mocked dependency
    viewModel = new InvitationAcceptanceViewModel(mockInvitationService);
  });

  describe('Initialization', () => {
    it('should initialize with null invitation data', () => {
      expect(viewModel.invitationData).toBeNull();
    });

    it('should not be loading initially', () => {
      expect(viewModel.isLoading).toBe(false);
    });

    it('should not be validating initially', () => {
      expect(viewModel.isValidating).toBe(false);
    });

    it('should have no error initially', () => {
      expect(viewModel.error).toBeNull();
    });

    it('should have empty password field', () => {
      expect(viewModel.password).toBe('');
    });
  });

  describe('Token Validation', () => {
    it('should validate a valid token', async () => {
      await viewModel.validateToken('valid-token-123');

      expect(mockInvitationService.validateToken).toHaveBeenCalledWith('valid-token-123');
      expect(viewModel.invitationData).not.toBeNull();
      expect(viewModel.invitationData?.email).toBe('john@example.com');
      expect(viewModel.invitationData?.organizationName).toBe('Test Organization');
    });

    it('should set isValidating during validation', async () => {
      const validatePromise = viewModel.validateToken('token-123');
      expect(viewModel.isValidating).toBe(true);
      await validatePromise;
      expect(viewModel.isValidating).toBe(false);
    });

    it('should handle invalid token', async () => {
      mockInvitationService.validateToken = vi.fn().mockResolvedValue({
        valid: false,
        expired: true,
      });

      await viewModel.validateToken('invalid-token');

      expect(viewModel.invitationData).toBeNull();
      expect(viewModel.error).toBeDefined();
      expect(viewModel.error).toContain('expired');
    });

    it('should handle already accepted invitation', async () => {
      mockInvitationService.validateToken = vi.fn().mockResolvedValue({
        valid: false,
        alreadyAccepted: true,
      });

      await viewModel.validateToken('used-token');

      expect(viewModel.invitationData).toBeNull();
      expect(viewModel.error).toBeDefined();
      expect(viewModel.error).toContain('already been accepted');
    });

    it('should handle validation errors', async () => {
      mockInvitationService.validateToken = vi.fn().mockRejectedValue(
        new Error('Network error')
      );

      await viewModel.validateToken('token-123');

      expect(viewModel.invitationData).toBeNull();
      expect(viewModel.error).toBeDefined();
    });
  });

  describe('Password Updates', () => {
    it('should update password field', () => {
      viewModel.setPassword('SecurePassword123!');
      expect(viewModel.password).toBe('SecurePassword123!');
    });
  });

  describe('Accept Invitation with Email/Password', () => {
    beforeEach(async () => {
      await viewModel.validateToken('valid-token-123');
    });

    it('should accept invitation with valid password', async () => {
      viewModel.setPassword('SecurePassword123!');
      const result = await viewModel.acceptWithEmailPassword();

      expect(mockInvitationService.acceptInvitation).toHaveBeenCalledWith(
        'valid-token-123',
        'email_password',
        { password: 'SecurePassword123!' }
      );
      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
      expect(result?.redirectUrl).toBeDefined();
    });

    it('should not accept without password', async () => {
      const result = await viewModel.acceptWithEmailPassword();
      expect(result).toBeNull();
      expect(viewModel.error).toBeDefined();
      expect(mockInvitationService.acceptInvitation).not.toHaveBeenCalled();
    });

    it('should not accept without valid invitation data', async () => {
      viewModel.invitationData = null;
      viewModel.setPassword('Password123!');

      const result = await viewModel.acceptWithEmailPassword();
      expect(result).toBeNull();
      expect(viewModel.error).toBeDefined();
      expect(mockInvitationService.acceptInvitation).not.toHaveBeenCalled();
    });

    it('should set isLoading during acceptance', async () => {
      viewModel.setPassword('Password123!');
      const acceptPromise = viewModel.acceptWithEmailPassword();
      expect(viewModel.isLoading).toBe(true);
      await acceptPromise;
      expect(viewModel.isLoading).toBe(false);
    });

    it('should validate password strength', async () => {
      viewModel.setPassword('weak');
      const result = await viewModel.acceptWithEmailPassword();
      expect(result).toBeNull();
      expect(viewModel.error).toBeDefined();
      expect(viewModel.error).toContain('at least 8 characters');
    });

    it('should handle acceptance errors', async () => {
      mockInvitationService.acceptInvitation = vi.fn().mockRejectedValue(
        new Error('Server error')
      );

      viewModel.setPassword('Password123!');
      const result = await viewModel.acceptWithEmailPassword();

      expect(result).toBeNull();
      expect(viewModel.error).toBeDefined();
      expect(viewModel.isLoading).toBe(false);
    });
  });

  describe('Accept Invitation with Google OAuth', () => {
    beforeEach(async () => {
      await viewModel.validateToken('valid-token-123');
    });

    it('should accept invitation with OAuth user ID', async () => {
      const result = await viewModel.acceptWithGoogleOAuth('oauth-user-456');

      expect(mockInvitationService.acceptInvitation).toHaveBeenCalledWith(
        'valid-token-123',
        'google_oauth',
        { oauthUserId: 'oauth-user-456', oauthProvider: 'google' }
      );
      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
    });

    it('should not accept without OAuth user ID', async () => {
      const result = await viewModel.acceptWithGoogleOAuth('');
      expect(result).toBeNull();
      expect(viewModel.error).toBeDefined();
    });

    it('should not accept without valid invitation data', async () => {
      viewModel.invitationData = null;
      const result = await viewModel.acceptWithGoogleOAuth('oauth-user-456');
      expect(result).toBeNull();
      expect(viewModel.error).toBeDefined();
    });

    it('should set isLoading during OAuth acceptance', async () => {
      const acceptPromise = viewModel.acceptWithGoogleOAuth('oauth-user-456');
      expect(viewModel.isLoading).toBe(true);
      await acceptPromise;
      expect(viewModel.isLoading).toBe(false);
    });

    it('should handle OAuth acceptance errors', async () => {
      mockInvitationService.acceptInvitation = vi.fn().mockRejectedValue(
        new Error('OAuth error')
      );

      const result = await viewModel.acceptWithGoogleOAuth('oauth-user-456');

      expect(result).toBeNull();
      expect(viewModel.error).toBeDefined();
      expect(viewModel.isLoading).toBe(false);
    });
  });

  describe('Computed Properties', () => {
    it('should compute isValid correctly for valid invitation', async () => {
      await viewModel.validateToken('valid-token-123');
      expect(viewModel.isValid).toBe(true);
    });

    it('should compute isValid as false without invitation data', () => {
      expect(viewModel.isValid).toBe(false);
    });

    it('should compute isExpired correctly', async () => {
      mockInvitationService.validateToken = vi.fn().mockResolvedValue({
        valid: false,
        expired: true,
        expiresAt: new Date(Date.now() - 1000).toISOString(), // Past date
      });

      await viewModel.validateToken('expired-token');
      expect(viewModel.isExpired).toBe(true);
    });

    it('should compute isAlreadyAccepted correctly', async () => {
      mockInvitationService.validateToken = vi.fn().mockResolvedValue({
        valid: false,
        alreadyAccepted: true,
      });

      await viewModel.validateToken('used-token');
      expect(viewModel.isAlreadyAccepted).toBe(true);
    });
  });

  describe('Error Clearing', () => {
    it('should clear error on new validation attempt', async () => {
      // First validation fails
      mockInvitationService.validateToken = vi.fn().mockRejectedValue(
        new Error('Error 1')
      );
      await viewModel.validateToken('token-1');
      expect(viewModel.error).toBeDefined();

      // Second validation succeeds
      mockInvitationService.validateToken = vi.fn().mockResolvedValue({
        valid: true,
        email: 'test@example.com',
        organizationName: 'Org',
        organizationId: 'org-123',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        expired: false,
        alreadyAccepted: false,
      });
      await viewModel.validateToken('token-2');
      expect(viewModel.error).toBeNull();
    });

    it('should clear error on new acceptance attempt', async () => {
      await viewModel.validateToken('valid-token-123');

      // First attempt fails
      mockInvitationService.acceptInvitation = vi.fn().mockRejectedValue(
        new Error('Error')
      );
      viewModel.setPassword('Password123!');
      await viewModel.acceptWithEmailPassword();
      expect(viewModel.error).toBeDefined();

      // Second attempt succeeds
      mockInvitationService.acceptInvitation = vi.fn().mockResolvedValue({
        success: true,
        userId: 'user-123',
        organizationId: 'org-123',
        redirectUrl: '/organizations/org-123/dashboard',
      });
      await viewModel.acceptWithEmailPassword();
      expect(viewModel.error).toBeNull();
    });
  });
});
