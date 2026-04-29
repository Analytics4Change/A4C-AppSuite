# Plan — Preserve placeholder index correspondence on phone emit failure

## Phases

| Phase | Description |
|-------|-------------|
| 0 | Confirm Resolution A (sentinel) is the right approach. Read `handle_user_phone_added` to ensure no consumer of `user.phone.added` events depends on assumptions Resolution A would break. |
| 1 | Implement: change `createdPhoneIds` element type to `{ phoneId: string \| null; phone: InvitationPhone }`. On failure, push `{ phoneId: null, phone }`. Update `resolveInvitationPhonePlaceholder` to treat `null` slots as out-of-range (null + warn). |
| 2 | Update auto-select fallback at `accept-invitation/index.ts:817` to filter `phoneId !== null && phone.smsCapable`. |
| 3 | Optionally: emit a `user.phone.add_failed` event (or expand `processing_error` on the original event) to preserve the audit trail of the failure. Decide based on whether the existing `console.error` is sufficient observability. |
| 4 | Add Deno unit tests for `resolveInvitationPhonePlaceholder` with the new null-slot case (depends on `dev/parked/edge-function-deno-test-harness/` — could land first or be deferred). |
| 5 | Smoke test: artificially fail one phone emit (e.g., temporarily bypass the RLS policy or inject a SQL error) and confirm: (a) inviter-selected phone resolves correctly when index lands on a successful slot, (b) inviter-selected phone resolves to null + auto-selects when index lands on a failed slot. |

## Open questions

- **Q1**: Should `user.phone.add_failed` events be emitted, or is `console.error` sufficient? Lean toward console.error for now; expand if observability requirements surface.
- **Q2**: How to artificially trigger a `phoneError` for smoke testing? Options: (a) temporarily revoke RLS on `user_phones`, (b) inject a fault via a feature flag, (c) skip and rely on unit tests. Lean (c) once the test harness lands.

## Critical files

- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts:58-163` (helper)
- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts:743-778` (phone loop)
- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts:806-822` (placeholder resolution + auto-select)
- `infrastructure/supabase/handlers/user/handle_user_phone_added.sql` (handler — read-only check)

## Verification

- Unit tests cover the null-slot case for `resolveInvitationPhonePlaceholder`.
- Manual smoke test (or fault injection) confirms inviter intent is honored when adjacent phones fail to emit.
- No regression in steady-state path (all phones emit successfully).

---

## Phase 0 Findings & Resolution (2026-04-29)

Phase 0 was elevated to a planning phase (architect-reviewed) because the surface
of changes touched Edge Function test infrastructure and observability semantics in
addition to the index-correspondence fix itself. Authoritative plan:
`/home/lars/.claude/plans/does-phase-0-warrant-humble-whale.md`.

### Q1 — Sentinel approach safety (verified)

`handle_user_phone_added` is a simple INSERT with `ON CONFLICT (id) DO NOTHING`,
single consumer, no cross-event reasoning. Sentinel pattern (push `{ phoneId: null, phone }`
on failed emit) is safe — no new events emit; no cross-entity invariants disturbed.

### Q2 — `user.phone.add_failed` event decision (NO)

Empirical precedent in the codebase: only saga-level state machines emit failure
events; sub-entity flows use `console.error` + correlation_id (Edge Functions) or
`processing_error` on already-emitted events (handlers). A failed *emit* never
reaches `domain_events`, so `processing_error` doesn't apply. Adding a new event
type would expand scope (AsyncAPI registration, three-layer audit, type regen) for
a problem the sentinel already solves.

### Q3 — Test harness scope (notable surprise)

A Deno test harness DOES exist at `_shared/__tests__/` (54 passing tests) but no
per-Edge-Function precedent existed. This card establishes the per-function
pattern at `accept-invitation/__tests__/phone-id-resolution.test.ts`. Partially
de-scopes the parked card `dev/parked/edge-function-deno-test-harness/` — that
card now narrows to "documenting the established pattern + maybe CI integration."

### Architect review (software-architect-dbc, 2026-04-29)

Verdict: APPROVE WITH CHANGES — 5 items, all incorporated:

- **CR-1 (must-fix)**: Helper docblock retained, retitled "Index correspondence
  under partial phone-emit failure (closed)", rewritten as closed-bug-class
  description with explicit sentinel-mechanism reference.
- **CR-2 (must-fix)**: Helper sentinel-at-in-range observability gap closed.
  Added explicit warn at the in-range null path with structured context
  (rawPhoneId, index, phoneLabel, correlationId, userId, invitationId) — without
  this, the fix would lose the diagnostic signal at exactly the failure mode it
  was designed for.
- **CR-3**: Module structure confirmed — `export` keyword inline on helper +
  types in `index.ts`; no `_lib/` split (premature for ~60-line helper).
- **CR-4**: 9th test case "index correspondence preserved through sentinel" —
  the load-bearing assertion of this whole card. Pre-fix sentinel-skipping
  would have made `invitation-phone-2` resolve to the wrong UUID by index shift.
- **CR-5**: Test-harness card scope refinement is a same-day follow-up commit
  on main, NOT bundled in this PR.

### Resolution

Implementation matches plan. Phase 1+2 (sentinel + auto-select filter) closes
the index-shift bug class. Phase 4 (per-function test pattern) verifies the fix
empirically with 9 unique test cases (10 deno test results, all green) covering
PR #41's 6 cases + 3 new sentinel cases. Phase 3 (failure event emission) was
explicitly NOT done per Q2 architectural decision. Phase 5 (smoke test with
fault injection) was explicitly NOT done — tests verify the logic; manual
end-to-end for the happy path is covered by PR #41's prior smoke test.

DEPLOY_VERSION bumped: `v19-phone-id-resolution-hardened` → `v20-phone-emit-index-preservation`.

### Test results

- `deno test --allow-net accept-invitation/__tests__/phone-id-resolution.test.ts`
  → 10 passed, 0 failed (9 unique test cases; one runs 3 inner assertions).
- `deno test --allow-net _shared/__tests__/` → 54 passed, 0 failed (no regression).

### Files changed

| Path | Operation |
|------|-----------|
| `infrastructure/supabase/supabase/functions/accept-invitation/index.ts` | Type change + sentinel push + auto-select filter + helper-docblock refresh + DEPLOY_VERSION + `export` for helper/types + CR-2 sentinel-detection warn |
| `infrastructure/supabase/supabase/functions/accept-invitation/__tests__/phone-id-resolution.test.ts` | NEW — establishes per-function test pattern |
| `dev/active/fix-phone-emit-index-preservation/plan.md` | This Phase 0 Findings + Resolution section |
| `dev/active/fix-phone-emit-index-preservation/tasks.md` | Phase status updated |

---

## F3 closure (architect second-pass review, amended into PR #42)

After PR #42 was opened, a second-pass `software-architect-dbc` review verified
all 5 pre-merge CRs PASS but identified an **unclosed variant of the same bug
class — F3, HIGH severity**: a frontend/backend index-space mismatch on the
`invitation-phone-N` placeholder namespace. A third-pass architect review
validated F3 empirically and recommended amending PR #42 rather than landing F3
as a successor card.

### F3 finding

- **Frontend** (`UsersManagePage.tsx:844-847`): `formData.phones?.filter((p) => p.smsCapable).map((p, index) => ({ id: \`invitation-phone-${index}\`, ... }))` — placeholder N is assigned over the **filtered** subset.
- **Backend** (`accept-invitation/index.ts:794`): `for (const phone of phones)` iterates **unfiltered** `invitation.phones`.

Concrete failure: `phones = [Office(smsCapable=false), Mobile-A, Mobile-B]`,
inviter selects Mobile-A. Frontend stores `phoneId: "invitation-phone-0"`.
Backend's `createdPhoneIds[0]` is **Office**. Helper resolves to Office's UUID
— silent wrong-phone selection, the same compliance failure mode this card was
filed to close.

**Bonus discovery**: `NotificationPreferencesForm.tsx:91` already filters at
render. The upstream filter at `UsersManagePage.tsx:845` was therefore
**redundant** for UI behavior; removing it is purely subtractive.

### Architectural decisions (architect-validated)

| Decision | Choice | Justification |
|---|---|---|
| Remediation strategy | **Option A** — drop frontend filter | 1-line subtractive change. Single point of truth for filtering moves into `NotificationPreferencesForm`. No workflow/schema impact. Option B (backend pre-filter) would silently skip non-SMS `user.phone.added` events. Option C (stable identifiers) is over-engineering. |
| Amend vs successor PR | **AMEND PR #42** | Same bug class. Avoids HIGH-severity defect time on `main`. |
| F1 (discriminated-union) | DROP | Informational only. |
| F6 (empty-array boundary test) | KEEP | Trivial; closes docblock-vs-tests gap. |
| Optional hardening | KEEP | `if (phoneError \|\| !phoneEventId)` belt against silent RPC degradation. |
| Helper docblock correction | REQUIRED | Pre-fix invariant statement is factually wrong post-F3. |

### Implementation (F3 amend, applied 2026-04-29)

- **`frontend/src/pages/users/UsersManagePage.tsx`**: dropped `?.filter((p) => p.smsCapable)` at line 845. Added invariant comment block referencing the helper docblock.
- **`accept-invitation/index.ts`**:
  - Lines 69-72 docblock: clarified placeholder index space is **unfiltered**.
  - Lines 74-78 preconditions: reinforced unfiltered invariant + reference v21.
  - Line 822 hardening: `if (phoneError || !phoneEventId)` belt-and-suspenders.
  - DEPLOY_VERSION: `v20-phone-emit-index-preservation` → `v21-frontend-index-space-fix`.
- **`accept-invitation/__tests__/phone-id-resolution.test.ts`**: F6 boundary test — `invitation-phone-0` against empty `createdPhoneIds` returns null.

### Verification

- `npm run typecheck` (frontend) → clean.
- `npm run lint` (frontend) → clean.
- `deno test --allow-net accept-invitation/__tests__/phone-id-resolution.test.ts` → **11 passed, 0 failed** (10 prior + F6 boundary).
- `deno test --allow-net _shared/__tests__/` → **54 passed, 0 failed** (no regression).
- Manual deploy + source-verify v21 on dev.
- Manual UI smoke: F3 failure scenario (3 phones, Office non-SMS, Mobile-A picked); confirm `sms_phone_id` resolves to Mobile-A's UUID, NOT Office's.
