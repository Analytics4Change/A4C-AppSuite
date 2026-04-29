-- =============================================================================
-- Migration: remove_self_bypass_update_user_notification_preferences
--
-- Purpose:
--   Tighten api.update_user_notification_preferences to require
--   public.has_permission('user.update') for ALL callers, including for
--   self-update. Removes the prior self-bypass (which allowed any caller
--   to update their OWN preferences without holding user.update).
--
-- Platform rule (codified 2026-04-29):
--   "No user should be able to accomplish anything in the platform without
--   explicit or effective permissions."
--
--   The self-bypass violated this rule: a user could write to their own
--   preferences purely on the basis of identity match, with no permission
--   check. Identity-based bypasses create implicit authority that the
--   provider cannot revoke or audit through the role/permission system.
--
-- Surfaced by:
--   B5 smoke test of manage-user-delete-rpc-and-scope-retrofit (2026-04-29).
--   Concern: a direct-care staff member could disable all notification
--   channels (email, sms, in_app) and become unreachable for medication-
--   delivery alerts — breaking a fundamental compliance guarantee. Under
--   the rule above, the answer is permission-based: provider grants
--   user.update to roles that should be able to self-manage; staff who
--   shouldn't be able to opt out simply don't get the permission.
--
-- Behavioral delta vs R2 (migration 20260427220243):
--   Before: IF p_user_id <> v_caller_id AND NOT has_permission('user.update')
--           THEN RAISE 42501  -- self-update bypassed permission check
--   After:  IF NOT has_permission('user.update') THEN RAISE 42501
--           -- every caller (self or admin) must hold user.update
--
-- Existing-data impact (verified 2026-04-29 against tmrjlswbsxmbglmaclxu):
--   All 4 active users hold provider_admin role with user.update perm,
--   so this change does not deny any current caller. Future direct-care
--   roles that lack user.update will be unable to update their own
--   preferences via this RPC — by design, per the rule above.
--
-- Effective permission derivation:
--   compute_effective_permissions propagates user.update implications
--   (e.g., user.role_assign → user.view); has_permission('user.update')
--   correctly counts both explicit grants and any future implications.
--
-- Frontend impact:
--   None expected. Existing 42501 mapping in SupabaseUserCommandService
--   surfaces as "Access denied - insufficient permissions". UI may want
--   to gate the notification-preferences form visibility for users
--   without user.update in a future card; not load-bearing for this fix.
--
-- Baseline-overload audit (Rule 15):
--   Single signature; CREATE OR REPLACE is safe.
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

    -- Permission gate: ALL callers (self or admin) must hold user.update.
    -- The previous self-bypass (p_user_id <> v_caller_id branch) was removed
    -- 2026-04-29 to align with the platform rule that no action proceeds
    -- without explicit or effective permission. Provider grants user.update
    -- to roles that should be able to self-manage notification preferences;
    -- staff who must remain reachable for medication-delivery alerts are
    -- denied this permission and therefore cannot disable their own channels.
    IF NOT public.has_permission('user.update') THEN
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
  - Caller MUST hold `user.update` (no self-bypass; identity match alone is
    insufficient). Provider grants user.update to roles authorized to
    self-manage notifications; staff who must remain reachable for
    operational alerts are denied this permission.
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
  42501 (RAISE)            - caller auth missing OR user.update permission denied (pre-emit).
  22023 (RAISE)            - malformed p_notification_preferences (pre-emit).
  success:false envelope   - soft-deleted target OR handler-driven failure.

Notes:
  - Pattern A v2: BOTH read-back checks (IF NOT FOUND + processing_error) required.
  - Response shape stable: {success, eventId, notificationPreferences} on success;
    {success: false, error} on failure.
  - Permission style: unscoped per PR #36 precedent (architecture decision in
    adr-edge-function-vs-sql-rpc.md Rollout 2026-04-27 course correction).
  - Self-bypass removed 2026-04-29: every caller, including for own preferences,
    must hold user.update. Aligns with platform rule "no user accomplishes
    anything without explicit or effective permissions."

References:
  - adr-edge-function-vs-sql-rpc.md - Rollout 2026-04-27.
  - adr-rpc-readback-pattern.md - Pattern A v2 contract.
$$;
