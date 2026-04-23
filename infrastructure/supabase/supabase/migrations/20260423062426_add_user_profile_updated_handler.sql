-- =============================================================================
-- Migration: add_user_profile_updated_handler
-- Created: 2026-04-23
-- Purpose: Create the missing public.handle_user_profile_updated() handler.
-- =============================================================================
--
-- Background:
--   Surfaced during the api-rpc-readback-pattern Phase 1 implementation
--   (migration 20260423060052). The router process_user_event() has had a
--   CASE branch dispatching `user.profile.updated` events to
--   handle_user_profile_updated() since at least migration 20260217211231
--   (schedule_template_refactor.sql:515) — but the function itself was never
--   created. Audit:
--     * 0 migrations defining the function
--     * 0 handler reference files at handlers/user/
--     * Live DB confirms function does not exist
--     * api.update_user (defined in baseline 20260212010625) emits the event;
--       0 callers currently invoke api.update_user across the codebase, so
--       the bug has been silently latent (caught by the dispatcher's
--       WHEN OTHERS catch and persisted to processing_error).
--
--   With Pattern A read-back now in place on api.update_user (added by the
--   prior migration), the silent failure is partially surfaced — the RPC
--   returns {success: true, user: <stale row>} because the users row
--   pre-exists from signup but the handler never runs. Implementing the
--   handler closes the loop: read-back returns the freshly-updated row.
--
-- Behavior:
--   UPDATEs public.users.first_name and public.users.last_name based on the
--   event_data fields. Uses COALESCE to support partial updates (NULL values
--   in event_data preserve the existing column value). Mirrors the COALESCE
--   pattern used by handle_organization_contact_updated (cf. baseline grep).
--
-- Idempotency:
--   * CREATE OR REPLACE FUNCTION (re-runs are safe).
--   * UPDATE is itself idempotent (same input → same row state).
--
-- Reference: dev/active/api-rpc-readback-pattern/api-rpc-readback-pattern-tasks.md
--   (search "Surfaced during implementation"); architect report 2026-04-23.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_user_profile_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_user_id uuid;
    v_first_name text;
    v_last_name text;
BEGIN
    v_user_id := (p_event.event_data->>'user_id')::uuid;
    v_first_name := p_event.event_data->>'first_name';
    v_last_name := p_event.event_data->>'last_name';

    -- Partial update via COALESCE: NULL values in event_data preserve the
    -- existing column value. Matches the partial-update semantics of
    -- api.update_user, which accepts p_first_name/p_last_name as DEFAULT NULL.
    UPDATE public.users
    SET
        first_name = COALESCE(v_first_name, first_name),
        last_name  = COALESCE(v_last_name, last_name),
        updated_at = NOW()
    WHERE id = v_user_id;

    -- Note: no IF NOT FOUND raise. The users row is created on signup; if
    -- it's missing, that's a more serious issue that earlier handlers would
    -- have surfaced. The api.update_user pre-emit guard already validates
    -- the user exists in the org (via user_roles_projection check); this
    -- handler runs after that guard.
END;
$function$;

-- =============================================================================
-- Verification (run via MCP execute_sql or psql after apply):
--
-- 1. Function now exists:
--      SELECT proname FROM pg_proc
--      WHERE proname = 'handle_user_profile_updated' AND pronamespace = 'public'::regnamespace;
--      Expect: 1 row
--
-- 2. End-to-end: emit event, verify users row updated.
--    (Requires a real user; cannot test in dev DB without one.)
--      INSERT INTO domain_events (stream_type, stream_id, stream_version, event_type, event_data, event_metadata)
--      VALUES ('user', '<user_id>'::uuid, <next_version>, 'user.profile.updated',
--              jsonb_build_object('user_id', '<user_id>', 'first_name', 'TestFirst', 'last_name', 'TestLast'),
--              jsonb_build_object('user_id', auth.uid(), 'reason', 'Manual handler test'));
--      SELECT first_name, last_name FROM public.users WHERE id = '<user_id>';
--      Expect: TestFirst / TestLast
--
-- 3. No new failed events from this handler addition:
--      SELECT COUNT(*) FROM domain_events
--      WHERE event_type = 'user.profile.updated' AND processing_error IS NOT NULL
--        AND created_at > now() - INTERVAL '5 minutes';
--      Expect: 0
-- =============================================================================
