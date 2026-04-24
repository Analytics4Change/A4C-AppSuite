# manage-user → SQL RPC (update_notification_preferences) — Plan

## Executive Summary

Port the `update_notification_preferences` operation of `manage-user` Edge Function v11 to a new `api.update_user_notification_preferences` SQL RPC. Pattern A v2 read-back moves from two TypeScript round-trips to one in-transaction PL/pgSQL block. Frontend service cuts over from `functions.invoke()` to `rpc()`. AsyncAPI contract unchanged.

## Scope

See `context.md`. In scope: one SQL RPC + one frontend service method + delete the Edge Function case. Out of scope: other `manage-user` ops.

## Phases

| Phase | Description | Deliverable |
|-------|------------|-------------|
| 0 | Signature design — match Edge Function payload | Documented param list in this plan |
| 1 | Migration: create `api.update_user_notification_preferences` with Pattern A v2 | `supabase/migrations/<timestamp>_extract_user_notification_preferences_rpc.sql` |
| 2 | Frontend service cutover | `SupabaseUserCommandService.updateNotificationPreferences` uses `rpc()`; mock service mirrors |
| 3 | Edge Function cleanup | Remove `update_notification_preferences` case from `manage-user/index.ts`; bump version marker (v12) |
| 4 | Verification | Manual test via dev project; unit tests in `SupabaseUserCommandService.mapping.test.ts` updated to reflect RPC path |
| 5 | PR + merge | Single PR, direct cutover (no dual-deploy per context.md recommendation) |

## Phase 1 — Migration details (to be fleshed out pre-execution)

Canonical form:

```sql
CREATE OR REPLACE FUNCTION api.update_user_notification_preferences(
    p_user_id uuid,
    p_organization_id uuid,
    p_notification_preferences jsonb,
    p_reason text DEFAULT 'User updated notification preferences'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, api, pg_temp
AS $$
DECLARE
    v_event_id uuid;
    v_row public.user_notification_preferences_projection%ROWTYPE;
    v_processing_error text;
BEGIN
    -- Permission check + caller-driven failures (pre-emit) elided here;
    -- will be expanded to mirror current Edge Function checks.

    v_event_id := api.emit_domain_event(
        p_stream_id      := p_user_id,
        p_stream_type    := 'user',
        p_event_type     := 'user.notification_preferences.updated',
        p_event_data     := jsonb_build_object(
            'organization_id', p_organization_id,
            'notification_preferences', p_notification_preferences
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', p_organization_id,
            'reason', p_reason
        )
    );

    SELECT * INTO v_row
    FROM public.user_notification_preferences_projection
    WHERE user_id = p_user_id AND organization_id = p_organization_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'handler invariant violated: projection row missing after UPSERT')
        );
    END IF;

    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || v_processing_error
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'notificationPreferences', jsonb_build_object(
            'user_id', v_row.user_id,
            'organization_id', v_row.organization_id,
            'email_notifications', v_row.email_notifications,
            'in_app_notifications', v_row.in_app_notifications
            -- TODO: confirm exact projection column list before landing
        )
    );
END;
$$;
```

**Open questions** (resolve during Phase 0):
- Exact projection column shape — confirm against `user_notification_preferences_projection` schema
- Permission check — current Edge Function v11 uses `hasPermission(effectivePermissions, 'user.update')`? Confirm and port.
- Mapping — should we return snake_case or camelCase keys? Current frontend type `UpdateNotificationPreferencesResult.notificationPreferences` expects `snake_case` per AsyncAPI convention; verify.

## Risks & Open Questions

- **R1** — Permission semantics. Edge Function has JWT access + service-role secret separation. SQL RPC `SECURITY DEFINER` with RLS check via `auth.uid()` must reproduce the same authorization. Resolution: during Phase 0, enumerate every permission/invariant check currently in v11 and map each to a PL/pgSQL expression.
- **R2** — Test drift. `SupabaseUserCommandService.mapping.test.ts` (added during PR #32) tests the snake→camel mapping layer. If the new RPC returns camelCase directly, the mapping test becomes a no-op and should be replaced with an RPC-boundary contract test.
- **O1** — Should the new RPC replace the `manage-user` case or dual-deploy as a shim? See context.md — recommendation is direct cutover.

## Pre-implementation gates

- [ ] Confirm projection column list via Supabase MCP `list_tables`
- [ ] Enumerate v11 permission/invariant checks; decide SQL port strategy
- [ ] Architect pre-review of the final RPC signature + body? (Optional — Pattern A v2 is well-established; this is a mechanical port)
