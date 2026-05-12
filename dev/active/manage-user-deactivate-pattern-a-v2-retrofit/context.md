# manage-user-deactivate-pattern-a-v2-retrofit — Context

**Type**: Security follow-up; Pattern A v2 read-back retrofit
**Status**: 🟢 ACTIVE — in flight (PR pending)
**Priority**: HIGH (closes silent-failure gap on Edge Function deactivate operation)
**Origin**: Recommended by architect after PR #44 close-out; in MEMORY.md "Active Backlogs" as "Recommended next card" post-`migrate-services-to-api-rpc-envelope` archival (2026-05-12).

## Capability target

Apply the Pattern A v2 read-back contract (`adr-rpc-readback-pattern.md`) to the Edge Function `manage-user.deactivate` operation. Closes the F1-class silent-failure gap where the emit RPC succeeds, the handler raises mid-update, the trigger persists `processing_error` on the event row, but the Edge Function returns `{success: true}` to the frontend regardless.

This is the **first Edge Function adopter** of Pattern A v2; the shared helper `_shared/rpc-readback.ts` is designed for reuse by the sibling `manage-user-reactivate-pattern-a-v2-retrofit` (next card) byte-equivalently with `expectedState: { is_active: true }`.

## Scope

**In scope**:
- New Deno helper `infrastructure/supabase/supabase/functions/_shared/rpc-readback.ts` with `checkProjectionReadback<T>` (8 cases of test coverage in the consuming test file).
- Modify `manage-user/index.ts` deactivate handler to capture `eventId`, call helper with `{is_active: false}`, surface eventId on success response.
- New `manage-user/__tests__/deactivate-readback.test.ts` — 8 Deno test cases.
- Additive `eventId?: string` field on `UserRpcEnvelope` (and `ClientRpcEnvelope` for cross-service uniformity) so the frontend can audit-link.
- `SupabaseUserCommandService.deactivateUser` plumbs `eventId` through additively.

**Out of scope**:
- Reactivate retrofit (sibling card; same helper, opposite predicate).
- Auth-ban failure semantics change (pre-existing log-warn-and-return-success behavior preserved verbatim).
- Frontend audit-log UI consumption of `eventId` (the field is additive infrastructure for a future deep-link feature).

## Constraints

- Edge Function stays per LB1 (`auth.admin.updateUserById` call cannot be moved to SQL).
- Wire-tier read-back is one transaction per call (not the SQL RPC's intra-transaction model). Helper docblock documents the semantic difference (wire-tier port is *safer*, not less safe — no MVCC snapshot ambiguity).
- `processing_error` strings passed through `_shared/maskPii.ts` before concatenation. Future-proofs against handler identifier-interpolation regressions (Rule 16 in `infrastructure-guidelines/SKILL.md`).

## References

- ADR: `documentation/architecture/decisions/adr-rpc-readback-pattern.md` §"Pattern A v2 (Resolved)"
- SQL precedent: `infrastructure/supabase/supabase/migrations/20260427205333_extract_delete_user_rpc.sql:107-133` (api.delete_user)
- Origin: PR #44 close-out architect note in MEMORY.md
- Plan: `~/.claude/plans/ddoes-it-make-sense-lucky-dongarra.md`
- Sibling card: `manage-user-reactivate-pattern-a-v2-retrofit/` (to be seeded post-merge)
