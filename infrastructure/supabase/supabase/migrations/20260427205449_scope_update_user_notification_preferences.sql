-- =============================================================================
-- Migration: scope_update_user_notification_preferences
-- Purpose:   Retrofit api.update_user_notification_preferences to use the
--            canonical scoped-permission pattern (has_effective_permission
--            via public.get_user_target_path) for the admin branch.
--            Self-update bypass is preserved.
--
-- Context:
--   Per architect review (2026-04-27), PR #36's unscoped public.has_permission
--   permits intra-tenant cross-OU privilege escalation: a delegated admin
--   scoped to OU 'acme.pediatrics' could update notification preferences for
--   a user whose home OU is 'acme.cardiology'. Retrofit closes this gap.
--
-- Behavioral delta (vs PR #36, migration 20260424194102):
--   - Self-update bypass preserved: caller acting on themselves does NOT need
--     user.update permission and does NOT call the helper.
--   - Admin branch (p_user_id <> v_caller_id) now requires
--     public.has_effective_permission('user.update', target_path)
--     where target_path = public.get_user_target_path(p_user_id, v_org_id).
--   - All other behavior identical (Pattern A v2, soft-delete guard,
--     input shape validation, metadata, event_data, response shape).
--
-- Pre-deploy regression check (2026-04-27):
--   - Cross-OU query found 0 suspect calls in 30 days; 3 callers, all
--     provider_admin role with scope_path = org root. Under scoped semantics,
--     all 11 historical calls still pass (org_root @> any_descendant).
--   - GO verdict for retrofit; no behavioral regression expected.
--
-- Baseline-overload audit (Rule 15):
--   - api.update_user_notification_preferences(uuid, jsonb, text) — single
--     signature, CREATE OR REPLACE is safe. (Legacy 4-arg overload was dropped
--     in 20260424202754; only the 3-arg form remains.)
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
    v_target_path extensions.ltree;
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

    -- Permission: self-update bypass OR scoped user.update.
    -- Self-update is unscoped by policy: a user updating their own preferences
    -- doesn't require user.update permission (preferences are personal).
    -- Admin-acting-on-someone-else requires scoped user.update via the helper
    -- (canonical post-2026-04-27 pattern; closes intra-tenant cross-OU
    -- escalation gap that PR #36 inherited from the Edge Function).
    IF p_user_id <> v_caller_id THEN
        v_target_path := public.get_user_target_path(p_user_id, v_org_id);
        IF NOT public.has_effective_permission('user.update', v_target_path) THEN
            RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
        END IF;
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
    (b) hold `user.update` scoped to target's location via
        public.has_effective_permission('user.update',
          public.get_user_target_path(p_user_id, v_org_id)).
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
  42501 (RAISE)   - caller auth missing OR scoped permission denied (pre-emit).
                    Helper raises 42501 for "User not in tenant" too.
  P0002 (RAISE)   - target user does not exist (pre-emit, via helper).
  22023 (RAISE)   - null arg OR malformed p_notification_preferences (pre-emit).
  raise_exception (RAISE) - org has no path; data integrity (pre-emit, via helper).
  success:false envelope - soft-deleted target OR handler-driven failure.

Notes:
  - Pattern A v2: BOTH read-back checks (IF NOT FOUND + processing_error) required.
  - Response shape stable: {success, eventId, notificationPreferences} on success;
    {success: false, error} on failure.
  - Scoped-permission retrofit (2026-04-27): admin branch closed cross-OU gap;
    self-update bypass preserved.

References:
  - adr-edge-function-vs-sql-rpc.md - Rollout 2026-04-27 (this PR).
  - adr-rpc-readback-pattern.md - Pattern A v2 contract.
  - public.get_user_target_path - canonical user-targeted path resolution.
$$;
