/**
 * Pattern A v2 read-back helper for Edge Functions.
 *
 * Verifies that a `domain_events` emit produced the expected projection state
 * AND captures the race-safe `processing_error` on the captured event_id.
 *
 * # Two-check contract
 *
 * 1. **`IF NOT FOUND` on the projection read-back** — catches the case where
 *    the row is genuinely missing OR the expected-state predicate doesn't
 *    match (e.g., handler ran but didn't update; handler threw before update).
 * 2. **`processing_error` check on the captured event_id** — catches the
 *    handler-update-then-throw window AND the case where the projection
 *    looked updated for an unrelated reason.
 *
 * # Transactional model — SQL RPC vs Edge Function
 *
 * In the SQL precedent (`api.delete_user`, `api.update_role`, etc.) the
 * `api.emit_domain_event(...)` call + projection read-back + `processing_error`
 * SELECT all execute inside a single transaction. The `BEFORE INSERT` trigger
 * fires inside that same transaction, persists `processing_error` to the
 * in-flight `NEW` row, and the subsequent SELECT sees it via PG's self-write
 * snapshot visibility.
 *
 * In the Edge Function port (this helper), `supabaseAdmin.rpc('emit_domain_event', ...)`
 * is one wire round-trip / one transaction; the read-back queries are separate
 * transactions over the wire. After the emit RPC commits, the `domain_events`
 * row (including `processing_error`) is durably visible — no MVCC snapshot
 * ambiguity. The wire-tier port is *safer*, not less safe.
 *
 * # PII masking
 *
 * `processing_error` strings are concatenated into the response body via
 * `maskPii` (byte-equivalent to frontend masker). Handler `RAISE EXCEPTION`
 * strings MUST NOT interpolate identifiers (Rule 16 in
 * `infrastructure-guidelines/SKILL.md`); this helper is the boundary that
 * future-proofs against handler-side regressions.
 *
 * # Reference
 *
 * - ADR: `documentation/architecture/decisions/adr-rpc-readback-pattern.md`
 *   §"Pattern A v2 (Resolved)"
 * - SQL precedent: `api.delete_user` at
 *   `infrastructure/supabase/supabase/migrations/20260427205333_extract_delete_user_rpc.sql:107-133`
 * - First adopter: `manage-user.deactivate` (this PR)
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { maskPii } from './maskPii.ts';

/**
 * Loose type alias matching the AnySchemaSupabaseClient pattern used elsewhere
 * in `_shared` and the frontend SDK boundary. Required because `supabaseAdmin`
 * is configured with the default 'public' schema but reads from `api` and
 * other tables.
 */
// deno-lint-ignore no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

export type ProjectionReadbackResult<T> =
  | { success: true; row: T }
  | { success: false; error: string };

/**
 * Performs the Pattern A v2 two-check read-back contract for an Edge Function
 * that has just emitted a domain event and needs to verify the projection
 * updated as expected.
 *
 * @param client - Supabase service-role client (must have read access to the
 *   projection table AND `domain_events`).
 * @param eventId - The captured event_id from `emit_domain_event` return.
 *   This is the race-safe lookup key; never query `domain_events` by
 *   `stream_id` or "latest event" — concurrent emitters on the same stream
 *   would produce false negatives.
 * @param table - Projection table to read back (e.g. `'users'`,
 *   `'roles_projection'`).
 * @param lookupKey - Primary-key column on the projection (typically `'id'`).
 * @param lookupValue - Value to filter the lookupKey on. Typed `string | number`
 *   to cover both UUID-keyed (deactivate, reactivate, role, OU) and surrogate-
 *   integer-keyed projections without forcing every caller to coerce. `.eq()`
 *   accepts both at runtime.
 * @param expectedState - Object of column→value pairs conjoined into the
 *   read-back query via `.eq()` chains. This is load-bearing: without it,
 *   `IF NOT FOUND` cannot distinguish "handler updated correctly" from
 *   "handler threw before update, pre-existing stale row visible." For
 *   deactivate: `{ is_active: false }`. For reactivate: `{ is_active: true }`.
 *   For update_role-style multi-column updates: pass all columns.
 * @returns `{success: true, row: T}` on the happy path; `{success: false,
 *   error: 'Event processing failed: <masked>'}` on either failure check.
 *
 * The error string is structured for the frontend to surface verbatim in
 * toast/banner UIs — the boundary helper does the masking so no caller is
 * responsible for it.
 */
export async function checkProjectionReadback<T>(
  client: AnyClient,
  eventId: string,
  table: string,
  lookupKey: string,
  lookupValue: string | number,
  expectedState: Record<string, unknown>,
): Promise<ProjectionReadbackResult<T>> {
  // Check 1: read back with expected-state predicate.
  // If NOT FOUND: query `processing_error` on the captured event_id and
  // surface the masked failure reason. Surface query errors verbatim
  // (RLS denials, missing GRANTs would be silent-failure modes if swallowed).
  //
  // Schema note: Edge Function service-role clients (e.g. `supabaseAdmin` in
  // `manage-user/index.ts`) are typically constructed with `db: { schema: 'api' }`
  // for RPC ergonomics. Projection tables and `domain_events` live in `public`,
  // so the read-back must explicitly target the public schema via
  // `.schema('public')`. Returned bug from first deployment 2026-05-12:
  // "Could not find the table 'api.users' in the schema cache".
  let readBackQuery = client
    .schema('public')
    .from(table)
    .select('*')
    .eq(lookupKey, lookupValue);
  for (const [column, value] of Object.entries(expectedState)) {
    readBackQuery = readBackQuery.eq(column, value);
  }
  const readBackResult = await readBackQuery.maybeSingle();
  if (readBackResult.error) {
    return {
      success: false,
      error: `Read-back query failed: ${maskPii(readBackResult.error.message)}`,
    };
  }

  if (!readBackResult.data) {
    const procErrorResult = await client
      .schema('public')
      .from('domain_events')
      .select('processing_error')
      .eq('id', eventId)
      .maybeSingle();
    if (procErrorResult.error) {
      return {
        success: false,
        error: `processing_error lookup failed: ${maskPii(procErrorResult.error.message)}`,
      };
    }
    const procError = procErrorResult.data?.processing_error as string | null | undefined;
    return {
      success: false,
      error: `Event processing failed: ${maskPii(procError ?? 'projection read-back returned no row')}`,
    };
  }

  // Check 2: race-safe `processing_error` check on captured event_id, even
  // when the read-back looks fine. Catches the partial-update-then-throw
  // window where the handler successfully wrote some state before raising.
  const procErrorResult = await client
    .schema('public')
    .from('domain_events')
    .select('processing_error')
    .eq('id', eventId)
    .maybeSingle();
  if (procErrorResult.error) {
    return {
      success: false,
      error: `processing_error lookup failed: ${maskPii(procErrorResult.error.message)}`,
    };
  }
  const procError = procErrorResult.data?.processing_error as string | null | undefined;
  if (procError) {
    return {
      success: false,
      error: `Event processing failed: ${maskPii(procError)}`,
    };
  }

  return { success: true, row: readBackResult.data as T };
}
