# manage-user delete → SQL RPC — Plan

## Executive Summary

Extract `delete` from `manage-user` Edge Function into a new SQL RPC with Pattern A v2 read-back by construction. Closes the silent-failure gap for user deletion in the same PR as the extraction.

## Phases

| Phase | Description |
|-------|-------------|
| 0 | Inspect v11 delete case + `handle_user_deleted` handler; determine soft vs hard delete semantics |
| 1 | Migration: create `api.delete_user` with Pattern A v2 |
| 2 | Frontend service cutover |
| 3 | Edge Function cleanup |
| 4 | Verification + PR |

## Open Questions

- **O1** — ~~Soft-delete vs hard-delete?~~ **RESOLVED (Phase 0, 2026-04-27): SOFT delete.** Handler `handle_user_deleted` (`infrastructure/supabase/handlers/user/handle_user_deleted.sql`) sets `users.deleted_at = COALESCE(deleted_at, event_data->>'deleted_at'::timestamptz, p_event.created_at)` and `is_active = false`. The COALESCE order is intentionally replay-safe: existing tombstone wins, then event payload's deleted_at, then event creation time as final fallback. Read-back predicate for Pattern A v2: `WHERE id = p_user_id AND deleted_at IS NOT NULL`.
- **O2** — ~~Cascade scope?~~ **RESOLVED (Phase 0, 2026-04-27): NO CASCADE.** Handler only touches `public.users` (one UPDATE statement). It does NOT modify `user_roles_projection`, `user_org_phone_overrides`, `user_addresses_projection`, `user_phones_projection`, `user_emails_projection`, or any other projection. Orphan reads through these projections are closed at the read-side via `api.*` filters added in PR #35 (commit `8eae916f`) — that work joined to `users` and excluded soft-deleted rows in 5 read RPCs + 2 Edge Function paths. Conclusion: the RPC body just emits `user.deleted` and reads back from `users` (or the relevant projection). No additional cleanup events to chain.
- **O3** — ~~`auth.users` cleanup — does deletion also remove the auth record?~~ **Verified 2026-04-24 — no `auth.admin` call in delete path** (confirmed by grep of `manage-user/index.ts:668–680` + full-file audit during PR #33 review). Phase 0 re-confirmed at lines 447–536: `auth.admin.updateUserById` is gated by `if (requestData.operation === 'deactivate')` (line 507) — never fires for `delete`. Classification stable as `candidate-for-extraction`.

**Prerequisite**: ~~Handler `handle_user_deleted` is missing from the repo~~ **RESOLVED — handler defined in PR #35 (merged 2026-04-24, commit `8eae916f`).** Reference file at `infrastructure/supabase/handlers/user/handle_user_deleted.sql` is present and the migration that defined it (`20260424182345_add_missing_user_lifecycle_handlers_and_orphan_filters.sql`) is applied to prod.

## Phase 0 Findings (2026-04-27)

### Current Edge Function delete path (`manage-user/index.ts:456–536`)

Pre-Pattern-A-v2 emit-and-return-success:
1. Switch on `requestData.operation === 'delete'` → set `eventType = 'user.deleted'`, `timestampField = 'deleted_at'`
2. Build `eventData = { user_id, org_id, deleted_at: now }` (+ `reason` if provided)
3. Call `supabaseAdmin.rpc('emit_domain_event', { p_stream_id: userId, p_stream_type: 'user', p_event_type: 'user.deleted', p_event_data, p_event_metadata: buildEventMetadata(...) })`
4. On error → `handleRpcError(eventError, correlationId, corsHeaders, 'delete user')`
5. **NO read-back, NO `processing_error` check** — silently returns `{success: true, userId, operation}` even if the handler raised
6. `auth.admin.updateUserById` block (lines 507–518) is gated to `deactivate` only — does not run for `delete`

### Handler shape (`handle_user_deleted.sql`)

- One `UPDATE public.users` setting `deleted_at` (COALESCE-replay-safe), `is_active = false`, `updated_at = p_event.created_at`
- WHERE clause: `id = p_event.stream_id`
- `IF NOT FOUND` → `RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002'` (caught by `process_domain_event` and stored in `processing_error`)

### Implications for Phase 1 migration design

- **Pattern A v2 read-back**: `SELECT * FROM public.users WHERE id = p_user_id AND deleted_at IS NOT NULL` after capturing `v_event_id`, then check both `IF NOT FOUND` and `processing_error` per Rule 13.
- **Permission check**: `public.has_effective_permission('users:delete', p_scope_path)` (scoped — confirms the caller's right within the user's org). NOTE: confirm exact permission key during Phase 1 by grepping `infrastructure/supabase/handlers/` and `supabase/migrations/20260212010625_baseline_v4.sql` for `users:` perms.
- **`org_id` sourcing**: pull from JWT claims (`current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'`) — never accept from parameter (PR #36 precedent #4).
- **Caller identity for event_metadata.user_id**: `public.get_current_user_id()` (PR #36 precedent #3).
- **Correlation ID**: users may not have a stored `correlation_id` column on `users_projection` — confirm during Phase 1; if absent, generate fresh per `event-metadata-schema.md` (delete is a terminal lifecycle event so correlation reuse is less load-bearing than the invitation case).
- **`access_blocked` JWT guard**: per PR #39 precedent #8, port if the original Edge Function enforces it. Audit `manage-user/index.ts` for the check during Phase 1.
- **Dual-deploy preferred** (per backlog memory line 39, admin-session bundle longevity).

No surprises; the card is clean to advance to Phase 1 formal planning.

## Phase 1 Implementation Plan (2026-04-27)

### Scope expansion

During Phase 1 planning, the `software-architect-dbc` agent reviewed the proposed permission-check pattern and surfaced a systemic defect: PR #36 (`api.update_user_notification_preferences`) and PR #39 (`api.revoke_invitation`) both used unscoped `public.has_permission(<perm>)` to mirror the Edge Function helper at `_shared/types.ts:66-71`. The canonical scoped pattern (`has_effective_permission(perm, target_path)`) was already established in baseline_v4 (`bulk_assign_role` line 5498, OU mutators 5940/6023) but the two recent extractions broke it. Concrete attack vector: intra-tenant cross-OU privilege escalation. Decision: scope `api.delete_user` correctly from day one **and bundle the retrofit of PR #36 + PR #39 into the same PR**.

A canonical helper is also being introduced: `public.get_user_target_path(uuid, uuid)` — single source of truth for resolving the ltree path that feeds `has_effective_permission` for user-targeted RPCs.

### Pre-deploy regression check (executed 2026-04-27)

Cross-OU query against `domain_events` (last 30 days, `user.notification_preferences.updated` and `invitation.revoked`). Result: **0 suspect calls** for either event type. All 3 unique callers (3 distinct admins across 2 orgs) hold `provider_admin` role with `scope_path` = their org root. Under scoped semantics, `org_root @> any_descendant_path` is always TRUE, so all 11 historical calls would still pass. **Verdict: GO — no behavioral regression expected.**

### Scope bundle (this PR)

- M1: New helper `public.get_user_target_path(uuid, uuid)` with tenancy guard
- M2: New RPC `api.delete_user(uuid, text)` — scoped from inception
- M3: Retrofit `api.update_user_notification_preferences` (admin branch only — keep self-bypass)
- M4: Retrofit `api.revoke_invitation` (target = `organizations_projection.path` since `invitations_projection` has no OU column — flagged in COMMENT)
- Frontend service `deleteUser` cutover from Edge Function to RPC
- Edge Function `manage-user/index.ts`: remove `case 'delete'`; bump DEPLOY_VERSION
- Tests: 3 envelope-contract test sets (delete + retrofit-confirm × 2)
- Docs: scoped-permission rule in `infrastructure/supabase/CLAUDE.md`; `user.*` perm guidance in `rbac-architecture.md`; ADR Rollout entry
- Memory: backlog completion + new precedents
- Type regen for both `frontend/` and `workflows/` consumer copies

### Schema corrections discovered during execution

The architect's analysis assumed `users.current_org_unit_path` was a column. Reality (verified 2026-04-27 against `tmrjlswbsxmbglmaclxu`):

- `users` has `current_organization_id` and `current_org_unit_id` (uuid). The path is computed at JWT-mint time by `custom_access_token_hook` joining `organization_units_projection.path`.
- `organizations_projection.path` (ltree) — used as the org-root fallback.
- `organization_units_projection.path` (ltree) — joined via `users.current_org_unit_id`.
- `invitations_projection` has only `organization_id` (no OU column). M4 falls back to org root path; documented in COMMENT.

### Helper body (M1)

```sql
CREATE OR REPLACE FUNCTION public.get_user_target_path(p_user_id uuid, p_org_id uuid)
RETURNS ltree
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_target_path ltree;
    v_user_org_id uuid;
    v_user_org_unit_id uuid;
BEGIN
    IF p_user_id IS NULL OR p_org_id IS NULL THEN
        RAISE EXCEPTION 'p_user_id and p_org_id are required' USING ERRCODE = '22023';
    END IF;

    SELECT u.current_organization_id, u.current_org_unit_id
    INTO v_user_org_id, v_user_org_unit_id
    FROM public.users u
    WHERE u.id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_user_org_id IS DISTINCT FROM p_org_id THEN
        RAISE EXCEPTION 'User not in tenant' USING ERRCODE = '42501';
    END IF;

    IF v_user_org_unit_id IS NOT NULL THEN
        SELECT ou.path INTO v_target_path
        FROM public.organization_units_projection ou
        WHERE ou.id = v_user_org_unit_id;
        IF v_target_path IS NOT NULL THEN
            RETURN v_target_path;
        END IF;
    END IF;

    SELECT op.path INTO v_target_path
    FROM public.organizations_projection op
    WHERE op.id = p_org_id;

    IF v_target_path IS NULL THEN
        RAISE EXCEPTION 'Organization has no path (data integrity)' USING ERRCODE = 'raise_exception';
    END IF;

    RETURN v_target_path;
END;
$$;
```

### Cutover style

**Direct cutover** (matches PR #39 precedent). Dual-deploying three operations creates an unnecessarily complex two-phase deployment. Stale-bundle risk for an admin clicking delete in an old tab during deploy is bounded — error → retry → success.

### Open issues / follow-ups (outside this PR)

1. Remaining unscoped checks: `manage-user/index.ts:225-241` (`modify_roles`, default `user.update`) — addressed when those operations are extracted.
2. Deprecate the TS `hasPermission` helper at `_shared/types.ts:66-71` — track as follow-up.
3. CI lint rule for unscoped `has_permission` in new RPC migrations.
4. Org-switch JWT atomicity: `switch_organization()` updates `current_organization_id` non-atomically with JWT re-issuance. The two-arg helper closes the read path; emit paths in handlers may still see stale tenant context. The org-switch frontend is currently unimplemented (`SupabaseUserCommandService.ts:726-736` returns error), so this is latent.

## Reference

See `context.md`.
