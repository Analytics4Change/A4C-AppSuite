# API RPC Read-back Pattern — Context

**Feature**: Enforce projection read-back + processing_error surfacing for all `api.update_*` RPCs (SQL RPCs + Edge Function orchestration tier)
**Status**: ✅ MERGED — PR #32 shipped 2026-04-24 (squash commit `6b4a2fe5`); archived to `dev/archived/api-rpc-readback-pattern/`
**Parked**: 2026-04-22
**Activated**: 2026-04-23 (per `client-ou-edit` Phase 9, after PR 1 merged as commit `e80de9bd`)
**Merged**: 2026-04-24 (PR #32; squash collapsed v10 + v11 remediation commits `e9a39a21` + `ffb00780` into `6b4a2fe5` on main)
**Final branch**: `feat/phase4-user-domain-typing` (merged; can be deleted)
**Origin**: Surfaced by `software-architect-dbc` during review of `client-ou-edit` feature (Major finding M3); proof-of-pattern landed in `api.update_client` (migration `20260422052825`) and `api.change_client_placement` (migration `20260423032200`, PR #27 review remediation)

## Problem Statement

All `api.update_*` RPCs in the codebase emit a domain event and return `{success: true, <id>}` immediately — they do NOT read back the projection after the event trigger runs. Consequences:

1. **Silent handler failure**: If the event handler sets `processing_error` (e.g., column drift, RLS denial, constraint violation), the RPC caller has no way to detect it without a follow-up query.
2. **Stale UI state**: Frontend ViewModels that merge server data optimistically can render out-of-sync values.
3. **No surfacing of projection-level validation**: Handlers may apply business rules (e.g., soft-delete guards) whose failure is invisible to the client.

The `client-ou-edit` feature mitigates this at the ViewModel level (calling `getClient()` after save and checking `processing_error`). That mitigation works for one VM but does not scale — every new VM has to re-implement the pattern correctly.

## Scope

### In scope (RPCs to refactor)
All `api.update_*` and `api.change_*` RPCs that emit events and return only a success flag. Inventory (to be confirmed during Phase 0 of implementation):

- `api.update_organization_unit`
- `api.update_role`
- `api.update_user_profile`
- `api.update_schedule_template`
- `api.update_insurance` (sub-entity)
- `api.update_funding` (sub-entity)
- `api.update_contact` (sub-entity)
- Other `api.update_*` discovered via `pg_get_functiondef` audit

**Note**: `api.update_client` is handled separately in `client-ou-edit` PR 1 as a proof-of-pattern. This feature generalizes the pattern to all other RPCs.

### Out of scope
- `api.*_create` / `api.*_register` RPCs (creation already returns the new row in most cases)
- `api.*_delete` RPCs (soft-delete pattern has its own read-back via `FOUND` check — separate concern)
- `api.change_client_placement` (scoped into `client-ou-edit` PR 1)

## Key Design Question

**Two possible patterns**:

### Pattern A — RPC reads back and returns full row
```sql
-- After event emission:
SELECT * INTO v_row FROM x_projection WHERE id = p_id;
IF NOT FOUND THEN
  RAISE EXCEPTION 'Update failed to apply' USING ERRCODE = 'P9003';
END IF;

-- Check for processing error on the event we just emitted:
IF v_row.last_event_id = v_event_id THEN
  -- OK, projection updated
ELSE
  -- Handler may have errored — query domain_events
  SELECT processing_error INTO v_err FROM domain_events WHERE id = v_event_id;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'Handler failed: %', v_err USING ERRCODE = 'P9004';
  END IF;
END IF;

RETURN jsonb_build_object('success', true, 'row', row_to_json(v_row));
```

### Pattern B — Client polls + checks processing_error itself
Status quo. Require every client to query after update.

**Recommended**: Pattern A — shift responsibility to the RPC so clients get consistent behavior.

## Considerations

- **Synchronous vs async triggers**: Current event triggers are `BEFORE INSERT/UPDATE` on `domain_events` — synchronous. Projection IS updated by the time the RPC continues. Read-back is always safe.
- **Performance**: One additional projection SELECT per update. Negligible (indexed PK lookup).
- **Backward compat**: Response shape changes from `{success, id}` to `{success, id, row}`. Frontend services must be updated to accept the new shape. Can be phased: include `row` optionally first, then make it authoritative.
- **Error surfacing**: `processing_error` on `domain_events` is currently the primary signal. RPC read-back converts silent failure into a RAISE EXCEPTION so PostgREST returns non-200.
- **Concurrency**: If two clients update simultaneously, each sees its own read-back. This is a win (clients see latest state).

## Related Work

- `client-ou-edit` PR 1 (2026-04-22+) — adds read-back to `api.update_client` as a proof-of-pattern
- Prior migration `20260221173821_fix_org_unit_rpc_guards.sql` — added read-back guards to 4 of 5 org unit RPCs (delete handler was the 5th, fixed 2026-02-23)
- ADR (to be created): `documentation/architecture/decisions/adr-rpc-readback-pattern.md`

## Important Constraints

- **Do NOT touch `api.change_client_placement` or `api.update_client`**: Already handled in `client-ou-edit` PR 1.
- **Must preserve RPC param signatures**: Existing callers must not break. Add return fields only.
- **Must run against live DB with existing data**: Projections cannot be rebuilt; read-back must not mutate.
- **Respect idempotency**: Migrations use `CREATE OR REPLACE FUNCTION` — safe to re-run.

## Reference Materials

- `infrastructure/supabase/supabase/migrations/20260221173821_fix_org_unit_rpc_guards.sql` — prior read-back pattern example
- `documentation/infrastructure/patterns/event-handler-pattern.md` — handler conventions
- `software-architect-dbc` review of `client-ou-edit` (M3 finding) — motivating context
- `dev/active/client-ou-edit-*.md` — the feature that surfaced this pattern

## Implementation Lessons

### N3 — Heredoc truncation bug in Phase 1.6 v2 migration (2026-04-23)

**What happened**: Phase 1.6 shipped migration `20260423065747_api_rpc_readback_v2_event_id_check.sql` as an 1820-line file containing 20 CREATE OR REPLACE FUNCTION definitions. The initial write used a heredoc that truncated silently at ~1100 lines due to an unescaped `$$` sequence inside an inner plpgsql block (heredoc terminator collision). The resulting migration file applied partially — 14 RPCs retrofitted, 6 truncated away. `supabase db push --linked` succeeded because the CREATE OR REPLACE statements that were present compiled cleanly; the missing 6 RPCs were silently absent from the migration.

**How we detected it**: Post-apply `supabase db dump --linked --schema=api` showed only 14 of the 20 expected `WHERE id = v_event_id` post-emit checks. Cross-checking the migration file line count (1820 lines expected, ~1100 actual in the first write) confirmed the truncation.

**Recovery**: `supabase migration repair --linked --status reverted 20260423065747` → rewrote the migration file as 20 separate CREATE OR REPLACE blocks (no nested heredoc) → `supabase db push --linked` re-applied the corrected complete file. Net result: all 20 function definitions retrofitted in one atomic apply after the repair.

**Takeaways for future large migrations**:

1. **Avoid heredoc-within-heredoc**: Either use a tool-driven write (Write tool enforces byte-accurate content) or stick to the `$$ ... $$` dollar-quote pattern for SQL that contains SQL (no nested heredoc delimiters).
2. **Verify line count after write**: Before `supabase db push`, `wc -l` the migration and cross-check against the expected function count × typical-size. A 1820-line file that writes as 1100 is a red flag.
3. **Verify via post-apply dump** for migrations touching >5 functions: `supabase db dump --linked --schema=<schema>` then grep for per-function signatures. Don't rely on `supabase db push` exit code alone — it only catches syntax errors, not missing definitions.
4. **`supabase migration repair --status reverted` is the right recovery** when a migration applied partially — it lets you re-push the corrected file without duplicate-history errors.

**Where this note goes on merge**: This file (`api-rpc-readback-pattern-context.md`) moves to `dev/archived/api-rpc-readback-pattern/` on PR #30 merge per the project's dev-doc lifecycle. The postmortem travels with the feature folder; it is NOT duplicated into the ADR (which is decision-record, not implementation war story) or handler reference files (which are code).

### Blocker 3 Key Decisions (2026-04-23 / 2026-04-24)

1. **Scope F split** (PR A cleanup + PR B backend) - Added 2026-04-23. PR A ships the type-narrowing cleanup + Sites 2/3 that have backend support now; PR B (Site 1 — UserAddress backend) parked for separate planning. Rationale: don't block the user-domain type cleanup waiting on a backend feature that has open design questions.

2. **Pattern A v2 frontend propagation contract (VM In-Place Patch)** - Added 2026-04-23. Services return narrowed `<Entity>Result` types with optional entity field (`phone?`, `field?`, `role?`, `user?`, `notificationPreferences?`). VMs use immutable `.map()`/`[...list, item]` to patch observable state in place by id; on entity-field absent, fall back to legacy `loadX()` refetch AND emit `log.warn` with structural-regression tag. Documented in NEW `documentation/frontend/patterns/rpc-readback-vm-patch.md`.

3. **Version-gated fallback detection for Edge Functions** - Added 2026-04-23. Unlike SQL RPCs (entity presence detection), Edge Function consumers use an explicit `deployVersion` marker in the response envelope (`'v11-pattern-a-v2-readback'`). Decouples rollout from field-presence semantics and makes version skew visible in logs.

4. **Edge Function as Pattern A v2 orchestration-tier equivalent** - Added 2026-04-24. `manage-user` v11 is the **first Edge Function** to implement Pattern A v2 (two-step: `processing_error` check via `supabaseAdmin.from('domain_events').eq('id', eventId)`, then projection read-back). Architect-validated: direct-table reads via service-role client are appropriate in Edge Functions (precedent: `invite-user` reads `organizations_projection` directly); the frontend CQRS rule (`api.*` RPC only) applies to browser-facing clients, NOT orchestration-tier Edge Functions.

5. **PK-lookup race-safety** - Confirmed 2026-04-24. `domain_events.id = eventId` is race-safe because the BEFORE INSERT trigger `process_domain_event()` runs inside the INSERT transaction, which commits before `api.emit_domain_event()` returns. The second Edge Function round-trip (SELECT by PK) always sees the final state with `processing_error` populated if the handler raised.

### Blocker 3 Files Created / Modified (2026-04-23 / 2026-04-24)

**Backend** (Phase 1/1.6 consolidated):
- `infrastructure/supabase/supabase/migrations/20260423060052_api_rpc_readback_pattern.sql` (Phase 1, 1164 lines) — 11 RPC Pattern A v1 retrofit
- `infrastructure/supabase/supabase/migrations/20260423062426_add_user_profile_updated_handler.sql` — missing handler for `api.update_user`
- `infrastructure/supabase/supabase/migrations/20260423065747_api_rpc_readback_v2_event_id_check.sql` (Phase 1.6, 1820 lines) — 20 RPC Pattern A v2 retrofit (dual check)
- `infrastructure/supabase/supabase/migrations/20260423074238_api_rpc_readback_v2_m1_m2_fix.sql` — PR #30 M1+M2 fixes (race-free `WHERE id = v_event_id`)
- `infrastructure/supabase/supabase/migrations/20260423154534_client_field_rpc_return_entities.sql` — Blocker 2: return entities from `api.update_field_definition` + `api.update_field_category`
- `infrastructure/supabase/supabase/migrations/20260423232531_add_user_phone_pattern_a_v2_readback.sql` — Blocker 3: `api.add_user_phone` returns camelCase `phone` entity
- `infrastructure/supabase/supabase/functions/manage-user/index.ts` — **v11** (upgraded from v10 in PR #32 remediation): real Pattern A v2 two-step read-back + `organization_id` audit metadata fix
- `infrastructure/supabase/handlers/user/handle_user_notification_preferences_updated.sql` — paired drift-guard comment added in PR #32 remediation

**Frontend types** (Option C narrowing):
- `frontend/src/types/user.types.ts` — `UserRpcEnvelope` base + `InviteUserResult`, `UpdateUserResult`, `UserPhoneResult`, `UpdateNotificationPreferencesResult`, `UserVoidResult`; `UserOperationResult` DELETED in PR #32 remediation
- `frontend/src/types/rbac.types.ts` — `UpdateRoleResult` narrowed (Blocker 1)
- `frontend/src/types/client-field-settings.types.ts` — `FieldDefinitionResult`, `FieldCategoryResult`, `DeleteFieldResult`, `DeleteCategoryResult`; `FieldCategoryResult.is_system` JSDoc Invariant note (PR #31 N2)
- `frontend/src/types/client.types.ts` — `ClientRpcEnvelope` + 9 specific result types (Phase 4b)

**Frontend services** (propagation):
- `frontend/src/services/users/SupabaseUserCommandService.ts` — snake→camelCase mapping for phone/user; `updateNotificationPreferences` consumes v11 envelope
- `frontend/src/services/users/MockUserCommandService.ts` — contract mirror
- `frontend/src/services/roles/SupabaseRoleService.ts` — propagates `role` + `permission_ids` (Blocker 1) + `log.warn` on missing `role` (PR #31 M1)
- `frontend/src/services/clients/SupabaseClientFieldService.ts` — propagates `field`/`category` (Blocker 2)
- NEW: `frontend/src/services/users/__tests__/SupabaseUserCommandService.mapping.test.ts` — 7 mapper unit tests with `vi.hoisted()` pattern (PR #32 remediation item 3 + Q5 + Q9.1)
- NEW: `frontend/src/services/users/__tests__/MockUserCommandService.envelope.test.ts` — envelope contract tests (7/7 passing)
- NEW: `frontend/src/services/users/__tests__/UserRpcContract.test.ts` — structural assertions parsing migration SQL (11/11 passing)

**Frontend ViewModels** (in-place patch):
- `frontend/src/viewModels/users/UsersViewModel.ts` — VM patch for phone + notificationPreferences + `log.warn` fallbacks; PR #32 remediation adds `contractViolation: true` belt-and-suspenders
- `frontend/src/viewModels/users/UserFormViewModel.ts` — PR #32 remediation adds clarifying comment above `submit()` union citing line-969 reachability
- `frontend/src/viewModels/roles/RolesViewModel.ts` — VM patch for role + permission_ids (Blocker 1)
- `frontend/src/viewModels/settings/ClientFieldSettingsViewModel.ts` — VM patches for field + category (Blocker 2)

**Documentation** (PR #32 remediation + Blocker 3 rollout):
- NEW: `documentation/frontend/patterns/rpc-readback-vm-patch.md` — VM in-place patch pattern (~190 lines, date-stamped + grep recipe per anti-staleness rule 8)
- Updated: `documentation/architecture/decisions/adr-rpc-readback-pattern.md` — `last_updated: 2026-04-24`, Rollout history entry for `manage-user` v11 as first Edge Function adopter
- Updated: `documentation/AGENT-INDEX.md` — `last_updated: 2026-04-24` (user_org_access audit clean)
- Updated: `documentation/infrastructure/reference/edge-functions/manage-user.md` — 2 stale `UserOperationResult` refs → `UserVoidResult` / `UpdateNotificationPreferencesResult`

### Blocker 3 Implementation Lessons

**L1 — `vi.mock` hoisting requires `vi.hoisted()` for spy declarations** (PR #32 remediation). The mapper test suite initially failed with `Cannot access 'mockApiRpc' before initialization` because `vi.mock()` factories run BEFORE module-scope `const` declarations. Fix: wrap spy declarations in `vi.hoisted(() => ({ mockApiRpc: vi.fn(), ... }))` so they exist when the factory fires. Pattern is now the reference for all vitest mocks in this codebase that need spy references.

**L2 — Reviewer "phantom arm" claims require line-citation rebuttal** (PR #32 review item 6). The reviewer asserted `UserVoidResult` arm in `UserFormViewModel.submit()` return union was unreachable — factually incorrect. The arm IS reachable on `modifyRoles` failure (result reassigned to `roleResult` at line 969). **Lesson**: when keeping code against reviewer feedback, add an inline comment with a SPECIFIC LINE CITATION that makes the rebuttal durable across future edits. Future maintainer sees both the architectural justification AND the verifiable reachability proof.

**L3 — Latent audit-compliance bugs surface during architect review audits** (PR #32 Q9.3). The architect-prompted audit of `buildEventMetadata()` caught that `organization_id` was missing from the call (violating `infrastructure/CLAUDE.md` Event Metadata Requirements). Pre-existed Edge Function v10; fixed opportunistically. **Lesson**: architect review's "Q9 audit checklist" pattern (check for latent issues orthogonal to the PR's stated scope) catches real bugs. Worth running on every structurally-significant PR.

**L4 — Edge Function MCP deploy tool fails on complex `_shared/` imports** (pre-existing memory pattern, re-confirmed). The MCP `deploy_edge_function` tool returns `InternalServerErrorException` on large payloads. Use `supabase functions deploy <name>` CLI instead (resolves `_shared/` automatically).

**L5 — Anti-staleness rule 8 (no hardcoded inventory counts) is a recurring trap**. The initial `rpc-readback-vm-patch.md` said "Three domains currently use this pattern" — drift-prone by construction. Fix pattern (also applicable to docs with "N handlers", "M RPCs", etc.): replace hardcoded count with date-stamped snapshot + grep recipe. Snapshot tells readers when the table was last walked; grep lets them discover the current set without relying on the table.
