# update_user stream_version Race — Context

**Feature**: Eliminate concurrent-update race in `api.update_user`
**Status**: ⏸️ PARKED (no active implementation)
**Parked**: 2026-04-23 — surfaced during PR #30 (api-rpc-readback-pattern) self-review as finding m3
**Parked by**: PR #30 scope boundary — not a Pattern A v2 regression; legacy issue from baseline_v4
**Architect-reviewed**: 2026-04-23 (software-architect-dbc agent `ad2e78383cd378c9f`) — recommended park over fix-in-PR

## Problem Statement

`api.update_user` (latest definition in migration `20260423065747_api_rpc_readback_v2_event_id_check.sql` L682–708, and retrofitted IF NOT FOUND lookup in `20260423074238_api_rpc_readback_v2_m1_m2_fix.sql`) computes its stream_version via:

```sql
SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
FROM public.domain_events
WHERE stream_id = p_user_id AND stream_type = 'user';
INSERT INTO public.domain_events (..., stream_version, ...) VALUES (..., v_stream_version, ...);
```

Two concurrent `update_user` calls against the same user can read the same `MAX(stream_version)` and collide on the unique `(stream_type, stream_id, stream_version)` constraint.

**Pre-existing pattern** (from baseline_v4 `20260212010625`) — the manual-stream-version raw INSERT was preserved across Pattern A v1 / v2 retrofits because rewriting to `api.emit_domain_event()` was considered orthogonal to the error-surfacing scope of PR #30.

## Why Deferred from PR #30

1. **Zero current callers**: `grep -rn "update_user\b"` across the codebase confirms no production caller of `api.update_user`. Race is latent.
2. **Orthogonal to Pattern A v2 semantics**: PR #30 addresses silent-handler-failure surfacing; this is a concurrency/constraint-violation bug with a different failure mode.
3. **Metadata-field equivalence requires verification**: The current raw INSERT sets `source: 'api'`, `service_name: 'api-rpc'`, `operation_name: 'update_user'` directly in `event_metadata`. Switching to `api.emit_domain_event()` requires confirming those fields flow through correctly — independent work.
4. **Architect recommendation**: Park to an isolated follow-up PR with its own concurrency regression test.

## Proposed Fix (for future implementation)

Replace the manual stream_version calc + raw INSERT with `api.emit_domain_event()`:

```sql
DECLARE
    v_event_id uuid;
BEGIN
    -- ... existing validation ...

    v_event_id := api.emit_domain_event(
        p_stream_id := p_user_id,
        p_stream_type := 'user',
        p_event_type := 'user.profile.updated',
        p_event_data := jsonb_build_object(
            'user_id', p_user_id,
            'first_name', p_first_name,
            'last_name', p_last_name
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', v_current_user_id,
            'source', 'api',
            'service_name', 'api-rpc',
            'operation_name', 'update_user',
            'reason', COALESCE(p_reason, 'User profile update via API')
        )
    );
```

`api.emit_domain_event()` internally handles stream_version assignment (advisory-lock-protected) and emits the event atomically.

## Acceptance Criteria

- [ ] Replace manual stream_version calc + raw INSERT with `v_event_id := api.emit_domain_event(...)`.
- [ ] All current event_metadata fields preserved by merging into the `p_event_metadata` JSONB.
- [ ] Pattern A v2 read-back guards remain correct (IF NOT FOUND + post-emit processing_error check on `WHERE id = v_event_id`).
- [ ] Add concurrency regression test: two parallel `update_user` calls against the same user → both succeed, no unique-constraint violation.
- [ ] `handle_user_profile_updated` handler unchanged (still updates `public.users` base table).
- [ ] Migration applied to linked dev project via `supabase db push --linked`; post-apply `supabase db dump --linked --schema=api` confirms raw INSERT replaced by `api.emit_domain_event` call.

## Related Work

- `infrastructure/supabase/supabase/migrations/20260423062426_add_user_profile_updated_handler.sql` — added the missing `handle_user_profile_updated` handler during PR #30 Phase 1.
- `infrastructure/supabase/supabase/migrations/20260423065747_api_rpc_readback_v2_event_id_check.sql` L682 — current `update_user` definition (Pattern A v2, raw INSERT preserved).
- `infrastructure/supabase/supabase/migrations/20260423074238_api_rpc_readback_v2_m1_m2_fix.sql` — M1/M2 fix did NOT modify `update_user` (not in scope).

## Reference Materials

- PR #30 self-review finding m3 (lars-tice review 2026-04-23)
- Architect report for PR #30 remediation (agent `ad2e78383cd378c9f`, 2026-04-23)
- `api.emit_domain_event()` definition — `infrastructure/supabase/supabase/migrations/20260212010625_baseline_v4.sql` (search for `emit_domain_event`)
