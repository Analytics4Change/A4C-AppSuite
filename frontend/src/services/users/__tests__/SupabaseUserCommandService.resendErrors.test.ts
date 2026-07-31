/**
 * SupabaseUserCommandService.resendInvitation — Edge Function error mapping.
 *
 * PR E added two refusals to `invite-user`'s resend path:
 *
 *   409 INVITATION_SUPERSEDED   — a newer invitation is already pending for this
 *                                 address, so resending this one would produce a
 *                                 second pending row and violate
 *                                 uq_invitations_pending_org_email.
 *   503 SUPERSEDE_CHECK_FAILED  — the supersede probe itself failed, so we could
 *                                 not establish that resending is safe.
 *
 * Both carry an actionable `errorDetails` payload. Before this test's companion
 * fix, `resendInvitation` mapped only `errorInfo.details` into `context` and
 * dropped `errorInfo.errorDetails` entirely — so `supersedingInvitationId`, the
 * one thing that tells the admin WHICH invitation to act on, never reached the
 * caller. These tests pin that it does.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockApiRpcEnvelope, mockApiRpc, mockInvoke, mockGetClient } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  return {
    mockApiRpcEnvelope: vi.fn(),
    mockApiRpc: vi.fn(),
    mockInvoke,
    mockGetClient: vi.fn(() => ({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'header.eyJvcmdfaWQiOiJvcmctdGVzdCJ9.sig' } },
        }),
      },
      functions: { invoke: mockInvoke },
    })),
  };
});

const { mockExtract } = vi.hoisted(() => ({ mockExtract: vi.fn() }));

vi.mock('@/services/auth/supabase.service', () => ({
  supabaseService: {
    apiRpc: mockApiRpc,
    apiRpcEnvelope: mockApiRpcEnvelope,
    getClient: mockGetClient,
  },
}));

vi.mock('@/utils/tracing', () => ({
  createTracingContext: vi.fn().mockResolvedValue({
    correlationId: 'test-correlation',
    traceId: 'test-trace',
    sessionId: 'test-session',
    spanId: 'test-span',
  }),
  buildHeadersFromContext: vi.fn(() => ({})),
}));

vi.mock('@/utils/jwt', () => ({ decodeJWT: vi.fn(() => ({ org_id: 'org-test' })) }));

vi.mock('@/utils/edge-function-errors', () => ({
  extractEdgeFunctionError: mockExtract,
}));

import { SupabaseUserCommandService } from '../SupabaseUserCommandService';

describe('SupabaseUserCommandService.resendInvitation — PR E refusals', () => {
  let service: SupabaseUserCommandService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SupabaseUserCommandService();
    // The SDK surfaces a non-2xx as `error`; the body is parsed by
    // extractEdgeFunctionError, which we stub per-test.
    mockInvoke.mockResolvedValue({ data: null, error: new Error('non-2xx') });
  });

  it('surfaces INVITATION_SUPERSEDED with the invitation the admin should act on', async () => {
    mockExtract.mockResolvedValueOnce({
      message:
        'A newer invitation is already pending for that address. Resend the current invitation instead.',
      code: 'INVITATION_SUPERSEDED',
      errorDetails: {
        code: 'INVITATION_SUPERSEDED',
        supersedingInvitationId: 'inv-live-1',
        suggestedAction: 'resend_pending',
      },
      correlationId: 'corr-1',
    });

    const result = await service.resendInvitation('inv-expired-1');

    expect(result.success).toBe(false);
    expect(result.errorDetails?.code).toBe('INVITATION_SUPERSEDED');
    // The whole point of the 409: a target to act on, not just prose.
    expect(result.errorDetails?.context?.supersedingInvitationId).toBe('inv-live-1');
    expect(result.errorDetails?.context?.suggestedAction).toBe('resend_pending');
    expect(result.errorDetails?.correlationId).toBe('corr-1');
  });

  it('surfaces SUPERSEDE_CHECK_FAILED as retryable, distinct from a refusal', async () => {
    // "Unknown" is not "no". The admin must be able to tell a real collision
    // from a probe that could not answer, because only one of them is retryable.
    mockExtract.mockResolvedValueOnce({
      message: 'Could not verify whether this invitation was superseded; no resend was sent',
      code: 'SUPERSEDE_CHECK_FAILED',
      errorDetails: { code: 'SUPERSEDE_CHECK_FAILED', suggestedAction: 'retry' },
      correlationId: 'corr-2',
    });

    const result = await service.resendInvitation('inv-expired-2');

    expect(result.success).toBe(false);
    expect(result.errorDetails?.code).toBe('SUPERSEDE_CHECK_FAILED');
    expect(result.errorDetails?.context?.suggestedAction).toBe('retry');
  });

  it('leaves context undefined when the Edge Function carried no structured detail', async () => {
    // Regression fence: the errorDetails merge must not manufacture an empty
    // object where callers previously saw `undefined`.
    mockExtract.mockResolvedValueOnce({
      message: 'Invitation not found or access denied',
      code: 'HTTP_ERROR',
      correlationId: 'corr-3',
    });

    const result = await service.resendInvitation('inv-missing');

    expect(result.success).toBe(false);
    expect(result.errorDetails?.code).toBe('HTTP_ERROR');
    expect(result.errorDetails?.context).toBeUndefined();
  });
});
