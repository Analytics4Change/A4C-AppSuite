/**
 * GenerateInvitations Activity Tests
 *
 * Tests invitation generation with secure tokens and idempotency.
 */

import { generateInvitations } from '@activities/organization-bootstrap';
import type { GenerateInvitationsParams } from '@shared/types';
import { getSupabaseClient } from '@shared/utils/supabase';

jest.mock('@shared/utils/supabase');
jest.mock('@shared/utils/emit-event', () => ({
  emitEvent: jest.fn().mockResolvedValue(undefined),
  buildTags: jest.fn().mockReturnValue([])
}));

describe('GenerateInvitations Activity', () => {
  const mockSupabase = {
    from: jest.fn(() => mockSupabase),
    select: jest.fn(() => mockSupabase),
    eq: jest.fn(() => mockSupabase),
    maybeSingle: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getSupabaseClient as jest.Mock).mockReturnValue(mockSupabase);
  });

  describe('Happy Path', () => {
    it('should generate invitations with secure tokens', async () => {
      // Mock: No existing invitations
      mockSupabase.maybeSingle.mockResolvedValue({
        data: null,
        error: null
      });

      const params: GenerateInvitationsParams = {
        orgId: 'org-123',
        users: [
          {
            email: 'user1@example.com',
            firstName: 'John',
            lastName: 'Doe',
            role: 'admin'
          },
          {
            email: 'user2@example.com',
            firstName: 'Jane',
            lastName: 'Smith',
            role: 'user'
          }
        ]
      };

      const invitations = await generateInvitations(params);

      expect(invitations).toHaveLength(2);
      expect(invitations[0].email).toBe('user1@example.com');
      expect(invitations[0].token).toMatch(/^[A-Za-z0-9_-]{43}$/); // Base64url token
      expect(invitations[0].expiresAt).toBeInstanceOf(Date);
      expect(invitations[1].email).toBe('user2@example.com');
    });

    it('should set expiration to 7 days from now', async () => {
      mockSupabase.maybeSingle.mockResolvedValue({ data: null, error: null });

      const params: GenerateInvitationsParams = {
        orgId: 'org-123',
        users: [
          {
            email: 'user@example.com',
            firstName: 'Test',
            lastName: 'User',
            role: 'admin'
          }
        ]
      };

      const invitations = await generateInvitations(params);

      const now = new Date();
      const sevenDaysLater = new Date();
      sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

      expect(invitations[0].expiresAt.getTime()).toBeGreaterThan(now.getTime());
      expect(invitations[0].expiresAt.getTime()).toBeLessThanOrEqual(
        sevenDaysLater.getTime() + 1000 // Allow 1 second tolerance
      );
    });
  });

  describe('Idempotency', () => {
    it('should return existing invitation if already exists', async () => {
      const existingToken = 'existing-token-abc123';
      const existingInvitationId = 'existing-inv-id';

      // Mock: Existing invitation found
      mockSupabase.maybeSingle.mockResolvedValueOnce({
        data: {
          invitation_id: existingInvitationId,
          email: 'user@example.com',
          token: existingToken,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        },
        error: null
      });

      const params: GenerateInvitationsParams = {
        orgId: 'org-123',
        users: [
          {
            email: 'user@example.com',
            firstName: 'Test',
            lastName: 'User',
            role: 'admin'
          }
        ]
      };

      const invitations = await generateInvitations(params);

      expect(invitations[0].invitationId).toBe(existingInvitationId);
      expect(invitations[0].token).toBe(existingToken);
    });
  });

  describe('Token Generation', () => {
    it('should generate unique tokens for each invitation', async () => {
      mockSupabase.maybeSingle.mockResolvedValue({ data: null, error: null });

      const params: GenerateInvitationsParams = {
        orgId: 'org-123',
        users: [
          { email: 'user1@example.com', firstName: 'User', lastName: '1', role: 'admin' },
          { email: 'user2@example.com', firstName: 'User', lastName: '2', role: 'user' },
          { email: 'user3@example.com', firstName: 'User', lastName: '3', role: 'user' }
        ]
      };

      const invitations = await generateInvitations(params);

      const tokens = invitations.map(inv => inv.token);
      const uniqueTokens = new Set(tokens);

      expect(uniqueTokens.size).toBe(3); // All tokens should be unique
    });
  });
});
