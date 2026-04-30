import type { PostgrestError, PostgrestSingleResponse } from '@supabase/supabase-js';
import { maskPii } from '@/utils/maskPii';

/**
 * Typed boundary for `api.*` RPC envelopes (Pattern A v2).
 *
 * `unwrapApiEnvelope<T>` is the only sanctioned way to read `error` off an
 * `api.*` RPC envelope. It applies `maskPii` exactly once at the SDK boundary
 * so consumers (services, ViewModels, log emissions) cannot accidentally
 * surface raw PHI.
 *
 * Success-path shape is an INTERSECTION TYPE (`{success: true} & T`) — not a
 * nested wrapper — because services in this repo already return flat shapes
 * like `{success: true, role?: Role}`, `{success: true, invitation?: Invitation}`.
 * See `documentation/architecture/decisions/adr-rpc-readback-pattern.md` and
 * `frontend/src/services/CLAUDE.md` for the contract.
 */

export type ApiEnvelopeSuccess<T extends Record<string, unknown> = Record<string, never>> = {
  success: true;
} & T;

/**
 * Structured error details surfaced from `api.*` write RPCs.
 * Promoted to a named type per architect review NT-7 — anonymous types on the
 * envelope failure shape forced callers to inline-spec the same shape per service.
 */
export interface EnvelopeErrorDetails {
  code: string;
  message: string;
  context?: Record<string, unknown>;
  correlationId?: string;
}

/**
 * Single role-assignment delegation/scope violation surfaced by
 * `api.validate_role_assignment` (used by `api.modify_user_roles` etc.).
 * Defined here (not in user.types) because the failure shape lives at the
 * envelope boundary.
 */
export interface ApiRoleAssignmentViolation {
  role_id: string;
  role_name: string | null;
  error_code: 'SUBSET_ONLY_VIOLATION' | 'SCOPE_HIERARCHY_VIOLATION' | 'ROLE_NOT_FOUND';
  message: string;
}

export interface ApiEnvelopeFailure {
  success: false;
  error: string;
  errorCode?: string;
  errorDetails?: EnvelopeErrorDetails;
  postgrestError?: { code: string; message: string; details?: string; hint?: string };

  /**
   * Multi-event Pattern A v2 partial-failure shape (e.g., `api.modify_user_roles`).
   * Set when a mid-loop emit short-circuited; `success: false, partial: true`
   * + the side that failed and the index. The RPC has already persisted
   * `domain_events` rows for the events emitted before the failure; re-running
   * with the same input arrays is idempotent.
   */
  partial?: boolean;
  failureIndex?: number;
  failureSection?: 'add' | 'remove';
  processingError?: string;

  /**
   * Per-role validation failures from `api.validate_role_assignment`.
   * Present when `error === 'VALIDATION_FAILED'`.
   */
  violations?: ApiRoleAssignmentViolation[];

  /** RPC-specific success-path fields that may also surface in PARTIAL_FAILURE / PROCESSING_ERROR returns. */
  userId?: string;
  addedRoleEventIds?: string[];
  removedRoleEventIds?: string[];
}

export type ApiEnvelope<T extends Record<string, unknown> = Record<string, never>> =
  | ApiEnvelopeSuccess<T>
  | ApiEnvelopeFailure;

/**
 * Mask all PII-bearing string fields on a PostgrestError.
 * Returns a NEW object (does not mutate the input).
 */
export function maskPostgrestError(err: PostgrestError): {
  code: string;
  message: string;
  details?: string;
  hint?: string;
} {
  return {
    code: err.code,
    message: maskPii(err.message),
    details: err.details ? maskPii(err.details) : undefined,
    hint: err.hint ? maskPii(err.hint) : undefined,
  };
}

/**
 * Unwrap an `api.*` RPC result into a typed `ApiEnvelope<T>`.
 *
 * Precondition: `rpcResult` is a PostgrestSingleResponse from a Supabase RPC call.
 * Postcondition: returns a discriminated `ApiEnvelope<T>`; `.error` and any
 *   `postgrestError.{message,details,hint}` strings have been masked exactly once.
 * Invariant: callers MUST consume the returned envelope; raw `rpcResult.error.*`
 *   strings MUST NOT be read after this call.
 *
 * Three paths:
 *   1. PostgREST-level error (e.g. 42501, 401) → mask `error.message`/`details`/`hint`
 *      and surface as ApiEnvelopeFailure with `postgrestError`.
 *   2. Envelope success=false (Pattern A v2 handler-driven failure) → mask
 *      `data.error` and surface as ApiEnvelopeFailure.
 *   3. Otherwise → spread `data` fields onto `{success: true}` (intersection-type
 *      contract). For RPCs whose `data` is an array or scalar, the caller should
 *      use `apiRpc<T>` instead of this helper.
 */
export function unwrapApiEnvelope<T extends Record<string, unknown> = Record<string, never>>(
  rpcResult: PostgrestSingleResponse<unknown>
): ApiEnvelope<T> {
  if (rpcResult.error) {
    const masked = maskPostgrestError(rpcResult.error);
    return { success: false, error: masked.message, postgrestError: masked };
  }

  const data = rpcResult.data as
    | (Partial<ApiEnvelopeFailure> & { success?: boolean; error?: string })
    | null;

  if (data && typeof data === 'object' && data.success === false) {
    // Preserve structured failure fields (violations, errorDetails, partial-state,
    // RPC-specific success-path arrays that some shapes echo back in failure cases).
    // Mask `error` and any nested message strings exactly once.
    const masked: ApiEnvelopeFailure = {
      success: false,
      error: maskPii(data.error ?? 'Unknown error'),
    };
    if (data.errorCode !== undefined) masked.errorCode = data.errorCode;
    if (data.errorDetails !== undefined) {
      masked.errorDetails = {
        code: data.errorDetails.code,
        message: maskPii(data.errorDetails.message),
        context: data.errorDetails.context,
        correlationId: data.errorDetails.correlationId,
      };
    }
    if (data.violations !== undefined) {
      masked.violations = data.violations.map((v) => ({
        role_id: v.role_id,
        role_name: v.role_name,
        error_code: v.error_code,
        message: maskPii(v.message),
      }));
    }
    if (data.partial !== undefined) masked.partial = data.partial;
    if (data.failureIndex !== undefined) masked.failureIndex = data.failureIndex;
    if (data.failureSection !== undefined) masked.failureSection = data.failureSection;
    if (data.processingError !== undefined) masked.processingError = maskPii(data.processingError);
    if (data.userId !== undefined) masked.userId = data.userId;
    if (data.addedRoleEventIds !== undefined) masked.addedRoleEventIds = data.addedRoleEventIds;
    if (data.removedRoleEventIds !== undefined)
      masked.removedRoleEventIds = data.removedRoleEventIds;
    return masked;
  }

  // Success path: spread data fields onto envelope (intersection-type contract).
  // Callers whose RPC returns arrays/scalars should use apiRpc<T> instead.
  if (data && typeof data === 'object') {
    return { success: true, ...(data as Record<string, unknown>) } as ApiEnvelopeSuccess<T>;
  }
  return { success: true } as ApiEnvelopeSuccess<T>;
}
