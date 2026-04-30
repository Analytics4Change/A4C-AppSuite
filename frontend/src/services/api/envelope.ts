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

export interface ApiEnvelopeFailure {
  success: false;
  error: string;
  errorCode?: string;
  postgrestError?: { code: string; message: string; details?: string; hint?: string };
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

  const data = rpcResult.data as { success?: boolean; error?: string } | null;

  if (data && typeof data === 'object' && data.success === false) {
    return { success: false, error: maskPii(data.error ?? 'Unknown error') };
  }

  // Success path: spread data fields onto envelope (intersection-type contract).
  // Callers whose RPC returns arrays/scalars should use apiRpc<T> instead.
  if (data && typeof data === 'object') {
    return { success: true, ...(data as Record<string, unknown>) } as ApiEnvelopeSuccess<T>;
  }
  return { success: true } as ApiEnvelopeSuccess<T>;
}
