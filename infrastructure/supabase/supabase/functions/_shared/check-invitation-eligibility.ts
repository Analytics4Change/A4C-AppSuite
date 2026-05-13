/**
 * Cross-provider invitation eligibility gate (shared helper).
 *
 * Wraps `api.check_invitation_acceptance_eligibility` and adapts the read-shape
 * response to a `{ ok: true } | { response: Response }` discriminated union so
 * the two call sites (accept-invitation Sally path, invite-user pre-issuance)
 * can use the same logic with different HTTP status codes on block:
 *
 *   - invite-user (pre-issuance):  422 — the invitation should never be created
 *   - accept-invitation (Sally):   403 — the in-flight token is rejected
 *
 * On `ok: true`, the caller proceeds. On `response`, the caller returns the
 * Response directly (gate has logged the decision and constructed the body).
 *
 * Card: dev/active/reject-cross-provider-invitations/ (2026-05-13).
 * RPC:  infrastructure/supabase/supabase/migrations/20260513203931_reject_cross_provider_invitations.sql
 */

import {
  handleRpcError,
  createErrorResponse,
  ErrorCodes,
} from './error-response.ts';

/**
 * Read-shape response from api.check_invitation_acceptance_eligibility.
 *
 * Exposed for test fixtures.
 */
export interface EligibilityRpcResponse {
  eligible?: boolean;
  error?: string;
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * Discriminated union returned by checkInvitationEligibility().
 *
 *   - { ok: true }                  → caller proceeds with the flow
 *   - { response: Response }         → caller returns the Response immediately
 */
export type EligibilityGateResult =
  | { ok: true }
  | { response: Response };

/**
 * Minimal Supabase client surface this helper needs. The Supabase JS client's
 * `.rpc()` returns a thenable PostgrestFilterBuilder (not a Promise), so we
 * declare `rpc` as returning `any` to accept both the real client and test
 * mocks without having to model the entire SupabaseClient generic-parameter
 * surface. Same pattern as `checkExistingUserPath`'s `client: any`.
 */
// deno-lint-ignore no-explicit-any
export type EligibilityRpcClient = { rpc(fnName: string, args: Record<string, unknown>): any };

export interface CheckInvitationEligibilityParams {
  /** Supabase client capable of invoking `api.check_invitation_acceptance_eligibility`. */
  client: EligibilityRpcClient;
  /** UUID of the invitee. */
  inviteeUserId: string;
  /** UUID of the target organization. */
  targetOrgId: string;
  /** Correlation ID for structured logging + response body. */
  correlationId: string;
  /** CORS headers for the Response when the gate blocks. */
  corsHeaders: Record<string, string>;
  /**
   * HTTP status code returned when the gate blocks. 422 for pre-issuance
   * (invite-user), 403 for acceptance (accept-invitation).
   */
  blockedStatus: 403 | 422;
  /**
   * Tag prefix for log lines, e.g. `[invite-user v18-...]`. Helps distinguish
   * which gate fired in aggregated logs.
   */
  logTag: string;
}

/**
 * Check eligibility for an invitation to a target org by invoking
 * `api.check_invitation_acceptance_eligibility`. Returns a discriminated
 * union: `{ok:true}` means proceed, `{response}` means return immediately.
 *
 * Side effects: console.log/warn/error to surface the decision in EF logs.
 *
 * Throws: never. RPC errors are translated to `handleRpcError` responses.
 *
 * @param params see CheckInvitationEligibilityParams
 * @returns Either { ok: true } (proceed) or { response } (return to client)
 */
export async function checkInvitationEligibility(
  params: CheckInvitationEligibilityParams,
): Promise<EligibilityGateResult> {
  const {
    client,
    inviteeUserId,
    targetOrgId,
    correlationId,
    corsHeaders,
    blockedStatus,
    logTag,
  } = params;

  const { data, error: rpcError } = await client.rpc(
    'check_invitation_acceptance_eligibility',
    {
      p_invitee_user_id: inviteeUserId,
      p_target_org_id: targetOrgId,
    },
  );

  if (rpcError) {
    console.error(`${logTag} Eligibility check RPC failed:`, rpcError);
    return {
      response: handleRpcError(
        rpcError,
        correlationId,
        corsHeaders,
        'Check invitation acceptance eligibility',
      ),
    };
  }

  const eligibility = (data ?? {}) as EligibilityRpcResponse;

  if (eligibility.eligible === true) {
    console.log(
      `${logTag} Eligibility check passed`,
      {
        correlationId,
        invitee_user_id: inviteeUserId,
        target_org_id: targetOrgId,
        decision: 'eligible',
      },
    );
    return { ok: true };
  }

  // Blocked branch (eligible !== true). Log + return a Response with the
  // RPC's error code and message. Status is caller-determined.
  console.warn(
    `${logTag} Eligibility blocked: ${eligibility.error ?? 'unknown'}`,
    {
      correlationId,
      invitee_user_id: inviteeUserId,
      target_org_id: targetOrgId,
      decision: 'blocked',
      error_code: eligibility.error,
      details: eligibility.details,
    },
  );

  return {
    response: createErrorResponse(
      {
        error: eligibility.message ?? 'This invitation cannot be accepted.',
        code: eligibility.error ?? ErrorCodes.FORBIDDEN,
        status: blockedStatus,
        correlationId,
        context: eligibility.details,
      },
      corsHeaders,
    ),
  };
}
