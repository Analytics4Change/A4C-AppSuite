-- Migration: add api.update_user_notification_preferences (first Edge→RPC extraction)
--
-- Establishes the precedent shape for extracting `manage-user` Edge Function
-- operations into SQL RPCs per `adr-edge-function-vs-sql-rpc.md` (PR #33).
--
-- Replaces the Edge Function path `manage-user update_notification_preferences`
-- (v11 Pattern A v2 readback) with a single in-transaction PL/pgSQL function.
-- The Edge Function case is deleted in the same PR (direct cutover).
--
-- Re-introduces an RPC form of this operation, replacing the 2026-01-20 removal
-- (archived migration 20260120181034_remove_notification_prefs_update_rpc.sql);
-- this time the handler + projection contract is mature (Pattern A v2) and the
-- precedent is established by PR #33 ADR.

CREATE OR REPLACE FUNCTION api.update_user_notification_preferences(
    p_user_id uuid,
    p_notification_preferences jsonb,
    p_reason text DEFAULT 'User updated notification preferences'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_caller_id uuid := public.get_current_user_id();
    v_org_id uuid := NULLIF(
        (current_setting('request.jwt.claims', true)::jsonb) ->> 'org_id', ''
    )::uuid;
    v_event_id uuid;
    v_metadata jsonb;
    v_deleted_at timestamptz;
    v_row record;
    v_prefs jsonb;
    v_processing_error text;
BEGIN
    -- Caller identity + tenant context must be present.
    -- SECURITY: v_org_id MUST come from JWT; never accept from body.
    IF v_caller_id IS NULL OR v_org_id IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;

    -- Permission port: self-update OR user.update permission.
    -- has_permission() already unnests the [{p, s}] claim array correctly
    -- (baseline_v4 lines 9927-9941).
    IF p_user_id <> v_caller_id AND NOT public.has_permission('user.update') THEN
        RAISE EXCEPTION
            'Permission denied: Can only update your own notification preferences unless you have user.update permission'
            USING ERRCODE = '42501';
    END IF;

    -- Input shape validation (mirrors Edge Function manage-user/index.ts:338-350)
    IF jsonb_typeof(p_notification_preferences -> 'email') <> 'boolean'
       OR jsonb_typeof(p_notification_preferences -> 'in_app') <> 'boolean'
       OR jsonb_typeof(p_notification_preferences -> 'sms' -> 'enabled') <> 'boolean' THEN
        RAISE EXCEPTION 'Invalid notification_preferences shape' USING ERRCODE = '22023';
    END IF;

    -- Soft-delete guard (mirrors Edge Function manage-user/index.ts:509-516).
    -- Required post-PR #35 which now populates users.deleted_at.
    SELECT deleted_at INTO v_deleted_at FROM public.users WHERE id = p_user_id;
    IF v_deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User is deleted');
    END IF;

    v_metadata := jsonb_build_object(
        'user_id', v_caller_id,
        'organization_id', v_org_id,
        'source', 'api.update_user_notification_preferences',
        'reason', p_reason
    );

    v_event_id := api.emit_domain_event(
        p_stream_id      := p_user_id,
        p_stream_type    := 'user',
        p_event_type     := 'user.notification_preferences.updated',
        p_event_data     := jsonb_build_object(
            'user_id', p_user_id,
            'org_id',  v_org_id,
            'notification_preferences', p_notification_preferences
        ),
        p_event_metadata := v_metadata
    );

    -- Pattern A v2 read-back (ordering per infrastructure/supabase/CLAUDE.md
    -- guard rail: IF NOT FOUND branch + post-read processing_error branch).
    SELECT email_enabled, sms_enabled, sms_phone_id, in_app_enabled
    INTO v_row
    FROM public.user_notification_preferences_projection
    WHERE user_id = p_user_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM public.domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' ||
                COALESCE(v_processing_error, 'projection read-back returned no row')
        );
    END IF;

    SELECT processing_error INTO v_processing_error
    FROM public.domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || v_processing_error
        );
    END IF;

    v_prefs := jsonb_build_object(
        'email', v_row.email_enabled,
        'sms',   jsonb_build_object(
            'enabled',  v_row.sms_enabled,
            'phone_id', v_row.sms_phone_id
        ),
        'in_app', v_row.in_app_enabled
    );

    RETURN jsonb_build_object(
        'success', true,
        'eventId', v_event_id,
        'notificationPreferences', v_prefs
    );
END;
$$;

GRANT EXECUTE ON FUNCTION
    api.update_user_notification_preferences(uuid, jsonb, text)
    TO authenticated;

COMMENT ON FUNCTION api.update_user_notification_preferences(uuid, jsonb, text) IS
$$Updates a user's notification preferences for the caller's JWT org context.

Preconditions:
  - JWT must supply `sub` (caller id) and `org_id` claim; p_user_id must be non-null.
  - Caller must be (a) the target user OR (b) hold `user.update` via
    public.has_permission() on the `effective_permissions` JWT claim.
  - p_notification_preferences must shape-match
    `{email: bool, in_app: bool, sms: {enabled: bool, phone_id?: uuid|null}}`.
  - Target user must not be soft-deleted (users.deleted_at IS NULL).

Postconditions:
  - On success: exactly one `user.notification_preferences.updated` event is
    appended to `domain_events` with stream_id = p_user_id, stream_type = 'user',
    carrying {user_id, org_id, notification_preferences} in event_data and
    {user_id, organization_id, source, reason} in event_metadata.
  - On success: `user_notification_preferences_projection` row for
    (p_user_id, JWT org_id) reflects the submitted preferences (handler UPSERT).
  - On handler failure: `domain_events` row is preserved with populated
    `processing_error` (audit trail intact); return envelope has
    `success: false, error: 'Event processing failed: ...'`.
  - Never `RAISE EXCEPTION` post-emit (would roll back the audit row — see
    adr-rpc-readback-pattern.md Decision 2).

Invariants:
  - `org_id` is ALWAYS sourced from the JWT; NEVER accepted as input. Breaking
    this invariant is a multi-tenancy bypass.
  - Pattern A v2: BOTH read-back checks (IF NOT FOUND + captured-event_id
    processing_error) must remain (adr-rpc-readback-pattern.md Decision 1).
  - Response shape stable: `{success, eventId, notificationPreferences}` on
    success; `{success: false, error}` on failure. Keys are contract.

Error envelope:
  42501 (RAISE) — caller auth missing or permission denied (pre-emit).
  22023 (RAISE) — malformed p_notification_preferences (pre-emit).
  success:false envelope — soft-deleted user OR handler-driven failure.

Notes:
  - Metadata parity trade-off vs. Edge Function: RPC cannot populate
    `ip_address`, `user_agent`, `request_id` in event_metadata (request
    headers not accessible in PL/pgSQL). Audit queries on this event type
    will see nulls for those fields post-cutover. This is compliant with
    infrastructure/CLAUDE.md which scopes those fields to Edge Functions.
  - Service-role callers: current_setting('request.jwt.claims', true) returns
    NULL in service-role context; the JWT guard returns 'Access denied'. This
    matches the Edge Function's JWT-requirement and is the desired semantic.
  - Migration rollback: no-op. This is a CREATE OR REPLACE of a net-new
    function; reverting the migration leaves the function defined but unused.
    No DOWN migration needed.

Reference: adr-edge-function-vs-sql-rpc.md (LB0 extraction);
           adr-rpc-readback-pattern.md (Pattern A v2).
$$;
