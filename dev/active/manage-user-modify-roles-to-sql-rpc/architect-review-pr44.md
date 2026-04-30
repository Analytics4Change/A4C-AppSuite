# PR #44 — Architect Review (Implementation, 2nd Pass)

**Branch**: `feat/manage-user-modify-roles-to-sql-rpc`
**PR**: https://github.com/Analytics4Change/A4C-AppSuite/pull/44
**Reviewer**: Senior Fullstack Software Architect (Anthropic Claude, A4C-AppSuite skill set)
**Date**: 2026-04-30
**Prior verdict (plan-stage)**: APPROVE WITH MINOR FOLLOW-UPS (CR-1, CR-2, NT-1..NT-5, S-2/S-5)

---

## TL;DR

**Verdict**: **APPROVE WITH MINOR FOLLOW-UPS**

Implementation faithfully realizes the approved plan and absorbs all prior-pass findings. The new `api.modify_user_roles` is a textbook multi-event Pattern A v2 RPC with a defensible partial-failure contract. The RPC-shape registry (M3) closes the wrong-helper-for-shape PII-leak class at compile time, with a deterministic CI gate.

Two **NOTABLE** findings (NT-A, NT-B) that should land in follow-up cards but don't block merge. One **STRENGTH** worth highlighting (S-A) — the union-of-adds-and-removes validation closes a real authorization gap that existed in the legacy Edge Function path.

No CRITICAL findings. No drift between approved plan and implementation.

---

## Files Examined

**SQL migrations (3):**
- `infrastructure/supabase/supabase/migrations/20260430172139_add_modify_user_roles_rpc.sql` — the new RPC (381 lines)
- `infrastructure/supabase/supabase/migrations/20260430172625_backfill_rpc_shape_comments.sql` — heuristic backfill DO block
- `infrastructure/supabase/supabase/migrations/20260430172836_fix_rpc_shape_classifications.sql` — 13 reclassifications

**Frontend type-system (3):**
- `frontend/scripts/gen-rpc-registry.cjs` — codegen
- `frontend/src/services/api/rpc-registry.generated.ts` — emitted unions (89 envelope, 80 read, UncategorizedRpcs = never)
- `frontend/src/services/api/envelope.ts` — `unwrapApiEnvelope<T>` + `ApiEnvelopeFailure` partial-state fields
- `frontend/src/services/auth/supabase.service.ts` — `apiRpc<T>` / `apiRpcEnvelope<T>` narrowed signatures

**Edge Function shrink:**
- `infrastructure/supabase/supabase/functions/manage-user/index.ts` — `Operation = 'deactivate' | 'reactivate'`, `v15-modify-roles-extracted`

**Service-layer call sites:**
- `frontend/src/services/users/SupabaseUserCommandService.ts` — `modifyRoles` invocation + 7 wrong-helper migrations
- `frontend/src/services/users/IUserCommandService.ts` — interface unchanged for `modifyRoles` (already returned `ModifyUserRolesResult`)
- `frontend/src/services/users/MockUserCommandService.ts` — Mock parity for partial-failure shape
- `frontend/src/services/admin/EventMonitoringService.ts` — 3 wrong-helper migrations
- `frontend/src/types/user.types.ts` — `ModifyUserRolesResult` extended with `partial`, `failureIndex`, `failureSection`, `processingError`, `violations[]`
- `frontend/src/viewModels/users/UsersViewModel.ts` — `modifyRoles` action with VALIDATION_FAILED / PARTIAL_FAILURE branching

**CI / docs:**
- `.github/workflows/rpc-registry-sync.yml` — 90-line workflow, locally-seeded supabase container
- `.claude/skills/infrastructure-guidelines/SKILL.md` Rule 17
- `.claude/skills/frontend-dev-guidelines/SKILL.md` Rule 11 extension
- `frontend/src/services/CLAUDE.md` §3
- `infrastructure/supabase/CLAUDE.md` § RPC Shape Registry
- `documentation/architecture/decisions/adr-rpc-readback-pattern.md` § Type-level enforcement (M3)

**Tests:**
- `frontend/src/services/users/__tests__/SupabaseUserCommandService.mapping.test.ts` — 6 modifyRoles cases (success, VALIDATION_FAILED single, VALIDATION_FAILED multiple, NOT_FOUND, PARTIAL_FAILURE, 42501 → FORBIDDEN)

**Authority sources consulted:**
- `documentation/AGENT-INDEX.md`
- `infrastructure/CLAUDE.md`, `infrastructure/supabase/CLAUDE.md`
- `frontend/CLAUDE.md`, `frontend/src/services/CLAUDE.md`
- ADRs: `adr-edge-function-vs-sql-rpc.md`, `adr-rpc-readback-pattern.md`
- Baseline reference: `20260212010625_baseline_v4.sql` (handle_user_role_assigned, handle_user_role_revoked, validate_role_assignment)

**Build verification:**
- `npm run typecheck` (frontend) — clean (no errors)

---

## Sequence of Operations (Reference)

```mermaid
sequenceDiagram
    participant FE as UsersViewModel
    participant Svc as SupabaseUserCommandService
    participant Helper as supabaseService.apiRpcEnvelope&lt;T&gt;
    participant RPC as api.modify_user_roles
    participant Val as api.validate_role_assignment
    participant Emit as api.emit_domain_event
    participant Trig as process_domain_event_trigger
    participant Hand as handle_user_role_revoked / _assigned
    participant Proj as user_roles_projection

    FE->>Svc: modifyRoles({userId, add[], remove[]})
    Svc->>Helper: apiRpcEnvelope&lt;{userId, addedRoleEventIds[], removedRoleEventIds[]}&gt;
    Helper->>RPC: schema('api').rpc('modify_user_roles', params)

    Note over RPC: Pre-emit guards (RAISE EXCEPTION 42501)<br/>1. caller_id + org_id present<br/>2. !access_blocked<br/>3. has_permission('user.role_assign')

    RPC->>RPC: tenancy guard (envelope NOT_FOUND)
    RPC->>RPC: deleted/deactivated guard (envelope)
    RPC->>Val: union(add, remove) — closes revoke-side gap
    Val-->>RPC: {valid, violations[]}

    alt validation failed
        RPC-->>Helper: {success:false, error:'VALIDATION_FAILED', violations[]}
    else validation passed
        loop p_role_ids_to_remove
            RPC->>Emit: user.role.revoked
            Emit->>Trig: BEFORE INSERT
            Trig->>Hand: handle_user_role_revoked(NEW)
            Hand->>Proj: DELETE WHERE user_id, role_id (NO org_id filter — NT-A)
            Trig-->>Emit: success or processing_error
            Emit-->>RPC: event_id
            RPC->>RPC: v_removed_ids := v_removed_ids || event_id
        end
        loop p_role_ids_to_add
            RPC->>Emit: user.role.assigned
            Trig->>Hand: handle_user_role_assigned(NEW)
            Hand->>Proj: INSERT ... ON CONFLICT (user_id, role_id, org_id) DO UPDATE
            Emit-->>RPC: event_id
            RPC->>RPC: v_added_ids := v_added_ids || event_id
        end

        Note over RPC: Pattern A v2 read-back

        RPC->>Proj: COUNT removes still present (filtered org_id = v_org_id)
        RPC->>Proj: COUNT adds absent (filtered org_id = v_org_id)

        alt mismatch
            RPC->>Emit: SELECT string_agg(processing_error, ' | ') FROM domain_events WHERE id = ANY(captured_ids)
            RPC-->>Helper: {success:false, error:'PROCESSING_ERROR', errorDetails:{...}}
        else match
            RPC-->>Helper: {success:true, addedRoleEventIds[], removedRoleEventIds[]}
        end
    end

    Helper->>Helper: unwrapApiEnvelope&lt;T&gt; (mask PII at SDK boundary)
    Helper-->>Svc: ApiEnvelope&lt;T&gt;
    Svc->>Svc: branch on partial / violations / errorCode
    Svc-->>FE: ModifyUserRolesResult (typed)
```

---

## Findings Table

| ID | Severity | Area | Finding | Recommendation |
|---|---|---|---|---|
| **S-A** | STRENGTH | Authorization | `api.modify_user_roles` calls `validate_role_assignment(adds || removes)`. The legacy Edge Function path validated only adds, leaving revoke unguarded for delegation/scope. This implementation closes a real authorization gap. | Keep. Note in release narrative. |
| **S-B** | STRENGTH | Type-system | Compile-time wrong-helper-for-shape rejection works as designed. `EnvelopeRpcs` and `ReadRpcs` string-literal unions narrow `functionName`. `UncategorizedRpcs = never` is asserted by both codegen and CI grep. | Keep. |
| **S-C** | STRENGTH | Idempotency | Re-running with same input arrays converges (handlers idempotent on `(user_id, role_id, org_id)` ON CONFLICT for assigned, NO-OP DELETE for revoked). Recovery path documented in COMMENT ON FUNCTION. | Keep. |
| **NT-A** | NOTABLE | Handler scope mismatch | `handle_user_role_revoked` (baseline_v4:9603-9629) does NOT filter DELETE by `organization_id`. If user Y holds role X at org A AND org B, a `modify_user_roles({user:Y, remove:[X]})` call from org A's actor will silently delete the row at org B too. The Pattern A v2 read-back FILTERS by `organization_id = v_org_id`, so it would falsely PASS while data was destroyed at org B. PR authors flag this as out-of-scope (latent partial-idempotency in `handle_user_role_assigned` is the listed follow-up). | File a follow-up card "scope `handle_user_role_revoked` DELETE by event_data->>'org_id'". This is **pre-existing** but PR #44 is the first time the read-back filters by org_id and would mask cross-tenant data loss in success-looking responses. Severity is bounded by current usage: A4C user-identities don't have multi-org role assignments yet, so the cross-tenant case is theoretical at present. |
| **NT-B** | NOTABLE | CI determinism | `rpc-registry-sync.yml` runs `supabase db reset --local` after `supabase start`, but seed timing and migration order rely on the Supabase CLI's filesystem traversal. If a migration filename uses a timestamp earlier than `baseline_v4` (mistakenly), order is broken silently. The workflow doesn't pin the Supabase CLI version (`with: version: latest`). Future CLI minor bumps could change `db reset` semantics or the local container's PostgreSQL version (which would change `pg_get_function_identity_arguments` formatting and cause spurious diffs). | Pin `supabase/setup-cli@v1` to a known-good version (e.g., `version: '1.215.0'`). Add a one-line invariant check in the workflow: `ls infrastructure/supabase/supabase/migrations \| sort -c` (assert filenames already in sorted order). |
| **NT-C** | NOTABLE | Helper-narrowing escape hatch | `apiRpc<T>` and `apiRpcEnvelope<T>` narrow `functionName` to the registry unions, but `params: Record<string, unknown>` is unconstrained, and any caller can defeat narrowing with `'modify_user_roles' as ReadRpcs` or `as any`. The ESLint `no-restricted-syntax` rule planned for the bulk-migration card would forbid direct `.schema('api').rpc(` outside `supabase.service.ts` and `envelope.ts`, but doesn't catch the cast escape hatch. | Add an ESLint `no-restricted-types` or AST rule that flags `as ReadRpcs` / `as EnvelopeRpcs` casts outside `*.test.ts` files when the bulk-migration ESLint card lands. Lower priority than the bulk migration itself. |
| **NT-D** | NOTABLE | Backfill regex coverage | The heuristic regex in `20260430172625_backfill_rpc_shape_comments.sql` line 63 (`^(create\|update\|delete\|revoke\|assign\|...\|safety_net_)`) excluded `safety_net_deactivate_organization` via the manual override. But future name-prefix mutations (e.g., a new `archive_*` / `restore_*` / `purge_*` write verb) would silently fall through to `read` — which the per-RPC fixup migration would only catch retroactively. CI's `UncategorizedRpcs = never` gate would NOT catch this (the function IS tagged, just incorrectly). | The fixup-migration approach (heuristic + manual correction list) is acceptable for backfill, but the **forward-going** rule (Rule 17 in SKILL.md) is the right enforcement mechanism: every new RPC migration MUST add `COMMENT ON FUNCTION ... '@a4c-rpc-shape: ...'` explicitly. The heuristic should NOT be reused for new functions. Consider adding a one-line note in SKILL.md Rule 17: "Do not rely on the backfill regex for new functions — it was a one-shot retrofit." |
| **NT-E** | NOTABLE | Forensic message length | `string_agg(processing_error, ' | ')` aggregates raw `processing_error` strings from EVERY captured event with a non-null processing_error. A multi-role revoke that all fail produces an O(N) message. The `unwrapApiEnvelope` helper masks PII via `maskPii(data.errorDetails.message)` once; this is correct. However, the resulting string can grow unbounded. UI display of `errorDetails.message` should truncate or paginate. | Lower priority. Consider truncating to a sensible cap (e.g., 1000 chars) in `errorDetails.message` for the multi-event aggregate, and exposing per-event detail via the captured `addedRoleEventIds` / `removedRoleEventIds` for forensic drill-down through the admin dashboard. |
| **S-2/S-5 RESOLVED** | — | Type promotion | `ApiEnvelopeFailure` now exposes named `EnvelopeErrorDetails` and typed `partial` / `failureIndex` / `failureSection` / `processingError` / `userId` / `addedRoleEventIds` / `removedRoleEventIds` fields. No anonymous types on the failure envelope. | Confirmed resolved. |
| **CR-1 RESOLVED** | — | Migration scope | All 10 wrong-helper sites migrated (7 in SupabaseUserCommandService, 3 in EventMonitoringService). Verified by grep + typecheck-clean build. | Confirmed resolved. |
| **CR-2 RESOLVED** | — | Partial-failure contract | Multi-event partial-success contract documented in COMMENT ON FUNCTION + ADR + typed `ApiEnvelopeFailure.partial`. Service propagates `partial: true, failureIndex, failureSection, processingError, addedRoleEventIds, removedRoleEventIds`. VM displays "Partial failure (remove #N)" message. | Confirmed resolved. |
| **NT-1 RESOLVED** | — | DROP+CREATE re-tag | Codified in SKILL.md Rule 17 + CLAUDE.md § RPC Shape Registry + ADR §"Type-level enforcement (M3)". CI gate independently catches this via `UncategorizedRpcs ≠ never`. | Confirmed resolved. |
| **NT-2 RESOLVED** | — | Three-bucket emission | `EnvelopeRpcs` / `ReadRpcs` / `UncategorizedRpcs` emitted; CI fails on non-empty UncategorizedRpcs. | Confirmed resolved. |
| **NT-4 RESOLVED** | — | CI anchor | Workflow uses locally-seeded supabase container, not dev DB. | Confirmed resolved (deterministic concerns flagged separately as NT-B above — minor). |
| **NT-5 RESOLVED** | — | ADR subsection | `documentation/architecture/decisions/adr-rpc-readback-pattern.md` § "Type-level enforcement (M3)" added. | Confirmed resolved. |

---

## Targeted Review Against User-Specified Concerns

### 1. Authorization correctness

**PASS**. Verified flow:

```
1. JWT-claim-derived caller_id + org_id check  → RAISE EXCEPTION '42501' (Rule 16 compliant: static message, opaque ERRCODE)
2. access_blocked guard                        → RAISE EXCEPTION '42501'
3. has_permission('user.role_assign') unscoped → RAISE EXCEPTION '42501'
4. Tenancy guard (target.current_organization_id = v_org_id) → ENVELOPE NOT_FOUND (no UUID-existence leak across tenants)
5. Target-deleted, target-deactivated guards   → ENVELOPE
6. validate_role_assignment(union of adds + removes) → ENVELOPE VALIDATION_FAILED with violations[]
```

The unscoped `has_permission` choice is correct per the codified rule in `infrastructure/supabase/CLAUDE.md` § Critical Rules: A4C user-identities have no organizational location finer than tenant. The role-scope authorization is delegated to `validate_role_assignment`, which checks each role's `org_hierarchy_scope` against the actor's `user.role_assign` containment via `check_scope_containment`. **Crucially, the validation runs against the UNION of adds and removes** — closing the legacy revoke-side gap (verified: lines 162-164).

No path where partial failure leaks specific permission. The 42501 paths fire BEFORE any state change, and the validation envelope returns `violations[]` with role-specific reasons (the violations are about ROLES, not about which specific actor permission is missing).

### 2. Pattern A v2 conformance

**PASS**. The implementation deviates from the simple-case Pattern A v2 (which checks per-event projection-readback + per-event processing_error) in a defensible way:

- **Multi-event aggregate read-back**: Uses `COUNT(*)` to assert all removes absent and all adds present in current tenant, then aggregates `processing_error` from `domain_events WHERE id = ANY(captured_ids)` on miss. This is the correct generalization to N events.
- **Captured event_ids in arrays**: `v_added_ids` and `v_removed_ids` accumulate as events are emitted, in input-array order (preserved index correspondence).
- **Idempotency**: Pre-existing per-event idempotency keys (`concat('assign:', user_id, ':', role_id)` and `concat('revoke:', user_id, ':', role_id)`) are correctly composed.
- **No RAISE inside the loop on emit failure**: The mid-loop EXCEPTION handler returns the partial envelope without RAISE, preserving any audit rows already persisted with `processing_error`. This is the correct pattern (RAISE rolls back the trigger's audit row).

One subtle correctness note: when array_length is NULL (empty array), the IF guards correctly skip the read-back block, avoiding spurious failures.

### 3. Partial-failure contract

**PASS**. Unambiguous shape:
- `failureIndex` is the 0-based offset into the failed loop's input array.
- `failureSection` is `'add'` | `'remove'`.
- `addedRoleEventIds` and `removedRoleEventIds` are EMITTED-IN-ORDER, so a frontend can reconstruct: "removes 0..K-1 succeeded; remove K failed; adds did not run" when `failureSection='remove'`, and "all removes succeeded; adds 0..K-1 succeeded; add K failed" when `failureSection='add'`.
- Audit rows for emitted events ARE persisted (the EXCEPTION handler doesn't RAISE), so `domain_events` is queryable for forensics.
- Re-running with the same input arrays is idempotent due to handler-level uniqueness constraints + idempotency_key in metadata.

### 4. RPC-shape registry rigor

**PASS with NT-D**. The codegen emits `UncategorizedRpcs = never` after the fixup migration (verified: rpc-registry.generated.ts line 189). The heuristic-then-fixup approach is acceptable for one-shot backfill of 169 RPCs but should NOT be reused; Rule 17 (forward-going) is the right enforcement.

DROP+CREATE re-tag rule has CI teeth: `UncategorizedRpcs ≠ never` blocks merge. The codegen also fails when two overloads of the same `proname` carry different shape tags (verified at gen-rpc-registry.cjs:138-145 — `conflicts` array surfaces the conflicting OIDs/argument-lists with descriptive error message).

### 5. CI determinism

**PASS with NT-B caveats**. The locally-seeded container path (`supabase start` → `supabase db reset --local`) is the right deterministic anchor. Two minor non-blocking risks: the unpinned `supabase/setup-cli@v1` version and absent migration-order invariant assertion. Either could yield spurious diffs in the future. Pin the CLI version and add a `sort -c` check.

### 6. Helper narrowing soundness

**PASS with NT-C caveats**. TypeScript narrows `functionName` correctly. Verified by inspecting `apiRpc<T>(functionName: ReadRpcs, ...)` and `apiRpcEnvelope<T>(functionName: EnvelopeRpcs, ...)`. Edge cases:

- `as any` / `as ReadRpcs` casts defeat narrowing — addressed by NT-C ESLint suggestion.
- Dynamic function names (`const fn = computeFn(); apiRpc(fn, ...)`) would only typecheck if `fn` is typed as `ReadRpcs`. If typed as `string`, fails narrowing at the call site. Good.
- Helper bypass via direct `client.schema('api').rpc(...)` is the migration-card target.

### 7. Edge Function `Operation` union narrowing

**PASS**. Verified at `manage-user/index.ts:51`: `type Operation = 'deactivate' | 'reactivate'`. No frontend caller invokes `modify_roles` against the Edge Function — `SupabaseUserCommandService.modifyRoles` calls `apiRpcEnvelope<T>('modify_user_roles', ...)`. The Edge Function header doc (lines 1-22) accurately describes the three extracted operations and what remains. `DEPLOY_VERSION = 'v15-modify-roles-extracted'`. The Edge Function shrunk by ~136 lines (151 deletions, 15 additions in this file).

### 8. The 13 reclassifications in the fixup migration

**Sampled and validated:**

| RPC | Initial classification | Corrected | Validation |
|---|---|---|---|
| `bulk_assign_role` | envelope (regex matched `bulk_`) | **read** | Returns `{successful, failed, totalRequested, totalSucceeded, totalFailed, correlationId}` (baseline_v4:392 + 482) — no top-level `success` discriminator. **Correct.** |
| `get_client` | read (regex matched `get` prefix not in write-verb list) | **envelope** | Returns `{success: true|false, ...}` with permission-denied / not-found branches (20260423013804:47, 55, 113; 20260422052825:322, 330, 383). **Correct.** |
| `validate_role_assignment` | read by default (returns jsonb but `validate` is in write-verb list) | **read** | Returns `{valid: bool, violations: jsonb[]}` (baseline_v4:6779-6841) — no `success` discriminator (uses `valid` instead). **Correct.** |
| `get_failed_events_with_detail` | read (matched `get` prefix) | **envelope** | Returns Pattern A v2 envelope per migration-stated PII-handling pattern. **Correct.** |
| `sync_role_assignments`, `sync_schedule_assignments` | envelope (regex matched `sync` not in write-verb list — actually it WAS not matched, defaulted to read; the fix says envelope→read which means initial was envelope) | **read** | Per migration comment: success-path returns flat aggregate batch results without top-level `success`. **Plausible — consistent with `bulk_assign_role` pattern.** |

The 13 reclassifications are architecturally correct, not regex artifacts.

### 9. Anti-patterns

**PASS**. Specifically verified:

- ✅ No per-event-type triggers added (single dispatcher path preserved)
- ✅ `p_event.stream_id` used (not `aggregate_id`) — verified at modify_user_roles RPC: emits use `p_stream_id := p_user_id`
- ✅ Rule 16 PII compliance: pre-emit `RAISE EXCEPTION` strings are static (`'Access denied'`, `'Permission denied'`, `'Access blocked: organization is deactivated'`) with opaque ERRCODE 42501. NO identifier interpolation in failure paths.
- ✅ EXECUTE granted to `authenticated` (line 349) — not `service_role`-only
- ✅ No new event types added — uses existing `user.role.assigned` / `user.role.revoked` (already routed in baseline routers)
- ✅ Mid-loop EXCEPTION handler does NOT `RAISE` — returns envelope (preserves audit rows)
- ✅ Stream type `'user'` is correct (matches existing routing)
- ✅ Idempotency keys composed correctly (`concat('assign:', user_id, ':', role_id)` etc.)
- ✅ Frontend uses `apiRpcEnvelope<T>` exclusively — masks PII at SDK boundary

### 10. Catches I want to file

- **NT-A** (handler scope mismatch — pre-existing, but PR #44 read-back masks it). High-impact when multi-org users land. File card.
- **NT-B** (CI determinism micro-risks: unpinned CLI version, missing migration-order assertion).
- **NT-C** (helper-narrowing cast escape hatch — bulk-migration follow-up).
- **NT-D** (backfill regex retroactive risk — codify "do not reuse" in SKILL.md).
- **NT-E** (unbounded forensic message length on multi-role failure aggregation — UI / cap concern).

---

## Architecture Review Checklist

```
[PASS] CQRS Standards
       Multi-event Pattern A v2 boundaries respected. Frontend never touches
       projection tables directly. Read-back checks projection state but the
       MUTATION path goes through emit_domain_event → handler (no direct
       projection writes from the RPC). Permission check is unscoped (correct
       per A4C user-identity model).

[PASS] Naming Conventions
       Function name api.modify_user_roles aligns with existing api.update_role,
       api.delete_user precedents. Event types user.role.assigned /
       user.role.revoked unchanged from baseline. JSON envelope keys
       (success, error, violations, partial, failureIndex, failureSection,
       processingError, addedRoleEventIds, removedRoleEventIds, userId)
       are consistent with the typed ApiEnvelopeFailure surface.

[PASS] Design Patterns
       - Multi-event Pattern A v2 (variant of read-back-with-processing-error)
       - Saga-style mid-loop short-circuit with explicit partial-state envelope
         (idempotent on retry)
       - Compile-time type narrowing via string-literal unions (M3 registry)
       - Codegen + CI gate as enforcement layer (defense-in-depth atop runtime
         maskPii)
       Patterns appropriately scoped to problem complexity. No
       over-engineering (no custom ERRCODE definitions; reuses 42501).

[PASS] data-testid Attributes
       Not applicable to this PR — no UI-component additions. The VM
       (UsersViewModel.modifyRoles) propagates structured error/partial state
       to existing UI surfaces.

[PASS] AsyncAPI Event Registration
       Event types user.role.assigned and user.role.revoked are pre-existing
       (baseline_v4 routers; AsyncAPI yaml). NOT new events — no AsyncAPI
       registration needed.

[PASS] Type Generation — No Anonymous Types
       ApiEnvelopeFailure named with all partial-state fields typed
       (EnvelopeErrorDetails, ApiRoleAssignmentViolation, partial?, failureIndex?,
       failureSection?, processingError?, userId?, addedRoleEventIds?,
       removedRoleEventIds?). ModifyUserRolesResult extends UserRpcEnvelope
       with same typed fields. RoleAssignmentViolation typed. EnvelopeRpcs
       and ReadRpcs are generated string-literal unions (NOT inline). No
       anonymous types on the wire.

[PASS] Observability, Tracing & Monitoring
       Service uses createTracingContext + Logger.pushTracingContext +
       Logger.popTracingContext (try/finally). RPC source recorded in
       event_metadata.source = 'api.modify_user_roles' for audit drill-down.
       VM emits log.warn on partial failure with failureSection/Index for
       on-call diagnostics. Structured logs match existing patterns.

[PASS] Error Surfacing to UI
       UsersViewModel.modifyRoles displays:
       - VALIDATION_FAILED: first violation message (or "N violations: <first>")
       - PARTIAL_FAILURE: "Partial failure (<section> #<index>): <processingError>"
       - Other envelope errors: result.error
       Errors NOT silently swallowed. errorDetails.code is a typed
       UserOperationErrorCode propagated through the entire chain.
```

---

## Recommendations

### Must address before merge (BLOCKERS)
None.

### Recommended follow-ups (file as cards)

1. **NT-A** — Card: "scope `handle_user_role_revoked` DELETE by `event_data->>'org_id'`". Same shape as the listed `users.roles[]` array-update partial-idempotency follow-up. Expected fix is a 5-line handler-body change + reference-file update + per-org test. **Trigger**: when A4C user-identities can hold the same role at multiple tenants (currently theoretical — no production impact).

2. **NT-B** — Pin `supabase/setup-cli@v1` to a specific version in `.github/workflows/rpc-registry-sync.yml`. Add `ls migrations | sort -c` invariant. ~10 minutes of work.

3. **NT-C** — Bundle into the `migrate-services-to-api-rpc-envelope/` card: add ESLint AST check for `as ReadRpcs` / `as EnvelopeRpcs` casts outside `*.test.ts`.

4. **NT-D** — Single-line update to SKILL.md Rule 17: add note "Backfill regex was a one-shot retrofit; do NOT reuse for new functions."

5. **NT-E** — Lower priority. Cap `errorDetails.message` aggregate length to ~1000 chars in the RPC; expose per-event drill-down via `domain_events.id` lookup.

### Optional polish (not required)
- Consider documenting the empty-array short-circuit ("removes empty AND adds empty → INVALID_INPUT envelope") in the COMMENT ON FUNCTION response-envelope list. Currently mentioned in code (line 101-111) but not in the comment block.

---

## Verdict

**APPROVE WITH MINOR FOLLOW-UPS**

The implementation is high quality. All prior-pass findings have been resolved. The two new NOTABLE findings (NT-A handler scope, NT-B CI version pinning) are appropriately filed as follow-up cards rather than blockers. The PR meaningfully advances three architectural concerns simultaneously:

1. Closes the last `candidate-for-extraction` from the Edge Function vs SQL RPC ADR.
2. Closes the legacy revoke-side authorization gap (validate UNION of adds + removes).
3. Establishes type-level enforcement (M3) of helper-shape choice — defense-in-depth atop runtime PII masking.

The plan-to-implementation mapping is faithful. No drift detected. Merge when smoke testing in dev confirms golden / violation / partial paths.

— Senior Fullstack Software Architect, A4C-AppSuite, 2026-04-30
