# Migrate Services to apiRpcEnvelope + Ship ESLint Rule — Context

**Type**: Defense-in-depth; codemod + lint enforcement
**Status**: 🟢 ACTIVE — ready when bandwidth opens
**Priority**: Medium — primary HIPAA leak vectors already closed by PR #43; this card hardens the SDK boundary
**Origin**: Spun out of PR #43 (`fix(security): sanitize processing_error PII (HIPAA, Hybrid Option 6)`) when the v3 plan's "B2" service-migration scope ballooned beyond a single PR.

## Capability target

Migrate all envelope-shaped (Pattern A v2) `api.*` RPC call sites in `frontend/src/services/` from direct `supabase.schema('api').rpc(...)` invocations to `supabaseService.apiRpcEnvelope<T>(...)`. Ship the deferred ESLint `no-restricted-syntax` rule that blocks new direct callers. End state: no service file outside `frontend/src/services/auth/supabase.service.ts` and `frontend/src/services/api/envelope.ts` calls `.schema('api').rpc(` directly.

## Why now (concrete trigger)

PR #43 closed the persistence-layer leak (trigger drops PG_EXCEPTION_DETAIL into a gated column) and the Edge Function leak (3 chokepoint patches across 7 functions). The remaining defense-in-depth gap is the frontend SDK boundary: ~70 direct `.schema('api').rpc(...)` callers across 8 service files don't route through the new typed `unwrapApiEnvelope<T>` helper, so their `data.error` fields are not masked at the boundary. Today the underlying text is mostly safe because:

1. The trigger only persists `MESSAGE_TEXT` (no `PG_EXCEPTION_DETAIL`) post-PR #43.
2. The 6 known RAISE EXCEPTION identifier-leaks are remediated.
3. New RAISE EXCEPTION violations are gated by SKILL.md Rule 16 and PR review.

But these are preventive controls that depend on developer discipline. The structural fix is to route all envelope reads through the typed boundary helper so the masker fires regardless of source-side hygiene. Without the bulk migration, the ESLint rule cannot ship — the repo's `--max-warnings 0` policy means 89 existing warnings would break the lint gate.

## Trigger to start

Start when:
- Bandwidth opens for ~2-3 days of mechanical edits (the codemod is repetitive but each file requires careful review of return-shape contracts), OR
- A new RAISE EXCEPTION identifier-leak is discovered in production, raising the priority of structural prevention.

## Scope

**In scope**:
- Migrate envelope-shaped writes in 8 services (~50-60 call sites) to `apiRpcEnvelope<T>`:
  - `SupabaseUserCommandService` (audit + migrate envelope calls)
  - `SupabaseRoleService`
  - `SupabaseClientService`
  - `SupabaseScheduleService`
  - `SupabaseClientFieldService`
  - `SupabaseOrganizationCommandService`
  - `SupabaseOrganizationEntityService`
  - `SupabaseOrganizationUnitService`
- Migrate read-shaped reads (~10-20 call sites) in `SupabaseUserQueryService` and `SupabaseOrganizationQueryService` to `supabaseService.apiRpc<T>(...)` so `PostgrestError` surfaces are masked.
- Re-enable the `no-restricted-syntax` rule in `frontend/eslint.config.js` (the placeholder comment is already in place from PR #43).
- Confirm `npm run lint` passes with `--max-warnings 0` after migration.

**Out of scope**:
- Refactoring service return-shape contracts beyond what the migration mechanically requires.
- Unit tests for the migrated services (they have integration-via-VM coverage today).
- Migrating `SupabaseOrganizationQueryService.ts` calls that intentionally return raw arrays (those stay on `apiRpc<T>` for the masking; no envelope shape involved).

## Constraints

- Each service's existing return-shape contract MUST be preserved. The new helper returns `ApiEnvelope<T> = ApiEnvelopeSuccess<T> | ApiEnvelopeFailure` where `ApiEnvelopeSuccess<T>` is `{success: true} & T` (intersection type) — this matches existing flat-shape returns like `{success: true, role?: Role}`.
- `--max-warnings 0` is the merge gate. The ESLint rule must ship in the same PR as the codemod; staging it as `warn` first is not viable.
- The migration must NOT change any `await supabase.schema('api').rpc(...)` call inside the SDK helpers themselves (`supabase.service.ts`, `envelope.ts`). The ESLint rule will exclude those two files.

## References

- PR #43: `fix(security): sanitize processing_error PII (HIPAA, Hybrid Option 6)` — establishes the typed boundary and defers this migration.
- `frontend/src/services/api/envelope.ts` — `unwrapApiEnvelope<T>` and `ApiEnvelope<T>` types.
- `frontend/src/services/auth/supabase.service.ts` — `apiRpc<T>` (read shape) and `apiRpcEnvelope<T>` (envelope shape).
- `frontend/src/services/CLAUDE.md` § 3 — documented usage of the two helpers.
- `documentation/architecture/decisions/adr-rpc-readback-pattern.md` PII handling section — bulk migration / ESLint rule listed as deferred.
- `frontend/eslint.config.js` — placeholder comment in the rules block citing this card.
