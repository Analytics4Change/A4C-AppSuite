/**
 * InvitationAcceptanceViewModel — unusable-reason propagation (PR A commit 4).
 *
 * # What this pins
 *
 * Two defects in the accept path, both of which made the page lie to the user:
 *
 * 1. **The form rendered for unusable invitations.** `validate-invitation`
 *    returned HTTP 200 with `valid:false` for expired and already-accepted
 *    invitations, and the service read neither `valid` nor `expired` — its only
 *    guard was `if (!data?.orgName ...)`, which the old full-row response
 *    passed. So the signup form appeared and the user only found out after
 *    filling it in and submitting.
 * 2. **Every failure said "Invitation not found."** Revoked, expired,
 *    already-used and genuinely-bogus collapsed into one message that is
 *    literally true only for the last.
 *
 * The service now throws `InvitationUnusableError` carrying the reason; these
 * tests pin that the ViewModel keeps the discriminant rather than flattening it
 * to a string, and that `isTokenValid` stays false so the form cannot render.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { InvitationAcceptanceViewModel } from '../InvitationAcceptanceViewModel';
import { InvitationUnusableError } from '@/types/organization.types';
import type { IInvitationService } from '@/services/invitation/IInvitationService';

function makeService(overrides: Partial<IInvitationService> = {}): IInvitationService {
  return {
    validateInvitation: vi.fn(),
    acceptInvitation: vi.fn(),
    resendInvitation: vi.fn(),
    ...overrides,
  } as unknown as IInvitationService;
}

describe('InvitationAcceptanceViewModel — unusable reasons', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['expired', 'accepted', 'revoked', 'unknown'] as const)(
    'keeps the "%s" reason instead of flattening it to a message',
    async (reason) => {
      const service = makeService({
        validateInvitation: vi
          .fn()
          .mockRejectedValue(
            new InvitationUnusableError(reason, `Invitation is not usable: ${reason}`)
          ),
      });
      const vm = new InvitationAcceptanceViewModel(service);

      const ok = await vm.validateToken('some-token');

      expect(ok).toBe(false);
      expect(vm.validationReason).toBe(reason);
      // The form must not render for ANY unusable reason.
      expect(vm.isTokenValid).toBe(false);
    }
  );

  it('leaves the reason null for a non-classified failure', async () => {
    // A network error or malformed response is genuinely "we do not know why",
    // and must fall back to the generic copy rather than guessing at a reason.
    const service = makeService({
      validateInvitation: vi.fn().mockRejectedValue(new Error('Network request failed')),
    });
    const vm = new InvitationAcceptanceViewModel(service);

    await vm.validateToken('some-token');

    expect(vm.validationReason).toBeNull();
    expect(vm.validationError).toBe('Network request failed');
    expect(vm.isTokenValid).toBe(false);
  });

  it('treats a missing token as unknown rather than rendering a blank page', async () => {
    // Previously this only logged to a console the visitor cannot see, leaving
    // an empty card with no explanation.
    const vm = new InvitationAcceptanceViewModel(makeService());

    vm.setMissingToken();

    expect(vm.validationReason).toBe('unknown');
    expect(vm.isValidatingToken).toBe(false);
    expect(vm.isTokenValid).toBe(false);
  });

  it('clears the reason when a fresh validation starts', async () => {
    const service = makeService({
      validateInvitation: vi
        .fn()
        .mockRejectedValueOnce(new InvitationUnusableError('revoked', 'nope'))
        .mockResolvedValueOnce({
          orgName: 'TestOrg',
          roles: [],
          inviterName: '',
          expiresAt: new Date(Date.now() + 86_400_000),
          email: 'a@b.com',
        }),
    });
    const vm = new InvitationAcceptanceViewModel(service);

    await vm.validateToken('bad');
    expect(vm.validationReason).toBe('revoked');

    await vm.validateToken('good');
    expect(vm.validationReason).toBeNull();
    expect(vm.isTokenValid).toBe(true);
  });

  it('reset() clears the reason alongside the error', async () => {
    const service = makeService({
      validateInvitation: vi.fn().mockRejectedValue(new InvitationUnusableError('expired', 'nope')),
    });
    const vm = new InvitationAcceptanceViewModel(service);

    await vm.validateToken('t');
    expect(vm.validationReason).toBe('expired');

    vm.reset();
    expect(vm.validationReason).toBeNull();
    expect(vm.validationError).toBeNull();
  });

  it('clearAcceptanceError() clears only the submit failure', async () => {
    const vm = new InvitationAcceptanceViewModel(makeService());
    vm.acceptanceError = 'boom';
    vm.validationError = 'unrelated';

    vm.clearAcceptanceError();

    expect(vm.acceptanceError).toBeNull();
    // Dismissing the submit banner must not silently clear the page-load panel.
    expect(vm.validationError).toBe('unrelated');
  });
});
