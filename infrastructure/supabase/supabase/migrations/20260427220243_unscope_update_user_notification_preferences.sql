-- =============================================================================
-- Migration: unscope_update_user_notification_preferences
-- (revert R2 of architectural course correction)
--
-- Purpose:
--   Revert the scoped-permission retrofit applied in
--   20260427205449_scope_update_user_notification_preferences.sql.
--   Restores the PR #36 admin-branch form: unscoped
--   public.has_permission('user.update'). Self-bypass preserved.
--
-- Rationale:
--   See adr-edge-function-vs-sql-rpc.md Rollout 2026-04-27 § course
--   correction. Briefly: A4C users have no organizational location finer
--   than tenant, so target_path = org root for all callers; the scoped
--   check is vacuous and installs a misleading mental model. Reverting to
--   the precedent that PR #36 originally established.
--
-- All other behavior is preserved verbatim from PR #36:
--   - self-update bypass (caller acting on themselves needs no permission)
--   - Pattern A v2 read-back against user_notification_preferences_projection
--   - input shape validation
--   - soft-delete guard on target user
--   - response envelope shape
-- =============================================================================

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

    -- Permission port: self-update OR user.update permission (UNSCOPED).
    -- has_permission() unnests the [{p, s}] claim array for presence-only
    -- check (baseline_v4 lines 9927-9941). Restored from PR #36 verbatim;
    -- see adr-edge-function-vs-sql-rpc.md Rollout 2026-04-27 course
    -- correction for why scoped checks are not warranted for user.* in
    -- A4C's current model.
    IF p_user_id <> v_caller_id AND NOT public.has_permission('user.update') THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
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

GRANT EXECUTE ON FUNCTION api.update_user_notification_preferences(uuid, jsonb, text) TO authenticated;

COMMENT ON FUNCTION api.update_user_notification_preferences(uuid, jsonb, text) IS
$$Updates a user's notification preferences for the caller's JWT org context.

Preconditions:
  - JWT must supply `sub` and `org_id`; p_user_id non-null.
  - Caller must be (a) target user (self-update bypass) OR
    (b) hold `user.update` (unscoped) via public.has_permission('user.update').
  - p_notification_preferences must shape-match
    {email: bool, in_app: bool, sms: {enabled: bool, phone_id?: uuid|null}}.
  - Target user must not be soft-deleted (users.deleted_at IS NULL).

Postconditions:
  - On success: one `user.notification_preferences.updated` event in
    domain_events with {user_id, org_id, notification_preferences} in event_data.
  - On success: user_notification_preferences_projection row reflects submitted
    preferences.
  - On handler failure: domain_events row preserved with processing_error.
  - Never RAISE EXCEPTION post-emit (preserves audit row).

Error envelope:
  42501 (RAISE)            - caller auth missing OR permission denied (pre-emit).
  22023 (RAISE)            - malformed p_notification_preferences (pre-emit).
  success:false envelope   - soft-deleted target OR handler-driven failure.

Notes:
  - Pattern A v2: BOTH read-back checks (IF NOT FOUND + processing_error) required.
  - Response shape stable: {success, eventId, notificationPreferences} on success;
    {success: false, error} on failure.
  - Permission style: unscoped per PR #36 precedent. See
    adr-edge-function-vs-sql-rpc.md Rollout 2026-04-27 course correction
    for the architectural-pivot story.

References:
  - adr-edge-function-vs-sql-rpc.md - Rollout 2026-04-27.
  - adr-rpc-readback-pattern.md - Pattern A v2 contract.
$$;
